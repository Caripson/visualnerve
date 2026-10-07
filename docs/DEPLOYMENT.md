# Manual staging and reviewed production

`public/` contains static application and documentation files. The product homepage is `/`; the editor is `/app/`. S3 and CloudFront deliver these files and do not store user diagrams. The browser owns IndexedDB content.

```text
Push main → CI tests/build
                  ↓ successful exact commit
Manual Deploy S3 → staging → owner reviews the whole site
                                      ↓ explicit exact-SHA approval
Manual Deploy production → www.visualnerve.com
```

Neither workflow automatically deploys after a push, PR, successful CI or staging run. Deploy jobs build/audit/upload; they do not run tests. Instead, their gate requires an already successful CI run for the deployed commit. CI remains the full independent Go/frontend/browser verification pipeline.

## Destinations and build configuration

| Setting                 | Staging: Deploy S3                   | Production: Deploy production                             |
| ----------------------- | ------------------------------------ | --------------------------------------------------------- |
| Workflow                | `.github/workflows/deploy.yml`       | `.github/workflows/deploy-production.yml`                 |
| Site URL                | `https://visualnerve.caripson.com`   | `https://www.visualnerve.com`                             |
| S3 bucket               | `visualnerve.caripson.com`           | `www.visualnerve.com`                                     |
| CloudFront distribution | `E3PXPDRARNVUFD`                     | Required `PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID` variable |
| GitHub environment      | `staging`                            | `production`, main only                                   |
| Hugo environment        | `staging`                            | `production`                                              |
| Search indexing         | `noindex`, disallowed staging robots | Production canonical URL/indexing                         |
| AWS region/account      | `us-east-1` / `094904000140`         | `us-east-1` / `094904000140`                              |

The staging hostname previously served the application directly. It now hosts the complete review site, with the application at `/app/`. No browser origin changes merely because the editor path changes. The new production domain is a different origin; existing work needs export/restore there.

`SITE_URL` controls Hugo's base URL. `HUGO_PARAMS_ENVIRONMENT` controls the site's environment metadata. `HUGO_PARAMS_GOOGLEANALYTICSMEASUREMENTID` receives `vars.GOOGLE_ANALYTICS_MEASUREMENT_ID` during the build. These are application settings, not AWS credentials.

## Build and inspect without publishing

```sh
SITE_URL=https://visualnerve.caripson.com \
HUGO_PARAMS_ENVIRONMENT=staging \
./build.sh
node scripts/audit-static.mjs public
node deployment/template.mjs > /tmp/visual-nerve-cloudformation.json
```

The build regenerates the static directory. An explicit allowlist rejects unexpected files and exports; the upload script audits again. Never upload the repository, browser profiles, downloaded workspace files, backups or test artifacts. Built-in examples are app code.

For an MPL-2.0 build, provide the corresponding covered source to recipients before distributing it, as explained in [licensing and source distribution](LICENSING.md). An inaccessible private GitHub link is insufficient. A deployment does not change repository visibility or create a source offer automatically.

## Publish staging for review

1. Commit and push the intended revision to `main`.
2. Wait for **CI** to complete successfully for that exact full commit SHA. A pending, failed, canceled or skipped latest CI run blocks deployment.
3. Open **Actions → Deploy S3 → Run workflow**, select `main` and run it manually.
4. Wait for build/upload and CloudFront invalidation to complete. The workflow summary identifies the deployed SHA.
5. Review `https://visualnerve.caripson.com`, `/app/`, public pages, Help, API reference, desktop/mobile layouts and consent behavior.

The gate reads the latest CI **push** run on main for `GITHUB_SHA`; a PR result or a success for another revision is insufficient. It also requires main's current head to equal that SHA, so rerunning an old workflow cannot publish stale code after main advances. CI history/API failures block deployment. The gate is checked again before publication.

Staging is marked noindex. That is a search-engine instruction, not authentication or access control; anyone who can reach the hostname can read the site. User workspace records remain browser-local.

Deployments to each destination are serialized and are not canceled by a newer run. Uploads publish hashed assets first, other resources next, HTML after its dependencies and `sw.js` last. Older hashed assets remain available to open tabs. Only after successful uploads does the script invalidate `/*` and wait for completion.

## Production approval is currently an explicit SHA gate

The repository is private. On 2026-10-07, configuring the required reviewer **Caripson** (GitHub user ID `31686838`) returned GitHub HTTP 422: the billing plan does not support the required-reviewers protection rule. GitHub's [environment documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) describes the plan/visibility restriction.

The `production` environment exists and accepts only the `main` branch. **It currently has no native required-reviewer rule.** The workflow therefore fails closed through an explicit repository variable instead of pretending that GitHub has paused it for review.

After the owner has reviewed and approved the complete staging result:

1. Open **Settings → Secrets and variables → Actions → Variables** in GitHub.
2. Create/update `PRODUCTION_APPROVED_SHA` with the exact full 40-character SHA shown by the successful staging workflow. Setting it is the deliberate production-approval step. The workflow never sets it for you.
3. Configure `PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID` with the actual reviewed distribution for `www.visualnerve.com`. No ID or certificate is inferred.
4. As **Caripson**, manually run **Deploy production** on `main` while main still points to that approved SHA.
5. Remove or clear `PRODUCTION_APPROVED_SHA` after promotion when approval should no longer permit another deployment of that revision. Cancel an already running job if approval must be withdrawn during execution.

Before AWS access, production requires all of:

- Successful latest CI push run for the exact deployed SHA.
- The latest manual **Deploy S3** run on main completed successfully for that SHA. A newer pending or failed staging run also blocks promotion.
- `PRODUCTION_APPROVED_SHA` exactly equals that SHA.
- Original dispatcher and any rerun actor are Caripson.
- The production distribution variable and deployment credentials are configured.

A newer main commit requires fresh CI, staging review and exact-SHA approval. Production checks verification again after building. Staging success alone never grants approval or triggers production.

This fallback depends on repository administration and workflow integrity. It is not GitHub's native protected-environment reviewer control. If plan/visibility later supports required reviewers, configure Caripson on production, keep the main-only policy, and test the actual pending-approval behavior. Do not remove the exact revision gates simply because native approval becomes available.

## Secrets, analytics and AWS permissions

Repository or appropriately scoped environment **Actions secrets** provide:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Missing values and `REPLACE_IN_GITHUB` placeholders are rejected before upload. Prefer separate least-privilege deployment identities for staging and production when provisioning them. The workflow's allowed AWS account is `094904000140`.

Repository **Actions variables** provide:

- `GOOGLE_ANALYTICS_MEASUREMENT_ID`: optional public-page analytics; a missing/invalid ID loads no Google tag.
- `PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID`: required actual production distribution.
- `PRODUCTION_APPROVED_SHA`: empty/unset until the owner explicitly approves the reviewed revision.

For analytics, **disable Enhanced Measurement in the GA4 web stream** and remove Connected Site Tags or custom automatic tags/events that read page URLs or content before activating Analytics. These account settings cannot be verified using the Measurement ID alone. The site explicitly sends sanitized public-route page views only after saved opt-in, excludes query/hash/referrer content and sets a constant title. Advertising/signals are disabled. Analytics never runs on `/app/`, `/help/` or `/api/docs/`. Cookie settings supports rejection/withdrawal. See [the privacy page](../hugo/content/privacy.md) and [WEBSITE.md](WEBSITE.md).

The upload identity needs `s3:PutObject` and `s3:AbortMultipartUpload` on the chosen bucket's object ARN, plus `cloudfront:CreateInvalidation` and `cloudfront:GetInvalidation` on the actual chosen distribution ARN. It does not need IAM administration, object ACLs, S3 deletes or permission to alter CloudFront.

For staging these resource ARNs are `arn:aws:s3:::visualnerve.caripson.com/*` and `arn:aws:cloudfront::094904000140:distribution/E3PXPDRARNVUFD`. For production use `arn:aws:s3:::www.visualnerve.com/*` and the reviewed distribution's real ARN. Do not expand permissions to unknown distributions to work around a missing variable. See AWS's [S3 policy actions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html) and [CloudFront actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

The script uses `aws s3 cp` and never deletes existing objects. A failed upload does not invalidate partially uploaded content. CDN invalidation refreshes delivery; it does not clear browser IndexedDB or force an already active offline shell to replace its version.

## Infrastructure is provisioned separately

The existing staging distribution uses the S3 website endpoint, with `index.html` and `error.html` (404). Build/deploy does not create or change its infrastructure. Its cache policy may retain mutable files briefly; the deployment waits for final invalidation.

The optional CloudFormation template defines a private S3 bucket, CloudFront Origin Access Control with `GetObject`, HTTPS delivery, GET/HEAD behavior and directory/canonical-origin rewriting. It creates no content API, browser write permission, account service or application database.

For the new production origin, review the generated template and provision an ACM certificate in `us-east-1` that covers the actual canonical domain and aliases. `BucketName` can set the private OAC bucket's explicit name. Review availability/ownership of that bucket name before provisioning it.

The following is an **operator preparation example**, not an action performed by CI or this task:

```sh
aws cloudformation deploy \
  --template-file /tmp/visual-nerve-cloudformation.json \
  --stack-name visual-nerve-production \
  --parameter-overrides \
    BucketName=www.visualnerve.com \
    CanonicalDomain=www.visualnerve.com \
    AlternateDomain=visualnerve.com \
    CertificateArn=YOUR_REVIEWED_US_EAST_1_ACM_CERTIFICATE_ARN
aws cloudformation describe-stacks --stack-name visual-nerve-production \
  --query 'Stacks[0].Outputs'
```

Use the actual `DistributionId` output for `PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID`, configure DNS/canonical redirects, and verify the certificate/origin before production approval. The stack retains its bucket on deletion. No production provisioning, workflow dispatch or AWS upload is implied by adding these files.

See AWS [Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [directory indexes](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_url_rewrite_single_page_apps_section.html), [managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html) and [S3 error documents](https://docs.aws.amazon.com/AmazonS3/latest/userguide/CustomErrorDocSupport.html).

## Origin identity and offline updates

IndexedDB belongs to one browser profile and exact origin. The staging and production domains have separate workspaces. Redirect aliases before the app runs so users do not accidentally work under different hosts. To move existing data, export at the old origin and restore at the new one; redirects cannot migrate browser databases.

The editor's route is `/app/`; changing from `/` to `/app/` on the same scheme/host/port retains the browser-storage origin. Database upgrades preserve records. Do not reset local databases during deployment.

The service worker caches app files only after storage acceptance. Existing tabs keep their version until they close; the new shell activates after that. Complete a first online visit before relying on offline reload and keep a backup independent of the browser.

## Equivalent static hosts

Serve `public/` as HTTPS files, preserving asset MIME types and directory indexes for `/app/`, product pages, `/help/`, `/privacy/`, `/license/` and `/api/docs/`. Redirect aliases to one origin. The public API reference is documentation; it does not create public workspace endpoints or a save API.

## Optional local MCP

The public site has no MCP server. A user can start the optional bridge on their own computer:

```sh
./bin/visual-nerve --bridge --addr 127.0.0.1:4317 \
  --allowed-origin https://www.visualnerve.com \
  --tls-cert /path/to/trusted-local-cert.pem \
  --tls-key /path/to/local-key.pem
```

Use the exact origin currently shown in Settings, such as staging's `https://visualnerve.caripson.com` during review. Origins omit `/app/`. The certificate must be trusted by the browser and cover the chosen loopback host. Set the matching `wss://…/bridge`; Settings derives the HTTPS `/mcp` client address.

Access starts Off; Read only or Read + write is an explicit browser grant. Plain loopback WebSockets may work in some browsers; local-network/TLS requirements vary. See [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access) and the [API/MCP guide](../hugo/content/help/api-mcp.md).

The bridge stays loopback-only, checks exact trusted origins and forwards commands to the browser without storing graphs. Bundled MCP guide/OpenAPI discovery works without content access. Updating the public site is separate from updating/restarting the local executable and reconnecting its client.
