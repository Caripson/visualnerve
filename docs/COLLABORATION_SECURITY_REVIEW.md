# Internal collaboration security review — 2026-10-11

This is an internal engineering review of Visual Nerve's optional collaboration
integration. It uses separate review agents, source inspection and local synthetic
tests. The reviewers and implementers belong to the same development workflow:
this is **not an independent external audit, penetration-test certification or
enterprise compliance assessment**. No production activation, Cloudflare credential
access or real customer data was used.

The reviewed baseline was `22c49fcadb607674e1aa61d3d03c8043f4b21618`.
The corrections described below belong to the commit containing this report.
The existing external-review release prerequisite has not been removed by this
report. Any different beta release policy requires an explicit owner decision.

**Historical scope:** the verification below describes the earlier internal review. The subsequent source review of `84c6402` found additional admission, workflow, availability and policy-freshness defects. Its remediation is recorded in [the follow-up](COLLABORATION_REMEDIATION.md); the older peer-failure behavior below is superseded there.

## Scope and threat assumptions

The review follows the relay admission boundary, browser transport signatures,
MLS membership and authenticated message authorship, viewer/editor permissions,
disclosure filtering, CRDT projection and atomic encrypted persistence. It checks
the ordinary UI/API/MCP permission intersection and lock/reload behavior.

Participants can control their own clients. The relay must not be trusted to
invent participant keys or approve document changes. A compromised unlocked
browser, malicious delivered app code or an approved recipient's retained copies
cannot be protected by end-to-end message encryption. The relay can withhold
traffic, and the hosting network observes connection metadata.

OpenMLS implements the cryptographic protocol; its upstream audit does not audit
our application. This review does not analyze cipher security, certify dependency
implementations, test Cloudflare's infrastructure or establish deployed response
headers. The relay and app remain separate manual releases.

## Corrections

| Boundary | Finding | Correction and regression coverage |
| --- | --- | --- |
| Device admission | The owner received the candidate transport identity, MLS signing key and KeyPackage from the relay without a separate participant-verifiable binding between them. | A domain-separated participant signature binds the protocol, room, complete device identity, KeyPackage and expiry. Both relay and owner validate it; the owner repeats verification before preparing MLS admission. Missing, changed, expired and wrong-room proofs fail closed. The proof contains no invitation secret. |
| Disclosure | Simulation entity/scenario metadata and integration external IDs did not consistently follow the metadata checkbox. | Default-off filtering now covers these fields in shared projections and CRDT state. Explicit opt-in remains supported. Updates and editor/viewer rejoin preserve each recipient's excluded local values without publishing them. |
| CRDT validation | Unresolved Yjs actor structs/delete sets could survive outside visible maps and be encoded again without complete semantic/scope validation. Hidden unknown top-level fields could also remain outside the graph projection. | Reject unresolved state before import, staging or persistence; whitelist shared top-level roots, including retained paths under deleted ancestors. Failed changes preserve accepted graph/state. Legitimate declared missing dependencies still use synchronization. |
| Relay message types | String coercion admitted array-shaped wire kinds that disagreed with role checks. | Relay and browser share one strict literal-string validator. Native workerd tests reject malformed kinds without forwarding them and confirm subsequent valid messages still work. The earlier client checks prevented a demonstrated unauthorized graph mutation. |
| Peer rejection | Rejection of authenticated inner framing/role data could close every recipient's transport. | Narrow typed rejection drops a known-invalid application frame after authenticated MLS authorship/epoch checks. Pure presence and sync-vector validation use the same rejection path. Later valid messages remain deliverable. Assembly expiry/resource pressure, unknown crypto, membership/control, lifecycle and persistence failures remain fatal. |

The final separate internal source review identified overly broad rejection
handling: assembly expiry/resource pressure can affect valid updates. These errors
now retain the existing visible fail-closed path instead of being silently dropped
while a recipient appears live. Regression tests cover expiry, resource limits,
lifecycle cancellation and unknown assembly errors. This is a convergence finding,
not evidence of unauthorized writes or data disclosure.

No production disclosure or successful unauthorized production write was
established. Findings and tests used locally generated identities and invented
content. In particular, opaque sender-supplied CRDT data is not evidence that a
recipient's private local data was extracted.

## Verification

Local verification completed during this review:

| Check | Result |
| --- | --- |
| Complete frontend regression suite | 3,329 tests in 316 files passed; full formatting check passed |
| Backend | All Go packages passed race-enabled tests and `go vet`; regenerated OpenAPI tests passed |
| Relay | Type check and 39 native workerd tests passed |
| Deployment helper | 6 synthetic credential/configuration tests passed |
| Final session/transport regression | 50 tests passed, including the final expiry/resource-pressure correction |
| Actual compiled OpenMLS | Chrome worker cryptography harness passed |
| Real encrypted browser workspaces | Both graph and explicitly shared CSV variants passed with local workerd |
| Whole-product browser smoke tests | 6 passed: desktop, mobile light/dark, offline editing, lock/reload and optional-feature recovery |
| Complete production build | TypeScript, Vite, Hugo, offline/static bundle audits and Go binary build passed |

The four Help screenshots were refreshed from the actual browser sessions in
light/dark appearance. The unreviewed-integration notice is visible before room
creation/admission and translated into the eight supported app languages. This
report records local evidence; GitHub Actions remains the source for CI outcomes
on the pushed revision.

Relevant commands are retained here so the checks can be repeated without cloud
credentials:

```sh
npm --prefix collaboration-worker run check
npm --prefix collaboration-worker test
npm --prefix collaboration-worker run test:setup
./scripts/test.sh
./build.sh
cd frontend
npm test -- tests/collaboration
npx tsc -b
npm run test:e2e -- collaboration-product.spec.ts
cd ..
node collaboration-crypto/browser-test.mjs
node collaboration-crypto/live-browser-test.mjs
COLLABORATION_TEST_SHARE_CSV=1 node collaboration-crypto/live-browser-test.mjs
```

The browser harnesses use actual checked-in OpenMLS WASM, local workerd, separate
browser contexts and encrypted IndexedDB. They do not read `.env` or access a
production room. The Rust source is unchanged; local native source tests were not
rerun because the installed Rust toolchain is 1.90 while the pinned crate requires
1.91. The existing canonical Linux CI job remains responsible for locked native
tests and reproducible WASM rebuilding.

## Remaining limitations and release interpretation

- These targeted tests and internal reviews cannot establish absence of flaws.
  They do not replace an independent assessment for high-assurance use.
- Upgraded app and relay must be released together for admission proofs. New
  joins without a valid proof are rejected. Previously generated shared states
  containing newly excluded fields fail closed: retain the local graph and start
  a new room rather than grandfathering undisclosed data.
- Native graph extension properties remain shared drawing content, as supported
  by the existing graph model. Hiding metadata does not anonymize titles,
  descriptions, routing attributes or arbitrary extension content.
- Causal history can retain peer-authored opaque fields beneath deleted semantic
  ancestors. Named private metadata/ID paths and unknown top-level roots are
  rejected, but exhaustive hidden semantic-path validation is not established.
  No victim-secret extraction was demonstrated by that residual behavior.
- A malicious approved participant or relay can still disrupt availability.
  The session stops when cryptographic state, model consistency or persistence
  cannot be safely established. Revocation cannot recall earlier copies.
- Self-hosting controls deployment, relay administration and metadata handling;
  it does not remove client/protocol bugs or protect a compromised endpoint.
- Charging no fee and requiring opt-in are product choices, not technical
  mitigations. An optional beta must describe its actual limits and avoid claims
  of independent auditing, certification or managed enterprise identity.

See [deployment gates](COLLABORATION_DEPLOYMENT.md),
[architecture and threat boundaries](REALTIME_COLLABORATION_PLAN.md),
[browser cryptography](../collaboration-crypto/README.md), and the
[user guide](../hugo/content/help/collaboration.md).

## Pre-release flow walkthrough follow-up — 2026-10-11

The core CI and relay checks passed for `86e4b45`. The browser-cryptography
workflow passed its Chromium, Firefox and WebKit jobs, but the canonical native
build job failed while checking the Rust host after its 17 native tests passed.
Under `pipefail`, `grep -q` could close the version-output pipe early and cause a
false compiler-host rejection. The host and version checks now drain their
input without weakening the pinned-toolchain guards. Six synthetic regression
tests cover trailing output and rejection of unsupported hosts, versions,
compiler failures, flags and wrappers. The canonical Linux rebuild still needs
to pass on the follow-up revision; local guard tests do not establish a
reproducible WASM rebuild.

The walkthrough also found that failed sessions offered reconnect/owner-close
actions that correctly rejected the uncertain cryptographic state, leaving
local cleanup inaccessible in the panel. Errors and conflicts now offer
**End local session** to both owners and participants, including failed startup
before a room ID exists. The confirmation accurately says that this is local
cleanup, preserves the saved diagram, and does not close other participants'
relay room. Ordinary offline reconnect is unchanged. Failed state clears stale
sync progress and marks participants disconnected; it never resumes the failed
cryptographic session.

Verification of the follow-up included 273 passing collaboration tests in 22
files, the six build-guard tests, full frontend formatting and TypeScript checks.
The whole App was also exercised with two disposable encrypted browser
workspaces and local workerd: room creation, one-use invitation, recipient
unlock/onboarding, fingerprint-bound owner approval, explicit Editor permission,
live UI edit propagation, desktop/mobile panels in light/dark appearance, and
confirmed room closure. Fifteen screenshots were captured for review. This
walkthrough used no cloud credentials and activated no production room or relay.
