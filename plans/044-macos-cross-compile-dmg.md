# Plan 044: Cross-compile desktop for macOS (.dmg) and Windows (.exe) from Linux

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
- **Effort**: L
- **Risk**: MEDIUM
- **Depends on**: Plan 043 (ordering only — ship the offline local-folder
  fallback in the first macOS release; no technical dependency)
- **Category**: packaging
- **Planned at**: commit `9869988`, 2026-10-05
- **Execution**: BLOCKED on the Windows toolchain. Both Apple targets linked;
  architecture-specific app images were listed with `7z`, and the universal
  Apple media plugin contains `GstVtdec`. Mount/playback on a Mac is pending.
  The official Windows installer (SHA256
  `059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5`)
  uses Inno Setup 6.7 and cannot be extracted with the available Linux tools.
  The user supplied an alternate pinned conda-forge runtime/development tree.
  A runtime-only stage now contains 350 DLLs with zero missing non-system
  imports after excluding the TIFF loader and unused FFmpeg 8 DLLs. The
  Windows stage script and NSIS recipe are written, but `cargo-xwin` cannot
  initialize its MSVC CRT/SDK cache because DNS to `aka.ms` fails; `makensis`
  is also absent. The one-line source gate fix is Plan 058.

## Why this matters

The desktop client is Linux-only today (Flatpak, deb, rpm under
`desktop/packaging/`, Flatpak manifests under `desktop/flatpak/`, CI on
`ubuntu-24.04` in `.github/workflows/desktop-native.yml`). macOS and Windows
users have no installable artifact. This plan produces an unsigned `.dmg` and
an unsigned Windows installer, both built entirely from Linux for
testing/distribution, with official signing deferred to hosted CI runners
(Apple notarization needs macOS; Authenticode needs Windows — neither can be
done from Linux).

Key platform facts the executor must respect:

- GStreamer on macOS does **not** use VA-API — hardware decode is `vtdec`
  (VideoToolbox). The `.app` must bundle the macOS GStreamer framework under
  `Contents/Frameworks` (or document it as a runtime prerequisite).
- The official Windows 1.28.6 package is an Inno Setup 6.7 `.exe`, not an MSI.
  The user-authorized replacement runtime is built from pinned conda-forge
  win-64 packages using MSVC/UCRT import libraries. Use the
  `x86_64-pc-windows-msvc` Rust target via `cargo-xwin` to match that CRT
  family. The MinGW-GNU target remains a fallback only after a demonstrated
  MSVC cross-link failure and compatibility assessment.
- A Linux-built `.dmg` is **unsigned**; Gatekeeper will warn/block it
  ("App is damaged"). An unsigned Windows installer triggers SmartScreen
  ("Unknown publisher"). Both are expected for this plan, not bugs.
- `playbin3` + `appsink` pipeline is otherwise portable; no playback-code
  changes are expected on either OS.

## Current state

- `desktop/packaging/deb/build-deb.sh` + `control.in` — Debian packaging pattern to mirror.
- `desktop/packaging/rpm/build-rpm.sh` + `dogmedia-desktop.spec` — RPM pattern to mirror.
- `desktop/flatpak/com.dogmedia.Desktop.yml` — Flatpak manifest (portal-based file picking already assumed by Plan 043).
- `.github/workflows/desktop-native.yml` — single `ubuntu-24.04` job; extend or add OS jobs for sign-only steps.
- `desktop/Cargo.toml:24-25` — `gstreamer` + `gstreamer-video` 0.24 (compile-time
  linkage is why the Windows target/CRT choice matters — see Why).
- No bundle scripts, `Info.plist`, or NSIS scripts exist yet. The local
  executor already has both Apple Rust targets, the Windows MSVC target,
  macOS SDK 15.5, Zig 0.16.0, `cargo-zigbuild` 0.23.4, `cargo-xwin` 0.23.1,
  and the GStreamer macOS 1.28.6 runtime and development packages. Both
  packages have been downloaded and their SHA256 hashes verified.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Toolchain (mac) | `rustup target add aarch64-apple-darwin x86_64-apple-darwin` | exit 0 |
| Toolchain (win) | `rustup target add x86_64-pc-windows-msvc` | exit 0 |
| Cross linker (mac) | `SDKROOT=/path/to/MacOSX.sdk CARGO_ZIGBUILD_ZIG_PATH=/path/to/zig cargo zigbuild ...` (or osxcross) | exit 0 |
| Cross linker (win) | `cargo install cargo-xwin` (fetches Windows SDK + MSVC CRT) | exit 0 |
| Cross build (mac) | `cargo zigbuild --target aarch64-apple-darwin --release -p dogmedia-desktop` with `SDKROOT` and target GStreamer `pkg-config` paths | binary produced |
| Cross build (win) | `cargo xwin build --target x86_64-pc-windows-msvc --release -p dogmedia-desktop` | `.exe` produced |
| Extract macOS pkg | `bsdtar -xf ...pkg` then `7z x Payload` for each needed component | framework files, headers, and `.pc` files |
| Verify Windows vendor tree | `sha256sum -c desktop/packaging/windows/SHA256SUMS-win.txt` in `conda-win/`, then `build-win.sh` runtime-only mode | 72 archives pinned; 350 staged DLLs, zero non-system imports missing |
| DMG (simple) | `genisoimage -V Dogmedia -D -R -apple -no-pad -o Dogmedia.dmg dmg_root` | `.dmg` file produced |
| NSIS | `makensis desktop/packaging/windows/installer.nsi` | setup `.exe` produced |
| Gates | `cargo test -p dogmedia-desktop`, `cargo clippy -p dogmedia-desktop --all-targets -- -D warnings` | exit 0 |

## Scope

**In scope** (the only files you should create/modify):

- `desktop/packaging/macos/` (new): `build-mac.sh`, `Info.plist.in`,
  `dmg-settings.py` (if `dmgbuild` is chosen), GStreamer-framework notes
- `desktop/packaging/windows/` (new): `build-win.sh`, `installer.nsi`,
  pinned conda-forge package and staged-DLL manifests, runtime audit scripts,
  and vendor notes. The official `.exe` and its failed Linux extraction remain
  documented for provenance.
- `.github/workflows/desktop-native.yml` — add macOS sign/notarize and Windows
  Authenticode-sign jobs (or new `desktop-macos.yml` / `desktop-windows.yml`;
  prefer extending only if the file stays readable)
- `desktop/README.md` — macOS + Windows build requirements (SDK license: the
  Apple SDK comes from Xcode; record the community mirror provenance, license,
  SDK 15.5 version, and pristine archive hash;
  pin the GStreamer macOS runtime/development packages and Windows `.exe`
  version and hash)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):

- Playback/engine/video-surface code — no OS-specific playback changes in this plan
- `desktop/flatpak/`, deb/rpm scripts — Linux packaging stays as-is
- Apple Developer certificates / Windows code-signing certificates and secrets
  themselves (operator provides)
- Universal2 merging beyond `lipo` of the two arch binaries (allowed inside the new script)

## Git workflow

- Branch: `feat/044-macos-windows-packaging`
- Commit style: `feat(desktop): cross-compile macOS and Windows binaries and package installers from Linux`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Cross-compile both Apple targets from Linux

- Install targets `aarch64-apple-darwin` + `x86_64-apple-darwin`.
- Use `cargo-zigbuild` with `SDKROOT` pointing to the macOS 15.5 SDK and
  `CARGO_ZIGBUILD_ZIG_PATH` pointing to Zig 0.16.0. `cargo-xwin` supports
  Windows MSVC, not Apple targets; a direct Apple-target attempt used Linux
  `cc` and failed on `-arch arm64`. The local SDK archive SHA256 is
  `c15cf0f3f17d714d1aa5a642da8e118db53d79429eb015771ba816aa7c6c1cbd`.
  Its 437 `.tbd` files were normalized by removing `reexported-libraries`
  because Zig 0.15.2/0.16.0 crashed while parsing those entries; restore from
  the pristine archive if a link failure points to the SDK. Frameworks used
  through those reexports may need explicit `-framework` flags.
- GStreamer system deps do NOT exist for the Apple target on Linux hosts:
  extract the official 1.28.6 runtime **and development** `.pkg` files into
  a macOS GStreamer cross-root, then point target `pkg-config` at its `.pc`
  files. The runtime package alone lacks `glib-2.0.pc` and headers; the
  observed `cargo zigbuild` attempt stopped at `glib-sys` for that reason.
  `bsdtar` extracts the outer package; inspect each `Payload` and verify that
  `7z` extracts every `pbzx` chunk before unpacking the cpio archive. If the
  development package cannot be extracted
  or the target libraries still cannot link, STOP; do not use Linux GStreamer
  headers or libraries as a substitute.
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

### Step 4: Cross-compile the Windows target and bundle the GStreamer runtime

- Install target `x86_64-pc-windows-msvc` and build with `cargo xwin build
  --target x86_64-pc-windows-msvc --release -p dogmedia-desktop`. Fall back to
  `x86_64-pc-windows-gnu` (MinGW) only if MSVC cross-link fails, and document
  why: the GNU fallback risks CRT mismatch against the MSVC-built GStreamer
  DLLs below.
- Vendor the Windows GStreamer 1.28.6 runtime/development files from the
  user-supplied conda-forge `conda-win/tree/Library` tree. Verify all 72
  package archives against `SHA256SUMS-win.txt`, and require the actual
  headers, MSVC import libraries, plugins, and runtime DLLs. The upstream
  Inno Setup 6.7 `.exe` remains pinned by its hash but is not the bundle
  source: `7z` 26.03 and `bsdtar` cannot extract it on this Linux host.
  Relocate conda's `.pc` prefixes for cross-build and generate missing GLib
  `.pc` entries from the real headers and `.lib` files. Exclude
  `pixbufloader-tiff.dll` (its `tiff.dll` dependency is absent) and the unused
  FFmpeg 8 GPL DLL family; `gstlibav.dll` imports the FFmpeg 9 LGPL family.
  Re-run the PE import audit on the staged DLLs. If required real files or an
  H.264 plugin are absent, STOP; do not stub out GStreamer.
- Script `desktop/packaging/windows/build-win.sh` must stage:

```
Dogmedia/Dogmedia.exe        (the cross-built binary)
Dogmedia/*.dll               (GStreamer core and dependency DLLs:
  gstreamer-1.0-0, glib/gobject/intl, etc.)
Dogmedia/lib/gstreamer-1.0/*.dll (plugins, including an H.264 decoder)
Dogmedia/share/gstreamer-1.0/ (presets/registry support files as needed)
```

- The exe must find the bundled plugins without a system GStreamer install:
  set `GST_PLUGIN_PATH`/`GST_REGISTRY` via a launcher wrapper shipped beside
  the exe and point the installer shortcut at it. Keep plugin DLLs in their
  extracted plugin directory and avoid loading a system GStreamer installation.
- Verify the plugin set contains a usable H.264 decoder for Windows
  (`openh264dec`/`d3d11h264dec` or equivalent in the bundled DLLs). If none
  is present, STOP.

**Verify**: `file Dogmedia.exe` reports PE32+ x86-64 once the CRT/SDK cache
is available; `runtime-dll-sha256.txt` pins every bundled DLL. The runtime-only
stage must pass `verify-dlls.py` with zero missing non-system imports.

### Step 5: Build the Windows installer on Linux

- Write `desktop/packaging/windows/installer.nsi` (NSIS): install `Dogmedia/`
  to `$PROGRAMFILES64`, Start-Menu shortcut, Add/Remove-Programs entry,
  uninstaller. Build it on Linux with `makensis`.
- Choose ONE installer pipeline (NSIS) — a portable `.zip` of the same stage
  dir is an acceptable free byproduct, not a second pipeline to maintain.
- Name artifacts `Dogmedia-<version>-windows-x86_64-setup.exe` with the
  version read from `desktop/Cargo.toml` (same source deb/rpm/DMG scripts use).

**Verify**: installer builds on Linux; smoke-test the payload with
`7z l` (NSIS payload lists `Dogmedia.exe` + DLL set); full install test on a
real Windows VM, or record that it was not done.

### Step 6: CI jobs for signing (macOS + Windows runners only)

- macOS (`macos-latest`): download the Linux-built unsigned `.dmg`
  (workflow artifact), then `codesign`, `notarytool submit`, `staple`.
- Windows (`windows-latest`): download the Linux-built unsigned setup `.exe`
  and Authenticode-sign it (`signtool` with the operator's cert).
- Secrets (Apple ID/team/API key; Windows cert) are the operator's job — the
  plan only wires secret *names*; never commit values.
- Linux jobs must not attempt any signing (they cannot).
- Gate both sign jobs on release tags (do NOT burn notarization quota or
  timestamp counters in tests).

**Verify**: workflow YAML parses (`actionlint` if available, else
`python -c yaml.safe_load`).

### Step 7: Docs + final verification

- `desktop/README.md`: Linux cross-build prerequisites for BOTH targets (SDK
  provenance/license note for the Xcode SDK 15.5 archive and its SHA256;
  pinned GStreamer Windows `.exe` version and hash), how to build the
  unsigned DMG and setup exe, Gatekeeper/SmartScreen expectations, and that
  official releases come from the signed CI jobs.
- **Verify**: `cargo test -p dogmedia-desktop` → exit 0 (packaging must not
  break the crate), repo gates for touched workspaces pass.

## Test plan

- No Rust behavior changes → existing test suites are the regression net.
- New coverage (if any): shell-level assertions that the `.app` tree contains
  `MacOS/Dogmedia`, `Info.plist`, and `Frameworks/`, and that the Windows
  stage dir contains `Dogmedia.exe` plus the DLL manifest (keep these as
  script self-checks, not a committed test harness, unless they prove stable).
- Manual matrix: mount DMG on Intel + Apple Silicon Macs; install setup exe on
  a Windows VM; play H.264 on both (exercises `vtdec` / the Windows decoder);
  confirm Gatekeeper warning on the unsigned DMG, SmartScreen warning on the
  unsigned installer, and clean launch on the signed/stapled builds.

## Done criteria

- [x] Per-arch (or Universal2) Mach-O binary builds from Linux
- [x] `Dogmedia.app` bundles the GStreamer framework with `vtdec` present
- [x] Unsigned `.dmg` builds on Linux with versioned filename (Apple hybrid ISO;
      real Mac mount test pending)
- [ ] x86_64 Windows `.exe` builds from Linux (MSVC target preferred, GNU
      fallback documented if used)
- [x] Windows runtime-only stage bundles 350 DLLs with H.264 plugin candidates
      and zero missing non-system imports (VM decode test pending)
- [ ] NSIS setup exe builds on Linux with versioned filename
- [ ] macOS CI job signs + notarizes and Windows CI job Authenticode-signs on
      release tags (YAML valid, secrets unwired)
- [ ] `desktop/README.md` documents both builds, Gatekeeper/SmartScreen, and
      SDK-license + installer-pinning notes
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back if:

- Apple SDK cannot be obtained on the Linux host (license or download failure)
- GStreamer cannot link for `*-apple-darwin` from Linux (no cross framework,
  and framework-vendoring fails) — do not fake the dependency
- The bundled framework lacks a usable H.264 decoder for macOS
- The pinned conda-forge Windows tree lacks actual development files, fails
  its package hashes or PE import audit, or has no H.264 decoder plugin — do
  not fake the dependency
- MSVC-target cross-link fails AND the MinGW fallback shows CRT/DLL
  incompatibility (report both attempts with logs)
- Signing requires committing secrets or weakening Gatekeeper/SmartScreen guidance
- Playback-code changes turn out to be necessary (that is a new plan, not this one)

## Maintenance notes

- Pinned `cargo-zigbuild`/Zig/SDK and `cargo-xwin` versions rot fast — record
  exact versions used. Re-pin the 72 conda packages and DLL manifest
  deliberately, audit their licenses, and re-verify the H.264 decoder set on
  every bump. The official Inno installer hash is provenance only.
- `vtdec` behavior (hardware vs fallback) should be smoke-tested per macOS
  release; VideoToolbox regressions are silent (fallback to software decode).
  Same for the Windows decoder chain per release.
- If Plan 043 (local folder fallback) changes the file-picker dependency
  (`rfd`), re-check the macOS bundle still opens native dialogs (Tahoe/Finder
  portal differences vs Linux portals) AND the Windows build still opens the
  native file dialog.
- Reviewer: confirm bundle identifier `com.dogmedia.Desktop` matches the
  Flatpak/app identity before first signed release; confirm the Windows
  publisher name on the cert matches the product name before first signed
  installer.
