# Plan 054: Revise the blocked realtime playback WebSocket (plan 041 delta)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/playback-socket.js mobile/src/context/player-context.jsx mobile/src/components/full-player.jsx web/src/components/GlobalPlayer.jsx desktop/src/playback/coordinator.rs plans/041-realtime-playback-websocket.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
> ALSO read `plans/041-realtime-playback-websocket.md` fully first — it is the
> parent spec; this plan is its revision delta, not a replacement.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plans 039 and 040 (both DONE — the holder contract and
  client UI this builds on)
- **Category**: direction
- **Planned at**: commit `2bf8caa`, 2026-10-06
- **Execution status**: DONE — mobile lease-loss baseline preserved and media
  type propagation fixed with regression coverage.

## Why this matters

Plan 041 (WebSocket push for exclusive-playback ownership/position) is BLOCKED:
its isolated implementation passed gates but was rejected in review — the
mobile force-release defect was already repaired in the current tree, while
the exact
`PLAYBACK_LEASE_LOST` + `available` sequence now has coverage. Meanwhile all three
clients still poll heartbeat/lease status on ~5s timers and the documented
socket protocol (`README.md:303-323`) remains stated-but-undelivered. This plan
fixes the known review delta plus two adjacent socket defects, with a test for
the exact failure sequence, so 041 can land.

## Current state

Facts (re-verify each — the working tree has uncommitted 041-related changes;
run `git status` and `git diff HEAD --stat` first and record what is dirty):

- Parent spec: `plans/041-realtime-playback-websocket.md` (BLOCKED; review
  notes cite missing `onError` revocation handling in
  `mobile/src/context/player-context.jsx` and unproven background-audio socket
  behavior). The uncommitted hunk in `server/src/playback-socket.js` adds the
  revoked `sessionId` to the `PLAYBACK_LEASE_LOST` protocol error (additive,
  keep it).
- Baseline: mobile force-release already stops local playback; preserve this
  behavior and its sequence test.
- Known defect 2 (verified 2026-10-06): `server/src/playback-socket.js:192`
  builds socket identity with hardcoded `mediaType: "audio/"` even for video
  sessions; downstream `authorizeExclusiveReport`
  (`server/src/playback-live-state.js:40`) classifies by that wrong type
  (benign today — ownership is by id match — but wrong).
- Known design point: `playback-socket.js:128` — web paused sockets
  intentionally do not renew the lease while native ones do (by design, keep).
- Polling call sites to eventually retire (NOT in this plan, listed for
  context): `web/src/components/GlobalPlayer.jsx:287-315`,
  `mobile/src/context/player-context.jsx:420-444`, desktop polling in
  `desktop/src/ui/mod.rs:402-414`.

Repo conventions: ticket-then-upgrade auth (`POST /api/playback/socket-ticket`
→ credential-free WS at `/api/playback/socket`, first message carries the
single-use ticket); HTTP heartbeat/lease-status stays as reconnect fallback;
tests via vitest inject + socket harnesses (`playback-socket.test.js` exists).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Web tests | `npm run test:web` | all pass |
| Mobile tests | `npm run test:mobile` | all pass |
| Lint | `npm run lint` | exit 0 |
| Desktop tests | `npm run test:desktop` | all pass (if desktop touched) |

## Scope

**In scope**:

- `server/src/playback-socket.js` (mediaType fix; keep the `sessionId` field)
- `server/src/playback-session.js` and `server/src/routes/media.js` (persist the
  protected media MIME type in the session used by the socket)
- `mobile/src/context/player-context.jsx` (`onError`/revocation handling for
  the lease-lost sequence)
- `mobile/src/components/full-player.jsx` (only if the stop-playback fix
  requires lifecycle changes there)
- `server/src/playback-socket.test.js` + mobile player tests (new regression tests)
- `plans/041-realtime-playback-websocket.md` — update ONLY its status/review
  section if the plan file tracks it; do not rewrite the parent spec.

**Out of scope**:

- Retiring the HTTP polling loops — separate follow-up after this ships.
- Background-audio socket keepalive proof on Android/iOS hardware — explicitly
  deferred (see Step 3); do not attempt OS-level work here.
- Desktop client changes unless the socket protocol shape changes (it should not).
- Web `GlobalPlayer.jsx` changes unless the lease-lost sequence requires them.

## Git workflow

- Branch: `advisor/054-playback-socket-revision`
- Conventional commits, e.g. `fix(mobile): stop playback on lease-lost revoke sequence` and `fix(server): real mediaType in socket playback reports`
- Do NOT push or open a PR unless instructed. Note: the tree is dirty with
  041-related work — commit or stash discipline matters; do not mix unrelated
  dirty changes into these commits (check `git status` per commit).

## Steps

### Step 1: Write the failing test for the lease-lost sequence first

In the mobile player tests (find the file covering `player-context.jsx` —
check `mobile/src/**/*.test.jsx`):

- Simulate: bound session receives `PLAYBACK_LEASE_LOST` with the revoked
  `sessionId`, followed by holder state `available`/other-holder, while local
  playback is active.
- Assert: local playback stops (audio/video element paused/unloaded, no
  further heartbeat with the revoked session) and UI reflects the loss.
- Watch it FAIL on current code (red). If it passes, STOP — the defect
  description is wrong; report instead of inventing work.

**Verify**: new test fails for the right reason (playback continues), all
other mobile tests pass: `npm run test:mobile`.

### Step 2: Fix mobile revocation handling + server mediaType

1. Mobile: handle the `PLAYBACK_LEASE_LOST` + availability sequence in
   `player-context.jsx` (the review-noted `onError` revocation gap): on
   revoked-session loss, stop local playback, release the session reference
   (see plan 042's late-async-source cleanup pattern — late
   session-creation-after-unmount must also release), and transition to the
   observer/idle state. Cover the force-release (takeover) trigger
   specifically — that is the reported user-visible bug.
2. Server (`playback-socket.js:192`): thread the bound session's real media
   mime family into the socket identity instead of the `"audio/"` literal
   (carry from `session.bind` or look up the media row — pick the cheaper
   correct source already in scope). Keep the new `sessionId` field on
   lease-lost errors.

**Verify**: Step-1 test now passes (green); `npm run test:server`,
`npm run test:mobile`, `npm run test:web` all green.

### Step 3: Scope-cut background audio explicitly

Do NOT attempt to prove background-socket keepalive on device here. Instead:

- Document in the code (comment at the socket lifecycle) and in your final
  report: background behavior is OS-dependent and unverified; the HTTP
  heartbeat/lease-status fallback MUST remain for reconnect (it already does —
  verify it still does and note the routes).
- If the fallback was weakened by any in-flight 041 work, restore it.

**Verify**: grep confirms HTTP fallback routes still wired; full suites green.

## Test plan

- New red-then-green lease-lost sequence test (Step 1) — the plan's keystone.
- Existing suites (`playback-socket.test.js`, mobile player/context tests,
  web exclusive-session tests) all green — no regressions in the 039/040 contract.

## Done criteria

- [ ] New test reproduces the exact reported failure (force-release leaves
      playback running) and passes after the fix
- [ ] `mediaType: "audio/"` literal gone from socket identity; real type threaded
- [ ] `npm run test:server`, `test:web`, `test:mobile` all exit 0
- [ ] `npm run lint` exits 0
- [ ] HTTP heartbeat/lease fallback intact (verified, not removed)
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Step-1 test passes on unmodified code (defect misdescribed — report).
- The fix requires changing the socket protocol shape (new breaking fields) —
  stop; that needs a parent-spec amendment, not improvisation.
- Background-audio work turns out to be load-bearing for correctness here
  (it isn't per review notes, but if contradicted — stop and report).
- Any step's verification fails twice after reasonable attempts.
- The dirty-tree 041 changes conflict semantically with this delta — stop and
  report rather than mixing histories.

## Maintenance notes

- After this lands, the follow-up is retiring the three 5s polling loops
  (web/mobile/desktop) in favor of socket `lease.state` — needs its own plan
  with timing-sensitive tests.
- The hardcoded-type class of bug recurs wherever socket/server translate
  media kinds — reviewers should check mime propagation on future socket work.

## Execution notes (2026-10-06)

- Baseline verification passed: mobile socket/source tests 7/7 and server
  playback/socket tests 22/22. The mobile fix was already present before this
  execution.
- Scope was then expanded at operator request to persist and propagate the
  real protected media MIME type through playback sessions and socket reports.
- Added `mediaType` to protected playback sessions and use the bound session's
  value in socket authorization/report identity; the old hardcoded `audio/`
  literal is gone.
- Full server suite: 304 tests; full web suite: 310 tests; full mobile suite:
  138 tests. Focused socket/session suite: 33 tests. Server lint and
  `git diff --check` passed.
