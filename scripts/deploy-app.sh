#!/usr/bin/env bash
set -euo pipefail
VN_APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -gt 1 || "${1:-}" != '' && "${1:-}" != '--dry-run' ]]; then
  echo 'Usage: scripts/deploy-app.sh [--dry-run]' >&2
  exit 2
fi
# Fixed separate destination. Caller arguments and variables cannot redirect it.
export APP_S3_BUCKET=app.visualnerve.com
export APP_CLOUDFRONT_DISTRIBUTION_ID=E10TKGRYWGM422
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=''
VN_APP_PACKAGE="$VN_APP_ROOT/public-app"
check_release() {
  node "$VN_APP_ROOT/deployment/require-app-approval.mjs"
  node "$VN_APP_ROOT/scripts/require-ci.mjs" production
  node "$VN_APP_ROOT/deployment/verify-app-hosting.mjs" --audit "$VN_APP_PACKAGE"
}
check_release
VN_APP_REVIEW="$(mktemp -d "${TMPDIR:-/tmp}/visualnerve-app-hosting.XXXXXX")"
trap 'rm -rf "$VN_APP_REVIEW"' EXIT
# These are read-only checks of the already-reviewed resources, never provisioning.
aws sts get-caller-identity --output json > "$VN_APP_REVIEW/identity.json"
aws cloudfront get-distribution --id "$APP_CLOUDFRONT_DISTRIBUTION_ID" --output json > "$VN_APP_REVIEW/distribution.json"
VN_APP_REFERENCES="$(node "$VN_APP_ROOT/deployment/verify-app-hosting.mjs" --references "$VN_APP_REVIEW/distribution.json")"
read -r VN_APP_OAC VN_APP_HEADERS <<< "$VN_APP_REFERENCES"
aws cloudfront get-origin-access-control --id "$VN_APP_OAC" --output json > "$VN_APP_REVIEW/oac.json"
aws cloudfront get-response-headers-policy --id "$VN_APP_HEADERS" --output json > "$VN_APP_REVIEW/headers.json"
aws cloudfront describe-function --name visualnerve-isolated-app-routes-E10TKGRYWGM422 --stage LIVE --output json > "$VN_APP_REVIEW/functionDescription.json"
aws cloudfront get-function --name visualnerve-isolated-app-routes-E10TKGRYWGM422 --stage LIVE "$VN_APP_REVIEW/function.js" --output json > "$VN_APP_REVIEW/functionMetadata.json"
aws s3api get-bucket-location --bucket "$APP_S3_BUCKET" --output json > "$VN_APP_REVIEW/location.json"
aws s3api get-public-access-block --bucket "$APP_S3_BUCKET" --output json > "$VN_APP_REVIEW/publicAccess.json"
aws s3api get-bucket-ownership-controls --bucket "$APP_S3_BUCKET" --output json > "$VN_APP_REVIEW/ownership.json"
aws s3api get-bucket-policy --bucket "$APP_S3_BUCKET" --output json > "$VN_APP_REVIEW/bucketPolicy.json"
if aws s3api get-bucket-website --bucket "$APP_S3_BUCKET" --output json > "$VN_APP_REVIEW/website.json" 2> "$VN_APP_REVIEW/website-error.txt"; then
  echo 'App publication refused: the S3 website endpoint is still configured.' >&2
  exit 1
elif ! grep -q '(NoSuchWebsiteConfiguration)' "$VN_APP_REVIEW/website-error.txt"; then
  echo 'App publication refused: absence of the S3 website endpoint could not be verified.' >&2
  exit 1
fi
echo NoSuchWebsiteConfiguration > "$VN_APP_REVIEW/website-absent.txt"
node "$VN_APP_ROOT/deployment/verify-app-hosting.mjs" --verify "$VN_APP_REVIEW" "$VN_APP_PACKAGE"
# Main, CI and approvals may have changed while hosting was being inspected.
check_release
VN_APP_ARGS=()
if [[ "${1:-}" == '--dry-run' ]]; then VN_APP_ARGS+=(--dryrun); fi
# Keep older hashed assets for open tabs. Never use sync/delete or publish public/.
aws s3 cp "$VN_APP_PACKAGE/editor/assets/" "s3://$APP_S3_BUCKET/editor/assets/" --recursive --cache-control 'public,max-age=31536000,immutable' "${VN_APP_ARGS[@]}"
aws s3 cp "$VN_APP_PACKAGE/" "s3://$APP_S3_BUCKET/" --recursive --exclude 'editor/assets/*' --exclude 'licenses/*' --exclude '*.html' --exclude 'sw.js' --cache-control 'no-cache' "${VN_APP_ARGS[@]}"
aws s3 cp "$VN_APP_PACKAGE/licenses/" "s3://$APP_S3_BUCKET/licenses/" --recursive --exclude 'inventory.json' --content-type 'text/plain' --cache-control 'no-cache' "${VN_APP_ARGS[@]}"
aws s3 cp "$VN_APP_PACKAGE/licenses/inventory.json" "s3://$APP_S3_BUCKET/licenses/inventory.json" --content-type 'application/json' --cache-control 'no-cache' "${VN_APP_ARGS[@]}"
aws s3 cp "$VN_APP_PACKAGE/" "s3://$APP_S3_BUCKET/" --recursive --exclude '*' --include '*.html' --cache-control 'no-cache' "${VN_APP_ARGS[@]}"
aws s3 cp "$VN_APP_PACKAGE/sw.js" "s3://$APP_S3_BUCKET/sw.js" --cache-control 'no-cache' "${VN_APP_ARGS[@]}"
# The app has a single root entry. Retire its former duplicate object explicitly.
aws s3 rm "s3://$APP_S3_BUCKET/app/index.html" "${VN_APP_ARGS[@]}"
if [[ "${1:-}" != '--dry-run' ]]; then
  VN_APP_INVALIDATION="$(aws cloudfront create-invalidation --distribution-id "$APP_CLOUDFRONT_DISTRIBUTION_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
  echo "Waiting for isolated app CloudFront invalidation $VN_APP_INVALIDATION..."
  aws cloudfront wait invalidation-completed --distribution-id "$APP_CLOUDFRONT_DISTRIBUTION_ID" --id "$VN_APP_INVALIDATION"
fi
