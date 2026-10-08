# Authoritative browser storage

IndexedDB is the authoritative persistent application data store. There is no server-side application database. S3 is not used for diagram storage. CloudFront is not a data synchronization layer. React editor state commits through the shared TypeScript workspace/repository layer.

## Schema

The historical database name `visual-nerve-cache` remains so existing data upgrades in place. It now holds canonical records, not a secondary cache.

| Store | Contents |
| --- | --- |
| diagrams | UUID, name/mode/folder/tags/favorite, metadata, viewport, grid/snap/layout/time scale, entity order, versions/timestamps |
| nodes | Canonical coordinates, hierarchy, text/details, ownership, status/dates, icons/colors/metadata; diagramId and unique diagramId/externalId indexes |
| edges | Canonical endpoints, relationship/direction/style, labels/metadata; diagramId, endpoint and unique diagramId/externalId indexes |
| owners | Global and unassigned owners, unique externalId and name/kind/team indexes |
| settings | Appearance, local import-byte and ZIP source-file limits, local identity/last diagram, required consent, MCP grant/address, export/reminder bookkeeping |
| templates | Built-in seeds and user templates with complete graphs |
| datasets | Original CSV strings and stable column IDs, up to eight sources per diagram; nonunique diagramId index |
| historySnapshots | Named and pre-refresh/pre-restore snapshot headers |
| historyContents | Deduplicated structural graphs without raw CSV rows |
| historySources | Archived source headers referencing immutable row content |
| historyRows | Shared immutable historical CSV strings |
| simulationModels | Versioned semantic Process Simulator models, including particle types, shared resources and scenarios |
| simulationRuns | Bounded run archives, metrics, events and scenario comparison data |
| simulationCheckpoints | Bounded per-run replay snapshots indexed by simulated time |

CSV analysis filters, cleanup, grouping and measures persist in diagram settings: `csvAnalysis` remains the primary-source legacy configuration and `csvSourceAnalyses` holds source-specific configurations. `csvRelationships` records explicit matching columns and `csvEntityFocus` records related-entity context. Matching selects original rows once per source; it does not persist joined rows or multiply source-native sums. Raw CSV strings live once in the datasets store; ordinary node/edge edits do not rewrite or clone them. A bounded immutable source cache is invalidated by IndexedDB mutations across connections. Source refresh and source additions/removals are atomically saved with graph changes, and undo/redo keeps immutable source references.

Selection, dialogs, canvas filters, pending commands and bounded undo/redo remain in memory. Bridge tokens are ephemeral session storage, excluded from backups. The historical localStorage theme is migrated once and removed. No entity is stored in localStorage, filesystem JSON, another database or a remote service.

Appearance defaults to System and follows operating-system changes. The workspace, Guide, Privacy, License, error page and API reference read the same consented IndexedDB `theme` preference. Reference pages read only the two settings records for appearance and consent; they never create or upgrade the workspace database, enumerate diagrams or register offline caching. Saved changes notify open pages, while focus/reload refreshes the preference when cross-tab messaging is unavailable. The shared `/appearance.js` is included in the offline application shell.

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

UI, MCP and restore use Repository validation and IndexedDB transactions. Version checks reject stale edits. Bulk population, graph replacement, import, owner reassignment and deletions are atomic. Indexed reads and bulk writes support large graphs. Dexie live queries update other tabs in the same browser/origin; conflict resolution preserves a local copy or explicitly chooses saved/replaced data.

Startup checks consent before loading graphs, seeding templates, subscribing to edits or starting MCP. Workspace commands check stored consent too. The first-run gate has no dismiss action that grants access. Offline caching registers only after acceptance.

## Export, restore, clear

Backups use one read transaction across all 14 schema-version-8 stores and include format/schema versions, CSV sources and export date. Diagram JSON includes its primary `dataset` and optional additional `datasets`; older single-source diagrams and backups remain accepted. Import, Merge and Replace remap all source IDs, per-source analyses, relationship endpoints, entity focus, CSV node bindings and saved-view references together. Deleting a diagram deletes every owned source in the same transaction. Malformed imports roll back without partially replacing existing data. They exclude credentials, grants, consent, the browser-local import-byte and ZIP source-file limits, local identity/selection and reminder bookkeeping. See [EXPORT_FORMAT.md](../EXPORT_FORMAT.md).

Merge and Replace use one transaction across all stores. Invalid records roll back everything, including destructive replacement. Collision remapping preserves shared owners and internal references. Merge keeps destination connection choices; Replace creates a new local identity with MCP Off. Both preserve the destination's own consent, import-byte limit and ZIP source-file limit, ignoring those settings in the backup. Confirmed deletion clears every user record/preference and seeds only built-in templates and a fresh identity.

CacheStorage holds the service-worker app assets and a separate cache of fixed downloaded voice-model binaries/configuration. It stores no graph records or narration text; generated audio remains transient. Voice download requires explicit audio, preload, export with audio or a voice preview. See [speech](SPEECH.md). Manual downloads are explicit user-controlled artifacts. Browser profile and exact origin own each database; other devices/profiles/ports/hosts have separate workspaces. Keep one canonical production origin and export/import to move work. Browser clearing or eviction can remove data; persistence requests are advisory and never guarantee retention. See [PRIVACY.md](PRIVACY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

Named local history and automatic safety checkpoints retain removed content until the versions or diagram are explicitly deleted. Unchanged CSV rows are deduplicated. Full backups include history and remap historical references; single-diagram export includes current content only. Restore keeps current shared owner profiles and exact saved positions. See [understanding workflows](UNDERSTANDING.md) for quotas and comparison bounds.
