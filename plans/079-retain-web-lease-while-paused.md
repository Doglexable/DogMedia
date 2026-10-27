# Plan 079: Keep the web owner's exclusive lease while playback is paused

> **Executor instructions**: Follow each step and its verification gate. Update the plan row in `plans/README.md` when done. Stop on a condition below.
>
> **Drift check (run first)**: `git diff --stat 57b0f6a..HEAD -- server/src/playback-socket.js server/src/playback-socket.test.js web/src/components/GlobalPlayer.jsx web/src/components/global-player/playback-socket.test.js web/src/components/global-player/exclusive-session.test.jsx plans/054-revise-blocked-playback-websocket.md`. Compare the excerpts below with live code if anything changed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 078 (same web owner/observer state)
- **Category**: direction
- **Planned at**: commit `57b0f6a`, 2026-10-27 (reconciled after Plan 078; execute from its isolated commit because it is not yet merged into the main checkout)
- **Execution status**: DONE on 2026-10-27; scheduler seam used for liveness tests with real timers; 20 focused server and 8 web tests, full Node lint/test/build pass.

## Why this matters

The requested playback rule is that a current exclusive owner keeps its lease while paused and connected, matching Android and desktop. The previous WebSocket plan intentionally made web different: paused web sessions stop renewing and lose ownership after the lease TTL. Change that deliberate policy without weakening server stream checks; the lease still expires after the owner closes or loses connectivity long enough.

## Current state

- `server/src/playback-socket.js:160-176`: liveness refreshes a bound session only when `entry.playing || entry.identity.platform !== "web"`.
- `web/src/components/GlobalPlayer.jsx:349-378`: HTTP fallback marks a paused web lease stale and returns without heartbeating. `:380-407` reacquires a session on resume when stale. Its pause cache timer around `:1007-1028` calls `stopPlayback()` after `PAUSE_CACHE_TTL_MS`, clearing the player even while the connected owner can renew. Plan 078 added a retained observer state; do not change that observer path.
- `server/src/playback-session.js:5-13` defines the default 30-second lease TTL, configurable via `EXCLUSIVE_PLAYBACK_LEASE_SECONDS`.
- `plans/054-revise-blocked-playback-websocket.md:59-60` explicitly records the old web/native pause difference as intentional. Update that plan's maintenance note or append a supersession note; do not rewrite historical execution steps.
- Web and native owners must still stop local playback on a true `PLAYBACK_LEASE_LOST` and a forced admin takeover.

```js
// server/src/playback-socket.js:160-162
// Web intentionally lets a paused lease expire; native players retain
// their existing paused-session renewal while the foreground socket lives.
if (entry.boundSessionId && (entry.playing || entry.identity.platform !== "web")) {
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Socket tests | `npm exec --workspace=server vitest run src/playback-socket.test.js src/playback-session.test.js` | exit 0 |
| Web tests | `npm exec --workspace=web vitest run src/components/global-player/playback-socket.test.js src/components/global-player/exclusive-session.test.jsx` | exit 0 |
| Final Node gates | `npm run lint && npm test && npm run build` | all exit 0 |

## Recovery from the first stopped attempt

The first executor changed the server gate, web fallback, pause cache timer, and Plan 054 in an uncommitted isolated clone, then stopped as required after two failed focused server runs. The new server test used `vi.useFakeTimers()` around Fastify WebSocket authentication, `vi.waitFor`, ping/pong, and teardown. Its first run observed only one renewal; the next timed out at 5 seconds and an existing takeover test observed `available` instead of `owned`. The exact cause was not proven. Global fake timers spanning asynchronous socket setup and teardown are the leading test-harness suspect; do not assume a production regression or copy the unverified test unchanged.

For a fresh execution, start from clean commit `57b0f6a` and first run the focused server command as a baseline. Build the liveness regression so WebSocket authentication and close complete under real timers. A concrete test seam is an optional interval scheduler argument on `createPlaybackSocketHub` with the production default unchanged; the test captures the liveness callback and awaits each invocation manually. Pair it with a fake Redis lease clock that advances 10 seconds per callback and uses the configured lease TTL when `refreshExclusiveLease` evaluates its script. This proves ownership beyond the original 30-second expiry without globally replacing Fastify timers. Assert an accepted `playback.state` pause, repeated owner renewal, no observer renewal, and expiry after owner disconnect; manually invoke the hub notification after advancing the fake Redis clock past expiry if needed. Close sockets and `app` before restoring any mocked clock. Run the new test alone, then the full socket test file, before proceeding to web changes. Keep the production 10-second interval and protected-session TTL unchanged.

## Scope

**In scope:** the files in the drift-check command, and the status row in `plans/README.md`.

**Out of scope:** lease TTL value, Android/desktop renewal behavior, Redis key schema, admin takeover rules, observer mini-player retention (Plan 078), and public socket message shape.

## Git workflow

- Branch: `advisor/079-retain-web-lease-while-paused`.
- Commit style: `feat(playback): retain web lease during pause`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Renew any valid bound owner, including paused web

In `server/src/playback-socket.js`, remove the web-only `entry.playing` renewal gate. Keep the existing checks that the account session, protected playback session, viewer, client IP, and current lease still match before refresh. Do not renew observers or an unbound socket. Preserve the expiry notification when the socket disconnects. Update the old comment and append a dated supersession note to Plan 054.

**Verify**: socket tests command above → a paused bound web owner survives beyond one lease TTL, while an observer and a disconnected owner do not renew.

### Step 2: Keep paused web ownership during HTTP fallback

In `GlobalPlayer`, remove the pause branch that marks `leaseStaleRef` and skips the 5-second HTTP heartbeat when WebSocket is unavailable. Heartbeat while paused only in fallback mode, just as the existing effect does while playing. Retain safe recovery for genuine 401/409 loss; a successful heartbeat clears the stale marker. Resume should play the existing valid session, and a genuinely expired session should request a fresh lease before playback. Avoid a duplicate HTTP timer while the socket is healthy. Remove the automatic `stopPlayback()` on the 30-minute pause cache timer: while the owner stays connected, pause must retain media and ownership beyond that cache TTL. The server may expire its separate now-playing pause cache normally.

**Verify**: web tests command above → paused fallback renews, healthy socket emits no recurring HTTP heartbeats, forced takeover still stops playback, and the pause cache TTL does not clear the connected player's media.

### Step 3: Validate lifecycle and documentation

Extend server/client tests for pause longer than TTL, owner disconnect, forced release, reconnect, and resume. Confirm owner pause does not trigger an `available` observer event. Document the policy as: pause retains ownership while the app can renew; stop/close releases when possible; loss of connectivity lets Redis TTL expire.

**Verify**: `npm run lint && npm test && npm run build` → all exit 0.

## Test plan

Extend `server/src/playback-socket.test.js` using its fake Redis and socket timers. On web, test the fallback heartbeat state and lease-loss handling; do not assert only a comment or helper constant. Manually check web paused for more than 30 seconds while Android and desktop observe, then close web and wait for lease expiry.

## Done criteria

- [x] Paused, connected web owner remains `owned` after more than one configured lease TTL and keeps player state beyond the pause cache TTL.
- [x] A disconnected or stopped owner does not keep the lease indefinitely.
- [x] Healthy socket causes no periodic HTTP heartbeat; fallback does renew while paused.
- [x] Forced takeover and invalid session still stop local playback.
- [x] Plan 054 records the policy supersession; all Node gates exit 0.

## STOP conditions

Stop if the server cannot distinguish a bound owner from an observer, if making web renew while paused requires weakening session validation, or if a test shows unbound/revoked sockets renewing. Stop after two failed verification attempts.

## Maintenance notes

This is a product-policy change from Plan 054. Any future pause behavior must be changed consistently in socket liveness and HTTP fallback; a client-side timer alone does not own the lease when WebSocket is healthy.
