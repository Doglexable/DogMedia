#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
release_dir=${PFS_DESKTOP_RELEASE_DIR:-"$repo_dir/data/media/desktop-release"}
variant=${1:-}
artifact=${2:-}

case "$variant" in
  linux-deb) filename=dogmedia-linux-amd64.deb ;;
  linux-rpm) filename=dogmedia-linux-x86_64.rpm ;;
  macos-arm64) filename=dogmedia-macos-arm64.zip ;;
  macos-x64) filename=dogmedia-macos-x86_64.zip ;;
  windows-x64) filename=dogmedia-windows-x86_64.exe ;;
  *) echo "usage: $0 {linux-deb|linux-rpm|macos-arm64|macos-x64|windows-x64} ARTIFACT" >&2; exit 2 ;;
esac

[[ -f "$artifact" && -s "$artifact" ]] || { echo "error: package is missing or empty: $artifact" >&2; exit 1; }
if [[ "$variant" == macos-* ]]; then
  [[ "$artifact" == *.zip ]] && file -b "$artifact" | grep -q '^Zip archive data' || {
    echo "error: macOS release must be a ZIP archive, not a mislabeled disk image: $artifact" >&2
    exit 1
  }
fi
mkdir -p "$release_dir"
temporary=$(mktemp "$release_dir/.$filename.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
cp -- "$artifact" "$temporary"
chmod 644 "$temporary"
mv -f -- "$temporary" "$release_dir/$filename"
trap - EXIT
echo "Published $release_dir/$filename"
