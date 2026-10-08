# Encrypted workspace storage and session schema

Status: integrated implementation under release review for the [active encrypted workspace plan](ENCRYPTED_WORKSPACE_PLAN.md). The isolated app runtime uses the encrypted storage adapter for the editor, history, simulation, API and MCP. Cryptographic, storage and lifecycle tests and real Chrome encrypted-workspace checks cover this implementation. The manual release requires exact-revision CI and staging review; consult Actions for publication evidence. The existing `www.visualnerve.com/app/` address retains its plaintext backend and transfer entry. Source changes do not encrypt existing browser records.

## Module boundaries

- `frontend/src/security/vault-schema.ts`: versioned wire types and strict synchronous parsers. Parsers return frozen copies, reject unknown fields and unsupported versions, and bound binary sizes before decoding.
- `vault-crypto.ts`: browser-native Web Crypto, opaque in-memory key capabilities, wrapping, record encryption, protected tokens and backup methods.
- `vault-backup.ts`: bounded chunk encryption and complete ordered manifest verification. It neither reads nor writes IndexedDB.
- `vault-codec.ts`: canonical base64url and bounded JSON/UTF-8 encoding.
- `vault-errors.ts`: structured errors whose messages do not incorporate credentials or content.
- `vault-storage.ts`, `vault-journal.ts`: short native IndexedDB transactions, durable session/revision fences and atomic ciphertext batches.
- `vault-workspace-records.ts`, `vault-table.ts`, `vault-indexes.ts`: explicit typed units of work for all 14 logical stores, encrypted query projections and shared table/query semantics.
- `storage/contracts.ts`: logical schema 8 and transaction-scoped storage contract, independent of physical vault schema 1. The legacy Dexie adapter preserves existing callers during the transition.

All cryptographic operations are asynchronous. Fetch ciphertext in a short read transaction and decrypt afterward; prepare ciphertext before a short atomic write transaction. The storage/session modules check the persisted revocation epoch and whole-workspace revision at commit and before publishing results. `vault-coordination.ts` serializes official journal preparation and credential/policy changes with an abortable Web Lock named using only the technical database name. This prevents unrelated app writes from causing false conflicts and prevents mixed read snapshots without replaying domain callbacks. Browsers without Web Locks serialize same-realm callers; cross-realm conflicts are safely rejected by the native revision fence. A queued operation captures its original session before waiting, so it cannot inherit a later unlock. Revocation bypasses this preparation lock and aborts queued/in-flight work immediately. Cryptographic primitives alone do not supply that transaction or cross-tab policy.

## Keys and password derivation

Each vault has a random 256-bit content key generated with `crypto.getRandomValues`. The content key is imported as a nonextractable AES-GCM key. A private in-memory copy supports rewrapping; it is not exposed on the public `VaultKeys` capability.

Two independent nonextractable HMAC-SHA-256 keys are derived from that content key with native HKDF-SHA-256. The HKDF salt is UTF-8 of the ordered tuple `['visualnerve-vault-key', 1, vaultId, keyVersion]`. The respective `info` strings are `visualnerve-vault:index:v1` and `visualnerve-vault:authentication:v1`. They separate protected indexes from header authentication. HKDF here expands a uniformly random key; it is not the password KDF. This follows the extract-and-expand construction described by [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869).

Password wrapping uses native PBKDF2-HMAC-SHA-256 with a random 128-bit salt, producing a nonextractable AES-256-GCM wrapping key. Format 1 accepts 600,000–2,000,000 iterations and defaults to 600,000. The floor matches OWASP's current PBKDF2-HMAC-SHA-256 recommendation, verified on 2026-10-08; the upper bound prevents imported metadata from demanding unbounded CPU work. Argon2id is OWASP's preferred password-hashing choice, but this format deliberately uses browser-native PBKDF2 without an additional runtime dependency. This choice does not establish FIPS validation. Mobile/browser performance must be measured before release. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

Passwords require at least 12 Unicode code points and at most 1024 UTF-8 bytes. They are not trimmed or Unicode-normalized; unpaired surrogates are rejected. This length rule does not estimate password entropy or replace a user-facing strength/recovery explanation. Passwords and wrapping keys are not returned or stored by this module.

Recovery uses a separate random 256-bit AES wrapping key, presented as `VNREC1-` followed by canonical unpadded base64url of 32 bytes. A recovery secret is returned only when creating or replacing recovery material. Its output property is nonenumerable so routine JSON serialization of the result cannot accidentally persist it. Callers must still explicitly show it, ask the user to keep it safely and avoid logging or persisting it.

`VaultKeys` exposes only `vaultId` and `keyVersion`. Internal AES/HMAC keys are nonextractable. `destroyKeys()` revokes that capability, overwrites the module's retained raw-key buffer and drops internal references. Asynchronous operations check revocation after cryptographic waits before publishing results. This is best-effort reference cleanup, not guaranteed browser/OS memory erasure or protection against compromised code while unlocked.

## Format 1 header

```ts
interface VaultHeader {
  format: "visualnerve-vault";
  version: 1;
  vaultId: string; // canonical lowercase random UUIDv4
  keyVersion: number; // positive integer, at most 2,147,483,647
  password: {
    kind: "password";
    kdf: {
      name: "PBKDF2";
      hash: "SHA-256";
      version: 1;
      iterations: number;
      salt: string; // base64url, 16 bytes
    };
    iv: string;
    ciphertext: string;
  };
  recovery: { kind: "recovery"; iv: string; ciphertext: string };
  authentication: string; // base64url, 32-byte HMAC
}
```

Both envelopes contain the same 32-byte content key, encrypted with their independent wrapping keys. Every GCM operation generates a fresh cryptographically random 96-bit IV and uses a 128-bit authentication tag appended to its ciphertext. Envelopes therefore encode 48 ciphertext bytes. IVs and salts are public. Native randomness and an appropriate total key lifetime remain security requirements; the format does not claim deterministic collision-proof nonces across independent sessions. [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

Envelope AAD is UTF-8 JSON of the ordered tuple `['visualnerve-vault-key-envelope', 1, vaultId, keyVersion, kind, ...kdfFields]`. The password KDF fields are `name, hash, version, iterations, salt`; recovery has no KDF fields.

After unwrapping either envelope, the module verifies the complete header HMAC before returning usable keys. Its input is the ordered JSON tuple `['visualnerve-vault-header', version, vaultId, keyVersion, password.kind, kdf.name, kdf.hash, kdf.version, kdf.iterations, kdf.salt, password.iv, password.ciphertext, recovery.kind, recovery.iv, recovery.ciphertext]`. This prevents a valid password from silently accepting a substituted recovery envelope.

Password/recovery rewrapping preserves the content key and `keyVersion`. An old password stops unlocking the new header; it can still unlock a saved older header or backup. Rewrapping does not revoke a previously copied content key. A copied backup with its credential can expose the same content key still used by the current workspace. The human-only content-key rotation flow described below replaces that key, both envelopes and all protected tokens. None of these mechanisms recalls old backups or prevents restoration of an entire older, authentically encrypted database by an attacker controlling stored files.

## Incident content-key rotation

`vault-key-rotation.ts` captures the original session operation before any asynchronous work. The UI requires the current password and a different new password. Preparation authenticates the current header, creates a random replacement content key with `keyVersion + 1`, and prepares new password and recovery envelopes for the same vault ID. It releases the preparation coordinator while the person saves and acknowledges the new recovery key. The prepared result keeps the original session and exact control revision; cancellation, revocation or a conflicting change disposes it. Preparation does not change durable records.

Activation reacquires the coordinator and verifies that original revision. `vault-key-rotation-data.ts` scans all 14 physical record groups, authenticates roots, ordered chunks and protected partitions, rejects orphan or mismatched records and pending unverified migrations, and rebuilds every record under the new AES/HMAC keys. Full logical reads and bounded canonical digests compare the old and prepared new contents before publication. Original logical identifiers, versions, history, source rows and simulation archives remain unchanged.

`VaultRecordStorage.activateContentKey` performs the complete record replacement and header/control activation in one native IndexedDB transaction. The original lease, exact revision, abort signal and synchronous authorization fence are checked before mutation and at activation. Quota, corruption, cancellation or conflict aborts the transaction and preserves the old durable workspace. Success increments the durable revocation epoch and control revision, sets the workspace locked, broadcasts revocation and destroys matching old in-memory keys. The editor and background work have already stopped; cleanup must settle before another unlock.

Rotation currently bounds preparation to 100,000 physical records, 1 GiB of aggregate logical JSON with 64 million visited values, and 2 GiB of prepared ciphertext. Per-record/chunk limits still apply. These are rejection ceilings, not browser memory or quota guarantees. It holds prepared encrypted records in memory and temporarily needs storage headroom. No chunk, orphan record or private logical store is silently skipped to fit a limit. This incident option has no API/MCP password or key input; external clients may inspect safe security status and request an authorized lock only.

## Authenticated records and indexes

`EncryptedVaultRecord` contains exactly:

```ts
{
  format: 'visualnerve-record', version: 1,
  vaultId, keyVersion,
  store, recordId, recordVersion,
  iv, ciphertext
}
```

`store` is one of the 14 current logical stores: diagrams, nodes, edges, owners, settings, templates, datasets, historySnapshots, historyContents, historySources, historyRows, simulationModels, simulationRuns or simulationCheckpoints. `recordVersion` is a positive safe integer. `recordId` is bounded to 1024 UTF-8 bytes. The AAD tuple is `['visualnerve-record', 1, vaultId, keyVersion, store, recordId, recordVersion]`. Decryption requires the caller's expected store/ID/revision and checks them before authenticating ciphertext.

AAD fields remain readable. Storage adapters must use opaque protected IDs there, keep original logical IDs inside encrypted payloads and protect equality partitions. Passing a customer name or external identifier as `recordId` would expose it despite encryption. The storage/session layer, rather than AES alone, must enforce revision freshness.

`indexToken(keys, namespace, value)` returns a 32-byte HMAC as base64url. It signs UTF-8 JSON of `['visualnerve-vault-index', 1, vaultId, keyVersion, namespace]`, followed by a zero byte and the exact UTF-8/binary value. Namespace length is bounded to 256 UTF-8 bytes; values are bounded to 16 MiB. Tokens reveal equality within the same protected domain but do not expose unkeyed content digests. Existing history SHA-256 digests must be encrypted or passed through a protected token, not retained as readable identifiers.

Record plaintext is bounded to 16 MiB of JSON UTF-8, depth 64 and 2,000,000 visited values. Both encoding and decoding enforce these bounds and finite-number semantics, including numeric overflow such as JSON `1e400`. Decode checks byte length before UTF-8/JSON allocation and validates the parsed structure before returning it. Plain/null-prototype objects, ordinary dense arrays and finite JSON primitives are supported. Cycles, sparse arrays, accessors, undefined, functions, symbols, BigInt and nonfinite numbers are rejected rather than silently lost. Adapters may explicitly omit optional undefined object fields before calling encryption; they must not silently normalize undefined array cells. The decrypted value still needs its domain-specific model/reference validation.

## Chunked logical records

The logical codec is an integration foundation; adding these modules alone does not migrate or encrypt the application's existing database. `VaultLogicalRecordCodec` represents a logical store record as an encrypted root manifest plus zero or more immutable encrypted chunks, each using the physical-record envelope above. This keeps the physical 16 MiB / 2M-value ceiling from becoming an import limit: the codec is tested with 100,000 rows × 100 columns (10 million cells).

The private root wrapper authenticates the original logical ID and the exact sorted physical partition-token list. Its value is a `visualnerve-logical-record`, version 1 manifest containing the logical ID, `whole` or `fields` mode, encrypted metadata projection, total JSON bytes/value count, chunk size and ordered payload descriptors. Only roots have query partitions: one reserved HMAC token from the independent `logical-root:<store>` domain and up to 63 ordinary semantic tokens. Unbounded multivalue indexes such as owner IDs must use coarse store queries followed by unlocked payload filtering; they cannot add unbounded tokens or copy the whole multivalue field into the bounded projection.

Each payload descriptor identifies a field (or `null` for the whole value/object header), byte and value counts, and either inline base64 JSON bytes or an ordered chunk list. Each chunk reference includes its opaque ID, random 128-bit tag, ordinal, byte count, protected content hash and protected ciphertext hash. Chunks have no query partitions and physical revision 1. Their IDs use `logical-chunk:<store>` HMAC over `[logicalId, field, ordinal, tag]`; plaintext contains `visualnerve-logical-chunk`, version 1, and the same contextual fields plus base64 JSON bytes. `logical-content:<store>` authenticates exact plaintext bytes for reuse, and `logical-ciphertext:<store>` authenticates JSON `[iv, ciphertext]`. Both hashes stay inside the encrypted manifest. The manifest, ordered IDs, chunk contexts, physical metadata, ciphertext and decoded bytes must all agree before a complete logical value is returned. A metadata-only projection authenticates the root, and intentionally does not load or attest to the availability of its payload chunks.

Logical JSON is bounded to 1 GiB, 64 million visited values and depth 64; bounded UTF-8 serialization avoids creating a single full JSON string during encryption. Default/max chunks are 1 MiB, minimum 64 KiB, with at most 16,384 chunks across a record. Streams shorter than 64 KiB are inline. Metadata projections are limited to 256 KiB, 100,000 values and depth 32. At most 16 explicitly named large fields may be separated from the object header. These limits accommodate the current 10M-cell CSV and 256 MiB retained-history contracts; they do not guarantee that experimental 1 GiB imports or backups fit a browser's memory/quota. Decode still assembles JSON text and the final model in memory, and applies the same finite-number/depth/value checks before publication.

`encode(..., {projection, payloadFields, previous})` returns `{root, records, obsoleteIds, snapshot}`. `records` contains the root and newly encrypted chunks only. `previous` must be an opaque, codec-issued snapshot for the same vault/key version/store/logical ID and immediately preceding root revision. Matching content hashes reuse unchanged chunks, including unchanged large fields during metadata updates; mutable array identity alone is never sufficient. Equality still requires bounded serialization/HMAC work. Inputs must remain unchanged while encoding; callers must prepare from an immutable table/editor snapshot. Returned physical records and token arrays are frozen. The journal must commit all new records, root replacement and obsolete-chunk deletion atomically with expected revisions, control/session fencing and quota failure rollback. Deleting a logical record must likewise remove its root and every manifest-listed chunk in one transaction. Password rewrap can retain chunks; content-key rotation must re-encrypt them under the new key/version.

`project(keys, root, expectedLogicalId?)` returns `{logicalId, projection, chunkIds, snapshot}` without reading payloads. `read(keys, root, readPhysicalRecords, expectedLogicalId?)` adds the completely authenticated `value`; `decode(...)` returns only that value. Physical reads return records in the requested ID order, and missing/reordered records are rejected. No partial value/stream is exposed on corruption or key revocation. Temporary byte buffers are overwritten after use; JavaScript strings and parsed values remain subject to garbage collection and cannot promise secure erasure.

## Typed encrypted transactions

`VaultWorkspaceRecords` uses the same logical store/index definitions as the
legacy schema-8 adapter. A caller lists its allowed tables and receives an
explicit scoped unit of work. Nested operations share the journal, cannot add
tables or obtain write permission from a read-only parent, and expire when their
callback finishes. A rejected nested callback poisons the enclosing transaction
even if its caller catches the rejection. Unawaited operations/child callbacks
prevent commit and cache publication.

The unit captures a locally unlocked session, durable epoch and whole-workspace
revision. Reads decrypt after native transactions finish. Writes snapshot their
input, stage logical changes, then prepare only changed records once. A single
short native transaction checks the original revision and atomically writes
roots/new chunks and removes obsolete chunks. Concurrent permission, content or
key changes cause a structured conflict/locked response; arbitrary callbacks are
not automatically retried. Read-only results also verify the revision, preventing
publication of a mixed-version graph.

Primary IDs and scalar equality partitions are keyed HMAC tokens. All business
index values, including numeric history byte totals, remain encrypted in root
projections. History quota queries can read those small projections without
loading archived row bodies. Unbounded owner/tag/source memberships remain in
the chunkable payload and use an unlocked store scan when queried; they are not
limited to the physical 64-token ceiling. These scans trade some query cost for
preserving existing model limits. Tokens still reveal equality/access patterns
and ciphertext sizes/counts, not an encrypted-search privacy guarantee.

Unique logical identifiers are checked against both persisted and staged state,
including a final check for concurrent puts inside one unit. New chunks are
immutable, untouched chunks are reused, and a node geometry-only write does not
write datasets. Returned values/index keys are copies, preventing mutation of an
internal authenticated record without an explicit put. Cache updates run only
after durable commit and a session check. A quota failure preserves the previous
durable version and does not report the edit as saved.

Storage tests use actual Web Crypto and native IndexedDB interfaces with a test
IDB implementation. Real Chrome checks additionally cover UI setup, lock and
expiry, two-tab revocation, API/MCP parity, offline use, complete transfer and
incident rotation. A 100,000-row × 20-column transfer/rotation test covers full
payload verification and immutable dataset reuse; its local test timing is not a
mobile or browser performance guarantee. Final release acceptance and deployment
review remain in the active plan.

## Encrypted portable backup

```ts
interface EncryptedVaultBackup {
  format: "visualnerve-backup";
  version: 1;
  header: VaultHeader;
  backupId: string; // independent random UUIDv4
  chunkSize: number;
  totalBytes: number;
  chunks: readonly { iv: string; ciphertext: string }[];
  manifest: { iv: string; ciphertext: string };
}
```

Backup methods accept arbitrary bytes; a higher layer defines and validates the complete workspace serialization. Chunks default to 1 MiB, may be 64 KiB–1 MiB, and are limited to 4096 chunks and 1 GiB plaintext. An empty backup still has one authenticated empty chunk. Base64/JSON expands the container; these ceilings are input limits, not a guarantee that a 1 GiB backup fits every browser's memory, quota or bridge message envelope.

The header hash is SHA-256 of UTF-8 JSON of the parsed, canonical header. Chunk AAD is `['visualnerve-backup-chunk', 1, backupId, headerHash, chunkSize, totalBytes, chunkCount, chunkIndex]`; manifest AAD has the same fields except index and begins `visualnerve-backup-manifest`.

The encrypted manifest has exactly `format: 'visualnerve-backup-manifest', version: 1, backupId, totalBytes, chunkSize, chunkHashes`. Each hash is SHA-256 of UTF-8 JSON `[iv, ciphertext]` of its ordered chunk. Decryption authenticates the manifest, checks the entire ordered chunk list, then authenticates every data chunk. Missing, duplicated, reordered, substituted and truncated chunks fail. No callback or returned partial buffer exposes plaintext before complete success. On failure the assembled output is overwritten before rejection.

Encryption owns an input snapshot; crypto buffers are bounded per chunk, but the current container and final output are held in memory. A future streamed migration/restore must use authenticated quarantine/staging and preserve the same all-or-nothing publication contract. The crypto layer does not write or clear target records. A caller must validate the whole restored workspace before atomic Merge/Replace and preserve the destination vault's own keys/security metadata.

## Public API

```ts
const crypto = new VaultCrypto(); // optional injected native Crypto for tests
const created = await crypto.createVault(password, { iterations: 600_000 });
// Persist created.header only; show created.recoveryKey once. Keep keys in memory.
crypto.destroyKeys(created.keys); // This example models locking before a later unlock.
const keys = await crypto.unlockWithPassword(created.header, password);
// Or: crypto.unlockWithRecovery(created.header, recoveryKey).
const recordId = await crypto.indexToken(keys, "record:nodes", logicalId);
const context = { store: "nodes" as const, recordId, recordVersion: 1 };
const prepared = await crypto.encryptRecord(keys, context, {
  logicalId,
  value,
});
// Atomically write prepared outside this module, with revision/session checks.
const restored = await crypto.decryptRecord(keys, context, prepared);
const changedHeader = await crypto.changePassword(
  created.header,
  keys,
  newPassword,
);
const replacedRecovery = await crypto.changeRecovery(changedHeader, keys);
const rotated = await crypto.rotateContentKey(
  replacedRecovery.header,
  keys,
  newPassword,
);
// Prepare/verify all reencrypted records before atomically activating rotated.header.
const backup = await crypto.encryptBackup(
  changedHeader,
  keys,
  serializedWorkspaceBytes,
);
const bytes = await crypto.decryptBackup(keys, backup);
crypto.destroyKeys(keys);
crypto.destroyKeys(rotated.keys);
```

Structured errors include `INVALID_SCHEMA`, `UNSAFE_KDF`, `INVALID_PASSWORD`, `INVALID_RECOVERY_KEY`, `AUTHENTICATION_FAILED`, `KEY_DESTROYED`, `UNSUPPORTED_CRYPTO` and `LIMIT_EXCEEDED`. No raw Web Crypto authentication error, password, recovery key or content is incorporated in their messages. These internal cryptographic contracts feed the integrated storage/session boundary. REST/MCP exposes safe `GET /workspace/security` discovery and structured `WORKSPACE_LOCKED` responses; it does not expose credentials, keys or an unlock endpoint. See [the API contract](../API.md#encrypted-workspace-security).

Unit coverage exercises real Node Web Crypto, including incorrect credentials, authenticated header/record substitution, KDF bounds before work, format/resource rejection, protected token domain separation, rewrapping/rotation, async key destruction and complete multi-chunk backup corruption. Browser performance and release acceptance remain separate work in the active plan.
