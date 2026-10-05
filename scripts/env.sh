#!/usr/bin/env bash
set -euo pipefail
VN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VN_GO="$(command -v go || true)"
if [[ -z "$VN_GO" && -x "$HOME/.local/share/visual-nerve-toolchain/go/bin/go" ]]; then VN_GO="$HOME/.local/share/visual-nerve-toolchain/go/bin/go"; fi
if [[ -z "$VN_GO" && -x /usr/local/go/bin/go ]]; then VN_GO=/usr/local/go/bin/go; fi
if [[ -z "$VN_GO" ]]; then echo 'Install Go 1.26 or newer (https://go.dev/dl/).' >&2; exit 1; fi
for VN_DEP in node npm hugo; do if ! command -v "$VN_DEP" >/dev/null; then echo "Install $VN_DEP before building Visual Nerve." >&2; exit 1; fi; done
