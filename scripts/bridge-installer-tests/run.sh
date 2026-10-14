#!/usr/bin/env bash
# No host installation: all installer executions use disposable Linux containers.
set -euo pipefail
VN_INSTALLER_TEST_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VN_INSTALLER_TEST_ROOT"
exec python3 scripts/bridge-installer-tests/acceptance.py "$@"
