# Exchange and rendered exports

## JSON

The versioned `visual-nerve` document contains a complete canonical diagram, nodes, edges, referenced owners, metadata, dates, layout, settings and viewport. CSV diagrams additionally contain an optional primary `dataset` and an optional `datasets` array of additional sources, with original string cells and column IDs. `diagram.settings.csvAnalysis` retains the primary source's analysis, while `csvSourceAnalyses`, `csvRelationships` and `csvEntityFocus` describe connected-source configurations and scope. Node metadata contains group measures and source paths. Named analysis views store configurations and geometry over those shared sources; they do not contain separate copies of source rows. JSON is the lossless exchange format. Import validates the entire graph in one IndexedDB transaction. IDs are preserved when available; if a diagram/node/edge/dataset ID collides with existing data, IDs and all internal references, including relationship and saved-view bindings, are remapped together. Existing owners are reused only when their content agrees; otherwise their IDs are remapped. Original creation timestamps and metadata survive. Runtime versions advance independently after import.

Imported files, including workspace backup files, use the browser’s selected import limit: default 50 MiB, configurable in **Settings → Import file size** from 50 through 1024 MB (UI MB means MiB and 1 GB means 1024 MiB). Only imports up to 50 MB are supported and guaranteed; larger imports are experimental and may be slow or fail because of browser memory or format limits. Other count/structure/deadline bounds remain in force. REST/MCP JSON and WebSocket transport envelopes stay 32 MiB regardless of this setting.

## Markdown and CSV

Mind maps emit semantic heading hierarchy, including descriptions, notes and owner labels. Processes use dependency order and numbered steps; branching relationships include explicit Next links. Other graphs emit node sections with relationships. Node coordinates do not determine hierarchy. Markdown import understands headings and indented ordered/unordered lists. CSV import accepts title, externalId, nodeType, description, owner, status, tags (semicolon-separated), x, y, startDate, endDate and dueDate; quoted delimiters and multiline fields are parsed by Papa Parse. Imports normalize into canonical graph JSON before the IndexedDB transaction.

## PNG and PDF

The client uses React Flow rendering plus `html-to-image` with graph bounds and viewport transforms. Choose current viewport, selected nodes (with internal connections), or the complete graph, and 1×/2×/4× resolution. Complete export includes off-screen nodes and expands collapsed branches in an isolated export canvas. Canvas search filters do not remove objects from complete exports. CSV image/PDF exports show the current analysis view, including its measures and visible relationships; historical groups hidden by CSV analysis remain in lossless JSON and backups.

When 3D is active, PNG and PDF still render the canonical 2D layout with status, links and visible pen strokes. **Saved 2D viewport** uses the saved 2D pan/zoom at the current canvas size; without a usable saved viewport it fits the 2D graph. The WebGL canvas is never the raster source. JSON and workspace backups retain mode, camera and independent per-node 3D metadata, along with existing 2D positions. See [spatial diagrams](docs/SPATIAL_DIAGRAMS.md).

Relationship exploration affects viewport export. Complete export includes the whole current data view. Selected export includes explicitly selected historical CSV groups revealed by exploration, with an **Outside current data view** label so their retained measures are not mistaken for current totals.

Visible drawing strokes render above nodes and connections. Complete export includes their bounds, even on a diagram with no nodes; viewport export uses the current view, and selected-node export crops annotations to that selection's image bounds. Hidden strokes and an unfinished pen gesture are excluded from PNG/PDF. Diagram JSON and workspace backups retain every saved stroke and layer visibility as diagram settings.

PDF embeds the graph PNG using jsPDF. Choose A4/A3, portrait/landscape, fit to one page or tiled pages. Tiling slices the image into page-sized areas at a readable scale; each tile includes a page coordinate caption. Large exports are bounded by browser canvas limits and display an actionable error when a requested bitmap would exceed them. JSON and Markdown have no raster size limit.

## Complete workspace backup

**Settings → Data & Privacy → Export all data**, or the Export menu’s **Export all data / backup** option, downloads `visual-nerve-backup-YYYY-MM-DD.json`. This is distinct from single-diagram JSON.

The document has `format: "visual-nerve-workspace"`, `formatVersion: 1`, `schemaVersion: 6` and an ISO `exportedAt` date, plus arrays for diagrams, nodes, edges, owners, settings, templates and datasets. All global owners are included, even unassigned ones; user templates, all CSV sources, named views and viewport/entity-order settings are preserved. Historical formatVersion 1 files without the newer header fields or datasets array remain accepted. Unsupported future schema versions are rejected.

Portable settings include appearance preferences. Local workspace identity, last selection, storage acceptance, MCP access/address, credentials, the browser-local `import-file-limit-mb` and export/reminder bookkeeping are excluded. Neither accepting storage nor granting tools access can be imported.

SQL query graphs retain their source aliases/scopes, output expressions, clauses, column-lineage references and join conditions in node/edge metadata through JSON and complete backups. UUID collision remapping preserves logical scope/alias references because they contain no editor IDs. The original SQL draft and comments are excluded; expression and filter literals are retained. Markdown and the Lovable brief include recognized query structure through the typed query metadata contract. Review these text exports before sharing them. PNG/PDF use the normal card summaries and connection labels in the canonical 2D layout.

Restore previews **Merge with existing data** (default, keep current work and add imported projects) or **Replace all local data** (requires separate confirmation). Both run in one transaction across all seven stores. Shared owners and internal references survive collision remapping. Merge retains destination identity/grants; Replace creates a fresh identity and leaves MCP Off. The destination’s own acceptance and selected import file size limit remain. Any import-file-limit-mb in a supplied backup is ignored. Invalid graph, setting or template data rolls back everything, including replacement. Confirmed global deletion removes all user data/preferences; only built-in templates and a new local identity are reseeded.

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
