# Optional collaboration relay

This Worker relays encrypted real-time collaboration traffic for Visual Nerve. A Durable Object serializes each room's membership and WebSocket traffic. The app continues to work locally when collaboration is disabled or the relay is unavailable.

The relay handles public device identities, owner-approved roles and invitations. It does not receive document decryption keys or plaintext diagrams. The browser uses OpenMLS for group encryption; the Worker treats MLS Commit, Welcome and application messages as opaque bytes. An HTTPS connection and relay permission alone do not authorize a document change: clients also verify the owner-signed room policy and authenticated MLS sender.

## Local checks and development

Use Node.js 22 or later. Run these commands from this directory:

```sh
npm ci
npm run check
npm test
npm run test:setup
npm run build
```

`build` is a local Wrangler dry run. It does not publish a Worker. Native relay tests run against workerd with real Web Crypto, Durable Object storage and WebSocket connections. Setup tests use synthetic credentials and do not contact Cloudflare.

```sh
npm run dev
```

Local development uses port 4357 and allows only `http://localhost:5173` and `http://127.0.0.1:5173`. It overrides the disabled production default for the local process. Match the app's Origin exactly when changing local ports. A native WebSocket handshake with an unlisted Origin is rejected.

## Deployment configuration

The tracked Wrangler configuration is disabled, does not expose a workers.dev hostname, and has Worker observability disabled. Nothing deploys automatically after a push. A deliberate manual deployment enables the Worker and configures its public address and Origin allowlist.

Place local credentials in the ignored repository-root `.env`, using the names in `.env.example`:

| Variable                        | Purpose                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`          | Private deployment credential, scoped to the intended account.                       |
| `CLOUDFLARE_ACCOUNT_ID`         | Intended Cloudflare account.                                                         |
| `COLLABORATION_WORKER_NAME`     | Reviewed Worker name.                                                                |
| `COLLABORATION_WORKER_URL`      | Exact HTTPS relay origin, with no path, query, password or fragment.                 |
| `COLLABORATION_ALLOWED_ORIGINS` | Comma-separated exact HTTPS app origins; must include `https://app.visualnerve.com`. |

Only the relay's public URL belongs in browser configuration. Never put the API token, account credentials or a document key in a `VITE_*` variable, HTML, a screenshot or a GitHub issue.

Use Cloudflare's [Workers deployment token guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) to grant access to the intended account. A custom hostname additionally requires permission to configure that domain in its Cloudflare zone. The optional account-access check below needs account read access; it does not demonstrate that every deployment permission has been granted.

The helper loads `.env` as data using Node's environment-file parser. It does not source shell commands, print credentials or place credentials in CLI arguments or its temporary configuration. Wrangler receives credentials through its process environment; its captured output is bounded and redacted before publication. The helper also disables Wrangler usage telemetry.

### Optional read-only credential check

```sh
npm run credentials:verify
```

This explicitly contacts Cloudflare's token verification and account-read endpoints. It reports only whether the token is active and the account is accessible. It does not create or change infrastructure, and no private response body is printed.

### Manual deployment

After approval and passing the relevant repository checks:

```sh
npm run deploy:manual
```

This command changes Cloudflare infrastructure. With a workers.dev URL it enables that public hostname. With a custom domain it configures a Worker custom-domain route for the supplied hostname. Confirm the hostname, account, Origin list and Durable Object migration before running it. The temporary configuration is removed after the command finishes.

For production, use **Deploy collaboration relay → Run workflow** on `main`. Configure the GitHub `collaboration-production` environment with the two `CLOUDFLARE_*` secrets and the three `COLLABORATION_*` variables above. Add an environment approval rule for the release reviewer. The workflow requires current-revision core CI and both relevant collaboration workflows, the same exact `PRODUCTION_APPROVED_SHA` owner approval as the site, and a successful latest manual **Deploy S3** staging run for that revision. Only Caripson may initiate or rerun it. It checks authorization before local Worker checks and again before Cloudflare credentials are supplied.

A path-filtered collaboration check with no run for an unrelated revision may reuse a successful `main` result only when immutable Git trees prove that all covered files, their modes and the workflow definition are unchanged. Changed inputs, missing history, pending/failed runs or unavailable verification block release; manually run the corresponding collaboration workflow on current `main` if required. The direct local command above changes infrastructure without the GitHub workflow's automatic CI/approval gate, so it is reserved for explicitly reviewed operator actions. See [collaboration release authorization](../docs/COLLABORATION_DEPLOYMENT.md#ci-and-manual-release-authorization).

After deployment, verify:

1. `GET /health` returns the expected protocol and bounds, with no private room data.
2. An unapproved browser Origin cannot open a WebSocket or create a room.
3. Two fresh browser profiles can request and approve membership, exchange encrypted changes and reconnect.
4. A viewer cannot change the document, and removing a member invalidates their access.
5. Locking the local workspace closes its collaboration session.

Disabling the Worker does not delete users' local encrypted documents. Removing a deployed Durable Object binding or changing migrations can erase or strand room access metadata; coordinate those changes as a release operation.

## Wire protocol and trust boundaries

`src/protocol.ts` contains the portable protocol types and canonical signing input used by the browser and relay. WebSocket URLs contain a room identifier, never a bearer token or invitation secret. A short-lived server challenge requires proof of possession of the device's P-256 key. Invitation secrets are sent only inside the authenticated TLS connection and are stored by the relay only as hashes.

The owner independently signs each ACL policy. Membership changes advance the policy revision and MLS epoch together and bind the exact decoded Commit/Welcome hashes. The relay persists the new public policy before acknowledging the owner. Clients validate that policy, the pinned owner identity and the actual MLS membership change. A viewer's key cannot authorize application mutations. Replayed transport sequence numbers and stale epochs are rejected.

The service stores only public owner/member keys, roles, signed policy metadata, hashed unused invitations, short-lived public join requests, lifecycle timestamps and minute-long public device traffic counters. Those counters retain a consumed rate budget across disconnects and Durable Object hibernation; they contain only a device identifier, window time, message count and byte count, expire after 60 seconds, and are bounded to 80 identities per room without evicting live budgets. It does not persist diagram, presence, Commit, Welcome or application ciphertext by default. Disabling Worker observability avoids application-level request logging; Cloudflare still operates the hosting network and may retain its own service/security metadata under the account's terms.

Rooms expire after seven idle days or thirty total days. The Durable Object closes sessions and deletes membership, invitation and pending-request metadata. A timestamp-only deleted-room tombstone expires after thirty more days. Clients pin the owner keys and must not treat reuse of a room identifier as the same trusted room.

Limits are discoverable through `/health` and defined in `src/protocol.ts`. These include 32 approved members, bounded public metadata and ciphertext, per-device command limits and rate-limited room creation/admission. The relay never silently truncates an accepted payload.

## Reconnect and unknown outcomes

The relay is an ephemeral encrypted transport rather than document backup storage. Same-epoch reconnection uses the browser's local MLS state and an encrypted peer snapshot. A newly approved member receives only its own Welcome. The owner can retransmit that exact Welcome while the matching signed transition is current.

The client must not automatically repeat a membership commit after an acknowledgement timeout: the outcome may be unknown. It reads the current owner-signed policy and reconciles the transition hash against its locally retained pending commit before merging or discarding it. If no peer retains the necessary state or a device missed multiple epochs, use a fresh owner-approved rejoin instead of reusing stale MLS sender state. An expired/deleted room must be recreated explicitly; the relay cannot restore encrypted history it never stored.
