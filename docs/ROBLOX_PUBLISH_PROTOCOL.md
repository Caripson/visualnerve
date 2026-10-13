# Local Roblox publication protocol

This optional broker runs in the existing loopback bridge. It has no REST/MCP publication-confirm endpoint, holds no game model and never writes artifacts or credentials to disk. Normal game definition, validation and build commands remain browser-owned REST/MCP operations. API release 0.11.0 uses the existing two MCP tools.

Publication requires an already human-unlocked workspace and an explicit current **Read + write** grant. Opening the publisher must not enable MCP access automatically. The browser's private trusted-click module captures the workspace lease, original grant, build artifact, model version, fixed destination and digest; it checks that authority again before every upload step. It must not expose these methods through repository dispatch or a tool-facing command.

Browser review and the independent local terminal form two approval steps; neither establishes physical human identity against a compromised machine. A raw local client can self-declare an allowed Origin and browser grant in its WebSocket hello, so those fields alone are not publication authority. Go additionally requires an independent fresh approval in the bridge's controlling terminal before HTTP. A token holder cannot provide that approval through WebSocket, REST, MCP, request data or environment variables. The remaining boundary does not protect against a compromised machine that controls the terminal itself. Bridge/browser restarts do not provide exactly-once publication.

## Local configuration

Only the bridge process reads these explicitly supplied environment variables:

| Variable                              | Value                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `VISUAL_NERVE_ROBLOX_PUBLISH_ENABLED` | Exactly `true` to enable the optional broker                              |
| `VISUAL_NERVE_ROBLOX_API_KEY`         | Open Cloud key scoped to `universe-places:write` on the intended universe |
| `VISUAL_NERVE_ROBLOX_UNIVERSE_ID`     | Canonical positive decimal int64 Universe ID                              |
| `VISUAL_NERVE_ROBLOX_PLACE_ID`        | Canonical positive decimal int64 Place ID                                 |

The key never appears in a WebSocket frame, browser setting, game model, export, backup, MCP result or diagnostic. An OS credential provider can supply the same process environment explicitly; the broker does not read an existing keychain or `.env` automatically. Disabled or incomplete configuration fails closed. Enabling the publisher requires foreground interactive stdin on a supported macOS/Linux controlling terminal. Files, pipes, daemon startup, unsupported terminal platforms and MCP stdio fail closed with a CLI message; native Studio export remains available. Public configuration exposes only `configured`, fixed target IDs and limits.

## Independent terminal approval

After final digest/XML validation, the consumed receipt enters `awaiting-approval`. The private controlling terminal displays only fixed Universe/Place IDs, model revision, byte count and full SHA-256, then requests:

```text
PUBLISH <placeId> <first-12-sha256-characters> <last-16-nonce-characters>
```

Compare these values with the browser's reviewed artifact, type the exact fresh phrase and press Enter within 60 seconds. Approval cannot be supplied in a browser frame or tool command. No environment auto-approval, credential prompt or pasted XML is accepted. The terminal owner serializes prompts with a fail-fast lock, resets pending input before/after, polls a separately opened nonblocking terminal descriptor in at most 100 ms slices, and limits the line to 256 bytes. Cancellation leaves no blocked read goroutine to consume a future phrase.

Only a true terminal decision followed by the broker's locked recheck of the original peer, origin, workspace, browser instance, grant and current write access permits the network phase. Denial, timeout, cancellation or revocation while awaiting approval discards XML and returns a definite cancelled receipt: no Roblox request was sent. After dispatch begins, interruption can still be unknown.

## WebSocket messages

The existing `/bridge` hello and access-change frames add `mcpAccess:"off"|"read"|"write"`. Omission leaves publication disabled for that peer and does not change ordinary forwarding. A control/locked peer cannot publish.

```ts
interface RobloxPublishRequest {
  type: "roblox-publish";
  requestId: string; // Canonical UUID, independently correlated from graph operations.
  browserInstanceId: string;
  accessGrantId: string;
  action:
    | "capabilities"
    | "begin"
    | "chunk"
    | "finalize"
    | "cancel"
    | "status"
    | "acknowledge-unknown";
  data: object; // Exact action shape below; unknown fields reject.
}
interface RobloxPublishResponse {
  type: "roblox-publish-result";
  requestId: string;
  status: number;
  body:
    | RobloxPublishCapabilities
    | RobloxPublishReceipt
    | {
        error: string;
        code: string;
      };
}
interface RobloxPublishCapabilities {
  configured: boolean;
  terminalApprovalRequired: true;
  target?: { universeId: string; placeId: string };
  limits: {
    chunkBytes: 65536;
    artifactBytes: 10485760;
    pendingPerPeer: 1;
    retainedOwners: 64;
    pendingBytes: 33554432;
    preparationMs: 60000;
    approvalMs: 60000;
    networkMs: 60000;
  };
}
interface RobloxPublishReceipt {
  nonce: string;
  state:
    | "receiving"
    | "awaiting-approval"
    | "publishing"
    | "succeeded"
    | "failed"
    | "unknown"
    | "cancelled";
  target: { universeId: string; placeId: string };
  sha256: string;
  totalBytes: number;
  receivedBytes: number;
  nextIndex: number;
  expiresAt: string;
  requiresDashboardReconciliation: boolean;
  versionNumber?: number;
  error?: { code: string; message: string };
}
```

Action bodies:

| Action                | Exact `data`                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `capabilities`        | `{}`                                                                                                     |
| `begin`               | `{diagramId,baseVersion,artifactName:"game.rbxlx",sha256,totalBytes,universeId,placeId}`                 |
| `chunk`               | `{nonce,index,offset,data}`; `data` is strict padded base64 of at most 65,536 raw bytes                  |
| `finalize`            | `{nonce}`                                                                                                |
| `cancel`              | `{nonce}`                                                                                                |
| `status`              | `{}` or `{nonce}`                                                                                        |
| `acknowledge-unknown` | `{nonce}`; the UI additionally requires a checked version-history review and native trusted button click |

`begin` requires matching fixed destination IDs, canonical UUID `diagramId`, positive integer `baseVersion`, 64 lowercase hex SHA-256 characters and 1..10 MiB UTF-8 XML bytes. The receipt binds the originating peer's workspace, origin, browser instance and grant. Chunks start at index/offset zero, follow exact byte order, and cannot exceed the declared size; at most 160 chunks are needed. The final digest and valid Roblox XML are checked before any HTTP request.

Preparation expires after 60 seconds; independent terminal approval and the final HTTP request each have their own 60-second deadline. Their maximum phase budgets total 180 seconds. The declared byte total is reserved at begin against a 32 MiB aggregate receiving/approval/publishing budget. Revoked network uploads retain that reservation until HTTP cleanup actually releases the payload. Only one operation can be pending for a peer; at most 64 owner records are retained. Definitive terminal receipts expire after 15 minutes. Unknown receipts remain blocking until explicit Dashboard reconciliation or bridge termination; reaching the registry bound fails closed. The nonce is consumed before terminal approval and any HTTP dispatch. `finalize` is never replayed or retried as a new request.

If cancellation interrupts the `begin` response before the browser learns its nonce, the browser recovers owner `status` through the original session. It matches the build digest, byte count and destination before cancelling that preparation. It keeps the upload busy until recovery finishes, refuses an unrelated previous receipt and never uses recovery to repeat `finalize` or acknowledge an unknown result. Revocation prevents that session from recovering or exposing a late receipt.

Revocation, control mode, disconnect and bridge close immediately clear preparation/approval buffers. In-flight HTTP is cancelled and its payload is released through bounded network cleanup; it cannot be guaranteed to disappear from RAM instantly, and already-sent bytes cannot be recalled. During terminal approval this is a definite cancellation with no HTTP request. A request already dispatched may have committed remotely: keep only its minimal `unknown` receipt in ephemeral owner-scoped memory and send no late result to the revoked grant. A fresh valid grant for the same live browser owner can inspect that safe receipt, but a new `begin` remains blocked until the human inspects Roblox Creator Dashboard version history and explicitly acknowledges the unknown outcome. No automatic retry or reconciliation claim is made across bridge/browser restarts.

## Official request and results

The destination is always `https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published`, with `Content-Type: application/xml` and the process-local `x-api-key`. Redirects and caller-selected hosts, URLs, cookies or passwords are unsupported. Roblox's official API source declares a 10 MiB upload limit, separate from the builder's larger local artifact budget.

Only a valid successful `versionNumber` becomes a success receipt. Error bodies and headers are never forwarded. Authentication/permission/input rejections return sanitized failure codes; transport failures, malformed success responses and server-side failures may be `unknown` and require manual Dashboard reconciliation.

Sources: [official publishing guide](https://create.roblox.com/docs/cloud/guides/usage-place-publishing), [official API contract](https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/universes-api/v1.json). Real account publication still requires an explicitly supplied key/target and a separate human-confirmed action; mocked HTTP tests do not establish that a particular Roblox account can publish.
