#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
desktop_dir=$(cd -- "$script_dir/.." && pwd)
repo_dir=$(cd -- "$desktop_dir/.." && pwd)

bash -n \
  "$desktop_dir/packaging/deb/build-deb.sh" \
  "$desktop_dir/packaging/rpm/build-rpm.sh" \
  "$desktop_dir/packaging/containers/build-packages.sh" \
  "$desktop_dir/scripts/check-native-deps.sh" \
  "$desktop_dir/scripts/generate-icons.sh"

if grep -Fxq 'desktop/' "$repo_dir/.dockerignore"; then
  echo "error: .dockerignore excludes sources required by the desktop package containers" >&2
  exit 1
fi

for containerfile in \
  "$desktop_dir/packaging/containers/Containerfile.deb" \
  "$desktop_dir/packaging/containers/Containerfile.rpm"
do
  grep -Eq '^COPY desktop ./desktop$' "$containerfile" || {
    echo "error: $containerfile does not copy the desktop package sources" >&2
    exit 1
  }
done

for manifest in \
  "$desktop_dir/flatpak/com.dogmedia.Desktop.yml" \
  "$desktop_dir/flatpak/com.dogmedia.VideoSpike.yml"
do
  if grep -Eiq 'webkit|javascriptcore|wry|dioxus-desktop' "$manifest"; then
    echo "error: $manifest includes a forbidden webview runtime" >&2
    exit 1
  fi
  grep -Eq "^runtime-version: '50'$" "$manifest" || {
    echo "error: $manifest is not pinned to the supported GNOME 50 runtime" >&2
    exit 1
  }
done

grep -Eq '^command: dogmedia-desktop$' \
  "$desktop_dir/flatpak/com.dogmedia.Desktop.yml"
grep -Eq -- '--device=dri' "$desktop_dir/flatpak/com.dogmedia.Desktop.yml"

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop_dir/resources/com.dogmedia.Desktop.desktop"
fi
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net \
    "$desktop_dir/resources/com.dogmedia.Desktop.metainfo.xml"
fi

echo "desktop packaging metadata guard passed"
