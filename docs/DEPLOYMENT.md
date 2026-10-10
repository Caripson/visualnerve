# Manual staging and reviewed production

`public/` contains the public website. Production builds remove the former `/app/` editor shell; the website's reviewed CloudFront function redirects that path to `https://app.visualnerve.com/`. A separately audited `public-app/` package contains the encrypted workspace at its root only; the isolated app rejects `/app` with HTTP 404. Local development/staging fixtures may retain `/app/` for testing. S3 and CloudFront deliver static files and do not store user diagrams. The browser owns IndexedDB content.

```text
Push main → CI tests/build
                  ↓ successful exact commit
Manual Deploy S3 → staging → owner reviews the whole site
                                      ↓ explicit exact-SHA approval
Manual Deploy production → www.visualnerve.com
Manual Deploy isolated app → app.visualnerve.com (separate package and gates)
```

No deployment workflow automatically runs after a push, PR, successful CI or staging run. Deploy jobs build/audit/upload; they do not run tests. Instead, their gate requires an already successful CI run for the deployed commit. CI remains the full independent Go/frontend/browser verification pipeline.

## Isolated encrypted app

**Deploy isolated app** (`.github/workflows/deploy-app.yml`) publishes only audited `public-app/` files to bucket `app.visualnerve.com`, distribution `E10TKGRYWGM422`, in the main-only `app-production` environment. It verifies the actual private S3 REST origin, OAC, exact LIVE routing function and security headers before upload. It preserves the existing public website and legacy workspace entry.

Besides successful exact-commit CI and manual staging, the app gate requires `PRODUCTION_APPROVED_SHA`, `APP_SURFACE_APPROVED_SHA` and `APP_SURFACE_STAGING_VERIFIED_SHA` to identify the same reviewed commit. Review the encrypted app fixture and native vault/MCP/offline checks as well as ordinary staging: the www/staging app uses the legacy backend. Publication waits for CloudFront invalidation. Post-deployment checks must use real public DNS/TLS and disposable profiles. Infrastructure preparation and an application release are separate operations. Follow [the full app-origin hosting and release guide](APP_ORIGIN_DEPLOYMENT.md).

Origin changes do not migrate IndexedDB. The owner authorized retiring the public `/app` route after the encrypted app release. Its redirect does not delete or read source browser records. Existing encrypted transfer and backup files can be restored explicitly; keep an unexported older browser profile intact and contact `hello@visualnerve.com` before clearing site data. See [storage and transfer](STORAGE.md).

## Destinations and build configuration

| Setting                 | Staging: Deploy S3                   | Production: Deploy production                                |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Workflow                | `.github/workflows/deploy.yml`       | `.github/workflows/deploy-production.yml`                    |
| Site URL                | `https://visualnerve.caripson.com`   | `https://www.visualnerve.com`                                |
| S3 bucket               | `visualnerve.caripson.com`           | `www.visualnerve.com`                                        |
| CloudFront distribution | `E3PXPDRARNVUFD`                     | `E2DFG7DKVLDNIQ` via `PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID` |
| GitHub environment      | `staging`                            | `production`, main only                                      |
| Hugo environment        | `staging`                            | `production`                                                 |
| Search indexing         | `noindex`, disallowed staging robots | Production canonical URL/indexing                            |
| AWS region/account      | `us-east-1` / `094904000140`         | `us-east-1` / `094904000140`                                 |

The staging hostname previously served the application directly. It now hosts the complete review site, with the application at `/app/`. No browser origin changes merely because the editor path changes. Production is a different origin; existing staging work needs export/restore there.

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

The [source repository](https://github.com/Caripson/visualnerve) is public. For each distributed build, preserve access to its corresponding covered source and notices as explained in [licensing and source distribution](LICENSING.md). A deployment does not change repository visibility, create a tagged release or resolve separate third-party source obligations automatically.

## Publish staging for review

1. Commit and push the intended revision to `main`.
2. Wait for **CI** to complete successfully for that exact full commit SHA. A pending, failed, canceled or skipped latest CI run blocks deployment.
3. Open **Actions → Deploy S3 → Run workflow**, select `main` and run it manually.
4. Wait for build/upload and CloudFront invalidation to complete. The workflow summary identifies the deployed SHA.
5. Review `https://visualnerve.caripson.com`, `/app/`, public pages, Help, API reference, desktop/mobile layouts and consent behavior.

The gate reads the latest CI **push** run on main for `GITHUB_SHA`; a PR result or a success for another revision is insufficient. It also requires main's current head to equal that SHA, so rerunning an old workflow cannot publish stale code after main advances. CI history/API failures block deployment. The gate is checked again before publication.

When the optional collaboration source exists, that same gate also requires its relay and browser-cryptography workflows. It rejects missing workflow definitions and failed/pending exact-revision runs. A path-filtered run absent for an unrelated revision may reuse successful validation only after immutable Git trees prove its covered files, file modes and workflow definition unchanged. Changed inputs or unavailable proof block release. Both collaboration workflows can be dispatched manually for current `main`. The manual relay production workflow uses this gate before Cloudflare access, including reviewed staging and owner SHA approval; see [collaboration deployment](COLLABORATION_DEPLOYMENT.md#ci-and-manual-release-authorization).

Staging is marked noindex. That is a search-engine instruction, not authentication or access control; anyone who can reach the hostname can read the site. User workspace records remain browser-local.

Deployments to each destination are serialized and are not canceled by a newer run. Uploads publish hashed assets first, other resources next, HTML after its dependencies and `sw.js` last. Older hashed assets remain available to open tabs. Only after successful uploads does the script invalidate `/*` and wait for completion.

## Production approval is currently an explicit SHA gate

Historical setup: on 2026-10-07, while the repository was private, configuring the required reviewer **Caripson** (GitHub user ID `31686838`) returned GitHub HTTP 422 because that plan/visibility combination did not support the required-reviewers protection rule. The repository became public on 2026-10-08. This launch uses the existing explicit SHA gate; public visibility does not itself configure a native reviewer rule. GitHub's [environment documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) describes those controls.

The `production` environment exists and accepts only the `main` branch. **It currently has no native required-reviewer rule.** The workflow therefore fails closed through an explicit repository variable instead of pretending that GitHub has paused it for review.

After the owner has reviewed and approved the complete staging result:

1. Open **Settings → Secrets and variables → Actions → Variables** in GitHub.
2. Create/update `PRODUCTION_APPROVED_SHA` with the exact full 40-character SHA shown by the successful staging workflow. Setting it is the deliberate production-approval step. The workflow never sets it for you.
3. Confirm `PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID` is `E2DFG7DKVLDNIQ`, the reviewed distribution for `www.visualnerve.com`. Re-review this value before changing the production infrastructure.
4. As **Caripson**, manually run **Deploy production** on `main` while main still points to that approved SHA.
5. Remove or clear `PRODUCTION_APPROVED_SHA` after promotion when approval should no longer permit another deployment of that revision. Cancel an already running job if approval must be withdrawn during execution.

Before AWS access, production requires all of:

- Successful latest CI push run for the exact deployed SHA.
- Successful relevant collaboration verification, or immutable proof that its path-filtered inputs are unchanged since successful validation.
- The selected latest manual **Deploy S3** run on main completed successfully for that SHA. The gate orders runs by update time; before promotion, also confirm there is no newer dispatched pending or failed staging run. A later update of an older run can otherwise sort ahead of a newer queued run.
- `PRODUCTION_APPROVED_SHA` exactly equals that SHA.
- Original dispatcher and any rerun actor are Caripson.
- The production distribution variable and deployment credentials are configured.

A newer main commit requires fresh CI, staging review and exact-SHA approval. Production checks verification again after building. Staging success alone never grants approval or triggers production.

This fallback depends on repository administration and workflow integrity. It is not GitHub's native protected-environment reviewer control. If native required reviewers are configured now that the repository is public, keep Caripson and the main-only policy, and test the actual pending-approval behavior. Do not remove the exact revision gates simply because native approval becomes available.

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

For staging these resource ARNs are `arn:aws:s3:::visualnerve.caripson.com/*` and `arn:aws:cloudfront::094904000140:distribution/E3PXPDRARNVUFD`. For production these are `arn:aws:s3:::www.visualnerve.com/*` and `arn:aws:cloudfront::094904000140:distribution/E2DFG7DKVLDNIQ`. Do not expand permissions to unknown distributions to work around a missing variable. See AWS's [S3 policy actions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html) and [CloudFront actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

The script uses `aws s3 cp` and never deletes existing objects. A failed upload does not invalidate partially uploaded content. CDN invalidation refreshes delivery; it does not clear browser IndexedDB or force an already active offline shell to replace its version.

## Existing production infrastructure

The 2026-10-08 launch uses existing AWS resources, not a newly provisioned stack:

| Resource                       | Current configuration                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Canonical site                 | `https://www.visualnerve.com`                                                               |
| Production bucket              | `www.visualnerve.com`, using its S3 website endpoint as the origin                          |
| www CloudFront distribution    | `E2DFG7DKVLDNIQ`                                                                            |
| Apex redirect distribution     | `E2772DY3FXHIJC` for `visualnerve.com`                                                      |
| Shared viewer-request function | `visualnerve-production-canonical-site`, based on `deployment/viewer-request.js`            |
| Certificate names              | `*.visualnerve.com` and `visualnerve.com`                                                   |
| Static indexes/errors          | Directory routes resolve to `index.html`; origin 403/404 serves `/error.html` with HTTP 404 |

The apex distribution redirects to HTTPS www with status 308 and preserves the
path and query string before the editor opens browser storage. The shared
viewer-request function provides canonical-host handling and static directory
indexes while preserving exact license object paths, including extensionless
`LICENSE`, `NOTICE` and `COPYING` files. License notices are uploaded as
`text/plain`; the inventory remains `application/json`. These routes and 403/404
mappings were configured and checked separately from the application upload.
The workflow does not provision a certificate,
create a distribution or change viewer functions.

Staging continues to use its existing S3 website endpoint, `index.html`,
`error.html` and distribution `E3PXPDRARNVUFD`. Build/deploy does not replace that
infrastructure. CloudFront invalidation refreshes both cached content and cached
errors after a successful upload.

### Optional infrastructure template

`deployment/template.mjs` remains an alternative template for a separately
reviewed deployment. It defines a private S3 bucket, CloudFront Origin Access
Control with `GetObject`, HTTPS delivery, GET/HEAD behavior and canonical/directory
rewriting. **No CloudFormation stack, private OAC bucket or OAC distribution was
provisioned for the current launch.** The template is not a description of the
existing website-origin resources above.

If a future deployment adopts this template, review the bucket ownership, ACM
certificate in `us-east-1`, aliases, DNS and actual distribution output before
changing deployment variables. Generating a template grants no permission to
provision or publish. See AWS [Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
[directory indexes](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_url_rewrite_single_page_apps_section.html),
[managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)
and [S3 error documents](https://docs.aws.amazon.com/AmazonS3/latest/userguide/CustomErrorDocSupport.html).

## Origin identity and offline updates

IndexedDB belongs to one browser profile and exact origin. The staging and production domains have separate workspaces. Redirect aliases before the app runs so users do not accidentally work under different hosts. To move existing data, export at the old origin and restore at the new one; redirects cannot migrate browser databases.

The production editor is at the isolated app root. The retired website `/app` redirects there; it does not migrate, encrypt or delete the old origin's IndexedDB. Local development/staging fixtures retain their `/app/` editor. Database upgrades preserve records. Do not reset local databases during deployment.

The service worker caches app files only after storage acceptance. Complete a first online visit before relying on offline reload and keep a backup independent of the browser. Installing or activating an application update does not open, clear, restore or migrate workspace IndexedDB, change its password or recovery key, or reset saved diagrams, source data, history, simulation archives and settings.

### Controlled app update protocol

The app checks its existing same-origin service-worker registration in the background every 15 minutes and on online, window-focus and visible-tab events. The update request fetches `sw.js`; it contains no workspace content or analytics. Offline checks fail without blocking editing or requiring an unlock. A fully installed waiting worker produces **An update is ready** in the app. **Later** leaves the currently loaded application code in use.

**Update now** is a user-authorized lifecycle operation. The client rejects activation while a modal, import/export or active simulation needs attention, then waits for pending local workspace saves. Resident simulation workers, including paused runs, must finish or be stopped so their terminal results can be saved; a paused in-memory execution state is not a resumable persisted checkpoint. Simulation archive write failures are explicitly checked and retried before activation. If any local save still fails, the restart remains blocked. The client obtains the prepared worker's public cache-version identifier through an `app-update-info` MessageChannel request and requests activation using `app-update-activate` with that exact version. The worker checks that the sender is a live, same-origin, in-scope window and rejects stale version identifiers before `skipWaiting()`. No password, recovery key, private model, MCP token or unlock capability is included in this protocol.

Failed autosave retries retain the repository's optimistic version checks and stop on a conflict instead of overwriting another tab's committed changes.

After controlled activation, only the requesting tab reloads. Other tabs are not forcibly restarted; the app can tell them that another tab installed an update so they can finish their current work before reloading. Reload discards the tab's in-memory encryption keys and integration grants: the user unlocks with the existing password and explicitly grants fresh API/MCP access. The semantic workspace model and API/MCP schema do not change merely because a service worker is updated.

Activation preserves older app-shell caches so already open tabs can still resolve their hashed lazy modules. The active worker can fall back to retained static assets from a prior app-shell cache. Publication continues to upload hashed assets before HTML and `sw.js` and keeps older hashed S3 objects; do not use sync-delete or discard old caches during activation. Explicit **Clear app cache** remains a separate, coordinated cleanup operation and is not required to update the app.

For first adoption, a tab loaded before the update-notice code was released cannot display that new feature. Finish and save its work, close all app tabs and reopen online if an ordinary reload continues to use the old shell. Do not clear site data or ask the user to export and reimport the workspace to obtain an app release. Backups remain important for browser storage loss and migration, independently of updating code.

## Equivalent static hosts

Serve the production `public/` package as HTTPS files, preserving asset MIME types and directory indexes for product pages, `/help/`, `/privacy/`, `/license/` and `/api/docs/`. `/app` aliases use a CloudFront 308 redirect to the app root; do not publish a second editor there. Redirect aliases to one origin. The public API reference is documentation; it does not create public workspace endpoints or a save API.

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
