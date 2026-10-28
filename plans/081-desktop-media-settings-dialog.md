# Plan 081: Port Media Settings (Quality, Speed, Sleep Timer) to Native Desktop Client

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43d7dd5..HEAD -- desktop/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `43d7dd5`, 2026-10-28

## Why this matters

The Web client provides rich playback controls in its `SettingsControl` (`web/src/components/global-player/settings-panel.jsx`), allowing users to dynamically switch media stream quality (Very High, High, Medium, Low), adjust playback speed (0.5x to 2.0x), and set sleep timers.

The native Rust Desktop client (`desktop/`) already contains internal data structures for `Quality` (`desktop/src/domain/`) and stores `settings.quality`, but lacks an on-the-fly media settings control in the player bar and video views:
1. Changing quality currently requires stopping or manually editing config, rather than selecting resolution from the active player bar.
2. Variable playback rate is not exposed to the user, even though GStreamer's `playbin` pipeline natively supports rate-seeking (`gst::SeekFlags`).
3. No sleep timer exists in the desktop client.

This plan ports the Web media settings experience to Desktop by introducing an in-playback `MediaSettingsDialog`, adding rate-seeking to `PlaybackEngine`, and supporting sleep timers within the desktop coordinator.

## Current state

- `desktop/src/playback/engine.rs` — GStreamer playback engine wrapping `playbin`.
  - Handles `play()`, `pause()`, `seek(position)`.
  - Does not yet implement variable speed playback rate seeking.
- `desktop/src/ui/views/player_bar.rs` — Bottom playback bar for desktop.
  - Controls: Play/Pause, Next/Prev, Shuffle, Loop, Volume slider, Queue toggle, Full-player toggle.
  - Lacks a Settings / Gear action button.
- `desktop/src/ui/views/video_player.rs` — Full video player view.
  - Controls: Overlay transport bar with volume, seek bar, subtitles menu.
- `desktop/src/store/settings.rs` — Local settings store persisting `settings.quality`.
- `desktop/src/ui/mod.rs:1529` — Uses `media.playable_quality(app.read().settings.quality)` when opening streams.

### GStreamer playback rate seeking convention

In GStreamer (`gstreamer::prelude::*`), changing playback rate is executed via:
```rust
self.playbin.seek(
    rate,
    gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
    gst::SeekType::Set,
    current_position_clock_time,
    gst::SeekType::None,
    gst::ClockTime::NONE,
)?;
```

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Check     | `cargo check --manifest-path desktop/Cargo.toml` | exit 0, no errors |
| Test      | `cargo test --manifest-path desktop/Cargo.toml` | all pass |
| Lint      | `cargo clippy --manifest-path desktop/Cargo.toml` | exit 0, clean |

## Scope

**In scope**:
- `desktop/src/playback/engine.rs` — Implement `set_playback_rate(rate: f64) -> Result<(), EngineError>` using GStreamer rate seek.
- `desktop/src/playback/coordinator.rs` — Track `playback_rate` (default 1.0) and optional `sleep_timer_until: Option<Instant>`.
- `desktop/src/ui/views/media_settings_dialog.rs` (create) — Modal dialog presenting Quality options, Speed buttons, and Sleep Timer options.
- `desktop/src/ui/views/player_bar.rs` & `desktop/src/ui/views/video_player.rs` — Add Gear icon button triggering `media_settings_open`.
- `desktop/assets/native.css` — Style the media settings dialog matching desktop design tokens.

**Out of scope**:
- Connecting external equalizer DSP plugins (keep EQ in desktop as a separate audio-effects roadmap item).
- Changes to server API or mobile app code.

## Git workflow

- Branch: `feature/081-desktop-media-settings-dialog`

## Implementation steps

### Step 1: Add Playback Rate Control to `PlaybackEngine`

1. In `desktop/src/playback/engine.rs`:
   - Add method `pub fn set_rate(&self, rate: f64) -> Result<(), EngineError>`.
   - Clamp `rate` between `0.25` and `3.0`.
   - Query current position via `self.playbin.query_position::<gst::ClockTime>()`.
   - Send seek event with rate, `gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE`.
2. In `desktop/src/playback/coordinator.rs`:
   - Store `rate: f64` in coordinator state.
   - Expose `set_rate(&mut self, rate: f64)`.

**Verification**:
```bash
cargo check --manifest-path desktop/Cargo.toml
```
Expected: Compiles with 0 errors.

---

### Step 2: Implement Sleep Timer in Desktop Coordinator

1. In `desktop/src/playback/coordinator.rs`:
   - Add `sleep_timer_deadline: Option<Instant>`.
   - Add method `set_sleep_timer(&mut self, minutes: Option<u32>)`.
   - In coordinator `tick()`, if `Instant::now() >= deadline`, trigger pause and clear deadline.
2. In `desktop/src/ui/mod.rs`:
   - Surface sleep timer countdown in UI state so the dialog can display remaining time.

**Verification**:
```bash
cargo test --manifest-path desktop/Cargo.toml
```
Expected: All tests pass.

---

### Step 3: Implement `MediaSettingsDialog` View

Create `desktop/src/ui/views/media_settings_dialog.rs`:
1. Use Dioxus dialog modal structure matching `desktop/src/ui/views/settings_dialog.rs`:
   - Dialog backdrop with blur.
   - Header with title "Playback Settings" and close button.
2. Section 1 — **Stream Quality**:
   - Radio buttons or pills for `Quality::Ori`, `Quality::High`, `Quality::Med`, `Quality::Low`.
   - On change: update `app.write().settings.quality`, trigger `play_media` reload at current seek position.
3. Section 2 — **Playback Speed**:
   - Selector pills for `0.5x`, `0.75x`, `1.0x (Normal)`, `1.25x`, `1.5x`, `2.0x`.
   - On change: call `engine.set_rate(selected_rate)`.
4. Section 3 — **Sleep Timer**:
   - Presets: `Off`, `15m`, `30m`, `45m`, `60m`.
   - Show active countdown badge if running.

**Verification**:
```bash
cargo check --manifest-path desktop/Cargo.toml
```
Expected: 0 errors.

---

### Step 4: Add Gear Trigger Button in `player_bar.rs` & `video_player.rs`

1. In `desktop/src/ui/views/player_bar.rs`:
   - Add `IconButton` with `IconName::Settings` beside the Queue toggle.
   - On click: set `app.write().media_settings_open = true`.
2. In `desktop/src/ui/views/video_player.rs`:
   - Add matching Gear button in the bottom overlay controls.
3. In `desktop/assets/native.css`:
   - Add styles for `.media-settings-dialog`, `.media-settings-tabs`, and `.media-settings-pill`.

**Verification**:
```bash
cargo check --manifest-path desktop/Cargo.toml
cargo clippy --manifest-path desktop/Cargo.toml
```
Expected: Clean check and clippy run.

---

## Machine-checkable done criteria

1. `cargo check --manifest-path desktop/Cargo.toml` exits with code 0.
2. `cargo test --manifest-path desktop/Cargo.toml` passes.
3. `desktop/src/ui/views/media_settings_dialog.rs` exists and is integrated into desktop views.

## STOP conditions

- If GStreamer rate seek fails on audio-only streams on host without `scaletempo` or `pitch` elements, fall back to pitch-preserving rate seek flags or report element absence.
- Do not modify MPRIS interfaces in `desktop/src/integration/mpris.rs`.
