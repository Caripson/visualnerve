#!/usr/bin/env bash
# Build only the native loopback bridge and its matching API contract.
set -euo pipefail
VN_BRIDGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VN_BRIDGE_GO="${VN_GO:-$(command -v go || true)}"
if [[ -z "$VN_BRIDGE_GO" ]]; then
  echo 'Install Go 1.26 or newer (https://go.dev/dl/) before building the local bridge.' >&2
  exit 1
fi
VN_BRIDGE_OUTPUT="${1:-$VN_BRIDGE_ROOT/bin}"
mkdir -p "$VN_BRIDGE_OUTPUT/bridge-docs"
VN_BRIDGE_OUTPUT="$(cd "$VN_BRIDGE_OUTPUT" && pwd)"
cd "$VN_BRIDGE_ROOT/backend"
"$VN_BRIDGE_GO" run ./cmd/openapi "$VN_BRIDGE_OUTPUT/bridge-docs/openapi.yaml"
"$VN_BRIDGE_GO" build -trimpath -o "$VN_BRIDGE_OUTPUT/visual-nerve" ./cmd/visual-nerve
printf 'Bridge executable: %s\nAPI contract directory: %s\n' \
  "$VN_BRIDGE_OUTPUT/visual-nerve" "$VN_BRIDGE_OUTPUT/bridge-docs"
echo 'Start the executable with --static pointing to that contract directory, --bridge, an explicit loopback --addr and the exact allowed app origin.'
