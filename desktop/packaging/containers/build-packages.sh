#!/usr/bin/env bash
set -euo pipefail

# Check the whole script before starting a potentially long container build.
bash -n "${BASH_SOURCE[0]}"

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

  if [[ "${PFS_SKIP_PACKAGE_IMAGE_BUILD:-0}" == 1 ]]; then
    "$engine" image exists "$image" || { echo "error: package image not found: $image" >&2; exit 1; }
    echo "Exporting $package_type package from $image..."
  else
    echo "Building $package_type package with $engine..."
    "$engine" build \
      --file "$script_dir/Containerfile.$package_type" \
      --tag "$image" \
      "$repo_dir"
  fi

  "$engine" create --name "$container_name" "$image" /bin/true >/dev/null
  export_dir=$(mktemp -d "${TMPDIR:-/tmp}/dogmedia-${package_type}-export.XXXXXX")
  cleanup_container() {
    "$engine" rm --force "$container_name" >/dev/null 2>&1 || true
    rm -rf -- "$export_dir"
  }
  trap cleanup_container EXIT
  "$engine" cp "$container_name:/packages/." "$export_dir/"

  case "$package_type" in
    deb)
      variant=linux-deb
      package_name="dogmedia-desktop_${version}_amd64.deb"
      ;;
    rpm)
      variant=linux-rpm
      package_name=$(find "$export_dir" -maxdepth 1 -type f -name "dogmedia-desktop-${version}-*.x86_64.rpm" -printf '%f\n' | sort | head -n 1)
      ;;
  esac
  if [[ -z "$package_name" || ! -s "$export_dir/$package_name" ]]; then
    echo "error: the $package_type container produced no supported package" >&2
    exit 1
  fi
  cp -- "$export_dir/$package_name" "$output_dir/$package_name"
  if [[ "${PFS_PUBLISH_DESKTOP_RELEASE:-1}" == 1 ]]; then
    bash "$repo_dir/desktop/packaging/publish-release.sh" "$variant" "$output_dir/$package_name"
  fi
  cleanup_container
  trap - EXIT
done

echo "Packages created in $output_dir:"
find "$output_dir" -maxdepth 1 -type f \( -name '*.deb' -o -name '*.rpm' \) -print
