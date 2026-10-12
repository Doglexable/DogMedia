#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
requested="${1:-all}"

case "$requested" in
  all | mac | windows) ;;
  *) echo "usage: $0 [all|mac|windows]" >&2; exit 2 ;;
esac

if [[ -n "${CONTAINER_ENGINE:-}" ]]; then
  engine="$CONTAINER_ENGINE"
elif command -v podman >/dev/null 2>&1; then
  engine=podman
elif command -v docker >/dev/null 2>&1; then
  engine=docker
else
  echo "Podman or Docker is required" >&2
  exit 1
fi
command -v "$engine" >/dev/null || { echo "Container engine missing: $engine" >&2; exit 1; }

if [[ "$requested" == all || "$requested" == mac ]]; then
  [[ -d "$repo_root/pfs-sdk/MacOSX.sdk" &&
     -x "$repo_root/pfs-sdk/zig-x86_64-linux-0.16.0/zig" ]] || {
    echo "macOS SDK or Zig missing in pfs-sdk/" >&2; exit 1;
  }
fi
if [[ "$requested" == all || "$requested" == windows ]]; then
  [[ -d "$repo_root/pfs-sdk/conda-win/tree/Library" ]] || {
    echo "Windows conda development tree missing in pfs-sdk/" >&2; exit 1;
  }
fi

image="${PFS_CROSS_IMAGE:-localhost/dogmedia-cross-builder:rust-1.98.1}"
if [[ "${PFS_CROSS_SKIP_IMAGE_BUILD:-0}" != 1 ]]; then
  "$engine" build \
    --platform linux/amd64 \
    --file "$script_dir/Containerfile.cross" \
    --tag "$image" \
    "$script_dir"
fi

mkdir -p \
  "$repo_root/dist/cache/cross-cargo" \
  "$repo_root/dist/cache/cross-home" \
  "$repo_root/dist/cache/cross-xdg" \
  "$repo_root/dist/packages"

run_args=(
  run --rm
  --platform linux/amd64
  --user "$(id -u):$(id -g)"
  --volume "$repo_root:/work"
  --workdir /work
  --env CARGO_HOME=/work/dist/cache/cross-cargo
  --env HOME=/work/dist/cache/cross-home
  --env XDG_CACHE_HOME=/work/dist/cache/cross-xdg
  --env PFS_CARGO_OFFLINE="${PFS_CARGO_OFFLINE:-0}"
  --env PFS_MAC_ARCH="${PFS_MAC_ARCH:-both}"
  --env PFS_SKIP_BUILD="${PFS_SKIP_BUILD:-0}"
  --env PFS_WIN_RUNTIME_ONLY="${PFS_WIN_RUNTIME_ONLY:-0}"
  --env PFS_PUBLISH_DESKTOP_RELEASE="${PFS_PUBLISH_DESKTOP_RELEASE:-1}"
)
if [[ "$engine" == podman ]]; then
  run_args+=(--userns keep-id)
fi

"$engine" "${run_args[@]}" "$image" \
  bash desktop/packaging/containers/run-cross.sh "$requested"
