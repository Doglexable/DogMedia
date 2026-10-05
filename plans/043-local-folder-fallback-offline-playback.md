# Plan 043: Local folder fallback for offline desktop playback

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9869988..HEAD -- desktop/src/playback/engine.rs desktop/src/store/settings.rs desktop/src/ui/mod.rs desktop/src/ui/views/library.rs desktop/src/ui/views/sidebar.rs desktop/src/ui/views/shell.rs desktop/Cargo.toml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `9869988`, 2026-10-05 (renumbered from 038 to 043 on 2026-10-05; no content change)

## Why this matters

When the desktop client cannot reach the server (`check_access` fails),
`library.access` becomes `Unreachable` and the library renders nothing
(`desktop/src/ui/views/library.rs:120` returns `rsx! {}`). The user is stuck:
no playback path exists without a server, even for files sitting on their own
disk. `PlaybackEngine::open` (`desktop/src/playback/engine.rs:292-299`)
rejects every URL scheme except `http`/`https`, and there is no file picker
dependency in `desktop/Cargo.toml`.

This plan adds an offline local mode: pick a folder on the computer (audio +
video only, recursive, remembered across restarts), auto-open it when the
server is unreachable, and play its contents through the existing GStreamer /
wgpu pipeline without any server session, queue, report, or heartbeat traffic.

Decided scope (operator-confirmed 2026-10-05):

- Media: **audio + video only**. Photos are excluded — no local image-reading
  path is built.
- Scan is **recursive** (subfolders included, deterministic folder-then-file
  order) and the folder is **remembered** in `Settings`, auto-opened on the
  next offline start.
- When the server comes back online, local mode exits and the in-memory track
  list is discarded (the remembered folder path is kept).

## Current state

- `desktop/src/playback/engine.rs:292-299` (`open` rejects non-http/https):
```rust
    pub fn open(
        &self,
        session: &PlaybackSession,
        stream_url: &url::Url,
    ) -> Result<(), EngineError> {
        if !matches!(stream_url.scheme(), "http" | "https") {
            return Err(EngineError::InvalidStreamUrl);
        }
```
- `desktop/src/ui/views/library.rs:120` (offline renders nothing):
```rust
                            AccessView::Unreachable(_) => rsx! {},
```
- `desktop/src/ui/mod.rs:173` (boot maps client-creation failure to
  `Unreachable`) and `desktop/src/ui/mod.rs:441` (failed `check_access`
  sets `AccessView::Unreachable`).
- `desktop/src/store/settings.rs:27-39` (`Settings` is `#[serde(default)]`,
  so a new `Option<...>` field loads old files as `None` with no migration):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u8,
    pub configured: bool,
    ...
    pub window_width: i32,
    pub window_height: i32,
}
```
- `desktop/src/api/endpoints.rs` — photo bytes come from
  `client.photo(media.id)`; local mode must read from disk instead (photos
  excluded from scope, so no local image path is needed).
- `desktop/src/ui/mod.rs` — `heartbeat` already early-returns without a
  client/session; `play_media_at`, `navigate_queue`, `load_extras`,
  `set_favorite` all require `client` and must be bypassed in local mode.
- No file-dialog dependency exists (`grep -ri rfd desktop/Cargo.toml` →
  no match).

**Repo conventions**: Dioxus components in `desktop/src/ui/views/` with
`super::super::*` imports (sibling `ui/mod.rs` items are visible to views).
Per-row context menus follow the `use_signal::<Option<Id>>` + `div.context-menu`
pattern in `desktop/src/ui/views/library.rs:200-259`. Desktop tests live beside
the code (`#[cfg(test)] mod tests`) plus `desktop/tests/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Check | `cargo check -p dogmedia-desktop` | exit 0 |
| Tests | `cargo test -p dogmedia-desktop` | exit 0, all pass |
| Lint | `cargo clippy -p dogmedia-desktop --all-targets -- -D warnings` | exit 0 |
| Manual | `cargo run --release -p dogmedia-desktop` with server stopped | folder opens, audio/video play, next/prev work |

## Scope

**In scope** (the only files you should modify):

- `desktop/Cargo.toml` (+ `Cargo.lock`) — add `rfd` for the native folder picker
- `desktop/src/playback/engine.rs` — add `open_local(file_url)` accepting only `file://`
- `desktop/src/domain/` — new `LocalTrack` type (path, title, mime/kind, duration)
- `desktop/src/store/settings.rs` — remembered folder path field
- `desktop/src/ui/mod.rs` — local-mode state, `play_local_at`, local next/prev, server-only guards
- `desktop/src/ui/views/library.rs` — offline empty-state with "Open local folder" + "Retry"
- `desktop/src/ui/views/shell.rs` — surface the same entry point in the connection-error area
- `desktop/src/ui/views/sidebar.rs` — optional "Offline"/local indicator entry (only if trivial)
- New unit tests beside the touched modules

**Out of scope** (do NOT touch):

- `desktop/src/playback/coordinator.rs` snapshot shape — reuse as-is; do not add local-specific snapshot fields unless the compiler forces it
- Server code, web, mobile — local mode is desktop-only
- Uploading local files to the server, local library indexing/caching, local thumbnails/artwork, local resume sync — all stay server-only
- DMABuf zero-copy or decoder changes (see `desktop/docs/GPU_OFFLOAD_MAP.md`)

## Git workflow

- Branch: `feat/043-local-folder-offline-playback`
- Commit style: `feat(desktop): add local folder fallback for offline playback`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Domain type + folder scan

Create `desktop/src/domain/local.rs` (register in `desktop/src/domain/mod.rs`):

```rust
pub struct LocalTrack {
    pub path: PathBuf,
    pub title: String,      // file stem, no extension
    pub kind: LocalKind,    // Audio | Video (no Photo — out of scope)
    pub duration: Option<f64>, // None until played; filled from engine.duration()
}
```

Scanner rules (implement + unit-test with `tempfile`, which is already a
dev-dependency):

- Recursive walk, deterministic order (directories then files, sorted by name).
- Accept audio/video by extension: `mp3, ogg, opus, flac, wav, m4a, aac`
  (audio) and `mp4, mkv, webm, mov, avi` (video). Everything else ignored.
- Skip unreadable entries / symlink loops (do not follow symlinks out of the
  picked root; cap depth at ~16 to bound pathological trees).
- Title = file stem; keep the full path for playback.

**Verify**: `cargo test -p dogmedia-desktop local` → new scan tests pass
(extension filter, stem titling, recursive order, unreadable-dir tolerance).

### Step 2: `engine.open_local`

In `desktop/src/playback/engine.rs`, add beside `open`:

- Accept **only** the `file://` scheme (`InvalidStreamUrl` otherwise — same
  error variant as `open`).
- Clear protected headers (`*headers = None`), clear pending seek + PTS,
  set `playbin` state `Null`, set `uri`, clear the frame slot — i.e. the same
  reset sequence as `open`, minus session handling.
- Do NOT change caps (`NV12, RGBA` system memory) or the `new-sample`
  callback; the existing CPU→GPU upload path is reused as-is.

Add a unit test: `open_local` rejects `https://…` and accepts a `file://…`
URL without requiring GStreamer plugins (assert on the error variant for the
reject case; for accept, a missing-file URI must fail later at `play()`, not
in `open_local` itself).

**Verify**: `cargo test -p dogmedia-desktop playback::` → pass.

### Step 3: Folder picker dependency + remembered folder

- Add `rfd = "0.15"` (or newest compatible with the workspace resolver) to
  `desktop/Cargo.toml`. Run the folder dialog on a blocking thread
  (`tokio::task::spawn_blocking`) so the Blitz event loop never stalls.
- `desktop/src/store/settings.rs`: add
  `pub local_folder: Option<PathBuf>` (serde default → old files load as
  `None`; no `VERSION` bump required, but bump it if you touch anything else
  in the struct). Save on every successful pick.

**Verify**: `cargo check -p dogmedia-desktop` → exit 0; `cargo test
-p dogmedia-desktop` → still green.

### Step 4: Local-mode state + playback functions in `ui/mod.rs`

State on `NativeApp`:

```rust
local_tracks: Vec<LocalTrack>,
local_index: Option<usize>,
local_mode: bool,
```

Functions:

- `open_local_folder(app, engine, path)`: scan on `spawn_blocking`, store
  tracks, set `local_mode = true`, persist `settings.local_folder`, auto-play
  index 0 on success; on empty/unreadable folder set `app.status` with the
  reason and stay in the offline empty-state (do NOT enter local mode with
  zero tracks).
- `play_local_at(app, engine, index)`: bounds-check, `coordinator.load`-equivalent
  for the track (drive the existing coordinator snapshot so MPRIS, player bar,
  and progress keep working), `engine.open_local(&file_url)?` then
  `engine.play()`, volume applied from settings. No session, no
  `client.create_playback_session`, no `send_report`.
- `navigate_local(app, engine, forward)`: index ± 1 with clamp (no wrap unless
  coordinator repeat is `Queue`; keep it simple: clamp at ends), then
  `play_local_at`.
- Guards: when `local_mode` is true, skip `send_report`, resume save/load,
  `load_extras` (lyrics/subtitles), favorites, `load_queue`, and heartbeat
  lease logic. The cleanest seam: early-return in each of those call sites
  on `app.read().local_mode`, with a one-line comment referencing this plan.
- Auto-enter: after `connect` yields `Unreachable` (both boot path
  `ui/mod.rs:173` and retry path `ui/mod.rs:441`), if
  `settings.local_folder` is `Some` and readable, run `open_local_folder`
  automatically.
- Auto-exit: on the first successful `connect` (`AccessView::Ready`), set
  `local_mode = false` and clear `local_tracks`/`local_index` (keep
  `settings.local_folder`).

**Verify**: `cargo check -p dogmedia-desktop` → exit 0. Manual: stop the
server, launch, confirm the remembered folder opens and plays without any
`client` (watch for panics on `client.clone().expect`/unwraps — use the
`let Some(client) … else return` pattern already used in `play_media_at`).

### Step 5: UI entry points

- `desktop/src/ui/views/library.rs:120`: replace the empty `Unreachable` arm
  with an empty-state (reuse the `empty-state` markup style): "Server
  unreachable" + buttons "Open local folder" (spawns picker → Step 4) and
  "Retry connection" (existing `refresh(app)`).
- `desktop/src/ui/views/shell.rs` (~line 190, connection-error area): add the
  same "Open local folder" action next to retry.
- Player bar / queue panel: when `local_mode`, show track title + file-kind
  icon instead of server artwork; queue panel lists `local_tracks` with the
  current index highlighted (read-only list — no reorder/remove; server queue
  endpoints must not be called).
- `sidebar.rs`: only add a local indicator if it is a one-line change;
  otherwise skip (out of scope creep).

**Verify**: manual walkthrough — (a) server stopped, no remembered folder →
empty-state → pick folder → plays; (b) restart offline → auto-opens; (c)
start server + retry → back to server library, local state cleared.

### Step 6: Final verification

**Verify**: `cargo test -p dogmedia-desktop` → exit 0, all pass
**Verify**: `cargo clippy -p dogmedia-desktop --all-targets -- -D warnings` → exit 0
**Verify**: `git status --short` → only in-scope files modified

## Test plan

- New unit tests: folder scan (extension filter incl. photo exclusion,
  recursive deterministic order, unreadable entries skipped, depth cap);
  `open_local` scheme gate (reject `https`, accept `file`).
- No server mocks needed — local mode must not touch the network. A test
  asserting `play_local_at`'s call path performs zero HTTP would be ideal; at
  minimum, review the diff for any `client.` usage reachable with
  `local_mode == true`.
- Manual matrix: offline+remembered folder, offline+fresh pick,
  empty folder, unreadable folder, audio play, video play, next/prev at ends,
  server back online mid-playback (must switch cleanly, no panic, engine
  stopped or handed over — prefer `engine.stop()` before exiting local mode).

## Done criteria

- [ ] `cargo test -p dogmedia-desktop` exits 0 (incl. new scan + scheme tests)
- [ ] `cargo clippy -p dogmedia-desktop --all-targets -- -D warnings` exits 0
- [ ] Offline with remembered folder auto-opens and plays audio + video
- [ ] Offline without remembered folder shows empty-state with working picker
- [ ] Online retry exits local mode, clears the list, keeps the folder path
- [ ] No network calls occur in local mode (review + manual: server stopped)
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back if:

- `rfd` cannot be added (version conflict, or its native dialog blocks the
  Blitz event loop even via `spawn_blocking`)
- `playbin3` will not play `file://` URIs in this environment (missing
  `filesrc`/`decodebin` plugins — check with `gst-inspect-1.0 filesrc`)
- Driving the existing `PlaybackCoordinator` snapshot for local tracks
  requires changing `coordinator.rs` (reassess: introduce a parallel minimal
  snapshot instead)
- `Settings` deserialization breaks on old files after adding the field
  (serde `default` should prevent this — if not, a migration is needed and
  the effort estimate is wrong)
- The fix requires touching server, web, or mobile code

## Maintenance notes

- Shared file with Plan 040: both plans modify `desktop/src/ui/mod.rs`
  (this plan adds local-mode state/playback; 040 adds holder state/UI).
  No functional dependency either way, but do not execute both in the same
  worktree concurrently — serialize them and re-run the drift check.
- Extension lists (audio/video) will rot as formats change; consider a single
  `const` table in `domain/local.rs` shared by the scanner and any future
  "add files" flow.
- If photos are ever wanted locally, the missing piece is a disk-reading
  photo path (server uses `client.photo(id)`); the picker/scan/state work
  here is reusable.
- Flatpak/sandbox: `rfd` uses the document portal under Flatpak — confirm the
  manifest grants no extra filesystem permission beyond the portal, and that
  `/dev/dri` passthrough (for VA-API decode of local files) is unaffected.
- Reviewer: confirm "exit local mode on reconnect" vs "keep playing local
  file in background" — this plan chose the former for simplicity.
