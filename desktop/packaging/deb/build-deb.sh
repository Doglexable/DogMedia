#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
desktop_dir=$(cd -- "$script_dir/../.." && pwd)
repo_dir=$(cd -- "$desktop_dir/.." && pwd)
manifest="$desktop_dir/Cargo.toml"
binary="$desktop_dir/target/release/dogmedia-desktop"
output_dir=${PFS_PACKAGE_OUTPUT_DIR:-"$repo_dir/dist/packages"}

if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "error: dpkg-deb is required (install the dpkg-dev package)" >&2
  exit 1
fi

version=$(awk '
  /^\[package\]$/ { in_package = 1; next }
  /^\[/ { in_package = 0 }
  in_package && /^version[[:space:]]*=/ {
    gsub(/[[:space:]]/, "", $0)
    gsub(/"/, "", $0)
    sub(/^version=/, "", $0)
    print
    exit
  }
' "$manifest")

if [[ -z "$version" ]]; then
  echo "error: could not read the package version from $manifest" >&2
  exit 1
fi

cargo build --release --manifest-path "$manifest"

architecture=$(dpkg --print-architecture)
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/dogmedia-deb.XXXXXX")
trap 'rm -rf -- "$staging_dir"' EXIT

install -Dm755 "$binary" "$staging_dir/usr/bin/dogmedia-desktop"
install -Dm644 "$desktop_dir/resources/com.dogmedia.Desktop.desktop" \
  "$staging_dir/usr/share/applications/com.dogmedia.Desktop.desktop"
install -Dm644 "$desktop_dir/resources/icons/com.dogmedia.Desktop.svg" \
  "$staging_dir/usr/share/icons/hicolor/scalable/apps/com.dogmedia.Desktop.svg"
install -Dm644 "$desktop_dir/resources/com.dogmedia.Desktop.metainfo.xml" \
  "$staging_dir/usr/share/metainfo/com.dogmedia.Desktop.metainfo.xml"
install -Dm644 "$repo_dir/LICENSE" \
  "$staging_dir/usr/share/doc/dogmedia-desktop/copyright"

installed_size=$(du -sk "$staging_dir/usr" | awk '{print $1}')
install -d "$staging_dir/DEBIAN"
sed \
  -e "s/@VERSION@/$version/g" \
  -e "s/@ARCHITECTURE@/$architecture/g" \
  -e "s/@INSTALLED_SIZE@/$installed_size/g" \
  "$script_dir/control.in" > "$staging_dir/DEBIAN/control"

mkdir -p "$output_dir"
artifact="$output_dir/dogmedia-desktop_${version}_${architecture}.deb"
dpkg-deb --root-owner-group --build "$staging_dir" "$artifact"
echo "Created $artifact"
