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
# Only content-addressed images receive immutable caching; stable aliases revalidate.
VN_IMAGE_HASH_GLOB='*-'
for ((VN_IMAGE_HASH_INDEX=0; VN_IMAGE_HASH_INDEX<16; VN_IMAGE_HASH_INDEX++)); do VN_IMAGE_HASH_GLOB+='[a-f0-9]'; done
aws s3 cp "$VN_DEPLOY_ROOT/public/" "s3://$1/" --recursive --exclude '*' --include "site/images/$VN_IMAGE_HASH_GLOB.webp" --include "help/images/$VN_IMAGE_HASH_GLOB.webp" --include "site/devices/$VN_IMAGE_HASH_GLOB.svg" --cache-control 'public,max-age=31536000,immutable' "${VN_DEPLOY_ARGS[@]}"
# Publish the immutable source before the stable installer that pins its checksum.
VN_DOWNLOAD_EXCLUDES=()
VN_DOWNLOAD_DIRECTORY="$VN_DEPLOY_ROOT/public"/downloads
if [[ -d "$VN_DOWNLOAD_DIRECTORY" ]]; then
  VN_BRIDGE_ARCHIVES=("$VN_DOWNLOAD_DIRECTORY"/visual-nerve-bridge-source-*.zip)
  VN_BRIDGE_ARCHIVE="${VN_BRIDGE_ARCHIVES[0]}"
  VN_BRIDGE_FILENAME="${VN_BRIDGE_ARCHIVE##*/}"
  aws s3 cp "$VN_BRIDGE_ARCHIVE" "s3://$1/downloads/$VN_BRIDGE_FILENAME" --content-type 'application/zip' --cache-control 'public,max-age=31536000,immutable' "${VN_DEPLOY_ARGS[@]}"
  aws s3 cp "$VN_BRIDGE_ARCHIVE.sha256" "s3://$1/downloads/$VN_BRIDGE_FILENAME.sha256" --content-type 'text/plain' --cache-control 'public,max-age=31536000,immutable' "${VN_DEPLOY_ARGS[@]}"
  aws s3 cp "$VN_DOWNLOAD_DIRECTORY/bridge-release.json" "s3://$1/downloads/bridge-release.json" --content-type 'application/json' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
  aws s3 cp "$VN_DOWNLOAD_DIRECTORY/visual-nerve-bridge-setup.sh.sha256" "s3://$1/downloads/visual-nerve-bridge-setup.sh.sha256" --content-type 'text/plain' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
  aws s3 cp "$VN_DOWNLOAD_DIRECTORY/visual-nerve-bridge-setup.sh" "s3://$1/downloads/visual-nerve-bridge-setup.sh" --content-type 'text/plain; charset=utf-8' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
  VN_DOWNLOAD_EXCLUDES=(--exclude 'downloads/*')
fi
# Publish dependencies before the HTML and service worker that reference them.
aws s3 cp "$VN_DEPLOY_ROOT/public/" "s3://$1/" --recursive --exclude 'editor/assets/*' --exclude 'licenses/*' --exclude '*.html' --exclude 'sw.js' --exclude 'openapi.yaml' ${VN_DOWNLOAD_EXCLUDES[@]+"${VN_DOWNLOAD_EXCLUDES[@]}"} --exclude "site/images/$VN_IMAGE_HASH_GLOB.webp" --exclude "help/images/$VN_IMAGE_HASH_GLOB.webp" --exclude "site/devices/$VN_IMAGE_HASH_GLOB.svg" --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
# License filenames include extensionless notices and .BSD: disable MIME guessing.
aws s3 cp "$VN_DEPLOY_ROOT/public/licenses/" "s3://$1/licenses/" --recursive --exclude 'inventory.json' --content-type 'text/plain' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
aws s3 cp "$VN_DEPLOY_ROOT/public/licenses/inventory.json" "s3://$1/licenses/inventory.json" --content-type 'application/json' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
# The generator writes JSON (a YAML subset); use its real, compressible MIME type.
aws s3 cp "$VN_DEPLOY_ROOT/public/openapi.yaml" "s3://$1/openapi.yaml" --content-type 'application/json' --cache-control 'no-cache' "${VN_DEPLOY_ARGS[@]}"
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
