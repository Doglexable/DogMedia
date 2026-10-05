# Plan 044: Cross-compile desktop for macOS and package as .dmg from Linux

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9869988..HEAD -- .github/workflows/desktop-native.yml desktop/packaging/ desktop/Cargo.toml desktop/Dioxus.toml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: Plan 043 (ordering only — ship the offline local-folder
  fallback in the first macOS release; no technical dependency)
- **Category**: packaging
- **Planned at**: commit `9869988`, 2026-10-05

## Why this matters

The desktop client is Linux-only today (Flatpak, deb, rpm under
`desktop/packaging/`, Flatpak manifests under `desktop/flatpak/`, CI on
`ubuntu-24.04` in `.github/workflows/desktop-native.yml`). macOS users have
no installable artifact. This plan produces an unsigned `.dmg` built entirely
from Linux for testing/distribution, with official signing + notarization
deferred to a macOS CI runner (Apple requires it — Linux cannot sign).

Key platform facts the executor must respect:

- GStreamer on macOS does **not** use VA-API — hardware decode is `vtdec`
  (VideoToolbox). The `.app` must bundle the macOS GStreamer framework under
  `Contents/Frameworks` (or document it as a runtime prerequisite).
- A Linux-built `.dmg` is **unsigned**; Gatekeeper will warn/block it
  ("App is damaged"). That is expected for this plan, not a bug.
- `playbin3` + `appsink` pipeline is otherwise portable; no playback-code
  changes are expected.

## Current state

- `desktop/packaging/deb/build-deb.sh` + `control.in` — Debian packaging pattern to mirror.
- `desktop/packaging/rpm/build-rpm.sh` + `dogmedia-desktop.spec` — RPM pattern to mirror.
- `desktop/flatpak/com.dogmedia.Desktop.yml` — Flatpak manifest (portal-based file picking already assumed by Plan 043).
- `.github/workflows/desktop-native.yml` — single `ubuntu-24.04` job; extend or add a macOS job for sign/notarize only.
- No Apple targets, bundle scripts, or `Info.plist` exist yet
  (`rustup target list --installed` on executors shows Linux targets only).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Toolchain | `rustup target add aarch64-apple-darwin x86_64-apple-darwin` | exit 0 |
| Cross linker | `cargo install cargo-xwin` (preferred; fetches Apple SDK) **or** osxcross setup | exit 0 |
| Cross build | `cargo xwin build --target aarch64-apple-darwin --release -p dogmedia-desktop` | binary produced |
| DMG (simple) | `genisoimage -V Dogmedia -D -R -apple -no-pad -o Dogmedia.dmg dmg_root` | `.dmg` file produced |
| Gates | `cargo test -p dogmedia-desktop`, `cargo clippy -p dogmedia-desktop --all-targets -- -D warnings` | exit 0 |

## Scope

**In scope** (the only files you should create/modify):

- `desktop/packaging/macos/` (new): `build-mac.sh`, `Info.plist.in`,
  `dmg-settings.py` (if `dmgbuild` is chosen), GStreamer-framework notes
- `.github/workflows/desktop-native.yml` — add a macOS sign/notarize job
  (or a new `desktop-macos.yml`; prefer extending only if the file stays readable)
- `desktop/README.md` — macOS build requirements (SDK license: the Apple SDK
  comes from Xcode; `cargo-xwin` downloads it — record the licensing note)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):

- Playback/engine/video-surface code — no macOS-specific playback changes in this plan
- `desktop/flatpak/`, deb/rpm scripts — Linux packaging stays as-is
- Apple Developer certificates/secrets themselves (operator provides)
- Universal2 merging beyond `lipo` of the two arch binaries (allowed inside the new script)

## Git workflow

- Branch: `feat/044-macos-dmg-packaging`
- Commit style: `feat(desktop): cross-compile macOS binary and package DMG from Linux`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Cross-compile both Apple targets from Linux

- Install targets `aarch64-apple-darwin` + `x86_64-apple-darwin`.
- Prefer `cargo-xwin` over manual osxcross (fewer host prerequisites, SDK
  handling built in). Fall back to `cross` + osxcross only if `xwin` fails,
  and document why.
- GStreamer system deps do NOT exist for the Apple target on Linux hosts:
  build with `pkg-config` pointed at a macOS GStreamer framework cross-root,
  or vendor the framework first (Step 2) and link against it. If neither
  works, STOP (see STOP conditions) — do not stub out GStreamer.
- `lipo` the two binaries into one Universal2 binary (macOS `lipo` via
  `cctools-port` on Linux, or `lipo` on the macOS CI job as fallback).

**Verify**: `file target-universal/dogmedia-desktop` reports Mach-O 64-bit
executable for both `arm64` and `x86_64` (or two per-arch Mach-O binaries if
Universal2 is deferred with a documented reason).

### Step 2: Assemble `Dogmedia.app` with the GStreamer framework

Script `desktop/packaging/macos/build-mac.sh` must create:

```
Dogmedia.app/Contents/MacOS/Dogmedia        (Universal2 or arch binary)
Dogmedia.app/Contents/Resources/            (icon when available, skip if absent)
Dogmedia.app/Contents/Frameworks/           (macOS GStreamer framework)
Dogmedia.app/Contents/Info.plist            (from Info.plist.in: executable,
  CFBundleIdentifier e.g. com.dogmedia.Desktop, version from Cargo.toml)
```

- Decode on macOS is `vtdec`; verify the bundled framework contains it
  (`gst-inspect-1.0 vtdec` equivalent against the framework, or list the
  plugin dylib). If the framework lacks H.264 decode, STOP.
- Set `GST_PLUGIN_PATH`/`GST_REGISTRY` via a wrapper or `LSEnvironment` so
  the app finds the bundled framework without a system GStreamer install.

**Verify**: bundle tree matches the layout above; `otool -L` (or
`llvm-otool`) shows GStreamer dylibs resolving inside `@…/Frameworks`, not
`/usr/local`.

### Step 3: Build the `.dmg` on Linux

- Stage `dmg_root/` with `Dogmedia.app` + `Applications` symlink.
- Simple path: `genisoimage` hybrid image (documented limitation: no
  fancy background/layout).
- Pretty path: `dmgbuild` with `dmg-settings.py` (background, icon positions).
  Choose one, delete the other — do not ship two DMG pipelines.
- Name artifacts `Dogmedia-<version>-macos-<arch|universal>.dmg` with the
  version read from `desktop/Cargo.toml` (same source deb/rpm scripts use).

**Verify**: `.dmg` mounts on a real Mac (or `7z l` lists `Dogmedia.app` on
Linux as a smoke test when no Mac is available — record which one was done).

### Step 4: CI job for signing + notarization (macOS runner only)

- Add a `macos-latest` job that downloads the Linux-built unsigned `.dmg`
  (workflow artifact), then `codesign`, `notarytool submit`, `staple`.
- Secrets (`APPLE_ID`, team ID, app-specific password / API key) are the
  operator's job — the plan only wires secret *names*; never commit values.
- Linux jobs must not attempt signing (they cannot).

**Verify**: workflow YAML parses (`actionlint` if available, else
`python -c yaml.safe_load`); do NOT burn notarization quota in tests —
gate the job on release tags.

### Step 5: Docs + final verification

- `desktop/README.md`: Linux cross-build prerequisites (SDK license note),
  how to build the unsigned DMG, Gatekeeper expectation, and that official
  releases come from the signed CI job.
- **Verify**: `cargo test -p dogmedia-desktop` → exit 0 (packaging must not
  break the crate), repo gates for touched workspaces pass.

## Test plan

- No Rust behavior changes → existing test suites are the regression net.
- New coverage (if any): a shell-level assertion that the `.app` tree
  contains `MacOS/Dogmedia`, `Info.plist`, and `Frameworks/` (keep it as a
  script self-check, not a committed test harness, unless it proves stable).
- Manual matrix: mount DMG on Intel + Apple Silicon Macs; play H.264
  (exercises `vtdec`); confirm Gatekeeper warning on the unsigned build and
  clean launch on the stapled build.

## Done criteria

- [ ] Per-arch (or Universal2) Mach-O binary builds from Linux
- [ ] `Dogmedia.app` bundles the GStreamer framework with `vtdec` present
- [ ] Unsigned `.dmg` builds on Linux with versioned filename
- [ ] macOS CI job signs + notarizes on release tags (YAML valid, secrets unwired)
- [ ] `desktop/README.md` documents build, Gatekeeper, and SDK-license notes
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back if:

- Apple SDK cannot be obtained on the Linux host (license or download failure)
- GStreamer cannot link for `*-apple-darwin` from Linux (no cross framework,
  and framework-vendoring fails) — do not fake the dependency
- The bundled framework lacks a usable H.264 decoder for macOS
- Signing requires committing secrets or weakening Gatekeeper guidance
- Playback-code changes turn out to be necessary (that is a new plan, not this one)

## Maintenance notes

- Pinned `cargo-xwin`/SDK versions rot fast — record exact versions used.
- `vtdec` behavior (hardware vs fallback) should be smoke-tested per macOS
  release; VideoToolbox regressions are silent (fallback to software decode).
- If Plan 043 (local folder fallback) changes the file-picker dependency
  (`rfd`), re-check the macOS bundle still opens native dialogs (Tahoe/Finder
  portal differences vs Linux portals).
- Reviewer: confirm bundle identifier `com.dogmedia.Desktop` matches the
  Flatpak/app identity before first signed release.
