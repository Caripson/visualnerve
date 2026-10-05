#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/scripts/env.sh"
cd "$VN_ROOT"
./build.sh
if [[ "${1:-}" != '--watch' ]]; then exec ./bin/visual-nerve --static "$VN_ROOT/public" "$@"; fi
shift
./bin/visual-nerve --dev --static "$VN_ROOT/public" "$@" &
VN_BACKEND_PID=$!
trap 'kill "$VN_BACKEND_PID" 2>/dev/null || true' EXIT INT TERM
cd frontend
npm run dev
