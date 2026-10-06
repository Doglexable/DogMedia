#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
sdk_dir="$repo_root/pfs-sdk"
framework="$sdk_dir/GStreamer.framework"
runtime="$sdk_dir/gstreamer-1.0-1.28.6-universal.pkg"
development="$sdk_dir/gstreamer-1.0-devel-1.28.6-universal.pkg"
decoder="$repo_root/desktop/packaging/macos/pbzx-stream.py"

if [[ -f "$framework/Versions/1.0/lib/pkgconfig/glib-2.0.pc" &&
      -f "$framework/Versions/1.0/lib/pkgconfig/gstreamer-1.0.pc" &&
      -f "$framework/Versions/1.0/lib/pkgconfig/gstreamer-video-1.0.pc" &&
      -f "$framework/Versions/1.0/lib/gstreamer-1.0/libgstapplemedia.dylib" ]]; then
  find "$framework" -name '*.a' -delete
  echo "Using $framework"
  exit 0
fi
[[ ! -e "$framework" ]] || { echo "Incomplete framework: $framework" >&2; exit 1; }
for program in bsdtar cpio python3 sha256sum; do
  command -v "$program" >/dev/null || { echo "Missing $program" >&2; exit 1; }
done
printf '%s  %s\n' \
  'a8eb366c59b7e9e5dc049848fed6bcd203a8878aa7517c051639fda78797c6ad' "$runtime" \
  '177b1428d0f47b844e7bff2aeeb22047686d802eba21580dab52f4a6fe1dcf02' "$development" \
  | sha256sum -c --quiet

tmp="$(mktemp -d "$sdk_dir/.GStreamer.framework.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/Versions/1.0"

extract_component() {
  local archive=$1 name=$2 member
  member="$name-1.28.6-universal.pkg/Payload"
  echo "Extracting $name"
  bsdtar -xOf "$archive" "$member" \
    | python3 "$decoder" \
    | (cd "$tmp/Versions/1.0" && cpio -idmu --quiet)
}

for name in \
  gstreamer-1.0-core base-system-1.0 gstreamer-1.0-system \
  gstreamer-1.0-playback gstreamer-1.0-codecs base-crypto \
  gstreamer-1.0-effects gstreamer-1.0-net \
  gstreamer-1.0-visualizers gstreamer-1.0-analytics osx-framework
do
  extract_component "$runtime" "$name"
done
for name in \
  gstreamer-1.0-core-devel base-system-1.0-devel gstreamer-1.0-system-devel \
  gstreamer-1.0-playback-devel gstreamer-1.0-codecs-devel base-crypto-devel
do
  extract_component "$development" "$name"
done

version="$tmp/Versions/1.0"
for path in \
  "$version/lib/pkgconfig/glib-2.0.pc" \
  "$version/lib/pkgconfig/gstreamer-1.0.pc" \
  "$version/lib/pkgconfig/gstreamer-video-1.0.pc" \
  "$version/lib/gstreamer-1.0/libgstapplemedia.dylib" \
  "$version/Versions/1.0/Resources/Info.plist"
do
  [[ -f "$path" ]] || { echo "Missing framework input: $path" >&2; exit 1; }
done
strings "$version/lib/gstreamer-1.0/libgstapplemedia.dylib" | grep -q 'GstVtdec'
# Cargo links the framework dylibs; static development archives would add
# several gigabytes to the local input and every release image.
find "$version" -name '*.a' -delete
mv -- "$tmp" "$framework"
trap - EXIT
echo "Prepared $framework"
