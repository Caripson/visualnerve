# Authoritative browser storage

IndexedDB is the authoritative persistent application data store. There is no server-side application database. S3 is not used for diagram storage. CloudFront is not a data synchronization layer. React editor state commits through the shared TypeScript workspace/repository layer.

## Schema

The legacy database name `visual-nerve-cache` remains so existing plaintext data upgrades in place. It holds canonical records, not a secondary cache. Its published workspace remains available during the separate encrypted release review.

The isolated app runtime uses `visual-nerve-vault`, physical schema 1, with only technical metadata and authenticated ciphertext records. It does not open the legacy database. Both adapters implement the same typed logical schema 8 and 14 stores listed below; Repository, history, simulation and external commands use that shared contract. All private logical records, query projections and identifiers are encrypted or keyed. A small vault header/control record contains setup/revision metadata but no readable content or credentials. [Complete wire and session schema](ENCRYPTED_WORKSPACE_SCHEMA.md).

| Store                 | Contents                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| diagrams              | UUID, name/mode/folder/tags/favorite, metadata, viewport, grid/snap/layout/time scale, entity order, versions/timestamps                                |
| nodes                 | Canonical coordinates, hierarchy, text/details, ownership, status/dates, icons/colors/metadata; diagramId and unique diagramId/externalId indexes       |
| edges                 | Canonical endpoints, relationship/direction/style, labels/metadata; diagramId, endpoint and unique diagramId/externalId indexes                         |
| owners                | Global and unassigned owners, unique externalId and name/kind/team indexes                                                                              |
| settings              | Appearance, local import-byte and ZIP source-file limits, local identity/last diagram, required consent, MCP grant/address, export/reminder bookkeeping |
| templates             | Built-in seeds and user templates with complete graphs                                                                                                  |
| datasets              | Original CSV strings and stable column IDs, up to eight sources per diagram; nonunique diagramId index                                                  |
| historySnapshots      | Named and pre-refresh/pre-restore snapshot headers                                                                                                      |
| historyContents       | Deduplicated structural graphs without raw CSV rows                                                                                                     |
| historySources        | Archived source headers referencing immutable row content                                                                                               |
| historyRows           | Shared immutable historical CSV strings                                                                                                                 |
| simulationModels      | Versioned semantic Process Simulator models, including particle types, shared resources and scenarios                                                   |
| simulationRuns        | Bounded run archives, metrics, events and scenario comparison data                                                                                      |
| simulationCheckpoints | Bounded per-run replay snapshots indexed by simulated time                                                                                              |

CSV analysis filters, cleanup, grouping and measures persist in diagram settings: `csvAnalysis` remains the primary-source legacy configuration and `csvSourceAnalyses` holds source-specific configurations. `csvRelationships` records explicit matching columns and `csvEntityFocus` records related-entity context. Matching selects original rows once per source; it does not persist joined rows or multiply source-native sums. Raw CSV strings live once in the datasets store; ordinary node/edge edits do not rewrite or clone them. A bounded immutable source cache is invalidated by IndexedDB mutations across connections. Source refresh and source additions/removals are atomically saved with graph changes, and undo/redo keeps immutable source references.

Selection, dialogs, canvas filters, pending commands and bounded undo/redo remain in memory. Bridge tokens are ephemeral session storage, excluded from backups. The historical localStorage theme is migrated once and removed. No entity is stored in localStorage, filesystem JSON, another database or a remote service.

On the isolated origin, password setup/unlock precedes private access. RAM-only key capabilities and persisted revocation/revision fences bind asynchronous work to its originating session. Lock clears working references, cancels workers/runtime/export jobs and prevents their old results from committing or publishing after a new unlock. Cleanup is best effort, not browser/OS forensic erasure. Cross-tab coordination and native transactions preserve complete writes; failed quota or conflicting revisions are errors rather than saved edits.

Appearance defaults to System and follows operating-system changes. The workspace, Guide, Privacy, License, error page and API reference read the same consented IndexedDB `theme` preference. Reference pages read only the two settings records for appearance and consent; they never create or upgrade the workspace database, enumerate diagrams or register offline caching. Saved changes notify open pages, while focus/reload refreshes the preference when cross-tab messaging is unavailable. The shared `/appearance.js` is included in the offline application shell.

The isolated app's locked and reference pages instead use the harmless
`visualnerve-app-appearance` light/dark/system preference without opening private
records. The public and isolated origins keep independent choices.

The browser-local `import-file-limit-mb` setting defaults to 50 and accepts integer values from 50 to 1024. **Settings → Import file size → Maximum import file size (MB)** saves it; MB means MiB and 1024 MB is 1 GB. `PUT /settings/import-file-limit-mb` accepts `{ "value": 50 }` with the same range, and invalid values return 422. Import payloads gain no size field. Imports up to 50 MB are supported and guaranteed; higher limits are experimental and can be slow or fail because of browser memory or format constraints. Other structural/deadline limits and the 32 MiB JSON/WebSocket envelopes remain unchanged.

The separate browser-local `project-source-file-limit` defaults to 500 analyzed ZIP source files and accepts integers from 500 through 10,000. `PUT /settings/project-source-file-limit` changes it with Read + write; Read only may read its effective value. Jobs capture it once, and source payloads cannot override it. Counts above 500 are experimental and do not raise byte, archive-entry, line, graph or deadline limits. Backups exclude both local import settings.

## Explicit upgrades

1. Historical whole graphs, diagrams, owners and state.
2. Normalize legacy graphs, including pending edits, into six canonical stores; retain versions, ordering and preferences.
3. Remove obsolete graph/state containers after migration.
4. Preserve canonical records; remove the obsolete boolean integration grant and require new explicit permission.
5. Add the datasets store without rewriting or removing existing records.
6. Change the `datasets.diagramId` index from unique to nonunique to support multiple diagram-owned sources. Existing source rows and diagrams are preserved; source order is stored in `diagram.settings.csvDatasetOrder`.
7. Add four history stores without rewriting current graphs or datasets. Existing records remain intact.
8. Add three simulation stores without rewriting ordinary diagrams, sources or history. Simulation documents keep an explicit type and model schema version.

Acceptance is separate from an integration grant or informational acknowledgement. Existing data remains intact before acceptance. Updates never reset the database. Version changes close older connections so upgrades can complete. Each upgrade needs transactional migration tests; keep the database name stable.

## Shared service and transactions

UI, MCP and restore use Repository validation and IndexedDB transactions. Version checks reject stale edits. Bulk population, graph replacement, import, owner reassignment and deletions are atomic. Indexed reads and bulk writes support large graphs. Backend subscriptions notify other tabs in the same browser/origin: the legacy adapter uses Dexie storage-mutation notifications, while the encrypted adapter uses vault change notifications and coordinated reads under the current session. Conflict resolution preserves a local copy or explicitly chooses saved/replaced data.

Startup checks consent before loading graphs, seeding templates, subscribing to edits or starting MCP. Workspace commands check stored consent too. The first-run gate has no dismiss action that grants access. Offline caching registers only after acceptance.

## Export, restore, clear

The isolated UI's complete backup download is an authenticated encrypted
`visualnerve-backup` version-1 container; normal legacy downloads remain readable
`visual-nerve-workspace` JSON. The legacy UI also offers a separately protected
encrypted transfer file without encrypting or modifying its source database.
API/MCP `GET /workspace/export` remains a readable semantic export to an
authorized client, not an encrypted file-download operation. Ordinary diagram
exports remain readable.

The dedicated complete-transfer path preserves original identifiers, versions,
CSV rows and retained history/simulation archives. It validates everything
before a single destination transaction, then freshly reads and authenticates
all saved contents and digests. A pending-transfer marker forces verification
before editor initialization after interruption. It leaves the original origin
intact, keeps destination security/consent choices and integration Off. Ordinary
Merge/Replace below retains its existing remapping behavior. [Transfer and
incident key-rotation procedures](../hugo/content/help/settings.md).

Backups use one read transaction across all 14 schema-version-8 stores and include format/schema versions, CSV sources and export date. Diagram JSON includes its primary `dataset` and optional additional `datasets`; older single-source diagrams and backups remain accepted. Import, Merge and Replace remap all source IDs, per-source analyses, relationship endpoints, entity focus, CSV node bindings and saved-view references together. Deleting a diagram deletes every owned source in the same transaction. Malformed imports roll back without partially replacing existing data. They exclude credentials, grants, consent, the browser-local import-byte and ZIP source-file limits, local identity/selection and reminder bookkeeping. See [EXPORT_FORMAT.md](../EXPORT_FORMAT.md).

Merge and Replace use one transaction across all stores. Invalid records roll back everything, including destructive replacement. Collision remapping preserves shared owners and internal references. Merge keeps destination connection choices; Replace creates a new local identity with MCP Off. Both preserve the destination's own consent, import-byte limit and ZIP source-file limit, ignoring those settings in the backup. Confirmed deletion clears every user record/preference and seeds only built-in templates and a fresh identity.

CacheStorage holds the service-worker app assets and a separate cache of fixed downloaded voice-model binaries/configuration. It stores no graph records or readable narration text. Full preloads can also use a separate encrypted temporary narration cache after a 32 MiB prepared-clip RAM cache, with random cache/entry identifiers and an AES-256-GCM key held only in RAM. Generated audio is excluded from IndexedDB and backups, cannot be recovered after reload, and is cleaned up on close, voice/content changes or lock. Browser quota and a 1 GiB retained-ciphertext ceiling including IV/tag overhead can stop preload explicitly. Crashes may leave unusable ciphertext until Clear app cache removes it. Voice download requires explicit audio, preload, export with audio or a voice preview. See [speech](SPEECH.md). Manual downloads are explicit user-controlled artifacts. Browser profile and exact origin own each database; other devices/profiles/ports/hosts have separate workspaces. Keep one canonical production origin and export/import to move work. Browser clearing or eviction can remove data; persistence requests are advisory and never guarantee retention. See [PRIVACY.md](PRIVACY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

**Clear app cache** cancels asset/download/runtime work and removes only owned
app/voice caches and owned encrypted narration spill through a service-worker and cross-tab handshake. It preserves
workspace records, vault credentials/control metadata and unrelated caches. A
small technical cache-control marker prevents interrupted downloads from
repopulating cleared resources. This does not clear the browser's entire HTTP
cache, other websites or downloaded exports.

Named local history and automatic safety checkpoints retain removed content until the versions or diagram are explicitly deleted. Unchanged CSV rows are deduplicated. Full backups include history and remap historical references; single-diagram export includes current content only. Restore keeps current shared owner profiles and exact saved positions. See [understanding workflows](UNDERSTANDING.md) for quotas and comparison bounds.
