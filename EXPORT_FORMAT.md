# Exchange and rendered exports

## JSON

Process Simulator uses native exchange format version 1 with `diagram.type: "process-simulator"` and an explicit top-level `simulation` payload. It identifies `type: "process-simulator"`, `schemaVersion: 1` and contains semantic nodes/edges, particle types, shared resources, improvements, scenarios, defaults, economics and retention. Time is simulated seconds; arrival rates/operating costs are per hour in the model currency. A simulator requires its payload; existing document types retain their behavior. Import/duplication remaps node/edge references and scenario/routing dependencies together. Native JSON and workspace backup preserve the complete editable model. See [Process Simulator](docs/PROCESS_SIMULATOR.md) and OpenAPI for the schema.

Scenario entity/economics overrides preserve JSON `null` removal markers, which remove inherited optional properties when resolving the scenario. Arrays replace complete values. These markers are valid only in patches/overrides; complete semantic configurations remain strict.

Live 2D capacity cards are temporary read-only projections of the same logical Work/Resource. Their numbered labels are anonymous units, not persisted employees or separate simulation nodes. Native JSON and workspace backup export the logical model and saved geometry without materializing those temporary cards or their presentation connections.

Tags must be arrays of strings, metadata must be objects, and optional description/notes/label fields must contain text. Invalid native values are rejected before any imported content is saved, with a field-specific validation message. Nested custom metadata values remain lossless.

The versioned `visual-nerve` document contains a complete canonical diagram, nodes, edges, referenced owners, metadata, dates, layout, settings and viewport. CSV diagrams additionally contain an optional primary `dataset` and an optional `datasets` array of additional sources, with original string cells and column IDs. `diagram.settings.csvAnalysis` retains the primary source's analysis, while `csvSourceAnalyses`, `csvRelationships` and `csvEntityFocus` describe connected-source configurations and scope. Node metadata contains group measures and source paths. Named analysis views store configurations and geometry over those shared sources; they do not contain separate copies of source rows. JSON is the lossless exchange format. Import validates the entire graph in one IndexedDB transaction. IDs are preserved when available; if a diagram/node/edge/dataset ID collides with existing data, IDs and all internal references, including relationship and saved-view bindings, are remapped together. Existing owners are reused only when their content agrees; otherwise their IDs are remapped. Original creation timestamps and metadata survive. Runtime versions advance independently after import.

Imported files, including workspace backup files, use the browser’s selected import limit: default 50 MiB, configurable in **Settings → Import file size** from 50 through 1024 MB (UI MB means MiB and 1 GB means 1024 MiB). Only imports up to 50 MB are supported and guaranteed; larger imports are experimental and may be slow or fail because of browser memory or format limits. Other count/structure/deadline bounds remain in force. REST/MCP JSON and WebSocket transport envelopes stay 32 MiB regardless of this setting.

## Markdown and CSV

Mind maps emit semantic heading hierarchy, including descriptions, notes and owner labels. Processes use dependency order and numbered steps; branching relationships include explicit Next links. Other graphs emit node sections with relationships. Node coordinates do not determine hierarchy. Markdown import understands headings and indented ordered/unordered lists. CSV import accepts title, externalId, nodeType, description, owner, status, tags (semicolon-separated), x, y, startDate, endDate and dueDate; quoted delimiters and multiline fields are parsed by Papa Parse. Imports normalize into canonical graph JSON before the IndexedDB transaction.

## SVG

**SVG · vector diagram** exports native SVG paths, shapes, text, icons, connections, arrow markers and visible saved pen strokes from the same isolated canonical 2D projection used by image exports. It contains no raster screenshot, image, `foreignObject`, script or active external link. Text is XML-escaped and remains editable; rendered wrapping and clipped card content follow the current card layout. Fonts are referenced by family name and are not embedded, so another computer may substitute a missing font. Shadows and CSS decoration may be simplified.

Choose Complete diagram, Selected nodes (with internal connections), or the saved 2D viewport at the current browser canvas size. The complete projection includes off-screen and collapsed nodes and the current CSV/overview/simulation projection. Selection reduces the scene to selected nodes and internal connections and crops visible pen marks to selected bounds. A 3D camera never affects the SVG; viewport uses the last saved 2D crop, or fits the canonical diagram if no usable crop is saved. Viewport still renders the full projected scene and does not reduce node/text budgets; content outside its visible crop can remain readable in XML. Review source text before sharing a cropped file. SVG has no bitmap resolution setting or raster canvas size limit. It includes a small metadata record with export format/version, diagram UUID, scope and `view: "2d"`; it is a visual export, not a restorable graph backup.

Local API/MCP `POST /export` accepts `{diagramId,format:"svg",scope?:"complete"|"viewport"|"selected",nodeIds?:UUID[]}` and returns the XML as a JSON string without downloading, opening or changing the diagram. Read only is allowed. Selected scope requires 1–20,000 unique existing node UUIDs; nodeIds is forbidden for other scopes. JSON/Markdown accept only diagramId and format. Unknown formats or options return 422. Save the returned string with an `.svg` extension and MIME `image/svg+xml`; normal bridge response-size/time limits still apply.

Synchronous `POST /export` uses the full source graph to choose its execution path: at most 100 nodes and 20,000 cumulative title, description and serialized metadata characters before projection, even for selected scope. Larger sources return `409 SVG_BACKGROUND_REQUIRED`. Small DOM-based exports additionally retain 100,000 rendered-element, 250,000 source-text-character and 16 MiB XML limits.

The UI automatically prepares larger exports in a local Web Worker with progress and cancellation. API/MCP clients use `POST /exports/svg` to obtain a `201` job status, poll `GET /exports/svg/{jobId}`, then concatenate `GET /exports/svg/{jobId}/result` text chunks using `nextOffset` until `complete`. Exact `DELETE /exports/svg/{jobId}` discards the job and result. All these routes permit Read only. See [background SVG export](API.md#background-svg-export) for request schemas, UTF-16 chunk offsets and errors.

Background jobs accept at most 100,000 source nodes and 500,000 source connections before snapshotting. The rendered selection/projection is limited to 20,000 nodes, 100,000 connections, 5,000,000 source text characters, 64 MiB XML and 16,777,216 coordinate/dimension units. Two jobs can run simultaneously, with four terminal jobs and 128 MiB of results retained for at most 15 minutes from creation; workers have a two-minute deadline. Lock, reload, workspace stop, app-cache clearing or an explicit MCP grant change removes temporary jobs/results. Limits fail explicitly; use a selection, semantic overview or separate diagrams to reduce oversized scenes. Viewport cropping does not bypass the budgets. Clipping follows the visible card body, but clipped text can remain readable in XML. Illegal XML control characters and unpaired surrogates are replaced with U+FFFD. Diagram exports remain readable files even when the workspace is encrypted.

## Draw.io editable documents

Choose **draw.io · editable diagram** for `.drawio` XML. Basic text, shapes, colors, groups and attached connectors remain editable using the saved canonical 2D layout, including in 3D. Choose Complete diagram or Selected nodes; viewport and bitmap resolution do not apply.

Editable Draw.io drawings deliberately use a **light drawing surface** regardless of the app's Appearance. White base fills with dark text, connection labels and base borders keep the drawing readable in another editor. Stored node, connection and mind-map branch color accents remain. Use native JSON to preserve full stored styling, or workspace backup to include portable appearance settings. SVG continues to follow its existing appearance behavior.

Complete includes stored logical nodes hidden by temporary CSV/overview views. Selected contains the chosen nodes and connections whose endpoints are both included; the UI expands selected process groups to actual descendants, while API clients supply descendant IDs explicitly. Titles/descriptions, owner/status labels and simple process assumptions are readable document text. Live capacity copies, simulation execution/results/scenarios, source files, raw datasets and arbitrary metadata are excluded. Icons, custom stencils, pen strokes, rich formatting and 3D relief may be simplified or omitted. Long labels can need resizing. Review warnings and retain native JSON or an encrypted workspace backup for faithful model transfer.

Cancellable local workers show progress. Independent budgets are 100,000 source nodes/500,000 source edges, 20,000 scoped nodes/100,000 internal edges, 5,000,000 exported characters, 64 MiB output, two active/four terminal jobs, 128 MiB retained results, 15-minute retention and a two-minute deadline. Limits fail explicitly, without silently dropping objects. A selection reduces the scene; source ceilings still apply before snapshotting.

API/MCP `POST /exports/diagrams` starts a job. GET status exposes progress/warnings; GET result returns bounded raw-byte chunks encoded as standard padded base64. **Decode each chunk separately before concatenating bytes**, following `nextOffset` until complete. Exact DELETE removes it; all these routes permit Read only. [Editable diagram exchange](API.md#editable-diagram-exchange) documents the 786,432-byte chunk limit, validation metadata and errors. Existing SVG/legacy exports are unchanged.

Results are transient browser RAM tied to the original workspace session. Lock, reload, cancellation or app-cache clearing erase them; API/MCP jobs additionally retain their original integration grant and are erased when it is changed or stopped. Later unlock/grants cannot recover old plaintext. UI export works with MCP disabled. Downloaded files are **readable and unencrypted**, even when source IndexedDB uses AES-256-GCM. Review descriptions and scope before sharing.

## PNG and PDF

The client uses React Flow rendering plus `html-to-image` with graph bounds and viewport transforms. Choose current viewport, selected nodes (with internal connections), or the complete graph, and 1×/2×/4× resolution. Complete export includes off-screen nodes and expands collapsed branches in an isolated export canvas. Canvas search filters do not remove objects from complete exports. CSV image/PDF exports show the current analysis view, including its measures and visible relationships; historical groups hidden by CSV analysis remain in lossless JSON and backups.

When 3D is active, PNG and PDF still render the canonical 2D layout with status, links and visible pen strokes. **Saved 2D viewport** uses the saved 2D pan/zoom at the current canvas size; without a usable saved viewport it fits the 2D graph. The WebGL canvas is never the raster source. JSON and workspace backups retain mode, camera and independent per-node 3D metadata, along with existing 2D positions. See [spatial diagrams](docs/SPATIAL_DIAGRAMS.md).

Relationship exploration affects viewport export. Complete export includes the whole current data view. Selected export includes explicitly selected historical CSV groups revealed by exploration, with an **Outside current data view** label so their retained measures are not mistaken for current totals.

Visible drawing strokes render above nodes and connections. Complete export includes their bounds, even on a diagram with no nodes; viewport export uses the current view, and selected-node export crops annotations to that selection's image bounds. Hidden strokes and an unfinished pen gesture are excluded from PNG/PDF. Diagram JSON and workspace backups retain every saved stroke and layer visibility as diagram settings.

PDF embeds the graph PNG using jsPDF. Choose A4/A3, portrait/landscape, fit to one page or tiled pages. Tiling slices the image into page-sized areas at a readable scale; each tile includes a page coordinate caption. Large exports are bounded by browser canvas limits and display an actionable error when a requested bitmap would exceed them. JSON and Markdown have no raster size limit.

## Complete workspace backup

**Settings → Data & Privacy → Export all data**, or the Export menu’s **Export all data / backup** option, downloads `visual-nerve-backup-YYYY-MM-DD.json`. This is distinct from single-diagram JSON.

The document has `format: "visual-nerve-workspace"`, `formatVersion: 1`, `schemaVersion: 8` and an ISO `exportedAt` date, plus arrays for diagrams, nodes, edges, owners, settings, templates and datasets. Optional `simulationModels`, `simulationRuns` and `simulationCheckpoints` preserve semantic models, frozen run inputs/results and bounded replay archives. All global owners are included, even unassigned ones; user templates, all CSV sources, named views and viewport/entity-order settings are preserved. Historical formatVersion 1 files without newer header fields or source/archive arrays remain accepted. Unsupported future schema versions are rejected.

Portable settings include appearance preferences. Local workspace identity, last selection, storage acceptance, MCP access/address, credentials, the browser-local `import-file-limit-mb` and `project-source-file-limit` and export/reminder bookkeeping are excluded. Neither accepting storage nor granting tools access can be imported.

SQL query graphs retain their source aliases/scopes, output expressions, clauses, column-lineage references and join conditions in node/edge metadata through JSON and complete backups. UUID collision remapping preserves logical scope/alias references because they contain no editor IDs. The original SQL draft and comments are excluded; expression and filter literals are retained. Markdown and the Lovable brief include recognized query structure through the typed query metadata contract. Review these text exports before sharing them. PNG/PDF use the normal card summaries and connection labels in the canonical 2D layout.

Restore previews **Merge with existing data** (default, keep current work and add imported projects) or **Replace all local data** (requires separate confirmation). Both run in one transaction across the workspace stores, including simulation archives. Shared owners and internal references survive collision remapping. Merge retains destination identity/grants; Replace creates a fresh identity and leaves MCP Off. The destination’s own acceptance, import file size limit and ZIP source-file count limit remain. Any import-file-limit-mb or project-source-file-limit in a supplied backup is ignored. Invalid graph, setting, template or archived simulation data rolls back everything, including replacement. Confirmed global deletion removes all user data/preferences; only built-in templates and a new local identity are reseeded.

## Code diagram exports

JSON and workspace backups retain the recognized `codeAnalysis`, `codeObject` and `codeRelation` metadata and native UUID endpoints. Original source, comments and ordinary literal values are not saved by the analyzer. Identifiers and file/import paths remain and can be sensitive. Copies and backup collisions remap object IDs while preserving original source locations.

Markdown and Lovable use explicit code metadata allowlists: language, path, kind, name, line/endLine, external state, bounded summary, connection kind/confidence and evidence. Arbitrary metadata is excluded from these summaries. Unresolved and heuristic relationships remain marked; the brief does not assert compiler-verified behavior or workflow execution order. User-written notes and descriptions are shared normally. PNG/PDF use the regular 2D cards and labels; 3D uses those same cards. See [code import](docs/CODE_IMPORT.md).

## Imported draw.io and Visio pages

`.drawio` and `.vsdx` import previews source pages and creates one selected native
graph. JSON and workspace backups retain its ordinary objects, relationships,
geometry, text, safe links and bounded source provenance. Original XML/ZIP,
embedded image bytes and unselected pages are excluded. Markdown and Lovable
share ordinary node text and relationships; custom provenance is not inserted
into those summaries. PNG/PDF render the converted 2D layout, including imported
connection styles. Editable `.drawio` exports create new
drawings from the converted native graph; they do not reconstruct the original
source package, custom stencils, embedded images or omitted pages. See
[editable diagram exports](#drawio-editable-documents) for fidelity
and conversion limits.
See [diagram file import](docs/DIAGRAM_IMPORT.md) for conversion limits.

## Overview, storyboard, specification and history

JSON preserves `settings.overview`, `settings.storyboard` and `settings.buildSpecification`; duplication/import remap canonical references, authored scene IDs and reviewed decision keys. Semantic overview proxies are view-only and are never stored as original nodes. PNG/PDF and movie rendering use the current semantic projection; Details restores canonical layout and its pen annotations. JSON/Markdown still describe original objects.

Full workspace backups add optional `history:{version:1,snapshots,contents,sources,rows}`. Current dataset rows can be referenced as `datasetRef:{id,version}` instead of duplicated in the history bundle; otherwise archived rows are embedded. Exactly one of rows/datasetRef is provided per row archive. Old backups without history remain supported. Merge/Replace restore history atomically and remap current and historical-only IDs. History intentionally retains removed source rows until its snapshots or diagram are deleted. Single-diagram JSON contains current content, while a full backup carries versions. See [understanding workflows](docs/UNDERSTANDING.md).
