#!/usr/bin/env bash
set -euo pipefail
VN_DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -lt 2 || $# -gt 3 || "${3:-}" != '' && "${3:-}" != '--dry-run' ]]; then
  echo 'Usage: scripts/deploy-static.sh APP_BUCKET DISTRIBUTION_ID [--dry-run]' >&2
  exit 2
fi
node "$VN_DEPLOY_ROOT/scripts/audit-static.mjs" "$VN_DEPLOY_ROOT/public"
if [[ "${HUGO_PARAMS_ENVIRONMENT:-}" == 'production' ]]; then
  node "$VN_DEPLOY_ROOT/scripts/retire-public-workspace.mjs" "$VN_DEPLOY_ROOT/public" --audit
fi
VN_DEPLOY_ARGS=()
if [[ "${3:-}" == '--dry-run' ]]; then VN_DEPLOY_ARGS+=(--dryrun); fi
# Copy only the audited build, never the repository, backups or browser profile.
# Retain previous hashed chunks so existing open tabs can finish using them.
aws s3 cp "$VN_DEPLOY_ROOT/public/editor/assets/" "s3://$1/editor/assets/" --recursive --cache-control 'public,max-age=31536000,immutable' "${VN_DEPLOY_ARGS[@]}"
# Publish dependencies before the HTML and service worker that reference them.
aws s3 cp "$VN_DEPLOY_ROOT/public/" "s3://$1/" --recursive --exclude 'editor/assets/*' --exclude 'licenses/*' --exclude '*.html' --exclude 'sw.js' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
# License filenames include extensionless notices and .BSD: disable MIME guessing.
aws s3 cp "$VN_DEPLOY_ROOT/public/licenses/" "s3://$1/licenses/" --recursive --exclude 'inventory.json' --content-type 'text/plain' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
aws s3 cp "$VN_DEPLOY_ROOT/public/licenses/inventory.json" "s3://$1/licenses/inventory.json" --content-type 'application/json' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
aws s3 cp "$VN_DEPLOY_ROOT/public/" "s3://$1/" --recursive --exclude '*' --include '*.html' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
aws s3 cp "$VN_DEPLOY_ROOT/public/sw.js" "s3://$1/sw.js" --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
if [[ "${HUGO_PARAMS_ENVIRONMENT:-}" == 'production' ]]; then
  # Narrowly remove the previous public shell; retain older hashed dependencies.
  aws s3 rm "s3://$1/app/index.html" "${VN_DEPLOY_ARGS[@]}"
fi
if [[ "${3:-}" != '--dry-run' ]]; then
  VN_INVALIDATION_ID="$(aws cloudfront create-invalidation --distribution-id "$2" --paths '/*' --query 'Invalidation.Id' --output text)"
  echo "Waiting for CloudFront invalidation $VN_INVALIDATION_ID..."
  aws cloudfront wait invalidation-completed --distribution-id "$2" --id "$VN_INVALIDATION_ID"
fi
