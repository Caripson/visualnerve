# Public application, private browser data

`public/` is the complete static application. No backend is needed to create, edit, save, search, export or restore diagrams. The S3 bucket contains application files only. User content is never written to S3. CloudFront delivers code; it is not a synchronization layer.

```text
Internet → CloudFront → S3: static application files
                            ↓ downloaded app
                        your browser → IndexedDB: private content
```

## Build and inspect

```sh
./build.sh
node scripts/audit-static.mjs public
node deployment/template.mjs > /tmp/visual-nerve-cloudformation.json
```

The build regenerates `public/` from source. An explicit file allowlist rejects unexpected files and exports; the deployment script checks it again. Never upload the repository, browser profiles, downloaded diagram exports, workspace backups or test artifacts. Built-in example templates are app code, without user content.

## Manual production deployment

For an MPL-2.0 build, recipients must be able to obtain the corresponding covered source. Before publishing, provide actual source access as described in [licensing and source distribution](LICENSING.md); a link to a private repository alone is insufficient. Repository visibility remains the owner's choice, and this change does not deploy or publish source.

The existing production site is configured in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml):

| Setting | Value |
| --- | --- |
| URL | `https://visualnerve.caripson.com` |
| AWS region | `us-east-1` |
| S3 bucket | `visualnerve.caripson.com` |
| CloudFront distribution | `E3PXPDRARNVUFD` |
| AWS account | `094904000140` |
| S3 website index | `index.html` |
| S3 website error document | `error.html` (HTTP 404) |

To publish, open **Actions → Deploy S3 → Run workflow**, select `main`, and start the workflow. It installs the build tools, builds and audits `public/`, uploads the application to S3, and waits for CloudFront cache invalidation. It runs no unit tests, browser tests or formatting checks and does not depend on CI. Deployments run serially; an active production upload is never canceled by a newer run.

Deployment has only a manual `workflow_dispatch` trigger. Pushes and pull requests never publish to S3. The separate [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs Go race tests/vet, frontend unit tests, formatting, the production build and Playwright browser tests on pushes and pull requests to `main`. It has no AWS deployment steps. Only manual runs on `main` can deploy.

Set these repository **Actions secrets** in [GitHub Settings](https://github.com/Caripson/visualnerve/settings/secrets/actions):

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Replace any `REPLACE_IN_GITHUB` placeholder values with the deployment user's keys before running a deployment. The workflow rejects missing credentials and these placeholders without attempting an upload. Use secrets, not repository variables.

The deployment script uploads immutable hashed assets first, other resources next, HTML after its dependencies, and `sw.js` last. It keeps older hashed assets available for open tabs. After every upload succeeds it invalidates `/*` on CloudFront and waits for completion. An invalidation refreshes CDN assets; it does not clear the user's browser database or an already active offline shell.

This existing distribution uses the S3 **website endpoint**, whose index/error document settings are already configured. Hugo builds `error.html` in the bucket root. No new bucket, distribution, certificate or CloudFront function is created by CI. The managed CloudFront `CachingOptimized` policy has a minimum TTL of one second, so mutable assets can still be cached briefly despite `no-cache`; deployment waits for the final invalidation. See [AWS cache policy documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html) and [S3 error documents](https://docs.aws.amazon.com/AmazonS3/latest/userguide/CustomErrorDocSupport.html).

The deployment user's IAM policy only needs object uploads and this distribution's invalidations:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::visualnerve.caripson.com/*"
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::094904000140:distribution/E3PXPDRARNVUFD"
    }
  ]
}
```

The script uses `aws s3 cp`, never deletes existing objects and does not set object ACLs. It does not need IAM administration or permission to change the bucket/distribution configuration. See [S3 policy actions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html) and [CloudFront policy actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

## Optional new S3 and CloudFront infrastructure

The template defines a private S3 bucket, CloudFront Origin Access Control with `GetObject` permission, HTTPS delivery, GET/HEAD-only behavior and a viewer-request function for directory indexes and canonical-domain redirects. It creates no content API, database, account service or browser upload permission. See AWS's [Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) and [directory-index rewriting](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_url_rewrite_single_page_apps_section.html) documentation.

Choose **one canonical HTTPS origin before publishing**. Obtain an ACM certificate in `us-east-1` covering the canonical hostname and any alias. `AlternateDomain` optionally redirects a `www` address before the app runs. The distribution hostname also redirects when a canonical hostname is configured. Point all configured aliases at the distribution through DNS. With no custom hostname, use only the distribution's HTTPS hostname.

After reviewing the generated template, run these commands in your AWS account with your own domain and certificate:

```sh
aws cloudformation deploy \
  --template-file /tmp/visual-nerve-cloudformation.json \
  --stack-name visual-nerve \
  --parameter-overrides \
    CanonicalDomain=visualnerve.example.com \
    AlternateDomain=www.visualnerve.example.com \
    CertificateArn=YOUR_US_EAST_1_ACM_CERTIFICATE_ARN
aws cloudformation describe-stacks --stack-name visual-nerve \
  --query 'Stacks[0].Outputs'
# Substitute BucketName and DistributionId from the outputs:
./scripts/deploy-static.sh APP_BUCKET DISTRIBUTION_ID --dry-run
./scripts/deploy-static.sh APP_BUCKET DISTRIBUTION_ID
```

Builds and tests create no AWS resources. Deployment requires the operator's AWS credentials and domain configuration. The stack retains its bucket on deletion. The upload script sends only audited app files. Mutable HTML, entrypoints and the service worker require revalidation; hashed chunks are immutable and older chunks remain available to open tabs. Invalidation refreshes app delivery without touching browser content.

## Origin identity and updates

IndexedDB belongs to a browser profile **and** an origin: scheme, hostname and port. `https://visualnerve.example.com`, its `www` alias, HTTP and development ports have separate storage if the app runs there. Redirect aliases before serving the app. Changing origins requires users to export from the old one and import at the new one; redirects cannot move browser databases. Keep the original address stable. Dexie upgrades preserve records; do not reset databases on deployment.

The service worker caches only application assets after required acceptance. Existing tabs finish their current version; the new shell activates after they close. Users can save offline after completing a first visit.

## Equivalent static hosts

Serve `public/` as HTTPS files, map `/help/`, `/privacy/`, `/license/` and `/api/docs/` to their directory indexes, preserve asset MIME types and redirect aliases to one origin. Do not add a save endpoint or grant browser write access. The API reference is documentation; its optional local endpoints are not part of the public host. Browser tests verify a named HTTPS origin on a read-only Python static host separately from the Go bridge.

## Optional local MCP

The public site has no MCP server. Users may start the bridge on their own computer:

```sh
./bin/visual-nerve --bridge --addr 127.0.0.1:4317 \
  --allowed-origin https://visualnerve.example.com \
  --tls-cert /path/to/trusted-local-cert.pem \
  --tls-key /path/to/local-key.pem
```

Settings shows the current website origin and links to API documentation on that website. Use this exact origin in `--allowed-origin` (for this production site, `https://visualnerve.caripson.com`). The public domain identifies the app; the local service connects Codex to the open browser.

Use a certificate trusted by that browser for the chosen loopback host. Set `wss://127.0.0.1:4317/bridge` in **Settings → Local connection details**, or use `localhost` when the certificate covers that hostname. **MCP server URL for Codex** then shows the matching HTTPS `/mcp` address automatically; copy it to the MCP client configuration. **Instructions for Codex** includes the website, allowed origin, documentation and 2D/3D discovery steps, without the session token. The service stays loopback-only, validates the exact app origin and never stores graphs. Plain loopback WebSockets can work in some browsers, but secure-connection and local-network rules vary. Use trusted local TLS when required and grant local-network permission if prompted. See [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access) for browser policy changes.

The bridge exposes `visual_nerve_api_docs` and MCP resources for its bundled guide and full OpenAPI, even with no connected browser. Initial MCP instructions advertise 2D and opt-in 3D. After updating the bridge binary, restart it and reconnect the MCP client to refresh its discovered tools. Publishing the static website updates the browser UI and public API reference separately; S3 deployment remains manual.

Access is Off until the user chooses Read only or Read + write; the browser must stay open. See [PRIVACY.md](PRIVACY.md), [STORAGE.md](STORAGE.md) and [API.md](../API.md).
