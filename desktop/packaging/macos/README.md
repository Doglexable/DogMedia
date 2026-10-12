# macOS cross-build inputs

This directory builds unsigned architecture-specific application archives on
Linux. Run `prepare-framework.sh` to assemble `pfs-sdk/GStreamer.framework`
from the pinned runtime and development packages. `build-mac.sh` uses that
directory by default; `GST_FRAMEWORK_ROOT` can override it. Its `Versions/1.0/lib/pkgconfig`
must contain `glib-2.0.pc`, `gstreamer-1.0.pc`, and `gstreamer-video-1.0.pc`.
The framework must also contain
`Versions/1.0/lib/gstreamer-1.0/libgstapplemedia.dylib` with `GstVtdec`.
The script reads the SDK and Zig executable from the ignored repository
directory `pfs-sdk/` by default. `SDKROOT` and `CARGO_ZIGBUILD_ZIG_PATH`
can override those paths.

Tested input archives:

| Input | SHA256 |
| --- | --- |
| macOS 15.5 SDK pristine archive | `c15cf0f3f17d714d1aa5a642da8e118db53d79429eb015771ba816aa7c6c1cbd` |
| `gstreamer-1.0-1.28.6-universal.pkg` | `a8eb366c59b7e9e5dc049848fed6bcd203a8878aa7517c051639fda78797c6ad` |
| `gstreamer-1.0-devel-1.28.6-universal.pkg` | `177b1428d0f47b844e7bff2aeeb22047686d802eba21580dab52f4a6fe1dcf02` |

The GStreamer packages come from `gstreamer.freedesktop.org/pkg/osx/1.28.6/`.
The SDK comes from Xcode; the tested archive was obtained from the community
`joseluisq/macosx-sdks` mirror. Check Apple's Xcode license before acquiring
or redistributing SDK contents. The SDK is a build input, never part of the
application image.

The `.pkg` files are xar archives. `prepare-framework.sh` streams selected
component `Payload` members through the pbzx decoder and `cpio`, then merges
the framework files from runtime and development components into one root.
It includes core runtime, Apple media plugins, and the core/base development
headers and `.pc` files.
The prepared tree omits static `.a` archives because the release links
against the framework dylibs.
The build uses the framework dylibs from this extraction, not Linux libraries.
The package script repairs framework symlinks that point one directory too
deep after the component payloads are merged.
The staged app omits build headers, pkg-config/CMake metadata, GObject
introspection data, and optional GStreamer cloud, conferencing, speech,
disc-burning, and tracing plugins. The prepared SDK remains complete for
cross-compilation. Keep the Apple media and normal playback plugins in the
bundle; playback still needs verification on an actual Mac.

The local SDK copy used for this build had 437 `.tbd` files with
`reexported-libraries` sections removed. This works around Zig 0.15.2 and
0.16.0 crashing while parsing those entries. The build script adds explicit
ColorSync and CarbonCore link flags for symbols normally provided through
reexports. Restore the untouched SDK from the pristine archive when the
linker bug is fixed.

The Linux cross-build produces `.zip` archives with preserved Unix symlinks.
Previous builds incorrectly named an Apple hybrid ISO `.dmg`; those files are
not native UDIF disk images and must not be distributed as DMGs. `7z l` checks
the archive structure on Linux. On a Mac, extract the ZIP with Finder, move
`Dogmedia.app` into Applications, then open it. Since the app is unsigned,
macOS may require the user to select **Open Anyway** in System Settings →
Privacy & Security after the first launch attempt. A warning-free public
release requires Developer ID signing and Apple notarization on macOS.
Installation, `vtdec` playback, and Gatekeeper behavior still require real Mac
tests. A small Mach-O launcher at
`Contents/MacOS/Dogmedia` sets the plugin path and a per-user registry
location before starting the application binary at
`Contents/MacOS/Dogmedia-bin`.
