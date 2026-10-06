# Windows MSVC cross-package from Linux

The official `gstreamer-1.0-msvc-x86_64-1.28.6.exe` has SHA256
`059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5`.
It uses Inno Setup 6.7; `7z` 26.03 and `bsdtar` on this Linux host cannot
extract its payload. With operator authorization, the package source for this
plan is instead the supplied conda-forge `win-64` tree at
`pfs-sdk/conda-win/tree/`. Its 72 archives are pinned in
`SHA256SUMS-win.txt`. The runtime tree includes GStreamer 1.28.6 headers,
MSVC/UCRT `.lib` import libraries, and H.264 plugins.

Build the runtime stage without an application executable:

```bash
PFS_WIN_RUNTIME_ONLY=1 bash desktop/packaging/windows/build-win.sh
```

For a full cross-build in the shared Linux builder image, run
`npm run package:desktop:cross -- windows` from the repository root. The
image supplies Clang/LLVM, `cargo-xwin`, and NSIS. Its writable `cargo-xwin`
cache is under `dist/cache/cross-xdg`; the first build needs network access
to populate the MSVC CRT/Windows SDK cache.

This produces `dist/packages/Dogmedia-<version>-windows-x86_64-stage/Dogmedia`.
The tested stage contains 350 DLLs and passes `verify-dlls.py` with zero
missing non-system DLL imports. `runtime-dll-sha256.txt` pins those files.
`stage-runtime.py` excludes `pixbufloader-tiff.dll`, whose `tiff.dll` is
missing, and the unused FFmpeg 8 GPL DLL family. `gstlibav.dll` imports the
FFmpeg 9 LGPL DLL family. The stage also has `gstd3d11.dll`, `gstlibav.dll`,
and `openh264-7.dll`; usable decoder selection still needs a Windows VM test.
Freetype 2.13.3 and dav1d 1.2.0 are pinned dependencies that also need that
runtime smoke test. Before distribution, review license files for all bundled
conda packages; the tree's `info/licenses` directory is only one part of that
record.

For a full build, install `cargo-xwin`, the
`x86_64-pc-windows-msvc` Rust target, and NSIS `makensis`, and populate the
`cargo-xwin` MSVC CRT/Windows SDK cache. Then run the same command without
`PFS_WIN_RUNTIME_ONLY=1`. `prepare-pc.py` relocates conda's GStreamer `.pc`
prefixes and writes the missing GLib `.pc` entries against real headers and
import libraries. `build-win.sh` builds `Dogmedia.exe`, adds it to the stage,
and invokes `installer.nsi`. Its Start Menu shortcut points to
`Dogmedia.cmd`, which sets the bundled plugin path and a per-user GStreamer
registry. The expected artifact is
`dist/packages/Dogmedia-<version>-windows-x86_64-setup.exe`.

On the tested Linux host, the full build stops before Rust compilation:
`cargo-xwin` cannot download MSVC CRT metadata from `aka.ms` because DNS is
unavailable, and `makensis` is absent. `Dogmedia.exe`, NSIS output, Windows
installation, and H.264 playback therefore remain unverified. The installer
will be unsigned until a Windows signing job uses operator-provided
Authenticode credentials; SmartScreen can warn on unsigned packages.
