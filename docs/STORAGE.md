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
| settings | Appearance, local identity/last diagram, required consent, MCP grant/address, export/reminder bookkeeping |
| templates | Built-in seeds and user templates with complete graphs |
| datasets | Original CSV strings and stable column IDs, one source per diagram; unique diagramId index |

CSV analysis filters, cleanup, grouping and measures persist in diagram settings. Raw CSV strings live once in the datasets store; ordinary node/edge edits do not rewrite them. A bounded source cache is invalidated by IndexedDB mutations across connections.

Selection, dialogs, canvas filters, pending commands and bounded undo/redo remain in memory. Bridge tokens are ephemeral session storage, excluded from backups. The historical localStorage theme is migrated once and removed. No entity is stored in localStorage, filesystem JSON, another database or a remote service.

## Explicit upgrades

1. Historical whole graphs, diagrams, owners and state.
2. Normalize legacy graphs, including pending edits, into six canonical stores; retain versions, ordering and preferences.
3. Remove obsolete graph/state containers after migration.
4. Preserve canonical records; remove the obsolete boolean integration grant and require new explicit permission.
5. Add the datasets store without rewriting or removing existing records.

Acceptance is separate from an integration grant or informational acknowledgement. Existing data remains intact before acceptance. Updates never reset the database. Version changes close older connections so upgrades can complete. Each upgrade needs transactional migration tests; keep the database name stable.

## Shared service and transactions

UI, MCP and restore use Repository validation and IndexedDB transactions. Version checks reject stale edits. Bulk population, graph replacement, import, owner reassignment and deletions are atomic. Indexed reads and bulk writes support large graphs. Dexie live queries update other tabs in the same browser/origin; conflict resolution preserves a local copy or explicitly chooses saved/replaced data.

Startup checks consent before loading graphs, seeding templates, subscribing to edits or starting MCP. Workspace commands check stored consent too. The first-run gate has no dismiss action that grants access. Offline caching registers only after acceptance.

## Export, restore, clear

Backups use one read transaction across all seven stores and include format/schema versions, CSV sources and export date. Diagram JSON also includes its source dataset. Import, Merge and Replace remap dataset/diagram/node references together. Deleting a diagram deletes its source in the same transaction. They exclude credentials, grants, consent, local identity/selection and reminder bookkeeping. See [EXPORT_FORMAT.md](../EXPORT_FORMAT.md).

Merge and Replace use one transaction across all stores. Invalid records roll back everything, including destructive replacement. Collision remapping preserves shared owners and internal references. Merge keeps destination connection choices; Replace creates a new local identity with MCP Off. Both preserve the destination's own consent without importing another profile's consent. Confirmed deletion clears every user record/preference and seeds only built-in templates and a fresh identity.

Cache Storage holds only service-worker app files, not graph records. Manual downloads are explicit user-controlled artifacts. Browser profile and exact origin own each database; other devices/profiles/ports/hosts have separate workspaces. Keep one canonical production origin and export/import to move work. Browser clearing or eviction can remove data; persistence requests are advisory and never guarantee retention. See [PRIVACY.md](PRIVACY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
