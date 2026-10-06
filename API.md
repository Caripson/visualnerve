# Optional local REST and MCP integration

IndexedDB in the browser is the only database. Start the static server with `--bridge`, open the app and explicitly choose Settings → MCP access → Read only or Read + write (default Off). REST and MCP forward commands over a local WebSocket to that browser. The browser applies IndexedDB transactions before replying. The Go server retains no application records; without a connected browser graph requests return 503.

Base: `http://localhost:4317/api/v1`. Responses and request bodies are JSON unless exporting Markdown. Swagger is bundled at `/api/docs`, the generated OpenAPI 3 contract at `/api/openapi.yaml`, and its source at `docs/openapi.yaml` (JSON syntax, valid YAML 1.2). Regenerate with `cd backend && go run ./cmd/openapi`.

## MCP discovery and connection addresses

Settings shows **Visual Nerve website**, an API documentation link on that website's domain, and a separate **MCP server URL for Codex**. The website's exact origin belongs in `--allowed-origin`. The MCP server runs on the user's computer; Codex connects to its HTTP(S) `/mcp`, while the browser connects to its WebSocket `/bridge`. The Codex URL is derived from the saved, validated local connection, preserving the hostname, port and TLS choice. Editing an unsaved connection does not change it. The public S3/CloudFront website serves app files and documentation, with no remote content API or MCP process.

`initialize` instructions and `tools/list` announce both native 2D and opt-in 3D. Start with the read-only tool `visual_nerve_api_docs`: `{}` or omitted arguments returns a compact command guide, `{"document":"openapi"}` returns the complete bundled OpenAPI, and `{"document":"all"}` returns both. This works without a connected browser and never reads workspace records. A separate web-documentation link is optional. Normal token/origin/loopback rules still apply.

The same documents are MCP resources: `visual-nerve://docs/guide` (`text/markdown`) and `visual-nerve://docs/openapi` (`application/yaml`), discoverable with `resources/list` and readable with `resources/read`. Unknown resource URIs return `-32002`; malformed/unknown arguments return `-32602`. A missing bundled OpenAPI produces a clear tool error or resource `-32603`.

Use `visual_nerve_request` for graph commands. HTTP documentation paths `/api/docs` and `/api/openapi.yaml` are not browser graph-command paths. For a requested 3D diagram, create through `POST /spatial-diagrams`, then populate its native nodes and edges. Keep the same readable 2D layout for view switching and PNG/PDF; discovering 3D support does not switch ordinary requests to 3D. **Instructions for Codex** in Settings provides a copyable setup note with these capabilities and addresses, excluding the integration token.

## CRUD and graph operations

| Method               | Route                  | Behavior                                                                             |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| GET                  | /health                | Static server, indexeddb storage, bridge enabled/connected and version               |
| GET / POST           | /diagrams              | List / create diagram                                                                |
| POST                 | /spatial-diagrams      | Create and open a 3D diagram; return complete Graph                                  |
| POST                 | /sql/preview           | Analyze SELECT/WITH or DDL locally; return graph/counts/warnings without saving      |
| POST                 | /sql/diagrams          | Analyze SQL, save transactionally and open the diagram; return complete Graph        |
| GET                  | /code/languages        | List all 50 language IDs, extensions and capabilities                                |
| POST                 | /code/preview          | Analyze source files locally; return structural graph/counts/warnings without saving |
| POST                 | /code/diagrams         | Save and open a code dependency diagram; write access required                       |
| POST                 | /diagram-files/preview | Preview draw.io XML or base64 Visio ZIP pages without saving; read-only allowed      |
| GET / PATCH / DELETE | /diagrams/{id}         | Complete canonical graph / diagram properties / cascading deletion                   |
| GET / POST           | /diagrams/{id}/nodes   | List / create node                                                                   |
| GET / PATCH / DELETE | /nodes/{id}            | Read / update / delete and detach children                                           |
| POST                 | /nodes/{id}/children   | Add child plus hierarchy edge and default position                                   |
| GET / POST           | /diagrams/{id}/edges   | List / create relationship                                                           |
| PATCH / DELETE       | /edges/{id}            | Update/reconnect / delete                                                            |
| GET / POST           | /owners                | List / create global owner                                                           |
| PATCH / DELETE       | /owners/{id}           | Update / remove owner; advance referencing diagram versions                          |
| POST                 | /diagrams/{id}/bulk    | Transactional population and external-ID upsert                                      |
| PUT                  | /diagrams/{id}/graph   | Atomic full graph replacement using baseVersion                                      |
| POST                 | /import                | JSON, Markdown, CSV or one selected draw.io/Visio page, one transaction              |
| POST                 | /export                | Complete JSON or semantic Markdown                                                   |
| GET                  | /search?q=...          | Global results with diagramId and optional nodeId                                    |
| GET                  | /workspace/export      | Complete IndexedDB workspace snapshot                                                |
| POST                 | /workspace/import      | Restore all workspace tables in one transaction                                      |

Creates return 201 and an entity (import returns Graph). Bulk/replacement return 200 and Graph. Deletes return 204. Errors are `{ "error": "message" }`: 400 malformed JSON, 401 token missing/wrong, 403 origin/host rejected, storage not accepted or read-only mutation denied, 404 missing entity, 409 stale version or duplicate identity, 422 validation 428 missing update version, 503 no connected browser and 504 browser timeout. No partially committed graph remains after validation fails. Requests are limited to 32 MiB. All integration requests with a configured VISUAL_NERVE_BRIDGE_TOKEN need `Authorization: Bearer TOKEN`.

## Versions and metadata

PATCH always includes the current entity `version`. `id`, `diagramId` and timestamps are immutable. Metadata PATCH merges keys; omitted keys are preserved, supplied keys replace values (including null). Full graph replacement uses `{ "baseVersion": 7, "graph": ... }`; the diagram's aggregate version changes on every graph mutation. Stale replacements return 409. Fetch again and choose how to reconcile; never blindly delete newer nodes. Tags and ownership arrays replace their previous values. `ownerIds` is canonical and permits multiple owners; `ownerId` alone assigns a single owner. If both are supplied, the array takes precedence and its first entry becomes the primary alias.

```sh
curl -X PATCH http://localhost:4317/api/v1/nodes/NODE_UUID \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"status":"done","metadata":{"crmStatus":"closed"}}'
```

## Idempotent population

UUID `id` is the local identity. `externalId` is an optional stable integration identity. Nodes and edges enforce `(diagramId, externalId)` uniqueness; owners enforce global external ID uniqueness. Bulk `upsert: true` updates only supplied properties of matching external IDs, merges metadata and preserves UUIDs/positions. Without upsert, duplicates fail the entire transaction. Optional entity versions or bulk `baseVersion` prevent stale integration writes; otherwise upsert deliberately applies the caller's supplied fields to the latest stored entity. Repeating the payload does not duplicate objects.

```json
{
  "upsert": true,
  "owners": [
    { "externalId": "engineering", "name": "Engineering", "kind": "team" }
  ],
  "nodes": [
    { "externalId": "idea", "title": "Idea", "nodeType": "start" },
    {
      "externalId": "build",
      "title": "Development",
      "ownerExternalId": "engineering"
    },
    { "externalId": "launch", "title": "Launch", "nodeType": "milestone" }
  ],
  "edges": [
    {
      "externalId": "idea-build",
      "sourceExternalId": "idea",
      "targetExternalId": "build"
    },
    {
      "externalId": "build-launch",
      "sourceExternalId": "build",
      "targetExternalId": "launch"
    }
  ]
}
```

Send to `POST /diagrams/DIAGRAM_UUID/bulk`. `parentExternalId` resolves a node hierarchy in the same transaction. Explicit UUID endpoint fields are also supported. Nodes without coordinates are placed on a spaced grid; `/children` uses a position near the parent. Unknown owners/endpoints, parent cycles, duplicate external IDs and invalid properties are rejected.

## Import/export

`POST /export` accepts `{ "diagramId": "UUID", "format": "json" }` or `markdown`. JSON returns the canonical exchange document. Markdown returns a JSON string; browser download uses text/markdown. PNG/PDF render locally in the editor with React Flow, html-to-image and jsPDF; the Go API does not pretend to rasterize the canvas.

`POST /import` accepts `{ "format": "json", "data": GRAPH_OBJECT }`, or `{ "format": "markdown", "data": "# Root\n## Child" }`, or CSV text. JSON remaps colliding IDs and their internal references together, preserving graph information. Owners with unchanged identity/content are reused. See [EXPORT_FORMAT.md](EXPORT_FORMAT.md) for exchange details. Dates must be valid `YYYY-MM-DD`; user URLs are absolute HTTP(S); entity IDs are UUIDs.

`POST /diagram-files/preview` accepts `{ "format": "drawio" | "vsdx", "data": "...", "name": "optional" }`. Draw.io data is XML text; Visio data is strict padded standard base64 ZIP bytes. It returns `DiagramImportResult` with `format`, `pages: [{id,name,graph,warnings}]` and file-level `warnings`, without saving or opening a project. This exact POST is allowed with Read only. IDs are source-page strings. Optional `name` is nonempty, at most 500 characters; unknown input fields are rejected.

For these two formats, `POST /import` accepts the same input plus optional `pageId` and saves/opens only the selected native page, returning Graph. Multipage files require a page ID from preview; omission or an unknown ID returns 422 with no partial writes. A one-page file may omit it. Creation requires Read + write; JSON/Markdown/CSV behavior is unchanged. Limits: 32 MiB decoded file, 64 MiB expanded, 2,048 ZIP entries, 100 pages, 20,000 total nodes, 40,000 total edges and hierarchy depth 256. Worker deadline is 30 seconds and preview/import transport is 45 seconds. JSON transport stays 32 MiB, so base64 `.vsdx` integration files must be below roughly 24 MiB, and escaped XML/preview responses must fit the envelope.

The imported page is an editable native approximation: recognized text, geometry, groups, relationships, basic colors and absolute HTTP(S) links. Advanced shapes, rotations and connector waypoints may be simplified with warnings. Source XML/ZIP is temporary; images, macros, scripts and external content are never fetched or executed. `.vsd` and `.vsdm` are unsupported. Access revocation cancels pending analysis and grants/acceptance are checked again before saving. See [diagram file import](docs/DIAGRAM_IMPORT.md).

## MCP

Visualize a SELECT or WITH query through the same browser worker as the SQL dialog:

```json
{
  "path": "/sql/preview",
  "method": "POST",
  "data": {
    "name": "Invoice flow",
    "sql": "SELECT b.bu_id, invoice_org.bu_name AS invoice_name FROM business b LEFT JOIN business invoice_org ON b.bu_send_bills_to = invoice_org.bu_id WHERE b.active = 1"
  }
}
```

The exact `POST /sql/preview` endpoint is available with Read only. It returns `SqlImportResult` (`graph`, warnings, schema counts and, for queries, `kind: "query"`, `queryCount`, `sourceCount`, `outputColumnCount`). It does not save or open a project. Review warnings and unresolved references before creating the diagram. Use `POST /sql/diagrams` with the same payload to save and open the graph; this requires Read + write. Both endpoints accept only `sql` and optional `name` (nonempty, at most 500 characters). They reject extra fields, unsupported paths, malformed queries and unsupported constructs without partial writes.

Query graphs retain scoped table aliases, derived tables/CTEs, joins with their conditions, ordered output aliases/expressions, column lineage and filters/grouping/order clauses. The same table under two aliases creates two source objects. They describe logical query structure; no SQL is executed, no database connection is made, and no returned rows or physical execution plan is available. Query expressions include literal values, so review JSON, Markdown and sharing previews for sensitive filters. Reserved version-1 metadata uses `sqlQuerySource`/`sqlQueryResult` on nodes and `sqlQueryRelationship` on edges; see [SQL import](docs/SQL_IMPORT.md) and [data model](DATA_MODEL.md).

Worker analysis is cancellable and times out after 30 seconds; SQL REST/MCP commands allow 45 seconds for analysis, validation and persistence. The decoded script limit is 50 MiB, but the existing local bridge's JSON request/response envelope is limited to 32 MiB. Keep integration scripts smaller when escaping or extracted expressions expand the payload. Revoking access or closing the workspace cancels pending SQL analysis; write grants and storage acceptance are rechecked before saving.

Create an empty 3D mind map through `visual_nerve_request`:

```json
{
  "path": "/spatial-diagrams",
  "method": "POST",
  "data": { "name": "Project overview", "type": "mindmap" }
}
```

The optional `type` selects an existing diagram type; the default is `mindmap`. The response is a canonical Graph with UUIDs and versions. Populate it with node creation or bulk external-ID upserts, then use versioned PATCH for edits. Any subject uses ordinary diagram objects and relationships: for example, an AI can create a Brain topic linked to topics for its parts and add explanations in descriptions or notes.

`metadata.spatial` accepts `{ "version": 1, "position": { "x": -2, "y": 0, "z": 1 } }`. Without explicit positions, the view preserves the displayed 2D placement and dimensions on one plane with shallow relief. +Y points up, +Z toward the front and −X toward the left. `diagram.settings.spatialView` stores `{ "version": 1, "mode": "3d" }` and optional `camera: { position: {x,y,z}, target: {x,y,z}, up?: {x,y,z} }`. The optional unit `up` vector preserves roll; omission uses +Y. Supply the complete reserved object when replacing it; other settings/metadata keys follow the existing patch contract.

Node coordinates must be finite and within ±1,000,000; camera coordinates allow ±10,000,000 to frame the diagram. Camera position must differ from target. An explicit `up` vector must have unit length and differ from the viewing axis. Unknown reserved keys are rejected transactionally. Keep node `x/y/width/height` readable for the 2D view and PNG/PDF export. Changing only explicit 3D coordinates preserves that 2D layout. Moving a node's displayed 2D geometry shifts an existing explicit 3D X/Y by the corresponding displacement while preserving Z and the placement offset; conversion uses the previous uniform relief scale. A new explicit X/Y/Z supplied in the same command takes precedence. This applies to editor commands and repository API writes, including PATCH, bulk upserts and graph replacement. Reserved fields and the exchange format remain version 1.

The 3D UI renders readable fronts and unmirrored backs from the same native 2D capture. Detailed faces are bounded at 120 logical cards, with each front/back pair sharing its texture, material and geometry. Its separate **Move objects** toggle moves the selected objects in world X/Y at retained depth; groups include descendants once. Release commits one undoable command and Escape cancels without partial writes. The **Move**, **Rotate** and **Scale** gizmo controls operate the camera. See [spatial diagrams](docs/SPATIAL_DIAGRAMS.md).

The same optional server exposes Streamable HTTP POST at `/mcp`. Supported protocol: 2025-06-18. Clients initialize, send notifications/initialized, then use tools/list or tools/call. The `visual_nerve_request` tool accepts:

```json
{
  "path": "/diagrams",
  "method": "POST",
  "data": { "name": "AI project", "type": "mindmap" }
}
```

Paths omit /api/v1. The tool's structuredContent contains status and body; isError reports failed commands. MCP dispatch follows MCP → WebSocket bridge → browser command repository → IndexedDB. It cannot access IndexedDB directly. The browser must remain open, and integration must be enabled on both sides.

When several distinct workspaces are connected, pass `workspaceId` to MCP or `X-Visual-Nerve-Workspace` to REST. The workspace ID is available under Settings → Storage details; each browser profile/origin owns its own identity. Multiple tabs for the same workspace share its IndexedDB and use transactional version checks.

## Public app and permissions

The public static site supplies no content API. Commands always target a user’s loopback bridge; public Swagger pages are read-only reference, while local Swagger can execute against its local origin. Read only permits GET, POST /export and exact POST /sql/preview, /code/preview or /diagram-files/preview, rejecting all mutations and permission escalation. Off closes the socket. Browser closure or disconnection returns 503 (MCP tools report isError), with no fallback storage. Both REST and MCP use the same browser repository.

Hosted apps require an exact --allowed-origin and may require trusted local TLS and browser local-network permission. The bridge rejects non-loopback listen addresses and remote client peers. See [deployment setup](docs/DEPLOYMENT.md#optional-local-mcp). /workspace/import uses Merge; destructive Replace and global deletion are separately confirmed actions in the browser UI. Backup schema/date and excluded local grants/consent are described in [EXPORT_FORMAT.md](EXPORT_FORMAT.md).

## Code dependency import

`GET /code/languages` discovers the supported IDs. Both `POST /code/preview` and `POST /code/diagrams` accept `{name?,files:[{path,content,language?}],mode?:"files"|"symbols",focus?}`. Paths are unique relative paths; ambiguous extensions need an explicit language ID. Focus is a case-insensitive path/name substring plus immediate related objects. Unknown fields, unknown IDs, duplicate paths and excessive input are rejected. Limits: 500 files, 5 MiB/file, 20 MiB total UTF-8, 10,000 symbols, 5,000 diagram objects and 10,000 connections; 100,000 lines/file, 500,000 lines/project, 20,000 characters/line; worker deadline 30 seconds. JSON transport remains 32 MiB.

Preview is permitted with read-only access and returns the graph plus language/mode/counts/warnings without saving or navigating. Create requires write access, rechecks persisted grants/consent after analysis, commits one transaction, then opens the canonical graph. Revoking access cancels analysis. The local source is never executed. Extracted identifiers, paths, lines and relationship evidence/confidence are saved; full source/comments/nonstructural literals are not. Syntax, heuristic and unresolved confidence must remain distinct. These are structural outlines, not complete compiler semantics or verified runtime call graphs. All language capabilities, caveats, example input and worker details are in [code import](docs/CODE_IMPORT.md).
