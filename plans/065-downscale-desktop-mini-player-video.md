# Plan 065: Downscale desktop video decode and texture upload for mini-player

> **Executor instructions**: Read `desktop/docs/GPU_OFFLOAD_MAP.md` fully first,
> then this plan. Implement the adaptive resolution constraint for the mini-player
> viewport without breaking fullscreen/expanded video rendering, A/V sync, or
> hardware decoding on VA-API. Run each verification command. If a STOP condition
> occurs, report the evidence and do not apply speculative fixes. Update the
> status row in `plans/README.md` when finished.
>
> **Drift check (run first)**:
> `git status --short`
> `git diff --stat HEAD -- desktop/src/playback/engine.rs desktop/src/ui/video_surface.rs desktop/src/ui/views/video_mini_player.rs desktop/src/ui/views/video_player.rs`

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW–MED
- **Depends on**: Plan 057, Plan 059, Plan 060 (all baseline memory gating in place)
- **Category**: perf / video
- **Execution status**: DONE — adaptive video resolution constraints (640×360 mini-player vs unconstrained fullscreen) implemented in PlaybackEngine and synced via use_effect with player_expanded; buffer recycling drains oversized allocations; 74 unit tests pass
- **Planned at**: 2026-10-13 against `desktop/docs/GPU_OFFLOAD_MAP.md` verification

---

## Why this matters

In `desktop/docs/GPU_OFFLOAD_MAP.md`, Stage 4 identifies the primary remaining memory and transfer bandwidth cost in the desktop video pipeline:

- A 1080p NV12 frame consists of:
  - Y plane: 1920 × 1080 = 2.07 MB
  - UV plane: 960 × 540 × 2 = 1.04 MB
  - Total: **~3.11 MB per frame**
- At 24 fps, this requires **~75 MB/s** of memory copies in `new-sample` and **~75 MB/s** of `queue.write_texture` texture uploads to the GPU.
- While the user is browsing the library or multitasking, video plays inside `VideoMiniPlayer` in a pinned card with a viewport of only **358 × 201 CSS pixels** (~716 × 402 physical pixels at 2× HiDPI).
- Decoding and uploading a full 1080p frame to display it at 358 × 201 wastes **>90% of the memory transfer bandwidth**.
- Constraining the output resolution during mini-player mode (e.g. max width 640px, ~180 KB NV12 per frame) reduces texture upload and memcpy throughput from **75 MB/s down to ~4.3 MB/s** (**~94% reduction**), preventing CPU cache thrashing and reducing power consumption.

---

## Current state

1. **Static AppSink Caps (`desktop/src/playback/engine.rs:114-120`)**:
   - `PlaybackEngine::with_frame_receiver` sets fixed caps on `appsink`:
     ```rust
     let caps = gst::Caps::from_str("video/x-raw, format=(string){ NV12, RGBA }")
     ```
   - Caps do not restrict width or height, so GStreamer always outputs the full native resolution of the decoded stream (e.g. 1920 × 1080).
2. **Mini Player UI (`desktop/src/ui/views/video_mini_player.rs:43-70`)**:
   - Renders `<canvas class="video-mini-canvas" src="{video_source_id}">`.
   - `app.read().player_expanded` is `false` when the mini player is visible.
3. **Fullscreen Player UI (`desktop/src/ui/views/video_player.rs`)**:
   - Renders when `app.read().player_expanded` is `true`.
   - Requires full native resolution for crisp display.
4. **Hardware Decoder (`vah264dec`)**:
   - Hardware decode (`vah264dec` on Intel VA-API) decodes the stream. Downscaling can be handled either by hardware VPP/videoconvert or via negotiation on `appsink` caps.

---

## Proposed Changes

### 1. Adaptive Video Resolution Constraint in `PlaybackEngine`
- Add an explicit method to `PlaybackEngine`:
  ```rust
  pub fn set_video_constraint(&self, max_width: Option<u32>, max_height: Option<u32>)
  ```
- Dynamically update the `caps` property of the existing `appsink` element:
  - When constrained (mini-player mode):
    `video/x-raw, format=(string){ NV12, RGBA }, width=(int)[1, 640], height=(int)[1, 360]`
  - When unconstrained (fullscreen/expanded mode):
    `video/x-raw, format=(string){ NV12, RGBA }`
- GStreamer dynamically re-negotiates pads with downstream elements (`videoscale` / VA post-processing) upon caps property change without restarting the pipeline or disrupting A/V sync.

### 2. State Sync in UI Shell / Player Views
- In `desktop/src/ui/views/shell.rs` (or during `player_expanded` signal transitions):
  - When `player_expanded` transitions to `false` and video media is active:
    call `engine.set_video_constraint(Some(640), Some(360))`.
  - When `player_expanded` transitions to `true`:
    call `engine.set_video_constraint(None, None)`.
  - On new media playback start, initialize constraint according to current `player_expanded` state.

### 3. WGPU Surface Handling (`desktop/src/ui/video_surface.rs`)
- `VideoPaintSource::render` already handles dynamic texture recreation when frame dimensions change:
  ```rust
  if self.frame_size != Some((width, height)) { ... }
  ```
- Verify that resizing textures between 640×360 and 1920×1080 occurs cleanly without leaking previous textures or leaving stale bind groups.

---

## Step-by-Step Implementation

1. **Step 1: Unit Test & Contract Definition**
   - Add unit tests in `desktop/src/playback/engine.rs` to verify that `set_video_constraint` updates `appsink` caps correctly.
   - Verify that switching constraints while pipeline is running or paused does not produce errors or pipeline stalls.

2. **Step 2: Engine Implementation**
   - Expose `video_sink: gst::Element` reference in `PlaybackEngine` struct.
   - Implement `set_video_constraint`.

3. **Step 3: UI Integration**
   - Hook `set_video_constraint` into the expand/collapse actions in `video_player.rs`, `video_mini_player.rs`, and `shell.rs`.

4. **Step 4: Benchmarking & Verification**
   - Play 1080p video in mini player mode.
   - Check `video frame upload FPS` log in `video_surface.rs`:
     - Confirm `source_width <= 640`, `source_height <= 360`.
     - Confirm upload bandwidth drops from ~75 MB/s to <5 MB/s.
   - Expand to fullscreen:
     - Confirm `source_width` returns to 1920, `source_height` to 1080 seamlessly.

---

## Verification Gates

```bash
# 1. Format check
cargo fmt --manifest-path desktop/Cargo.toml -- --check

# 2. Test suite
cargo test --manifest-path desktop/Cargo.toml

# 3. Linter
npm run lint

# 4. Manual / Log verification
cargo run --release --manifest-path desktop/Cargo.toml
# Observe tracing log:
# - Mini player: source_width=640, source_height=360
# - Fullscreen: source_width=1920, source_height=1080
```

---

## Rollback & Safety

- If GStreamer renegotiation causes pipeline stutter or audio desync on certain platforms, fall back immediately to unconstrained caps (`video/x-raw, format=(string){ NV12, RGBA }`).
- Do not add `sync=false` to `appsink`.
