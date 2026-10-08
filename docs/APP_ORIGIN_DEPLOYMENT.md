# Preparing the isolated app origin

This guide describes the isolated app build, hosting controls and manual release gates.
Publication evidence is the successful **Deploy isolated app** run for its exact revision,
followed by live checks; preparation alone is not publication or certification.
The existing bucket and distribution are reused. A separate **Deploy isolated app** workflow performs reviewed manual
publication; it never creates infrastructure or runs after a push. Existing
www/staging workflows and their exact-commit review gates remain unchanged.

The intended boundary is:

| Origin                        | Surface                                               | Browser workspace                     |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `https://www.visualnerve.com` | Existing public website and `/app/` migration entry   | Existing origin-local records         |
| `https://app.visualnerve.com` | Isolated app, local guides/API reference and policies | Separate password-protected workspace |

Keep the existing `www.visualnerve.com/app/` available. Do not redirect it to the
app subdomain or delete its browser data: another origin cannot read those records.
For a complete move, use **Export encrypted transfer** on the legacy address,
then **Transfer existing workspace** on the destination. This preserves original
identifiers, source data, history and simulation archives, replaces destination
work only after explicit confirmation, and verifies all saved encrypted payloads
before reopening the editor. It does not delete the source or synchronize the two
copies. Ordinary **Restore backup → Merge/Replace** remains a separate import flow.
Keep the source and transfer file until the destination and its new backup have
been checked. See the [transfer guide](../hugo/content/help/settings.md#transfer-an-existing-workspace).
The app output retains `/app/` as a same-origin compatibility entry, while `/`
opens the workspace.

## Build a distinct package

After the normal checked build has produced `public/`:

```sh
node scripts/build-app-surface.mjs public public-app
```

The builder first audits the source. It leaves `public/` untouched and produces
`public-app/` separately, with a final app-only audit before replacing a previous
generated output. It refuses overlapping paths, symlinks, personal exports and
unrecognized destination folders; it never uploads anything.

The app package includes:

- The workspace at `/` and `/app/`, existing relative editor modules, layout/import/
  simulation workers, local WASM/pronunciation files and approved static assets.
- Local Help and its search/captures, interactive API reference, OpenAPI, license
  notices and simplified privacy/security/license pages.
- A dedicated offline shell using the same cache ownership/clear handshake as the
  normal app, with namespace `visual-nerve-app-shell-<hash>`. Speech runtime files
  remain lazy; application records and narration are not cached by that worker.
- `noindex` metadata, a blocking CSP meta policy for local previews, `robots.txt`
  disallowing indexing and an audited `app-surface.json` configuration manifest.

It excludes product landing pages, public navigation menus, marketing images,
Google Analytics tags/configuration, Klaro/consent executables and the mixed
website service worker. Product/setup links in documentation explicitly open the
separate www origin. License text may mention unused packages; that is not runtime
code or an analytics request.

Every generated HTML shell declares:

```html
<meta name="visualnerve-surface" content="isolated-app" />
<meta name="visualnerve-vault-required" content="true" />
<meta name="visualnerve-app-origin" content="https://app.visualnerve.com" />
```

The vault runtime uses the required-vault marker. These are build settings, not
authentication or a security boundary on their own. App-origin publication must
use a revision whose vault gate and migration/recovery behavior have passed tests.
Do not mistake a prepared shell containing the marker for an implemented vault.

For a reviewed preview/custom bridge configuration:

```sh
APP_SURFACE_ORIGIN=https://app-preview.visualnerve.com \
APP_WEBSITE_ORIGIN=https://www.visualnerve.com \
APP_BRIDGE_PORTS=4317,9443 \
node scripts/build-app-surface.mjs public public-app
```

Origins must be distinct HTTPS origins. The builder rejects the existing www and
Caripson workspace hostnames as app destinations. Ports are explicit, distinct
and bounded; there is no loopback port wildcard.

## Prepare separate hosting

The owner supplied the following existing infrastructure on 2026-10-08:

| Setting                     | Value                         |
| --------------------------- | ----------------------------- |
| App origin                  | `https://app.visualnerve.com` |
| App S3 bucket               | `app.visualnerve.com`         |
| App CloudFront distribution | `E10TKGRYWGM422`              |
| Region                      | `us-east-1`                   |

The initial read-only inspection on that date confirmed the hostname/certificate and HTTPS
redirect. At inspection, the distribution used the public S3 website origin over HTTP,
with no OAC, response-header policy or default root object. Bucket public-access
blocking was disabled and `/` returned `NoSuchKey: index.html`. This historical
snapshot is not a description of a subsequently hardened deployment. Before release, adapt these existing
resources to a private S3 REST origin with OAC, public-access blocking and the
reviewed app response policy below. Do not create a duplicate distribution or
replace the www/staging configuration.

### Harden the existing resources without creating a duplicate stack

For `E10TKGRYWGM422`, use the existing-resource plan generator rather than applying
the new-stack template. It makes no AWS calls and writes nothing on import:

```sh
node deployment/app-existing-resources.mjs \
  /tmp/app-distribution-config-reviewed.json \
  /tmp/app-target-reviewed.json > /tmp/app-existing-resource-plan.json
```

The first input is a fresh, sanitized `get-distribution-config` response containing
`ETag` and the complete `DistributionConfig`. The target input supplies the actual
twelve-digit `accountId`, prospective `originAccessControlId` and
`responseHeadersPolicyId`, and the dedicated `viewerRequestFunctionArn`:
`arn:aws:cloudfront::<accountId>:function/visualnerve-isolated-app-routes-E10TKGRYWGM422`.
These IDs must be reviewed and verified before use; the generator does not claim
that a referenced control or function already exists. Optional `bridgePorts` must
match the app output. The bucket, domain, region and distribution are fixed to the
owner-supplied target above. Credentials, access keys and origin authorization
headers do not belong in either file; nonempty origin headers are rejected.

The review artifact contains separate AWS CLI/API input shapes:

- `updateDistribution`: `Id`, the captured `IfMatch` and the complete replacement
  `DistributionConfig`. It preserves CallerReference, certificate/aliases, cache
  policy, WAF, logging and unrelated fields. It changes the app origin to regional
  S3 REST with OAC, serves `index.html` at the root, requires HTTPS and GET/HEAD,
  installs the app headers/routing function, and upgrades older TLS policies to
  TLS 1.2 (retaining an existing supported stronger policy). AWS requires a complete
  replacement and the current ETag's
  [IfMatch fence](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_UpdateDistribution.html).
- `createOriginAccessControl` and `createResponseHeadersPolicy`: configuration for
  reviewed creation or reuse, including `always`/SigV4 signing and the same CSP as
  the output package. These do not create a second distribution or bucket.
  [AWS's OAC guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
  requires a regular S3 origin and distribution-scoped bucket permission.
- `viewerRequestFunction`: source and configuration for a dedicated app function.
  `/`, `/app`, `/app/` and real Help/API directory paths resolve to their own
  static objects. Unknown routes are not redirected to the workspace.
  `FunctionCode` is base64 for AWS CLI's `base64` binary format;
  `viewerRequestFunctionSource` contains the same readable source for review.
  [Create/update and test it in DEVELOPMENT, then publish LIVE before association](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateFunction.html).
- `bucketPolicy`, `publicAccessBlock`, `ownershipControls` and
  `deleteBucketWebsite`: distribution-scoped read permission, all four public
  access blocks, BucketOwnerEnforced ownership and
  removal of the unused website endpoint. The read grant contains the exact
  distribution ARN including its owner account. It grants no object writes or
  bucket listing. Review any existing bucket policy before replacing it; preserve
  needed private administrative permissions and remove public-read grants.

Existing bucket encryption is intentionally unchanged. Read-only inspection found
AES256 with SSE-C blocked, BucketOwnerEnforced ownership and no public ACL grants.
Replacing the encryption settings with a generic baseline would unnecessarily
remove that SSE-C restriction; no encryption-reset payload is emitted.

Both origin 403 and 404 use `/error.html` with **HTTP 404**, never a global HTTP 200
SPA fallback. Missing Help articles and assets therefore remain errors. Error
cache TTL is requested as zero; S3 origins retain CloudFront's minimum one-second
[error caching](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-expiration.html).
Extra origins, failover/cache behaviors, conflicting viewer-request
handlers and existing HTTP 200 error fallbacks require separate review and are
rejected rather than silently rewritten.

Before applying anything, obtain owner approval and verify current AWS ownership,
the actual OAC/header-policy settings, the dedicated function's LIVE source, and
the app's vault/CSP/browser checks. Re-fetch the distribution snapshot immediately
before its update: the historical ETag in inspection evidence is not an approval
or a reusable update token. Apply the private bucket/OAC cutover deliberately,
wait for CloudFront deployment, and confirm known static objects (use a reviewed
non-sensitive probe if the bucket is empty), headers, direct S3 denial and
unknown-route 404s. Do not publish the app package until that private
cutover and the release gates pass. Invalidation and publication remain separate
reviewed manual operations. The infrastructure preparation generator makes no
AWS changes and does not publish app files; publication uses the separate manual
**Deploy isolated app** workflow described below after the release gates pass.

The `app-template.mjs` template below remains a reference for a genuinely new
environment. **Do not apply it to duplicate the owner's existing app resources.**

Generate the reviewable app CloudFormation template without calling AWS:

```sh
node deployment/app-template.mjs > /tmp/visualnerve-app-template.json
```

Use a separate stack/private S3 bucket and exact app certificate/hostname. The
template preserves S3 public-access blocking, OAC read-only access, TLS and
GET/HEAD-only delivery. It rejects www as a bucket/alias/canonical target. The
standalone template leaves bucket naming to deployment parameters. The existing
bucket and distribution listed above require an explicit configuration update
rather than deployment of another independent stack. No public API/MCP server is
provisioned.

Its app-only CloudFront response policy prepares CSP, HSTS (without preload or
parent-domain/subdomain assumptions), nosniff, DENY framing, no-referrer,
Permissions-Policy, same-origin opener/resource controls and noindex headers.
These headers are not applied to the live website by committing this preparation.
Framing protection requires the HTTP headers: the HTML CSP intentionally omits
`frame-ancestors`, which browsers do not enforce from a meta element.

Executable scripts/workers remain local. WASM compilation is permitted using
`wasm-unsafe-eval`; general JavaScript eval and inline scripts are not allowed.
Dynamic element styles are permitted for React Flow, Three and export rendering.
Image/media blobs and data images/fonts support local rendering/export.

Connections are limited to this origin, explicit loopback WebSockets at `/bridge`
and fixed voice-model hosting. The pinned Piper model HEAD requests currently
resolve from the Hugging Face model path to `us.aws.cdn.hf.co`; only those hosts are
permitted. The speech runtime additionally validates exact model URLs, byte limits
and SHA-256. A future model-host redirect change should fail closed until reviewed.
Voice synthesis and text stay local. The app template's `BridgePort` defaults to
4317 and must match the output policy; additional approved ports require an
explicit response-policy update matching `app-surface.json`.
Use `127.0.0.1` or `localhost` for the isolated app's bridge address. Literal IPv6
host sources are not part of the current CSP host-source grammar, so an `[::1]`
destination is deliberately not promised by this policy. The existing legacy
bridge settings remain unchanged. A scheme/host wildcard is not used as a workaround.

## Manual release prerequisites

The workflow `.github/workflows/deploy-app.yml` is **Deploy isolated app**. It has
only a manual `workflow_dispatch` trigger and an independent serialized deployment
group. Committing it grants no release approval and changes no AWS configuration.
`deployment/prepare-app.workflow.example.yml` remains an inactive, artifact-only
example outside `.github/workflows/`; moving it into Actions is unnecessary.

Before the first release:

1. Finish the private REST/OAC cutover above for the existing app infrastructure,
   deploy the exact dedicated LIVE route function and install the app response
   policy. Match its explicit bridge ports to the app build; the production
   workflow uses port **4317**.
2. Create/review the GitHub **app-production** environment with a main-only branch
   policy. Add a native reviewer rule if desired and available; the workflow's
   explicit SHA gates do not depend on such a rule being configured automatically.
3. Commit and push the complete release on main, then wait for its latest CI push
   run to succeed. Manually deploy that same SHA using **Deploy S3** and review the
   public site and preserved legacy workspace. The latest staging run must succeed
   for the same revision and main must still point to it.
4. Verify the isolated package under the actual HTTP response CSP, including
   unlock/lock/timeout, cross-tab revocation, recovery and complete transfer,
   CSV/code/layout/simulation workers, 3D, PNG/PDF/SVG/video exports, real speech/WASM,
   offline reload and the local bridge. A successful normal www test does not prove
   app-origin compatibility. A metadata CSP alone does not test all response headers.
5. Set all three approval variables to the same full, final 40-character SHA after
   the owner-authorized review and app verification:

   | Actions variable                   | Meaning                                                              |
   | ---------------------------------- | -------------------------------------------------------------------- |
   | `PRODUCTION_APPROVED_SHA`          | Approval of the exact CI/staging-verified public revision            |
   | `APP_SURFACE_APPROVED_SHA`         | Separate approval of the isolated app release                        |
   | `APP_SURFACE_STAGING_VERIFIED_SHA` | Verification of that exact app build and migration/recovery behavior |

   These values are deliberate release gates, not credentials. The workflow never
   populates them or treats a missing value as approval. A later main commit needs
   fresh CI, staging review, app verification and updated exact-SHA gates.

6. As **Caripson**, manually run **Deploy isolated app** on main. Its existing
   production gate checks both the original dispatcher and rerun actor. It requires
   reviewed `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` Actions secrets and checks
   the AWS account **094904000140**. The destination is hard-fixed to bucket
   **app.visualnerve.com**, distribution **E10TKGRYWGM422**, region **us-east-1**.
   Caller arguments or destination variables cannot redirect this uploader.

The workflow builds `public/`, prepares `public-app/`, audits the app-only package,
and rechecks all revision gates before obtaining AWS credentials. It calls the
separate `scripts/deploy-app.sh`, which checks the gates and package again before
any AWS requests. `scripts/deploy-static.sh` continues publishing only `public/`
for staging/www and is unchanged.

### Hosting check and publication order

The app uploader reads the actual AWS identity, deployed distribution, associated
OAC, response-header policy, bucket location, public-access blocks, ownership,
bucket policy and dedicated LIVE function source before uploading. It rejects a
website origin, missing private controls, insecure TLS, extra cache behaviors,
unreviewed functions, HTTP200 error fallback, foreign/public bucket grants or any
of the nine response headers differing from the audited package. Website absence
must return `NoSuchWebsiteConfiguration`; an access-denied or network error cannot
be mistaken for proof that it is disabled. The check is read-only and does not
attempt to repair infrastructure during publication.

The upload identity consequently needs the existing app-scoped object upload/
multipart and CloudFront invalidation permissions, plus these read-only checks:
CloudFront `GetDistribution`, `GetOriginAccessControl`, `GetResponseHeadersPolicy`,
`DescribeFunction`, `GetFunction`, and S3 `GetBucketLocation`, `GetBucketPolicy`,
`GetBucketPublicAccessBlock`, `GetBucketOwnershipControls`, `GetBucketWebsite`.
Scope them to the reviewed resources wherever AWS supports resource scoping;
review IAM separately rather than granting administration to make a check pass.

After hosting validation, the uploader rechecks the exact release gates and
audits the package once more. It publishes hashed dependencies first, retains old
hashed chunks for open tabs, uploads other resources and explicit text/plain
license notices next, then HTML and finally `sw.js`. It never uses delete/sync or
uploads the repository, exports, browser profile or mixed public website. It then
invalidates `/*` on the app distribution and waits for completion. Failure before
upload performs no content mutation; a failed upload can leave partial new files
and does not proceed to invalidation.

For an authorized manual dry run with the same Actions/GitHub gate environment and
read-only AWS checks, `scripts/deploy-app.sh --dry-run` adds `--dryrun` to every copy
and performs no invalidation. It is not an approval bypass or offline fixture.

### Verify the release before proceeding

After the workflow completes, verify the actual HTTPS app root, compatibility
`/app/`, Help and API routes; all response security headers; direct unauthenticated
S3 denial; missing-route/asset HTTP404; absence of marketing/Analytics requests;
unlock/save/reload/lock and bridge grants. Test the real transfer from the preserved
legacy www workspace using non-sensitive sample data and check its source is still
present. Complete transfer must verify a pending saved copy before editor/API
startup, including after an interrupted tab or Cancel; it is never an automatic
cross-origin migration. Complete CDN invalidation alone does not clear IndexedDB
or immediately replace an already-open browser's offline shell.

Keep deployment/workflow evidence for the exact published SHA. Clear the approval
variables when that revision should no longer be publishable, and cancel an already
running workflow to withdraw an in-flight release. Public-site production remains
its own manual workflow; publishing either surface cannot replace the other.

This preparation supplies no SSO, centralized access policy, audit attestation,
tamper-proof local logs or compliance certification. Browser/device protection,
key handling, backup policy and authorized external clients remain part of the
security design.

References: [CloudFront response-header policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-responseheaderspolicy.html),
[CloudFront security headers](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-responseheaderspolicy-securityheadersconfig.html),
[Web Crypto security considerations](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#security-considerations).
