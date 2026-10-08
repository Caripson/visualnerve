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

Choose Complete diagram, Selected nodes (with internal connections), or the saved 2D viewport at the current browser canvas size. The complete projection includes off-screen and collapsed nodes and the current CSV/overview/simulation projection. Selection crops visible pen marks to selected bounds. A 3D camera never affects the SVG; viewport uses the last saved 2D crop, or fits the canonical diagram if no usable crop is saved. SVG has no bitmap resolution setting or raster canvas size limit. It includes a small metadata record with export format/version, diagram UUID, scope and `view: "2d"`; it is a visual export, not a restorable graph backup.

Local API/MCP `POST /export` accepts `{diagramId,format:"svg",scope?:"complete"|"viewport"|"selected",nodeIds?:UUID[]}` and returns the XML as a JSON string without downloading, opening or changing the diagram. Read only is allowed. Selected scope requires 1–20,000 unique existing node UUIDs; nodeIds is forbidden for other scopes. JSON/Markdown accept only diagramId and format. Unknown formats or options return 422. Save the returned string with an `.svg` extension and MIME `image/svg+xml`; normal bridge response-size/time limits still apply.

Export fails explicitly beyond 100,000 rendered DOM elements, 250,000 source text characters, 16 MiB of SVG XML, or browser layout dimensions of 16,777,216 pixels per side. The text budget is checked before per-character layout measurement. Use selected nodes for larger graphs; content is never silently truncated. Clipping follows the visible card body, but clipped text can remain readable in the XML, so review source text before sharing. Illegal XML control characters and unpaired surrogates are replaced with U+FFFD.

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
connection styles. There is no export back to `.drawio` or `.vsdx`.
See [diagram file import](docs/DIAGRAM_IMPORT.md) for conversion limits.

## Overview, storyboard, specification and history

JSON preserves `settings.overview`, `settings.storyboard` and `settings.buildSpecification`; duplication/import remap canonical references, authored scene IDs and reviewed decision keys. Semantic overview proxies are view-only and are never stored as original nodes. PNG/PDF and movie rendering use the current semantic projection; Details restores canonical layout and its pen annotations. JSON/Markdown still describe original objects.

Full workspace backups add optional `history:{version:1,snapshots,contents,sources,rows}`. Current dataset rows can be referenced as `datasetRef:{id,version}` instead of duplicated in the history bundle; otherwise archived rows are embedded. Exactly one of rows/datasetRef is provided per row archive. Old backups without history remain supported. Merge/Replace restore history atomically and remap current and historical-only IDs. History intentionally retains removed source rows until its snapshots or diagram are deleted. Single-diagram JSON contains current content, while a full backup carries versions. See [understanding workflows](docs/UNDERSTANDING.md).
