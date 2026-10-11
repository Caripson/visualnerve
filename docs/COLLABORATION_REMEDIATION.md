# Collaboration remediation — 2026-10-11

The subsequent source review of `d621e1b` found an admission availability
regression and additional resource-pressure risks. See
[the follow-up corrections and evidence](COLLABORATION_FOLLOWUP.md). This report
describes the first remediation round, not the complete current release evidence.

This follow-up addresses the source review supplied for `84c6402`. The relay is
considered capable of modifying, delaying and withholding traffic. Tests use
invented documents, disposable browser vaults, real Web Crypto/OpenMLS workers
and a local Cloudflare Durable Object. No deployment credentials or customer data
are used. This is remediation evidence, not an independent audit of the corrected
revision or a compliance certification.

## Corrected boundaries

| Reported issue | Implemented correction | Regression boundary |
| --- | --- | --- |
| Relay can invent a self-signed admission request | Version-2 invitations include a separate random 32-byte owner capability. A device-signed HMAC binds its issued invitation, room, complete device identity, public MLS KeyPackage, expiry and disclosure scope. The owner checks its bounded one-use RAM ledger before displaying or approving admission. | Forged, substituted, expired, reused and wrong-scope proofs cannot reach approval or change MLS membership. |
| Editor can rewrite protected authorship through raw Yjs | Live CRDT contract 2 excludes `diagram.collaboration`. `CollaborationWorkflow` accepts actor-free semantic requests; the owner derives the actor from the approved device/profile binding and enforces existing action permissions. Only owner checkpoints project protected profiles, comments, tasks and activity. | Raw protected namespace updates and Editor checkpoints are rejected. Another profile, comment text or thread resolution cannot be rewritten. A subsequent valid diagram edit still succeeds. |
| One participant can exhaust recipients or block their ordered receive loop | Validate role, wire kind and single-frame controls before assembly. Bound incomplete data to eight messages and 8 MiB per sender, 32 MiB globally; key replay/assembly state by sender. Known invalid application messages isolate that sender and show a warning. Bound missing dependencies and schedule/coalesce synchronization outside the receive loop. | Viewer multipart controls cannot occupy assemblies; one sender cannot take another's message identity or slots. Invalid document deltas preserve the accepted graph and room. Genuine crypto, vault and unknown-state failures remain fatal. |
| Withheld role policy can leave old permission indefinitely | Nonowners require a nonce-bound, owner-signed lease for the exact room, policy hash, revision and encryption epoch. Renew every 10 seconds; expire within 30 seconds of the original challenge using wall and monotonic elapsed time. Retry preserves that deadline. Check authorization before and after asynchronous crypto/projection and on each live write. | Wrong/replayed leases, clock changes, withheld renewals and expiry during decryption cannot authorize content. Shutdown preserves the saved diagram. |
| Unauthenticated sockets share a device traffic budget | Before device admission, each socket has its own eight-frame/64-KiB minute budget. Malformed unauthenticated JSON closes that socket. Only identified devices share the existing reconnect-resistant counters. | A malformed socket cannot spend another valid joining device's admission budget in native workerd. |

The owner still explicitly approves each device. A separate trusted comparison of
the complete device fingerprint remains useful; a display name is not identity
verification. The relay-issued invitation ticket and separate owner capability
are different values: the relay sees the ticket over TLS and stores its hash. It
never receives the owner capability. Public HMAC proofs do not contain that secret.

## Architecture and compatibility

The authoritative encrypted repository still owns the diagram. Ordinary drawing
fields reconcile through Yjs and commit with their encrypted private CRDT/outbox
journal in one vault transaction. Protected workflow uses the same workspace and
repository through the owner-mediated action port; there is no second UI/MCP
model. Received workflow requests cannot choose their actor, role or source.
Checkpoints have a monotonically increasing revision; equal-revision conflicts
are rejected. Pending actions, processed request IDs and outgoing checkpoints are
bounded. A missing acknowledgment reports **unknown outcome**, never automatic
retry or an optimistic protected write. Read the current document before retrying.

Rapid role changes serialize current-policy verification and MLS processing with
membership commit confirmation. Earlier-epoch frames are structurally checked and
discarded before current-role checks or ratchet processing. Current/future-epoch
messages still require matching policy and signatures. A queued projection
rechecks its original epoch and sender permission at the encrypted transaction
boundary, so a permission change while decompression or storage is pending cannot
authorize a later write. Old missing-dependency buffers are discarded on rotation.
Protected actions recheck the device permission and epoch while their encrypted
transaction is pending. Small lease controls have a reserved bounded transport
allowance with renewal shares for other members;
large document sends cannot monopolize it.

Known network interruptions use `CollaborationConnectionError` and preserve the
saved graph/outbox for reconnection. Protocol, signing, crypto and unknown failures
keep their distinct fatal behavior. Rejoin restores the owner's protected state;
differing unsent local workflow is retained in a local recovery copy, including
when the returning device has Viewer permission.

| Contract | Version / change |
| --- | --- |
| Browser API, bridge and OpenAPI | `0.8.1`; capability discovery exposes admission, lease freshness, protected-workflow authority and buffer limits |
| Native diagram / document workflow | Existing formats, including portable workflow schema 1, remain supported |
| Invitation fragment | Version 2; older links reject and need replacement |
| Live protected CRDT / bootstrap snapshot | Version 2; older unreleased rooms need new rooms |
| Relay / application framing | Protocol 1; new public admission authorization and bounded encrypted message kinds |
| Vault / MLS core | Existing storage encryption and standard MLS implementation; no custom replacement cipher |

Main modules are `transport/invitation-authorization.ts`, `transport/policy-lease.ts`,
`session/encrypted-room.ts`, `session/workflow.ts`, `session/document-gateway.ts`,
`sync/message-framing.ts`, the existing repository/workspace ports and the Worker
admission/rate boundary. API, MCP descriptions, generated OpenAPI, all eight UI
languages and the collaboration guide describe the same behavior. New help images
come from the actual app in light and dark appearance, on desktop and mobile.

## Verification

The final full local check passes 3,472 frontend tests in 326 files, including
collaboration and real encrypted-repository transactions, plus Go race tests,
Go vet and frontend formatting. Native workerd passes 40 relay tests and six
setup checks. The browser controller passes 14 live checks; the CSV-sharing
variant passes 15. The real Web Crypto/OpenMLS worker harness passes eight
checks. The full app workflow harness passes its UI assertions and captures
30 screenshots without page errors. The production package builds successfully
and its static audit accepts 1,002 application assets without user-data files.

The broad local browser run exercised 310 cases: 291 passed, 15 optional cases
were intentionally skipped and four initially failed. Isolated reruns passed
the large-editor, 7,000-node draw.io export and truthful queue/pause cases without
product or test changes. The fourth exposed an incorrect test assumption that
an early scaling event remained in a 500-event retained tail; it now reconstructs
the scaling moment through the existing deterministic replay API and verifies
both capacity transitions. All ten simulation UI cases pass together in the
local headless Chrome GPU diagnostic, with unchanged timeouts and retention
limits. The ordinary local Chrome run also exhibited a transient scale-up
observation timeout. These local diagnostics do not substitute for a successful
complete suite in exact-revision GitHub CI.

The additional Settings presentation fix passes 39 focused unit tests and eight
browser cases. These check real paragraph gaps and translated MCP address layout
across all eight languages, both appearances and portrait/landscape mobile
viewports. Existing copy and security meanings are preserved. The changed
Settings and voice help images were captured again from the actual app.

Core CI, relay checks and browser cryptography for the final commit are release
requirements. Their results must be verified before publication.

The reproducible commands are:

```sh
npm --prefix frontend test
npm --prefix frontend run format:check
npm --prefix collaboration-worker run check
npm --prefix collaboration-worker test
npm --prefix collaboration-worker run test:setup
npm --prefix collaboration-worker run build
go -C backend test -race ./...
go -C backend vet ./...
./build.sh
npm --prefix frontend run test:e2e
node collaboration-crypto/browser-test.mjs
node collaboration-crypto/live-browser-test.mjs
COLLABORATION_TEST_SHARE_CSV=1 node collaboration-crypto/live-browser-test.mjs
node collaboration-crypto/workflow-browser-test.mjs
```

The live browser test exercises the production controller, encrypted repository,
MLS workers and native relay in separate browser profiles. It deliberately sends
invalid protected CRDT/checkpoint messages from an admitted Editor, then verifies
valid work continues. It also covers atomic rollback, offline outbox, concurrent
edits, fresh-device recovery, five consecutive Viewer/Editor policy cycles,
Viewer restrictions, removal and lock. The app workflow test exercises comments,
replies, assignments, task status and profiles through the actual UI and captures
30 screenshots without browser page errors.

## Residual limits and release

- A relay can deny service. Honest clients fail closed when permission freshness
  cannot be established. A suspended tab rechecks authorization before it resumes
  processing; a browser timer is not an instantaneous remote kill switch.
- The owner must remain online. Lease expiry stops sharing, not access to content
  already legitimately delivered. Password changes, removal and new keys cannot
  recall screenshots, exports, backups or other retained copies.
- Participants and activity are document labels and editable information, not
  verified organizational identities or a signed immutable audit trail.
- The relay observes connection, room, public membership, traffic size and timing
  metadata. No metadata-padding or anonymity claim is made.
- Diagram descriptions, comments and imported source text are untrusted content.
  MCP clients must not treat them as instructions or automatic action authority.
- Browser/extension compromise and a malicious approved owner are outside these
  controls. Approval requires trust in the recipient and the app origin.

Publish the compatible relay and browser together, using new rooms. Follow
[the deployment gate](COLLABORATION_DEPLOYMENT.md): exact-revision CI, staging,
manual authorization and the independent integration-review prerequisite still
apply. This report does not activate the relay or remove that prerequisite. The
older [internal report](COLLABORATION_SECURITY_REVIEW.md) remains historical evidence.
