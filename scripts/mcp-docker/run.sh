#!/usr/bin/env bash
# A disposable Linux MCP client + bridge, connected to a fresh host Chrome profile.
set -euo pipefail
VN_TEST_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VN_TEST_ORIGIN="$(node "$VN_TEST_ROOT/scripts/mcp-docker/config.mjs" --origin)"
VN_TEST_IMAGE="visual-nerve-mcp-test:local"
VN_TEST_CONTAINER="visual-nerve-mcp-test-$$"
VN_TEST_NETWORK="$VN_TEST_CONTAINER"
VN_TEST_NETWORK_CREATED=0
VN_TEST_CONTAINER_ID=""
cleanup() {
  if [[ -n "$VN_TEST_CONTAINER_ID" ]]; then
    docker rm --force "$VN_TEST_CONTAINER_ID" >/dev/null 2>&1 || true
  fi
  if [[ "$VN_TEST_NETWORK_CREATED" == 1 ]]; then
    docker network rm "$VN_TEST_NETWORK" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM
if [[ "${VN_MCP_TEST_SKIP_BUILD:-0}" != 1 ]]; then
  "$VN_TEST_ROOT/scripts/mcp-docker/build.sh" "$VN_TEST_IMAGE"
fi
docker network create "$VN_TEST_NETWORK" >/dev/null
VN_TEST_NETWORK_CREATED=1
VN_TEST_CONTAINER_ID="$(docker create --init --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
  --cap-drop ALL --security-opt no-new-privileges \
  --network "$VN_TEST_NETWORK" --publish 127.0.0.1:47417:47418 \
  --publish 127.0.0.1:4317:4318 \
  --env "VN_MCP_TEST_ALLOWED_ORIGIN=$VN_TEST_ORIGIN" \
  --name "$VN_TEST_CONTAINER" "$VN_TEST_IMAGE")"
docker start "$VN_TEST_CONTAINER_ID" >/dev/null
for VN_TEST_ATTEMPT in {1..30}; do
  if docker exec "$VN_TEST_CONTAINER" python /harness/control.py status >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
docker exec "$VN_TEST_CONTAINER" python /harness/control.py status
cd "$VN_TEST_ROOT/frontend"
VN_MCP_TEST_CONTAINER="$VN_TEST_CONTAINER" npx playwright test --config playwright.docker-mcp.config.ts
