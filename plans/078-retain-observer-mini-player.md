# Plan 078: Preserve the observer mini player across exclusive-lease transitions

> **Executor instructions**: Follow each step and its verification gate. Update the plan row in `plans/README.md` when done. Stop on a condition below.
>
> **Drift check (run first)**: `git diff --stat b02eb4e..HEAD -- desktop/src/playback/coordinator.rs desktop/src/ui/mod.rs desktop/src/ui/views/player_bar.rs desktop/src/ui/views/video_mini_player.rs desktop/tests/playback_state.rs web/src/components/GlobalPlayer.jsx web/src/components/global-player/exclusive-session.js web/src/components/global-player/exclusive-session.test.jsx mobile/src/context/player-context.jsx mobile/src/components/full-player.jsx mobile/src/components/full-player-session.test.jsx mobile/src/utils/exclusive-session.js mobile/src/utils/exclusive-session.test.js mobile/src/utils/lease-status-poller.js mobile/src/utils/lease-status-poller.test.js`. Compare the excerpts below with live code if anything changed.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plan 076 (same mobile provider), Plan 077 (same web/server observer identity)
- **Category**: bug
- **Planned at**: commit `b02eb4e`, 2026-10-27 (reconciled after Plans 076 and 077 merged)

## Why this matters

The product requirement is that a device without the exclusive playback lease can still show a mini player with the remote media and last known position. In particular, desktop currently clears `media`, position, and duration when a `lease.state = available` arrives; a forced takeover briefly emits `available` before the new owner acquires the lease, so its mini player disappears. Web also clears observed media on `available`. Preserve the visible snapshot through those transitions without starting playback or taking ownership automatically.

## Current state

- `desktop/src/playback/coordinator.rs:182-192` `remote_available()` sets status to `Idle`, clears `media`, position and duration. `:194-224` `observe_remote()` otherwise stores holder media and progress. `desktop/src/ui/mod.rs:780-786`, `:739-740`, and `:2008-2010` call `remote_available` on socket/fallback transitions.
- `desktop/src/ui/views/player_bar.rs:6-12` renders nothing if `media` is absent. Its controls are disabled while `session_unavailable`; `desktop/src/ui/mod.rs` `set_playback_playing` plays an existing engine, so a retained snapshot with no session needs an explicit fresh-session play path. Desktop `ui/mod.rs` also gained unrelated window geometry/password UI work after the original plan; preserve it.
- `web/src/components/GlobalPlayer.jsx:573-587` clears observed media on socket `available`/`owned`, and `:741-747` does the same in HTTP fallback. The effect at `:244-295` automatically creates a session when `observingExclusiveSession` becomes false; retaining media requires a separate no-session state to prevent automatic acquisition.
- `mobile/src/context/player-context.jsx` clears conflict on `available` but retains `currentMedia`; it stores `revokedSessionId` after loss and restarts audio when source is absent. Video source loading in `mobile/src/components/full-player.jsx:518-536` depends on media and `controlsLocked`, so unlocking a retained video may auto-acquire. Plan 076 added `mobile/src/utils/lease-status-poller.js` and a provider effect at about `:636-655`; its stop check protects the initial HTTP response, but an already-running asynchronous holder fetch also needs to respect newer socket state.
- Existing tests: `desktop/tests/playback_state.rs:151-166` asserts the old `remote_available` clearing behavior; `web/src/components/global-player/exclusive-session.test.jsx` covers observer UI; `mobile/src/utils/exclusive-session.test.js` covers holder normalization.

```rust
// desktop/src/playback/coordinator.rs:182-191
pub fn remote_available(&mut self) {
    if self.snapshot.session_unavailable {
        self.snapshot.status = PlaybackStatus::Idle;
        self.snapshot.media = None;
        self.snapshot.position = 0.0;
        self.snapshot.duration = 0.0;
        self.snapshot.session_unavailable = false;
        self.snapshot.holder = None;
        self.snapshot.error = None;
    }
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Desktop state tests | `cargo test --manifest-path desktop/Cargo.toml --test playback_state` | exit 0 |
| Desktop native tests | `npm run test:desktop:native` | exit 0 |
| Web focused tests | `npm exec --workspace=web vitest run src/components/global-player/exclusive-session.test.jsx src/components/global-player/mini-player.test.jsx` | exit 0 |
| Mobile focused tests | `npm exec --workspace=mobile vitest run src/utils/exclusive-session.test.js src/components/full-player-session.test.jsx src/utils/lease-status-poller.test.js` | exit 0 |
| Final gates | `npm run lint && npm test && npm run build && npm run test:desktop:native` | all exit 0 |

## Scope

**In scope:** the files in the drift-check command and the status row in `plans/README.md`. Add focused tests in those listed test files. Preserve all unrelated window and settings changes in `desktop/src/ui/mod.rs`.

**Out of scope:** Redis lease TTL, takeover authorization, stream API schema, offline media playback, unrelated player redesign, and automatic takeover.

## Git workflow

- Branch: `advisor/078-retain-observer-mini-player`.
- Commit style: `fix(playback): keep observer mini player across lease transitions`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make the observer state explicit

Define these states in each player without changing the wire protocol: (a) local owner with a valid session, (b) remote owner with locked local controls and a safe holder snapshot, (c) no owner but retained paused media/position with no session, and (d) explicit stop with no media. `available` moves (b) to (c); a subsequent `busy` updates (b) using the new holder. Explicit Stop moves to (d). Stale asynchronous media fetches and old socket revisions must not overwrite a newer state.

**Verify**: write failing state-transition tests first, then run the focused tests above → they pass after implementation.

### Step 2: Keep desktop media mounted and make Play acquire a session

Change `PlaybackCoordinator::remote_available` to clear holder/error and pause while preserving media, position, duration, repeat, shuffle, and quality. Distinguish retained no-session state from an owned paused state in `desktop/src/ui/mod.rs`. If the user presses Play in retained state, call `play_media_at` with current media and position so the server grants or rejects a fresh session; do not call `engine.play()` on a stopped pipeline. Keep busy-state controls locked and the holder card visible. Update both audio and video mini-player controls if needed, and preserve explicit Stop's existing clearing behavior.

**Verify**: desktop state and native tests above → pass; add assertions that `available` retains media/position and Play begins a session request rather than a stale engine play.

### Step 3: Keep web observer media without auto-acquisition

In `GlobalPlayer`, stop calling `setCurrentMedia(null)` for observer `available`/`owned` and HTTP fallback availability. Preserve the last observed media and progress, set paused, clear holder/conflict, and mark it as retained-without-session. Suppress the normal session-creation effect until an explicit Play or media selection. Make Play use the existing `createPlaybackSession` + readiness path, preserving position; on `409` return to observer state. A new `busy` update must replace the retained snapshot, while explicit Close/Stop still clears it.

**Verify**: web focused tests above → retained mini-player renders and no request is made solely because `available` arrived.

### Step 4: Complete the Android retained-state path

Keep current media and progress after `available`, clear a revoked-session lock only when there is no local source, and require an explicit Play to request a fresh source. Audio already has a restart path in `togglePlayback`; make video take the same explicit-session path without `FullPlayer` auto-acquiring merely because controls unlocked. Guard the Plan 076 HTTP fallback against an already-running asynchronous holder fetch completing after the socket has supplied newer state; use the poller's `isStopped()` or an equivalent generation guard. Preserve the current busy-state lock, safe holder display, and explicit Stop behavior.

**Verify**: mobile focused tests above → retained audio/video remain visible, do not issue a session request on `available`, and request one on explicit Play.

## Test plan

Model desktop tests on `desktop/tests/playback_state.rs`; change its assertion for `remote_available` and add `busy → available → busy`, forced takeover gap, and Stop cases. On web and mobile, test the observable state transitions and session-request calls with mocked APIs, not only a pure flag. Cover stale async completion after a newer socket revision. Finish with a manual three-client matrix: owner pause, observer mini player, forced takeover's temporary `available`, owner close/TTL expiry, observer Play, and explicit Stop.

## Done criteria

- [x] Desktop mini player stays mounted with last media and position through `available`, including a forced-takeover gap.
- [x] Web and Android retain audio/video player state through the same transition.
- [x] No observer stream plays or lease is acquired without an explicit user action.
- [x] Busy controls stay locked; retained-state Play requests a fresh session; Stop clears the player.
- [x] All focused and final gates exit 0; only in-scope files change.

Automated transitions and gates were verified on commit `57b0f6a`. The live three-client manual matrix remains to be run when all clients and backend are available.

## STOP conditions

Stop if a retained state cannot be represented without changing public protocol fields, if a fresh Play requires bypassing protected stream validation, or if UI tests need new runtime dependencies. Stop after two failed verification attempts and report the failure.

## Maintenance notes

Never infer ownership from a retained media object; only a current protected session plus lease grants it. Review `available` handling on every new client and on WebSocket reconnects.
