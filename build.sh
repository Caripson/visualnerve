#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/scripts/env.sh"
cd "$VN_ROOT/backend"
"$VN_GO" run ./cmd/openapi "$VN_ROOT/docs/openapi.yaml"
cd "$VN_ROOT/frontend"
if [[ ! -d node_modules ]]; then npm ci; fi
node "$VN_ROOT/scripts/speech-assets.mjs"
node "$VN_ROOT/scripts/consent-assets.mjs"
npm run build
node "$VN_ROOT/scripts/audit-editor-bundle.mjs" "$VN_ROOT/hugo/static/editor"
mkdir -p "$VN_ROOT/hugo/static/swagger"
cp node_modules/swagger-ui-dist/swagger-ui.css node_modules/swagger-ui-dist/swagger-ui-bundle.js "$VN_ROOT/hugo/static/swagger/"
cp "$VN_ROOT/docs/openapi.yaml" "$VN_ROOT/hugo/static/openapi.yaml"
cd "$VN_ROOT"
node scripts/licenses.mjs "$VN_GO"
hugo --source hugo --destination "$VN_ROOT/public" --cleanDestinationDir --baseURL "${SITE_URL:-https://visualnerve.caripson.com/}"
node scripts/service-worker.mjs
node scripts/audit-static.mjs "$VN_ROOT/public"
mkdir -p bin
cd backend
"$VN_GO" build -trimpath -o "$VN_ROOT/bin/visual-nerve" ./cmd/visual-nerve
