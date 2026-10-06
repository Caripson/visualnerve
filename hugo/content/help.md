---
title: "A guide to connected thinking"
---

Visual Nerve saves diagrams in this browser profile. Before the workspace opens, you must accept local browser storage and offline app caching; it cannot work without this storage. Open **New diagram** and choose a blank canvas or a template. One graph can be viewed as a mind map, flowchart, timeline, process or responsibility flow; changing its mode keeps the underlying nodes and relationships.

## Move around

Scroll to zoom. Hold Space and drag to pan, or use the middle/right mouse button. Drag the canvas to select a box of nodes. Hold Shift, Ctrl or Cmd to extend selection. **F** fits the graph; the crosshair below the canvas centers your selection. The minimap is pannable and zoomable. Use the grid and magnet controls to toggle dots and snapping.

On a phone, drag the empty canvas with one finger to pan and pinch with two fingers to zoom. Tap the menu beside the project name to open the project list. Tap the properties button or **Edit** in the selection actions to open details in a bottom panel. The **…** menu contains layout, connections, filters and settings. Tap outside a panel or its close button to return to the canvas.

## Edit your graph

Use **3D** above the canvas to lift the existing diagram into shallow relief. The cards keep their placement, colors, text, icons and status; both sides show the same readable 2D appearance, and back text stays unmirrored. The whole diagram turns together. Drag to rotate, scroll or pinch to zoom, or use the visible **Move**, **Rotate** and **Scale** controls with red X, green Y and blue Z handles. These handles control the camera: Move pans the view, Rotate turns it around an axis and Scale changes the zoom. Arrow keys on a focused handle work too. **−10°/+10°** give small predictable turns, and Front, Back, Left, Right or Top choose named orientations. Fit frames the view and Focus selected centers an object. **2D** and **Return to 2D** bring back the saved overview. PNG and PDF always use this 2D layout; while in 3D, the viewport export uses the saved 2D pan and zoom.

Close the **Diagram relief** instructions with **×** to clear the view. **Help** in the 3D toolbar shows or hides them again. This only changes the current view; loading and rendering warnings remain visible.

Enable **Move objects** to drag selected cards in the world X/Y plane while keeping each object's depth. Shift-click adds objects to the selection. Moving a group includes its nested descendants once, even if a child is also selected. Release saves the whole gesture as one undoable edit; Escape cancels it without saving partial movement. These 3D movements keep the native 2D layout used for export. A later move in 2D also shifts an explicit 3D placement in X/Y while keeping its Z.

Select a diagram object, relationship or an entry in **Objects and relationships** to edit its shared properties, notes, status or links. **3D placement** sets independent X/Y/Z positions. Draw on the overview in 2D; the drawing layer is retained in exports. **Examples → New 3D truck lifecycle example** (phones: **…**) creates a truck lifecycle diagram with ordinary topics, descriptions and connections. Camera and placement save locally and are included in JSON and full backups. Nearby cards receive detailed appearances, bounded at 120 logical cards; both sides reuse the same capture. If this browser cannot render 3D, the object list and Return to 2D remain available.

Use **Add node**, choose a type, and edit its title and details in the properties panel. Drag between node handles to connect them, or use the toolbar connection button. Select an edge to change its label, direction, relationship, description or style. Drag an edge endpoint to reconnect it. Select a node and drag a corner handle to resize it.

Click the project name to rename it; Enter saves and Escape cancels. With no item selected, **F2** also opens the project name. Choose a project icon beside its name. Select an item for quick **Edit**, **Color**, **Icon**, duplicate and delete actions. The icon picker includes sixteen areas and supports searching in English or Swedish. Icons are also available in properties and are preserved in JSON, copying and image exports.

Select one or more objects and use **Status** to choose None, Planned, In progress, Blocked or Done. Click **Done** to complete the selection, or **Reopen** to return completed objects to In progress. A checkmark and distinct outline make completed objects visible in diagrams and mind maps, even when zoomed out. Status can also be set in properties, undone, filtered and included in PNG/PDF exports. It is saved locally and retained when you change CSV grouping or filters.

Mind maps have a central idea, colored curved branches and rounded topic backgrounds at every depth. Each main branch has its own color, inherited by its descendants; setting a topic's color changes that part of the branch. Double-click a topic or press **F2** to edit its text directly; Enter saves and Escape cancels. Use the **+** beside a topic or **Add subtopic** in the toolbar to extend it. **Tab** adds a child and **Enter** adds a sibling, immediately opening the new topic for typing; a sibling keeps the same side of the map. While typing, **Tab** saves and creates another child, so you can build many levels without switching to properties. The view follows the new topic. New topics avoid occupied rows while retaining existing manual positions.

**Focus map** hides the workspace panels and fits the mind map to the available space. You can still edit topics directly, add branches, search, save and export. **Exit focus** restores the diagram list and properties panel.

Use **Parent / container** to reparent without changing node IDs. The circle beside a branch collapses or expands its descendants. Select multiple nodes and use Ctrl/Cmd+G to group them; Ctrl/Cmd+Shift+G ungroups. Groups move their descendants together.

Arrow keys nudge selected nodes; Shift increases the distance. Ctrl/Cmd+C, V and D copy, paste and duplicate, preserving metadata and internal edges while assigning fresh UUIDs. **Delete** or the trash button removes selected items, retaining unselected children. **Delete branch** or **Shift+Delete** removes the selected topic and all its descendants. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo complete gestures and edits, including deletion.

## Present a numbered walkthrough

Open **Player** and choose **Number all nodes** or **Number selection**. You can also select an object and set **Presentation number** in Properties: 1 is the first step, 2 the next, and so on. Inserting a number moves other steps automatically so there are no gaps. Clear the number to remove the object from the walkthrough. **Order** shows the sequence and lets you move or remove steps. Numbering is saved with the diagram and supports undo. Export and backups preserve it; duplicated diagrams remap the sequence, while copied and pasted objects start unnumbered.

Choose **Play** to move between the numbered objects in the current 2D or 3D view. **Pause** stops playback. Rewind goes to the previous object, and Forward to the next. Subtitles show each node's description; the audio control reads that description aloud. The default is 8 seconds per node and 1200 ms camera movement. **Order → Seconds per node** accepts 2–600 seconds and **Camera movement (ms)** accepts 0–10,000; narration finishes before advancing. Expand collapsed branches and make filtered objects visible before playing.

Audio and preload start off, while subtitles start on. In **Settings → Presentation voice**, choose Alan (British male, default), US English LJ Speech, UK English Cori or Swedish NST, save the selection, or preview it. Existing saved voice choices remain selected. Explicit audio playback, **Preload** or a Settings voice preview may download about 60–109 MiB of fixed neural voice assets. Preload shows an overall percentage, the number of upcoming descriptions ready, and actual download or synthesis progress. Engine initialization is shown separately. Models are cached separately in this browser for later use; **Clear downloaded voices** removes them. Descriptions are processed locally, and generated audio is temporary. A description above 12,000 characters shows an explicit error; it is never silently truncated. [Privacy details](/privacy/#presentation-voices).

Choose **Export video** to download the whole numbered walkthrough from its first object in the current 2D or 3D view, at fixed 1280 × 720 and 30 fps. The current Audio and Subtitles options choose narration and captions. Long descriptions use subtitle pages, with at least 3 seconds per page. MP4 is preferred; a supported WebM format is used when needed. Narration is added locally without playing through your speakers, selecting a screen or granting screen recording access. An audio export may download the selected voice assets first.

Keep the tab visible and let export finish; moving the camera manually, editing the diagram or closing the player cancels it. **Cancel video** stops export; other player controls stay unavailable until cleanup completes. After completion, **Save video again** downloads another copy. Files must fit within 256 MiB and the final timeline within 30 minutes. Native 2D export supports 5,000 visible cards per frame and a 128 MiB card texture cache; zoom in or filter the diagram if a limit is reached. 3D export requires the complete visible view to fit within 8,000 objects and 16,000 relationships; narrow your filters if the 3D view shows only part of the graph. Failures show an error without dropping objects, audio or description text. Your diagram and saved order remain unchanged.

MCP can save an ordered sequence, control the player and start video export through the same local browser. GET reads are allowed with Read only; changing playback, navigation, preloading or video export requires Read + write. The finished video downloads in that browser; MCP receives status only. The [API reference](/api/docs) describes the presentation endpoints.

## Owners, search and filters

**Owners** creates people, teams, departments, systems and organizations with colors and contact details. Select a node to assign one or more owners. Ctrl/Cmd+F or K opens global search across diagrams, node details, tags, owners and metadata. A node result opens its diagram, selects the object and centers the view.

**Filters** narrows by owner, status, type, tag or date. Choose dim or hide; filtering never deletes objects. The diagram list supports folder paths, tags, favorites, sorting and recently edited diagrams. Set folder, tags and favorite in diagram properties with no object selected.

## Layout and timelines

Mind maps default to **Balanced branches**, which places main topics on both sides of the central idea and reserves space for their subtopics. For an existing map, choose **Auto layout** to apply it. Four directional layouts and radial placement are also available. Layout is an explicit, undoable operation, and topics remain freely draggable; spatial groups retain their manually arranged contents in balanced mode. Changing diagram mode changes the presentation while preserving node types, parent relationships and positions. Timeline mode uses start/end dates for horizontal placement; its zoom selector offers day, week, month, quarter and year. Dragging changes dates and vertical lanes. Timeline objects retain graph connections.

## Draw over a diagram

Choose the pencil in the bottom canvas controls to draw with a mouse, finger or pen. Pick a color and thickness; **Eraser** removes whole strokes, **Clear drawing** clears the layer, and Undo restores these changes. **Done drawing** or Escape returns to moving objects and editing connections. The eye button hides or shows saved drawings.

Strokes follow the diagram's pan and zoom and save locally as a separate layer. They do not change nodes, connections or CSV calculations. PNG/PDF include the visible layer; JSON and full backups retain it even when hidden. Fit diagram also includes visible strokes, and a drawing-only diagram can be exported.

## Import file size

Local imports default to **50 MB**. In **Settings → Import file size**, enter a whole number from **50 to 1024** in **Maximum import file size (MB)** and choose **Save import limit**. MB here means MiB; 1024 MB is 1 GB. **Only imports up to 50 MB are supported and guaranteed.** Higher limits are experimental and may be slow or fail because of browser memory or format constraints. Row, object and analysis-time limits still apply.

This preference stays in this browser. Backups exclude it, and both Merge and Replace keep the destination browser's own limit. API/MCP JSON and WebSocket envelopes still have a 32 MiB limit regardless of this setting.

## Explore a CSV

Drop a CSV onto the workspace or use **Import**. Choose column cleanup, row filters, ordered grouping columns and measures in the preview. A cleanup pattern such as `^\d+\s*-\s*` removes a numeric prefix from company names while preserving original cells. Numeric measures recognize decimal dots and commas; select a column's number format when values such as `1,234` are ambiguous.

Choose count, sum, average, median, minimum, maximum or distinct count. Measures use every matching row, even when only a page of groups is shown. Filter with **Starts with → AAA**, choose a small group limit and sort by a measure to get an overview. Large files are analyzed in the background; each view contains at most 600 data objects.

CSV groups are real diagram objects. Move them and add connections with labels, styles and arrows. Filtering or exploring a group hides other groups and their connections without deleting your edits. Select a group to choose its visible measures and source columns, preview up to 100 **Source rows** and toggle **Original values**. **Explore this group**, **All data** and **Previous/Next groups** change the analysis view. With no object selected, **Change grouping and measures** reopens the preview.

Copying a CSV object into another diagram keeps its measures as a snapshot; the source rows remain with the original data diagram.

CSV sources and analysis choices stay in this browser and are included in diagram JSON and full backups. PNG/PDF exports show the current CSV view. The default file limit is 50 MB; [Import file size](#import-file-size) controls the selected limit. CSV still supports at most 200,000 rows, 200 columns and 10 million cells. CSVs using the older `title`-column diagram format can still use **Import as existing diagram rows instead** in the preview.

## Connect sources and repeat an analysis

The **Explore data** menu explains and opens the CSV/SQL tools. Checks require imported data; **Examples** contains the truck diagram. Use **Explore data → Data sources** (on phones: **… → Data sources**) to add CSV files and explicitly match columns. Preview match counts, missing keys and duplicate-key cardinality before applying. Each source keeps its own grouping, filters and measures; related rows contribute once rather than multiplying totals. Multiple CSV files can be dropped together. Choose **Explore this group** to follow matching entities across files, and **All data** to reset connected focus. Up to eight sources and 32 relationships are supported, with a combined limit of 20 million cells.

Select an object and choose **Explore relationships and views** in Properties. Show incoming, outgoing or all neighbors one or two steps away, or find the shortest path to another object. Large results show a bounded subset with a notice. Groups outside the current CSV view are excluded unless explicitly included, and their old values are marked. Reset exploration to return to the diagram.

The same dialog saves named analysis views with filters, source configurations, relationships, layout and viewport. The views share source data; notes, status, pen marks and manual connections stay current. Save, load, update and delete views with undo support.

**Explore data → Refresh source** loads a replacement CSV or SQL schema and previews additions, changes and removals before applying. Choose and map CSV identity columns; empty or duplicate keys block ambiguous updates. SQL tables match by qualified names. Matching objects retain their status, annotations and placement. Review split or merged groups and choose whether removed objects remain detached annotations or are removed. Refresh supports undo and cancels stale previews when the diagram changes.

Beside a CSV measure, **Why this value?** explains the calculation and shows contributing, excluded or repeated original data rows in pages. **Explore data → Data quality** checks missing values, numeric ambiguity, cleanup collisions, selected identity keys and missing references. Click a check to inspect its rows, with original and cleaned values. SQL quality reports missing table definitions and unresolved column references; it does not inspect table data.

## Import a SQL schema

Drop a `.sql` or `.ddl` file, use **Import**, or choose **Import SQL script**. On phones, use **… → Import SQL script**. Enter a diagram name and paste the SQL script, or use **Load SQL file**. Preview analyzes it locally in a worker and shows query/source/output counts or table/column counts, relationships and import notes. Review the preview, then choose **Create diagram**. Changing the input clears the preview; Cancel aborts pending analysis.

SELECT/WITH queries become a graph of scoped sources, joins and results. The same table under different aliases stays separate, including invoice and parent organization aliases. JOIN connections show their type and condition. Each result keeps its ordered output names/aliases, CASE/function/cast expressions and column lineage. Derived tables and CTEs have their own query blocks. Select source/result objects or connections to inspect full expressions, filters, grouping, order and resolved/unresolved/ambiguous column references. Wildcards stay explicit; duplicate output aliases are retained with a warning.

The importer supports common PostgreSQL, MySQL and SQL Server `CREATE TABLE` definitions and `ALTER TABLE ... ADD` columns or primary/unique/foreign keys. Composite keys, quoted/schema-qualified names and references to tables defined later are retained. Foreign-key arrows run from the referencing child table to the referenced parent table. Missing definitions remain **External table · definition missing**; unresolved referenced columns are not invented.

Cards show up to 12 columns and PK/FK/UQ/nullability badges. Select a table to inspect its complete schema and keys in Properties, with 100 columns per page. Select a foreign-key connection for its column pairs and delete/update actions. Move, rename and connect imported objects, assign status or draw over them. Schema objects save locally and survive JSON export, backups and reload.

SQL is never executed or sent to a database. Query diagrams show logical structure; they do not show returned rows or a physical optimizer plan. Unsupported query constructs are rejected with a clear error. For DDL, row data and unsupported statements are ignored; DROP/RENAME/MODIFY changes are not applied and produce notes. Review schemas because they represent imported CREATE/ADD definitions, not the final state of every migration. Files and pasted scripts default to a 50 MB limit; [Import file size](#import-file-size) controls the selected limit. Schema limits are 2,000 table objects, 100,000 columns and 10,000 foreign keys; query limits are 100 blocks, nesting depth 16, 2,000 sources, 10,000 outputs and 10,000 relationships.

The raw script is a temporary draft. **Query output expressions, JOIN conditions and clauses retain their literal values** in local storage, JSON, backups and recognized text exports. DDL INSERT/COPY rows, default and CHECK expressions and procedure bodies are excluded; ENUM labels within data types may remain as schema structure. Comments and the complete source script are not saved. Review names, expressions and filters before sharing. [How your data is stored](/privacy/#sql-schema-import).

## Visualize source code

Choose **Visualize code**, paste a script and select its language, or choose source files/a folder. Review the preview before creating a diagram. The 50 structural analyzers cover programming languages, SQL dialects, BI expressions and infrastructure definitions. **File overview** shows project dependencies; **Declarations and dependencies** shows recognized functions, classes, types, resources, measures and query parts. **Focus** matches part of a file path or object name and includes immediate related objects. Select an object/connection to inspect source locations and syntax/heuristic/unresolved confidence. The relationship explorer can inspect paths and save named views.

These are normal editable objects with status, drawing, links, 2D/3D and export. Analysis is local and bounded; it does not execute code or provide full compiler semantic analysis. Dynamic or ambiguous references can be unresolved. Choose the language explicitly for ambiguous extensions such as `.m`, `.h` and `.cls`. Original source/comments/nonstructural literals are not saved; extracted identifiers, paths, lines and evidence remain. Review names and paths before sharing. API/MCP can discover languages and preview/create diagrams through the local bridge. [Data handling](/privacy/#source-code-import).

The default source limit is 50 MB per file and 50 MB for the whole project; both use the selected [import file size](#import-file-size). Limits remain 500 files, 10,000 extracted symbols, 5,000 diagram objects, 10,000 connections and a 30-second analysis deadline.

## Import draw.io or Visio

Drop a `.drawio` or `.vsdx` file onto the workspace, or use **Import**. Review its pages and warnings, select **Diagram page**, optionally edit **Diagram name** and choose **Create diagram**. Preview runs locally without saving; creation stores and opens only that selected page as editable native objects and relationships. Move or rename objects, edit connections, assign owners/status, draw over the diagram or explore it in 3D. JSON/backup and PNG/PDF export use the native result.

The conversion approximates source drawings. Advanced/custom shapes, rich formatting, rotations and connector waypoints may be simplified with warnings. Original XML/ZIP, embedded image bytes and unselected pages are temporary. Images, macros, scripts and external content are never fetched or executed. Retained links require absolute HTTP(S). `.vsd` and `.vsdm` are unsupported; export them to `.vsdx` or draw.io XML first.

The default file limit is 50 MB and expanded-data limit is 100 MB. [Import file size](#import-file-size) controls the file limit; expanded data is bounded at twice the selected limit, with a minimum of 100 MB and a maximum of 1 GB. Other limits remain 2,048 ZIP entries, 100 pages, 20,000 total objects, 40,000 total connections, group depth 256 and a 30-second analysis deadline. API/MCP `.vsdx` files must remain below roughly 24 MiB because base64 must fit the unchanged 32 MiB transport envelope. Cancel stops analysis. Review imported text and links before sharing. [Data handling](/privacy/#drawio-and-visio-import).

## Build an app with Lovable

Choose **Build with Lovable** beside Export, or **… → Build with Lovable** on a phone. Describe the app in **App instructions**, choose the entire diagram, current CSV groups or selected objects, and review the complete build prompt. Your draft is saved locally with the diagram.

Objects become app features and workflow steps. Connections preserve their directions, labels, conditions and relationships; hierarchy is distinguished from execution order. Duplicate titles remain separate. Done objects still describe features to build. Connections to objects outside your selected scope appear as external context.

**Open in Lovable** opens a new, unsent prompt. Review it there and press **Send** to start building. This explicitly shares the previewed text with Lovable. Raw CSV rows, complete source SQL scripts, arbitrary metadata and owner email addresses are excluded; grouping values, calculated summaries and written descriptions may be included. SQL tables contribute recognized column types, nullability, primary/unique keys and foreign-key column pairs/actions; query diagrams contribute aliases, outputs, expressions, joins and clauses, including literal filter values. Missing definitions and unresolved references remain explicit. Freehand notes are not translated into requirements, so explain their meaning in your instructions.

Use **Copy build prompt** or **Download build brief** if the prompt is too large for a link. The brief stays complete. No API key or local MCP bridge is needed. [Lovable's handoff documentation](https://docs.lovable.dev/integrations/build-with-url).

## Save and work offline

The editor saves changes immediately in this browser's IndexedDB. **Saved** means the local database transaction committed. The server and internet can be unavailable while you edit, create projects, search and export. After the first visit the production app can reload offline. Use the same browser profile and address to return to the same workspace.

Changes from other tabs appear through local database updates. A version conflict preserves your unsaved edits in the current tab and offers **Save local copy**, **Use saved version** or **Replace saved version**. Resolve it before closing the tab.

## Exchange and backups

JSON is the complete restorable format, including owners, metadata, hierarchy, layout, viewport and imported SQL schema. Markdown exports semantic outlines and process relationships. Import accepts Visual Nerve JSON, headings/lists in Markdown, CSV data or the older CSV diagram format with a title column, SQL/DDL scripts through their preview, and a selected page from draw.io `.drawio` or Visio `.vsdx` files. PNG exports viewport, selection or full graph at 1×, 2× or 4×. PDF supports A4/A3, portrait/landscape and tiled pages. Complete rendered exports include collapsed and off-screen objects.

Settings controls theme, **Import file size** and **Data & Privacy**. **Export all data** downloads a dated complete backup of projects, owners, portable settings, templates and CSV datasets. **Restore backup** previews Merge (keep current diagrams) or Replace (remove current work, requiring confirmation). Connection grants and storage acceptance are never imported; both modes keep this browser's own import-file limit. **Export diagram** remains a separate PNG/PDF/Markdown/JSON choice.

Clearing site data, resetting a browser profile or uninstalling the browser may remove work. Private/incognito sessions may discard it on closing. Another browser/profile/device, or a different website address, opens an independent workspace; nothing synchronizes automatically. Export a backup to move or keep a copy. Storage details shows estimated usage and, after you create a diagram, an optional browser retention request. A grant cannot prevent manual clearing or guarantee retention. Global deletion is separately confirmed under Data & Privacy. [How your data is stored](/privacy/).

## Codex and MCP

MCP access is **Off** by default. Start a bridge on your own computer with `--bridge`, then choose **Read only** or **Read + write** in Settings. Visual Nerve must remain open. Tools can read content you grant access to and, with write access, change it. `POST /sql/preview` with `{sql,name?}` analyzes a supplied query/schema without saving and is permitted in Read only. `POST /sql/diagrams` saves and opens its graph and requires write access. Read-only commands cannot mutate or elevate access. Turning it Off or closing the browser stops access; the bridge keeps no database or cloud copy.

```text
Codex → local MCP bridge → your active browser → IndexedDB
```

For an app hosted at a public HTTPS address, start the loopback bridge with `--allowed-origin https://YOUR-APP-DOMAIN`. Some browsers require local network permission or secure WebSockets: use `--tls-cert` and `--tls-key` with a certificate your browser trusts, and set `wss://127.0.0.1:4317/bridge` under **Local connection details**. Connections can only target this computer. An optional token configured through `VISUAL_NERVE_BRIDGE_TOKEN` lasts for the browser session when entered in Settings. The public website has no content API. The reference at **/api/docs** describes the optional local bridge.

Settings shows **Visual Nerve website** and its API documentation on the website's domain. Configure that exact website origin as allowed by the bridge. **MCP server URL for Codex** is a separate HTTP(S) address for the service running on your computer; the WebSocket address under Local connection details is for the browser. The saved local connection determines the Codex address. **Instructions for Codex** provides a copyable setup note without your integration token.

Ask Codex to call **visual_nerve_api_docs** first. It returns a compact API guide directly over MCP, with the complete OpenAPI available through `document: "openapi"`. MCP also lists these as documentation resources. The connection announces both 2D and 3D: when you request 3D, Codex can create through `/spatial-diagrams`, then add ordinary diagram nodes and connections. Both views use the same styled objects and retain a readable 2D layout for PNG/PDF. Restart an updated local bridge and reconnect the MCP client to refresh its tools.

## Understand a large diagram

Open **Understand** (or **More tools** on a phone). **Semantic overview** groups related objects into count/status cards with aggregated connections. Zoom in or expand a group to inspect it; **Details** returns to the original editable layout and pen layer. Original objects and connections stay saved.

**Ask diagram** finds upstream/downstream objects or a path between two objects, over several steps. Inspect **Why is this connected?** for code, SQL, CSV or manual evidence, then focus the related objects. Uncertain relationships are labeled. A modeled dependency does not prove actual runtime impact.

**Version history** saves named local snapshots. Review additions, removals, changed details and modeled affected dependencies before restoring a version. Restoration checkpoints current work first. Source refresh also saves a safety copy before applying changes. History is included in a full workspace backup and retains old source rows until its snapshots or diagram are deleted. Capacity errors preserve current work; delete unwanted snapshots explicitly.

## Present scenes and review an app specification

In **Diagram player**, choose **Storyboard scenes**, then **Order**. Create a scene from selected objects and connections; give it its own narration, dwell and transition timing. In **Details**, capture the current 2D or 3D view, or choose **Auto-fit objects**. A captured view requires its matching mode and Details. In semantic overview, use Auto-fit objects; capture is unavailable until you choose Details. Reorder and save scenes, preview one, or play/export the storyboard with the existing audio, subtitles and preload controls. Narration does not replace node descriptions. Closing the player restores the prior selection; diagram positions remain intact.

**Build with Lovable → Review the app specification** shows data model, screens, business rules, a proposed API, acceptance criteria and open decisions. Add corrections and answer missing choices before copying, downloading or explicitly opening the brief in Lovable. Source facts and design proposals are labeled separately. Opening this dialog shares nothing externally; the brief stays unsent until you choose to share it.
