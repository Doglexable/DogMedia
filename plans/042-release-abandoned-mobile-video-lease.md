# Plan 042: Release mobile video leases when session creation finishes after unmount

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9869988..HEAD -- mobile/src/components/full-player.jsx mobile/src/api.js mobile/src/api.test.js`
> If the protected-source effect excerpt below no longer matches the live code,
> stop and report.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 041 (execute after the WebSocket lifecycle migration because both plans change mobile protected-session ownership); independent of Plan 043 local folder fallback
- **Category**: bug
- **Planned at**: commit `9869988`, 2026-10-05

## Why this matters

Mobile video playback creates its protected session asynchronously. If the user
closes or replaces the full player before that request resolves, the fulfilled
source is discarded because `cancelled` is true, but its exclusive lease is not
released. Other clients can be blocked until the lease TTL expires even though
Mobile never started playback.

## Current state

`mobile/src/components/full-player.jsx:495-507` currently does this:

```jsx
let cancelled = false;
setProtectedSource(null);
setProtectedSourceError("");
// ...
createPlaybackSessionSource(media.id, protectedQuality)
  .then((source) => { if (!cancelled) setProtectedSource(source); })
  .catch((error) => { if (!cancelled) setProtectedSourceError(error.message); });
return () => { cancelled = true; };
```

The heartbeat effect releases only a source that reached React state. A source
resolved after cleanup never reaches state and therefore never reaches that
release path. The audio path in `mobile/src/context/player-context.jsx:331-341`
is the existing safe pattern: it calls `releasePlaybackLease(source)` when its
load sequence becomes stale.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused mobile tests | `cd mobile && npm test -- --run src/api.test.js src/components/full-player-session.test.jsx` | all selected tests pass |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |
| Full mobile tests | `npm run test:mobile` | exit 0, all pass |

## Scope

**In scope**:

- `mobile/src/components/full-player.jsx`
- `mobile/src/components/full-player-session.test.jsx` (new; or the nearest
  existing full-player test file if one is introduced before execution)
- `mobile/src/api.js` only if an AbortSignal must be threaded into session creation
- `mobile/src/api.test.js` only if cancellation is added at the API layer

**Out of scope**:

- UI holder presentation (Plan 040), except where Plan 041 already migrated its transport.
- Lease ownership semantics (Plan 039).
- Audio playback sequencing; it already releases stale sources.
- Changing WebSocket heartbeat behavior or lease TTL (Plan 041 owns that transport).
- Rewriting FullPlayer.

## Git workflow

- Branch: `fix/042-mobile-video-lease-cleanup`
- Commit: `fix(mobile): release abandoned video playback lease`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Release a late protected source

Replace the one-line `.then` handler with logic that checks cancellation:

```jsx
.then((source) => {
  if (cancelled) {
    releasePlaybackLease(source);
    return;
  }
  setProtectedSource(source);
})
```

Keep cleanup idempotent. Do not release the active source from both effects in
a way that interrupts current playback; only the source that never entered
state is released here.

Optionally pass an `AbortSignal` through `createPlaybackSessionSource` to stop
the request early, but retain late-result release because the server may have
acquired the lease just before cancellation.

**Verify**: lint passes.

### Step 2: Add the async unmount regression test

Create a focused test around the protected-source effect or extract the effect
body into a narrowly scoped hook that can be tested without rendering the
entire player. Model API mocks on `mobile/src/api.test.js`.

Test these cases:

1. request resolves while mounted → source enters state, no immediate release;
2. component/effect cleans up before resolution → late source is released once;
3. request rejects after cleanup → no state update and no unhandled rejection;
4. dependency changes from media A to media B → late A source is released and B remains active.

Avoid fake production exports solely for tests unless extraction produces a
useful named hook/helper.

**Verify**: focused test command passes.

### Step 3: Run full mobile gates

Run mobile lint and the complete mobile test suite.

## Test plan

- New async cleanup test using a deferred Promise.
- Assert exact call count and source object passed to `releasePlaybackLease`.
- Preserve existing `mobile/src/api.test.js` protected-source assertions.
- No network or physical device required for automated tests.

## Done criteria

- [ ] A protected video source resolving after cleanup is released exactly once.
- [ ] The active source is not prematurely released.
- [ ] Media replacement releases only the stale source.
- [ ] Focused and full mobile tests pass.
- [ ] Mobile lint passes.
- [ ] Only in-scope files and `plans/README.md` are modified.

## STOP conditions

Stop and report if:

- FullPlayer session ownership has moved into player context.
- Expo's fetch cancellation can guarantee the server never acquires a lease;
  document proof before omitting the late-release guard.
- The only feasible test requires a physical Android device.
- Plan 041 is being executed concurrently in the same worktree; finish the
  WebSocket migration first, then re-run this plan's drift check before editing
  the overlapping `full-player.jsx` lifecycle.

## Maintenance notes

- Abort and release solve different races: abort limits work, while release
  cleans up a lease the server may already have granted.
- Any future protected-source hook for photos/videos should own both heartbeat
  and release in one place.
- Reviewers should look for duplicate release calls; server release is guarded,
  but clear client ownership is easier to maintain.
