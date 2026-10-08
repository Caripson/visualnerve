package server

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"unicode/utf8"
)

const (
	mcpGuideURI   = "visual-nerve://docs/guide"
	mcpOpenAPIURI = "visual-nerve://docs/openapi"
)

const mcpAPIGuide = `# Visual Nerve API guide

## Discover the contract through MCP

Start with visual_nerve_api_docs with {} (or omit arguments) for this compact guide. When detailed command fields or schemas are needed, request {"document":"openapi"} for the complete bundled OpenAPI contract or {"document":"all"} for both documents. The same content is available through resources/read at visual-nerve://docs/guide and visual-nerve://docs/openapi. Documentation discovery is read-only, requires no connected browser, and never reads workspace records. The OpenAPI document is read from this server's bundled openapi.yaml; no external fetch is performed.

Call visual_nerve_request for workspace commands only. Paths omit /api/v1, for example {"path":"/diagrams","method":"GET"}. /api/docs and /api/openapi.yaml are HTTP documentation routes, not browser graph commands; do not send them to visual_nerve_request.

The browser editor is at /app/ on the website origin; / is the public product home. Keep /app/ open with local storage accepted and MCP access enabled in Settings. Existing diagrams use the same origin's IndexedDB across this route change. REST /api/v1 and MCP POST /mcp keep their existing endpoints; the public GET /mcp/ page is setup documentation, not the local MCP endpoint. Allowed origins omit /app/ and all other paths.

## Encrypted workspace boundary

GET /workspace/security returns safe versioned metadata from the connected browser: type:workspace-security, schemaVersion:1, mode:encrypted|legacy, state, logicalSchemaVersion, optional vaultSchemaVersion:1 and cipher:AES-256-GCM, requiresHumanUnlock, programmaticUnlock:false, programmaticLock, requestsRenewIdleTimeout:false and contentRequiresUnlock. It reads no private records and exposes no vault IDs, keys, salts, credentials, expiry timestamps or grants. Existing legacy browser workspaces are explicitly identified rather than silently claimed to be encrypted. Static bridge GET /api/v1/health reports connectivity; it cannot infer the browser lock state.

The dedicated encrypted app surface requires human password setup/unlock in the browser. The UI, API and MCP use the same revocable storage session. Connected locked content requests return 423 with code WORKSPACE_LOCKED; disconnected/unavailable workspaces return 503. Lock cancels jobs and invalidates originating requests, even after a later unlock. API/MCP requests do not renew idle timeout. After each encrypted-session unlock access starts Off; the human must choose a fresh Read only or Read + write grant in Settings before submitting a new request. No password, recovery, unlock or session-policy control endpoint is provided, and /settings/vault-* writes are rejected. Never send a password or recovery key to an agent. Documentation discovery remains available without a connected/unlocked browser; this safe status endpoint still needs a browser connection.

Only a previously authorized open socket is retained as restricted control when locked. A cold locked page never connects, connection loss remains503, and explicit Off closes the transport. POST /workspace/lock accepts an empty object or no arguments and requires a fresh Read + write grant while unlocked. It waits for pending saves and rechecks authorization before locking; failed saves are not silently discarded. A durable revision fence rejects concurrent grant or saved-data changes with 409 without invalidating local keys; inspect current state before a fresh request. It returns safe status after intentional revocation. Already-locked retained control returns idempotent local status without revoking again. After unlock, that old connection cannot lock or receive content until the human gives a fresh grant. The bridge prefers a content-enabled peer when tabs share a workspace, without retrying dispatched writes.

Encryption protects persisted records while locked, not content intentionally released to an authorized client. API/MCP reads, diagram exports and GET /workspace/export return readable semantic information. The browser's encrypted backup download is a separate user action; restore it through the browser, not a programmatic password endpoint. Changing the live workspace password does not update downloaded backup files: old copies retain their own password/recovery credentials. The local architecture has no mandatory backend or SSO, and makes no compliance/certification guarantee.

## Process Simulator

Process Simulator is its own document type, process-simulator, with graph.simulation={type:"process-simulator",schemaVersion:1,...}. GET /simulation/capabilities discovers model units, operations and retention limits. Create through POST /diagrams with {name,type:"process-simulator"}; GET /diagrams includes these documents. GET /diagrams/{diagramId}/simulation returns the complete semantic topology, particle types, resource requirements, queues, scaling, improvements, economics and scenarios. PUT the exact {baseVersion,model} replaces it atomically. Semantic CRUD for processes, nodes, edges, particle-types, resources, improvements and scenarios is under that same simulation route; POST/PATCH use {baseVersion,value}, and DELETE uses ?baseVersion=N. Node/edge changes update the native canvas in the same transaction. Read exact schemas before editing. No business semantics are inferred from canvas coordinates.

GET /templates lists browser-local {id,name,builtin,graph} records; GET /templates/{id} reads one. The UI's Process Simulator template has id process-simulator-blank and a valid empty graph.simulation, ready for guided setup. Kiosk + package pickup has the preserved id process-simulator and explicit demo assumptions/scenarios. POST /diagrams with type:"process-simulator" retains the kiosk default for compatibility. To build from zero, create the document, then PUT its /simulation with current baseVersion and either the empty template's complete graph.simulation or your own full model. An empty model still requires type, schemaVersion, currency, defaults and all six arrays: nodes, edges, particleTypes, resources, improvements and scenarios. Add a particle type, Source, Work and Outcome plus flow edges before running. Alternatively, replace the entire connected model in one atomic PUT. Use canonical IDs returned by the save when editing persisted entries and the updated diagram.version for the next baseVersion; new readable node/edge IDs may be normalized to UUIDs with their aliases retained as externalId.

Guided setup, UI connected-node additions and API/MCP changes use that same semantic document; no wizard-specific shadow model or run endpoint exists. To insert a step between existing nodes programmatically, update both the node and its redirected edges together through complete-model PUT. Shared-resource requirements belong to Work nodes; their dashed resource cards/connectors are derived from these references, not particle routes. The guided starter models five actual transfer seconds per flow connection and connected-node additions use three; choose travelSeconds explicitly for your business process. Zero means instant transfer, rather than a decorative animation delay.

POST /diagrams/{diagramId}/simulation/runs with {seed,durationSeconds,scenarioId?,demandMultiplier?,speed?:1|10|100|"max",animated?} starts an asynchronous local worker run with immutable model/scenario inputs and returns an identifiable run ID. Poll GET .../runs/{runId}, /state, /result or /metrics. State contains real queues, utilization, capacity and aggregate economics. GET .../runs/{runId}/nodes/{nodeId}, /resources/{resourceId}, /bottlenecks and /events?offset=0&limit=100 exposes semantic details and bounded event pages. POST pause/resume/stop/reset uses exact {}; POST seek uses {timeSeconds} and reconstructs replay state from deterministic input, not saved animation frames. Exact POST /diagrams/{diagramId}/simulation/compare with {runIds:[...]} compares whole-system effects and incremental payback without changing Baseline. Repeated headless runs with demandMultiplier 1.0,1.1,... remain separately identifiable.

Live traffic is a read-only visualization of the run state: green means clear flow, yellow indicates high current occupancy or a building queue, and red marks actual congested queues, shared-resource blocking or failed processing. Ready models without a run are neutral. Incoming flow colors follow the target queue; labels and queue counts provide the same information without relying on color. Inspect node currentUtilization, queue.current, status and each resource's waitingNodeIds for the source values; utilization is the cumulative run average and may differ from present occupancy. Moving particles represent real transit between departedAtSeconds and arrivesAtSeconds on their semantic edgeId. Rendering samples/aggregates large populations, while metrics cover all work. Visual queue and capacity projections do not create extra persistent process nodes.

The UI, REST and MCP use one simulation engine and one browser-local model, including shared resources used by competing Work nodes. All model changes and run controls require accepted storage and Read + write; GET and exact comparison permit Read only. Same input, seed, scenario and duration produce the same deterministic result at every playback speed. Headless/MAX runs require no selected diagram, visible canvas or animation loop, but the browser must stay connected for IndexedDB and Web Worker execution. Closing the browser returns 503; the Go server stores no application state and does not run a second simulation. Models/scenarios survive native JSON export and workspace backup. Completed work, event samples and replay checkpoints are retained with explicit bounds; population metrics cover every simulated particle.

Live 2D scaling displays separate full native capacity cards, such as Counter 1/2/3. GET /simulation/capabilities exposes visualCapacity.primaryEditable:true for the full flow's original primary card, additionalCardsReadOnly:true and compactHierarchyReadOnly:true for temporary projections, plus sharedLogicalModel, eight cards per bank and 256 additional cards across the view, with explicitly labelled aggregate overflow. The deprecated readOnly:true compatibility flag applies only to additional capacity cards and compact hierarchy projections. Moving, resizing or editing the original primary card updates the saved logical object. These anonymous units share one semantic Work/Resource ID; they are not persisted employee identities or independent simulation nodes. Actual aggregate busy capacity drives occupancy indicators, and each bank has one shared queue. Inspect/change the logical model and live metrics, rather than treating additional presentation card IDs as writable entities. 3D retains the logical model; the full live banks and particles are in 2D.

### Hierarchical processes and drilldown

Capabilities advertise hierarchical-processes and process-drilldown with hierarchy metadata: processes[].parentId and nodes[].processId. model.processes is optional in schemaVersion 1; omission means no hierarchy and preserves older documents. Each process is {id,name,description?,parentId?}; IDs are stable semantic strings and parentId references an existing process. Assign each real source/work/router/resource/outcome node to its direct scope with processId. Nested scopes aggregate their descendants without introducing a second engine, new workers, processing time or charges. Shared resources remain the same global pools across every process.

GET /diagrams/{diagramId}/simulation/processes reads scopes; POST /processes and PATCH /processes/{entityId} use {baseVersion,value}. GET /diagrams/{diagramId}/simulation/hierarchy returns {rootProcessIds,processes:[{id,name,parentId?,description?,childProcessIds,nodeIds,directNodeIds}]}. Children and directNodeIds are immediate; nodeIds includes all descendants and uses canonical semantic node IDs. This is the actual model hierarchy, not inferred canvas grouping. Process cards and folded boundary connectors are UI projections and must not be created as extra simulation nodes. DELETE /processes/{entityId}?baseVersion=N returns structured 422 with code SIMULATION_PROCESS_REFERENCED while nodes or children still reference the scope. Reparent children and reassign member nodes together through complete-model PUT, then remove the scope atomically. Cycles and dangling process references are rejected without partial writes. Scenario overrides.processes and node processId patches use the same validated JSON Merge Patch semantics, preserving Baseline.

GET .../simulation/runs/{runId}/processes returns the full process metrics map; /processes/{entityId} reads a single live scope. /queues includes node, resource and process maps. Each process includes actual recursive nodeIds, childProcessIds, resourceIds/resourceUsage, entered, completed, exited, terminalCompleted, inSystem, abandoned, failed, throughputPerHour, queue, utilization/currentUtilization, status, currentBottleneck, ranked bottlenecks and economic fields. completed counts successful scope visits, including exits and terminal outcomes; terminalCompleted counts final successful outcomes in this scope. Re-entry is a new visit. cycleTime uses scope-entry-to-successful-exit/outcome timestamps; scoped ttr uses scope-entry-to-revenue-producing terminal outcome timestamps. These differ deliberately from whole-system creation-to-completion metrics.

Parent and child rollups overlap: do not sum them. Queue/wait/processing/cycle/TTR distributions are computed from real scope observations, never by adding node quantiles. resourceCostAllocation is occupied-units: scopes receive only costs of shared units actually consumed by their Work nodes. Idle pool capacity, pool scaling and pool investment overhead remains in whole-system metrics; scoped economics need not sum to the global result. The whole-system metrics and final resource capacities remain authoritative for profitability and scenario comparison. The Delivery network example is discoverable through GET /templates; POST /diagrams preserves the kiosk default. Read its template graph.simulation and replace the created model atomically to reproduce its persisted nested assumptions.

## Present the diagram in numbered order

GET /diagrams/{diagramId}/presentation reads {version:1,nodeIds,secondsPerNode,transitionMs}; absent sequences return [] with 8 seconds per node and 1200 ms transitions. PUT this endpoint with exact {baseVersion,presentation} to save a sequence of unique existing node UUIDs (maximum 20,000), secondsPerNode 2..600 and transitionMs 0..10000. Success returns Graph; stale baseVersion returns 409. The canonical sequence lives in diagram.settings.presentation and survives export, backup and diagram duplication with remapped node IDs. Clipboard copies begin unnumbered.

GET /presentation reads the connected browser's transient playback state, even when closed. POST /presentation/open takes optional diagramId and source:"nodes"|"storyboard" (default "nodes"). POST /presentation/seek takes exact {index} to preview an existing zero-based step paused. POST /presentation/play, /pause, /rewind, /forward, /close and /preload take exact {}. PATCH /presentation accepts at least one of boolean audio, subtitles, preload and minimized, with no other fields. GET /presentation exposes minimized as the same transient panel state shown in the UI. Minimize or expand controls during playback without pausing; canvas captions stay independent of the panel and follow subtitles. Opening defaults to expanded on desktop and minimized in compact layouts; this state is not saved in the diagram. All runtime mutations, including camera navigation and preloading, require storage acceptance and Read + write. GET operations permit Read only. Playback follows the same native nodes in the current 2D or 3D view.

Audio and preload default false; subtitles default true. GET /presentation/voices lists all 20 catalog voice IDs with language/locale, actual medium/high quality tier, fixed speaker, model size, license and source. GET/PUT /settings/presentation-voice reads/selects any catalog ID; PUT uses exact {value:string}. Alan en_GB-alan-medium remains the default British male voice, and saved IDs remain valid. Voices include several US/UK options and Swedish, French, Spanish, Portuguese, Norwegian, Danish, Finnish and German. There is no high+ tier or automatic text translation. Speech is generated locally from the nodes; enabling it can download model assets. Preload state exposes progress 0..1 and a phase message with overall percentage, ready narration count and actual download/synthesis percentage; opaque initialization remains indeterminate. Explicit preload prepares all required narration for every step of the chosen numbered sequence or storyboard from the beginning, regardless of the cursor. Only complete readiness reaches progress 1. Bounded RAM and encrypted temporary local spill retain audio with a 1 GiB ciphertext ceiling including IV/tag overhead, subject to browser quota; failures are explicit. Closing, content/voice changes or workspace lock revoke the temporary key and remove clips. Runtime state and audio buffers are not canonical graph content.

GET /presentation/video reads transient export state {status,progress,nodeIndex,total,format,message,fileName}. POST /presentation/video takes optional boolean audio/subtitles and source:"nodes"|"storyboard"; {} uses current player options and source. It starts asynchronous 1280x720, 30 fps export of the entire selected numbered sequence or storyboard from its first step in the current 2D or 3D view. MP4 is preferred, with WebM fallback only when the required video and optional audio codecs are supported; audio is never silently dropped. REST/MCP returns state, not video bytes, and completion downloads the file in the browser. DELETE /presentation/video takes exact {} to cancel. POST and DELETE require storage acceptance and Read + write; GET permits Read only. Status is idle, preparing, exporting, complete, cancelled or error; progress is 0..1, nodeIndex is zero-based or -1 before an active node, and format/fileName may be null. Keep the tab visible; manual camera interaction or diagram edits cancel. Narration is generated locally and inserted offline without screen selection, audible playback or an audio user gesture. Final output is capped at 256 MiB and the final timeline at 30 minutes; errors are explicit, never truncation. The graph stays unchanged.

Closing the player or POST /presentation/close with exact {} cancels video export. Competing player controls and new exports return 409 during export or cancellation cleanup; GET state remains available. Use Save video again in the browser to repeat a completed download. Long descriptions use subtitle pages and extend dwell to at least 3 seconds per page. Output is fixed at 1280x720. Native 2D rendering supports at most 5,000 visible cards per frame and a 128 MiB card texture cache. 3D export requires a complete visible projection of at most 8,000 objects and 16,000 relationships; truncated projections and exceeded limits fail explicitly without omitting objects.

## Local storage and access

The open Visual Nerve browser's IndexedDB is authoritative and is the only database. The server forwards workspace commands and stores no application records. The browser must have accepted local storage and enabled MCP access in Settings. MCP access defaults to Off. Read only permits GET, POST /export and the exact POST /sql/preview, POST /code/preview, POST /code/project/preview and POST /diagram-files/preview endpoints plus exact POST /diagrams/{diagramId}/questions and /build-brief previews. Creating or changing diagrams, including POST /spatial-diagrams or POST /import, requires Read + write. Writes are committed in IndexedDB before the response. If multiple workspaces are connected, provide workspaceId in visual_nerve_request arguments.

All local imports use the connected browser's saved import-file-limit-mb setting: default 50 MiB, integer 50..1024 MiB (1 GiB). UI MB means MiB; UI 1 GB means 1024 MiB. GET /settings/import-file-limit-mb permits Read only and returns the effective integer limit (50 when the saved value is absent or invalid). Change it in Settings or through PUT /settings/import-file-limit-mb with {"value":100}; Read + write is required and invalid values return 422. It stays local, is excluded from backup, and is ignored during Merge/Replace so the destination retains its own limit. Only imports up to 50 MB are supported and guaranteed. Higher limits are experimental and may be slow or fail because of browser memory or format limits. Structural/count/deadline caps remain in force. JSON and WebSocket transport envelopes stay 32 MiB and are not increased by this setting. Source requests do not accept an import-limit override.

## Native 2D and requested 3D

Visual Nerve supports native 2D diagrams and 3D views of the same canonical graph. Use 2D unless the user requests 3D; discovering 3D support is not permission to switch the requested view. Diagrams use nodes for objects and edges for relationships. These can represent any subject, including mind maps, lifecycles, processes or dependencies.

For 2D, use POST /diagrams with {name,type?}, then populate the graph with the standard nodes/edges or bulk commands. For a requested 3D diagram, use visual_nerve_request with {"path":"/spatial-diagrams","method":"POST","data":{"name":"Requested 3D diagram","type":"mindmap"}}. This creates and opens a graph in 3D mode and returns its diagram, nodes and edges. Read the returned diagram.id and diagram.version before adding content.

Populate or edit that same graph through POST /diagrams/{diagramId}/bulk, node/edge commands, versioned PATCH, or PUT /diagrams/{diagramId}/graph. Bulk supports upsert with externalId, and edges can refer to nodes through sourceExternalId/targetExternalId. Consult the full OpenAPI schemas for fields and required versions. PATCH requires the entity's version; replacing a graph requires baseVersion. Use current response versions for subsequent edits.

Node metadata.spatial is {version:1,position?:{x,y,z}}. Diagram settings.spatialView is {version:1,mode:"2d"|"3d",camera?}. Keep each node's native x/y/width/height as an independent readable 2D layout for PNG/PDF. Do not replace the 2D layout with 3D coordinates. Explicit 3D changes leave that layout intact. Moving displayed 2D geometry shifts an existing explicit 3D X/Y by the corresponding movement, preserving Z and the placement offset; conversion uses the previous uniform relief scale. New explicit X/Y/Z in the same command takes precedence. Editor commands and repository API writes, including PATCH, bulk and graph replacement, share this behavior. Both views use the same nodes and relationships; switching modes does not require a second graph or schema change. Reserved fields and exchange format remain version 1. PNG/PDF export renders in the browser using the 2D layout.

Physical cards show the same native 2D capture on readable fronts and unmirrored backs. Detailed faces are bounded at 120 logical cards with shared front/back GPU resources. The UI's separate Move objects toggle drags the selection in world X/Y while retaining each object's Z; selected groups include nested descendants once. Release commits one undoable command; Escape cancels the whole gesture without partial writes. The Move, Rotate and Scale gizmo controls operate the camera.

## SQL and code analysis

POST /sql/preview with {sql,name?} analyzes SELECT/WITH or DDL locally and returns graph/counts/warnings without saving. POST /sql/diagrams with the same input saves and opens the graph and requires write access. Query diagrams retain scoped aliases, JOIN conditions, output expressions/lineage, clauses and potentially literal values. They describe logical structure; no SQL connection or execution occurs.

ZIP project source-file count is an independent browser-local preference: project-source-file-limit, default 500, integer 500..10000. GET /code/capabilities discovers independent byte, source-file, archive-entry and analysis limits; GET /settings/project-source-file-limit returns the effective integer (500 when missing or invalid) with Read only access. PUT /settings/project-source-file-limit with exact {value:number} requires Read + write and returns 422 for invalid values. Only ZIP projects with up to 500 analyzed source files are supported and guaranteed; larger projects are experimental and may be slow or fail. The browser captures the saved preference once per ZIP job; source payloads cannot override it. codeAnalysis.project.sourceFileLimit records the captured budget when available. Source-file and folder imports outside ZIP remain limited to 500 files. ZIP archives still allow only 10000 total entries including ignored files and directory records; 5000 diagram nodes, 10000 symbols/connections, line, byte and time limits remain unchanged. Use folders mode for larger projects. The preference is excluded from backups and ignored on restore; resetting it to 500 does not invalidate existing larger diagrams.

POST /code/project/preview accepts {name?,data:base64ZIP,mode?:files|symbols|folders,focus?,languages?:{relativePath:languageId}} to scan a project locally without saving; read-only access permits this exact endpoint. POST /code/project/diagrams saves and opens it with write access. ZIP projects can mix code and Markdown; local Markdown links connect files, folders aggregates directory relationships and occurrences, files/symbols retain existing detail levels. metadata.projectDirectory identifies semantic directory nodes, and codeAnalysis.project exposes scan counts and exclusions. Use languages overrides by exact retained file path for inconclusive detection, matching the UI. ZIP scan allows 120 seconds, followed by 30-second analysis; project bridge routes allow 165 seconds. ZIP/source is transient; the 32 MiB transport envelope and browser import limits apply. GET /code/languages lists 50 code languages plus Markdown and their structural capabilities. POST /code/preview with {name?,files:[{path,content,language?}],mode?:"files"|"symbols"|"folders",focus?} returns a local static dependency outline without saving. POST /code/diagrams with the same input saves and opens it and requires write access. Omitted mode uses symbols for one file and files for multiple files. Explicit files or symbols choices are preserved. Preview and diagram.metadata.codeAnalysis.mode expose the resolved mode. Use files for larger projects and symbols for declarations and calls, such as COBOL paragraphs and file reads/writes. Existing saved diagrams retain their detail level; re-import original source to generate a different outline. Relations include syntax, heuristic or unresolved confidence and source file/line evidence. Focus matches path/name substrings and includes immediate related objects. Code is never executed; original source, comments and nonstructural string values are discarded after analysis, while identifiers and paths are retained. Dynamic dispatch, overloads, macros and missing dependencies can remain unresolved.

SQL uses the selected decoded UTF-8 file limit. Code applies the selected limit to both each file and the total project (50 MiB each by default). Their existing structural limits and 30-second worker deadline are unchanged.

## Draw.io and Visio file import

POST /diagram-files/preview accepts {format:"drawio"|"vsdx",data:string,name?}; name is a nonempty string of at most 500 characters. Draw.io data is XML text. Visio .vsdx data is strict padded standard base64 of ZIP bytes, without whitespace or a data-URL prefix. Preview returns {format,pages:[{id,name,graph,warnings}],warnings} without saving or opening a project. Page IDs are source strings, not graph UUIDs. Review file-level and per-page warnings.

POST /import with the same input plus pageId? saves and opens only the selected native page, returning Graph. Multipage input must specify pageId from preview; missing selection or an unknown ID returns 422 without partial writes. One-page input can omit it. Creation requires Read + write; exact preview permits Read only. Existing JSON/Markdown/CSV imports retain their contract.

Imported pages are editable native approximations of text, geometry, groups, relationships, basic colors and safe HTTP(S) links. Advanced/custom shapes, rotations and connector waypoints may be simplified with warnings. Original XML/ZIP, embedded image bytes and unselected pages remain temporary. Images, macros, scripts and external content are never fetched or executed. Legacy .vsd and macro-enabled .vsdm are unsupported. Input uses the selected file limit, default 50 MiB, with a 1 GiB hard ceiling. Expanded data is capped at min(1 GiB,max(100 MiB,2*selected file limit)), default 100 MiB. Other limits: 2,048 ZIP entries, 100 pages, 20,000 total nodes, 40,000 total edges, hierarchy depth 256, 30-second worker deadline and 45-second preview/import transport. JSON envelopes remain 32 MiB, so base64 integration files must be below roughly 24 MiB and preview results must also fit. Revocation cancels analysis and grants/acceptance are rechecked before saving.

## Export SVG

POST /export accepts {diagramId,format:"json"|"markdown"|"svg"} with Read only access. JSON returns Graph; Markdown and SVG return a JSON string. Save SVG XML as an .svg file (image/svg+xml). SVG contains native vector text, shapes, icons, connections, arrows and visible saved pen marks from the canonical 2D diagram, even in 3D. SVG-only scope:"complete"|"viewport"|"selected" defaults to complete. Selected requires nodeIds:[UUID] with 1..20000 unique existing nodes; nodeIds is rejected for other scopes. Viewport uses saved 2D pan/zoom and the current browser canvas size, or fits the diagram without a usable saved crop. It never opens or changes the diagram. Fonts are referenced rather than embedded; shadows and CSS decoration may be simplified. No images, foreignObject, scripts or active external links are emitted. PNG/PDF downloads remain UI-only.

SVG fails explicitly beyond 100000 rendered elements, 250000 source text characters, 16 MiB XML or 16777216 pixels per dimension. Export selected nodes for larger graphs. Clipped text can remain readable in XML; review source text before sharing. Illegal XML controls and lone surrogates are replaced with U+FFFD.

## Understand large systems

GET/PUT /diagrams/{diagramId}/overview controls view-only semantic zoom and grouping with {baseVersion,overview:{version:1,enabled,grouping:"auto"|"groups"|"tags"|"source",expanded:[]}}. GET /diagrams/{diagramId}/overview/projection?zoom=0.1 returns discovered summary IDs, source mappings, counts and typed/directed relation rollups. Never edit a summary ID as a canonical object. All original content stays intact; rendering is bounded at 2,000 cards.

POST /diagrams/{diagramId}/questions accepts {startId,kind:"downstream"|"upstream"|"path",targetId?,maxDepth?:16,edgeTypes?:[],includeHidden?:false,includeUncertain?:true,offset?:0,limit?:25}. It is read-only, handles cycles/direction/types over up to 64 steps and returns paged shortest modeled paths with file/line, SQL, CSV or manual evidence. Uncertain paths and depth limits are explicit. None-direction associations are excluded; paths are not proof of runtime impact. GET /diagrams/{diagramId}/evidence?nodeId=UUID reads source metadata; adding metricId and optional offset/disposition requests up to 100 original CSV measure-evidence rows.

GET/POST /diagrams/{diagramId}/history lists or saves named local versions with {baseVersion,name}. GET .../history/{snapshotId}/compare?to=current|snapshotUUID reviews changes and modeled affected dependencies. POST .../history/{snapshotId}/restore with {baseVersion} creates an atomic safety copy before restoring; shared owner profiles remain current. GET/DELETE .../history/{snapshotId} reads/removes a version. Up to 50 snapshots per diagram, 1,000 per workspace and 256 MiB shared archive content; rows are deduplicated. No automatic snapshot on every save. Full workspace backups include history.

GET/PUT /diagrams/{diagramId}/storyboard uses {baseVersion,storyboard:{version:1,scenes:[{id,name,nodeIds,edgeIds,narration,seconds,transitionMs,view?}]}}. Scenes preserve canonical objects and use independent narration, selected content and authored 2D viewport/3D camera (or auto-fit). Open with POST /presentation/open and {diagramId?,source:"storyboard"}; preview paused with POST /presentation/seek and {index}. POST /presentation/video accepts source:"storyboard" and existing audio/subtitle options. English is the default voice, Swedish is available. Limits: 1,000 scenes, 100,000 total references, 12,000 narration characters per scene; current video limits still apply.

GET/PUT /diagrams/{diagramId}/build-specification reads/saves reviewed additions and decision answers with {baseVersion,specification:{version:1,sections:{},answers:{}}}. POST /diagrams/{diagramId}/build-brief previews a complete Lovable brief with {scope?:"diagram"|"selected"|"csv-view",selectedIds?,instructions?}. Questions and brief previews are allowed with Read only. They do not save or send to an external service. Observed facts, proposed screens/read API contracts, acceptance criteria and unresolved decisions are labeled separately. Unknown source schemas and app behavior are not invented; narrow scope to review omitted decisions.

## Use the full OpenAPI document

The bundled contract contains all supported command paths, inputs, response schemas, graph metadata, import/export formats and validation errors. Read it through visual_nerve_api_docs or resources/read instead of inferring endpoints from the UI or fetching a separate web link.
`

func mcpResources() []any {
	return []any{
		map[string]any{"uri": mcpGuideURI, "name": "api-guide", "title": "Visual Nerve API guide: 2D, 3D and local storage", "description": "Read-only command guide covering native 2D, requested 3D, export, browser storage and permissions. No browser connection required.", "mimeType": "text/markdown"},
		map[string]any{"uri": mcpOpenAPIURI, "name": "openapi", "title": "Visual Nerve complete bundled OpenAPI contract", "description": "Full openapi.yaml shipped with this server, including all command paths and schemas. No browser connection or external fetch required.", "mimeType": "application/yaml"},
	}
}

func (s *Server) mcpDocument(uri string) (map[string]string, error) {
	switch uri {
	case mcpGuideURI:
		return map[string]string{"uri": uri, "mimeType": "text/markdown", "text": mcpAPIGuide}, nil
	case mcpOpenAPIURI:
		if s.config.StaticDir != "" {
			data, err := os.ReadFile(filepath.Join(s.config.StaticDir, "openapi.yaml"))
			if err == nil && len(data) > 0 && utf8.Valid(data) {
				return map[string]string{"uri": uri, "mimeType": "application/yaml", "text": string(data)}, nil
			}
		}
		return nil, errors.New("bundled OpenAPI documentation is unavailable: openapi.yaml must be readable UTF-8 text in the configured static directory")
	default:
		return nil, errors.New("unknown documentation resource")
	}
}

func (s *Server) mcpReadResource(data json.RawMessage) (any, *mcpError) {
	params, err := mcpObject(data, false, "uri", "_meta")
	if err != nil {
		return nil, err
	}
	uri, err := mcpString(params, "uri", true)
	if err != nil {
		return nil, err
	}
	if uri != mcpGuideURI && uri != mcpOpenAPIURI {
		return nil, &mcpError{Code: -32002, Message: "resource not found"}
	}
	document, readError := s.mcpDocument(uri)
	if readError != nil {
		return nil, &mcpError{Code: -32603, Message: readError.Error()}
	}
	return map[string]any{"contents": []any{document}}, nil
}

func (s *Server) mcpDocsTool(data json.RawMessage) (any, *mcpError) {
	arguments, err := mcpObject(data, true, "document")
	if err != nil {
		return nil, err
	}
	selected, err := mcpString(arguments, "document", false)
	if err != nil {
		return nil, err
	}
	if _, provided := arguments["document"]; !provided {
		selected = "guide"
	}
	var uris []string
	switch selected {
	case "all":
		uris = []string{mcpGuideURI, mcpOpenAPIURI}
	case "guide":
		uris = []string{mcpGuideURI}
	case "openapi":
		uris = []string{mcpOpenAPIURI}
	default:
		return nil, invalidMCPParams("document must be all, guide or openapi")
	}
	content := make([]any, 0, len(uris))
	for _, uri := range uris {
		document, readError := s.mcpDocument(uri)
		if readError != nil {
			return map[string]any{"isError": true, "content": []any{map[string]string{"type": "text", "text": readError.Error()}}}, nil
		}
		// Text blocks work even in clients that do not support resource discovery.
		// Each block contains the entire document, without truncation or a URL hop.
		content = append(content, map[string]string{"type": "text", "text": document["text"]})
	}
	return map[string]any{"isError": false, "content": content}, nil
}
