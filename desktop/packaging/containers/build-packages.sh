#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/../../.." && pwd)
output_dir=${PFS_PACKAGE_OUTPUT_DIR:-"$repo_dir/dist/packages"}
requested=${1:-all}

case "$requested" in
  all) package_types=(deb rpm) ;;
  deb | rpm) package_types=("$requested") ;;
  *)
    echo "usage: $0 [all|deb|rpm]" >&2
    exit 2
    ;;
esac

if [[ -n "${CONTAINER_ENGINE:-}" ]]; then
  engine=$CONTAINER_ENGINE
elif command -v podman >/dev/null 2>&1; then
  engine=podman
elif command -v docker >/dev/null 2>&1; then
  engine=docker
else
  echo "error: Podman or Docker is required" >&2
  exit 1
fi

if ! command -v "$engine" >/dev/null 2>&1; then
  echo "error: container engine '$engine' was not found" >&2
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
' "$repo_dir/desktop/Cargo.toml")

if [[ -z "$version" ]]; then
  echo "error: could not read the desktop package version" >&2
  exit 1
fi

mkdir -p "$output_dir"

for package_type in "${package_types[@]}"; do
  image="localhost/dogmedia-${package_type}-packager:$version"
  container_name="dogmedia-${package_type}-export-$$"

  echo "Building $package_type package with $engine..."
  "$engine" build \
    --file "$script_dir/Containerfile.$package_type" \
    --tag "$image" \
    "$repo_dir"

  "$engine" create --name "$container_name" "$image" /bin/true >/dev/null
  cleanup_container() {
    "$engine" rm --force "$container_name" >/dev/null 2>&1 || true
  }
  trap cleanup_container EXIT
  "$engine" cp "$container_name:/packages/." "$output_dir/"
  cleanup_container
  trap - EXIT

  if ! compgen -G "$output_dir/*.${package_type}" >/dev/null; then
    echo "error: the $package_type container produced no package" >&2
    exit 1
  fi
done

echo "Packages created in $output_dir:"
find "$output_dir" -maxdepth 1 -type f \( -name '*.deb' -o -name '*.rpm' \) -print
