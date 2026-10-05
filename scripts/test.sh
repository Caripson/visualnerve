#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$VN_ROOT/backend"
"$VN_GO" test -race ./...
"$VN_GO" vet ./...
cd "$VN_ROOT/frontend"
if [[ ! -d node_modules ]]; then npm ci; fi
npm test
npm run format:check
if [[ "${1:-}" == '--e2e' ]]; then
  cd "$VN_ROOT"
  ./build.sh
  cd frontend
  npm run test:e2e
fi
