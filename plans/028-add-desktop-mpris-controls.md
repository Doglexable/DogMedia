# Plan 028: Expose Desktop Pause, Previous, and Next Controls Through MPRIS

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: this plan was written from a dirty working tree
> based on commit `edc7905`. Run both commands:
>
> ```bash
> git diff --stat edc7905..HEAD -- desktop/Cargo.toml desktop/Cargo.lock desktop/src/lib.rs desktop/src/ui/mod.rs desktop/src/integration desktop/flatpak/com.dogmedia.Desktop.yml desktop/scripts/check-packaging.sh desktop/README.md
> git diff --stat -- desktop/Cargo.toml desktop/Cargo.lock desktop/src/lib.rs desktop/src/ui/mod.rs desktop/src/integration desktop/flatpak/com.dogmedia.Desktop.yml desktop/scripts/check-packaging.sh desktop/README.md
> ```
>
> A non-empty second command is expected because the current desktop fixes are
> not committed. Compare the live code with the excerpts below before editing.
> If playback ownership has moved out of `desktop/src/ui/mod.rs`, the desktop is
> no longer Linux/Dioxus Native, or an MPRIS implementation now exists, stop and
> re-plan instead of layering on a second controller.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 026's shipped Dioxus Native desktop client
- **Category**: direction
- **Planned at**: commit `edc7905`, 2026-10-04, plus the uncommitted desktop fixes listed by the drift check
- **Implementation**: Code and automated gates complete on 2026-10-04; host
  `playerctl`/MPRIS acceptance remains because the execution sandbox cannot
  access the compositor or user session bus.

## Why this matters

The web client already exposes play, pause, previous, and next through the
browser Media Session API, but the native Linux client has no equivalent. As a
result, GNOME/KDE media controls, hardware media keys, and compatible desktop
media surfaces cannot control Dogmedia.

Implement the freedesktop MPRIS service interface rather than inventing
notification-specific buttons. MPRIS is the Linux contract for `Pause`,
`PlayPause`, `Previous`, `Next`, playback status, and track metadata. It lets
the desktop environment choose the appropriate notification/system UI while
Dogmedia keeps one playback and queue implementation.

This plan deliberately does not add a second playback engine or a second queue
state. MPRIS commands are messages into the existing Dioxus owner, and outbound
MPRIS properties are projections of the existing `PlaybackCoordinator`, queue,
and volume state.

## Architecture decision

Use `mpris-server`'s ready-to-use `Player` on a dedicated current-thread Tokio
runtime:

- Pin `mpris-server = "=0.9.0"` as an optional dependency included by the
  existing `native-ui` feature. This exact release's `Player` API is present in
  the local Cargo registry and supports callbacks plus automatic
  `PropertiesChanged` emission.
- Keep `mpris_server::Player` entirely on a dedicated `dogmedia-mpris` OS
  thread. In 0.9.0 it contains `Rc`/`RefCell` and is intentionally `!Send`; do
  not move it onto the repository's multi-thread Tokio runtime.
- Cross the thread boundary only with owned, application-defined values:
  `MprisCommand` through an unbounded MPSC channel and the latest `MprisState`
  through a watch channel.
- The Dioxus root component is the only command consumer. It translates MPRIS
  commands into the existing `toggle_playback`/queue navigation behavior on the
  same side of the boundary that already owns `Signal<NativeApp>` and
  `PlaybackEngine`.
- D-Bus absence, a duplicate bus name, or a service-thread startup failure is
  non-fatal. Log one warning and leave normal in-app playback working.

The service name must be
`org.mpris.MediaPlayer2.com.dogmedia.Desktop`, with object path
`/org/mpris/MediaPlayer2`, identity `Dogmedia`, and desktop entry
`com.dogmedia.Desktop` (without the `.desktop` suffix).

## Current state

### One existing playback owner

`desktop/src/ui/mod.rs:285-338` constructs one `NativeApp`, one
`PlaybackEngine`, and periodic playback/heartbeat tasks:

```rust
fn App() -> Element {
    let mut app = use_signal(NativeApp::boot);
    let engine = use_signal(|| PlaybackEngine::new().ok());
    // ...one persistent video paint source...
    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            tick_playback(app, engine);
        }
    });
    // ...heartbeat task...
}
```

Preserve this ownership. The MPRIS module must not hold a Dioxus `Signal`, an
`ApiClient`, a `PlaybackEngine`, or a GStreamer object.

`desktop/src/ui/mod.rs:881-916` currently implements a toggle directly:

```rust
fn toggle_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    // ...resolve media and client...
    let playing = app.read().coordinator.snapshot().status == PlaybackStatus::Playing;
    let result = engine.read().as_ref().map(|engine| {
        if playing { engine.pause() } else { engine.play() }
    });
    // ...update coordinator and report play/pause...
}
```

An explicit MPRIS `Pause` must not call this unconditionally: if Dogmedia is
already paused, toggling would resume playback. Extract an idempotent helper
that accepts the requested state and make the existing UI toggle call it.

`desktop/src/ui/mod.rs:1060-1149` already owns queue navigation. It restarts the
current track for a user-triggered Previous press after three seconds, handles
repeat-one/repeat-queue behavior, calls `api/queue/navigate`, and loads the
selected media. Route MPRIS Previous/Next through this function; do not repeat
its server calls in the integration module.

### State available for MPRIS

`desktop/src/playback/coordinator.rs:3-31` exposes the status, media, position,
duration, repeat mode, and shuffle state in `PlaybackSnapshot`. Status values
are `Idle`, `Loading`, `Playing`, `Paused`, `Ended`, and `Failed`.

`desktop/src/domain/media.rs:40-79` exposes a numeric media ID, title, artists,
duration, MIME type, category name/path, and helper methods. Publish:

- `mpris:trackid`: `/com/dogmedia/track/<numeric-media-id>`;
- `xesam:title`: `Media::title()`;
- `xesam:artist`: the non-empty `artists` field as one value (do not guess how
  to split a server-owned display string);
- `xesam:album`: non-empty `category_name`, falling back to `category_path`;
- `mpris:length`: duration converted from seconds to signed microseconds.

Do not publish the protected stream URL, playback session ID, viewer ID, server
URL, or an artwork URL. The server's image requests may need application
headers, which desktop shells cannot attach. Omitting artwork initially is
safer than leaking credentials or advertising an image the shell cannot load.

`desktop/src/domain/queue.rs:15-31` provides `has_previous`, `has_next`,
`total`, and `current_media_id`. Use capabilities only when the queue's current
ID matches the active media so a stale async queue response cannot enable the
wrong controls.

### Packaging and documented boundary

`desktop/flatpak/com.dogmedia.Desktop.yml:9-14` currently grants network,
Wayland/X11, audio, and DRI access but no MPRIS bus-name ownership.
`desktop/scripts/check-packaging.sh:43-46` checks the primary command and DRI
permission; extend it with an exact MPRIS `--own-name` assertion.

`desktop/README.md:279-290` says next/previous already work in-app and explicitly
lists MPRIS/media-key integration and desktop notifications as missing. Update
that boundary after implementation. The persisted `Settings.notifications`
field is currently unused; do not reinterpret it as an MPRIS toggle. A future
passive track-change toast is a separate feature.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Native dependency/source guard | `npm run check:desktop:native` | exit 0; no forbidden browser/webview dependency |
| Format | `cargo fmt --manifest-path desktop/Cargo.toml -- --check` | exit 0; no formatting diff |
| Rust lint | `cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings` | exit 0; no warnings |
| Focused unit tests | `cargo test --manifest-path desktop/Cargo.toml --lib integration::mpris` | all MPRIS mapping/lifecycle tests pass |
| Desktop regression | `npm run test:desktop` | all Rust tests pass |
| Native-only regression | `npm run test:desktop:native` | all native UI library tests pass |
| Packaging guard | `npm run check:desktop:packaging` | exits 0 and includes the MPRIS ownership assertion |
| Release build | `npm run build:desktop` | release binary builds successfully |
| Scope check | `git status --short` | no new modifications outside this plan's in-scope files and pre-existing dirty files |

Manual acceptance additionally requires a Linux user session with a session
D-Bus and `playerctl`. Absence of `playerctl` is not permission to install it
silently; report that the automated gates passed and leave manual acceptance
pending.

## Suggested executor toolkit

- MPRIS Player interface specification:
  <https://specifications.freedesktop.org/mpris/latest/Player_Interface.html>
- `mpris-server` ready-to-use Player documentation:
  <https://docs.rs/mpris-server/0.9.0/mpris_server/struct.Player.html>
- The crate's locally cached reference implementation and example, when
  available:
  `~/.cargo/registry/src/*/mpris-server-0.9.0/examples/player.rs` and
  `~/.cargo/registry/src/*/mpris-server-0.9.0/src/player.rs`.
- `web/src/components/global-player/media-session.js` is the product behavior
  reference for browser-side action names, not code to port into Rust.

## Scope

**In scope** (the only source files to modify or create):

- `desktop/Cargo.toml` — add the optional pinned MPRIS service dependency.
- `desktop/Cargo.lock` — record the resolved dependency graph.
- `desktop/src/lib.rs` — export the feature-gated integration module.
- `desktop/src/integration/mod.rs` — create the platform integration boundary.
- `desktop/src/integration/mpris.rs` — create the service thread, channel bridge,
  state projection, metadata conversion, and unit tests.
- `desktop/src/ui/mod.rs` — start/drop the bridge, consume commands, publish
  state, and make explicit play/pause requests idempotent.
- `desktop/flatpak/com.dogmedia.Desktop.yml` — allow ownership of Dogmedia's
  exact MPRIS bus name.
- `desktop/scripts/check-packaging.sh` — guard that permission against removal.
- `desktop/README.md` — document Linux media controls and remaining limits.

**Out of scope**:

- Any change to `server/`, `web/`, or `mobile/`; no API change is required.
- A second GStreamer pipeline, queue, playback coordinator, or Tokio runtime on
  the UI thread.
- Seeking, volume, shuffle, repeat, Stop, Raise, Quit, or opening arbitrary URIs
  through MPRIS. Keep `CanSeek` false and unsupported capabilities disabled.
- Desktop notification banners using `notify-rust` or another notification
  API. MPRIS supplies native media controls; a separate toast is not guaranteed
  by every desktop environment and should be planned independently if desired.
- Downloading artwork to disk solely for MPRIS. The desktop environment may use
  the Dogmedia application icon until an authenticated artwork cache exists.
- Windows/macOS media-session APIs and packaging.
- Exposing protected identifiers or URLs in D-Bus metadata or logs.

## Git workflow

- Branch: `feat/desktop-mpris-controls`
- Use one implementation commit, for example
  `feat(desktop): add MPRIS playback controls`, after all automated gates pass.
- Do not discard, reformat, or fold in the pre-existing dirty desktop changes.
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Add the feature-gated MPRIS bridge and pure state model

In `desktop/Cargo.toml`:

1. Add `mpris-server = { version = "=0.9.0", optional = true }`.
2. Add `dep:mpris-server` to `native-ui`.
3. Let Cargo update `desktop/Cargo.lock`; do not hand-edit the lockfile.

Create `desktop/src/integration/mod.rs` with a Linux/native-UI-gated `mpris`
module and expose that module from `desktop/src/lib.rs` under the existing
`native-ui` build boundary. This desktop release is Linux-only, so a compile
error on another target is preferable to a fake no-op implementation unless
the repository has gained a cross-platform desktop target by execution time.

In `desktop/src/integration/mpris.rs`, define owned bridge types:

```rust
pub(crate) enum MprisCommand {
    SetPlaying(bool), // Pause=false, Play=true
    Toggle,
    Previous,
    Next,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MprisState {
    // MPRIS status, active media metadata, position/duration in microseconds,
    // volume, and can_play/can_pause/can_go_previous/can_go_next flags.
}
```

Provide a pure constructor taking `&PlaybackSnapshot`, `Option<&QueueWindow>`,
`Volume`, and `engine_available`. Its required mapping is:

- no media, photos, `Idle`, `Ended`, and `Failed` -> MPRIS `Stopped`;
- active `Playing` -> MPRIS `Playing`;
- active `Paused` -> MPRIS `Paused`;
- `Loading` -> MPRIS `Paused` with controls temporarily disabled;
- audio/video metadata only; photos expose no track metadata;
- `can_play` and `can_pause` require an audio/video item, an available engine,
  and a status other than Loading/Failed/Idle;
- next/previous additionally require a matching non-stale queue. Respect its
  flags, and allow both directions at repeat-queue boundaries when `total > 1`;
- Previous may remain available when position is greater than three seconds,
  matching the in-app restart-current-track behavior.

Convert floating seconds safely: reject non-finite/negative inputs as zero,
clamp before multiplying by 1,000,000, and avoid a lossy unchecked cast beyond
`i64::MAX`. Generate track IDs only from the numeric `MediaId`.

Add unit tests in this module for at least:

1. idle and photo states are stopped and expose no protected metadata;
2. a playing audio item maps title, one unsplit artist string, album/category,
   stable track ID, duration, position, and volume;
3. loading and unavailable-engine states disable commands;
4. a stale queue current ID disables navigation;
5. next/previous flags and repeat-queue boundaries map correctly;
6. non-finite/negative/oversized timing values are converted safely.

**Verify**:

```bash
cargo test --manifest-path desktop/Cargo.toml --lib integration::mpris
```

Expected: the new pure tests pass without requiring a live D-Bus session.

### Step 2: Run the MPRIS Player on an isolated local runtime

Implement a cloneable `MprisBridge` (or an equivalently named type) whose
public surface is limited to:

- `start()`;
- async receipt of the next `MprisCommand` by the single UI consumer;
- publishing/replacing the latest `MprisState`;
- clean shutdown on final drop.

`start()` must create the channels before spawning a named `dogmedia-mpris`
thread. In that thread:

1. Build a Tokio current-thread runtime and `tokio::task::LocalSet`.
2. Build `mpris_server::Player::builder("com.dogmedia.Desktop")` with identity
   `Dogmedia`, desktop entry `com.dogmedia.Desktop`, control enabled, and all
   requested capabilities initially false.
3. Connect callbacks before running the service:
   - `connect_pause` -> `SetPlaying(false)`;
   - `connect_play` -> `SetPlaying(true)`;
   - `connect_play_pause` -> `Toggle`;
   - `connect_previous` -> `Previous`;
   - `connect_next` -> `Next`.
4. Spawn `player.run()` locally, then select between state changes and bridge
   shutdown.
5. Apply only changed state. Use `Player::set_position` for periodic position
   updates because that setter intentionally emits no property-change signal;
   use the async setters for playback status, metadata, volume, and capability
   changes. Desktop clients extrapolate position while playing, so do not emit
   a D-Bus property storm every 100ms.

If the command receiver is gone, callbacks must ignore the send error. If the
state sender or shutdown owner is gone, exit the local loop and drop Player.
Never panic because a session bus is missing or the bus name is already owned.
Log the error without any settings, URLs, or playback identifiers.

Do not hold a blocking mutex across `.await`. If the bridge uses an async mutex
around the single receiver for cloneability, only the one root-component task
may call `recv`; document that invariant beside the field.

**Verify**:

```bash
cargo fmt --manifest-path desktop/Cargo.toml -- --check
cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: both exit 0. Running tests outside a graphical/session-D-Bus login
must still succeed because unit tests do not start the real service.

### Step 3: Route commands through the existing UI playback owner

In `desktop/src/ui/mod.rs`, create one bridge in `App` with `use_hook` and keep
it alive for the root component's lifetime. An `Arc`-backed inner bridge is
acceptable so the command and publisher futures can hold clones and the final
drop can signal service shutdown.

Refactor `toggle_playback` without changing its existing observable behavior:

1. Extract `set_playback_playing(app, engine, requested_playing)`.
2. Return immediately if the active coordinator state already equals the
   requested state. Repeated Pause must remain paused; repeated Play must remain
   playing.
3. Preserve the current engine call, coordinator mutation, position/duration,
   server playback report, and error/no-engine behavior.
4. Make `toggle_playback` calculate the inverse of the current Playing state
   and call the new helper.

Add one async root task that awaits MPRIS commands and dispatches:

- `SetPlaying(value)` -> the new idempotent helper;
- `Toggle` -> `toggle_playback`;
- `Previous` -> `navigate_queue(app, engine, false, false)`;
- `Next` -> `navigate_queue(app, engine, true, false)`.

Do not invoke engine or queue functions from the MPRIS thread. Do not add API
calls to `integration/mpris.rs`.

In the existing 100ms playback loop, after `tick_playback`, project and publish
the latest MPRIS state from the coordinator snapshot, current queue, persisted
volume, and `engine.read().is_some()`. A watch channel must coalesce updates;
the D-Bus thread's equality checks must prevent redundant signals. Publishing
at startup before media is selected must produce Stopped/empty state.

Review every early return in `tick_playback`: synchronization belongs after the
function call in the outer loop, not inside `tick_playback`, so Loading, Ended,
Failed, and stopped states are still published.

**Verify**:

```bash
npm run test:desktop
npm run test:desktop:native
```

Expected: all existing and new Rust tests pass; playback coordinator tests show
no regression.

### Step 4: Grant the exact Flatpak bus name and update documentation

Add this exact finish argument to
`desktop/flatpak/com.dogmedia.Desktop.yml`:

```yaml
  - --own-name=org.mpris.MediaPlayer2.com.dogmedia.Desktop
```

Do not grant wildcard session-bus ownership or `--socket=session-bus`.

Extend `desktop/scripts/check-packaging.sh` with an anchored/exact grep for the
permission so future packaging edits cannot silently break controls. Keep the
existing command, runtime, and DRI checks.

Update `desktop/README.md`:

- add GNOME/KDE media controls and hardware media keys to included scope;
- remove MPRIS/media-key integration from the missing list;
- keep desktop notification banners in the missing list and explain that the
  available system control surface depends on the desktop environment;
- add a short troubleshooting note: a missing user session D-Bus disables only
  system controls, not in-app playback.

**Verify**:

```bash
npm run check:desktop:native
npm run check:desktop:packaging
npm run build:desktop
```

Expected: all exit 0, the packaging guard sees the exact MPRIS own-name, and
the release binary is produced.

### Step 5: Perform real-session acceptance with playerctl

Run the release binary in a normal Linux graphical login and start one audio or
video item. In another terminal:

```bash
playerctl -l
busctl --user introspect org.mpris.MediaPlayer2.com.dogmedia.Desktop /org/mpris/MediaPlayer2
playerctl --player=com.dogmedia.Desktop metadata xesam:title
playerctl --player=com.dogmedia.Desktop status
playerctl --player=com.dogmedia.Desktop pause
playerctl --player=com.dogmedia.Desktop play
playerctl --player=com.dogmedia.Desktop next
playerctl --player=com.dogmedia.Desktop previous
```

Expected:

- `playerctl -l` lists `com.dogmedia.Desktop` (an implementation may append an
  instance suffix; the full D-Bus name must still have the required prefix).
- Introspection exposes `org.mpris.MediaPlayer2` and
  `org.mpris.MediaPlayer2.Player`.
- Metadata title matches the active item and status follows Dogmedia.
- Pause pauses once; issuing Pause again does not resume. Play behaves
  symmetrically.
- Next and Previous have the same queue/restart/repeat behavior as the visible
  desktop buttons, with no overlapping stream or duplicate session.
- Closing Dogmedia removes the player from `playerctl -l` promptly.
- Running without a session bus logs one warning while in-app controls still
  work.

Repeat the identity/introspection check for the Flatpak build if available.
The Flatpak must own only the exact bus name granted in Step 4.

**Verify**: after manual acceptance, rerun
`git status --short` and confirm only the in-scope implementation files plus
the pre-existing dirty files changed.

## Test plan

- Put pure projection/conversion unit tests in
  `desktop/src/integration/mpris.rs`; they must not connect to D-Bus.
- Model media construction on `desktop/tests/playback_state.rs`, including all
  currently required `Media` fields.
- Preserve all `desktop/tests/playback_state.rs` coverage for stale loads,
  session replacement, quality restart, lease loss, stop idempotence, and queue
  boundaries.
- Use `playerctl` only for the real D-Bus/action acceptance test; do not make CI
  depend on a user session bus or a private Dogmedia server.
- Test the release binary for manual acceptance because the desktop video path
  is known to have different debug-build performance.

## Done criteria

- [ ] Dogmedia owns `org.mpris.MediaPlayer2.com.dogmedia.Desktop` in a normal
      Linux user session and Flatpak has only that exact own-name permission.
- [ ] Pause, Play, PlayPause, Previous, and Next callbacks enter the existing UI
      playback/queue path; no MPRIS thread touches Dioxus or GStreamer state.
- [ ] Repeated explicit Pause cannot resume playback.
- [ ] Status, title, artist, album/category, duration, position, volume, and
      navigation capabilities reflect current coordinator/queue state.
- [ ] Photos and stopped/failed playback do not advertise a playable MPRIS
      track; protected URLs and identifiers never appear in metadata/logs.
- [ ] D-Bus startup failure is non-fatal and normal in-app playback remains
      available.
- [ ] `cargo fmt --manifest-path desktop/Cargo.toml -- --check` exits 0.
- [ ] `cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.
- [ ] `npm run test:desktop && npm run test:desktop:native` passes.
- [ ] `npm run check:desktop:native && npm run check:desktop:packaging` passes.
- [ ] `npm run build:desktop` succeeds.
- [ ] `plans/README.md` marks Plan 028 DONE or BLOCKED with a one-line reason.

## STOP conditions

Stop and report back; do not improvise if:

- playback ownership moved out of `desktop/src/ui/mod.rs`, or a second MPRIS
  implementation/dependency appeared after this plan was written;
- `mpris-server` 0.9.0 no longer resolves with Rust 1.88 or its `Player` API no
  longer matches the pinned local documentation;
- MPRIS requires moving `Signal<NativeApp>`, `PlaybackEngine`, GStreamer, or the
  `!Send` Player across thread boundaries;
- making the service work in Flatpak appears to require unrestricted session
  D-Bus access or a wildcard bus-name grant;
- the implementation requires exposing a playback session ID, viewer ID,
  protected stream URL, or another secret through D-Bus;
- existing in-app Pause/Next/Previous behavior would need to change rather than
  be reused;
- a verification command fails twice after one reasonable correction;
- an implementation change is needed outside the in-scope files.

## Maintenance notes

- Reviewers should scrutinize thread ownership, final-drop shutdown, and the
  absence of protected values in metadata/logging before visual behavior.
- MPRIS `Position` should be updated without emitting a property-changed signal;
  clients extrapolate it while status is Playing.
- If authenticated artwork is later cached as a local file, publish a temporary
  `file://` art URL whose lifecycle matches the metadata. Do not regress to a
  protected HTTP URL.
- If true popup banners are requested later, plan them separately around the
  existing `Settings.notifications` flag. Notification actions must still send
  `MprisCommand`/UI-owner messages instead of controlling the engine directly.
- Windows SMTC and macOS Now Playing are separate platform integrations; keep
  their future adapters behind the same owned command/state boundary.
