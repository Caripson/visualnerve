# MCP processes, understanding and diagram presentations

The app interface offers eight languages with English as default; see
[App interface languages](UI_LANGUAGES.md). This display-only choice does not
change API/MCP fields, enum values, schemas, diagnostics, source data, simulation
results or narrator voice. Help and API documentation remain English. The language
identifier is technical browser metadata, not a private API setting or backup field.

Connect a standard MCP client to the local HTTP(S) `/mcp` server and keep `https://app.visualnerve.com/` open and human-unlocked with local storage accepted. The browser stores the diagrams in AES-256-GCM encrypted IndexedDB. Enable **Settings → MCP access → Read + write** to save or control a presentation. Read only permits GET discovery/state and the exact unsaved preview, export, question, app-brief and simulation-comparison routes below; other POST requests still require Read + write. The website's former `/app` path redirects to this separate app origin; the app origin's own `/app` path returns 404. Neither route changes browser records. The public website provides product information; the local MCP bridge runs on the user's computer. Allowed origins use `https://app.visualnerve.com` without a path.

Saved access and connection changes take effect without reloading the browser page. Temporary connection failures retry every three seconds while access is enabled; Off disconnects and cancels retries. An invalid local address must be corrected, and the bridge's allowed origin, trusted certificate, local-network permission and optional token still need to match the browser setup. See [connection setup and troubleshooting](https://www.visualnerve.com/help/api-mcp/).

Commands recheck access after queue waits and before document writes. If saving a lower access level fails, the current running Workspace retains that restriction through unrelated refreshes. An explicit access choice must save successfully before access can increase again. A failed preference write does not persist that choice across reloads.

Call `visual_nerve_api_docs` first. Its default compact guide and full `{"document":"openapi"}` response describe both canonical definitions and playback. Commands use `visual_nerve_request` with paths that omit `/api/v1`.

To discover one command without reading unrelated schemas, call:

```json
{
  "document": "endpoint",
  "path": "/diagrams/{diagramId}/bulk",
  "method": "POST"
}
```

Use the exact documented path template and uppercase `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. This read-only response is a complete scoped OpenAPI document: the operation, shared path parameters, security schemes and all transitively referenced components are retained without truncation. It requires no connected browser. `path` and `method` are required for `endpoint` and rejected for other selectors. Missing operations or broken bundled references fail explicitly; full `openapi`/`all` responses and documentation resources are unchanged.

Canonical `id` values are UUIDs. Optional `externalId` values are stable integration strings, such as `engineering` or `truck`, and bulk `upsert:true` matches those external IDs. Use versioned PATCH when editing by canonical UUID. An existing UUID without its matching external ID produces 409; supplying both identifiers for different entities produces 422. Duplicate explicit UUIDs or nonempty external IDs within a bulk entity collection also produce 422. Each error rejects the whole batch. New records may supply unused valid UUIDs. Optional entity versions and diagram `baseVersion` guard against stale bulk writes; stale supplied node, edge or owner versions produce 409. Read the returned canonical IDs and versions before the next edit.

## Client transports and port selection

Codex, Cursor, Claude Code and Gemini CLI use the same Streamable HTTP endpoint and tools; no client name grants special permissions. Initialize negotiates `2025-03-26`, `2025-06-18` or `2025-11-25`, returning the requested version when supported or the latest supported version otherwise. Subsequent HTTP requests send the negotiated `MCP-Protocol-Version`. A missing header uses the backward-compatible `2025-03-26` subset; unsupported headers return HTTP 400. This stateless endpoint returns JSON and answers GET with 405 because it offers no SSE stream. It does not implement the deprecated separate HTTP+SSE transport, server-initiated requests or tasks. [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [initialization](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

Clients requiring local stdio, including Claude Desktop, can launch the absolute path to the built `visual-nerve` binary with `--mcp-stdio`. Start the shared `--bridge` server separately. The adapter forwards newline-delimited JSON-RPC to that already-running bridge; it creates no second workspace or permission model. Stdout contains only protocol messages, diagnostics use stderr, and closing the adapter does not stop the shared bridge. An initialized upstream must identify itself as a compatible Visual Nerve server before tools/resources are forwarded. This check helps detect the wrong service; it does not authenticate against malicious local software.

The optional `VISUAL_NERVE_BRIDGE_TOKEN` is passed in the adapter environment and sent only as a Bearer header, never as a URL argument. `--mcp-url` accepts an explicit-port loopback HTTP(S) `/mcp` URL, defaults to `http://127.0.0.1:4317/mcp`, uses normal system TLS verification and refuses redirects. Input and output envelopes stay bounded to 32 MiB. The adapter allows eight active and eight pending requests; exceeding that bounded intake terminates it with a saturation diagnostic. EOF cancels pending transport work. Interrupted mutations can have an unknown outcome and are not retried; read the authoritative state before deciding whether to issue another mutation. Vendor configuration examples and their official references are in [the user guide](../hugo/content/help/api-mcp.md); the vendor applications themselves are not part of automated browser acceptance.

Port **4317** serves `/mcp`, `/bridge` and `/api/v1` on one Visual Nerve process. A port cannot be guaranteed free: an occupied-port error stops startup instead of picking a hidden fallback. To use 4318, start `visual-nerve --bridge --addr 127.0.0.1:4318` with the required allowed app origin, save `ws://127.0.0.1:4318/bridge` in the browser, and configure `http://127.0.0.1:4318/mcp` in the HTTP client. The stdio adapter takes `--mcp-url http://127.0.0.1:4318/mcp`. Keep the hostname, TLS choice and port consistent; changing the browser workspace origin itself changes its IndexedDB storage identity.

On the isolated encrypted app, the deployed Content Security Policy also restricts browser bridge connections to explicitly approved ports. A custom port must be included in that app build and its response-header policy; changing Settings alone cannot override it. The reviewed default is 4317.

## Recover a write without creating duplicates

Use a current bridge and refreshed app tab. Bridge version 0.6.0 reports `operations-v1`, `endpoint-docs-v1`, `fork-join-v1`, `async-svg-export-v1` and `exchange-export-v1` in health and its browser handshake, together with supported tool names. This reports software support; it does not reveal workspace data or grant access. Older browser tabs remain one-shot and cannot reserve or recover operation receipts.

Read bridge software health through direct HTTP `GET /api/v1/health` (`/health` relative to the REST base). MCP `visual_nerve_request` with `path:"/health"` instead reads the connected browser's semantic IndexedDB health, without bridge-only tool/capability fields. Their absence in that browser response is not evidence of an outdated bridge.

The bridge's `connected` count includes restricted control connections, so it does not prove content access. After human unlock and a fresh Settings grant, the encrypted preference must finish saving before content authorization returns. Verify an allowed read such as `GET /diagrams` succeeds before sending writes. A brief `403` asking for a fresh grant or `503` during reconnection can occur; wait using that safe read, not a repeated write as a readiness probe.

Before a write, reserve an opaque ID:

```json
{"path":"/operations","method":"POST","data":{}}
```

The reservation requires an unlocked browser, accepted storage and Read + write access. Read its returned `operationId`, then supply it as a top-level argument of `visual_nerve_request` alongside the write's `path`, `method` and `data`. REST uses `X-Visual-Nerve-Operation-Id`. Successful write bodies are unchanged; MCP `structuredContent.operationId` and the REST response header expose identity. Agents must retain that identity before dispatch if they need to recover even when the client loses the entire response.

After a timeout, call `GET /operations/{operationId}` through the same tool. Its browser receipt returns `operationId`, `state`, `resultAvailable` and optional original `status`/`result`. States are `reserved`, `running`, `succeeded`, `failed` and `unknown`. A response containing `OPERATION_OUTCOME_UNKNOWN` means the write may still commit. Inspect the receipt, or retry the exact method/path/JSON data with the same ID. Omitted and `null` data are different. A changed payload produces 409 `OPERATION_CONFLICT`; a new ID can duplicate the original work.

Operation recovery belongs to the original workspace, origin, browser instance and access grant. Another tab or new grant cannot take over. Bridge restart produces 409 `OPERATION_OUTCOME_UNKNOWN`; receipt expiry produces 410 `OPERATION_EXPIRED`. Reconcile the actual saved model before new work when recovery is unavailable. A terminal status can survive result eviction, so `resultAvailable:false` never means that execution did not occur.

An invalid browser acknowledgment can also produce 502 `OPERATION_OUTCOME_UNKNOWN`. State `failed` reports a browser command error, not guaranteed rollback of all multi-phase runtime side effects. Receipts provide at-most-once command execution in retained browser/grant scope, not exactly-once transactions across page or bridge lifetimes.

Receipts stay in browser RAM for up to 15 minutes, bounded to 256 entries and 8 MiB of readable results. The bridge retains only opaque routing/fingerprint metadata in RAM, bounded to 15 minutes and 1,024 entries. Neither receipt store is persisted. Reload, lock and grant revocation remove recovery data; integration traffic does not unlock or renew the session. See [the API contract](../API.md#recover-writes-after-a-timeout).

## Exact Read only POST routes

Read only is an explicit route allowlist, not general permission for POST:

| Route                               | Result                                     |
| ----------------------------------- | ------------------------------------------ |
| `/export`                           | Current graph JSON, Markdown or SVG export |
| `/exports/svg`                      | Transient background SVG export job        |
| `/exports/diagrams`                 | Editable Draw.io or preview Visio export job |
| `/sql/preview`                      | Unsaved SQL query/schema analysis          |
| `/code/preview`                     | Unsaved code analysis                      |
| `/code/project/preview`             | Unsaved ZIP project analysis               |
| `/diagram-files/preview`            | Unsaved draw.io/Visio page preview         |
| `/diagrams/{id}/questions`          | Source-backed relationship question        |
| `/diagrams/{id}/build-brief`        | Reviewed unsent Lovable brief              |
| `/diagrams/{id}/simulation/compare` | Comparison of saved runs                   |

The exact `DELETE /exports/svg/{jobId}` and `DELETE /exports/diagrams/{jobId}` cancellation routes also permit Read only; they remove the temporary job/result without changing the model. This does not grant general DELETE permission. The normal command validation, structure/transport limits and connected-browser requirement still apply. Paths omit `/api/v1`. Creation, settings changes, saved-definition changes and presentation/simulation controls require Read + write.

## Export a native vector diagram

Call `visual_nerve_request` with `{path:"/export",method:"POST",data:{diagramId:"DIAGRAM_UUID",format:"svg"}}`. The tool returns SVG XML as a JSON string in its response body; save that string as an `.svg` file. It does not download a file or open/change the exported diagram. Optional `scope` is `complete` (default), `viewport` or `selected`; selected requires 1–20,000 unique existing node UUIDs in `nodeIds`, which is forbidden for other scopes.

SVG preserves native paths, shapes, text, icons, connections and visible saved pen strokes from the canonical 2D projection, including when the diagram is in 3D. It contains no embedded raster screenshot, `foreignObject`, script or active external link. Fonts are referenced rather than embedded. Source text can retain clipped content, so review the file before sharing. Viewport scope crops the full projected scene; it does not remove off-screen XML content or reduce node/text budgets. Use selected scope to reduce the scene.

The synchronous `/export` route accepts source graphs with at most 100 nodes and 20,000 cumulative title, description and serialized metadata characters before projection, including when exporting a selection. Larger sources return `409 SVG_BACKGROUND_REQUIRED`; use the [background SVG job](#parallel-cases-and-background-exports). Small synchronous exports additionally retain 100,000 rendered DOM-element, 250,000 source-text-character and 16 MiB XML limits, subject to bridge envelope/time limits. Background jobs support up to 20,000 rendered nodes, 100,000 rendered edges, 5,000,000 source text characters and 64 MiB XML. JSON and Markdown exports accept only `diagramId` and `format`. See [export formats](../EXPORT_FORMAT.md).

## Export an editable Draw.io or Visio diagram

Bridge 0.6.0 advertises `exchange-export-v1`. `GET /exports/capabilities` keeps all SVG fields and adds `diagrams`: formats, scopes, independent budgets, byte chunk units and preview compatibility. Use the existing request tool:

```json
{"path":"/exports/diagrams","method":"POST","data":{"diagramId":"DIAGRAM_UUID","format":"drawio","scope":"complete"}}
```

The `201` response is a job status, not the file. Poll `GET /exports/diagrams/{jobId}` for real progress, state and warnings. After `succeeded`, retrieve `/exports/diagrams/{jobId}/result?offset=0&limit=786432`. Chunks contain `{jobId,format,mimeType,encoding:"base64",offset,nextOffset,totalBytes,data,complete,warnings}`. **Decode each padded base64 data chunk separately**, concatenate binary bytes and advance with `nextOffset` until complete. Offsets count raw bytes; never concatenate base64 strings or use SVG's UTF-16 offsets. Save `.drawio` or `.vsdx` and review warnings. Starting, inspecting, retrieving and exact DELETE cancellation permit Read only. Cancellation accepts no arguments or `{}`, returns cancelled status once and then removes the job/result.

Exports use saved logical nodes and canonical 2D geometry. Basic text/shapes/colors/groups and attached connectors are editable. Complete includes stored nodes hidden by temporary views. Selected requires 1–20,000 explicit existing canonical node UUIDs and includes only internal connections; include descendant IDs yourself for process hierarchies. Viewport is unsupported. Visible titles/descriptions, owner/status labels and simple process assumptions are readable; raw datasets, source files, arbitrary metadata and simulation execution/results are excluded. Icons, rich formatting and drawing can be simplified or omitted. Native JSON/workspace backup remains the full model transfer.

Both editable formats use a deliberate **light drawing surface**, independent of app Appearance: white base fills, dark text/labels/base borders and preserved stored node, connection and mind-map color accents. This keeps labels readable when opening the document in another editor. Native JSON retains full stored styling, and workspace backups retain portable appearance settings. SVG appearance is unchanged; no new API option is needed.

**VSDX is a preview requiring Microsoft Visio verification.** Automatic package checks do not prove real Visio rendering/editing fidelity. Inspect the file there and retain native JSON. Transient local jobs retain their original session/grant and disappear on lock, reload, stop, cache clearing or explicit grant changes. Independent limits are 100,000 source nodes/500,000 source edges, 20,000 scoped nodes/100,000 internal edges, 5,000,000 text characters, 64 MiB output, two active/four terminal jobs, 128 MiB retained bytes, 15-minute retention and a two-minute deadline. Results before success return 409; invalid chunks return 422; unavailable original jobs return 404 after authorization. See [the complete binary contract](../API.md#editable-diagram-exchange).

## Inspect and control hierarchical processes

`POST /spatial-diagrams` with `{name,type:"process-simulator"}` starts a blank, semantically valid schema-version-1 model in 3D. Add the actual process model through versioned simulation commands before running. Ordinary `POST /diagrams` with the same type retains the kiosk example. Both share the same engine; full live capacity banks and particle traffic are visualized in 2D.

Start with `{path:"/simulation/capabilities"}`. The response advertises `hierarchical-processes` and `process-drilldown`, including the fields `processes[].parentId` and `nodes[].processId`. Read `GET /diagrams` to find documents whose type is `process-simulator`, then `GET /diagrams/{diagramId}/simulation` for the complete semantic model. This model, shared resources, scenarios and deterministic engine are the same ones used by the UI. MCP does not infer process structure from canvas positions or keep a shadow configuration.

Discover the actual topology with:

```json
{
  "path": "/diagrams/DIAGRAM_ID/simulation/hierarchy",
  "method": "GET"
}
```

It returns `{rootProcessIds,processes:[{id,name,description?,parentId?,childProcessIds,nodeIds,directNodeIds}]}`. `childProcessIds` and `directNodeIds` are immediate, while `nodeIds` includes every descendant. Process IDs are stable semantic strings; use the returned canonical node IDs to inspect or edit their Work/Source/Router/Outcome assumptions. Omitted `model.processes` means an empty hierarchy for older schema version 1 documents. Folded process cards and boundary connectors are read-only projections, not additional business nodes or extra capacity.

Create a process using the latest diagram version and an existing parent ID read from that hierarchy:

```json
{
  "path": "/diagrams/DIAGRAM_ID/simulation/processes",
  "method": "POST",
  "data": {
    "baseVersion": 7,
    "value": { "id": "new-packing", "name": "Packing", "parentId": "PARENT_ID" }
  }
}
```

Use version 7 only if the latest response returned it. Success returns the updated Graph; use its `diagram.version` for subsequent writes. Assign a real Work node through `PATCH .../simulation/nodes/{nodeId}` with `{baseVersion,value:{processId:"new-packing"}}`. Processes have the existing collection GET/POST and entity GET/PATCH/DELETE conventions. PATCH `{parentId:null}` removes optional parent membership, and node `{processId:null}` removes direct membership. Scenario `overrides.processes` can change names/parents and node overrides can change membership without mutating Baseline. Invalid references or cycles return structured 422 without partial writes. A referenced process cannot be deleted independently: `SIMULATION_PROCESS_REFERENCED` explains that children/member nodes must be reassigned atomically through full-model PUT.

Run the persisted model without requiring an active animation:

```json
{
  "path": "/diagrams/DIAGRAM_ID/simulation/runs",
  "method": "POST",
  "data": {
    "seed": 12345,
    "durationSeconds": 3600,
    "speed": "max",
    "animated": false
  }
}
```

Poll the returned run ID at `GET .../runs/{runId}/state` or `/result`. Read `/processes` for every scope or `/processes/{processId}` for one; `/queues` includes process, node and resource maps. Scoped metrics include actual queues/wait distributions, utilization, bottlenecks, resource usage, throughput and economic fields. `completed` counts successful scope visits, including successful boundary exits; `exited` counts those exits, and `terminalCompleted` counts final successful outcomes inside the scope. Re-entry creates another visit. Scoped `cycleTime` measures entry to exit/outcome; scoped `ttr` measures entry to a revenue-producing terminal outcome.

Parent and child rollups overlap: do not sum them or add node quantiles. Scopes receive only occupied shared-resource cost (`resourceCostAllocation:"occupied-units"`); idle pool capacity, pool scaling and pool investments remain global overhead. Use whole-system metrics for total profitability and scenario comparison, then process metrics to locate where congestion and its consequences occurred. All scopes compete for the same global resource pools. UI, animated, MAX and MCP execution share deterministic inputs/results.

`GET .../simulation/runs` includes the captured `scenarioName` and `currency` alongside every run's metrics. Read these labels rather than looking up names or currency in the current edited document. Comparison returns its common captured `currency`; mixed-currency run IDs return structured 422 `SIMULATION_CURRENCY_MISMATCH`. Visual Nerve does not convert exchange rates.

`GET /templates` discovers the bundled **Delivery network** example, including its complete nested process model, explicit shared pools and scenario assumptions. To reproduce it, read the returned template's `graph.simulation`, create a process-simulator document and replace `/simulation` using `{baseVersion,model}`. Creation retains the kiosk default until that atomic replacement. The connected browser must remain open with accepted storage; inspection permits Read only, while creation, editing and run controls require Read + write. See [Process Simulator](PROCESS_SIMULATOR.md) and [the complete API contract](openapi.yaml).

## Present a diagram in numbered order

1. Fetch `/diagrams/{diagramId}` to read current node UUIDs and `diagram.version`.
2. Read `GET /diagrams/{diagramId}/presentation`. An absent definition returns `{version:1,nodeIds:[],secondsPerNode:8,transitionMs:1200}`.
3. Save the desired order using `PUT /diagrams/{diagramId}/presentation` with exactly `{baseVersion,presentation}`. The definition contains `version:1`, ordered unique existing `nodeIds`, `secondsPerNode:2..600`, and `transitionMs:0..10000`. Success returns Graph; stale versions return 409. Use the latest version for the next write.
4. Open with `POST /presentation/open` and optional `{diagramId,source:"nodes"|"storyboard"}` (default source nodes). Play, pause, rewind, forward and close with the respective `POST /presentation/{action}` and an exact `{}` body.
5. Read `GET /presentation` for playback state. Options use `PATCH /presentation` with at least one of boolean `audio`, `subtitles`, `preload` and `minimized`, and no other keys.

For example:

```json
{
  "path": "/presentation/open",
  "method": "POST",
  "data": { "diagramId": "EXISTING_DIAGRAM_UUID" }
}
```

The sequence belongs to `diagram.settings.presentation` and uses the same nodes in 2D and 3D. Array positions are contiguous numbers starting at 1; the maximum is 20,000 nodes. Export and backup preserve it, imported or duplicated diagrams remap IDs, deleted nodes are removed from the sequence, and clipboard copies begin unnumbered.

All runtime mutations require write access and accepted storage, including camera movement and preloading. Playback state is transient: `{open,diagramId,status,index,total,nodeId,audio,subtitles,preload,minimized,buffered,progress,message,source,sceneId,nodeIds,edgeIds,title,narration}`. Status is `idle`, `loading`, `moving`, `playing`, `paused`, `ended` or `error`; index is zero-based or -1 for an empty sequence. The state does not replace diagram nodes or their saved geometry.

Use `PATCH /presentation` with `{minimized:true}` to minimize the controls or `{minimized:false}` to expand them. GET returns the same panel state shown in the UI; opening defaults to expanded on desktop and minimized in compact layouts. This works during playback without pausing or changing audio/subtitles. Captions remain separately over the diagram when subtitles are enabled, including in 3D. The panel state is not persisted in the diagram and is not a video-export option. See the [player guide](PRESENTATION.md).

Audio and preload start disabled; subtitles start enabled. `GET /presentation/voices` returns `{defaultVoiceId,voices}` with all 20 model IDs, labels, language/locale, actual quality tier, fixed speaker, sample rates, download sizes, licenses and sources. `GET /settings/presentation-voice` reads the saved selection. PUT that path with exact `{value:"<catalog voice id>"}` to select any returned voice. For example, `{value:"de_DE-thorsten-high"}` selects German Thorsten; existing English and Swedish IDs remain valid. The catalog also covers French, Spanish, Portuguese, Norwegian, Danish and Finnish. Discover choices rather than inferring IDs; Piper has medium/high tiers, not high+. Alan, a British male Piper voice, is the default; existing explicit voice choices are retained. Speech generation runs locally, while first use can download model assets; explicit `POST /presentation/preload` with `{}` warms the model and phonemizer and prepares every step in the selected sequence from its beginning, independent of the current cursor. Bounded RAM and encrypted temporary local spill retain the clips; 100% requires all steps ready. Generated audio is excluded from backups and discarded on close, content/voice changes or workspace lock. Browser-quota or 1 GiB retained-ciphertext limit (including IV/tag overhead) failures are explicit. Read `progress` (0–1) and `message` for the overall preload percentage, ready narration count and actual download/synthesis percentage; opaque initialization remains indeterminate. Generated speech and playback progress are not canonical graph data.

## Export the walkthrough as video

`POST /presentation/video` starts an asynchronous export of the full saved sequence from its first node, in the current 2D or 3D view, at 1280 × 720 and 30 fps. Its exact body accepts optional boolean `audio`/`subtitles` and `source:"nodes"|"storyboard"`; `{}` uses the current player options and source, initially audio off and subtitles on. The player opens to show progress if needed. For example:

```json
{
  "path": "/presentation/video",
  "method": "POST",
  "data": { "audio": true, "subtitles": true }
}
```

Read `GET /presentation/video` for `{status,progress,nodeIndex,total,format,message,fileName,source}`. Status is `idle`, `preparing`, `exporting`, `complete`, `cancelled` or `error`. Progress is 0..1; nodeIndex is zero-based or -1 before an active node. Format is `mp4`, `webm` or null, and fileName may be null. Cancel with `DELETE /presentation/video` and exact `{}`. POST and DELETE require accepted local storage and Read + write; GET permits Read only. Unknown fields or nonboolean options are rejected.

MP4 is preferred, with WebM fallback when the required video and optional audio codecs are supported. Audio is never dropped to produce a file. Completion downloads the video in the connected browser; its **Save video again** control repeats the download. **MCP returns state, never video bytes**. Keep that tab visible; editing, manual camera interaction or closing the player cancel export. `POST /presentation/close` with exact `{}` also cancels it. Competing playback commands and new exports return 409 while export or cancellation cleanup is active; GET state stays available. The graph and its saved sequence remain unchanged.

Export uses local neural speech and inserts WAVs offline, without a screen picker, audible playback or an audio playback gesture. Explicit export with audio may download the selected model assets. Long subtitle descriptions use pages and extend dwell time to at least 3 seconds per page. The file is capped at 256 MiB and the final timeline at 30 minutes, including transitions and completed narration. Output is fixed at 1280 × 720. Native 2D rendering supports at most 5,000 visible cards per frame and a 128 MiB card texture cache. 3D export requires a complete visible projection of at most 8,000 objects and 16,000 relationships; truncated projections fail. Unsupported codecs and exceeded limits fail explicitly without omitting objects or truncating content. Export buffers are temporary and are excluded from IndexedDB, JSON and backups.

See the [complete API guide](../API.md) and [generated OpenAPI contract](openapi.yaml) for the exact schemas and errors.

## Understand large systems through MCP

The compact guide, initialize instructions and tool descriptions also advertise semantic overview, source-backed relationship questions, named local history, storyboards and reviewed Lovable specifications. Read [the five workflows](UNDERSTANDING.md) for exact requests and limits. Discover proxies through `/diagrams/{id}/overview/projection`; never edit summary IDs as ordinary objects. Use exact read-only POST `/diagrams/{id}/questions` or `/build-brief` to inspect modeled paths and generate an unsent app brief. These previews do not change graph versions.

History uses `/diagrams/{id}/history`; review `…/{snapshotId}/compare` before a versioned `…/{snapshotId}/restore`, which atomically checkpoints current work. Storyboards use `/diagrams/{id}/storyboard`; open with `{source:"storyboard"}`, preview paused with POST `/presentation/seek` and `{index}`, or export with optional `{source:"storyboard"}` at `/presentation/video`. Saved scene views require their matching current mode and **Details** (overview off). Preview/playback/video returns 422 otherwise; choose Details or omit `view` to auto-fit, including overview. English remains the default voice; Swedish is available.

Reviewed app additions and decision answers use `/diagrams/{id}/build-specification`. Proposed screens/read endpoints and unresolved assumptions are explicit; do not treat generated proposals as existing services. Saving these definitions and controlling playback require Read + write. Original CSV cells are returned only by an explicit measure evidence request, not by relationship questions or app briefs.

## Inspect and size code diagrams through MCP

Discover language IDs with `GET /code/languages`, then preview using `POST /code/preview` with `{name?,files:[{path,content,language?}],mode?:"files"|"symbols"|"folders",focus?}`. Omit `mode` to match the UI's automatic detail level: one file uses symbols, multiple files use files. Explicit `"files"` or `"symbols"` choices remain available. Preview and saved `diagram.metadata.codeAnalysis.mode` report the resolved mode. Preview permits Read only. Review the graph, warnings and syntax/heuristic/unresolved evidence before saving with `POST /code/diagrams`, which requires Read + write and opens the result. File overview retains at most the first 200 declaration names per file card; use symbols mode for individual declarations. Existing saved diagrams retain their detail level; original source is never saved, so import it again to regenerate a file overview as declarations. See [code import](CODE_IMPORT.md) for supported structures and limits.

The live 2D card scrolls through every retained summary entry and wraps names and paths. Selecting it exposes corner resize handles. To size a card through `visual_nerve_request`, read `GET /nodes/{nodeId}` and send `PATCH /nodes/{nodeId}` with its current node `version`, `width` and `height`; add `x`/`y` only to move it. For example, `{path:"/nodes/NODE_UUID",method:"PATCH",data:{version:7,width:480,height:640}}` uses version 7 only if the latest read returned it. Geometry-only changes preserve code metadata and connections.

For nodes with matching assigned `externalId` values, `POST /diagrams/{diagramId}/bulk` with `upsert:true`, current diagram `baseVersion` and node geometry updates resizes several cards atomically. Bulk does not match UUIDs; imported code nodes initially have no external IDs, so use PATCH directly. The saved dimensions also apply in 3D and visual exports. Those captures show the top of the card, without interactive scrolling; enlarge it in 2D to fit more details. Scroll position is temporary, while JSON and backups retain all recognized metadata.

### Code and Markdown project ZIPs

Call `GET /code/capabilities` to discover separate byte, source-file, archive-entry and analysis limits. `GET /settings/project-source-file-limit` reads the effective browser-local count with Read only access: default 500, integer 500–10,000. Change it using Read + write and exact `PUT /settings/project-source-file-limit` with `{ "value": 1000 }` before loading the ZIP. The browser captures it once per job; archive payloads cannot override it. `project.sourceFileLimit` reports the captured budget when available.

Only ZIP projects with up to 500 analyzed source files are supported and guaranteed. Higher values are experimental and may be slow or fail. Non-ZIP source/folder imports stay at 500 files. Archives still allow only 10,000 total entries including ignored files and directory records; diagram objects remain capped at 5,000, with existing symbol/connection/line/byte/time limits. Prefer folders mode for larger projects. The preference stays outside backups and restore, and resetting it does not invalidate saved larger diagrams.

Use `POST /code/project/preview` with `{data:"<BASE64_ZIP_BYTES>",name?,mode?:"files"|"symbols"|"folders",focus?,languages?}`. The exact preview route permits Read only. Review languages, warnings, graph and `project` scan counts, then use `/code/project/diagrams` with Read + write to save/open the same analysis. Base64 has no data-URL prefix and must fit the 32 MiB transport envelope; ZIP scan has a 120-second deadline, then analysis 30 seconds, with 165 seconds allowed on these bridge routes. Never interpret a timeout as proof of a successful or failed save; inspect saved diagrams.

Folder cards expose semantic `metadata.projectDirectory` (`version:1,path,fileCount,languages`), root `.`; combined folder dependencies retain confidence/evidence plus `occurrences`. `diagram.metadata.codeAnalysis` contains mode, optional `directoryCount` and ZIP `project` provenance. No need to infer folders or imports from coordinates. `markdown` is discoverable in `/code/languages`; supplied relative inline/reference/wiki links map documentation dependencies. Sources and archive bytes remain temporary. See [ZIP policy and examples](CODE_IMPORT.md#import-a-complete-project-archive).

ZIP API language overrides use `languages:{"src/header.h":"c"}` with exact retained paths after wrapping-folder removal. Unknown/excluded paths and unsupported IDs are rejected. Preview again with these overrides if detection is inconclusive, matching the UI language selectors.

## Encrypted workspace security

The isolated app, API and MCP share one authoritative browser vault/session. Call `visual_nerve_request` with `{ "path": "/workspace/security", "method": "GET" }` for safe status of the connected backend: versioned `mode`, `state`, cipher/schema metadata and human-unlock capabilities. Discovery exposes no records, credentials, vault IDs, expiry timestamps or grants and grants no content access. See [the complete status contract](../API.md#encrypted-workspace-security).

An already authorized live socket may remain restricted to control when locked; private commands return structured **423 WORKSPACE_LOCKED**. Cold locked startup or a lost/closed socket does not reconnect; unavailable browsers remain **503**. After human unlock, access starts **Off** and requires a fresh human Settings grant. Static `visual_nerve_api_docs` and MCP resources work without a connected/unlocked browser.

With current Read + write access, `{ "path": "/workspace/lock", "method": "POST", "data": {} }` saves pending edits then intentionally locks the shared vault. Save failure preserves edits; concurrent grant/data changes return **409** without revocation. An already-locked retained connection returns idempotent safe status. There are no programmatic password, recovery, unlock or session-policy controls. Requests do not renew inactivity. A lock revokes in-flight commands permanently, including late results after a new unlock; inspect state and issue a fresh request rather than retrying an interrupted mutation automatically.

Explicit authorized AI/API requests and ordinary exports expose readable content. Browser encrypted backups are separate from semantic `GET /workspace/export`, retain their original credentials, and cannot be recalled by changing the live password or rotating its key. Keep passwords/recovery keys out of prompts, tool arguments and logs. Existing www/staging workspaces remain separate until the user performs and verifies full transfer in the browser.

## Parallel cases and background exports

Bridge 0.6.0 bundles discoverable fork/join and asynchronous SVG contracts. The live browser must also be current. Inspect `GET /simulation/capabilities` and `GET /exports/capabilities`; transport health lists software, not grants. All supported MCP clients use the same `visual_nerve_request` tool and semantic endpoints.

Create complete paired `fork`/`join` regions atomically through a versioned full-model PUT. All fork outgoing edges are mandatory tasks for one original case; a join waits for that case’s tasks, with one revenue outcome and actual shared resource allocations. UI, animated/MAX runs, API/MCP and replay share `SimulationEngine`. See [parallel fields and state](../API.md#parallel-processes-through-the-api).

Route-metric keys retain exact ordered connection IDs up to 2,000 characters. Longer paths use `<first 200 chars> … [route:<8hex>-<8hex>; edges=N]`. These deterministic, non-cryptographic grouping summaries cannot reconstruct the complete itinerary. At most 256 distinct route buckets plus `[other routes]` are retained; all cases still contribute to full-population counts, costs, Work-node revenue attribution and TTR.

For large vector exports, `POST /exports/svg` returns a job ID immediately. Poll its status, retrieve `/result` in chunks using `nextOffset`, and concatenate XML until `complete`. Read-only grants allow start, inspection, result and cancellation. Jobs retain their original vault session/grant and are erased on lock or explicit grant changes. Legacy small exports still return a string; background-sized legacy requests return `409 SVG_BACKGROUND_REQUIRED`. See [limits and lifecycle](../API.md#background-svg-export).
