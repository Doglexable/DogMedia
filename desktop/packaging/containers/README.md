# Shared macOS and Windows release builder

One Linux image contains Rust 1.98.1, `cargo-zigbuild` 0.23.4,
`cargo-xwin` 0.23.1, Clang/LLVM, NSIS, and macOS package extraction tools.
The builder mounts this repository at `/work` and reads the ignored
`pfs-sdk/` tree at runtime. The macOS SDK and GStreamer packages are not
copied into the image.
The image runs as `linux/amd64` to match the bundled Linux Zig executable.

From the repository root:

```bash
npm run package:desktop:cross -- mac
npm run package:desktop:cross -- windows
npm run package:desktop:cross -- all
```

The default engine is Podman, with Docker as a fallback. Set
`CONTAINER_ENGINE=docker` to select Docker explicitly. The image build needs
network access for the base image, Debian packages, Rust targets, and pinned
Cargo tools. The application build also needs network access on the first run
to fill `dist/cache/cross-cargo`. `cargo-xwin` obtains MSVC CRT and Windows
SDK inputs separately and stores them under `dist/cache/cross-xdg`; the
Windows build still needs these downloads even when Cargo crates are cached.
Set `PFS_CROSS_SKIP_IMAGE_BUILD=1` to reuse an existing builder image and
`PFS_CARGO_OFFLINE=1` after its Cargo crate cache is complete.

Outputs are written directly to `dist/packages/`. The macOS build also
creates `pfs-sdk/GStreamer.framework` once from the pinned `.pkg` files.
Use `PFS_MAC_ARCH=arm64` or `PFS_MAC_ARCH=x86_64` to select one macOS target.
`PFS_WIN_RUNTIME_ONLY=1` validates and stages the Windows runtime without
compiling `Dogmedia.exe` or creating an installer.

The macOS images and Windows installer are unsigned. Mounting and playback
on real Macs and Windows VMs remain separate release checks. The builder
cannot run the target applications on Linux.
