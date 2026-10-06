# Plan 041: Push exclusive playback ownership and position over WebSocket

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9869988..HEAD -- server/package.json package-lock.json server/src/index.js server/src/playback-session.js server/src/routes/media.js server/src/routes/playback.js web/nginx.conf web/src/api.js web/src/components/GlobalPlayer.jsx mobile/src/api.js mobile/src/context/player-context.jsx mobile/src/components/full-player.jsx desktop/Cargo.toml desktop/Cargo.lock desktop/src/api/ desktop/src/domain/playback.rs desktop/src/playback/coordinator.rs desktop/src/ui/mod.rs README.md`
> Plans 039 and 040 are currently present as working-tree changes on
> `feat/040-exclusive-session-holder-ui`, so the commit-only drift command is
> not sufficient by itself. Before editing, also run `git diff -- <in-scope
> paths>` and confirm the current-state excerpts and the safe holder contract
> below still match. This plan must be executed only after Plans 039 and 040
> have landed or their exact changes are present in the executor's worktree.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 039 and 040
- **Category**: architecture / performance
- **Planned at**: commit `9869988`, 2026-10-05

## Why this matters

Exclusive playback currently discovers takeover and remote position changes
through independent five-second HTTP timers. Even with correct ownership
validation, the previous owner may keep playing until its next heartbeat and
an observer mini player can remain stale for the same interval. Moving only the
heartbeat request onto a socket would not fix that delay; the server must push
lease transitions and playback snapshots as events.

After this plan, one authenticated WebSocket channel per client carries lease
liveness, immediate owner-revocation notices, and safe playback snapshots.
Web, mobile, and desktop stop their five-second heartbeat/status polling while
the socket is healthy. Redis remains the source of truth, and the existing HTTP
routes remain temporarily available as a reconnect/rolling-deployment fallback.

## Current state

Relevant files and behavior:

- `server/src/playback-session.js` owns the atomic Redis lease. Ownership is
  `viewerId + sessionId + clientIp`; keep that invariant unchanged.
- `server/src/routes/playback.js:757-816` exposes HTTP heartbeat, release,
  status, and force-release routes. `GET /lease` returns the safe holder plus
  the canonical `playback:active:<viewerId>` snapshot.
- `server/src/routes/media.js:1212-1269` creates a protected session, acquires
  the exclusive lease, and returns `sessionId`/`viewerId` only to the owner.
- `web/src/components/GlobalPlayer.jsx:287-315` calls the heartbeat route every
  five seconds. Its observer path at `:522-563` separately polls lease status
  every five seconds.
- `mobile/src/context/player-context.jsx:420-444` does the same for audio, and
  `mobile/src/components/full-player.jsx:524-544` repeats it for video. The
  observer path at `player-context.jsx:523-572` is another five-second poll.
- `desktop/src/ui/mod.rs:402-414` runs an unconditional five-second task;
  `heartbeat` at `:989-1050` either refreshes the owner lease or polls the
  holder and reports position.
- `web/nginx.conf` proxies `/api/` as ordinary HTTP and does not forward
  `Upgrade`/`Connection` headers.
- No WebSocket server dependency exists in `server/package.json`, and no Rust
  WebSocket client dependency exists in `desktop/Cargo.toml`. Browser and
  React Native provide a global `WebSocket` API.

Current timer pattern (web; mobile and desktop are equivalent):

```jsx
const interval = window.setInterval(heartbeat, 5_000);
return () => window.clearInterval(interval);
```

Current server renewal remains the authority and must be reused, not copied:

```js
const refreshed = await refreshExclusiveLease(redis, viewerId, sessionId, clientIp);
if (!refreshed.refreshed) {
  // PLAYBACK_LEASE_LOST with safe activeSession
}
```

The public payload must continue to contain only `platform`, `deviceLabel`,
`mediaId`, `expiresIn`, and the safe nested playback snapshot. Never broadcast
`viewerId`, `sessionId`, `clientIp`, Redis keys, or a socket ticket.

## Target protocol and lifecycle

Use one versioned JSON protocol. Keep message parsing in small pure functions
with exhaustive tests.

Client to server:

```text
auth             { type, version: 1, ticket }
session.bind     { type, version: 1, sessionId }
playback.state   { type, version: 1, sessionId, mediaId, action,
                   position, duration, loopMode, shuffleEnabled, sequence }
```

Server to client:

```text
socket.ready     { type, version: 1 }
lease.state      { type, version: 1, revision, state, expiresIn,
                   activeSession? }
protocol.error   { type, version: 1, code, message }
```

`lease.state` is the single client input for `available | owned | busy`.
`activeSession` uses the Plan 039/040 safe holder shape, including its optional
playback snapshot. A forced takeover/release/acquisition must emit it in the
same request turn that changes Redis; clients must not wait for a timer.

Authentication handshake:

1. Add `POST /api/playback/socket-ticket`. It uses the existing IP whitelist
   hook and `readViewerId`/`resolveViewerId`, normalizes platform/device label,
   and creates a cryptographically random, single-use ticket valid for at most
   30 seconds.
2. Store only a SHA-256 digest in Redis under a dedicated ticket key; the value
   contains viewer ID, client IP, access tier, platform, and normalized label.
3. Open `/api/playback/socket` without query credentials. The first socket
   message must be `auth`; atomically consume the ticket and require the socket
   IP to match. An unauthenticated socket receives no state and closes after a
   short timeout.
4. Do not put viewer/session IDs or tickets in URLs or logs. Validate browser
   `Origin` against the same configured origins used by CORS; native clients
   may omit `Origin`.

Liveness and renewal:

- The server sends WebSocket ping frames every 10 seconds and requires a pong
  before the next liveness deadline. Browsers answer protocol pings
  automatically; clients do not need a JavaScript heartbeat interval.
- `session.bind` validates the protected session against the ticket-bound
  viewer and socket IP. While that socket remains alive and still owns the
  bound lease, the server refreshes it through `refreshExclusiveLease` on the
  server liveness cycle. Do not refresh a lease merely because an observer
  socket is connected.
- On socket loss, stop renewal but do not immediately release the lease; retain
  the existing Redis TTL grace for transient network changes. Use a rescheduled
  expiry timer plus a Redis re-check to emit `available` when the lease really
  expires—do not add another client polling loop.
- Owner `playback.state` messages are accepted only after exact
  `viewerId + sessionId + clientIp + mediaId` validation. Reuse the same
  authorization and Redis snapshot writer used by HTTP `/active` so WebSocket
  and compatibility HTTP paths cannot diverge.
- Push discrete play/pause/seek/media/loop/shuffle changes immediately. During
  playback, publish from existing media progress callbacks with a maximum rate
  of one state message per second; do not create a second progress timer.
- A client-side observer may interpolate a playing position from `updatedAt`
  for smooth UI, but every received canonical snapshot replaces that estimate.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server focused tests | `cd server && npm test -- --run src/playback-socket.test.js src/routes/playback.test.js src/routes/media.test.js src/playback-session.test.js` | all selected tests pass |
| Web focused tests | `cd web && npm test -- --run src/api.test.js src/components/global-player/playback-socket.test.js src/components/global-player/exclusive-session.test.jsx` | all selected tests pass |
| Mobile focused tests | `cd mobile && npm test -- --run src/api.test.js src/utils/playback-socket.test.js src/utils/exclusive-session.test.js` | all selected tests pass |
| Desktop focused tests | `cargo test --manifest-path desktop/Cargo.toml playback_socket` | new protocol/reconnect tests pass |
| JavaScript gates | `npm run lint && npm run test && npm run build` | exit 0; all suites/build pass |
| Desktop gates | `cargo fmt --manifest-path desktop/Cargo.toml --all -- --check && cargo test --manifest-path desktop/Cargo.toml && cargo clippy --manifest-path desktop/Cargo.toml --all-targets -- -D warnings` | exit 0 |
| Desktop release | `npm run build:desktop` | optimized binary produced |
| Proxy syntax | `podman run --rm -v "$PWD/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro,Z" nginx:stable-alpine nginx -t` | syntax successful |

## Scope

**In scope** (the only implementation areas to modify):

- `server/package.json`, root `package-lock.json` — add the Fastify-compatible
  WebSocket plugin.
- `server/src/index.js` — register the plugin before playback routes.
- `server/src/playback-socket.js` and tests (new) — protocol parsing, ticket
  authentication, connection registry, ping/pong liveness, safe broadcasts.
- `server/src/playback-live-state.js` and tests (new, if extraction is needed)
  — shared report authorization, snapshot normalization/storage, public state.
- `server/src/playback-session.js` and tests — ticket key helpers or atomic
  ticket consumption; keep lease Lua ownership semantics unchanged.
- `server/src/routes/media.js` and `server/src/routes/playback.js` — issue
  tickets and notify the realtime hub on acquire/release/takeover/HTTP fallback
  updates.
- `web/nginx.conf` — a dedicated exact/prefix socket location with HTTP/1.1,
  Upgrade/Connection forwarding, long read timeout, buffering off, and access
  logging disabled for the handshake.
- `web/src/api.js`, `web/src/components/GlobalPlayer.jsx`, and a new
  `web/src/components/global-player/playback-socket.js` plus tests.
- `mobile/src/api.js`, `mobile/src/context/player-context.jsx`,
  `mobile/src/components/full-player.jsx`, and a new
  `mobile/src/utils/playback-socket.js` plus tests.
- `desktop/Cargo.toml`, `desktop/Cargo.lock`, `desktop/src/api/`,
  `desktop/src/domain/playback.rs`, `desktop/src/playback/coordinator.rs`,
  `desktop/src/ui/mod.rs`, and focused tests — add one async WebSocket owner
  and typed protocol events.
- `README.md` — document the socket endpoint, proxy requirement, fallback,
  and operational behavior.
- `plans/README.md` status row only when execution finishes.

**Out of scope**:

- Replacing Redis as the authoritative lease/snapshot store.
- Changing the 30-second exclusive lease duration or ownership tuple.
- Removing HTTP heartbeat/status endpoints in the same release. They are a
  compatibility and reconnect fallback; removal needs telemetry and a later
  plan.
- Sending historical Wrapped events over the socket. `/playback/event`
  remains durable HTTP behavior; only live state/lease traffic moves.
- General-purpose chat/notification sockets, Redis keyspace notifications,
  Socket.IO, GraphQL subscriptions, or a second queue/player implementation.
- Multi-server horizontal fan-out. Current Compose runs one Fastify server;
  if multiple server replicas are required, stop and design Redis Pub/Sub
  fan-out before implementing an in-memory connection registry.

## Git workflow

- Branch: `feat/041-realtime-playback-websocket`
- Commit style: `feat(playback): push exclusive session state over websocket`
- Do not push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add protocol primitives and one-use socket tickets

Add the compatible WebSocket dependency and register it before the protected
route group. Implement strict message parsing: known `type`, protocol version
1, finite/bounded numeric fields, maximum message size 8 KiB, and no unknown
state mutation. Close unauthenticated, malformed, oversized, or excessively
chatty connections with a documented application close code.

Create the ticket endpoint and atomic consume helper. Ticket tests must prove:

1. ticket is random, expires, and is single-use;
2. Redis stores a digest rather than the raw ticket;
3. a different source IP cannot use it;
4. no ticket/viewer/session/IP appears in a public event or log fixture;
5. unwhitelisted requests cannot obtain a ticket or upgrade successfully.

**Verify**: run the focused server tests; the new ticket/protocol tests pass.

### Step 2: Build the server realtime hub around Redis authority

Implement a small hub owned by Fastify lifecycle hooks:

- register/unregister authenticated sockets;
- send the current `lease.state` immediately after authentication;
- validate and bind an owner session;
- ping, track pong, and refresh only a still-current bound owner lease;
- broadcast a safe state after acquire, release, forced takeover, owner state
  update, lease loss, and verified TTL expiry;
- close all sockets/timers cleanly in `onClose` so tests and shutdown do not
  leak handles;
- honor socket backpressure: coalesce replaceable position snapshots and close
  persistently slow consumers instead of growing an unbounded buffer.

Extract the current `/active` authorization/storage code only if necessary so
HTTP and socket paths call the same function. Preserve the `PLAYBACK_NOT_OWNER`
semantics for HTTP and use a typed `protocol.error` followed by a fresh
`lease.state` for a rejected socket writer.

Use a hub revision per state transition. Client-provided `sequence` only
orders messages within one bound session; reject a sequence lower than the
last accepted sequence so delayed frames cannot move position backward.

**Verify**: server socket integration tests prove initial state, immediate
takeover notification without advancing fake time, exact-owner writes,
out-of-order rejection, pong renewal, disconnect grace, TTL availability, and
safe payload shape.

### Step 3: Wire acquisition/release paths and reverse proxy

Notify the hub only after the corresponding Redis mutation succeeds:

- session acquisition/rotation in `routes/media.js`;
- normal release and admin force release in `routes/playback.js`;
- successful compatibility `/active` updates so a legacy owner still updates
  new observer clients.

Configure `web/nginx.conf` for WebSocket upgrade on the socket endpoint. Keep
the existing trusted real-IP headers exactly aligned with `/api/`; otherwise a
socket and its HTTP session may appear to come from different IPs. Verify both
direct Fastify (`ws://127.0.0.1:3001`) and Nginx/Apache (`wss://public-host`)
paths. Apache 2.4.47+ can upgrade through `mod_proxy_http`; if the deployed
version cannot, document and add the minimal `mod_proxy_wstunnel` rule.

**Verify**: Nginx syntax passes and an integration client receives the initial
state through the proxy with the same normalized client IP as HTTP.

### Step 4: Migrate Web to event-driven ownership

Create one socket service/hook with explicit states
`connecting | ready | reconnecting | closed`. It must:

- obtain a ticket through credentialed HTTP, convert same-origin `http/https`
  to `ws/wss`, authenticate, and reconnect with jittered exponential backoff
  (0.5s, 1s, 2s, then capped at 5s);
- bind each newly created protected session;
- feed every `lease.state` into the existing normalized conflict/observer
  state so mini-player rendering remains unchanged;
- pause and clear the local stream immediately when an event says another
  holder owns the lease;
- publish immediate discrete changes and throttled progress through existing
  media events;
- remove the healthy-socket heartbeat interval and observer `getPlaybackLease`
  timer from `GlobalPlayer.jsx`.

During `reconnecting`, temporarily use the existing HTTP heartbeat for an
owner and `GET /lease` for an observer. Stop those timers immediately when the
socket is ready to guarantee one live transport, not duplicate reporters.

**Verify**: fake-WebSocket tests cover auth, bind, immediate revoke, observer
snapshot, reconnect/backoff, fallback activation/deactivation, unmount cleanup,
and exactly one active connection under React Strict Mode.

### Step 5: Migrate Mobile with one shared audio/video socket

Place the socket owner in `PlayerProvider`, not `FullPlayer`, so navigation
between mini/full player does not create a second connection. FullPlayer video
must consume the provider's state and bind its protected source through the
same channel used by audio.

Use `AppState` and network connectivity deliberately:

- foreground + connected: socket is primary;
- reconnecting: HTTP fallback as in Web;
- background audio: verify whether Expo keeps the socket and JS callbacks
  alive on both Android and iOS. If the platform suspends sockets while audio
  continues, retain the existing HTTP renewal only for that background mode
  and document the exception; never run both transports concurrently;
- background video/paused app: stop the socket or leave it unbound according
  to existing playback behavior, without silently renewing an abandoned lease.

Do not absorb Plan 042's late async source cleanup; execute that plan after
this migration against the new lifecycle.

**Verify**: unit tests cover one socket for audio/video, foreground revoke,
observer synchronization, reconnect fallback, AppState transitions, and no
state updates after provider teardown. Perform Android/iOS background-audio
acceptance where available and record any platform-specific fallback.

### Step 6: Migrate Desktop to a typed async socket task

Add a maintained Tokio-compatible WebSocket dependency with rustls support;
do not introduce an OpenSSL runtime requirement. Implement the protocol in a
new API module with serde-tagged enums. A single Tokio task owns the socket,
reconnect/backoff, and outgoing bounded channel; it sends typed events into the
existing Dioxus state path.

Replace only the five-second lease/observer loop. Keep the existing 100 ms
local engine/MPRIS tick; throttle socket position publication from that tick
without adding another timer. On remote ownership, pause GStreamer immediately
and call the existing `apply_remote_holder`/coordinator path. During reconnect,
use the existing HTTP heartbeat/status behavior until the socket is ready.

**Verify**: Rust tests use a local test socket to cover protocol parsing,
reconnect, immediate revocation, bounded outgoing state coalescing, and clean
task shutdown. Full cargo gates pass.

### Step 7: Cross-client acceptance and rollout safety

Run this matrix through Nginx (and Apache if production uses it):

1. Start Web playback; Desktop and Mobile receive the same media/position in
   their mini players without issuing `GET /lease` every five seconds.
2. Force takeover on Mobile; Web pauses and locks controls immediately, before
   the former heartbeat interval would have elapsed.
3. Repeat Desktop → Web and Web → Desktop takeover.
4. Seek, pause, resume, change loop/shuffle, and change media; observers update
   immediately for discrete changes and within one second for position.
5. Disconnect/reconnect Wi-Fi: no dual owner, no duplicate active snapshot,
   and HTTP fallback stops after socket recovery.
6. Kill the owner process/network without release: lease survives transient
   loss, then becomes available only after the Redis TTL.
7. Restart Fastify while clients play: clients reconnect, re-authenticate, and
   converge on Redis state without exposing protected IDs.

Add counters/log fields for connection count, auth rejection, reconnect,
protocol error, and slow consumer, but never log ticket/session/viewer/IP
payload values beyond the existing normalized request metadata policy.

**Verify**: all JavaScript/Rust gates and desktop release build pass; browser
network inspection shows no recurring heartbeat or lease-status HTTP requests
while the socket is healthy.

## Test plan

- Server unit/integration tests: ticket security, handshake timeout, origin/IP
  checks, message schema/size/rate limits, lease bind, renewal, expiry, release,
  force takeover, stale sequence, backpressure, and shutdown cleanup.
- Web: fake socket state machine plus GlobalPlayer regression tests for owner,
  observer, takeover, reconnect fallback, and Strict Mode cleanup.
- Mobile: shared provider socket tests for audio/video, AppState/network
  transitions, observer sync, and teardown races.
- Desktop: serde protocol fixtures, local socket integration, bounded channel,
  reconnect, coordinator application, and task cancellation.
- Compatibility: existing HTTP playback route tests remain green and a legacy
  HTTP `/active` update is broadcast to socket observers.
- Manual latency assertion: record timestamps around force-release response and
  old-owner pause; target same-LAN propagation under 500 ms and never wait for
  the former five-second interval.

## Done criteria

- [ ] Healthy web, mobile, and desktop clients make no periodic HTTP lease
      heartbeat or observer-status requests.
- [ ] Forced takeover/release/acquisition reaches every connected client as a
      pushed `lease.state` event, with same-LAN target latency under 500 ms.
- [ ] Only the exact bound owner can renew or publish state; a duplicate device
      cannot overwrite the owner snapshot.
- [ ] Observer mini players show canonical media/state and position updates no
      more than one second old during playback.
- [ ] No public event/log contains viewer ID, session ID, client IP, Redis key,
      or ticket.
- [ ] Redis remains authoritative across server restart and socket reconnect.
- [ ] HTTP routes work as reconnect/rolling-version fallback, with exactly one
      transport active per client.
- [ ] Nginx and documented Apache proxy paths pass WebSocket upgrade.
- [ ] Full npm tests/lint/web build and Cargo fmt/test/clippy/release build pass.
- [ ] Only in-scope implementation files and `plans/README.md` are modified.

## STOP conditions

Stop and report instead of improvising if:

- Plans 039/040 are absent or the lease/public-holder contract differs from
  this plan.
- Production runs more than one Fastify server replica. An in-memory hub would
  miss cross-process events; design Redis Pub/Sub fan-out as a prerequisite.
- Browser authentication would require putting a persistent viewer/session ID
  in the WebSocket URL. Use the one-use first-message ticket design instead.
- `@fastify/websocket` cannot run the existing auth hooks before/around upgrade
  under Fastify 5.
- Mobile background audio cannot keep either the socket or a safe mutually
  exclusive fallback alive; report platform evidence and split background
  playback into a follow-up design.
- Desktop WebSocket support requires OpenSSL or conflicts with the existing
  Tokio/runtime versions; select a rustls-compatible crate or stop.
- A step requires weakening IP whitelist checks, exposing protected identity,
  releasing immediately on ordinary network loss, or changing the lease TTL.
- Proxy upgrade cannot preserve the same trusted client IP as ordinary HTTP.

## Maintenance notes

### Review of the isolated execution attempt (2026-10-05)

An uncommitted implementation is preserved at `/tmp/pfs-041-U6KqO7/repo`.
It passed the full JavaScript test suite, JavaScript lint, Web build, Cargo
format, full Cargo tests, and Cargo clippy after restoring local dependencies.
It is **not approved**. Before merging or marking this plan DONE, a separate
executor must address these review findings and rerun the gates:

- Mobile `PlayerProvider` registers `onLease` but not `onError` in its socket
  service (`mobile/src/context/player-context.jsx`). On admin force release,
  the server emits `PLAYBACK_LEASE_LOST` followed by `lease.state: available`.
  Mobile currently clears conflict text without stopping its active player.
  Handle revocation by pausing audio/video, clearing the protected source,
  and preventing further owner reports. Add a regression test for this exact
  event sequence.
- Prove background audio behavior on Android and iOS, or retain an explicitly
  exclusive HTTP renewal fallback when the background socket/JS runtime is
  suspended. A foreground-only AppState handler does not prove lease renewal
  during background audio.
- Add tests for observer renewal exclusion, disconnect/TTL availability,
  reconnect fallback exclusivity, and desktop reconnect/task shutdown. The
  current tests cover protocol and some takeover cases but not all done
  criteria above.
- A clean desktop checkout cannot compile because
  `desktop/vendor/dioxus-native/src/contexts.rs` exists locally but is ignored
  by `.gitignore` pattern `*context*.*`. This is pre-existing and outside this
  plan's scope; resolve it separately before claiming a reproducible build.

- HTTP heartbeat/status routes are intentionally retained for compatibility.
  Remove them only after deployed-client version telemetry shows no legacy use.
- The in-memory hub is correct only for the current single Fastify process. A
  second server replica requires Redis Pub/Sub (one channel carrying already
  sanitized state) and duplicate/revision handling.
- WebSocket presence is transport liveness, not authorization. Every owner
  mutation must still revalidate Redis session and lease ownership.
- Keep transport state separate from player state: socket reconnect must not
  create a second queue, player, or optimistic owner.
- Plan 042 follows this plan because mobile protected-source teardown overlaps
  the new shared socket lifecycle. Plan 043 and Plan 044 remain independent of
  realtime playback except for normal execution ordering.
