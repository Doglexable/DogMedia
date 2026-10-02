#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
desktop_dir=$(cd -- "$script_dir/../.." && pwd)
repo_dir=$(cd -- "$desktop_dir/.." && pwd)
manifest="$desktop_dir/Cargo.toml"
binary="$desktop_dir/target/release/dogmedia-desktop"
output_dir=${PFS_PACKAGE_OUTPUT_DIR:-"$repo_dir/dist/packages"}

if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "error: rpmbuild is required (install the rpm-build package)" >&2
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

cargo build --release --locked --manifest-path "$manifest" --bin dogmedia-desktop

if ldd "$binary" | grep -Eiq 'webkit|javascriptcore|gtk-3|gtk-4|wry'; then
  echo "error: packaged binary links a forbidden webview/GTK runtime" >&2
  exit 1
fi

top_dir=$(mktemp -d "${TMPDIR:-/tmp}/dogmedia-rpm.XXXXXX")
trap 'rm -rf -- "$top_dir"' EXIT
mkdir -p "$top_dir"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}

install -m755 "$binary" "$top_dir/SOURCES/dogmedia-desktop"
install -m644 "$desktop_dir/resources/com.dogmedia.Desktop.desktop" "$top_dir/SOURCES/"
install -m644 "$desktop_dir/resources/com.dogmedia.Desktop.metainfo.xml" "$top_dir/SOURCES/"
install -m644 "$desktop_dir/resources/icons/com.dogmedia.Desktop.svg" "$top_dir/SOURCES/"
install -m644 "$repo_dir/LICENSE" "$top_dir/SOURCES/LICENSE"

rpmbuild -bb \
  --define "_topdir $top_dir" \
  --define "dogmedia_version $version" \
  "$script_dir/dogmedia-desktop.spec"

mkdir -p "$output_dir"
find "$top_dir/RPMS" -type f -name '*.rpm' -exec cp -- {} "$output_dir/" \;
find "$output_dir" -maxdepth 1 -type f -name "dogmedia-desktop-$version-*.rpm" -print
