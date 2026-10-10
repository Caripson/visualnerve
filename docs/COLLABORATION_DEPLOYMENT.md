# Configure the optional collaboration relay

Collaboration is disabled in an ordinary production app build. The worker's existence or a local Cloudflare credential does not enable browser sharing. Deploying the relay and enabling it in the isolated app are separate manual release steps.

The public worker hostname selected for this installation is `https://visual-nerve-collaboration.entis.workers.dev`. This is a public address, not an API token. Its actual availability and allowed origins must be verified during release; this document does not assert that it is deployed.

## Prepare a pinned app package

After reviewing the relay, build the normal site and prepare the separate app surface with one explicit public origin:

```sh
COLLABORATION_RELAY_ORIGIN=https://visual-nerve-collaboration.entis.workers.dev \
  node scripts/build-app-surface.mjs public public-app
node deployment/verify-app-hosting.mjs --audit public-app
```

`COLLABORATION_RELAY_ORIGIN` accepts only an exact HTTPS origin, without a trailing slash, path, query, fragment, credentials, wildcard or whitespace. It is optional. An unset or empty build variable leaves the feature disabled. Never put Cloudflare tokens, invitation capabilities or vault credentials in this variable or any Vite variable.

The builder adds the exact `visual-nerve-collaboration-relay` meta value to isolated app pages. It allows only that HTTPS origin and its corresponding WSS origin in `connect-src`; it adds no external script source or broad `https:`/`wss:` exception. The app manifest records the same public origin and complete response headers. Public marketing HTML remains unchanged and contains no relay configuration.

For the manual **Deploy isolated app** workflow, set the repository variable `COLLABORATION_RELAY_ORIGIN` to the reviewed public origin. This does not deploy a worker or change CloudFront by itself. The workflow still requires exact revision approval, successful CI and staging verification. No push automatically publishes the app.

## CI and manual release authorization

The normal S3, isolated app and **Deploy collaboration relay** workflows all use `scripts/require-ci.mjs`. The gate requires the current exact `main` revision's successful core CI. It also checks **Collaboration relay checks** and **Collaboration browser cryptography** when their corresponding feature exists. A missing workflow definition while its Worker or browser/Rust collaboration sources remain blocks release; only genuinely pre-feature revisions skip those histories. An existing exact-revision run must have completed successfully; queued, pending, failed, cancelled or skipped runs block release. An older success cannot override a newer failed run.

Those two collaboration workflows use path filters. An unrelated documentation change need not rerun cryptography: when no exact-revision run exists, the gate reads immutable GitHub commit trees and proves that every filtered source path, file mode and the workflow definition itself match the latest successful `main` run. It compares the complete target revision, including changes from earlier commits in a multi-commit push. Changed inputs, missing successful history, incomplete GitHub trees or unavailable verification block deployment. Both collaboration workflows offer **Run workflow** on `main` when fresh exact-revision verification is required.

Relay production deployment has the same authorization boundary as the site: only **Caripson** may initiate or rerun it, `PRODUCTION_APPROVED_SHA` must equal the current exact revision, and the latest manual **Deploy S3** staging run must have succeeded for that revision. The gate runs before local Worker checks and again immediately before Cloudflare credentials are supplied. Configure the `collaboration-production` environment with a release-review approval rule and the Worker variables/secrets described in its README. Enabling the app's public relay origin remains a separate reviewed manual release.

## Review the response policy before publication

The deployed CloudFront response-header policy must match the package's pinned policy. Updating a meta tag alone cannot override the HTTP Content Security Policy. The pure `prepareExistingAppResources` review helper accepts `collaborationRelayOrigin` alongside the existing bridge ports and produces the corresponding policy for manual review. It does not call AWS.

`verifyAppHosting` compares the actual CloudFront response-header policy with the audited package, including the configured relay. A mismatch stops publication before S3 uploads. Keep the existing private S3 REST origin, OAC, framing protections, no-referrer policy and manual deployment gates.

The relay must separately permit the exact `https://app.visualnerve.com` browser origin. CORS/origin checks are transport restrictions; room admission still requires approved device signatures, owner-signed policy and valid MLS messages. Do not use an origin allowlist as participant authorization.

## Verify the running service

After the approved manual deployment, check the isolated app's public meta and response policy, then inspect `GET /collaboration/capabilities` through an unlocked browser with an explicit MCP grant. `configured:true` reports a configured public origin; it does not prove relay availability or approve any participant.

Test a room using invented data and two separate unlocked browser profiles. Verify owner approval, Viewer restrictions, shared edits, disconnect/reconnect, participant removal and lock behavior. Reload requires fresh device admission; loss of the owner's live tab requires a new room. Do not advertise independently audited encryption or compliance certification for this integration.

See [the collaboration guide](../hugo/content/help/collaboration.md), [API semantics](../API.md#optional-realtime-collaboration), and the worker's own deployment instructions for its separately reviewed configuration.
