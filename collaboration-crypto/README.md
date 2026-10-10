# Browser collaboration cryptography

The application adapter uses **OpenMLS 0.9.1** for **MLS 1.0 / RFC 9420**. It does not implement a new group-encryption protocol. The pinned ciphersuite is `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`: X25519 key agreement, 256-bit ChaCha20-Poly1305 authenticated encryption, SHA-256, and Ed25519 authentication. The `128` in the standard suite name is its security strength, not the ChaCha20 key length. The existing local vault continues to use AES-256-GCM independently.

OpenMLS core underwent an SRLabs audit; that audit is **not** an independent audit of this application adapter, browser/WASM integration, RustCrypto dependencies, transport, access policy, or product. No certification or enterprise assurance is implied. An independent integration review is a production release prerequisite.

Version 0.9.1 includes the 2026-10-07 fix for [GHSA-gc79-23g3-8g52](https://github.com/openmls/openmls/security/advisories/GHSA-gc79-23g3-8g52). Versions 0.9.0 and below must not be substituted. [Upstream audit summary](https://blog.phnx.im/openmls-independent-security-audit/), [upstream security policy](https://github.com/openmls/openmls/security), [MLS standard](https://www.rfc-editor.org/rfc/rfc9420.html).

## Runtime boundary

`frontend/src/collaboration/crypto.ts` exposes `MlsSession`. Each live session creates a dedicated Web Worker containing the compiled Rust adapter and an isolated MLS identity/provider. The worker serializes every operation so concurrent encryption cannot reuse a sender generation. Locking, stopping collaboration, or clearing private data must dispose the session and terminate the worker.

There is deliberately **no export/import/restore API for MLS private state**. Ratchets and private identities stay in RAM; browser reload/unlock creates a new device and needs a fresh owner-approved membership. Persisting/restoring a stale sender ratchet could reuse encryption keys/nonces. Durable MLS sessions require a separately reviewed crash-safe ratchet/outbox protocol. Persisting the local diagram/CRDT is separate and remains encrypted in the existing vault.

Deleting a member advances the MLS epoch and prevents reading future messages. Neither removal nor key rotation can recall plaintext, exported files, screenshots, or backups already received by that member. JavaScript compromise in an unlocked browser remains outside this protection.

## Public contract

- `MlsSession.create({ deviceId, credentialId })` creates a fresh client. `credentialId` is the transport P-256 public JWK SHA-256 thumbprint in lowercase hex.
- `signaturePublicKey()` and `keyPackage()` return public, unpadded base64url values. KeyPackages bind the opaque device ID and transport key fingerprint to the MLS Ed25519 identity.
- `createGroup(roomId)` creates an owner group at epoch 0.
- `prepareAddMember({ deviceId, credentialId, keyPackage, expectedSignatureKey })`, `prepareRemoveMember(deviceId)`, and `prepareRotate()` produce pending opaque commits. Add pins the approved device's actual Ed25519 public key before producing a commit and also returns an encrypted recipient Welcome with the ratchet-tree extension.
- The owner merges with `confirmPendingCommit()` **after** the relay acknowledges the matching signed transition. A definite rejection may discard the pending commit. A timeout is an unknown outcome and requires reconciliation against the signed policy/transition hash before deciding.
- `join({ welcome, roomId, ownerDeviceId, ownerSignatureKey })` validates the Welcome, expected room, and pinned owner key.
- `encrypt(payload)` uses MLS private application messages. The relay never receives plaintext or group keys.
- `process({ ciphertext, expectedDeviceId })` returns the cryptographically authenticated author, author signing key, epoch and payload. It rejects sender mismatch, malformed/tampered/replayed messages, external senders, non-owner membership commits and unsupported proposal types.
- `info()` returns actual semantic MLS membership and epoch. `assertMlsPolicy(info, verifiedOwnerPolicy)` must pass after every join/commit. Before applying application data, the controller must compare the authenticated author/key with the signed room policy and enforce editor/viewer permissions and the authenticated message kind.

Outer transport signatures and server ACLs do not replace these client checks. A viewer has a group decryption key, so the receiver must reject that viewer's document mutations even if a malicious relay forwards them.

Wire limits: 32 members; 32 KiB public KeyPackage; 64 KiB application payload; 128 KiB MLS wire message. Larger diagram snapshots use chunks at the document transport layer, not one unbounded encrypted message. Any uncertain worker timeout terminates the crypto session rather than continuing with unknown mutable state.

## Rebuild

The generated browser JS/WASM and manifest are checked in so ordinary frontend builds do not require Rust. All sources, exact direct versions, `Cargo.lock`, Rust 1.91.0 and wasm-bindgen-cli 0.2.129 are retained for rebuilding. The script remaps build paths and writes SHA-256 hashes.

**The canonical release builder is Linux x86_64**, with Ubuntu 24.04 used by the source CI job. That job rebuilds from the locked source and requires the generated JS, WASM and manifest to match the checked-in files byte-for-byte; the check must not be removed or relaxed. Release builds reject inherited Rust flags/compiler wrappers and require explicit `CARGO_HOME` for registry-path remapping. The manifest identifies this canonical builder without recording machine paths, timestamps or credentials.

Independent macOS and Linux rebuilds with the same Rust/Cargo 1.91.0, wasm-bindgen 0.2.129, source, lockfile and normalized source paths produced functionally tested but different WASM bytes. Two independent clean Linux CI builds produced identical output; copying the source into a separate macOS directory also reproduced the macOS output. The observed difference is in generated function/code/data layout, not merely an unstripped debug path. We do not claim a particular compiler defect or guarantee byte identity across build hosts. Use the canonical Linux builder for release artifacts.

```sh
rustup toolchain install 1.91.0 --profile minimal --target wasm32-unknown-unknown
cargo +1.91.0 install wasm-bindgen-cli --version 0.2.129 --locked
# Canonical release command, on Linux x86_64 with no inherited Rust flags:
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
./collaboration-crypto/build.sh
cargo +1.91.0 test --locked --manifest-path collaboration-crypto/Cargo.toml
```

On macOS, Windows/WSL with a different architecture, or other development hosts, choose an explicit output directory under this repository's ignored `tmp/`. Development builds cannot overwrite the canonical tracked assets:

```sh
./collaboration-crypto/build.sh --development "$PWD/tmp/collaboration-crypto-development"
```

`COLLABORATION_CARGO` (a rustup Cargo shim), `COLLABORATION_WASM_BINDGEN`, `CARGO_HOME`, and `CARGO_TARGET_DIR` support isolated tooling. The script does not read Cloudflare credentials or deploy anything. Runtime packaging must keep these assets lazy; single-user operation does not need to load the collaboration WASM.

## Tests

Native Rust tests cover authenticity, malformed input, key-package binding, room/owner pinning, pending-commit acknowledgement, replay rejection, tampering, non-owner forged commits, room isolation and revocation. TypeScript tests compare actual MLS membership with signed policy and validate the binary result boundary.

The browser harness exercises the **actual compiled WASM inside disposable browser workers**, including group delivery, rotation, removal, author forgery, replay, reload and lock cancellation:

```sh
node collaboration-crypto/browser-test.mjs
# Optional browser engine: chromium (default), firefox, or webkit.
COLLABORATION_BROWSER=firefox node collaboration-crypto/browser-test.mjs
# For a locally installed Chrome:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node collaboration-crypto/browser-test.mjs
```

Install frontend dependencies and the requested Playwright browser first. The harness runs a temporary localhost Vite server; it never opens the user's real browser profile or requires a cloud service.

The separate live integration harness starts local workerd and tests two isolated browser contexts with the actual controller, MLS workers, Yjs document gateway, encrypted IndexedDB repositories and UI approval controls:

```sh
npm --prefix collaboration-worker ci
node collaboration-crypto/live-browser-test.mjs
# Repeat with a CSV diagram and explicit raw-dataset disclosure.
COLLABORATION_TEST_SHARE_CSV=1 node collaboration-crypto/live-browser-test.mjs
```

It covers invitation/approval, visible full device fingerprints, excluded metadata, bidirectional UI/API edits, concurrent field convergence, atomic graph/CRDT/outbox vault commits and injected commit failure, same-session offline reconnection, and fresh device approval into the same encrypted vault. Returning editors reconcile unsent local work; returning viewers cannot publish it and retain a separate local recovery diagram instead. Five back-to-back viewer/editor policy cycles exercise membership changes without waiting for the peer between owner operations. Role rotations and removal preserve an authorized client's access while denying viewer writes and removed devices' future messages. The CSV variant verifies explicitly disclosed rows survive actual UI autosaves, API writes and rejoin/removal. Lock revokes the live keys and presence. Mobile, tablet and desktop controls are checked in light/dark appearance for WCAG violations and horizontal overflow.

The harness uses loopback ports 5177 and 4358 and grants local-network permission only to that test origin. It never reads `.env`, uses Cloudflare credentials, opens the real browser profile, or deploys. The responsive component harness uses an explicitly test-only controller; live screenshots from the integration harness use the real model. Whole-product MCP automation and further hostile-relay review remain additional acceptance requirements.

OpenMLS is MIT licensed; its notice is retained in `OPENMLS-LICENSE.txt`. The Visual Nerve application adapter is MPL-2.0.
