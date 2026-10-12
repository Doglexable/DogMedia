# Plan 063: Reuse one playback snapshot for each socket broadcast

> **Executor instructions**: Follow this plan step by step. Preserve the current
> WebSocket protocol and delivery semantics. Stop if the proposed shared
> snapshot would change which clients receive a lease update.
>
> **Drift check (run first)**: `git diff --stat c26a4d4..HEAD -- server/src/playback-socket.js server/src/playback-socket.test.js server/src/playback-live-state.js`
> If an in-scope file changed after this plan was written, compare the current
> state below with the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/054-revise-blocked-playback-websocket.md (DONE; it delivered the usable revision of the blocked Plan 041 socket)
- **Category**: perf
- **Planned at**: commit `c26a4d4`, 2026-10-12

## Why this matters

The socket accepts progress snapshots at up to one per second. Each accepted
snapshot invokes `notify()`. That function obtains the lease once, then
`stateFor()` calls `publicHolderWithPlayback()` separately for every connected
socket; each call reads the same Redis active-playback key. With N connected
clients, a single progress update therefore causes N redundant reads of the
same snapshot, in addition to the required N socket sends. Compute the shared
public holder once per broadcast and preserve the per-client ownership state.

## Current state

- `server/src/playback-socket.js` defines `stateFor(entry, lease)` at lines
  60–72. It calls `publicHolderWithPlayback(redis, lease, lease.expiresIn)`.
- `notify()` at lines 89–105 reads the lease once, then maps over all sockets
  and calls `stateFor()` for each.
- The `playback.state` handler at lines 199–216 validates and stores each
  snapshot and calls `notify()`.
- `publicHolderWithPlayback()` in `server/src/playback-live-state.js` performs
  a Redis `GET` for the holder's active snapshot and normalizes it for clients.
- `server/src/playback-socket.test.js` has fake Redis state and authenticated
  socket fixtures; preserve the current `lease.state` payload and revision
  semantics.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm run test:server -- playback-socket.test.js` | socket tests pass |
| Full suite | `npm run test:server` | all server tests pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/playback-socket.js`
- `server/src/playback-socket.test.js`
- `plans/README.md` (status only)

**Out of scope**:

- WebSocket message names, fields, revisions, auth, or client implementations.
- Playback state write frequency or one-second client progress throttle.
- Suppressing observer updates or changing lease expiry scheduling.
- Refactoring `server/src/playback-live-state.js` unless the shared holder
  requires a minimal call-site adjustment.

## Git workflow

- Branch: `advisor/063-reuse-playback-snapshot-per-socket-broadcast`
- Commit style: `perf(server): reuse playback snapshot across socket broadcast`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Compute the holder snapshot once per broadcast

Change `stateFor` to accept the already computed public holder (or `null`)
alongside the lease and socket entry. In `notify()`, call
`publicHolderWithPlayback()` once after reading the lease, then reuse its result
for all connected entries while retaining the current owner/busy/available
calculation per entry. Keep the message payload and send order unchanged.
Handle the no-lease case without a Redis active-playback read. The other
`stateFor` call sites (initial authentication, bind success/rejection, and
rejected playback state) are single-recipient sends: compute their holder
once for that send and preserve the current response payload.

**Verify**: `npm run test:server -- playback-socket.test.js` → existing
available/owned/busy and playback snapshot assertions pass.

### Step 2: Assert Redis reads do not scale with socket count

Extend the fake Redis fixture with a count for the active-playback-key `GET`.
Create or authenticate multiple socket clients, trigger one accepted progress
message, and assert that the public active snapshot is read once for the
broadcast while each client still receives its expected `lease.state` event.
Keep assertions independent of unrelated lease/session reads.

**Verify**: `npm run test:server -- playback-socket.test.js` → the new
multi-client regression test passes and existing tests remain green.

### Step 3: Check the server suite and style

Run the complete server test and lint commands.

**Verify**: `npm run test:server && npm run lint --workspace=server` → exit 0.

## Test plan

- Cover one and multiple socket recipients.
- Confirm each still receives the correct owner/busy/available state and shared
  current playback snapshot.
- Confirm per-client owner status still differs correctly for the lease owner.
- Follow the fake Redis and socket patterns in
  `server/src/playback-socket.test.js`.

## Done criteria

- [ ] `publicHolderWithPlayback()` is invoked no more than once by one
  `notify()` call.
- [ ] Every client receives the same public holder snapshot as before.
- [ ] Per-client ownership status and revision behavior are unchanged.
- [ ] Focused socket tests, full server tests, and server lint pass.
- [ ] No client protocol or playback timing changes are included.
- [ ] The Plan 063 status row in `plans/README.md` is updated.

## STOP conditions

- Stop if clients rely on a per-socket holder lookup that can return distinct
  data within a single broadcast.
- Stop if tests show that sharing the public holder changes any client payload
  or ownership classification.
- Stop if reducing Redis reads requires changing the protocol or rate limit.

## Maintenance notes

One shared snapshot is appropriate because all sockets in a `notify()` call
observe the same global lease and active-playback record. If the server later
supports more than one independent lease, group sockets by lease/snapshot key
before sharing data; do not reuse one holder across independent leases.
