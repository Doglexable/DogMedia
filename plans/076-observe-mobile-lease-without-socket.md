# Plan 076: Show the remote playback owner on Android while the socket is unavailable

> **Executor instructions**: Follow each step and its verification gate. Update the plan row in `plans/README.md` when done. Stop on a condition below.
>
> **Drift check (run first)**: `git diff --stat d5c1d9e..HEAD -- mobile/src/context/player-context.jsx mobile/src/utils/lease-status-poller.js mobile/src/utils/lease-status-poller.test.js`. Compare the excerpts below with live code if anything changed.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d5c1d9e`, 2026-10-27

## Why this matters

Android learns about an existing remote lease immediately through WebSocket, but its HTTP fallback only starts after `playbackConflict` is already set. On a fresh launch with WebSocket unavailable, the mini player stays empty until the user attempts play and receives a conflict. Polling lease status during socket outage makes the observer display work on first load and after reconnect failures.

## Current state

- `mobile/src/context/player-context.jsx:554-595` handles `lease.state` `busy`/`available` and copies the safe owner snapshot into player state.
- `mobile/src/context/player-context.jsx:635-686` defines `const observingExclusiveSession = Boolean(playbackConflict)` and returns early from HTTP polling unless that value is true and `socketStatus !== "ready"`.
- `mobile/src/api.js:169-175` already provides `getPlaybackLease()` with normalized `available | owned | busy` and safe holder metadata. `mobile/src/utils/playback-socket.test.js` shows the existing Vitest fake socket style.
- JavaScript files use kebab-case names, hooks remain in the provider, and HTTP calls go through `mobile/src/api.js` (see `AGENTS.md` and `mobile/README.md`).

```jsx
// mobile/src/context/player-context.jsx:635-639
const observingExclusiveSession = Boolean(playbackConflict);
useEffect(() => {
  if (!observingExclusiveSession || socketStatus === "ready") return undefined;
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm exec --workspace=mobile vitest run src/utils/lease-status-poller.test.js src/utils/playback-socket.test.js src/utils/exclusive-session.test.js` | exit 0, all tests pass |
| Mobile suite | `npm run test:mobile` | exit 0 |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |

## Scope

**In scope:** `mobile/src/context/player-context.jsx`, new `mobile/src/utils/lease-status-poller.js`, new `mobile/src/utils/lease-status-poller.test.js`, and the status row in `plans/README.md`.

**Out of scope:** server lease semantics, socket protocol, takeover tier, media stream requests, offline playback, web, and desktop.

## Git workflow

- Branch: `advisor/076-observe-mobile-lease-without-socket`.
- Match recent conventional commits, e.g. `fix(mobile): observe lease while playback socket reconnects`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a cancellable HTTP lease observer

Create `lease-status-poller.js` as a small timer controller that accepts an async `getStatus`, an `onStatus`, and a 5-second interval. It must perform an immediate read, schedule the next read only after completion (no overlapping requests), ignore an in-flight result after `stop()`, tolerate transient failures, and stop scheduling after `stop()`.

**Verify**: focused Vitest command above → new tests for immediate read, retry after failure, no overlapping reads, and ignored late response pass.

### Step 2: Use the observer whenever the socket is not ready

In `PlayerProvider`, replace the conflict-only polling effect with one active while `offline.isConnected && socketStatus !== "ready"`. Route `busy` through the same `leaseHandlerRef.current` used by WebSocket. Route `available` through that handler; `owned` must leave local playback and conflict state alone. Stop the controller when the socket becomes ready, the connection goes offline, or the provider unmounts. Keep current behavior that observers do not acquire a lease automatically.

**Verify**: `npm run test:mobile` → all pass; `npm run lint --workspace=mobile` → exit 0.

## Test plan

Use fake timers and deferred promises as in `mobile/src/utils/playback-socket.test.js` and `mobile/src/components/full-player-session.test.jsx`. Cover fresh launch `busy`, `available`, `owned`, network failure, in-flight response after socket readiness, and stop cleanup. The provider should consume the tested controller instead of duplicating its timing logic.

## Done criteria

- [ ] With a disconnected socket, an immediate HTTP `busy` status reaches the existing observer handler without first attempting playback.
- [ ] Healthy socket state causes zero recurring HTTP lease reads.
- [ ] Late fallback responses cannot replace a newer WebSocket state.
- [ ] Focused and full mobile tests plus lint exit 0; only in-scope files change.

## STOP conditions

Stop if the live provider no longer has the cited conflict-only fallback, the socket and HTTP status shapes diverge, or a source change outside the scope is needed. Stop after two failed verification attempts and report the exact failure.

## Maintenance notes

The fallback must remain secondary to the authenticated WebSocket. Check the timer's cleanup whenever `socketStatus` or `offline.isConnected` semantics change.
