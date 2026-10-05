# Plan 026: Ship a Native Linux Desktop Client in Rust

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d324fe5..HEAD -- package.json .gitignore README.md server/src/index.js server/src/routes/media.js server/src/routes/media.test.js desktop`
> If any in-scope existing file changed since this plan was written, compare
> the "Current state" excerpts against the live code before proceeding. New
> files under `desktop/` are expected only if this plan has already started;
> otherwise, any mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L (multi-week; deliver through the milestones below)
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d324fe5`, 2026-09-30

## Why this matters

Dogmedia already has a stable Fastify media API and separate browser and mobile
clients. A desktop client should therefore be a third API consumer, not a copy
of the React application inside Electron, Tauri, CEF, or another web view.

Build the first desktop release as a Linux-first, compiled Rust application
using GTK 4/libadwaita for native widgets and GStreamer for media. This choice
matches the repository's Linux/Podman operating environment, avoids Chromium,
supports audio, video, seeking, and HTTP range requests, and allows protected
stream headers to be applied through GStreamer's HTTP source. Preserve the
Fastify server as the source of truth; the desktop application must not connect
directly to PostgreSQL or Redis.

The first release is a playback client: server selection, access check,
library/category browsing, search, favorites, photo/audio/video playback,
queue management, resume positions, lyrics, subtitles, quality selection, and
desktop media controls. Admin uploads, whitelist management, Wrapped stories,
music-share reel creation, and offline downloads are deliberately deferred.

## Architecture decision

Use this stack unless the proof-of-concept in Step 1 fails:

- **Language/runtime**: stable Rust, one native binary; no JavaScript runtime in
  `desktop/` and no HTML/CSS renderer.
- **UI**: `gtk4-rs` plus `libadwaita`; UI definitions may use GTK `.ui`/Blueprint
  resources and GTK CSS. They are native GTK resources, not web content.
- **Media**: GStreamer `playbin3` with `gst-plugin-gtk4`'s paintable sink.
  Configure `souphttpsrc` through the pipeline's `source-setup` callback and its
  `extra-headers` property so every protected stream request carries
  `X-Playback-Session` and `X-Viewer-ID`.
- **HTTP/JSON**: `reqwest`, `serde`, and `serde_json`; one typed `ApiClient` owns
  the base URL, timeouts, viewer ID, error mapping, and request headers.
- **Async model**: a Tokio runtime for network work; only immutable result
  messages cross back to the GTK main loop. Never move GTK objects onto Tokio
  worker threads.
- **Local settings**: XDG config/cache/data directories via `directories` or an
  equivalent crate. Persist the server URL, viewer ID, quality, volume, and
  window state. Do not log playback session IDs or viewer IDs.
- **Packaging**: Flatpak is the primary v1 artifact, with a freedesktop desktop
  file, AppStream metadata, icons, and network permission. A distro-native
  binary remains buildable with Cargo for developers.

Do not use Electron, Tauri, CEF, WebKitGTK, React Native for Desktop, a localhost
web server, or the existing React bundle anywhere in this application.

## Current state

### Existing client/server boundary

- `server/src/index.js:121-138` registers all public and protected routes under
  `/api`; the desktop application can consume these without a new backend.
- `server/src/routes/categories.js:110-133` returns the accessible category tree
  with parent, depth, cover, and media counts.
- `server/src/routes/media.js:627-713` implements cursor-based browsing with
  category, text, media-type, and liked filters. Use it instead of loading the
  complete library.
- `server/src/routes/queue.js:275-348` exposes a bounded queue window with a
  revision number and conflict-safe reordering.
- `server/src/routes/lyrics.js:150-173` and
  `server/src/routes/subtitles.js:45-66` expose player-side lyrics and subtitle
  metadata.
- `server/src/routes/offline.js:169-209` already provides download manifests and
  file validation, but that flow is not part of the first desktop release.

### Protected playback contract

`mobile/src/api.js:41-63` is the behavioral reference for native clients:

```javascript
const data = await apiJson(`/api/media/${Number(mediaId)}/playback-session`, {
  method: "POST",
  headers: storedViewerId ? { "X-Viewer-ID": storedViewerId } : {},
  body: JSON.stringify({ quality }),
});
return {
  uri: absoluteApiUrl(data.streamUrl),
  headers: {
    "X-Playback-Session": data.sessionId,
    "X-Viewer-ID": data.viewerId,
  },
};
```

`server/src/routes/media.js:1181-1257` creates the session and lease, while
`server/src/routes/media.js:1260-1295` rejects a stream lacking matching session,
viewer, quality, source version, IP, or access tier. The desktop player must not
open `/api/media/:id/stream` before creating the session.

The lease API is in `server/src/routes/playback.js:667-700`. Heartbeat an active
exclusive lease every 10 seconds and release it when playback is replaced,
stopped, or the application exits. Continue sending playback events, active
state, and resume updates on the same cadence as the mobile client.

### Existing native-client conventions to preserve

- `mobile/src/api.js:88-115` centralizes URL construction, viewer identity,
  JSON headers, and typed non-2xx errors. Reproduce this boundary in Rust rather
  than issuing HTTP calls from GTK widgets.
- `mobile/src/context/player-context.jsx` is the product behavior reference for
  load cancellation, one-player-at-a-time sequencing, queue transitions,
  resume prompts, lease loss, and periodic progress reporting. Do not port its
  React structure; reproduce its observable state machine.
- `mobile/src/offline-store.js:26-73` demonstrates the project's local-state
  schema and WAL convention. It is reference material only for the deferred
  offline milestone.
- Root commits use Conventional Commit-style messages, for example
  `fix(player): prevent high memory usage during sleep timer countdown`.

### Local build prerequisites observed during planning

- `pkg-config --modversion gtk4` returned `4.22.4`.
- `pkg-config --modversion libadwaita-1` returned `1.9.3`.
- `pkg-config --modversion gstreamer-1.0` returned `1.28.6`.
- `gst-inspect-1.0 gtk4paintablesink` exited 0 and found the GTK 4 paintable
  sink plugin, so the intended native video surface is available locally.
- No Rust toolchain was discoverable through `rustc` or `cargo`. The operator
  must install a stable Rust toolchain before implementation; do not silently
  install system-wide software.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prerequisite | `rustc --version && cargo --version` | both print versions and exit 0 |
| Native libraries | `pkg-config --modversion gtk4 libadwaita-1 gstreamer-1.0 gstreamer-play-1.0` | every dependency prints a version and exits 0 |
| Format | `cargo fmt --manifest-path desktop/Cargo.toml --check` | exit 0, no diff |
| Rust lint | `cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings` | exit 0, no warnings |
| Desktop tests | `cargo test --manifest-path desktop/Cargo.toml --all-features` | all tests pass |
| Server tests | `npm run test:server` | all server tests pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |
| Full regression | `npm run test && npm run lint` | all existing workspaces pass |
| Flatpak validation | `flatpak-builder --force-clean --stop-at=dogmedia-desktop /tmp/dogmedia-flatpak-build desktop/packaging/com.dogmedia.Desktop.yml` | dependency/build setup completes through the app module |

The Flatpak command is required only on a machine with `flatpak-builder` and the
selected runtime installed. If the operator wants a different distribution
format, stop before Step 8 and agree on that format rather than adding several
untested packagers.

## Suggested executor toolkit

- GTK Rust book: <https://gtk-rs.org/gtk4-rs/stable/latest/book/>
- GTK Rust API: <https://gtk-rs.org/gtk4-rs/stable/latest/docs/gtk4/>
- GStreamer HTTP source and `extra-headers`:
  <https://gstreamer.freedesktop.org/documentation/soup/souphttpsrc.html>
- GStreamer GTK 4 sink: <https://docs.rs/gst-plugin-gtk4/latest/gstgtk4/>

Pin mutually compatible crate versions in `desktop/Cargo.lock`; do not copy
version numbers from this plan because the crate ecosystem can move between
planning and execution.

## Scope

**In scope** (the only existing files to modify, plus the listed new tree):

- `package.json` — add `desktop:dev`, `desktop:test`, `desktop:lint`, and
  `desktop:build` convenience scripts; do not add `desktop` to npm workspaces.
- `.gitignore` — ignore `desktop/target/` and local desktop runtime state only.
- `README.md` — document native prerequisites, development, and Flatpak run.
- `server/src/index.js` — allow the explicit desktop platform header.
- `server/src/routes/media.js` — record `desktop` rather than mislabeling every
  native viewer-ID request as `mobile`.
- `server/src/routes/media.test.js` — cover platform normalization and fallback.
- `desktop/Cargo.toml`, `desktop/Cargo.lock`, `desktop/build.rs`
- `desktop/README.md`
- `desktop/src/main.rs`, `desktop/src/lib.rs`, `desktop/src/app.rs`
- `desktop/src/api/{mod.rs,client.rs,endpoints.rs}`
- `desktop/src/domain/{mod.rs,access.rs,category.rs,media.rs,playback.rs,queue.rs,lyrics.rs}`
- `desktop/src/playback/{mod.rs,engine.rs,coordinator.rs}`
- `desktop/src/store/{mod.rs,settings.rs}`
- `desktop/src/ui/{mod.rs,window.rs,browse.rs,player.rs,queue.rs,settings.rs}`
- `desktop/resources/{resources.gresource.xml,style.css}` and any `.ui` or
  Blueprint source files referenced by that manifest
- `desktop/resources/icons/` for the existing Dogmedia mark adapted to standard
  desktop icon sizes; reuse repository artwork, do not redesign the brand
- `desktop/tests/{api_contract.rs,playback_state.rs}`
- `desktop/packaging/com.dogmedia.Desktop.{desktop,metainfo.xml,yml}`

Small additional Rust modules are allowed only when they preserve these layer
boundaries. Add them to the plan status note when created.

**Out of scope**:

- Reusing `web/` code or embedding its built files.
- Changing PostgreSQL schemas, Redis queue formats, endpoint response shapes,
  access tiers, or IP-based authorization.
- Direct database/cache access from the desktop application.
- Admin uploads, category editing, whitelist management, mobile release
  management, Wrapped, and music-share reel creation.
- Offline downloads in v1. This is the first follow-up after the streaming
  client is stable; use `/api/offline/*` and a Rust SQLite store when planned.
- Windows/macOS packaging. Keep domain/API/player boundaries portable, but do
  not weaken the Linux GTK experience to claim untested cross-platform support.

## Git workflow

- Branch: `feat/native-desktop-client`
- Make one commit per milestone below so playback/UI regressions can be bisected.
- Commit style: `feat(desktop): <imperative summary>`; use `test(desktop):` and
  `docs(desktop):` where appropriate.
- Do not commit generated `desktop/target/`, local settings, downloaded media,
  playback identifiers, or API/session logs.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Prove the protected native playback path before building UI

Create the smallest Cargo application under `desktop/` that initializes GTK and
GStreamer, renders a video test source into a GTK `Picture`, and can load one
real Dogmedia audio/video stream after creating a playback session.

For the real stream proof:

1. POST to `/api/media/:id/playback-session` with quality `high` and a persisted
   viewer UUID.
2. Construct `playbin3` and attach to `source-setup` before setting the URI.
3. When the source supports `extra-headers`, set a `GstStructure` containing
   `X-Playback-Session` and `X-Viewer-ID`. Never put these values in the URI.
4. Attach `gtk4paintablesink` for video and verify audio-only media works with no
   paintable.
5. Seek to a non-zero position and confirm the server responds through its Range
   path; pause/resume; release the lease on teardown.
6. Convert this proof into `playback/engine.rs` tests using synthetic GStreamer
   sources. Keep the one real-server check as a documented manual acceptance
   test, not an automated test that depends on private media.

**Verify**:

- `cargo test --manifest-path desktop/Cargo.toml playback` passes.
- Manual run shows one protected audio item and one protected video item start,
  seek, pause, resume, and stop without a 401/409 response.
- Captured application logs contain neither the returned `sessionId` nor
  `viewerId`; header names in source code are expected, but values are private.

If custom headers are not present on range/redirect requests, stop. Do not work
around the server by placing session data in query parameters.

### Step 2: Make desktop identity explicit in the server contract

In `server/src/routes/media.js`, replace the current binary heuristic
`request.headers["x-viewer-id"] ? "mobile" : "web"` with a small normalizer:

- accept `X-Client-Platform: desktop` from the native application;
- accept only `web`, `mobile`, or `desktop` after lowercasing;
- preserve current fallback behavior when the header is absent so existing web
  and mobile clients do not change;
- store only the normalized value in the playback lease.

Add `X-Client-Platform` to the allowed CORS headers in `server/src/index.js` for
contract completeness. Make the Rust `ApiClient` send `desktop` on every API
request. Add server tests for desktop, invalid-header fallback, and unchanged
mobile/web fallback.

**Verify**: `npm run test:server && npm run lint --workspace=server` passes, and
`GET /api/playback/lease` reports `platform: "desktop"` for the owner/admin
after the desktop client acquires a protected lease.

### Step 3: Establish typed domain, HTTP, configuration, and error boundaries

Implement the layers before adding feature widgets:

- `domain/*`: Serde models for access, category, media browse pages, playback
  sessions/events/resume, queue windows, lyrics, and subtitles. Use tolerant
  deserialization for nullable fields and unknown additive response fields.
- `api/client.rs`: validate an `http` or `https` base URL, join paths without
  losing an existing prefix, apply 2.5-second access-check and longer media
  metadata timeouts, inject viewer/platform headers, decode JSON errors, and map
  status/code pairs such as 403, `PLAYBACK_IN_USE`, and
  `PLAYBACK_LEASE_LOST` into typed errors.
- `api/endpoints.rs`: one method per consumed endpoint. GTK code must not contain
  URLs or `reqwest` calls.
- `store/settings.rs`: atomically write a versioned settings file beneath the
  XDG config directory. Store a generated UUID viewer ID and reuse it between
  launches. Reject malformed URLs; warn before using plain HTTP to a non-loopback
  host, but allow it after explicit confirmation for LAN deployments.
- `app.rs`: own immutable service handles and a reducer-style application state.
  Background operations return messages tagged with a generation/request ID so
  stale searches and stale media loads cannot replace current state.

Use an in-process mock HTTP server in `desktop/tests/api_contract.rs`. Cover
base URL normalization, headers, success payloads, non-JSON errors, timeout,
pagination, 403 access, 409 playback conflict, and malformed payloads.

**Verify**: `cargo test --manifest-path desktop/Cargo.toml api_contract` passes
with no real network access.

### Step 4: Build the native desktop shell and browse experience

Implement an `adw::Application` and one `adw::ApplicationWindow` with:

- adaptive sidebar: Home, Categories, Favorites, then Settings at the bottom;
- a header bar with back navigation, debounced search, and media type filters;
- a virtualized `gtk::ListView` or `GridView` backed by `gio::ListStore`; never
  create all library rows at once;
- cursor pagination from `/api/media/browse?limit=50` with a single guarded
  load-more request;
- category tree navigation using `/api/categories` and `category_id` browse;
- an access screen that distinguishes unreachable server, denied IP, and
  first-run bootstrap;
- a persistent bottom player and an optional right queue panel on wide windows;
- light/dark/system preference using GTK/libadwaita settings.

Reuse the Dogmedia name and existing icon assets. Match desktop conventions:
keyboard focus, visible selected states, context menus, tooltips, scalable text,
and `Ctrl+L`/`Ctrl+F` search focus. Do not try to reproduce mobile bottom tabs or
web hover animations.

Unit-test state transitions and model adapters; use GTK accessibility names for
interactive controls so smoke tests can find them.

**Verify**:

- `cargo test --manifest-path desktop/Cargo.toml browse` passes.
- With a development server, rapidly change search text and filters; only the
  latest response is displayed and pagination never duplicates a media ID.
- At 800x600 and 1440x900, no primary control is clipped and keyboard-only
  navigation reaches every browse action.

### Step 5: Implement one authoritative playback coordinator

`playback/coordinator.rs` owns the state machine; widgets only send commands and
render snapshots. Represent at least `Idle`, `Loading`, `Playing`, `Paused`,
`Ended`, and `Failed`. Every load receives a monotonically increasing sequence
ID, and callbacks from an older pipeline must be ignored.

Required behavior:

- photo: load through the API with a bounded decoded size and show it in a
  zoom-to-fit `gtk::Picture`; no playback session is required;
- audio/video: create a playback session, configure GStreamer headers, then
  preroll and play;
- on replacement: persist resume/event state, stop the old pipeline, release its
  lease, then create the next session;
- 10-second lease heartbeat while required; pause and show a recoverable conflict
  if the lease is lost;
- 10-second active-session/resume reporting while playing plus immediate updates
  on pause, seek, skip, end, stop, and application shutdown;
- quality `low|med|high|ori`, respecting server errors and restarting at the
  current position on quality change;
- seek, volume, mute, previous/next, loop-one, loop-queue, shuffle, fullscreen,
  and sleep timer;
- restore `/api/playback/active` and `/api/playback/resume/:mediaId` on startup
  without autoplaying unexpectedly.

Keep session IDs only in memory. Install a shutdown handler that releases the
lease with a short timeout even when the main window is closed during playback.

`desktop/tests/playback_state.rs` must cover stale-load rejection, replacement
order, end-of-queue modes, heartbeat failure, quality restart position, and
idempotent stop/release.

**Verify**: `cargo test --manifest-path desktop/Cargo.toml playback_state`
passes, then manually play 30 minutes of mixed audio/video while watching for a
single GStreamer pipeline and stable memory use.

### Step 6: Add queue, favorites, lyrics, and subtitles

Wire the supporting features through `ApiClient` methods:

- Queue: fetch `/api/queue/window?limit=100`, add/play-next/remove/clear/select,
  next/previous, shuffle, and reorder. Send `offset`, `revision`, and exact media
  membership when reordering; on 409, reload and explain that the queue changed.
- Favorites: initialize from `/api/likes`; allow audio-only like/unlike; browse
  liked items via the existing liked filter.
- Lyrics: fetch `/api/media/:id/lyrics`, highlight synchronized segments from
  player position, and support keyboard/page scrolling. A missing lyric response
  is an empty state, not a playback failure.
- Subtitles: list tracks from `/api/media/:id/subtitles`, prefer ASS when present,
  otherwise VTT, and offer Off plus language/title choices. Download the selected
  subtitle to the XDG cache and pass the local URI to GStreamer; delete stale
  cache entries by age/version. Confirm styled ASS rendering in the proof before
  advertising it.

**Verify**: add mock-server tests for every mutation and 409 path; run
`cargo test --manifest-path desktop/Cargo.toml --all-features` and manually
confirm synchronized lyrics and at least one subtitle track.

### Step 7: Add desktop integration without hiding the player in the tray

Implement:

- MPRIS metadata, play/pause, seek, next, previous, loop, and volume integration;
- standard media-key behavior through MPRIS rather than a global key logger;
- inhibit system sleep only during active video playback or fullscreen media;
- desktop notifications for playback conflicts and download-free connection
  failures, with a settings toggle;
- window/session state restoration and a standard shortcuts overlay;
- single-instance behavior: activating the desktop file focuses the existing
  window.

Closing the last window exits and releases playback in v1. Do not add a tray-only
background mode until the product behavior is explicitly requested.

**Verify**: `playerctl metadata`, `playerctl play-pause`, `playerctl position 30`,
and desktop media keys control the running application; closing it removes the
MPRIS player and releases `/api/playback/lease`.

### Step 8: Package and document the Linux release

Create a Flatpak manifest and freedesktop metadata:

- application ID `com.dogmedia.Desktop` (use consistently in GTK, desktop file,
  icons, AppStream, and Flatpak);
- network access only; add filesystem permissions only for user-selected export
  paths, not broad home-directory access;
- bundle or declare the required GStreamer good/bad/ugly/libav codecs needed by
  the server's actual media formats;
- include license, icons, screenshots only after the UI exists, and release
  metadata;
- document distro build prerequisites and exact Cargo commands in
  `desktop/README.md` and link them from the root README;
- add root npm convenience scripts that delegate to Cargo, but keep Cargo as the
  authoritative build system.

Test on at least one Debian/Ubuntu-family and one Fedora-family installation,
both Wayland and X11 where available. Record codecs tested (MP3, AAC/M4A, FLAC,
H.264/AAC MP4, WebM, JPEG/PNG/WebP) in `desktop/README.md`.

**Verify**: build and install the Flatpak in a clean user profile, connect to a
LAN server, complete the acceptance checklist, uninstall it, and confirm that
only XDG app data remains.

## Test plan

### Automated

- API contract tests with a local mock server:
  access success/denial, pagination, typed errors, session headers, lease
  conflict/loss, queue conflict, lyrics/subtitle empty states, malformed JSON,
  timeout, and cancellation.
- Pure playback state-machine tests:
  stale callbacks, replace/stop ordering, loop/shuffle boundaries, resume
  validation, heartbeat cadence, quality restart, and shutdown cleanup.
- GStreamer tests use synthetic `audiotestsrc`/`videotestsrc` and fake sinks in
  CI. Do not require private media or a display for the core test suite.
- Server tests cover explicit desktop platform identity and all fallbacks.
- Run existing server, web, and mobile suites to prove no API regression.

### Manual acceptance on a real Dogmedia server

1. Configure an HTTP LAN server and an HTTPS server; denied IPs see the access
   screen and whitelisted IPs enter the library.
2. Browse 100+ items, search rapidly, filter each media family, enter nested
   categories, and paginate without duplicates.
3. Display a photo; play MP3/FLAC audio and H.264/WebM video; seek near the end;
   change quality; enter/leave fullscreen.
4. Confirm only one device holds an exclusive playback lease and that desktop is
   reported as the platform.
5. Pause/restart the application and resume; verify play/pause/end/skip events and
   now-playing state on the admin dashboard.
6. Add, reorder, remove, clear, shuffle, and navigate the queue; trigger a queue
   revision conflict from another client and recover by refreshing.
7. Like/unlike audio, render synchronized lyrics, switch subtitles, and handle
   media with neither gracefully.
8. Control playback through MPRIS/media keys; close during playback and confirm
   the lease is released.
9. Disconnect the network during playback and browsing; show a recoverable state
   without crashing or presenting stale content as current.
10. Run for 30 minutes and confirm a single player pipeline, bounded thumbnail
    cache, and no sustained memory growth.

## Done criteria

All must hold:

- [ ] `desktop/` contains Rust/GTK/GStreamer source and no browser engine,
  JavaScript runtime, HTML entrypoint, or reused `web/dist` content.
- [ ] `cargo fmt --manifest-path desktop/Cargo.toml --check` exits 0.
- [ ] `cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings` exits 0.
- [ ] `cargo test --manifest-path desktop/Cargo.toml --all-features` exits 0.
- [ ] `npm run test && npm run lint` exits 0.
- [ ] Protected audio/video streams work with header-based sessions, seeking,
  heartbeat, and release; no session identifier appears in logs or URLs.
- [ ] Browse/search/filter/category/favorites/queue/resume/lyrics/subtitles and
  photo/audio/video playback pass the manual acceptance checklist.
- [ ] The installed application exposes working MPRIS controls and closes cleanly.
- [ ] A Flatpak built from the checked-in manifest runs on a clean test profile.
- [ ] `README.md` and `desktop/README.md` document prerequisites, development,
  testing, packaging, server configuration, and the explicit v1 exclusions.
- [ ] `git status --short` shows no changes outside the in-scope list and
  `plans/README.md` is updated to DONE only after every criterion passes.

## STOP conditions

Stop and report back instead of improvising if:

- The operator's primary target is Windows or macOS rather than Linux. Revisit
  the UI toolkit and packaging decision before writing application code.
- Rust, GTK 4, libadwaita, the required GStreamer plugins, or `gst-plugin-gtk4`
  cannot be made available in the target distribution/Flatpak runtime.
- GStreamer does not preserve both protected headers on initial and Range/seek
  requests, or redirects would send them to a different origin.
- Successful playback requires session IDs in URLs, weakening TLS/caching/logging
  boundaries.
- An existing `/api` response differs from the typed contract enough to require a
  breaking server response change.
- A step requires changing the IP-based authorization model, database schema,
  Redis key formats, or any existing web/mobile response shape.
- ASS subtitle rendering requires executing external commands or trusting
  arbitrary attachment/font paths. Fall back to VTT and report the limitation.
- Any verification command fails twice after one scoped correction.
- Existing user changes in `server/src/index.js`, `server/src/routes/media.js`,
  or `server/src/routes/media.test.js` overlap the required patch.

## Maintenance notes

- Keep `ApiClient` and domain models UI-independent. This is the portability seam
  for a later Windows/macOS client or alternative native UI.
- Treat GStreamer callbacks as untrusted asynchronous events; every callback must
  be correlated with the current load sequence before mutating player state.
- Additive server response fields must not break deserialization. Renamed or
  removed fields require coordinated contract tests across web, mobile, and
  desktop.
- The first follow-up plan should add offline audio downloads using the existing
  `/api/offline/manifest`, `/download`, `/validate`, and `/sync` routes plus an
  XDG SQLite database modeled on `mobile/src/offline-store.js`. Do not mix that
  persistence work into v1 playback.
- Windows/macOS support is a separate product decision. GTK/GStreamer can be
  portable, but installation, codecs, signing, auto-update, and native desktop
  conventions need independent acceptance criteria.
- Reviewers should scrutinize header propagation, redirect behavior, session
  cleanup, stale async callbacks, main-thread GTK access, and accidental logging
  before focusing on visual polish.
