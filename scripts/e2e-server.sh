#!/usr/bin/env bash
set -euo pipefail
VN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VN_E2E_TLS="$(mktemp -d /tmp/visual-nerve-e2e-tls.XXXXXX)"
VN_E2E_PIDS=()
cleanup() {
  for pid in "${VN_E2E_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${VN_E2E_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$VN_E2E_TLS"
}
trap cleanup EXIT INT TERM
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$VN_E2E_TLS/key.pem" -out "$VN_E2E_TLS/cert.pem" -subj '/CN=public-app.test' -addext 'subjectAltName=DNS:public-app.test,IP:127.0.0.1' 2>/dev/null
"$VN_ROOT/bin/visual-nerve" --static "$VN_ROOT/public" --bridge --addr 127.0.0.1:4327 &
VN_E2E_PIDS+=($!)
"$VN_ROOT/bin/visual-nerve" --static "$VN_ROOT/public" --bridge --addr 127.0.0.1:4329 --allowed-origin https://public-app.test:4340 --tls-cert "$VN_E2E_TLS/cert.pem" --tls-key "$VN_E2E_TLS/key.pem" &
VN_E2E_PIDS+=($!)
python3 "$VN_ROOT/scripts/e2e-static-server.py" --directory "$VN_ROOT/public" --cert "$VN_E2E_TLS/cert.pem" --key "$VN_E2E_TLS/key.pem" &
VN_E2E_PIDS+=($!)
wait -n "${VN_E2E_PIDS[@]}"
