# Plan 059: Gate desktop playback-tick writes that re-render 10×/s while paused

> **Executor instructions**: Read Plan 057 fully first, then this plan. This
> plan fixes only the tick owner proven by the 2026-10-07 paused-slope
> measurement below. Run each verification command. If a STOP condition
> occurs, report the evidence and do not stack a speculative fix. Update the
> status row in `plans/README.md` when finished.
>
> **Drift check (run first)**: `git status --short` and
> `git diff --stat HEAD -- desktop/src/ui/mod.rs desktop/src/playback/coordinator.rs desktop/src/integration/mpris.rs desktop/src/playback/engine.rs`
> This plan was written with the Plan 057 bus-drain fix present but
> uncommitted in `desktop/src/playback/engine.rs:464-496`. Preserve it. If
> the excerpts below no longer match, STOP and re-scope before editing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 057 (measurement gate passed; fix ownership split out here)
- **Category**: perf
- **Execution status**: DONE — the operator isolated the tick owner in the
  same release binary: paused growth fell from about 2.4 MiB/s to 0.1 MiB/s
  with timing change detection and the 1 Hz idle tick. Post-Stop also flattened
  after the gate; the remaining active transition/retention work is covered by
  Plan 057. Diagnostics remain available.
- **Planned at**: 2026-10-07 against release binary `00:36` (34 MiB, includes bus-drain fix)

## Why this matters

Plan 057's bus-drain fix (`poll_event` now pops every message) did not stop
the growth. The operator's 2026-10-07 release-binary measurements isolate a
second owner on the UI-tick path with an exact slope:

- Pause window 01:49 → 01:54:11 (5 min, one 29 MB FLAC paused, offline
  mode): `Private_Dirty` 145 → 872 MiB (**+727 MiB / ~300 s ≈ 2.42 MiB/s**),
  Threads 35 steady, FD 55 steady, `Pss_File` ~79 MiB stable. All growth in
  anonymous heap.
- 2.42 MiB/s ÷ 10 ticks/s ≈ **242 KiB retained per 100 ms tick** — exactly
  the unexplained remainder Plan 057 predicted ("~240 KiB per 100 ms tick").
- Stop + 4 min idle: 479 → 487 MiB (+8 MiB) while Threads fell 34→28 and FD
  55→50. The tick runs after Stop, so retention continues with no playback.

## Current state

- `desktop/src/ui/mod.rs:417-428` runs the tick loop forever: every 100 ms,
  `tick_playback(app, engine)` + `publish_mpris_state(...)` — while playing,
  paused, stopped, and idle.
- `desktop/src/ui/mod.rs:1389-1425` (`tick_playback`): calls `poll_event`
  (now fully drained), `position()`, `duration()`, then **unconditionally**
  `app.write().coordinator.update_timing(position, duration)` at lines
  1422-1425. While paused, position/duration are static, but each `write()`
  marks the whole `NativeApp` signal dirty → full Dioxus/Blitz re-render at
  10 Hz. After Stop the same path still writes every tick.
- `desktop/src/playback/coordinator.rs:243-249` (`update_timing`): assigns
  only two f64 fields and returns early only for `session_unavailable`. No
  change detection — identical values still count as a write upstream.
- Ruled out by inspection (do not touch): `MprisBridge::publish`
  (`desktop/src/integration/mpris.rs:188-196`) uses `send_if_modified` and
  is a no-op when state is unchanged; `publish_socket_state` early-returns in
  local mode (`ui/mod.rs:1440-1443`); `heartbeat` early-returns in local mode
  (`ui/mod.rs:1517-1520`).
- The remaining per-seek/per-track growth (several MiB per seek, +38.9 MiB
  across a queue advance) is a separate owner still under Plan 057 Step 2
  (GStreamer seek/start buffers). This plan fixes only the tick owner; seek
  slope is verified separately and must not be conflated with it.
- Operator's first `--memory-watch` run reached roughly 5.3 GiB
  `Private_Dirty` before OOM termination. That run used the pre-change release
  binary; release was rebuilt after the tick gate landed and must be retested
  before attributing the remaining slope to the seek/track-buffer owner.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build release app | `cargo build --release --locked --manifest-path desktop/Cargo.toml --bin dogmedia-desktop` | exit 0 |
| Unit tests | `cargo test --locked --manifest-path desktop/Cargo.toml` | exit 0 |
| Clippy | `cargo clippy --locked --manifest-path desktop/Cargo.toml --all-targets -- -D warnings` | exit 0 |
| Format | `cargo fmt --manifest-path desktop/Cargo.toml -- --check` | exit 0 |
| Paused slope | release binary, 1 FLAC paused 5 min: `Private_Dirty` from `/proc/<PID>/smaps_rollup` at start/end | slope in KiB/s |
| Playback state check | `dbus-send --session --print-reply --dest=org.mpris.MediaPlayer2.com.dogmedia.Desktop /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.Get string:org.mpris.MediaPlayer2.Player string:PlaybackStatus` | `variant string "Paused"` etc. |

## Scope

**In scope**:

- `desktop/src/playback/coordinator.rs`: change detection in
  `update_timing`/`update_position` (return whether anything changed; skip
  writes under an epsilon for float jitter from `query_position`).
- `desktop/src/ui/mod.rs`: tick path only — skip the `app.write()` when
  timing is unchanged; slow the tick when not playing (e.g. 1 Hz when
  paused/stopped/idle, 10 Hz while playing/loading). Keep MPRIS publish and
  lease/heartbeat behavior identical.
- In-file tests next to `coordinator.rs` for change detection.
- `plans/README.md` status row.

**Out of scope**:

- GStreamer seek/start-buffer retention (stays with Plan 057).
- Artwork cache, renderer/vendor code, socket protocol, allocator changes.
- Broad Dioxus UI refactors.

## Git workflow

- Branch: `perf/059-gate-playback-tick` (or continue on the Plan 057 branch
  if one exists); do not reset/stash the existing dirty tree without
  preserving its changes (Plan 041/043 work + bus-drain fix).
- Commit style: `perf(desktop): gate playback-tick writes while paused`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Gate `update_timing` on change

Add change detection to `PlaybackCoordinator::update_timing` (and
`update_position` for the seek path): compare against the stored snapshot
with a small epsilon (position queries jitter at the microsecond level) and
return `bool` indicating whether anything changed. No behavior change to the
stored values themselves.

**Verify**: new unit tests cover identical-value writes (return false),
moved-position writes (return true), and NaN/negative clamping.

### Step 2: Skip unchanged tick writes and slow the idle tick

In `tick_playback`, only take `app.write()` for timing when the polled
position/duration actually changed; read the snapshot first and compare
before writing. Slow the loop in `ui/mod.rs:418-428` when the snapshot
status is not Playing/Loading (1 Hz is sufficient for paused/stopped/idle
freshness; MPRIS stays change-gated as today). Preserve: seek display
accuracy while playing, pause/resume transitions, EOS detection latency
while playing (keep 10 Hz there), lease takeover/reconnect, local-folder
fallback.

**Verify**: `cargo test`, Clippy, and fmt commands above exit 0. Manual
check: play → pause → resume → seek → Stop all behave as before on the
release binary.

### Step 3: Re-measure the paused and Stop-idle slopes

On the same host, same 29 MB FLAC, same window size, release binary run
directly: record `Rss`, `Pss`, `Private_Dirty`, `RssAnon`, `Threads`, FD at
pause start, pause +5 min, Stop, Stop +5 min. Compare against the 2026-10-07
baseline (+727 MiB / 5 min paused, +8 MiB / 4 min Stop-idle).

**Verify**: paused 5-min growth ≤ `max(16 MiB, 2 × the idle-control drift)`
in `Private_Dirty`, and Stop +5 min shows no retained growth beyond the same
bound. If the paused slope does not move, REVERT before continuing (keeps
attribution clean) and return the measurements to Plan 057.

## Test plan

- Coordinator unit tests: unchanged timing returns false and writes nothing
  observable; changed timing returns true; epsilon covers query jitter.
- If the tick loop is refactored into a testable helper, add a test that N
  ticks with static position produce no `app.write()` for timing.
- Release-process memory samples (unit tests cannot prove an RSS slope is
  gone).

## Done criteria

- [ ] Paused 5-min and Stop +5-min `Private_Dirty` slopes pass the bounds above
- [ ] Seek/next-track slope reported separately (Plan 057 owner, not conflated)
- [ ] Play, pause, resume, seek, Stop, EOS advance, lease behavior unchanged
- [ ] Format, tests, and Clippy commands above exit 0
- [ ] Only in-scope files changed; pre-existing dirty work preserved
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code excerpts above no longer match (dirty-tree drift).
- The paused slope is not reproducible in the release binary.
- Gating the tick does not move the paused slope (revert; owner is elsewhere).
- The only available measurements are from a debug/`dx serve` process.
- A verification gate fails twice after a reasonable correction.

## Maintenance notes

- The 100 ms tick exists for EOS detection and smooth position display while
  playing. Any future per-tick work must be change-gated the same way, or
  the ~240 KiB/tick retention returns. If new bus message types start being
  handled in `poll_event`, popped-ness (not handling) is what bounds the
  queue — see Plan 057 maintenance notes.
