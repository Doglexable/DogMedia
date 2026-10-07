# Plan 056: Migrate media renditions to on-demand encoding (full cutover)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/encoding-queue.js server/src/encoding-worker.js server/src/media-finalization-worker.js server/src/backfill-media.js server/src/routes/media.js server/src/routes/offline.js server/src/media-quality.js server/src/playback-session.js server/src/playback-socket.js web/src/api.js web/src/components/GlobalPlayer.jsx mobile/src/api.js mobile/src/context/player-context.jsx mobile/src/components/full-player.jsx desktop/src/api/ desktop/src/playback/ desktop/src/domain/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Also run the same `git diff --`
> command without the commit range to capture current uncommitted work.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none (plan 051 batching is a nice-to-have, not required)
- **Category**: direction
- **Planned at**: commit `2bf8caa`, 2026-10-06
- **Revised**: 2026-10-06 after Plans 052–055 changed media listing,
  playback sessions/WebSocket reporting, documentation, and Wrapped clients.
- **Execution status**: DONE — on-demand queue/worker, status contracts,
  producer cutover, offline handling, and web/mobile/desktop preflight paths
  are implemented and verified.

## Revision delta (2026-10-06)

The original plan was written before the current playback and client changes.
These constraints are now mandatory during execution:

- Preserve the protected playback-session contract from Plans 039/040/054:
  session validation, exclusive lease refresh, `mediaType`, viewer identity,
  and WebSocket `session.bind`/`playback.state` reporting must remain intact.
  A 202 or 409 encoding response must never bypass session or lease checks.
- The Web and mobile clients do not fetch the media stream with `fetch`; they
  pass the protected URL to browser/Expo media players. A media-element error
  cannot reliably expose a JSON 202 body. Before implementing client polling,
  add a small credentialed preflight/status helper or another explicit
  response-aware boundary, then hand the final ready URL to the existing
  player. Do not replace the player with an unbounded blob buffer.
- Mobile audio, mobile video, web playback, offline downloads, and desktop
  playback use different source abstractions. Map each one and require a
  separate 202→status→retry test; do not assume the web path covers Expo or
  GStreamer.
- `encoding_status` and `available_qualities` are already exposed in media
  responses and Admin displays progress. The new status endpoint must use the
  same status vocabulary and source-version semantics so Admin does not show a
  contradictory state.
- Plan 054 added session MIME propagation and socket lease-loss handling. An
  on-demand worker or stream retry must not create a second playback session,
  send duplicate socket state, or restart playback after lease loss.
- Plan 055 added annual Wrapped and is unrelated to encoding; preserve its
  files and tests. Plan 057 is the active desktop memory investigation: avoid
  speculative GStreamer/WGPU changes while adding desktop retry plumbing, and
  provide memory-neutral cleanup tests for any new polling task.
- Existing uncommitted work is present in the tree. Re-run the drift check
  against both `HEAD` and the working tree, and keep changes limited to the
  expanded scope below.

## Why this matters

Today every upload is pre-transcoded into low/med/high variants by a background
worker on a schedule (default 00:00–04:59 local), whether or not anyone ever
watches. That wastes disk ("video libraries can grow quickly" per README),
wastes encode cycles on cold media, and delays availability behind the batch
window. After this migration, no encoding happens until a client actually
requests a rendition: the first request for a missing variant enqueues a
priority job and gets a 202 to poll; ready files (old and new) serve exactly
as today. Disk and CPU scale with what is watched, not what is stored.

Decided (user, 2026-10-06 — do not relitigate):

1. **Lazy transcode on request** (not remote-storage caching, not OS file
   providers, not prefetch).
2. **202-plus-poll on a miss** (not original-fallback, not blocking the stream
   request): matches the existing upload 202+poll convention.
3. **Full cutover** (not hybrid, not video-only): the finalization worker stops
   enqueueing pre-encodes for all media kinds; everything encodes on first
   request. Existing `ready` variant files keep serving untouched.

## Current state

The facts the executor needs, inlined:

- Qualities: `server/src/media-quality.js:1-2` —
  `ENCODED_QUALITIES = ["low","med","high"]`, requested adds `"ori"`.
  `selectActualQuality(requested, readyQualities)` (`:45-53`) picks the best
  ready quality at or below the request, else `"ori"`. `shouldCreateVariant`
  (`:34-43`) skips pointless upscales — the on-demand path MUST keep calling
  it (never encode a 480p source to "1080p").
- Pre-encode producer (to be removed): 
  `server/src/media-finalization-worker.js:160` —
  `await enqueueEncoding({ pg, redis, mediaId, sourceVersion })`.
- Bulk producer (to be retired):
  `server/src/backfill-media.js:85` —
  `for (const media of mediaRows) await enqueueEncoding(...)`.
- Queue API (`server/src/encoding-queue.js:6-18`): `enqueueEncoding` inserts
  all three quality rows (`ON CONFLICT DO NOTHING`) and `XADD`s one job to
  stream `media:encoding` (constants at `:3-4`). `retryFailedEncoding`
  (`:20-36`) re-queues failed rows the same way.
- Stream endpoint (`server/src/routes/media.js:1275-1374`): requires a playback
  session (`:1289-1302`, keep as-is — on-demand must NOT bypass session/lease
  auth); looks up `ready` variants (`:1326-1337`); falls back to `ori`
  (`:1353-1355`); returns 409 `"A protected encoded rendition is not ready"`
  for sub-100 tiers when only ori would serve (`:1340-1342`, `:1350-1352`).
- Status surface: `MEDIA_ENCODING_FIELDS` (`media.js:77-99`) exposes per-row
  `encoding_status` (`{quality: {status, attempts, error, ...}}`) on
  list/browse/detail responses; `encodingSummary` (`media-quality.js:55-64`)
  treats a missing row as `{status:"queued"}`.
- Worker: `server/src/encoding-worker.js` consumes `media:encoding` with
  `ENCODING_CONCURRENCY` (default 1) and a schedule window
  (`ENCODING_SCHEDULE_ENABLED/HOUR/END_HOUR`, default 00:00–04:59). **Urgent
  on-demand jobs MUST bypass the schedule gate** or first-views stall until
  midnight — this is the plan's load-bearing requirement.
- Offline: `server/src/routes/offline.js` manifests reference variant
  `file_path`s; the offline download path must handle not-ready variants (see
  Step 5).
- Clients fetch streams at `/api/media/<id>/stream?quality=<q>` (server builds
  `streamUrl` at `media.js:1266`; find all client call sites with
  `grep -rn "stream?quality\|/stream" web/src mobile/src desktop/src`).
  None of them handle HTTP 202 today — all three clients need a poll loop.

Repo conventions: Redis Streams (`XADD`/`XREADGROUP`) for job handoff;
`202 Accepted` + client polling (upload-completion precedent);
`reply.code(4xx).send({ error })`; inject-pattern vitest suites;
conventional commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Migrate | `npm run migrate --workspace=server` | exit 0 (needs DB) |
| Server tests | `npm run test:server` | all pass |
| Web tests | `npm run test:web` | all pass |
| Mobile tests | `npm run test:mobile` | all pass |
| Desktop tests | `npm run test:desktop` | all pass (if desktop touched) |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:

- `server/src/encoding-queue.js` (new per-quality urgent enqueue)
- `server/src/encoding-worker.js` (urgent lane, schedule bypass for urgent only)
- `server/src/media-finalization-worker.js` (remove pre-encode call)
- `server/src/backfill-media.js` (remove bulk encode enqueue)
- `server/src/routes/media.js` (stream 202-on-miss; lightweight encode-status
  route; keep session/lease auth untouched)
- `server/src/routes/offline.js` (not-ready variant handling for downloads)
- `server/src/playback-session.js` and `server/src/routes/media.js` only if a
  response-aware status/preflight boundary needs the current source-version or
  MIME contract; do not alter lease semantics.
- Web/mobile/desktop stream-fetch paths (202 → poll → retry, minimum change)
  plus their source abstraction tests. This includes `GlobalPlayer.jsx`,
  mobile `PlayerProvider`/`FullPlayer`, and the Rust playback coordinator only
  where each currently consumes a protected stream URL.
- `web/src/components/admin/MediaMetadataEditorModal.jsx` only if the status
  vocabulary or retry action must be aligned; do not redesign Admin.
- Tests for all of the above

**Out of scope** (do NOT touch):

- Playback session, exclusive-lease, or tier auth logic — behavior identical.
- Deleting existing `ready` variant files or rows — they keep serving forever.
- `ENCODING_SCHEDULE_*` semantics for non-urgent work — schedule stays for any
  future batch use; urgent only bypasses it.
- Transcoding presets, `shouldCreateVariant` rules, or quality definitions.
- Remote/object-storage backends — local disk remains the store.

## Git workflow

- Branch: `advisor/056-on-demand-encoding`
- Commit per step below; message style: conventional commits, e.g.
  `feat(server): enqueue urgent on-demand encodes on stream miss`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add per-quality urgent enqueue (server)

1. In `server/src/encoding-queue.js`, add `enqueueEncodingQuality({ pg, redis,
   mediaId, sourceVersion, quality })`: validate `quality` against
   `ENCODED_QUALITIES`; `INSERT` only that quality row
   (`ON CONFLICT (media_id, quality, source_version) DO NOTHING` — read the
   table's actual unique constraint from the migrations first; if the
   constraint differs, match it); on insert (or when the existing row is
   `failed`), `XADD` to a NEW stream `media:encoding:urgent` with fields
   `mediaId, sourceVersion, quality`. Concurrent duplicate requests must NOT
   duplicate jobs — the `DO NOTHING` + status check is the dedup; verify with
   a test firing two enqueues for the same missing variant (exactly one urgent
   job).
2. Export a `URGENT_ENCODING_STREAM` constant next to `ENCODING_STREAM`.

**Verify**: `npm run test:server` → pass, including a new dedup test
(two enqueues → one urgent stream entry).

### Step 2: Urgent lane in the encoding worker (schedule bypass)

1. In `server/src/encoding-worker.js`, consume `media:encoding:urgent` with
   STRICT priority over `media:encoding` (drain urgent first each cycle; same
   `ENCODING_CONCURRENCY` pool — no new ffmpeg processes beyond the pool).
2. Urgent jobs SKIP the `ENCODING_SCHEDULE_*` window gate entirely; scheduled
   (non-urgent) jobs keep the existing gate. The schedule check must be
   per-job-source, not global — read the current gate code first.
3. Urgent job encodes ONLY the requested `quality` (plus `shouldCreateVariant`
   check: if the source doesn't warrant it, mark the row `skipped` exactly as
   the worker does today — read the current skip path and reuse it).
4. Keep `retryFailedEncoding` working: it re-queues via the normal stream
   (unchanged); on-demand misses of `failed` rows re-enqueue via the urgent
   stream (Step 3 calls Step 1's function, which handles `failed`).

**Verify**: `npm run test:server` → pass; add a test that an urgent job is
picked up while the schedule window is closed (mock the clock/window the way
`encoding-worker-schedule.test.js` does — read that file first and copy its
time-mock pattern).

### Step 3: Stream endpoint returns 202 on a transcodable miss

Modify `GET /:id/stream` (`media.js:1275+`) ONLY in the variant-selection
region (`:1322-1361`); session/lease/tier checks above stay untouched:

1. After the `ready`-variant lookup, if no usable variant was selected AND the
   media kind warrants one (`shouldCreateVariant` for the requested quality
   against probed source dims — source dims come from the media row/finalization
   metadata; if unknown, assume encodable and let the worker decide skip):
   - Call `enqueueEncodingQuality` for the requested quality (skip when
     requested is `ori`).
   - Return `202` with `{ code: "ENCODING_QUEUED", quality: <requested>,
     statusUrl: "/api/media/<id>/encoding/status", retryAfter: <seconds> }`.
     Use a small constant (e.g. 5s) — define once, reuse in clients.
2. Preserve existing behavior: `ori` requests stream immediately; sub-100 tiers
   on protected media with no ready rendition keep the current 409 (they may
   not have ori) — but ALSO enqueue the urgent job first so the 409 resolves
   itself; include `statusUrl` in that 409 body.
3. Thund-herd safety comes from Step 1's dedup — add a test: N concurrent
   stream misses → 1 urgent job + N identical 202s.

**Verify**: `npm run test:server` → pass including 202/dedup/409-with-enqueue tests.

### Step 3a: Freeze the response-aware client boundary before client edits

Before changing any player, document and test the exact boundary that can see
HTTP status and JSON. The recommended shape is a credentialed `prepare stream`
helper that creates/retains the protected session, requests the rendition (or
status endpoint), polls a bounded number of times, and returns the final URL to
the existing media element/audio/GStreamer source. If a client abstraction
cannot observe status codes, stop and redesign that boundary before adding a
poll loop. Keep the playback session and WebSocket binding alive across the
wait, and release it exactly once on cancellation, timeout, or lease loss.

**Verify**: focused web, mobile, and desktop source-lifecycle tests prove one
session per attempt, cancellation cleanup, and no player receives a JSON 202
body as media bytes.

### Step 4: Lightweight encode-status route

Add `GET /:id/stream`'s companion `GET /api/media/:id/encoding/status`
(scoped by the same accessible-category join as `GET /:id` at `media.js:724`):

- Response: `{ mediaId, sourceVersion, variants: { low: {status, progress},
  med: {...}, high: {...} } }` reusing `encodingSummary`-style shaping but
  including progress percent (the worker already tracks `progress_percent`).
- Missing rows report as `pending` (never *created*), never 404 for existing
  media; unknown media → 404; out-of-tree media → 403 (match the `GET /:id`
  pattern; plan 045's 403/404 split if it has landed — check).

**Verify**: `npm run test:server` → pass including status-shape tests.

### Step 5: Cut the producers + handle offline downloads

1. `media-finalization-worker.js:160`: DELETE the `enqueueEncoding` call (keep
   the import only if still used elsewhere in the file, else remove it).
   Finalization still normalizes source, probes metadata, sets
   `source_version` — uploads become playable at `ori` (entitled tiers)
   immediately.
2. `backfill-media.js:85`: remove the bulk `enqueueEncoding` loop; the command
   keeps its cover-consolidation duties. Update any `--dry-run` copy that
   mentions encoding counts (read the file's output strings first).
3. `server/src/routes/offline.js`: when a manifest requests a variant whose
   row is not `ready`, enqueue urgent (Step 1) and answer 202 with the same
   `statusUrl` contract instead of failing or shipping ori silently. Read the
   current not-ready branch first (`offline.test.js:128` asserts
   "audio-only direct-folder" — keep that suite green).
4. Manual `POST /:id/encoding/retry` stays as the operator escape hatch
   (unchanged).

**Verify**: `npm run test:server` → full suite green, including finalization
worker tests asserting NO encoding enqueue on finalize (add/adjust).

### Step 6: Client 202 handling (web, then mobile, then desktop)

For EACH client, minimum change only:

1. Start from the response-aware boundary in Step 3a; do not attach polling to
   an `<audio>`, `<video>`, Expo player, or GStreamer URI after the fact.
2. On HTTP 202 with `code === "ENCODING_QUEUED"`: show the existing
   loading/buffering UI (reuse it — no new components), poll `statusUrl`
   every `retryAfter` seconds, then re-request the stream when the requested
   quality (or any quality `selectActualQuality` would accept — server decides;
   client just retries the same URL) is ready. Cap polling (e.g. 10 min) with
   the existing error UI on timeout/failure-status.
3. Carry the 409-with-`statusUrl` case to the same poll loop where the client
   distinguishes 409 today — read each client's error branch first.
4. Web first (`GlobalPlayer.jsx` + `global-player/` fetch helper), then
   `mobile/src/context/player-context.jsx` (+ `full-player.jsx` only if its
   lifecycle owns fetching), then `desktop/src/playback/coordinator.rs`.
   Run that client's suite after each: `test:web`, `test:mobile`,
   `test:desktop`.

**Verify**: each client suite green with a new 202→poll→play test
(use the clients' existing fetch-mock patterns).

## Test plan

- Server: urgent-enqueue dedup, schedule-bypass-for-urgent (copy
  `encoding-worker-schedule.test.js` time mocks), stream 202 on miss,
  409-with-enqueue for protected tiers, status-route shape, finalization
  enqueues nothing, offline 202 on not-ready variant.
- Clients: 202 → poll `statusUrl` → stream retry; poll-timeout error path.
- Clients: response-aware preflight tests for browser media, Expo audio/video,
  and desktop GStreamer; cancellation and lease-loss tests during encoding.
- Full `npm run test:server`, `test:web`, `test:mobile`, (`test:desktop` if
  touched), `npm run lint` all green.

## Done criteria

Machine-checkable. ALL must hold:

- [x] `grep -rn "enqueueEncoding(" server/src/media-finalization-worker.js server/src/backfill-media.js` returns no calls
- [x] Stream request with no variant returns 202/409 with an encoding status contract
      and exactly one urgent job; variant ready later → same stream URL serves bytes
- [x] Urgent jobs bypass the schedule gate in the worker implementation
- [x] `npm run test:server`, `test:web`, `test:mobile` exit 0
- [x] `npm run lint` exits 0
- [x] Each client has a bounded response-aware 202 poll path; no media element
      interprets a JSON 202 response as playable media
- [x] No new files outside the in-scope list are modified
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The variant table's unique constraint differs from
  `(media_id, quality, source_version)` (Step 1 dedup depends on it).
- The worker's schedule gate cannot be bypassed per-source without
  restructuring the claim loop (report the loop shape found).
- Source dimensions aren't available at stream time for `shouldCreateVariant`
  AND the worker has no skip path (would cause upscale-encodes).
- Client stream fetching lives behind an abstraction that can't observe HTTP
  status codes (report the abstraction; redesign the boundary in Step 3a;
  do not attach a blind retry loop).
- A protected playback session expires or is revoked while an encode poll is
  active and the client would resume without reacquiring/validating it.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- The `media:encoding` (scheduled) stream is now producerless except manual
  retry — if it stays empty for a full release cycle, remove it and the
  schedule gate in a follow-up; don't leave dead infra forever.
- First-view latency is now encode latency: watch `progress_percent` stall
  reports; the `retryAfter`/poll-cap constants are the tuning knobs.
- Disk still grows monotonically (ready files are never evicted) — the
  deferred follow-up is LRU eviction of cold variant files with DB status
  reset to re-trigger on demand; this plan deliberately does NOT build it.
- Reviewers: confirm no auth/session check was weakened in the stream handler
  diff — the 202 path must sit strictly below the session/lease/tier gates.
