# Plan 057: Diagnose and fix desktop memory growth during playback

> **Executor instructions**: Follow the measurement gate before changing
> playback or WebSocket code. Run each verification command. If a STOP
> condition occurs, report the evidence and do not make a speculative memory
> fix. Update the status row
> in `plans/README.md` when finished.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- desktop/src/api/playback_socket.rs desktop/src/ui/mod.rs desktop/src/playback/engine.rs desktop/src/ui/video_surface.rs desktop/Cargo.toml`
> Also run `git status --short` and inspect uncommitted changes in those files.
> This plan was written against a dirty working tree containing Plan 041/043
> changes. Preserve them. If the excerpts below no longer match, STOP and
> re-scope the plan before editing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none; coordinate with Plan 054 before editing socket code
- **Category**: perf
- **Planned at**: commit `2bf8caa`, 2026-10-06; current dirty-tree excerpts below

## Why this matters

The operator reports roughly 500 MB of desktop process memory during **audio
alone**. Memory rises with repeated audio seeks and does not fall after the
app's Stop button. A separate short video test rose from about 150 to 180 MB
after three play cycles of roughly 10 seconds each. Neither observation alone
proves a WebSocket or GStreamer leak: the native renderer, allocator, and
artwork cache may retain reusable memory. Measure retained private memory and
repeatability for both media types, compare connected and local playback, then
fix only the subsystem that actually grows. Do not promise a particular RSS
ceiling before establishing a release-build baseline.

## Current state

- `desktop/src/api/playback_socket.rs:99-159` owns the reconnect loop. At
  lines 107-112 it obtains a ticket and calls `connect_async`; at 124-141 it
  selects between inbound frames and outbound commands. At 154-156 the
  reconnect delay receives a command but drops it when the channel remains
  open. Existing tests in this file cover protocol parsing, not task lifetime.
- `desktop/src/ui/mod.rs:438-529` creates `mpsc::channel(16)` for commands and
  events, stores a sender in `NativeApp`, starts `tokio::spawn(playback_socket::run(...))`,
  then calls `task.abort()` at line 523 when local mode or server URL changes.
  It does not await the task before starting the next one. `publish_socket_state`
  at lines 1434-1508 emits at most once per second while playing. A seek does
  not enqueue an audio buffer in this path.
- `desktop/src/playback/engine.rs:361-372` sends the persistent `playbin` to
  `gst::State::Null` on Stop but keeps the engine object and its URI. At
  lines 396-418, `seek_simple` uses `FLUSH | KEY_UNIT`. `desktop/src/ui/mod.rs:1776-1816`
  calls `engine.stop()` and clears coordinator state; `:1818-1834` calls
  `engine.seek()` from the seek controls. These are the primary reproduction
  paths. Do not assume `State::Null` must immediately lower RSS.
- `desktop/src/ui/mod.rs:58-70,106-124,948-977` keeps up to 96 artwork data
  URLs. `desktop/src/playback/engine.rs:113-118,230-244` bounds appsink to four
  buffers and recycles up to four frame vectors; `desktop/src/ui/video_surface.rs:378-405`
  also owns WGPU textures. `VideoPaintSource` drops/replaces texture handles
  around lines 541-562 and 738-764. Repeated video playback needs a separate
  cycle measurement before classifying those resources as retained. Artwork
  and renderer memory are competing explanations, not automatic edit targets.
  Four recycled 1920×1080 RGBA vectors alone can retain about 32 MiB after
  Stop; the observed 150→180 MB video rise may be a bounded warm cache.
  The artwork cache limits entry count, not total encoded/decoded bytes, so it
  is also a candidate for a large steady audio baseline.
- `server/src/playback-socket.js:4,42-54` limits client messages to 8192 bytes
  and caps its outgoing buffered amount; this plan must not alter the wire
  protocol or the server. HTTP heartbeat remains the reconnect fallback in
  `desktop/src/ui/mod.rs:530-540`.

Conventions: Rust tests live beside the implementation (`#[cfg(test)]` in
`playback_socket.rs`); desktop checks use `desktop/Cargo.toml`. Existing Plan
054 and dirty Plan 041 work change lease-loss handling; preserve that behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Dirty-tree check | `git status --short` | known edits recorded; no user work overwritten |
| Build release app | `cargo build --release --locked --manifest-path desktop/Cargo.toml --bin dogmedia-desktop` | exit 0 |
| Unit tests | `cargo test --locked --manifest-path desktop/Cargo.toml` | exit 0 |
| Clippy | `cargo clippy --locked --manifest-path desktop/Cargo.toml --all-targets -- -D warnings` | exit 0 |
| Format | `cargo fmt --manifest-path desktop/Cargo.toml -- --check` | exit 0 |
| Linux memory sample | `cat /proc/<PID>/smaps_rollup` and `cat /proc/<PID>/status` | record `Rss`, `Pss`, `Private_Dirty`, `RssAnon`, `Threads` |

## Scope

**In scope** (only the subsystem attributed by Step 1):

- `desktop/src/playback/engine.rs` and its in-file tests for the audio
  seek/stop and shared pipeline path
- `desktop/src/ui/video_surface.rs` only if video-specific GPU resources are
  proven to grow across repeated play/Stop cycles
- `desktop/src/api/playback_socket.rs` and its in-file tests
- `desktop/src/ui/mod.rs` and its in-file tests
- `desktop/Cargo.toml` only if test-only Tokio/WebSocket features are required
- `desktop/scripts/profile-playback-memory.sh` (new; optional small read-only
  sampler that writes CSV only to a caller-selected output path)
- `plans/README.md` status row

**Out of scope**:

- Artwork cache implementation, renderer/vendor code, and video-only pipeline
  changes without attribution
- Web/mobile/server socket protocol, lease timing, and HTTP fallback removal
- Broad Dioxus UI refactors or allocator changes without profiling evidence

## Git workflow

- Branch: `perf/057-desktop-playback-memory` if an isolated branch is useful;
  do not reset/stash the existing dirty tree without preserving its changes.
- Commit style: `perf(desktop): release retained playback resources`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Reproduce the audio and video memory sequences in a release build

Build and run the **release** binary directly, not `dx serve`. On the same
host, audio item, and window size, record `/proc/<PID>/smaps_rollup` and
`/proc/<PID>/status` at startup; connected idle; audio playing for 10 minutes;
after 10, 50, and 100 seeks across that one item; immediately after the Stop
button; and 10 minutes after Stop. In a fresh process also repeat the reported
video case: 10-second play, Stop, and a 30-second idle interval for 3, 10, and
30 cycles of the same video. Record memory before each cycle and after its idle
interval. Also record FD count using
`find /proc/<PID>/fd -mindepth 1 -maxdepth 1 | wc -l`. Record `Rss`, `Pss`,
`Private_Dirty`, `RssAnon`, `Threads`, and FD count. Repeat both sequences in a
fresh release process with the **same audio and video files** in local offline
mode (Plan 043) so playback can be compared without WebSocket/reporting. Run a
third connected-idle control with no playback for the same duration. Repeat
at least one full run to rule out startup/cache warmup. Do not commit media
paths or server addresses.

Classify whether growth follows audio seek count, video play/Stop cycles, both
media types, only connected mode, or idle socket/reconnect activity. Compare
memory after Stop with a second play/seek cycle: retained RSS that gets reused
without further growth may be allocator/cache behavior, not a leak. Three
video cycles with a 30 MB rise and a single 500 MB audio RSS number are
insufficient by themselves to choose a fix. For video, compare the 3/10/30
cycle curve with the bounded four-frame recycle pool before changing it.

**Verify**: a table of before/after values and MiB per 10/50/100 audio seeks
and 3/10/30 video cycles exists for both modes, with a stated private-memory
slope and second-cycle result.
If the growth cannot be reproduced or attributed, STOP with those measurements.

### Step 2: Fix the GStreamer path if local playback retains memory

If local audio reproduces the slope, inspect `PlaybackEngine::seek`,
`flush_pending_seek`, `stop`, and the `ui::seek`/`stop_playback` call sites.
Use GStreamer tracing or allocation profiling on the release build to identify
retained buffers, decoder elements, or application allocations. Confirm that
the pipeline reaches `Null` after Stop and check whether a new seek creates
elements/buffers that remain reachable. Make the smallest change that releases
the proven retained owner or bounds its cache; preserve seek position, pause,
resume, gapless expectations, and playback lease behavior. Do not replace the
entire persistent engine or change video caps without separate evidence. If
both local audio and local video grow, investigate the shared `playbin`/Stop
path first. If only video grows, inspect `VideoPaintSource` texture/handle
replacement and the bounded frame recycle pool; change only the proven owner.

**Verify**: a headless audio seek/stop test exercises at least 100 seeks and
confirms the pipeline reaches `Null` after Stop. If video-specific code is
changed, add a focused resource-lifecycle test for repeated texture handle
replacement/unregistration. The Step-1 matrix shows private memory plateauing
across a second 100-seek cycle and 30 video play/Stop cycles.
`cargo test --locked --manifest-path desktop/Cargo.toml` exits 0.

### Step 3: Fix the socket path only if measurements implicate it

If growth occurs only with the server connection or follows reconnect count,
inspect `playback_socket::run` and the owner in `ui/mod.rs`. Give each socket
worker a single owner; on local-mode or URL change, clear the sender, abort and
**await** the old worker before starting another. Ensure component drop
cancels it. Stop reconnecting promptly when the command receiver closes,
including during ticket acquisition/handshake/backoff. Preserve the current
lease-loss and HTTP fallback behavior. Do not hold a Dioxus `Signal` guard
across `.await`. Avoid dropping the only pending bind/state command during
backoff. If measured Tungstenite buffers are materially oversized, set
explicit frame/message limits that still accept current `lease.state` events.

**Verify**: a local WebSocket lifecycle test performs 100 connect/cancel
cycles with no growing worker/FD count and checks that bind/state survives
reconnect. Tests also cover one oversized frame if a limit is introduced.
`cargo test` and `cargo clippy` above exit 0. If local playback already
reproduces the growth, do not change WebSocket code for that symptom.

### Step 4: Repeat the exact release measurements

Run the Step-1 matrix on the same host and media after the attributed fix.
Compare private memory slope, RSS/PSS, FD and thread counts, and second-cycle
behavior. Report baseline separately from retained growth. Preserve audio
playback, seeking, Stop, lease takeover/reconnect, and local-folder fallback.

**Verify**: after warmup, the second 100-seek cycle adds at most
`max(16 MiB, 2 × the idle-control drift)` in `Private_Dirty`; video cycles
10–30 add at most `max(32 MiB, 2 × the idle-control drift)` in the same metric.
If a proven bounded decoder/GPU cache exceeds those limits, document its
plateau over another 30 cycles before accepting it. Format, tests, and Clippy
commands above exit 0.

## Test plan

- If Step 2 applies, add an audio seek/stop regression test next to
  `engine.rs` tests. Verify state transitions and repeat seeks; use release
  measurements for memory because unit tests cannot reliably assert RSS.
- If video resources are implicated, add a focused texture registration/
  unregistration lifecycle test where that behavior can be tested without a
  GPU; otherwise rely on the host video-cycle matrix.
- If Step 3 applies, add lifecycle tests next to `playback_socket.rs` for
  cancellation/reconnect and latest bind/state delivery. Keep lease-loss and
  HTTP fallback behavior.
- Record release-process memory samples; unit tests cannot prove an RSS leak
  is gone.

## Done criteria

- [ ] Same-host release baseline and post-change measurement table exists
- [ ] Audio seek/Stop and video play/Stop are measured in connected and local modes
- [ ] Evidence names the retained subsystem; only its code is changed
- [ ] The Step-4 `Private_Dirty` thresholds pass, or a bounded cache plateau
      is demonstrated over the extra 30 video cycles
- [ ] Audio/video playback, seeking, Stop, and lease takeover/reconnect remain correct
- [ ] Format, tests, and Clippy commands above exit 0
- [ ] Only in-scope files changed; preserve the pre-existing dirty work
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code or dirty-tree ownership differs from the excerpts above.
- The memory increase is not reproducible in a release build or its owner
  cannot be distinguished from renderer/artwork/GStreamer caches.
- The evidence points to artwork, renderer/vendor, or another component outside scope.
- A socket fix would require a breaking protocol or lease change.
- The only available measurements are from a debug/`dx serve` process rather
  than the packaged release binary.
- A verification gate fails twice after a reasonable correction.

## Maintenance notes

Re-run the memory matrix after GStreamer, Dioxus/Blitz, or Plan 054 socket
changes. Review Stop semantics and `Signal` lifetimes together. Treat RSS and
private memory separately because allocator reuse and WGPU/GStreamer mappings
can leave RSS high without an accumulating Rust heap leak.
