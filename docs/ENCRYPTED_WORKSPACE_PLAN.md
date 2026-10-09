# Encrypted local workspace implementation plan

Status: implemented and manually released on 9 October 2026 after exact-revision CI and real production acceptance; subsequent changes retain the same manual release gates. The [dated evidence report](acceptance/2026-10-08-encrypted-workspace.md) records verification and its limits; GitHub Actions records exact-revision CI and manual publication. Existing workspaces are not migrated or replaced automatically.

## Agreed scope

Build an enterprise-oriented local workspace with password-based unlocking, authenticated AES-256 encryption, automatic locking and explicit integration permissions. Preserve local-first operation: no mandatory backend, cloud database, account service or SSO.

The dedicated application uses `https://app.visualnerve.com`, isolated from the public website and its optional marketing Analytics. On 2026-10-08 the owner provided bucket `app.visualnerve.com` and CloudFront distribution `E10TKGRYWGM422`. The existing infrastructure was hardened to a private S3 REST origin with OAC, a dedicated LIVE route function and nine security headers. A known non-sensitive object was readable through CloudFront and denied through direct S3; an unknown route returned 404. App publication remains a separate manual operation gated by exact-revision CI and staging review.

Keep working directly on `main`. Do not create branches or worktrees. Commit and push the completed change after relevant checks pass. Deployment stays manual, with successful CI for the exact revision and staging review before production.

## Security boundary

The intended protection is confidentiality and integrity of locked persisted workspace content. It is not a guarantee against a compromised unlocked browser, malicious extensions, device malware, screenshots, authorized exports or an authorized AI client sending received information to another service.

Do not claim ISO 27001 certification, a SOC 2 report, FIPS validation, GDPR compliance, end-to-end encryption or guaranteed forensic memory erasure from the presence of AES. Publish implemented controls, tested boundaries, limitations and assurance status.

Only documented technical bootstrap metadata may remain readable while locked: format/KDF information, wrapped-key envelopes, opaque identifiers and revocation state. Any non-sensitive appearance or consent preference outside the vault must be explicitly documented. Workspace names, owners, tags, filenames, SQL evidence, original cells and their content indexes must not remain readable.

## Implementation order

### 1. Storage and lifecycle contract

- Define versioned vault, encrypted-record and encrypted-backup schemas, with strict validation and fail-closed behavior.
- Introduce separate modules/classes for cryptography, encrypted persistence, sessions, lifecycle cleanup, migration, backup and app-cache management.
- Inventory every read/write path, including all 14 existing stores, direct settings/history/simulation writes, drafts, workers, exports and cross-tab updates.
- Choose the protected query/index strategy before adapting persistence. Preserve version checks, reference validation, incremental updates and atomic transactions; do not store business indexes in plaintext.
- Replace the existing unkeyed content digests in history identifiers with a protected deduplication strategy. Identifiers must not permit public digest comparisons or confirmation of guessed private data without a key. Document residual metadata: keyed equality indexes can reveal equality patterns within a vault, and encryption does not hide record counts, sizes or access timing.
- Keep key/KDF/recovery/session controls outside the generic API/MCP settings store. A client must not disable encryption, change a password or extend a session through an arbitrary setting.
- Decide and benchmark the password KDF/work factor against current primary guidance and supported browsers. Persist its version and parameters; reject unsupported or unsafe parameters. Do not invent a cipher or KDF.

### 2. Isolated application hosting

- Build a dedicated application surface without marketing scripts or Analytics, including the documentation and assets required for normal/offline use.
- Configure HTTPS, browser security headers, framing protection and a tested Content Security Policy. Explicitly account for local WebSocket integration, workers, WebAssembly and user-requested voice-model downloads.
- Keep security policy consistent for HTML, assets, documentation, errors and cached/offline responses; enforce relevant policy in application code where headers alone cannot apply.
- Prepare manual deployment configuration for the new origin. Verify the actual deployed response headers, not only a repository template.
- Preserve the old `/app/` as a migration entry point. Do not redirect users away from their existing origin-bound IndexedDB before transfer and recovery are available.

### 3. Cryptography and encrypted persistence

- Generate a random AES-256-GCM content key per local vault. Derive a separate password key used to wrap that content key; a password change rewraps it rather than rewriting every dataset.
- Distinguish ordinary password/recovery-key changes from incident key rotation. Rewrapping rejects old credentials against the current canonical vault; it cannot revoke historical backups or copied key envelopes. Provide an explicit content-key rotation path for a suspected key compromise and document that old copies remain outside its protection.
- Use fresh cryptographic nonces and authenticated record context on every encryption. Bind ciphertext to its vault, record/store identity and format. Reject modified, substituted or truncated records.
- Keep passwords and usable keys in browser memory only. Do not persist them in IndexedDB, localStorage, sessionStorage, URLs, logs, broadcasts or the bridge.
- Encrypt diagrams, nodes, edges, owners, private preferences, custom templates, CSV sources, all history and simulation models/results/checkpoints.
- Use bounded encrypted records/chunks and incremental writes. Moving a node must not serialize and encrypt an unchanged 100,000-row CSV again.
- Prepare asynchronous cryptographic work outside short IndexedDB transactions, then atomically commit with document version and session-generation checks. Do not allow Web Crypto waits to silently break transaction boundaries.

### 4. Setup, unlocking and sessions

- Require first-visit password setup before opening a new workspace, seeding templates or starting integration. Returning users unlock in the browser.
- Provide password confirmation, accessible validation, secure password change and a separate recovery-key workflow. Explain that neither Visual Nerve nor a server can reset the encryption password without recovery material.
- Explain backup independence visibly during first-visit setup, password/recovery changes and backup/export, with the same guidance in Help. An old encrypted backup keeps its old credentials; plaintext exports stay unencrypted. Tell users to create and verify a replacement before retiring old copies, including shared folders and cloud version history, and that copies held by someone else cannot be recalled.
- Proposed initial defaults: 15 minutes of human inactivity and an 8-hour absolute session limit. Validate and document configurable bounded ranges in Settings; final values will be reviewed with the implemented UX. Automated MCP requests, animations and simulations do not count as human activity.
- Provide **Lock workspace** and check deadlines on sensitive operations, tab visibility/focus changes and resume after sleep, not only through background timers.
- Use one authoritative session state and monotonic revocation generation. Fence asynchronous reads, writes, callbacks and response publication against a lock or password/migration change.
- Synchronize revocation across tabs without sharing keys. A suspended tab must detect missed revocation before continuing; unlocking one tab must not silently transmit its key to another.
- Use workspace-wide inactivity and absolute deadlines for tabs participating in the same local session. Genuine human activity may update the shared inactivity deadline; opening or unlocking an additional tab must not extend the absolute deadline. An idle hidden tab must recheck the authoritative deadline before revoking an actively used workspace. Each tab still acquires its own key by local unlocking.
- On locking, remove content from the UI, cancel imports/exports, stop simulations/playback/audio, terminate sensitive workers, clear retained plaintext references and discard key references. Preserve committed data and flush pending edits before revocation where possible. Define the failure behavior for unsaved drafts explicitly: quota/write failure cannot guarantee their durable recovery, and must not silently extend the security deadline. Surface save failure and the last durable version; test manual-lock and automatic-expiry cases separately.

### 5. API and MCP parity

- Make UI, repository, storage, workers, API and MCP use the same session boundary.
- Expose non-sensitive lock status and an explicit lock operation. Do not expose password, unlock, recovery or usable keys through MCP.
- Return a structured `423` / `WORKSPACE_LOCKED` result for content operations through an enabled, retained control connection while locked. Integration Off, a closed browser or no available peer remains `503` / unavailable. Recheck session generation immediately before committing or sending an external result.
- Retain only a previously authorized restricted control connection to report lock status. It must not carry content; unlocking must not automatically revive an earlier content/write grant. Correctly select an unlocked peer when several tabs share a workspace.
- Keep static API/MCP tools, schemas and documentation discoverable without an unlocked browser. No second database, decryption engine or shadow simulation configuration.
- Update API, MCP, OpenAPI and Help together, including behavior for expired sessions, interrupted work and explicit reauthorization.

### 6. Migration, backup and cache management

- Provide an explicit user-controlled transfer from the old origin. Origins cannot read each other's IndexedDB; no server migration can copy these local records.
- Use encrypted transfer/backup files and verify restoration before retiring the original. Preserve IDs, versions, relationships, source rows, history and simulator records.
- Make same-origin format migration resumable and crash/quota safe, with a migration journal, coordinated write exclusion and an atomic activation step. Verify encrypted data before removing legacy records; never fall back silently to a new plaintext or empty workspace.
- Prevent older tabs/offline bundles from continuing plaintext writes after migration. Explain limits of deleting historical plaintext in browser journals, OS backups and old exports.
- Define a safe deployment rollback before cutover: a migrated vault may open only in a compatible encrypted client or a designated recovery release. A rollback, including a stale offline/service-worker bundle, must never create an empty replacement, write plaintext or silently downgrade the storage format.
- Use encrypted backups by default and authenticate a complete backup before modifying the target workspace. Merge/Replace must preserve the target vault's own security metadata and keys.
- Keep deliberate plaintext PNG/PDF/SVG/Markdown/JSON/video exports available with clear sharing boundaries; they are not encrypted vault backups.
- Add **Clear app cache** in Settings for app-owned downloaded assets and voice models. It must preserve IndexedDB, encrypted workspace records, key envelopes, password configuration and unrelated caches. Cancel relevant downloads so they cannot repopulate the cache during clearing.
- Keep **Lock workspace**, **Clear app cache** and **Delete local workspace** separate. Deletion requires strong confirmation; cache clearing must never become a hidden data deletion action. Do not claim access to the browser's entire HTTP cache, history or other origins.

### 7. Security information and release

- Add an English public section describing security for sensitive local work, linked to a structured security page.
- Document the actual storage/egress model, password and recovery responsibilities, sessions, integration grants, exports, vulnerability reporting and shared device/browser responsibilities.
- Clearly separate implemented controls from planned functionality and independent assurance. Use OWASP ASVS as a verification framework; do not present internal tests as an external security audit.
- Update Help, API/MCP setup, schemas, screenshots and deployment documentation where behavior changes.
- Run relevant unit, integration, browser and performance checks, then full exact-head CI. Review the concrete staging release and migration experience before manually publishing it.

## Required acceptance evidence

| ID    | Pass condition                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EW-01 | A new workspace cannot persist or expose private records before password setup; reload returns to a locked screen.                                                                                                                                                                                                                                     |
| EW-02 | Raw IndexedDB inspection across every store and index reveals no planted private text, cells, names, tags, paths or SQL literals. Unkeyed content fingerprints do not leak through history identifiers. Technical metadata exceptions are explicit.                                                                                                    |
| EW-03 | Wrong passwords, altered ciphertext/tags/context and invalid schemas fail closed without corrupting or replacing the workspace.                                                                                                                                                                                                                        |
| EW-04 | Password/recovery changes preserve the complete model; old credentials cannot unlock the current canonical vault. Incident content-key rotation is verified. Historical backup/envelope limitations appear in setup, password/recovery, backup/export and Help. No password or usable key appears in network traffic, URLs, persistent stores or logs. |
| EW-05 | Inactivity and absolute expiry work through reload/sleep/background throttling; automated MCP traffic does not extend the session.                                                                                                                                                                                                                     |
| EW-06 | Locking during a save, decryption, import, worker run, playback, export or MCP response prevents stale commits/content publication and preserves committed data. Quota-failed pending edits follow the documented failure policy without extending the security deadline.                                                                              |
| EW-07 | Two-tab locking, missed broadcasts, suspended-tab wake-up and concurrent password/migration changes cannot bypass revocation. An idle tab does not expire an actively used shared session; an additional unlock does not extend its absolute limit.                                                                                                    |
| EW-08 | UI, API and MCP expose the same lock state. Enabled locked control sessions return the documented `423`; Off/closed/no-peer states remain unavailable. Clients cannot change security settings or silently recover content grants. Static discovery still works.                                                                                       |
| EW-09 | Interrupted or quota-failed migration preserves the source and resumes safely. Legacy documents remain accessible until their verified transfer. Deployment rollback and stale offline clients fail safely against a migrated vault.                                                                                                                   |
| EW-10 | Encrypted backup round trips preserve all records. Corrupted/wrong-password backups make no target changes; Replace preserves the target security configuration.                                                                                                                                                                                       |
| EW-11 | Clear app cache removes only owned downloaded resources and safely cancels repopulating jobs; diagrams, keys, password/session settings and unrelated caches remain intact.                                                                                                                                                                            |
| EW-12 | The separate app origin has no Analytics/marketing execution. Deployed HTTPS/headers/CSP and local integration, workers, 3D, exports, speech and offline use are tested together.                                                                                                                                                                      |
| EW-13 | A representative 100,000-row dataset and large diagrams remain usable, with measured bounded encryption/migration overhead and no full-dataset rewrite for geometry-only edits.                                                                                                                                                                        |
| EW-14 | Existing diagram types, history, simulator behavior, import/export and UI/API/MCP parity regressions pass.                                                                                                                                                                                                                                             |
| EW-15 | Public claims match implemented evidence; certification and independent-assessment status are accurately stated. CI and staging are green for the reviewed exact revision.                                                                                                                                                                             |

## References

- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [W3C Web Cryptography security considerations](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#security-considerations)
- [OWASP Application Security Verification Standard](https://owasp.org/projects/asvs)
- [Dexie transaction guidance](https://dexie.org/docs/Dexie/Dexie.transaction/)

The isolated `app.visualnerve.com` release meets the implementation acceptance gates recorded in the dated report. Existing legacy workspaces are not retroactively encrypted. This plan does not establish independent certification.
