# Plan 060: Bound desktop UI memory on Linux, macOS, and Windows

> **Executor instructions**: Implement this plan in order. Preserve uncommitted
> changes, especially `desktop/src/ui/views/library.rs` and
> `desktop/assets/native.css`. Run each gate before proceeding. Update the row
> in `plans/README.md` when finished. Do not claim cross-platform acceptance
> from a Linux cross-build alone.
>
> **Drift check (run first)**: `git diff --stat c26a4d4..HEAD -- desktop/src/app.rs desktop/src/ui/mod.rs desktop/src/ui/views desktop/src/store/settings.rs desktop/src/diagnostics.rs desktop/src/main.rs desktop/Cargo.toml desktop/README.md`
> Also run `git status --short` and compare the excerpts below with the live
> code, including dirty files. Stop if the ownership/render paths changed.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none; Plan 057 and Plan 059 are already DONE
- **Category**: perf
- **Planned at**: commit `c26a4d4`, 2026-10-07
- **Execution status**: IN PROGRESS — shared-state and bounded-RAM image
  changes plus button-paged list rendering are applied in the main workspace.
  Native memory measurements and macOS/Windows runtime acceptance remain.

## Execution attempt (2026-10-07)

On 2026-10-08, a macOS Activity Monitor screenshot showed 338.3 MB after
stopping a locally played track while one item remained in the local list.
This is an observation, not a before/after baseline. The Stop path was found
to destroy the active playbin and immediately allocate a new one. Engine
creation is now deferred until the next playback request, and the video frame
receiver remains shared across engine replacements. Native macOS measurement
of the new build is still required to quantify the effect.

The first executor attempt used an isolated clone at
`/tmp/pfs-plan-060-executor`; its full test build exhausted the 3.8 GiB
`/tmp` filesystem. The safe source changes were subsequently applied to the
main workspace, preserving the user's pre-existing edits in
`desktop/src/ui/views/library.rs` and `desktop/assets/native.css`. All
`app.read().clone()` calls in desktop views were removed. Artwork now has
shared ownership with 96-entry and 16 MiB encoded-byte limits;
`artwork_url()` and `category_artwork_url()` return shared references to avoid
copying the encoded strings for each render. The full Linux desktop test suite
(67 unit, 11 API contract, 8 playback-state tests), `cargo check`, format,
clippy, and `git diff --check` all passed in the main workspace. Runtime memory
measurements and native macOS/Windows tests have not run.

The native scroll event dependency is
`dioxus-native-dom-0.7.10/src/events.rs:76-77`:
`convert_scroll_data` is `unimplemented!("todo: ... requires support in blitz")`.
`convert_wheel_data` is likewise unimplemented at line 97. Instead of
registering either event, the main workspace now renders at most 100 list rows
at a time and exposes Previous/Next page buttons. Loaded metadata and the
existing Load more action remain available; absolute indexes for playback are
preserved. The page resets when the browse generation, local scan generation,
or mode changes. This is a deliberate UI change from continuous scrolling
through all loaded rows to button paging. A focused page-window test passes;
native visual/interaction acceptance remains. Native memory baselines still
need fixed fixtures and actual macOS/Windows runtimes.

## Why this matters

Desktop keeps image data URLs, growing media lists, and local track indexes in
`NativeApp`. Most views clone the entire state while rendering, so a small UI
change can copy all of those collections. The previous playback leak was fixed
in Plans 057/059; this plan targets UI-owned data and must preserve that fix.
The implementation must work on the same Rust desktop client shipped for
Linux, macOS, and Windows, with native validation on each target.

## Current state

- `desktop/src/ui/mod.rs:132-176`: `NativeApp` owns `library`, `categories`,
  `dashboard`, `artwork`, `queue`, `local_tracks`, lyrics, subtitles,
  `photo_data_url`, settings and playback state. It derives `Clone`.
- `desktop/src/ui/views/shell.rs:15`, `library.rs:9`, `player_bar.rs:7`,
  `full_player.rs:13`, and other views start with
  `let snapshot = app.read().clone();`. This clones every owned `Vec`, `String`,
  and `HashMap`, including fields the view never reads. `player_bar.rs:14-18`
  additionally clones the full photo data URL.
- `desktop/src/ui/mod.rs:58-124`: artwork cache holds up to 96 `Ready(String)`
  data URLs; count is bounded, bytes are not. `:985-988` base64-encodes each
  image. `:1308-1315` base64-encodes the full current photo. `:1817-1826`
  clears image data, lyrics, and subtitles on Stop.
- `desktop/src/app.rs:24-36,40-75`: browse starts at 50 items and appends each
  loaded page to `items`. `desktop/src/ui/views/library.rs:192` renders every
  loaded item. `:34` renders every scanned local track. The current page uses
  an explicit Load more button at `:304-308`; preserve that behavior.
- `desktop/src/domain/local.rs:15-20,40-51` stores path/title/type/duration,
  not file contents. The full index is needed for previous/next navigation.
- `desktop/src/playback/engine.rs:107-115` caps GStreamer appsink at four
  buffers; `:64-75` recycles at most four frame vectors. `video_surface.rs`
  owns GPU textures. These are playback hot-path resources, not UI caches.
- `desktop/src/diagnostics.rs:121-151` reads Linux `/proc`; on macOS/Windows,
  `--memory-snapshot` returns an error and `--memory-watch` logs errors.
- `desktop/src/store/settings.rs:89-138` uses `directories::ProjectDirs` for
  per-user config and subtitle cache paths. No cross-platform image cache path
  or verified local-image URL route exists. Vendored `dioxus-native` has a
  `dioxus` asset route in `vendor/dioxus-native/src/assets.rs:32-54`, but this
  does not prove arbitrary cache files can be served by `<img>`.
- `desktop/packaging/macos/README.md` describes cross-built macOS images and
  requires real Mac runtime checks. `desktop/packaging/windows/README.md`
  describes the Windows stage and requires a Windows VM runtime check; the
  current Linux host cannot finish the Windows installer without CRT/SDK and
  NSIS inputs.

Conventions: Rust 2024, `snake_case` files/functions, component `PascalCase`,
in-module `#[cfg(test)]` tests (e.g. `desktop/src/ui/mod.rs:2826`), and
`cargo fmt`/`cargo clippy` gates. Keep the existing Dioxus Native, WGPU, and
GStreamer stack. Do not modify the server or WebSocket protocol.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Check local work | `git status --short` | Existing edits identified and preserved |
| Format | `cargo fmt --manifest-path desktop/Cargo.toml -- --check` | Exit 0 |
| Tests | `cargo test --locked --manifest-path desktop/Cargo.toml` | Exit 0 |
| Lint | `cargo clippy --locked --manifest-path desktop/Cargo.toml --all-targets -- -D warnings` | Exit 0 |
| Release build | `cargo build --release --locked --manifest-path desktop/Cargo.toml --bin dogmedia-desktop` | Exit 0 |
| Package smoke | `bash desktop/scripts/check-packaging.sh` | Exit 0 where its host prerequisites are installed; otherwise record missing tool and use target-host smoke below |

## Scope

**In scope**: `desktop/src/ui/mod.rs`, `desktop/src/ui/views/*.rs`,
`desktop/src/app.rs`, `desktop/src/diagnostics.rs`, `desktop/src/main.rs`,
`desktop/src/store/settings.rs` only if an image-cache path is introduced,
`desktop/Cargo.toml` only for a measured and necessary dependency,
`desktop/README.md` for memory diagnostics, and `plans/README.md` status.

**Out of scope**: server/Web/mobile; WebSocket wire data; queue/lease behavior;
GStreamer frame limits or decoder, WGPU video texture code; vendor patches;
the packaging scripts and signed releases; arbitrary persisted media copies.

## Git workflow

- Branch if isolation is needed: `perf/060-desktop-ui-memory`.
- Preserve dirty user changes in `library.rs` and `native.css`; never reset or
  stash them without the operator's direction.
- Commit style: `perf(desktop): bound native UI memory`.
- Do not push or publish without an explicit request.

## Steps

### Step 1: Establish a reproducible baseline on each available OS

Build the release application and record the process's private memory before
and after: idle library, 10 Load more pages, a large local folder, a large
photo, 5 minutes paused, and Stop. Keep media inputs and elapsed time fixed
for before/after comparisons; record item count, image byte size, and OS/arch.
On Linux, use `--memory-watch`/`/proc/<pid>/smaps_rollup`; on macOS, use
Activity Monitor or `vmmap <pid> -summary`; on Windows, use Task Manager
private working set or Process Explorer private bytes. Do not compare raw RSS
between OSes as if the allocators and GPU drivers were identical. For a target
not currently runnable, mark its baseline `NOT RUN — <reason>` and require
native acceptance in Step 5. Record results in a new memory section of
`desktop/README.md` with the exact scenario and command/tool.

**Verify**: `rg -n 'Memory baseline|Linux|macOS|Windows|NOT RUN' desktop/README.md`
→ baseline table includes all three OS rows and honest availability labels.

### Step 2: Remove whole-state clones from hot render paths

Inspect each `app.read().clone()` in `desktop/src/ui/views/`. Replace it with
a short read guard and clone only the small values captured by event handlers
or needed after releasing the guard. For heavy shared immutable values that
must outlive the guard, use `Arc` at the owning state boundary and test that
cloning the view projection only increases its reference count. Preserve
existing UI behavior, including menu callbacks and photo rendering. Do not
hold a read guard while taking an `app.write()` guard or across `await`.
Use `desktop/src/ui/mod.rs:600-610` as the existing pattern for extracting
needed fields before dropping a read guard. `NativeApp` may retain `Clone`
temporarily, but no UI render should clone it wholesale.

**Verify**: `rg -n 'app\.read\(\)\.clone\(\)' desktop/src/ui/views` → no matches;
then run format, tests, and clippy from the command table → all exit 0.

### Step 3: Bound image ownership without assuming file URL support

Make `ArtworkState::Ready` and the currently displayed photo shareable, so
view projections do not duplicate base64 strings. Keep the current 96-entry
count limit, and add a measured byte budget with oldest-first eviction in
`ArtworkCache` (size of encoded strings, not just item count). Ensure an image
larger than the budget may be displayed as the current photo without pinning
it in the thumbnail cache; failed/loading entries must still retry as before.
Preserve the existing Stop cleanup. Use a cache unit test with differently
sized image strings to prove both count and byte eviction, replacing no
existing artwork-version behavior tests.

For moving encoded images to disk, first make a tiny renderer proof on each
native target that a file in `ProjectDirs::cache_dir()` can be loaded through
the selected `<img src>` scheme. Do not use raw `file://` or a `dioxus` route
unless the proof succeeds on Linux, macOS, and Windows. If it succeeds, add a
version-keyed, atomic-write, size-limited disk cache with deletion on eviction;
keep only keys/paths and a small hot image set in RAM. If any target cannot
load it, retain the shared, byte-bounded RAM implementation and record the
failed proof in `desktop/README.md`; do not invent an OS-specific rendering
path. This gate prevents a memory optimization from breaking artwork on an
other OS.

**Verify**: `cargo test --locked --manifest-path desktop/Cargo.toml artwork`
→ count, byte-budget, version-key, oversize, and eviction tests pass; full
format/tests/clippy gates exit 0.

### Step 4: Bound library rendering before evicting metadata

Keep the paginated API and Load more button. Native scroll/wheel callbacks are
unimplemented in the current renderer, so materialize at most 100 rows and
use Previous/Next page buttons on both library and local-file lists. Preserve
absolute indexes, keyboard behavior, context menus, and selected/playing row
identity. Reset the page when the browse generation, local scan generation,
or mode changes. Keep the compact local track index for next/previous
navigation; do not move it to disk merely to lower RAM when a folder contains
only paths and titles. Add a deterministic page-window helper with tests for
empty, first, middle, and last pages. Only evict old library metadata pages
from RAM if Step 1 shows metadata remains a material source of growth after
whole-state cloning and row materialization are fixed.

**Verify**: `cargo test --locked --manifest-path desktop/Cargo.toml window`
→ helper tests pass; full format/tests/clippy gates exit 0. Manual list test
uses >500 items and confirms first/last page navigation and
play/next/previous.

### Step 5: Verify native behavior and memory on every desktop OS

Repeat Step 1 with the same fixtures on Linux, native macOS, and native
Windows/VM builds. Confirm images, photos, scrolling, local playback,
connected playback, pause/seek/Stop, and window resize. Compare each target
against its own baseline. Acceptance: no sustained private-memory growth
while idle/paused after warm-up, no loss of visible content, and a lower peak
or stable plateau for the large-photo and >500-item scenarios. Record the
numbers and OS/arch in `desktop/README.md`; leave this plan `IN PROGRESS` if
any target runtime test is unavailable. Cross-compilation alone is a build
check, not native acceptance.

**Verify**: `cargo build --release --locked --manifest-path desktop/Cargo.toml --bin dogmedia-desktop`
and the format/tests/clippy gates exit 0; the README table has before/after
measurements for Linux, macOS, and Windows, with no `NOT RUN` rows.

## Test plan

- Extend the in-module artwork cache tests in `desktop/src/ui/mod.rs`, following
  `artwork_cache_remains_bounded`, for byte limit and eviction ordering.
- Add focused pure window-helper tests in `desktop/src/app.rs` or the view
  module. Test absolute index mapping separately from visual smoke tests.
- Keep existing playback and API tests passing. Do not add tests that merely
  check field type changes or mirror the implementation.
- Native smoke and memory measurements are required because unit tests cannot
  prove renderer URL support, GPU allocation, or process memory behavior.

## Done criteria

- [ ] All three native OS smoke runs and before/after measurements are recorded.
- [ ] No whole-`NativeApp` clone remains in desktop views.
- [ ] Artwork cache is bounded by count and encoded bytes; current photo is
      shared across view projections; Stop releases image references.
- [ ] Library and local views materialize at most 100 rows with working
      selection, page navigation, keyboard handling, and Load more.
- [ ] Disk image cache is used only if the chosen URL scheme passed all three
      native renderer proofs; otherwise the RAM fallback and failed proof are
      documented.
- [ ] Format, tests, clippy, release build, and applicable packaging smoke pass.
- [ ] Only in-scope files changed; `plans/README.md` row is updated.

## STOP conditions

Stop and report instead of improvising if the current state excerpts drift,
the dirty `library.rs` changes cannot be preserved, Dioxus requires holding a
read guard across `app.write()`, or an image URL route works on one OS but not
the others. For the latter, complete the shared bounded-RAM fallback and
report that disk cache was deferred. If native macOS or Windows access is
unavailable, finish automated gates and report `IN PROGRESS`; do not mark DONE.

## Maintenance notes

- Re-check clone and byte-budget behavior whenever fields are added to
  `NativeApp` or image formats change.
- Reviewers should inspect interaction correctness after button paging;
  rendering fewer rows must not change queue indexes or playback selection.
- The Linux-only diagnostic command remains Linux-specific. Native memory
  tools are the acceptance source on macOS and Windows until a separately
  scoped portable diagnostic is justified.
