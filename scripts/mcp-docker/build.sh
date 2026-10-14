#!/usr/bin/env bash
set -euo pipefail
VN_HARNESS_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VN_HARNESS_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/vn-mcp-context.XXXXXX")"
trap 'rm -rf "$VN_HARNESS_CONTEXT"' EXIT

# Construct the context from a source allowlist. Docker never receives .env,
# browser workspaces, local exports, build output, credentials or Git history.
python3 - "$VN_HARNESS_ROOT" "$VN_HARNESS_CONTEXT" <<'PY'
from pathlib import Path
import shutil
import sys

root, context = map(Path, sys.argv[1:])
files = [root / 'backend/go.mod', root / 'backend/go.sum',
         root / 'backend/internal/model/notation_catalog.json',
         root / 'docs/openapi.yaml', root / 'API.md']
files.extend((root / 'backend').rglob('*.go'))
for source in files:
    if source.is_symlink() or not source.is_file():
        raise SystemExit(f'Unexpected build input: {source.relative_to(root)}')
    destination = context / source.relative_to(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
for name in ['service.py', 'control.py', 'client.py']:
    destination = context / 'harness' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / 'scripts/mcp-docker' / name, destination)
shutil.copyfile(root / 'scripts/mcp-docker/Dockerfile', context / 'Dockerfile')
PY
docker build --tag "${1:-visual-nerve-mcp-test:local}" "$VN_HARNESS_CONTEXT"
