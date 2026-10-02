# Dogmedia Desktop

Dogmedia Desktop is a native Linux client written in Rust with Dioxus Native,
Blitz/WGPU, and GStreamer. It is not an Electron/Tauri wrapper and does not
load the web application in an embedded browser. Dioxus Native and Blitz are
still beta software, so GPU/backend-specific rendering issues should be
reported with the `RUST_LOG=info` startup output.

## Requirements

- Rust 1.88 or newer
- Vulkan loader and a Mesa or vendor GPU driver
- GStreamer 1.24 or newer, including the base plugins and codecs needed by
  your media library
- `pkg-config`, a C toolchain, and Git
- A running Dogmedia server reachable from this computer

Install the native packages for your distribution before building.

Arch Linux / Manjaro:

```bash
sudo pacman -S --needed base-devel rust gstreamer \
  gst-plugins-base gst-plugins-good gst-plugins-bad \
  gst-plugins-ugly gst-libav vulkan-icd-loader
```

Debian 13 or newer:

```bash
sudo apt install build-essential cargo rustc pkg-config \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-libav libvulkan1 mesa-vulkan-drivers
```

Fedora 41 or newer:

```bash
sudo dnf install gcc rust cargo pkgconf-pkg-config \
  gstreamer1-devel gstreamer1-plugins-base-devel \
  gstreamer1-plugins-base gstreamer1-plugins-good \
  gstreamer1-plugins-bad-free gstreamer1-plugin-libav \
  vulkan-loader mesa-vulkan-drivers
```

If the packaged Rust compiler is older than 1.88, install current stable Rust
with [rustup](https://rustup.rs/) and restart the shell before continuing.

## Build and run

From the repository root:

```bash
cargo build --release --manifest-path desktop/Cargo.toml
./desktop/target/release/dogmedia-desktop
```

For development, `npm run dev:desktop` runs the Dioxus Native client through
the `dx` CLI with the Blitz renderer. Install Dioxus CLI 0.7.10 first with
`cargo install dioxus-cli --version 0.7.10 --locked`. Tests are available
through `npm run test:desktop` and
`npm run test:desktop:native`.

The native client provides the shell, live library
browsing and filters, protected audio playback, resume/seek/volume controls,
queue navigation and mutation, favorites, lyrics, subtitle selection, and
ten-second playback lease heartbeats. Video frames use a persistent WGPU
texture, while protected photos render directly from their fetched bytes.

## Interface

The desktop uses the same Dogmedia Vault hierarchy as the web client while
remaining a native Dioxus/Blitz application. A persistent library rail provides
All Media, Favorites, category navigation, connection state, and settings. The
workspace combines header search, media-type filters, an artwork-led featured
item, and a dense paginated media list.

Active media appears in a compact player anchored to the bottom of the window.
Open it to enter the full player: audio uses a cover-and-lyrics layout, video
uses the single persistent WGPU surface with subtitle overlay, and photos use a
contained image stage. Queue and settings open as focused panels without
interrupting playback. Light, dark, and system appearances share the web
client's paper, ink, and rose design tokens.

The supported minimum window width is 760px. At narrower desktop widths the
interface removes secondary metadata before primary navigation or playback
controls. See `docs/web-ui-parity.md` for the web/native surface matrix and
Blitz CSS compatibility decisions.

### Dioxus Native video spike

The Phase 0 renderer spike is an isolated binary that feeds the existing
GStreamer RGBA appsink frames into a persistent Blitz/WGPU texture. The
preferred real-stream test creates, renews, and releases its own protected
playback session. Run it in a graphical
session with the server origin and a 1080p24 video media ID:

```bash
cargo run --release --manifest-path desktop/Cargo.toml \
  --no-default-features --features video-spike --bin video-spike -- \
  --media 'https://media.example.com/' 42 ori
```

Quality defaults to `ori`; use `high` if the client IP does not have original
quality access. A random viewer ID is generated for the benchmark, or a stable
one can be supplied after the quality argument. The legacy form accepting a
stream URL, session ID, and viewer ID remains available for diagnosing a
session created elsewhere. Managed `--media` playback loops at end-of-stream
so even a short benchmark clip can produce several five-second cadence
windows. Close it after at least three stable reports.

The spike prints the source dimensions and five-second upload-rate windows to
stderr. It also reports GStreamer end-of-stream and playback errors, so a
failed protected request or missing decoder is distinguishable from renderer
failure. The Phase 0 gate requires a 1080p24 source to remain visually smooth
at approximately 24 uploaded frames per second. The GStreamer handoff is a
single replaceable frame slot, so its queue capacity cannot grow beyond one.
Close the window to stop playback. Session and viewer IDs are sent as the same
protected request headers used by the production playback engine. Managed
sessions send the same ten-second heartbeat as the production client and are
released when the window closes.

For a renderer-only smoke test when an HTTP media source is unavailable, use
`--synthetic` instead of the URL and IDs. This drives the same Blitz/WGPU
texture upload path with a generated 1920×1080 frame at 24fps, but it does
not satisfy the protected-stream Phase 0 gate. Always benchmark a release
build; debug builds add enough per-frame overhead to invalidate throughput
measurements.

Run the native dependency/source guard with
`npm run check:desktop:native` and validate the package scripts/manifests with
`npm run check:desktop:packaging`. To exercise the same spike with GPU access
in a Flatpak sandbox, install the GNOME 50 runtime/SDK and Rust extension
listed below, then run:

```bash
flatpak-builder --user --install --force-clean .flatpak-video-spike \
  desktop/flatpak/com.dogmedia.VideoSpike.yml
flatpak run com.dogmedia.VideoSpike \
  --media 'https://media.example.com/' 42 ori
```

To install the release for the current user:

```bash
install -Dm755 desktop/target/release/dogmedia-desktop \
  "$HOME/.local/bin/dogmedia-desktop"
install -Dm644 desktop/resources/com.dogmedia.Desktop.desktop \
  "$HOME/.local/share/applications/com.dogmedia.Desktop.desktop"
install -Dm644 desktop/resources/icons/com.dogmedia.Desktop.svg \
  "$HOME/.local/share/icons/hicolor/scalable/apps/com.dogmedia.Desktop.svg"
install -Dm644 desktop/resources/com.dogmedia.Desktop.metainfo.xml \
  "$HOME/.local/share/metainfo/com.dogmedia.Desktop.metainfo.xml"
```

`~/.local/bin` must be on `PATH` for both the terminal and desktop session. If
the launcher cannot find the command after installation, sign out and back in
so the desktop session reloads its environment.

## Debian and Ubuntu package

Build the package on the oldest Debian/Ubuntu release you intend to support;
the resulting native binary is linked against that system's libraries. Install
the build dependencies listed above plus `dpkg-dev`, then run from the
repository root:

```bash
sudo apt install dpkg-dev
npm run package:desktop:deb
```

The versioned package is written to `dist/packages/`. Install or upgrade it
with APT so runtime dependencies are resolved automatically:

```bash
sudo apt install ./dist/packages/dogmedia-desktop_0.1.0_amd64.deb
```

The architecture and version in the filename are detected automatically and
may differ from this example. Remove the application with
`sudo apt remove dogmedia-desktop`.

## Fedora and RPM package

Build on the oldest Fedora release you intend to support. Install the Fedora
build dependencies listed above plus `rpm-build`, then run:

```bash
sudo dnf install rpm-build
npm run package:desktop:rpm
```

The RPM is written to `dist/packages/`. Install it through DNF so runtime
dependencies are resolved:

```bash
sudo dnf install ./dist/packages/dogmedia-desktop-0.1.0-1.*.rpm
```

The release and architecture portion of the filename may differ. Remove the
application with `sudo dnf remove dogmedia-desktop`.

Both package scripts first perform a release build and install the
binary, desktop launcher, scalable icon, AppStream metadata, and license into
the package. Set `PFS_PACKAGE_OUTPUT_DIR` to override the output directory.

### Build both packages from any Linux distribution

Podman or Docker can build both artifacts in their native distribution
containers, so a Manjaro/Arch host does not need `dpkg-dev` or `rpm-build`:

```bash
npm run package:desktop:containers
```

Build only one format by passing its name after `--`:

```bash
npm run package:desktop:containers -- deb
npm run package:desktop:containers -- rpm
```

Podman is selected when both engines are installed. To select Docker instead:

```bash
CONTAINER_ENGINE=docker npm run package:desktop:containers
```

The Debian build uses Debian 13 (Trixie), while the RPM build uses Fedora 43.
Each container performs a release build, creates its package under
`/packages`, and copies it to the host's `dist/packages/` directory. Container
images remain cached to make later builds faster and may be removed normally
with the selected container engine when no longer needed.

## Flatpak

Install Flatpak and Flatpak Builder, then add the Flathub repository and the
GNOME 50 SDK/runtime:

```bash
flatpak remote-add --user --if-not-exists flathub \
  https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.gnome.Platform//50 org.gnome.Sdk//50 \
  org.freedesktop.Sdk.Extension.rust-stable//25.08
```

Build from the repository root. The local manifest permits network access
during the build so Cargo can retrieve the exact versions in `Cargo.lock`.

```bash
flatpak-builder --user --install --force-clean .flatpak-build \
  desktop/flatpak/com.dogmedia.Desktop.yml
flatpak run com.dogmedia.Desktop
```

This is a developer/local-build manifest, not a published Flathub package.

## First launch and use

1. Start Dogmedia and confirm this computer's IP is allowed by the server.
2. Open Dogmedia Desktop and enter the origin that exposes the Dogmedia API,
   for example `https://media.example.com/` or `http://192.168.1.20:3001/`.
3. Confirm plain HTTP only for a server on a trusted LAN. Use HTTPS across
   untrusted networks.
4. Search or filter the library, then select an item to begin playback.

The client creates a persistent viewer ID on first launch. It is not a login
credential: the server's PostgreSQL IP whitelist remains the access control.
The ID associates playback leases, queues, reporting, and resume positions
with this installation. Settings live in the platform's XDG configuration
directory (normally `~/.config/dogmedia/Desktop/settings.json`); downloaded
subtitle cache files live under the corresponding XDG cache directory.

## Included scope and current limits

The current release supports native browsing, search, media-type/category and
favorite filters, photo viewing, GStreamer audio/video playback, seeking,
volume and quality selection, next/previous navigation, resume positions,
favorites, queue add/play-next/remove/clear/shuffle/select, plain lyric text,
and subtitle track selection.

- Lyrics are shown as complete text. Time-synchronized lyric highlighting is
  not available yet.
- Queue order can be viewed and changed through the available queue actions,
  but drag-and-drop/manual queue reordering is not available yet.
- Offline downloads, library administration, MPRIS/media-key integration, and
  desktop notifications are not included in this release.
- Playback codec availability depends on the installed GStreamer plugins.

## Troubleshooting

Run with logs enabled when diagnosing startup or API problems:

```bash
RUST_LOG=dogmedia_desktop=debug dogmedia-desktop
```

If video is blank or a codec is reported missing, verify the GStreamer
installation with `gst-inspect-1.0 playbin3` and install the codec/plugin
package for the media format. An access-denied screen means the computer's IP
does not have the required server whitelist tier; it is not fixed by changing
the local viewer ID.
