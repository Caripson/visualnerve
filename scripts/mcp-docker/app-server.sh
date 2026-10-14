#!/usr/bin/env bash
# Isolated production-style app surface; never serves a user's workspace.
set -euo pipefail
VN_TEST_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VN_TEST_FILES="$(mktemp -d /tmp/visual-nerve-docker-app.XXXXXX)"
VN_TEST_SERVER=""
cleanup() {
  if [[ -n "$VN_TEST_SERVER" ]]; then
    kill "$VN_TEST_SERVER" 2>/dev/null || true
    wait "$VN_TEST_SERVER" 2>/dev/null || true
  fi
  rm -rf "$VN_TEST_FILES"
}
trap cleanup EXIT INT TERM
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$VN_TEST_FILES/key.pem" -out "$VN_TEST_FILES/cert.pem" \
  -subj '/CN=mcp-docker.test' \
  -addext 'subjectAltName=DNS:mcp-docker.test,IP:127.0.0.1' 2>/dev/null
node --input-type=module - "$VN_TEST_ROOT" "$VN_TEST_FILES/app" <<'JS'
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output] = process.argv.slice(2);
const { buildAppSurface } = await import(pathToFileURL(resolve(root, 'scripts/build-app-surface.mjs')));
await buildAppSurface(resolve(root, 'public'), output, { appOrigin: 'https://mcp-docker.test:4342' });
JS
python3 "$VN_TEST_ROOT/scripts/e2e-static-server.py" \
  --directory "$VN_TEST_FILES/app" --port 4342 --app-headers \
  --cert "$VN_TEST_FILES/cert.pem" --key "$VN_TEST_FILES/key.pem" &
VN_TEST_SERVER=$!
wait "$VN_TEST_SERVER"
