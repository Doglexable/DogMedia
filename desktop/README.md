# Dogmedia Desktop

Dogmedia Desktop is a native Linux client written in Rust with Iced and
GStreamer. It is not an Electron/Tauri wrapper and does not
load the web application in an embedded browser.

## Requirements

- Rust 1.88 or newer (required by Iced 0.14)
- GStreamer 1.24 or newer, including the base plugins and codecs needed by
  your media library
- `pkg-config`, a C toolchain, and Git
- A running Dogmedia server reachable from this computer

Install the native packages for your distribution before building.

Arch Linux / Manjaro:

```bash
sudo pacman -S --needed base-devel rust gstreamer \
  gst-plugins-base gst-plugins-good gst-plugins-bad \
  gst-plugins-ugly gst-libav
```

Debian 13 or newer:

```bash
sudo apt install build-essential cargo rustc pkg-config \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-libav
```

Fedora 41 or newer:

```bash
sudo dnf install gcc rust cargo pkgconf-pkg-config \
  gstreamer1-devel gstreamer1-plugins-base-devel \
  gstreamer1-plugins-base gstreamer1-plugins-good \
  gstreamer1-plugins-bad-free gstreamer1-plugin-libav
```

If the packaged Rust compiler is older than 1.88, install current stable Rust
with [rustup](https://rustup.rs/) and restart the shell before continuing.

## Build and run

From the repository root:

```bash
cargo build --release --manifest-path desktop/Cargo.toml
./desktop/target/release/dogmedia-desktop
```

For development, `npm run dev:desktop` runs the debug build. Tests are
available through `npm run test:desktop`.

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
GNOME 47 SDK/runtime:

```bash
flatpak remote-add --if-not-exists flathub \
  https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.gnome.Platform//47 org.gnome.Sdk//47 \
  org.freedesktop.Sdk.Extension.rust-stable//24.08
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
