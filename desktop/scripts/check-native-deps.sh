#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
desktop_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
tree_file=$(mktemp)
trap 'rm -f "$tree_file"' EXIT HUP INT TERM

cargo tree \
  --manifest-path "$desktop_dir/Cargo.toml" \
  --no-default-features \
  --features native-ui,video-spike \
  --locked >"$tree_file"

search_match() {
  pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern" "$@"
  else
    grep -q -E "$pattern" "$@"
  fi
}

search_find() {
  pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg -i "$pattern" "$@"
  else
    grep -i -E "$pattern" "$@"
  fi
}

if search_find '(^|[[:space:]├└─])(iced|wry|dioxus-desktop|webkit2gtk|webkit|webview)[[:space:]]+v' "$tree_file"; then
  echo "error: native renderer dependency tree contains a forbidden UI/webview crate" >&2
  exit 1
fi

if grep -r -n -E '\buse_eval\b|dioxus::document::eval' "$desktop_dir/src" --include='*.rs'; then
  echo "error: native desktop source contains a webview-only eval API" >&2
  exit 1
fi

spike_source="$desktop_dir/src/bin/video-spike.rs"
if ! search_match 'format: TextureFormat::Rgba8Unorm,' "$spike_source" ||
  ! search_match 'TextureUsages::COPY_SRC' "$spike_source"; then
  echo "error: Vello video texture must be Rgba8Unorm with COPY_SRC usage" >&2
  exit 1
fi

production_video_source="$desktop_dir/src/ui/video_surface.rs"
if ! search_match 'format: TextureFormat::Rgba8Unorm,' "$production_video_source" ||
  ! search_match 'TextureUsages::COPY_SRC' "$production_video_source"; then
  echo "error: production Vello video texture must be Rgba8Unorm with COPY_SRC usage" >&2
  exit 1
fi

echo "native renderer guard passed: no Iced or webview dependency/API detected"
