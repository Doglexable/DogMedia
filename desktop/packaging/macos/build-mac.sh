#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
desktop_root="$repo_root/desktop"
framework="${GST_FRAMEWORK_ROOT:-$repo_root/pfs-sdk/GStreamer.framework}"
sdk="${SDKROOT:-$repo_root/pfs-sdk/MacOSX.sdk}"
zig="${CARGO_ZIGBUILD_ZIG_PATH:-$repo_root/pfs-sdk/zig-x86_64-linux-0.16.0/zig}"
output_dir="${PFS_MAC_OUTPUT_DIR:-$repo_root/dist/packages}"
arch_choice="${PFS_MAC_ARCH:-both}"

[[ -d "$framework/Versions/1.0/lib" ]] || { echo "GStreamer framework library directory missing" >&2; exit 1; }
[[ -f "$framework/Versions/1.0/lib/gstreamer-1.0/libgstapplemedia.dylib" ]] || { echo "Apple media plugin missing" >&2; exit 1; }
strings "$framework/Versions/1.0/lib/gstreamer-1.0/libgstapplemedia.dylib" | grep 'GstVtdec' >/dev/null || { echo "VideoToolbox decoder missing" >&2; exit 1; }
[[ -d "$sdk/System/Library/Frameworks" && -x "$zig" ]] || { echo "SDK or Zig missing" >&2; exit 1; }
export SDKROOT="$sdk"
export CARGO_ZIGBUILD_ZIG_PATH="$zig"
command -v cargo >/dev/null
command -v zip >/dev/null
command -v 7z >/dev/null

version="$(awk -F '"' '/^\[package\]/{p=1; next} p && /^\[/{exit} p && /^version = /{print $2; exit}' "$desktop_root/Cargo.toml")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Cannot read Cargo package version" >&2; exit 1; }

case "$arch_choice" in
  arm64) targets=(aarch64-apple-darwin) ;;
  x86_64) targets=(x86_64-apple-darwin) ;;
  both) targets=(aarch64-apple-darwin x86_64-apple-darwin) ;;
  *) echo "PFS_MAC_ARCH must be arm64, x86_64, or both" >&2; exit 1 ;;
esac

export PKG_CONFIG_ALLOW_CROSS=1
export PKG_CONFIG_LIBDIR="$framework/Versions/1.0/lib/pkgconfig"
export PKG_CONFIG_PATH=
export PKG_CONFIG_SYSROOT_DIR=/
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$repo_root/dist/cache}"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$repo_root/dist/zig-cache}"
export ZIG_LOCAL_CACHE_DIR="${ZIG_LOCAL_CACHE_DIR:-$repo_root/dist/zig-local}"
export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-F$sdk/System/Library/Frameworks/ApplicationServices.framework/Frameworks -C link-arg=-F$sdk/System/Library/Frameworks/CoreServices.framework/Frameworks -C link-arg=-framework -C link-arg=ColorSync -C link-arg=-framework -C link-arg=CarbonCore -C link-arg=-Wl,-rpath,@executable_path/../Frameworks/GStreamer.framework/Versions/1.0/lib"
mkdir -p "$output_dir" "$XDG_CACHE_HOME" "$ZIG_GLOBAL_CACHE_DIR" "$ZIG_LOCAL_CACHE_DIR"

# Zig's linker opens more object files than the usual Linux soft limit.
ulimit -n 8192
for target in "${targets[@]}"; do
  if [[ "${PFS_SKIP_BUILD:-0}" != 1 ]]; then
    cargo_args=(zigbuild --target "$target" --release --locked -p dogmedia-desktop --bin dogmedia-desktop)
    [[ "${PFS_CARGO_OFFLINE:-1}" == 1 ]] && cargo_args+=(--offline)
    (cd "$desktop_root" && cargo "${cargo_args[@]}")
  fi
  binary="$desktop_root/target/$target/release/dogmedia-desktop"
  [[ -f "$binary" ]] || { echo "Missing binary: $binary" >&2; exit 1; }
  file "$binary" | grep -q 'Mach-O 64-bit' || { echo "Not a Mach-O binary: $binary" >&2; exit 1; }
  strings "$binary" | grep -F '@executable_path/../Frameworks/GStreamer.framework/Versions/1.0/lib' >/dev/null || { echo "Bundled GStreamer rpath missing: $binary" >&2; exit 1; }

  case "$target" in
    aarch64-apple-darwin) arch=arm64; zig_target=aarch64-macos ;;
    x86_64-apple-darwin) arch=x86_64; zig_target=x86_64-macos ;;
  esac
  stage="$output_dir/Dogmedia-$version-macos-$arch-stage"
  app="$stage/Dogmedia.app"
  rm -rf "$stage"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks" "$app/Contents/Resources"
  cp "$binary" "$app/Contents/MacOS/Dogmedia-bin"
  cp -a "$framework" "$app/Contents/Frameworks/GStreamer.framework"
  bundled="$app/Contents/Frameworks/GStreamer.framework"
  # Keep the build SDK intact; only the staged application needs runtime files.
  find "$bundled" -name '*.a' -delete
  bundled_version="$bundled/Versions/1.0"
  rm -rf -- \
    "$bundled_version/Headers" \
    "$bundled_version/include" \
    "$bundled_version/share/gir-1.0" \
    "$bundled_version/lib/pkgconfig" \
    "$bundled_version/lib/gstreamer-1.0/pkgconfig" \
    "$bundled_version/lib/cmake"
  # These optional plugins provide cloud, conferencing, speech, disc-burning,
  # and tracing features; Dogmedia plays media through playbin3 instead.
  for plugin in aws burn elevenlabs quinn rswebrtc rstracers webrtchttp; do
    rm -f -- "$bundled_version/lib/gstreamer-1.0/libgst${plugin}.dylib"
  done
  # The extracted pkg components place framework metadata one level too deep.
  # Rebuild the usual framework links inside the staged copy.
  cp -L "$bundled_version/GStreamer" "$bundled_version/GStreamer.real"
  rm "$bundled_version/GStreamer" "$bundled_version/Commands" "$bundled_version/Libraries" "$bundled_version/Resources"
  mv "$bundled_version/GStreamer.real" "$bundled_version/GStreamer"
  mkdir "$bundled_version/Resources"
  cp "$bundled_version/Versions/1.0/Resources/Info.plist" "$bundled_version/Resources/Info.plist"
  rm -rf "$bundled_version/Versions"
  ln -s bin "$bundled_version/Commands"
  ln -s lib "$bundled_version/Libraries"
  ln -s 1.0 "$bundled/Versions/Current"
  for name in GStreamer Commands Libraries Resources; do
    ln -s "Versions/Current/$name" "$bundled/$name"
  done
  [[ -z "$(find "$bundled" -xtype l -print -quit)" ]] || { echo "Broken GStreamer framework symlink" >&2; exit 1; }
  sed "s/@VERSION@/$version/g" "$desktop_root/packaging/macos/Info.plist.in" > "$app/Contents/Info.plist"
  "$zig" cc -target "$zig_target" -isysroot "$sdk" -Wall -Wextra -Werror \
    "$desktop_root/packaging/macos/launcher.c" -o "$app/Contents/MacOS/Dogmedia"
  file "$app/Contents/MacOS/Dogmedia" | grep -q 'Mach-O 64-bit' || { echo "Launcher is not Mach-O" >&2; exit 1; }
  ln -s /Applications "$stage/Applications"
  archive="$output_dir/Dogmedia-$version-macos-$arch.zip"
  rm -f -- "$archive"
  (cd "$stage" && zip -qry "$archive" Dogmedia.app Applications)
  7z l "$archive" | grep 'Dogmedia.app/Contents/Info.plist' >/dev/null || { echo "Archive listing failed" >&2; exit 1; }
  echo "Created $archive"
  if [[ "${PFS_PUBLISH_DESKTOP_RELEASE:-1}" == 1 ]]; then
    case "$arch" in
      arm64) variant=macos-arm64 ;;
      x86_64) variant=macos-x64 ;;
    esac
    bash "$desktop_root/packaging/publish-release.sh" "$variant" "$archive"
  fi
done
