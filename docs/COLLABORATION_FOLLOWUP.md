# Collaboration follow-up — 2026-10-11

This responds to the external source review of `d621e1b` supplied by the
repository owner. The reviewer confirmed the admission, protected authorship
and bounded permission-freshness fixes, but found an admission availability
regression and three remaining resource-pressure risks. The reviewer did not
run tests. This records implementation and regression evidence, not a compliance
certification or an independent audit of the corrected revision.

## Findings and corrections

| Finding | Correction | Regression boundary |
| --- | --- | --- |
| N1: invalid admission closes the owner's session | Typed admission rejection for malformed, forged, expired and revoked requests before membership/MLS changes. The ordered socket reader discards only this known rejection for a `join-request`. Other protocol, cryptographic and local-state failures retain fatal handling. | Real socket-reader tests verify no approval or `onError`, unchanged membership, a subsequent valid request and continued commands. Expiry during signature verification is covered. The native browser/relay test substitutes the owner capability while retaining a valid relay ticket; the real owner rejects its signed request, remains live, and approves a fresh invitation. |
| N2: global buffer pressure blames the arriving sender | Aggregate saturation is backpressure without retiring that sender or showing a participant warning. Per-peer abuse limits remain. Valid single-frame controls have a bounded independent verification allowance. | Fill the global buffer from four senders, reject additional data as receiver pressure, accept lease controls, preserve later traffic. Recovery coalesces after the 60-second assembly expiry; epoch change/disposal cancels it. Global missing-dependency saturation requests recovery without blaming the next sender. |
| N3: repeated full snapshots monopolize traffic | `CollaborationSyncResponseQueue` keeps one vector per current approved peer and schedules peers fairly. Global cooldown depends on actual compressed size at a target of 1 MiB/minute, with at least ten seconds between responses. Deferred requests do not construct/compress snapshots. | A 1-MiB response followed by six requests per minute cannot produce six full snapshots. Deferred recovery is serviced later. A supported 3-MiB response reserves three minutes before the next recovery response. Admission bootstrap remains separate; edits and reserved leases retain existing paths. |
| N4: idle unauthenticated sockets fill the room | At most eight unproved challenge slots; replace the oldest idle challenge when a new one needs a slot. Established participants and valid-ticket pending approvals are protected. The hard 64-socket limit remains. | Native workerd tests preserve owner/pending approval, allow signed reconnect under saturation, and exercise 72 successive unknown connections. |

Invitation expiry remains strict: an expiry race or clock difference rejects
that request harmlessly rather than extending an expired signed capability.
Check device clocks and issue a fresh invitation if necessary.

Recovery runs outside the ordered receiver. Nonowners request the canonical
owner's state; owners request one current editing peer at a time rather than
sending requests to themselves. Deferred recovery rechecks epoch and permission.
An incomplete or invalid document is never committed to bypass pressure.

## Compatibility and remaining limits

Browser API remains `0.8.1`, invitation/live CRDT remain version 2, and relay/framing
remain version 1. There are no new admission API endpoints or credentials. UI,
API and MCP retain one authoritative encrypted workspace. Relay `/health` exposes
the additive `preAuthenticationSockets: 8` bound.

Recovery uses cost-weighted scheduling; it does not promise at most 1 MiB of wire
data in every rolling minute. One necessary large refresh can use part of an
ordinary transport window, but repeated requests cannot consume successive
windows. Existing payload/relay limits remain. Controls permit eight concurrent
single-frame verifications, at most 256 KiB in total, independently of the 32-MiB
multipart buffer. Viewer multipart controls remain rejected.

Continuous admission floods can still race legitimate arrivals or exhaust
upstream resources. Cloudflare may retain closing sockets while a peer withholds
the close handshake; these still count toward the hard 64-socket bound. We keep
that bound rather than permitting unlimited replacements. See
[Cloudflare's WebSocket lifecycle](https://developers.cloudflare.com/durable-objects/api/state/#getwebsockets).

Names/activity remain self-asserted information; MCP returns untrusted user
content, not instruction authority. Leaving ends a local session; owner removal
changes membership. Revocation cannot recall previous copies. Relay metadata
and denial of service remain explicit limits.

## Verification and release

Parent `d621e1b` passed [core CI](https://github.com/Caripson/visualnerve/actions/runs/38152480789),
[relay checks](https://github.com/Caripson/visualnerve/actions/runs/38152480780) and
[browser cryptography](https://github.com/Caripson/visualnerve/actions/runs/38152480778).
These verify the parent's reported counts, not this follow-up revision, which
requires its own relevant checks and successful release gate.

The native browser regression passes with real Web Crypto, MLS workers,
encrypted repositories and local workerd, alongside existing edit, rollback,
reconnect, role, removal and lock checks. The relay suite passes 43 tests,
TypeScript validation and six deployment setup checks, including a native
half-open-socket regression proving the remaining hard-cap availability limit.
The final focused client suite passes 110 checks, including admission/socket,
session, controller, framing, recovery scheduling, API and real repository tests.
The full local suite passes 3,491 frontend tests in 328 files, Go race tests,
Go vet and formatting. The production build passes its static audit. The real
MLS/Web Crypto browser harness passes eight checks, the controller/native relay
harness passes 15 integration checks, and the app workflow harness completes its
UI assertions with 30 screenshots and no page errors. Exact-revision GitHub CI
remains a separate release requirement.

```sh
npm --prefix frontend test -- tests/collaboration-admission-socket.test.ts tests/collaboration-session.test.ts tests/collaboration-message-framing.test.ts tests/collaboration-sync-response-queue.test.ts tests/collaboration-repository-parity.test.ts
npm --prefix collaboration-worker run check
npm --prefix collaboration-worker test
node collaboration-crypto/live-browser-test.mjs
```

Follow [the manual deployment gate](COLLABORATION_DEPLOYMENT.md). No production
deployment or public relay activation follows automatically. Review the corrected
revision before activation. The earlier [remediation report](COLLABORATION_REMEDIATION.md)
remains evidence for the first round; this follow-up supersedes its admission and
resource-pressure claims.
