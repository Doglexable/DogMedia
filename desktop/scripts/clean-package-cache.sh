#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
desktop_dir=$(cd -- "$script_dir/.." && pwd)
repo_dir=$(cd -- "$desktop_dir/.." && pwd)
dist_dir="$repo_dir/dist"

cleaned=0

# 1. Clean macOS / Windows stage directories in dist/packages/
if [[ -d "$dist_dir/packages" ]]; then
  for item in "$dist_dir/packages"/*-stage "$dist_dir/packages"/.pfs-win-pkgconfig; do
    if [[ -e "$item" ]]; then
      rm -rf -- "$item"
      cleaned=1
    fi
  done
fi

# 2. Clean Zig cache directories
for dir in "$dist_dir/zig-cache" "$dist_dir/zig-local"; do
  if [[ -d "$dir" ]]; then
    rm -rf -- "$dir"
    cleaned=1
  fi
done

# 3. Clean cross-compilation cache directories
if [[ -d "$dist_dir/cache" ]]; then
  rm -rf -- "$dist_dir/cache"
  cleaned=1
fi

# 4. Clean user-owned temporary packaging staging directories in /tmp
for tmp_pattern in 'dogmedia-deb.*' 'dogmedia-rpm.*' 'dogmedia-*-export.*'; do
  while IFS= read -r dir; do
    if [[ -d "$dir" ]]; then
      rm -rf -- "$dir"
      cleaned=1
    fi
  done < <(find "${TMPDIR:-/tmp}" -maxdepth 1 -user "$(id -u)" -name "$tmp_pattern" 2>/dev/null || true)
done

if [[ "$cleaned" -eq 1 ]]; then
  echo "Cleaned desktop packaging build cache."
else
  echo "Desktop packaging build cache is already clean."
fi
