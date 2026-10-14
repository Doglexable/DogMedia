#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
desktop_root="$repo_root/desktop"
script_root="$desktop_root/packaging/windows"
conda_root="${GST_WIN_CONDA_ROOT:-$repo_root/pfs-sdk/conda-win}"
library="$conda_root/tree/Library"
output_dir="${PFS_WIN_OUTPUT_DIR:-$repo_root/dist/packages}"
version="$(awk -F '"' '/^\[package\]/{p=1; next} p && /^\[/{exit} p && /^version = /{print $2; exit}' "$desktop_root/Cargo.toml")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Cannot read Cargo package version" >&2; exit 1; }
[[ -d "$library/bin" && -d "$library/lib/gstreamer-1.0" ]] || { echo "Conda runtime tree missing" >&2; exit 1; }

(cd "$conda_root" && sha256sum -c "$script_root/SHA256SUMS-win.txt" --quiet)
mkdir -p "$output_dir"
stage="$output_dir/Dogmedia-$version-windows-x86_64-stage"
app="$stage/Dogmedia"
python3 "$script_root/stage-runtime.py" "$library" "$app"
cp "$script_root/Dogmedia.cmd" "$app/Dogmedia.cmd"
cp "$script_root/SHA256SUMS-win.txt" "$app/CONDA-PACKAGES-SHA256.txt"
if [[ -d "$conda_root/tree/info/licenses" ]]; then
  mkdir -p "$app/licenses"
  cp -a "$conda_root/tree/info/licenses/." "$app/licenses/"
fi
python3 "$script_root/verify-dlls.py" "$app"
if [[ -f "$script_root/runtime-dll-sha256.txt" ]]; then
  cmp "$script_root/runtime-dll-sha256.txt" "$app/RUNTIME-DLL-SHA256.txt" || {
    echo "Staged DLLs differ from pinned runtime manifest" >&2; exit 1;
  }
fi

if [[ "${PFS_WIN_RUNTIME_ONLY:-0}" == 1 ]]; then
  echo "Runtime-only stage ready: $app (Dogmedia.exe awaits the MSVC toolchain)"
  exit 0
fi

if [[ -n "${PFS_WIN_EXE:-}" ]]; then
  binary="$PFS_WIN_EXE"
else
  pc_dir="$desktop_root/target/.pfs-win-pkgconfig"
  python3 "$script_root/prepare-pc.py" "$library" "$pc_dir"
  export PKG_CONFIG_ALLOW_CROSS=1
  export PKG_CONFIG_LIBDIR="$pc_dir"
  export PKG_CONFIG_PATH=
  export PKG_CONFIG_SYSROOT_DIR=/
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$repo_root/dist/cache}"
  cargo_args=(xwin build --target x86_64-pc-windows-msvc --release --locked -p dogmedia-desktop --bin dogmedia-desktop)
  [[ "${PFS_CARGO_OFFLINE:-1}" == 1 ]] && cargo_args+=(--offline)
  (cd "$desktop_root" && cargo "${cargo_args[@]}")
  binary="$desktop_root/target/x86_64-pc-windows-msvc/release/dogmedia-desktop.exe"
fi
[[ -f "$binary" ]] || { echo "Missing Windows binary: $binary" >&2; exit 1; }
file "$binary" | grep -q 'PE32+ executable.*x86-64' || { echo "Not an x86-64 PE32+ binary: $binary" >&2; exit 1; }
cp "$binary" "$app/Dogmedia.exe"
python3 "$script_root/verify-dlls.py" "$app"

command -v makensis >/dev/null || { echo "makensis is required to build the Windows installer" >&2; exit 1; }
installer="$output_dir/Dogmedia-$version-windows-x86_64-setup.exe"
makensis -D"STAGE=$app" -D"OUT=$installer" -D"VERSION=$version" "$script_root/installer.nsi"
file "$installer" | grep -q 'PE32' || { echo "NSIS output is not a PE executable" >&2; exit 1; }
7z l "$installer" | grep 'Dogmedia.exe' >/dev/null || { echo "Installer payload missing Dogmedia.exe" >&2; exit 1; }
echo "Created $installer"
if [[ "${PFS_PUBLISH_DESKTOP_RELEASE:-1}" == 1 ]]; then
  bash "$desktop_root/packaging/publish-release.sh" windows-x64 "$installer"
fi

if [[ "${PFS_KEEP_STAGE:-0}" != 1 ]]; then
  rm -rf "$stage" "${pc_dir:-}"
fi

if [[ "${PFS_KEEP_BUILD_CACHE:-0}" != 1 ]]; then
  bash "$desktop_root/scripts/clean-package-cache.sh"
fi
