#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$VN_ROOT/backend"
"$VN_GO" test -race ./...
"$VN_GO" vet ./...
"$VN_GO" test -race "$VN_ROOT/scripts/bridge-installer-helper.go" "$VN_ROOT/scripts/bridge-installer-helper_test.go"
cd "$VN_ROOT/frontend"
if [[ ! -d node_modules ]]; then npm ci; fi
node --test "$VN_ROOT/scripts/notation-contract.test.mjs"
VN_GO="$VN_GO" node --test "$VN_ROOT/scripts/package-bridge-installer.test.mjs"
npm test
npm run format:check
if [[ "${1:-}" == '--e2e' ]]; then
  cd "$VN_ROOT"
  ./build.sh
  cd frontend
  npm run test:e2e
fi
