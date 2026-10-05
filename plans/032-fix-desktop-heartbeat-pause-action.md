# Plan 032: Send correct playback action in desktop heartbeat while paused

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- desktop/src/ui/mod.rs`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `edc7905`, 2026-10-04

## Why this matters

The desktop client's 10-second heartbeat function unconditionally sends `"play"` as the playback action to the server, even when playback is paused. This causes:
1. The web Now Playing dashboard to show paused desktop users as actively playing.
2. Server-side playback session tracking to incorrectly reset pause timers.
3. Wrapped analytics to over-count play time for paused sessions.

## Current state

Relevant files:
- `desktop/src/ui/mod.rs` — main UI module containing the `heartbeat` function
- `desktop/src/domain/playback.rs` — contains `PlaybackStatus` enum

**`desktop/src/ui/mod.rs:848-878`** (the heartbeat function):
```rust
fn heartbeat(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let (Some(client), Some(session), Some(media)) = (
        app.read().client.clone(),
        app.read().session.clone(),
        app.read().coordinator.snapshot().media.clone(),
    ) else {
        return;
    };
    let position = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::position)
        .unwrap_or(app.read().coordinator.snapshot().position);
    let duration = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::duration)
        .unwrap_or(app.read().coordinator.snapshot().duration);
    spawn(async move {
        if session.lease_required
            && let Err(error) = client.heartbeat(&session).await
        {
            if let Some(engine) = engine.read().as_ref() {
                let _ = engine.pause();
            }
            app.write().coordinator.lease_lost();
            app.write().status = Some(error.user_message());
            return;
        }
        send_report(&client, &media, "play", position, duration, false).await;
    });
}
```

Line 877 hardcodes `"play"`. It should check `app.read().coordinator.snapshot().status`.

**`desktop/src/domain/playback.rs`** defines:
```rust
#[derive(Clone, Debug, PartialEq)]
pub enum PlaybackStatus {
    Idle,
    Playing,
    Paused,
    // ...
}
```

**Repo conventions**: Dioxus signals (`Signal<T>`) are used for state. `spawn(async move { ... })` for async operations. `send_report` takes an action string `&str`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Desktop check | `cargo check --manifest-path desktop/Cargo.toml --no-default-features --features native-ui` | exit 0 |
| Desktop tests | `cargo test --manifest-path desktop/Cargo.toml --no-default-features --features native-ui --lib` | exit 0, all pass |
| Desktop clippy | `cargo clippy --manifest-path desktop/Cargo.toml --no-default-features --features native-ui -- -D warnings` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `desktop/src/ui/mod.rs`

**Out of scope** (do NOT touch):
- `desktop/src/domain/playback.rs` — PlaybackStatus enum is correct
- `desktop/src/api/` — send_report API is correct
- Server routes — they correctly handle both "play" and "pause" actions

## Git workflow

- Branch: `fix/032-desktop-heartbeat-pause`
- Commit style: `fix(desktop): send correct action in heartbeat based on playback status`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Read playback status and send the correct action

In `desktop/src/ui/mod.rs`, in the `heartbeat` function, capture the playback status before the `spawn` block and use it to determine the action string.

Before the `spawn(async move { ... })` block (around line 866), add:
```rust
    let status = app.read().coordinator.snapshot().status.clone();
```

Then change line 877 from:
```rust
        send_report(&client, &media, "play", position, duration, false).await;
```

To:
```rust
        let action = if status == PlaybackStatus::Playing { "play" } else { "pause" };
        send_report(&client, &media, action, position, duration, false).await;
```

Make sure `PlaybackStatus` is imported at the top of the file. Check the existing imports — it's likely already imported since it's used elsewhere in `mod.rs`. If not, add:
```rust
use crate::domain::playback::PlaybackStatus;
```

**Verify**: `cargo check --manifest-path desktop/Cargo.toml --no-default-features --features native-ui` → exit 0

### Step 2: Run tests and clippy

**Verify**: `cargo test --manifest-path desktop/Cargo.toml --no-default-features --features native-ui --lib` → all tests pass
**Verify**: `cargo clippy --manifest-path desktop/Cargo.toml --no-default-features --features native-ui -- -D warnings` → exit 0

## Test plan

No new test file needed. The `PlaybackStatus` comparison is trivial. The `heartbeat` function requires full Dioxus runtime context to test; the coordinator's status field is already tested in `desktop/tests/playback_state.rs`.

## Done criteria

- [ ] `cargo check` exits 0
- [ ] `cargo test` exits 0
- [ ] `cargo clippy` exits 0
- [ ] `grep '"play"' desktop/src/ui/mod.rs` does NOT match line 877 unconditionally — the action is conditional on status
- [ ] No files outside the in-scope list are modified

## STOP conditions

Stop and report back if:
- The `heartbeat` function at lines 848-878 doesn't match the excerpt
- `PlaybackStatus` enum has been restructured or moved
- `send_report` function signature has changed
- The `coordinator.snapshot().status` field is not accessible

## Maintenance notes

- If additional playback states are added to `PlaybackStatus` (e.g. `Buffering`), the action mapping should be reviewed.
- The web player's equivalent heartbeat already handles this correctly — see `web/src/components/GlobalPlayer.jsx` for the reference pattern.

## Implementation

Completed on 2026-10-04. The desktop heartbeat now captures the coordinator's
playback status before spawning its async task and reports `play` only for
`PlaybackStatus::Playing`; paused and other non-playing states report `pause`.
