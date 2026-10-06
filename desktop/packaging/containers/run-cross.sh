#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
requested="${1:-all}"

case "$requested" in
  all | mac | windows) ;;
  *) echo "usage: $0 [all|mac|windows]" >&2; exit 2 ;;
esac

if [[ "$requested" == all || "$requested" == mac ]]; then
  bash "$repo_root/desktop/packaging/macos/prepare-framework.sh"
  bash "$repo_root/desktop/packaging/macos/build-mac.sh"
fi
if [[ "$requested" == all || "$requested" == windows ]]; then
  bash "$repo_root/desktop/packaging/windows/build-win.sh"
fi
