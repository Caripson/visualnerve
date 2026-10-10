# Encrypted real-time collaboration

Status: implemented with automated local security and product verification.
Collaboration remains disabled by default. Release requires successful CI for the
reviewed revision and separate manual relay/app activation. This document does not
claim that the integration is released, independently audited, or certified.

## Goal

Allow people to share one diagram and edit it together, with visible participants,
while keeping the ordinary encrypted, offline workspace fully independent of any
server. UI, local API and MCP must use the same authoritative document model.

## Architecture

- A Cloudflare Worker admits connections to one Durable Object per room.
- The relay stores only bounded access-control metadata and invitation hashes.
  Document content, names, selections and pointer positions are encrypted client-side.
- OpenMLS implements RFC 9420 group encryption. Its audited core does not make
  our browser bindings or complete application audited; those need separate review.
- The owner pins approved device identities and signs the room's complete role policy.
  Receivers verify both authenticated MLS authorship and owner-approved permissions.
- Yjs reconciles concurrent edits per entity/field. Semantic validation still applies:
  converged data is not automatically a valid process or diagram.
- Shared changes project into the existing validated, encrypted local repository.
  Local versions, camera, persisted view/selection preferences, personal settings
  and MCP grants stay local. Authenticated live selections are shared as encrypted
  presence so participants can see who is working on each node.
- Private collaboration records use a separate encrypted namespace. Secrets never
  appear in Graph metadata, generic settings, REST responses or native diagram exports.

Local graph changes and their private CRDT/outbox records commit in the **same
encrypted vault transaction**. Only a successful durable commit advances the live
CRDT. Incoming validated changes use the existing ordered workspace queue. A failed
write therefore cannot publish a graph that was never saved, or leave a private
sync record ahead of the saved diagram.

An authenticated frame can already be in flight when an owner changes membership.
Clients discard earlier-epoch application frames without passing them into the new
MLS ratchet. Exactly one preceding **public** policy is retained to authenticate
adjacent in-flight frames; no old decryption keys or permission to apply those
frames are retained. Current members resynchronize their complete CRDT in the new
epoch, including saved local changes.

## Modules and schemas

| Boundary                                                                       | Modules                                                                                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Relay, public admission and bounded metadata                                   | `collaboration-worker/src/`                                                                                                        |
| Standard MLS adapter, canonical Linux WASM rebuild and retained Cargo licenses | `collaboration-crypto/`, `frontend/src/collaboration/crypto*`, `generated/`                                                        |
| Owner policies, authenticated transport and ephemeral group session            | `frontend/src/collaboration/transport/`, `session/encrypted-room.ts`                                                               |
| Scoped field/entity CRDT and concurrent merge validation                       | `frontend/src/collaboration/document/`                                                                                             |
| Atomic encrypted sync persistence and graph projection                         | `frontend/src/collaboration/persistence/`, `session/document-gateway.ts`, `security/collaboration-journal.ts`, existing `storage/` |
| Room lifecycle, permissions, lazy UI and authenticated presence                | `frontend/src/collaboration/controller.ts`, `access.ts`, `ui/`, `CollaborationFeature.tsx`                                         |
| Existing API/MCP discovery and complete OpenAPI contract                       | `frontend/src/collaboration/api.ts`, `backend/internal/server/collaboration*`, `backend/cmd/openapi/collaboration.go`              |
| Optional exact relay origin and matching CSP                                   | `scripts/build-app-surface.mjs`, `deployment/app-policy.mjs`, `docs/COLLABORATION_DEPLOYMENT.md`                                   |

Ordinary diagram schemas remain unchanged. A collaboration room references one
existing diagram; it does not turn every saved document into a shared document.

- **Relay protocol 1:** owner-signed room policy with `roomId`, owner device,
  revision, MLS epoch, approved public device identities/roles and exact transition
  hashes. `collaboration-worker/src/protocol.ts` defines the wire contract.
- **Private local format 1:** `visualnerve-private-collaboration` contains the room
  association, disclosure scope, public owner pin, bounded CRDT state and opaque
  pending ciphertext. It has no private MLS identity or ratchet. Its physical
  encrypted namespace is excluded from the logical workspace/backup schema.
- **Semantic API 0.7.0:** `collaboration-v1` exposes capabilities with
  `schemaVersion: 1`, current local session, approved participant semantics and
  disconnect. Existing graph commands carry edits under both the membership role
  and the local API/MCP grant. Invitations and admission remain human controls.

The ordinary editor entry does not fetch collaboration WASM. Offline caching loads
it lazily after collaboration is explicitly used. Local editing and existing
document types continue without the relay or the collaboration worker.

## First implementation: live rooms

Private MLS ratchet state and device signing keys exist only in the unlocked live
session. Network reconnect can reuse that session; page reload or vault locking
requires a fresh device and approved rejoin. An owner who loses the live group state
starts a new room. Persisting/restoring old sender ratchets can reuse encryption
generations and is deliberately outside this implementation.

No durable cloud document history is enabled. Joining clients obtain an encrypted
snapshot from a live approved participant. When nobody with the current document
is online, there is no server-side document recovery. Local saved diagrams remain
available offline. Membership changes missed while disconnected require safe rejoin
when the live group cannot securely catch up.

## Security and user responsibilities

Sharing is explicit and scoped to the chosen diagram. Imported raw datasets,
owner profiles and source/custom metadata are excluded by default; any inclusion
must be explicit and described before sharing. An invitation is short-lived and
single-use and only requests admission; it is not a document decryption key.

Users select recipients, confirm device identity using a trusted channel, protect
their devices and manage their backups. The service must enforce cryptography,
authorization, validation, revocation and bounded processing. A self-chosen display
name is not proof of a person's corporate identity.

Removing a member revokes transport access and changes the group epoch. It cannot
recall previously viewed, downloaded, photographed or exported information.
Cloudflare can still observe IP addresses, connection times and traffic sizes.
Compromised client devices or delivered application code can read unlocked content.

## Acceptance gates

1. Two real browser clients edit the same diagram concurrently without lost fields.
2. Every participant sees authenticated presence, role and join/leave state.
3. No invitation/key, no content; an invitation alone cannot bypass owner approval.
4. Viewers cannot submit effective edits through UI, API, MCP or forged relay frames.
5. Revoked members cannot read future epochs or replay previously authorized writes.
6. Payload corruption, invalid topology, replay and oversized messages fail safely.
7. Disconnect/reconnect, duplicate delivery and relay hibernation do not lose edits.
8. Locking cancels queued work, drops private RAM and disconnects only that client.
9. Reload uses fresh crypto identity; no old ratchet is restored from a backup.
10. Private state is encrypted locally and absent from diagram exports and APIs.
11. Offline single-user editing, existing documents, 2D/3D and simulations still work.
12. Browser, engine, API and relay tests pass; an independent integration security
    review is a prerequisite for public relay/app activation. Green tests alone
    do not authorize that release or establish Enterprise assurance.

## Verification implemented

The tests exercise the actual OpenMLS adapter, Cloudflare workerd relay and
encrypted browser repositories.

| Verification                     | Coverage                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust adapter                     | 17 tests for authentic authorship, membership, rotation, tampering, replay and removal                                                                                                                                                            |
| Native relay                     | 36 tests with Web Crypto, Durable Object storage, real WebSockets, public policy validation, hibernation and retained rate budgets                                                                                                                |
| Deployment helper                | 6 synthetic tests; credentials are excluded from arguments/configuration and truncated output cannot expose a partial credential at a dropped chunk boundary                                                                                      |
| Real browser workers             | Standard MLS encryption and revocation under the deployed-style CSP; Chromium is checked locally and Chromium/Firefox/WebKit are required by CI                                                                                                   |
| Two encrypted browser workspaces | Concurrent field edits, UI/API parity, approval, Viewer restrictions, five immediate role-change cycles, atomic commit rollback, offline/rejoin reconciliation, removal and lock                                                                  |
| Explicit CSV disclosure          | The same live workflow with raw data opted in; ordinary autosaves preserve the dataset through editing and rejoin                                                                                                                                 |
| Product and accessibility        | Native Chrome checks desktop/mobile controls, title/action reachability around layout breakpoints, light/dark appearance, failed optional-module recovery, encrypted reload and lock; Help and simulation API regressions are also checked        |
| Manual release gates             | 57 tests for exact-revision CI, path-filtered checks, immutable input equality, missing/deleted workflow definitions and failed/pending histories                                                                                                 |
| Canonical release artifacts      | Pinned Linux release environment and Rust/WASM bindings, checked manifest hashes, exact source rebuild comparison in Linux CI and deterministic retained license inventories; native development builds on other hosts need not be byte-identical |
| Credential isolation             | The ignored local `.env` remains mode `0600`; source and built public files are checked without printing configured credentials                                                                                                                   |

The core CI workflow runs the complete existing unit, API, build and native
browser suite on the pushed revision. Dedicated relay and browser-cryptography
workflows are additional release gates. Passing these tests establishes tested
behavior; it does not substitute for an independent review of the browser
adapter, admission protocol or complete deployment.

## Cloudflare credentials and deployment

Copy `.env.example` to `.env` and fill credentials locally. `.env` is Git-ignored.
Do not put credentials in `VITE_*` variables, client bundles, screenshots or issues.
The Cloudflare API token is a deployment credential; room participants never receive it.
Use a token scoped to the selected account and required Worker/namespace operations.

Production deployment remains an explicit manual action. Creating this feature or
pushing a commit does not deploy a relay or automatically enable collaboration.

See [the manual relay/app release procedure](COLLABORATION_DEPLOYMENT.md),
[the relay configuration](../collaboration-worker/README.md),
[the cryptographic adapter and independent-review boundary](../collaboration-crypto/README.md),
and [the user guide](../hugo/content/help/collaboration.md).
