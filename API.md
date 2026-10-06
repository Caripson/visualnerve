# Optional local REST and MCP integration

IndexedDB in the browser is the only database. Start the static server with `--bridge`, open the app and explicitly choose Settings → MCP access → Read only or Read + write (default Off). REST and MCP forward commands over a local WebSocket to that browser. The browser applies IndexedDB transactions before replying. The Go server retains no application records; without a connected browser graph requests return 503.

Base: `http://localhost:4317/api/v1`. Responses and request bodies are JSON unless exporting Markdown. Swagger is bundled at `/api/docs`, the generated OpenAPI 3 contract at `/api/openapi.yaml`, and its source at `docs/openapi.yaml` (JSON syntax, valid YAML 1.2). Regenerate with `cd backend && go run ./cmd/openapi`.

## MCP discovery and connection addresses

Settings shows **Visual Nerve website**, an API documentation link on that website's domain, and a separate **MCP server URL for Codex**. The website's exact origin belongs in `--allowed-origin`. The MCP server runs on the user's computer; Codex connects to its HTTP(S) `/mcp`, while the browser connects to its WebSocket `/bridge`. The Codex URL is derived from the saved, validated local connection, preserving the hostname, port and TLS choice. Editing an unsaved connection does not change it. The public S3/CloudFront website serves app files and documentation, with no remote content API or MCP process.

`initialize` instructions and `tools/list` announce both native 2D and opt-in 3D. Start with the read-only tool `visual_nerve_api_docs`: `{}` or omitted arguments returns a compact command guide, `{"document":"openapi"}` returns the complete bundled OpenAPI, and `{"document":"all"}` returns both. This works without a connected browser and never reads workspace records. A separate web-documentation link is optional. Normal token/origin/loopback rules still apply.

The same documents are MCP resources: `visual-nerve://docs/guide` (`text/markdown`) and `visual-nerve://docs/openapi` (`application/yaml`), discoverable with `resources/list` and readable with `resources/read`. Unknown resource URIs return `-32002`; malformed/unknown arguments return `-32602`. A missing bundled OpenAPI produces a clear tool error or resource `-32603`.

Use `visual_nerve_request` for graph commands. HTTP documentation paths `/api/docs` and `/api/openapi.yaml` are not browser graph-command paths. For a requested 3D diagram, create through `POST /spatial-diagrams`, then populate its native nodes and edges. Keep the same readable 2D layout for view switching and PNG/PDF; discovering 3D support does not switch ordinary requests to 3D. **Instructions for Codex** in Settings provides a copyable setup note with these capabilities and addresses, excluding the integration token.

## CRUD and graph operations

| Method               | Route                          | Behavior                                                                                          |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| GET                  | /health                        | Static server, indexeddb storage, bridge enabled/connected and version                            |
| GET / POST           | /diagrams                      | List / create diagram                                                                             |
| POST                 | /spatial-diagrams              | Create and open a 3D diagram; return complete Graph                                               |
| POST                 | /sql/preview                   | Analyze SELECT/WITH or DDL locally; return graph/counts/warnings without saving                   |
| POST                 | /sql/diagrams                  | Analyze SQL, save transactionally and open the diagram; return complete Graph                     |
| GET                  | /code/languages                | List all 50 language IDs, extensions and capabilities                                             |
| POST                 | /code/preview                  | Analyze source files locally; return structural graph/counts/warnings without saving              |
| POST                 | /code/diagrams                 | Save and open a code dependency diagram; write access required                                    |
| POST                 | /diagram-files/preview         | Preview draw.io XML or base64 Visio ZIP pages without saving; read-only allowed                   |
| GET / PATCH / DELETE | /diagrams/{id}                 | Complete canonical graph / diagram properties / cascading deletion                                |
| GET / POST           | /diagrams/{id}/nodes           | List / create node                                                                                |
| GET / PATCH / DELETE | /nodes/{id}                    | Read / update / delete and detach children                                                        |
| POST                 | /nodes/{id}/children           | Add child plus hierarchy edge and default position                                                |
| GET / POST           | /diagrams/{id}/edges           | List / create relationship                                                                        |
| PATCH / DELETE       | /edges/{id}                    | Update/reconnect / delete                                                                         |
| GET / POST           | /owners                        | List / create global owner                                                                        |
| PATCH / DELETE       | /owners/{id}                   | Update / remove owner; advance referencing diagram versions                                       |
| POST                 | /diagrams/{id}/bulk            | Transactional population and external-ID upsert                                                   |
| PUT                  | /diagrams/{id}/graph           | Atomic full graph replacement using baseVersion                                                   |
| POST                 | /import                        | JSON, Markdown, CSV or one selected draw.io/Visio page, one transaction                           |
| POST                 | /export                        | Complete JSON or semantic Markdown                                                                |
| GET                  | /search?q=...                  | Global results with diagramId and optional nodeId                                                 |
| GET                  | /workspace/export              | Complete IndexedDB workspace snapshot                                                             |
| POST                 | /workspace/import              | Restore all workspace tables in one transaction                                                   |
| GET                  | /settings/import-file-limit-mb | Read the effective local import limit; missing/invalid stored values return 50; read-only allowed |
| PUT                  | /settings/import-file-limit-mb | Save this browser’s import limit as an integer from 50 to 1024 MiB; write access required         |

Creates return 201 and an entity (import returns Graph). Bulk/replacement return 200 and Graph. Deletes return 204. Errors are `{ "error": "message" }`: 400 malformed JSON, 401 token missing/wrong, 403 origin/host rejected, storage not accepted or read-only mutation denied, 404 missing entity, 409 stale version or duplicate identity, 422 validation 428 missing update version, 503 no connected browser and 504 browser timeout. No partially committed graph remains after validation fails. Requests are limited to 32 MiB. All integration requests with a configured VISUAL_NERVE_BRIDGE_TOKEN need `Authorization: Bearer TOKEN`.

## Local import size preference

All local file imports use a default limit of 50 MiB. **Settings → Import file size → Maximum import file size (MB)** accepts a whole number from 50 to 1024; choose **Save import limit** to apply it. UI MB means MiB, and UI 1 GB means 1024 MiB (the absolute 1 GiB ceiling). Only imports up to 50 MB are supported and guaranteed. Larger imports are experimental and may be slow or fail because of browser memory or format limits; the UI shows a warning. Count, structure and analysis deadlines still apply.

`PUT /settings/import-file-limit-mb` accepts exactly `{ "value": 100 }`, with an integer `value` from 50 through 1024. It requires **Read + write**, returns 200 on success, and invalid values return 422. The preference is local to the connected browser, excluded from backup and ignored during Merge/Replace; the destination keeps its own value. An absent or invalid stored preference uses 50. Source-analysis requests retain their existing payloads and do not accept a caller-supplied limit override; the browser captures its saved preference when starting analysis.

The HTTP JSON and WebSocket request/response envelopes remain **32 MiB**. Increasing the local import preference does not raise these transport limits. Escaping, base64 and response graph size can require smaller integration inputs than the selected local file limit.

`GET /settings/import-file-limit-mb` permits **Read only** and returns the effective limit as a JSON integer from 50 through 1024. An absent or invalid saved value returns 50.

## Numbered diagram presentations

The ordered presentation is canonical graph content at `diagram.settings.presentation`:

```json
{
  "version": 1,
  "nodeIds": ["EXISTING_NODE_UUID", "ANOTHER_EXISTING_NODE_UUID"],
  "secondsPerNode": 8,
  "transitionMs": 1200
}
```

Array position is the contiguous presentation number starting at 1. IDs must be unique UUIDs referencing existing nodes in that diagram; the maximum sequence is 20,000 nodes. `secondsPerNode` is a finite number from 2 through 600; `transitionMs` is from 0 through 10,000. Unknown fields are rejected. Without saved presentation settings, `GET /diagrams/{diagramId}/presentation` returns an empty `nodeIds` array with version 1, 8 seconds per node and 1200 ms transitions.

`PUT /diagrams/{diagramId}/presentation` accepts exactly `{ "baseVersion": 7, "presentation": { ... } }`. It validates the whole definition and commits one graph transaction; success returns the complete Graph, invalid input returns 422, and a stale `baseVersion` returns 409 with no partial changes. Deleting numbered nodes removes their entries and closes gaps. JSON export and workspace backup retain the definition. Diagram import or duplication remaps colliding node IDs together with the presentation order. Clipboard copies begin unnumbered; the original sequence stays intact.

Playback is transient state in the connected browser, using its current 2D or 3D view:

| Method    | Route                          | Body and result                                                                      |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| GET       | `/presentation`                | Current playback state, including while closed                                       |
| POST      | `/presentation/open`           | Exact `{}` for the current diagram, or `{ "diagramId": "UUID" }`                     |
| POST      | `/presentation/play`           | Exact `{}`                                                                           |
| POST      | `/presentation/pause`          | Exact `{}`                                                                           |
| POST      | `/presentation/rewind`         | Exact `{}`                                                                           |
| POST      | `/presentation/forward`        | Exact `{}`                                                                           |
| POST      | `/presentation/close`          | Exact `{}`                                                                           |
| POST      | `/presentation/preload`        | Exact `{}`; explicitly prepare upcoming speech                                       |
| PATCH     | `/presentation`                | At least one of boolean `audio`, `subtitles`, `preload`; no other keys               |
| GET       | `/presentation/voices`         | `{defaultVoiceId,voices:[{id,label,language,sampleRate,modelBytes,license,source}]}` |
| GET / PUT | `/settings/presentation-voice` | Read selected voice; PUT exact `{ "value": "VOICE_ID" }`                             |

Runtime commands return `{open,diagramId,status,index,total,nodeId,audio,subtitles,preload,buffered,progress,message}`. `diagramId` and `nodeId` may be null. `index` is zero-based, or -1 for an empty sequence; `progress` is from 0 to 1 and `buffered` counts prepared speech clips. Status is `idle`, `loading`, `moving`, `playing`, `paused`, `ended` or `error`. All runtime POST/PATCH commands require accepted local storage and **Read + write**, including navigation and preloading; GET permits **Read only**. They do not rewrite the saved sequence or node geometry.

Audio and preload default to false, subtitles to true. Voice IDs are `en_US-ljspeech-high` (default), `en_GB-cori-high` and `sv_SE-nst-medium`. Voice selection is a browser-local setting. Speech is generated locally; enabling speech or explicit preloading can download model assets. Discover the model sizes, licenses and sources through the voice catalog. Runtime state, generated audio and playback progress are not graph data. See [MCP presentation workflow](docs/MCP.md).

### Walkthrough video export

Video export renders the entire saved numbered sequence from its first node in the current 2D or 3D view, at fixed 1280 × 720 and 30 fps. It uses the saved transition and dwell timings and lets narration finish before advancing. Long subtitle descriptions use pages; a node's dwell extends to at least 3 seconds per subtitle page. The graph and saved sequence are unchanged. Keep the browser tab visible; manual camera interaction, diagram edits or closing the player cancel the export.

| Method | Route                 | Body and result                                                                                         |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| GET    | `/presentation/video` | Current transient video export state; **Read only** is sufficient                                       |
| POST   | `/presentation/video` | Exact optional boolean `audio` and `subtitles`, including `{}`; starts asynchronously and returns state |
| DELETE | `/presentation/video` | Exact `{}`; cancels the active export and returns state                                                 |

Omitted POST options use the current player options, initially audio off and subtitles on. POST can start while the player is closed; it opens the player for progress. POST and DELETE require accepted local storage and **Read + write**. Unknown fields, nulls and nonboolean options return 422.

Starting another export or using competing player controls returns 409 while export or cancellation cleanup is active. GET state remains available. `POST /presentation/close` with exact `{}` cancels export and closes the player.

All three routes return `{status,progress,nodeIndex,total,format,message,fileName}`. Status is `idle`, `preparing`, `exporting`, `complete`, `cancelled` or `error`; progress is from 0 to 1, `nodeIndex` is zero-based or -1 before a node is active, and `total` is the sequence length. `format` is `mp4`, `webm` or null; `fileName` is null until available. MP4 is preferred. WebM is a fallback only when the browser supports the requested video and optional audio codecs; narration is never silently omitted. Completion downloads the file in the connected browser; **Save video again** can repeat that download. REST and MCP return state only, without video bytes.

Narration WAVs are synthesized locally and inserted into the exported timeline offline. Export does not require a screen picker, screen recording permission, audible playback or an audio playback gesture. Explicit export with audio can download the selected voice assets. The generated file is limited to **256 MiB**, and the final timeline, including camera movement and completed narration, to **30 minutes**. Native 2D rendering supports at most **5,000 visible cards per frame** and a **128 MiB card texture cache**. 3D export requires a complete visible projection, supporting up to **8,000 objects and 16,000 relationships**; a truncated projection fails explicitly. Exceeding limits or lacking the required codec produces an explicit error; objects, video and narration are never silently omitted or truncated. Temporary frame/audio/video buffers are not stored in IndexedDB or workspace backups.

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

For these two formats, `POST /import` accepts the same input plus optional `pageId` and saves/opens only the selected native page, returning Graph. Multipage files require a page ID from preview; omission or an unknown ID returns 422 with no partial writes. A one-page file may omit it. Creation requires Read + write; JSON/Markdown/CSV payloads are unchanged. The decoded file uses the selected local limit (default 50 MiB, maximum 1 GiB). Expanded data is capped at `min(1 GiB, max(100 MiB, 2 × selected file limit))`, default 100 MiB. Other limits remain 2,048 ZIP entries, 100 pages, 20,000 total nodes, 40,000 total edges and hierarchy depth 256. Worker deadline is 30 seconds and preview/import transport is 45 seconds. JSON transport stays 32 MiB, so base64 `.vsdx` integration files must be below roughly 24 MiB, and escaped XML/preview responses must fit the envelope.

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

Worker analysis is cancellable and times out after 30 seconds; SQL REST/MCP commands allow 45 seconds for analysis, validation and persistence. The decoded script uses the selected local limit (default 50 MiB, maximum 1 GiB), while the local bridge’s JSON/WebSocket request/response envelopes remain 32 MiB. Keep integration scripts smaller when escaping or extracted expressions expand the payload. Revoking access or closing the workspace cancels pending SQL analysis; write grants and storage acceptance are rechecked before saving.

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

`GET /code/languages` discovers the supported IDs. Both `POST /code/preview` and `POST /code/diagrams` accept `{name?,files:[{path,content,language?}],mode?:"files"|"symbols",focus?}`. Paths are unique relative paths; ambiguous extensions need an explicit language ID. Focus is a case-insensitive path/name substring plus immediate related objects. Unknown fields, unknown IDs, duplicate paths and excessive input are rejected. Code applies the selected local decoded UTF-8 limit both per file and to the total project (50 MiB each by default, maximum 1 GiB each). Other limits remain 500 files, 10,000 symbols, 5,000 diagram objects and 10,000 connections; 100,000 lines/file, 500,000 lines/project, 20,000 characters/line; worker deadline 30 seconds. JSON transport remains 32 MiB.

Preview is permitted with read-only access and returns the graph plus language/mode/counts/warnings without saving or navigating. Create requires write access, rechecks persisted grants/consent after analysis, commits one transaction, then opens the canonical graph. Revoking access cancels analysis. The local source is never executed. Extracted identifiers, paths, lines and relationship evidence/confidence are saved; full source/comments/nonstructural literals are not. Syntax, heuristic and unresolved confidence must remain distinct. These are structural outlines, not complete compiler semantics or verified runtime call graphs. All language capabilities, caveats, example input and worker details are in [code import](docs/CODE_IMPORT.md).
