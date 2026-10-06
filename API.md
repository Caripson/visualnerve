# Optional local REST and MCP integration

IndexedDB in the browser is the only database. Start the static server with `--bridge`, open the app and explicitly choose Settings → MCP access → Read only or Read + write (default Off). REST and MCP forward commands over a local WebSocket to that browser. The browser applies IndexedDB transactions before replying. The Go server retains no application records; without a connected browser graph requests return 503.

Base: `http://localhost:4317/api/v1`. Responses and request bodies are JSON unless exporting Markdown. Swagger is bundled at `/api/docs`, the generated OpenAPI 3 contract at `/api/openapi.yaml`, and its source at `docs/openapi.yaml` (JSON syntax, valid YAML 1.2). Regenerate with `cd backend && go run ./cmd/openapi`.

## CRUD and graph operations

| Method | Route | Behavior |
| --- | --- | --- |
| GET | /health | Static server, indexeddb storage, bridge enabled/connected and version |
| GET / POST | /diagrams | List / create diagram |
| POST | /spatial-diagrams | Create and open a 3D diagram; return complete Graph |
| GET / PATCH / DELETE | /diagrams/{id} | Complete canonical graph / diagram properties / cascading deletion |
| GET / POST | /diagrams/{id}/nodes | List / create node |
| GET / PATCH / DELETE | /nodes/{id} | Read / update / delete and detach children |
| POST | /nodes/{id}/children | Add child plus hierarchy edge and default position |
| GET / POST | /diagrams/{id}/edges | List / create relationship |
| PATCH / DELETE | /edges/{id} | Update/reconnect / delete |
| GET / POST | /owners | List / create global owner |
| PATCH / DELETE | /owners/{id} | Update / remove owner; advance referencing diagram versions |
| POST | /diagrams/{id}/bulk | Transactional population and external-ID upsert |
| PUT | /diagrams/{id}/graph | Atomic full graph replacement using baseVersion |
| POST | /import | JSON, Markdown or CSV, one transaction |
| POST | /export | Complete JSON or semantic Markdown |
| GET | /search?q=... | Global results with diagramId and optional nodeId |
| GET | /workspace/export | Complete IndexedDB workspace snapshot |
| POST | /workspace/import | Restore all workspace tables in one transaction |

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
  "owners": [{"externalId":"engineering","name":"Engineering","kind":"team"}],
  "nodes": [
    {"externalId":"idea","title":"Idea","nodeType":"start"},
    {"externalId":"build","title":"Development","ownerExternalId":"engineering"},
    {"externalId":"launch","title":"Launch","nodeType":"milestone"}
  ],
  "edges": [
    {"externalId":"idea-build","sourceExternalId":"idea","targetExternalId":"build"},
    {"externalId":"build-launch","sourceExternalId":"build","targetExternalId":"launch"}
  ]
}
```

Send to `POST /diagrams/DIAGRAM_UUID/bulk`. `parentExternalId` resolves a node hierarchy in the same transaction. Explicit UUID endpoint fields are also supported. Nodes without coordinates are placed on a spaced grid; `/children` uses a position near the parent. Unknown owners/endpoints, parent cycles, duplicate external IDs and invalid properties are rejected.

## Import/export

`POST /export` accepts `{ "diagramId": "UUID", "format": "json" }` or `markdown`. JSON returns the canonical exchange document. Markdown returns a JSON string; browser download uses text/markdown. PNG/PDF render locally in the editor with React Flow, html-to-image and jsPDF; the Go API does not pretend to rasterize the canvas.

`POST /import` accepts `{ "format": "json", "data": GRAPH_OBJECT }`, or `{ "format": "markdown", "data": "# Root\n## Child" }`, or CSV text. JSON remaps colliding IDs and their internal references together, preserving graph information. Owners with unchanged identity/content are reused. See [EXPORT_FORMAT.md](EXPORT_FORMAT.md) for exchange details. Dates must be valid `YYYY-MM-DD`; user URLs are absolute HTTP(S); entity IDs are UUIDs.

## MCP

Create an empty 3D mind map through `visual_nerve_request`:

```json
{"path":"/spatial-diagrams","method":"POST","data":{"name":"Project overview","type":"mindmap"}}
```

The optional `type` selects an existing diagram type; the default is `mindmap`. The response is a canonical Graph with UUIDs and versions. Populate it with node creation or bulk external-ID upserts, then use versioned PATCH for edits. Any subject uses ordinary diagram objects and relationships: for example, an AI can create a Brain topic linked to topics for its parts and add explanations in descriptions or notes.

`metadata.spatial` accepts `{ "version": 1, "position": { "x": -2, "y": 0, "z": 1 } }`. Without explicit positions, the view preserves the displayed 2D placement and dimensions on one plane with shallow relief. +Y points up, +Z toward the front and −X toward the left. `diagram.settings.spatialView` stores `{ "version": 1, "mode": "3d" }` and optional `camera: { position: {x,y,z}, target: {x,y,z}, up?: {x,y,z} }`. The optional unit `up` vector preserves roll; omission uses +Y. Supply the complete reserved object when replacing it; other settings/metadata keys follow the existing patch contract.

Node coordinates must be finite and within ±1,000,000; camera coordinates allow ±10,000,000 to frame the diagram. Camera position must differ from target. An explicit `up` vector must have unit length and differ from the viewing axis. Unknown reserved keys are rejected transactionally. Keep node `x/y/width/height` readable for the 2D view and PNG/PDF export. See [spatial diagrams](docs/SPATIAL_DIAGRAMS.md).

The same optional server exposes Streamable HTTP POST at `/mcp`. Supported protocol: 2025-06-18. Clients initialize, send notifications/initialized, then use tools/list or tools/call. The `visual_nerve_request` tool accepts:

```json
{"path":"/diagrams","method":"POST","data":{"name":"AI project","type":"mindmap"}}
```

Paths omit /api/v1. The tool's structuredContent contains status and body; isError reports failed commands. MCP dispatch follows MCP → WebSocket bridge → browser command repository → IndexedDB. It cannot access IndexedDB directly. The browser must remain open, and integration must be enabled on both sides.

When several distinct workspaces are connected, pass `workspaceId` to MCP or `X-Visual-Nerve-Workspace` to REST. The workspace ID is available under Settings → Storage details; each browser profile/origin owns its own identity. Multiple tabs for the same workspace share its IndexedDB and use transactional version checks.

## Public app and permissions

The public static site supplies no content API. Commands always target a user’s loopback bridge; public Swagger pages are read-only reference, while local Swagger can execute against its local origin. Read only permits GET and POST /export, rejecting all mutations and permission escalation. Off closes the socket. Browser closure or disconnection returns 503 (MCP tools report isError), with no fallback storage. Both REST and MCP use the same browser repository.

Hosted apps require an exact --allowed-origin and may require trusted local TLS and browser local-network permission. The bridge rejects non-loopback listen addresses and remote client peers. See [deployment setup](docs/DEPLOYMENT.md#optional-local-mcp). /workspace/import uses Merge; destructive Replace and global deletion are separately confirmed actions in the browser UI. Backup schema/date and excluded local grants/consent are described in [EXPORT_FORMAT.md](EXPORT_FORMAT.md).
