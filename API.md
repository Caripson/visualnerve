# Optional local REST and MCP integration

The public website has its product home at `/`; its existing `/app/` workspace remains accessible for user-controlled transfer. The isolated encrypted app package opens the workspace at `https://app.visualnerve.com/`, with `/app/` as a same-origin compatibility entry. IndexedDB is origin-bound: these workspaces are separate and are never silently moved or synchronized. API/MCP command paths remain the same; configure the exact app origin when starting the local bridge.

IndexedDB in the browser is the only database. Start the static server with `--bridge`, open the app and explicitly choose Settings → MCP access → Read only or Read + write (default Off). REST and MCP forward commands over a local WebSocket to that browser. The browser applies IndexedDB transactions before replying. The Go server retains no application records; without a connected browser graph requests return 503.

Saved access and local connection changes apply to the open workspace without reloading the page. While access remains enabled, temporary connection failures retry every three seconds, including a browser's temporary rejection when opening the local WebSocket. Invalid addresses remain errors until corrected. Turning access Off closes the socket and cancels retries; origin, certificate, local-network permission and configured token requirements remain unchanged.

Base: `http://localhost:4317/api/v1`. Request bodies and responses use JSON, including Markdown and SVG exports, which return their text as JSON strings. Swagger is bundled at `/api/docs`, the generated OpenAPI 3 contract at `/api/openapi.yaml`, and its source at `docs/openapi.yaml` (JSON syntax, valid YAML 1.2). Regenerate with `cd backend && go run ./cmd/openapi`.

## MCP discovery and connection addresses

Process Simulator is a first-class `process-simulator` diagram type with a separate `graph.simulation` schema version 1. Discover `GET /simulation/capabilities`; read/edit its semantic topology, particle types, shared resources, scaling, improvements, economics and scenarios through `/diagrams/{id}/simulation`. Seeded worker runs under `.../simulation/runs` have asynchronous IDs and expose actual state, metrics, queues, events, replay and results. Exact `POST .../simulation/compare` permits Read only; model/run mutations require Read + write. UI, API and MCP share one model and engine. Headless/MAX needs no canvas or animation but still needs a connected browser. See [Process Simulator](docs/PROCESS_SIMULATOR.md) for routes, examples, units and retention; complete schemas are discoverable through MCP.

Run summaries include `scenarioName` and `currency` from each run's captured model, so later scenario renames/deletions or currency edits do not relabel saved results. Comparison returns the common captured `currency`; unlike currencies return structured 422 `SIMULATION_CURRENCY_MISMATCH` rather than inventing an exchange rate.

An incompatible process topology edit detaches the captured run's canvas overlay. UI-origin active runs stop with their actual partial result retained; API/MCP-origin runs continue without the canvas. Historical state/results and replay remain available by run ID against the captured model.

Local autosaves and API writes to existing documents share the workspace save queue. Late camera-only edits preserve their camera position on a successful API commit. Concurrent semantic edits remain available as a visible conflict instead of silently overwriting either change. Versioned requests still require the current `baseVersion`; after a stale-version 409, read the latest graph before retrying.

External commands recheck the current access grant after queue waits and before document writes. If saving an access downgrade fails, the running Workspace retains the lower local access level until an explicit access choice saves successfully. That restriction survives unrelated refreshes in the current Workspace; a failed preference write does not persist the choice across reloads.

Simulation entity PATCH uses JSON Merge Patch: nested objects merge, arrays replace, and `null` removes an optional property. Null markers inside scenario overrides are retained so inherited Baseline properties can be removed across save/export/reload. Complete model/configuration PUT remains strict, and every effective scenario is validated before execution.

Hierarchical subprocesses are an additive schema version 1 capability, discovered as `hierarchical-processes` and `process-drilldown`. A model may contain `processes:[{id,name,description?,parentId?}]`; a real node's optional `processId` assigns direct membership. Omitted processes means an empty hierarchy for existing diagrams. The same engine and global shared-resource pools constrain every scope; folded process cards add no processing time, capacity or costs.

| Method               | Route under `/diagrams/{id}/simulation` | Meaning                                                                                                |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET                  | `/hierarchy`                            | `{rootProcessIds,processes}` with immediate `childProcessIds`, `directNodeIds` and recursive `nodeIds` |
| GET / POST           | `/processes`                            | Read scopes / create with `{baseVersion,value}`                                                        |
| GET / PATCH / DELETE | `/processes/{entityId}`                 | Read / merge-patch with `{baseVersion,value}` / delete with `?baseVersion=N`                           |
| GET                  | `/runs/{runId}/processes`               | Actual process metrics map from the selected immutable run                                             |
| GET                  | `/runs/{runId}/processes/{entityId}`    | Scoped queue, throughput, utilization, bottlenecks and economics                                       |
| GET                  | `/runs/{runId}/queues`                  | Includes `processes` alongside node and resource queue maps                                            |

Process IDs are semantic strings; node IDs returned by hierarchy are canonical saved IDs. Every scope includes descendant nodes. Parent and child rollups overlap and must not be summed, and distributions are built from actual scope observations rather than adding node quantiles. `completed` counts successful scope visits, `exited` their boundary-exit subset, and `terminalCompleted` final successful outcomes inside the scope. Scoped `cycleTime` measures entry to exit/outcome; scoped `ttr` measures entry to a revenue-producing terminal outcome. Shared-resource `resourceCostAllocation:"occupied-units"` assigns consumed resource cost only; idle capacity, resource-pool scaling and pool investments remain whole-system overhead. Whole-system metrics remain authoritative for profitability.

Referenced process deletion returns structured 422 with `code:"SIMULATION_PROCESS_REFERENCED"`. Reparent children and reassign member nodes together in a versioned full-model PUT before removing the scope. Cycles and dangling references fail validation without partial writes. `scenarios[].overrides.processes` and node membership overrides use the same validated merge-patch semantics. The bundled **Delivery network** template is discoverable through `GET /templates`; applying its complete semantic model reproduces the same nested assumptions in UI/API/MCP. `POST /diagrams` keeps its kiosk default for compatibility. See [the MCP hierarchy examples](docs/MCP.md#inspect-and-control-hierarchical-processes).

Live 2D capacity uses separate full native cards such as Counter 1/2/3, with anonymous unit labels and occupancy derived from actual aggregate state. In the full flow, the original primary card edits the saved logical object; additional capacity cards and compact hierarchy placements are read-only projections. `visualCapacity` discovery describes the eight-card bank and 256-additional-card view bounds with explicit aggregation. API/MCP edits target the shared semantic ID; the projection adds no persistent business identities or simulation nodes. 3D retains the logical model.

The compact phone/landscape UI changes presentation only. Simulation details and section selectors configure the same semantic properties and run controls through the existing authoritative model; no mobile-only simulation configuration or API is introduced. See [mobile use](docs/MOBILE.md).

Settings shows **Visual Nerve website**, an API documentation link on that website's domain, and a separate **MCP server URL**. The website's exact origin belongs in `--allowed-origin`. The MCP server runs on the user's computer; An MCP client connects to its HTTP(S) `/mcp`, while the browser connects to its WebSocket `/bridge`. The MCP URL is derived from the saved, validated local connection, preserving the hostname, port and TLS choice. Editing an unsaved connection does not change it. The public S3/CloudFront website serves app files and documentation, with no remote content API or MCP process.

`initialize` instructions and `tools/list` announce both native 2D and opt-in 3D. Start with the read-only tool `visual_nerve_api_docs`: `{}` or omitted arguments returns a compact command guide, `{"document":"openapi"}` returns the complete bundled OpenAPI, and `{"document":"all"}` returns both. This works without a connected browser and never reads workspace records. A separate web-documentation link is optional. Normal token/origin/loopback rules still apply.

The same documents are MCP resources: `visual-nerve://docs/guide` (`text/markdown`) and `visual-nerve://docs/openapi` (`application/yaml`), discoverable with `resources/list` and readable with `resources/read`. Unknown resource URIs return `-32002`; malformed/unknown arguments return `-32602`. A missing bundled OpenAPI produces a clear tool error or resource `-32603`.

Use `visual_nerve_request` for graph commands. HTTP documentation paths `/api/docs` and `/api/openapi.yaml` are not browser graph-command paths. For a requested 3D diagram, create through `POST /spatial-diagrams`, then populate its native nodes and edges. Keep the same readable 2D layout for view switching and PNG/PDF; discovering 3D support does not switch ordinary requests to 3D. **Instructions for your MCP client** in Settings provides a copyable setup note with these capabilities and addresses, excluding the integration token.

## Encrypted workspace security

UI, REST and MCP use the same encrypted storage and revocable browser session. A human creates or unlocks the app workspace in the browser; agents never receive its password or recovery key. After each unlock, integration access starts **Off** until the human selects a fresh **Read only** or **Read + write** grant.

| Method | Route                 | Behavior                                                                                                                         |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/workspace/security` | Safe versioned status for the actual connected backend, including an already retained locked control connection                  |
| POST   | `/workspace/lock`     | Empty object or no arguments; current Read + write grant required while unlocked; save pending edits and lock the shared session |

Security discovery returns `type: "workspace-security"`, `schemaVersion: 1`, `mode: "encrypted"` or `"legacy"`, `state`, `storage: "indexeddb"`, `logicalSchemaVersion`, `requiresHumanUnlock`, `programmaticUnlock: false`, `programmaticLock`, `requestsRenewIdleTimeout: false` and `contentRequiresUnlock`. The encrypted backend also returns `vaultSchemaVersion: 1` and `cipher: "AES-256-GCM"`. Logical workspace schema 8 and physical vault schema 1 are independent. `uninitialized` describes this session, not proof that no vault is saved. The response contains no records, vault ID, keys, salts, credentials, expiration timestamps or grants; it does not grant content access.

An authorized, already-open socket may remain as restricted control after locking. Content commands then return **423** with `{ "error": "…", "code": "WORKSPACE_LOCKED" }`. A fresh locked page never connects, and a closed control connection never reconnects while locked; unavailable/disconnected browsers return **503**. Explicit Off closes the socket. Unlock in the browser, grant access again, and submit a fresh command. Locking cancels originating jobs and responses even if another session subsequently unlocks. API/MCP traffic, simulations and audio do not renew the human inactivity timer.

`POST /workspace/lock` waits for pending saves and rechecks the grant. Save failure does not silently discard edits. Concurrent grant or saved-data changes return **409** without revoking the current session; inspect state before issuing a fresh request. An already-locked retained control connection returns idempotent safe status without another revocation. Read-only access cannot lock an unlocked workspace. No password, recovery, unlock or session-policy endpoint exists; `/settings/vault-*` writes are rejected. Static MCP documentation discovery requires no connected or unlocked browser.

Authorized content requests and ordinary diagram exports return readable semantic information. `GET /workspace/export` is a readable `WorkspaceBackup`, not the encrypted backup downloaded through the browser UI. Downloaded encrypted backups keep their own credentials after live password changes; even content-key rotation cannot recall old copies. Full origin transfer is a separate, verified human workflow that preserves the source. See [workspace security and transfer](hugo/content/help/settings.md#workspace-security), [the storage schema](docs/ENCRYPTED_WORKSPACE_SCHEMA.md) and [MCP permissions](docs/MCP.md#encrypted-workspace-security).

## CRUD and graph operations

| Method               | Route                               | Behavior                                                                                          |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET                  | /health                             | Static server, indexeddb storage, bridge enabled/connected and version                            |
| GET / POST           | /diagrams                           | List / create diagram                                                                             |
| POST                 | /spatial-diagrams                   | Create and open a 3D diagram; return complete Graph                                               |
| POST                 | /sql/preview                        | Analyze SELECT/WITH or DDL locally; return graph/counts/warnings without saving                   |
| POST                 | /sql/diagrams                       | Analyze SQL, save transactionally and open the diagram; return complete Graph                     |
| GET                  | /code/languages                     | List 50 code language IDs plus Markdown, extensions and capabilities                              |
| GET                  | /code/capabilities                  | Discover independent source-file, archive, byte, graph and analysis limits                        |
| POST                 | /code/preview                       | Analyze source files locally; return structural graph/counts/warnings without saving              |
| POST                 | /code/project/preview               | Scan base64 ZIP and preview file/folder relationships; no save                                    |
| POST                 | /code/project/diagrams              | Save/open the same project analysis with write access                                             |
| POST                 | /code/diagrams                      | Save and open a code dependency diagram; write access required                                    |
| POST                 | /diagram-files/preview              | Preview draw.io XML or base64 Visio ZIP pages without saving; read-only allowed                   |
| GET / PATCH / DELETE | /diagrams/{id}                      | Complete canonical graph / diagram properties / cascading deletion                                |
| GET / POST           | /diagrams/{id}/nodes                | List / create node                                                                                |
| GET / PATCH / DELETE | /nodes/{id}                         | Read / update / delete and detach children                                                        |
| POST                 | /nodes/{id}/children                | Add child plus hierarchy edge and default position                                                |
| GET / POST           | /diagrams/{id}/edges                | List / create relationship                                                                        |
| PATCH / DELETE       | /edges/{id}                         | Update/reconnect / delete                                                                         |
| GET / POST           | /owners                             | List / create global owner                                                                        |
| PATCH / DELETE       | /owners/{id}                        | Update / remove owner; advance referencing diagram versions                                       |
| POST                 | /diagrams/{id}/bulk                 | Transactional population and external-ID upsert                                                   |
| PUT                  | /diagrams/{id}/graph                | Atomic full graph replacement using baseVersion                                                   |
| POST                 | /import                             | JSON, Markdown, CSV or one selected draw.io/Visio page, one transaction                           |
| POST                 | /export                             | Complete JSON, semantic Markdown or native vector SVG                                             |
| GET                  | /search?q=...                       | Global results with diagramId and optional nodeId                                                 |
| GET                  | /workspace/export                   | Complete IndexedDB workspace snapshot                                                             |
| POST                 | /workspace/import                   | Restore all workspace tables in one transaction                                                   |
| GET                  | /settings/import-file-limit-mb      | Read the effective local import limit; missing/invalid stored values return 50; read-only allowed |
| PUT                  | /settings/import-file-limit-mb      | Save this browser’s import limit as an integer from 50 to 1024 MiB; write access required         |
| GET                  | /settings/project-source-file-limit | Read the effective ZIP source-file limit, default 500; read-only allowed                          |
| PUT                  | /settings/project-source-file-limit | Save this browser's ZIP source-file limit from 500 to 10,000; write access required               |

Creates return 201 and an entity (import returns Graph). Bulk/replacement return 200 and Graph. Deletes return 204. Errors retain `{ "error": "message" }` and may add structured `code`/`issues`: 400 malformed JSON, 401 token missing/wrong, 403 origin/host rejected, storage not accepted or read-only mutation denied, 404 missing entity, 423 locked workspace, 409 stale version or duplicate identity, 413 local history capacity/quota, 422 validation, 428 missing update version, 503 no connected browser and 504 browser timeout. No partially committed graph remains after validation fails. Requests are limited to 32 MiB. All integration requests with a configured VISUAL_NERVE_BRIDGE_TOKEN need `Authorization: Bearer TOKEN`.

## Local import size preference

All local file imports use a default limit of 50 MiB. **Settings → Import file size → Maximum import file size (MB)** accepts a whole number from 50 to 1024; choose **Save import limit** to apply it. UI MB means MiB, and UI 1 GB means 1024 MiB (the absolute 1 GiB ceiling). Only imports up to 50 MB are supported and guaranteed. Larger imports are experimental and may be slow or fail because of browser memory or format limits; the UI shows a warning. Count, structure and analysis deadlines still apply.

`PUT /settings/import-file-limit-mb` accepts exactly `{ "value": 100 }`, with an integer `value` from 50 through 1024. It requires **Read + write**, returns 200 on success, and invalid values return 422. The preference is local to the connected browser, excluded from backup and ignored during Merge/Replace; the destination keeps its own value. An absent or invalid stored preference uses 50. Source-analysis requests retain their existing payloads and do not accept a caller-supplied limit override; the browser captures its saved preference when starting analysis.

The HTTP JSON and WebSocket request/response envelopes remain **32 MiB**. Increasing the local import preference does not raise these transport limits. Escaping, base64 and response graph size can require smaller integration inputs than the selected local file limit.

`GET /settings/import-file-limit-mb` permits **Read only** and returns the effective limit as a JSON integer from 50 through 1024. An absent or invalid saved value returns 50.

## ZIP project source-file preference

`GET /settings/project-source-file-limit` returns this browser's effective integer count, defaulting to 500 for missing/invalid saved values. Read only access is allowed. `PUT` on the same path accepts only `{ "value": 1000 }`, requires Read + write, and validates whole numbers from 500 through 10,000 (422 for invalid input). `GET /code/capabilities` discovers this setting's name/default/minimum/maximum separately from the byte budget and unchanged archive-entry/graph/symbol/connection/line/time limits.

Only ZIP projects with up to 500 analyzed source files are supported and guaranteed. Higher limits are experimental and may be slow or fail. The browser captures the authoritative saved count once per ZIP job; source payloads cannot override it. Preview and saved `codeAnalysis.project.sourceFileLimit` expose that captured budget. Non-ZIP source/folder imports remain limited to 500 files. The archive's 10,000 total entries include ignored files and directory records, so fewer source files may fit. Prefer folders mode for larger projects; file overview still cannot exceed 5,000 diagram objects. The preference is excluded from backups and ignored during Merge/Replace, preserving the destination's setting. Existing larger diagrams remain valid after resetting it to 500.

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

| Method    | Route                          | Body and result                                                                                                            |
| --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| GET       | `/presentation`                | Current playback state, including while closed                                                                             |
| POST      | `/presentation/open`           | Optional `diagramId`; `source` is `"nodes"` or `"storyboard"` (default `"nodes"`)                                          |
| POST      | `/presentation/play`           | Exact `{}`                                                                                                                 |
| POST      | `/presentation/pause`          | Exact `{}`                                                                                                                 |
| POST      | `/presentation/rewind`         | Exact `{}`                                                                                                                 |
| POST      | `/presentation/forward`        | Exact `{}`                                                                                                                 |
| POST      | `/presentation/close`          | Exact `{}`                                                                                                                 |
| POST      | `/presentation/preload`        | Exact `{}`; explicitly prepare every step, starting at the first                                                           |
| PATCH     | `/presentation`                | At least one of boolean `audio`, `subtitles`, `preload`, `minimized`; no other keys                                        |
| GET       | `/presentation/voices`         | `{defaultVoiceId,voices:[{id,label,language,locale,quality,speakerCount,speakerId,sampleRate,modelBytes,license,source}]}` |
| GET / PUT | `/settings/presentation-voice` | Read selected voice; PUT exact `{ "value": "VOICE_ID" }`                                                                   |

Runtime commands return `{open,diagramId,status,index,total,nodeId,audio,subtitles,preload,minimized,buffered,progress,message,source,sceneId,nodeIds,edgeIds,title,narration}`. `diagramId` and `nodeId` may be null. `index` is zero-based, or -1 for an empty sequence; `progress` is from 0 to 1 and `buffered` counts unique prepared nonblank speech clips; blank or duplicate narration still counts toward step readiness. Status is `idle`, `loading`, `moving`, `playing`, `paused`, `ended` or `error`. All runtime POST/PATCH commands require accepted local storage and **Read + write**, including navigation and preloading; GET permits **Read only**. They do not rewrite the saved sequence or node geometry.

`minimized` reflects the same panel state used by **Minimize player** and **Expand player** in the UI. Opening defaults to expanded on desktop and minimized in compact layouts. `PATCH /presentation` with `{ "minimized": true }` minimizes the controls, and `{ "minimized": false }` expands them, including during playback. Neither changes playback status, audio or subtitle options. Video-style captions appear separately over the diagram when subtitles are enabled, so minimizing controls keeps narration text visible in 2D and 3D. Panel state is transient and excluded from the saved presentation, export and backup. The video-export input remains unchanged. See the [player guide](docs/PRESENTATION.md).

Audio and preload default to false, subtitles to true. Discover all 20 supported voice IDs through GET `/presentation/voices`; `en_GB-alan-medium` remains default. The catalog includes several US/UK choices plus Swedish, French, Spanish, Portuguese, Norwegian, Danish, Finnish and German, with actual medium/high tier, locale and fixed-speaker metadata. Existing IDs remain valid; no high+ tier is invented. Voice selection is a browser-local setting, editable with a preview in Settings → Presentation voice. Explicit saved choices remain selected when the default changes. Speech is generated locally; enabling speech or explicit preloading can download model assets. Discover the model sizes, licenses and sources through the voice catalog. GET `/presentation` exposes preload `progress` from 0 to 1, with overall percentage, ready narration count and the actual download/synthesis phase in `message`. Initialization is indeterminate; 100% means all required narration for every step in the selected numbered sequence or storyboard are ready, starting from its first step regardless of the cursor. Prepared clips use a 32 MiB RAM cache and encrypted temporary local spill capped at 1 GiB of ciphertext, including IV/tag overhead, subject to browser quota. One clip during synthesis/decryption can temporarily add up to 32 MiB beyond the prepared cache; this is not a bound on total browser or inference memory. Clips are discarded on close, voice/content change or workspace lock and excluded from backups. Runtime state, generated audio and playback progress are not graph data. See [MCP presentation workflow](docs/MCP.md).

### Walkthrough video export

Video export renders the entire selected numbered sequence or storyboard from its first step in the current 2D or 3D view, at fixed 1280 × 720 and 30 fps. It uses the saved transition and dwell timings and lets narration finish before advancing. Long subtitle descriptions use pages; a node's dwell extends to at least 3 seconds per subtitle page. The graph and saved sequence are unchanged. Keep the browser tab visible; manual camera interaction, diagram edits or closing the player cancel the export.

| Method | Route                 | Body and result                                                   |
| ------ | --------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/presentation/video` | Current transient video export state; **Read only** is sufficient |
| POST   | `/presentation/video` | Exact optional boolean `audio`/`subtitles` and `source:"nodes"    | "storyboard"`, including `{}`; starts asynchronously and returns state |
| DELETE | `/presentation/video` | Exact `{}`; cancels the active export and returns state           |

Omitted POST options use the current player options and source, initially audio off and subtitles on. POST can start while the player is closed; it opens the player for progress. POST and DELETE require accepted local storage and **Read + write**. Unknown fields, nulls and nonboolean options return 422.

Starting another export or using competing player controls returns 409 while export or cancellation cleanup is active. GET state remains available. `POST /presentation/close` with exact `{}` cancels export and closes the player.

All three routes return `{status,progress,nodeIndex,total,format,message,fileName,source}`. Status is `idle`, `preparing`, `exporting`, `complete`, `cancelled` or `error`; progress is from 0 to 1, `nodeIndex` is zero-based or -1 before a node is active, and `total` is the sequence length. `format` is `mp4`, `webm` or null; `fileName` is null until available. MP4 is preferred. WebM is a fallback only when the browser supports the requested video and optional audio codecs; narration is never silently omitted. Completion downloads the file in the connected browser; **Save video again** can repeat that download. REST and MCP return state only, without video bytes.

Narration WAVs are synthesized locally and inserted into the exported timeline offline. Export does not require a screen picker, screen recording permission, audible playback or an audio playback gesture. Explicit export with audio can download the selected voice assets. The generated file is limited to **256 MiB**, and the final timeline, including camera movement and completed narration, to **30 minutes**. Native 2D rendering supports at most **5,000 visible cards per frame** and a **128 MiB card texture cache**. 3D export requires a complete visible projection, supporting up to **8,000 objects and 16,000 relationships**; a truncated projection fails explicitly. Exceeding limits or lacking the required codec produces an explicit error; objects, video and narration are never silently omitted or truncated. Temporary frame/audio/video buffers are not stored in IndexedDB or workspace backups.

## Overview, questions, history, scenes and app specifications

All routes below use the same browser-local canonical graph and are discoverable through `visual_nerve_api_docs`. Read [understanding workflows](docs/UNDERSTANDING.md) for exact nested definitions, privacy and capacity bounds; the generated OpenAPI contains complete schemas.

| Method       | Route                                                    | Contract                                                                                                                                   |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET / PUT    | `/diagrams/{id}/overview`                                | Read config / save exact `{baseVersion,overview}`                                                                                          |
| GET          | `/diagrams/{id}/overview/projection?zoom=0.1`            | View-only summaries, typed directed aggregates and original-ID mappings; zoom `(0,10]`                                                     |
| POST         | `/diagrams/{id}/questions`                               | Read-only `{startId,kind,targetId?,maxDepth?,edgeTypes?,includeHidden?,includeUncertain?,offset?,limit?}`; `kind` downstream/upstream/path |
| GET          | `/diagrams/{id}/evidence?nodeId=UUID`                    | Retained source metadata; adding `metricId` explicitly requests paged original CSV measure cells                                           |
| GET / POST   | `/diagrams/{id}/history`                                 | List / save named snapshot with exact `{baseVersion,name}`                                                                                 |
| GET / DELETE | `/diagrams/{id}/history/{snapshotId}`                    | Read / delete archive, preserving current work                                                                                             |
| GET          | `/diagrams/{id}/history/{snapshotId}/compare?to=current` | Semantic diff with modeled affected dependencies; `to` may be another snapshot UUID                                                        |
| POST         | `/diagrams/{id}/history/{snapshotId}/restore`            | Exact `{baseVersion}`; atomic safety copy then restore, stale version 409                                                                  |
| GET / PUT    | `/diagrams/{id}/storyboard`                              | Read / save exact `{baseVersion,storyboard}`                                                                                               |
| POST         | `/presentation/seek`                                     | Exact `{index}`; zero-based existing step, previews paused                                                                                 |
| GET / PUT    | `/diagrams/{id}/build-specification`                     | Read / save reviewed additions and answers using exact `{baseVersion,specification}`                                                       |
| POST         | `/diagrams/{id}/build-brief`                             | Read-only optional `{scope,selectedIds,instructions}`; full unsent brief and structured specification                                      |

Question paths follow modeled directions, exclude unarrowed associations, handle cycles and label uncertainty; they do not establish runtime impact. Traversal is bounded at 50,000 objects, 200,000 relationships and depth 64, with pages up to 100 answers. Compact overview shows at most 2,000 cards without removing original content. Summary IDs cannot be patched as graph UUIDs.

History is separate from Undo/Redo and autosave. Explicit snapshots and pre-refresh/pre-restore checkpoints retain old source rows locally; full workspace backups include them. Limits are 50 versions per diagram, 1,000 per workspace, 256 MiB archives and 32 MiB per structural graph. Capacity errors never evict named snapshots automatically. Restore preserves exact saved coordinates and IDs; shared owner profiles stay current. Diff counts remain complete while detailed lists expose truncation.

Storyboard scenes store `{id,name,nodeIds,edgeIds,narration,seconds,transitionMs,view?}`. A saved view requires its matching current mode and **Details** (semantic overview off); otherwise preview/playback/video returns 422. Choose **Details** or omit `view` to **Auto-fit objects** in either mode, including overview. Open using `{diagramId?,source:"storyboard"}` and optionally export using `{source:"storyboard",audio?,subtitles?}`. The existing numbering workflow stays available with source `nodes`. Source content, layout and node descriptions are preserved.

The app brief labels observed source facts and proposed behavior separately and counts unresolved decisions. It does not include original CSV rows, send to Lovable or create an external app. Both exact question and brief POST routes permit Read only without advancing graph versions. Other writes require Read + write and current `baseVersion`. Transport limits remain 32 MiB, even for backups and archived graph reads.

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

`POST /export` accepts `{ "diagramId": "UUID", "format": "json" | "markdown" | "svg" }` with Read only access. JSON returns the canonical exchange document. Markdown and SVG return a JSON string; save SVG text as an `.svg` file with MIME `image/svg+xml`. SVG adds optional `scope: "complete" | "viewport" | "selected"` (default `complete`). Selected scope requires `nodeIds` with 1–20,000 unique existing node UUIDs; other scopes reject `nodeIds`, and area options are rejected for JSON/Markdown. Unknown formats/options return 422. Rendering never opens or changes the diagram.

SVG uses the canonical 2D layout, including native vector text, shapes, icons, connections, arrow markers and visible pen strokes, even when the UI is in 3D. Viewport uses saved 2D pan/zoom and the current browser canvas size, or fits the diagram when no usable saved viewport exists. Fonts are referenced by name rather than embedded; shadows and CSS decoration may be simplified. The XML contains no images, `foreignObject`, scripts or active external links. PNG/PDF render locally in the editor with React Flow, html-to-image and jsPDF and remain UI downloads.

SVG limits are 100,000 rendered elements, 250,000 source text characters, 16 MiB of XML and 16,777,216 pixels per dimension; larger exports fail explicitly and should use selected scope. Clipped text can remain readable in XML, so review the source before sharing. Illegal XML controls and unpaired surrogates are replaced with U+FFFD.

`POST /import` accepts `{ "format": "json", "data": GRAPH_OBJECT }`, or `{ "format": "markdown", "data": "# Root\n## Child" }`, or CSV text. JSON remaps colliding IDs and their internal references together, preserving graph information. Owners with unchanged identity/content are reused. See [EXPORT_FORMAT.md](EXPORT_FORMAT.md) for exchange details. Dates must be valid `YYYY-MM-DD`; user URLs are absolute HTTP(S); entity IDs are UUIDs.

Native graph imports and entity mutations validate tags as arrays of strings, metadata as objects, and optional text fields as strings. Malformed values return 422 before persistence; an invalid import or mutation leaves existing diagrams unchanged. Custom metadata keys and their nested values remain supported.

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

The same optional server exposes Streamable HTTP POST at `/mcp`. Initialize negotiates `2025-03-26`, `2025-06-18` or `2025-11-25`; supported requests retain their version, otherwise the server offers the latest supported version. Clients initialize with `protocolVersion`, `capabilities` and `clientInfo` (name and version), send `notifications/initialized`, then use `tools/list`, `tools/call` or resources. Subsequent HTTP calls send the negotiated `MCP-Protocol-Version`; unsupported headers return 400. Missing headers use the backward-compatible `2025-03-26` subset. This stateless JSON server offers no SSE stream (GET returns 405), deprecated HTTP+SSE endpoint or server-initiated requests. The `visual_nerve_request` tool accepts:

```json
{
  "path": "/diagrams",
  "method": "POST",
  "data": { "name": "AI project", "type": "mindmap" }
}
```

Paths omit /api/v1. The tool's structuredContent contains status and body; isError reports failed commands. MCP dispatch follows MCP → WebSocket bridge → browser command repository → IndexedDB. It cannot access IndexedDB directly. The browser must remain open, and integration must be enabled on both sides.

All standard clients use the same tools and grants. Codex, Cursor, Claude Code and Gemini CLI can use HTTP; local stdio clients such as Claude Desktop can launch `visual-nerve --mcp-stdio` to forward to an already-running bridge. This creates no separate command engine. `--mcp-url` selects its exact loopback HTTP(S) endpoint and preserves system TLS verification. Use `VISUAL_NERVE_BRIDGE_TOKEN` in the adapter environment if authentication is configured. Stdout is protocol-only; frames are bounded to 32 MiB, with eight active and eight pending requests. Saturation terminates the adapter, and EOF cancels pending transport work. Interrupted mutations have an unknown outcome and are never automatically retried. [Client configuration and transport details](docs/MCP.md#client-transports-and-port-selection).

Visual Nerve defaults to dedicated port **4317**, shared by `/mcp`, browser `/bridge` and REST. If occupied, startup fails with instructions; no automatic fallback occurs. A custom `--addr 127.0.0.1:4318` needs matching saved browser WebSocket and HTTP client URLs; stdio takes `--mcp-url http://127.0.0.1:4318/mcp`.

When several distinct workspaces are connected, pass `workspaceId` to MCP or `X-Visual-Nerve-Workspace` to REST. The workspace ID is available under Settings → Storage details; each browser profile/origin owns its own identity. Multiple tabs for the same workspace share its IndexedDB and use transactional version checks.

On the isolated encrypted app, the deployed Content Security Policy also restricts browser bridge connections to explicitly approved ports. A custom port must be included in that app build and its response-header policy; changing Settings alone cannot override it. The reviewed default is 4317.

## Public app and permissions

The public static site supplies no content API. Commands always target a user’s loopback bridge; public Swagger pages are read-only reference, while local Swagger can execute against its local origin. Read only permits GET and exact POST /export, /sql/preview, /code/preview, /code/project/preview and /diagram-files/preview, plus /diagrams/{id}/questions, /diagrams/{id}/build-brief and /diagrams/{id}/simulation/compare. Other mutations and permission escalation are rejected. Off closes the socket. Browser closure or disconnection returns 503 (MCP tools report isError), with no fallback storage. Both REST and MCP use the same browser repository.

Hosted apps require an exact --allowed-origin and may require trusted local TLS and browser local-network permission. The bridge rejects non-loopback listen addresses and remote client peers. See [deployment setup](docs/DEPLOYMENT.md#optional-local-mcp). /workspace/import uses Merge; destructive Replace and global deletion are separately confirmed actions in the browser UI. Backup schema/date and excluded local grants/consent are described in [EXPORT_FORMAT.md](EXPORT_FORMAT.md).

## Code dependency import

`GET /code/languages` discovers the supported IDs. Both `POST /code/preview` and `POST /code/diagrams` accept `{name?,files:[{path,content,language?}],mode?:"files"|"symbols"|"folders",focus?}`. When `mode` is omitted, one file uses `"symbols"` (declarations and dependencies), while multiple files use `"files"` (project overview). Explicit choices are preserved; preview and saved `diagram.metadata.codeAnalysis.mode` return the resolved detail level. Existing saved diagrams are unchanged. Paths are unique relative paths; filename/shebang/content identify languages conservatively; inconclusive extensions need an explicit language ID. Focus is a case-insensitive path/name substring plus immediate related objects. Unknown fields, unknown IDs, duplicate paths and excessive input are rejected. Code applies the selected local decoded UTF-8 limit both per file and to the total project (50 MiB each by default, maximum 1 GiB each). Other limits remain 500 files, 10,000 symbols, 5,000 diagram objects and 10,000 connections; 100,000 lines/file, 500,000 lines/project, 20,000 characters/line; worker deadline 30 seconds. JSON transport remains 32 MiB.

ZIP project routes `POST /code/project/preview` and `/code/project/diagrams` accept strict `{data,name?,mode?,focus?,languages?}` with base64 ZIP bytes (no data-URL prefix), defaulting to files. Scan runs for at most 120 seconds, then shared code analysis runs for at most 30 seconds; these exact bridge routes allow 165 seconds. Archive limits, exclusions, provenance, Markdown behavior and an MCP example are documented in [ZIP import](docs/CODE_IMPORT.md#import-a-complete-project-archive). Compressed and all verified expanded bytes each fit the selected budget; base64 plus envelope metadata must fit 32 MiB (less than approximately 24 MiB compressed). Folder nodes expose `metadata.projectDirectory`; aggregated relations expose `occurrences`.

Preview is permitted with read-only access and returns the graph plus language/mode/counts/warnings without saving or navigating. Create requires write access, rechecks persisted grants/consent after analysis, commits one transaction, then opens the canonical graph. Revoking access cancels analysis. The local source is never executed. Extracted identifiers, paths, lines and relationship evidence/confidence are saved; full source/comments/nonstructural literals are not. Syntax, heuristic and unresolved confidence must remain distinct. These are structural outlines, not complete compiler semantics or verified runtime call graphs. All language capabilities, caveats, example input and worker details are in [code import](docs/CODE_IMPORT.md).

In the live 2D editor, code cards wrap names/paths and scroll through all retained summary entries, with visible corner resize handles when selected. File summaries still retain at most the first 200 recognized declaration names; use `mode:"symbols"` for individual declarations. Scroll position is transient. 3D faces and PNG/PDF/video exports show the top of each card at its saved size; enlarge it in 2D to include more details. JSON retains the complete recognized metadata.

Size is ordinary node geometry, available through the existing API/MCP contract. After `GET /nodes/{nodeId}`, send `PATCH /nodes/{nodeId}` with the current node `version` and, for example, `{"version":7,"width":480,"height":640}`; use the version just read, and include `x`/`y` to reposition. A geometry-only patch preserves code metadata and relationships. `POST /diagrams/{diagramId}/bulk` can resize multiple nodes using `upsert:true`, current diagram `baseVersion` and matching `externalId` values. Bulk upsert matches external IDs, not UUIDs; imported code nodes initially have no external IDs and can be resized directly with node PATCH. These writes require Read + write and return the saved canonical entity/graph. No code-specific resize endpoint or schema is added.

ZIP API language overrides use `languages:{"src/header.h":"c"}` with exact retained paths after wrapping-folder removal. Unknown/excluded paths and unsupported IDs are rejected. Preview again with these overrides if detection is inconclusive, matching the UI language selectors.
