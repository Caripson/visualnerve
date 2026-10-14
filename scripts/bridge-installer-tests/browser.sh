#!/usr/bin/env bash
set -euo pipefail
VN_INSTALLER_BROWSER_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VN_INSTALLER_BROWSER_ROOT"
exec python3 scripts/bridge-installer-tests/browser.py "$@"
