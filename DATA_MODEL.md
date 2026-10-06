# Canonical graph and IndexedDB model

`frontend/src/model/types.ts` defines Diagram, GraphNode, GraphEdge, Owner and Graph. Integration DTOs and the generated OpenAPI contract retain the same field names. No parallel storage model changes graph identity or semantics.

All entity IDs are UUIDs, with positive versions and creation/update timestamps. Exchange documents contain `format: "visual-nerve"`, `formatVersion: 1`, diagram, nodes, edges and referenced owners. Application extensions belong in metadata.

3D shares these canonical records and IDs. `diagram.settings.spatialView` stores version 1, mode (`2d`/`3d`) and an optional position/target camera, with an optional unit `up` vector for saved roll. `node.metadata.spatial` stores version 1, optional X/Y/Z placement. Node world coordinates allow ±1,000,000 and camera coordinates ±10,000,000; both require finite numbers, camera position must differ from target and an explicit up direction must differ from the viewing axis. Reserved keys and enums are strictly validated. Existing 2D geometry and viewport remain independent. No IndexedDB migration or additional table is needed. See [3D contract](docs/SPATIAL_DIAGRAMS.md).

- Diagram: name, description, type, folder, tags, favorite, metadata and settings. Supported types: blank, mindmap, flowchart, timeline, process, dependency, responsibility and freeform.
- Node: diagramId, externalId, nodeType, title, description, notes, URL, status, color, tags, metadata, dates, parentId and collapsed. Absolute x/y/width/height describe layout. ownerIds is canonical; ownerId aliases its first member.
- Edge: diagramId, externalId, sourceNodeId, targetNodeId, label, edgeType, direction, style, description and metadata. Endpoints must exist in the same diagram.
- Owner: global person, team, department, system, organization or external owner, with name, email, team, role, color, externalId and metadata. Owners can be unassigned or shared across projects.

Icons use metadata.visualNerve.icon and preserve other custom keys. Diagram settings hold viewport, viewportDevice, grid, snap, timeline scale and entityOrder. Device-specific initial framing keeps phone maps readable. Entity order preserves branch and exchange order across indexed retrieval.

Optional `diagram.settings.drawing` holds `{ version: 1, visible, strokes }`. Each stroke has a UUID, hex color, width and `[x, y]` points in diagram coordinates. This is an independent annotation layer, not nodes or edges; changing it preserves graph relationships and CSV source identity. Tool/brush selection is transient. Stroke creation, erasing, visibility and clearing use the same undoable diagram commands and IndexedDB transactions. No schema upgrade or additional table is needed. See [DRAWING.md](docs/DRAWING.md) for limits.

SQL SELECT/WITH graphs use ordinary nodes and edges with reserved, bounded version-1 metadata. `node.metadata.sqlQuerySource` holds logical `scope`, `alias`, `kind` (`table`, `derived`, `cte`), `qualifiedName`, observed `columns` and optional `queryScope`. Repeated table aliases remain separate nodes. `node.metadata.sqlQueryResult` holds `scope`, optional `parentScope`, `name`, `distinct`, ordered output columns (`ordinal`, `name`, optional `alias`, `expression`, references and optional duplicate-alias warning), and clauses (`from`, `where`, `groupBy`, `having`, `orderBy`, `limit`). `edge.metadata.sqlQueryRelationship` holds scope, kind (`join`, `input`, `lineage`, `subquery`), optional join type/condition, references and output ordinals. References use scope/source-alias identities plus column and resolved/unresolved/ambiguous status; they deliberately contain no editor UUIDs, so ID remapping preserves them.

Source columns are names observed in the query, not inferred database types, nullability or keys. Expressions and predicates retain literal values; raw source scripts and comments remain temporary. Reserved metadata and structural limits are validated before API/import writes. No new IndexedDB table or schema migration is needed. See [SQL query and schema import](docs/SQL_IMPORT.md).

Copying/pasting query objects within a diagram gives the pasted logical query instance independent scopes and remaps its internal scope/alias references together. Referenced sources outside a selected copy remain explicit unresolved context. Importing a complete JSON graph into a new diagram can retain its logical scopes because query identities are diagram-local.

## IndexedDB schema

| Table | Key and indexes | Contents |
| --- | --- | --- |
| diagrams | id; name, type, updatedAt, folder, tags | Canonical Diagram |
| nodes | id; diagramId, unique [diagramId+externalId], updatedAt, nodeType, status, parentId, ownerIds | Canonical GraphNode |
| edges | id; diagramId, unique [diagramId+externalId], sourceNodeId, targetNodeId, updatedAt | Canonical GraphEdge |
| owners | id; unique externalId, name, kind, team, updatedAt | Canonical Owner |
| settings | key | Preferences, workspace identity, last project |
| templates | id; name | Named canonical graph and builtin flag |
| datasets | id; diagramId, updatedAt | Original CSV column IDs and string rows; multiple sources per diagram |

Dexie version 1 discovers legacy browser snapshots. Version 2 expands them into canonical records, retaining pending edits, owners and settings. Version 3 removes obsolete snapshot/state stores. Version 4 preserves the six stores and removes the historical boolean integration grant, requiring explicit MCP permissions. Version 5 adds diagram-owned CSV datasets while retaining existing records. Version 6 changes their diagramId index to nonunique, retaining all existing sources. Source analyses, matching-column relationships, entity focus and named views persist in diagram settings, with source paths/measures on node metadata; exchange graphs optionally include a primary dataset and additional datasets. Local storage acceptance is a separate preference required before the workspace opens. It and integration grants are never imported from backups. Fresh installations finish with exactly the seven tables above; built-in templates seed only after acceptance and only when absent. No history, attachments or separate metadata table is created. See [STORAGE.md](docs/STORAGE.md).

Parents must belong to the same graph; cycles, orphan connections, unknown owners, invalid geometry, dates and URL schemes are rejected. Nodes and edges have diagram-scoped external identities; owners have globally unique external identities. PATCH checks the current entity version. Whole-graph replacement checks the diagram baseVersion inside the same transaction. Owner changes advance referencing diagram versions. Diagram removal cascades to nodes/edges/datasets and retains global owners. Single node removal detaches children; branch or group removal removes descendants and incident connections atomically.

## Code analysis metadata

Native code diagrams use `diagram.metadata.codeAnalysis={version:1,languages,mode,fileCount,symbolCount,dependencyCount,unresolvedCount,warnings,focus?}` as import provenance. Recognized nodes use `metadata.codeObject={version:1,language,path,kind,name,line?,endLine?,external?,summary?}`. Kinds are file/class/function/type/resource/query/measure/variable/external. Recognized edges use `metadata.codeRelation={version:1,kind,confidence,evidence?:{path,line}}`, with contains/imports/calls/inherits/references/reads/writes/depends-on kinds and syntax/heuristic/unresolved confidence. Reserved contracts reject unknown keys and malformed values before writes; other custom metadata remains ordinary metadata.

Source locations identify the imported source, not the current edited diagram title. Complete source and nonstructural values are not retained. Real UUID endpoints express the relationships; provenance metadata has no hidden UUID references. Copy/import/backup remap normal endpoints and preserve provenance. Reconnect removes stale code evidence and converts generated `code-*` edge types to ordinary relationships unless a custom type was supplied. The original import counts describe the analysis and are not recomputed for later manual edits. No additional IndexedDB store or schema upgrade is needed. See [code import](docs/CODE_IMPORT.md).
