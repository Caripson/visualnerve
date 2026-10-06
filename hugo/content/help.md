---
title: "A guide to connected thinking"
---

Visual Nerve saves diagrams in this browser profile. Before the workspace opens, you must accept local browser storage and offline app caching; it cannot work without this storage. Open **New diagram** and choose a blank canvas or a template. One graph can be viewed as a mind map, flowchart, timeline, process or responsibility flow; changing its mode keeps the underlying nodes and relationships.

## Move around

Scroll to zoom. Hold Space and drag to pan, or use the middle/right mouse button. Drag the canvas to select a box of nodes. Hold Shift, Ctrl or Cmd to extend selection. **F** fits the graph; the crosshair below the canvas centers your selection. The minimap is pannable and zoomable. Use the grid and magnet controls to toggle dots and snapping.

On a phone, drag the empty canvas with one finger to pan and pinch with two fingers to zoom. Tap the menu beside the project name to open the project list. Tap the properties button or **Edit** in the selection actions to open details in a bottom panel. The **…** menu contains layout, connections, filters and settings. Tap outside a panel or its close button to return to the canvas.

## Edit your graph

Use **3D** above the canvas to lift the existing diagram into shallow relief. The cards keep their placement, colors, text, icons and status; the whole diagram turns together. Drag to rotate, scroll or pinch to zoom, or use the visible **Move**, **Rotate** and **Scale** controls with red X, green Y and blue Z handles. Move pans the view, Rotate turns it around an axis and Scale changes the zoom. Arrow keys on a focused handle work too. **−10°/+10°** give small predictable turns, and Front, Back, Left, Right or Top choose named orientations. Fit frames the view and Focus selected centers an object. **2D** and **Return to 2D** bring back the saved overview. PNG and PDF always use this 2D layout; while in 3D, the viewport export uses the saved 2D pan and zoom.

Select a diagram object, relationship or an entry in **Objects and relationships** to edit its shared properties, notes, status or links. **3D placement** sets independent X/Y/Z positions. Draw on the overview in 2D; the drawing layer is retained in exports. **Data → New 3D truck lifecycle example** (phones: **…**) creates a truck lifecycle diagram with ordinary topics, descriptions and connections. Camera and placement save locally and are included in JSON and full backups. If this browser cannot render 3D, the object list and Return to 2D remain available.

Use **Add node**, choose a type, and edit its title and details in the properties panel. Drag between node handles to connect them, or use the toolbar connection button. Select an edge to change its label, direction, relationship, description or style. Drag an edge endpoint to reconnect it. Select a node and drag a corner handle to resize it.

Click the project name to rename it; Enter saves and Escape cancels. With no item selected, **F2** also opens the project name. Choose a project icon beside its name. Select an item for quick **Edit**, **Color**, **Icon**, duplicate and delete actions. The icon picker includes sixteen areas and supports searching in English or Swedish. Icons are also available in properties and are preserved in JSON, copying and image exports.

Select one or more objects and use **Status** to choose None, Planned, In progress, Blocked or Done. Click **Done** to complete the selection, or **Reopen** to return completed objects to In progress. A checkmark and distinct outline make completed objects visible in diagrams and mind maps, even when zoomed out. Status can also be set in properties, undone, filtered and included in PNG/PDF exports. It is saved locally and retained when you change CSV grouping or filters.

Mind maps have a central idea, colored curved branches and rounded topic backgrounds at every depth. Each main branch has its own color, inherited by its descendants; setting a topic's color changes that part of the branch. Double-click a topic or press **F2** to edit its text directly; Enter saves and Escape cancels. Use the **+** beside a topic or **Add subtopic** in the toolbar to extend it. **Tab** adds a child and **Enter** adds a sibling, immediately opening the new topic for typing; a sibling keeps the same side of the map. While typing, **Tab** saves and creates another child, so you can build many levels without switching to properties. The view follows the new topic. New topics avoid occupied rows while retaining existing manual positions.

**Focus map** hides the workspace panels and fits the mind map to the available space. You can still edit topics directly, add branches, search, save and export. **Exit focus** restores the diagram list and properties panel.

Use **Parent / container** to reparent without changing node IDs. The circle beside a branch collapses or expands its descendants. Select multiple nodes and use Ctrl/Cmd+G to group them; Ctrl/Cmd+Shift+G ungroups. Groups move their descendants together.

Arrow keys nudge selected nodes; Shift increases the distance. Ctrl/Cmd+C, V and D copy, paste and duplicate, preserving metadata and internal edges while assigning fresh UUIDs. **Delete** or the trash button removes selected items, retaining unselected children. **Delete branch** or **Shift+Delete** removes the selected topic and all its descendants. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo complete gestures and edits, including deletion.

## Owners, search and filters

**Owners** creates people, teams, departments, systems and organizations with colors and contact details. Select a node to assign one or more owners. Ctrl/Cmd+F or K opens global search across diagrams, node details, tags, owners and metadata. A node result opens its diagram, selects the object and centers the view.

**Filters** narrows by owner, status, type, tag or date. Choose dim or hide; filtering never deletes objects. The diagram list supports folder paths, tags, favorites, sorting and recently edited diagrams. Set folder, tags and favorite in diagram properties with no object selected.

## Layout and timelines

Mind maps default to **Balanced branches**, which places main topics on both sides of the central idea and reserves space for their subtopics. For an existing map, choose **Auto layout** to apply it. Four directional layouts and radial placement are also available. Layout is an explicit, undoable operation, and topics remain freely draggable; spatial groups retain their manually arranged contents in balanced mode. Changing diagram mode changes the presentation while preserving node types, parent relationships and positions. Timeline mode uses start/end dates for horizontal placement; its zoom selector offers day, week, month, quarter and year. Dragging changes dates and vertical lanes. Timeline objects retain graph connections.

## Draw over a diagram

Choose the pencil in the bottom canvas controls to draw with a mouse, finger or pen. Pick a color and thickness; **Eraser** removes whole strokes, **Clear drawing** clears the layer, and Undo restores these changes. **Done drawing** or Escape returns to moving objects and editing connections. The eye button hides or shows saved drawings.

Strokes follow the diagram's pan and zoom and save locally as a separate layer. They do not change nodes, connections or CSV calculations. PNG/PDF include the visible layer; JSON and full backups retain it even when hidden. Fit diagram also includes visible strokes, and a drawing-only diagram can be exported.

## Explore a CSV

Drop a CSV onto the workspace or use **Import**. Choose column cleanup, row filters, ordered grouping columns and measures in the preview. A cleanup pattern such as `^\d+\s*-\s*` removes a numeric prefix from company names while preserving original cells. Numeric measures recognize decimal dots and commas; select a column's number format when values such as `1,234` are ambiguous.

Choose count, sum, average, median, minimum, maximum or distinct count. Measures use every matching row, even when only a page of groups is shown. Filter with **Starts with → AAA**, choose a small group limit and sort by a measure to get an overview. Large files are analyzed in the background; each view contains at most 600 data objects.

CSV groups are real diagram objects. Move them and add connections with labels, styles and arrows. Filtering or exploring a group hides other groups and their connections without deleting your edits. Select a group to choose its visible measures and source columns, preview up to 100 **Source rows** and toggle **Original values**. **Explore this group**, **All data** and **Previous/Next groups** change the analysis view. With no object selected, **Change grouping and measures** reopens the preview.

Copying a CSV object into another diagram keeps its measures as a snapshot; the source rows remain with the original data diagram.

CSV sources and analysis choices stay in this browser and are included in diagram JSON and full backups. PNG/PDF exports show the current CSV view. Files support at most 50 MiB, 200,000 rows, 200 columns and 10 million cells. CSVs using the older `title`-column diagram format can still use **Import as existing diagram rows instead** in the preview.

## Connect sources and repeat an analysis

Use **Data → Data sources** (on phones: **… → Data sources**) to add CSV files and explicitly match columns. Preview match counts, missing keys and duplicate-key cardinality before applying. Each source keeps its own grouping, filters and measures; related rows contribute once rather than multiplying totals. Multiple CSV files can be dropped together. Choose **Explore this group** to follow matching entities across files, and **All data** to reset connected focus. Up to eight sources and 32 relationships are supported, with a combined limit of 20 million cells.

Select an object and choose **Explore relationships and views** in Properties. Show incoming, outgoing or all neighbors one or two steps away, or find the shortest path to another object. Large results show a bounded subset with a notice. Groups outside the current CSV view are excluded unless explicitly included, and their old values are marked. Reset exploration to return to the diagram.

The same dialog saves named analysis views with filters, source configurations, relationships, layout and viewport. The views share source data; notes, status, pen marks and manual connections stay current. Save, load, update and delete views with undo support.

**Data → Refresh source** loads a replacement CSV or SQL schema and previews additions, changes and removals before applying. Choose and map CSV identity columns; empty or duplicate keys block ambiguous updates. SQL tables match by qualified names. Matching objects retain their status, annotations and placement. Review split or merged groups and choose whether removed objects remain detached annotations or are removed. Refresh supports undo and cancels stale previews when the diagram changes.

Beside a CSV measure, **Why this value?** explains the calculation and shows contributing, excluded or repeated original data rows in pages. **Data → Data quality** checks missing values, numeric ambiguity, cleanup collisions, selected identity keys and missing references. Click a check to inspect its rows, with original and cleaned values. SQL quality reports missing table definitions and unresolved column references; it does not inspect table data.

## Import a SQL schema

Drop a `.sql` or `.ddl` file, use **Import**, or choose **Import SQL script**. On phones, use **… → Import SQL script**. Enter a diagram name and paste the SQL script, or use **Load SQL file**. Preview analyzes it locally in a worker and shows query/source/output counts or table/column counts, relationships and import notes. Review the preview, then choose **Create diagram**. Changing the input clears the preview; Cancel aborts pending analysis.

SELECT/WITH queries become a graph of scoped sources, joins and results. The same table under different aliases stays separate, including invoice and parent organization aliases. JOIN connections show their type and condition. Each result keeps its ordered output names/aliases, CASE/function/cast expressions and column lineage. Derived tables and CTEs have their own query blocks. Select source/result objects or connections to inspect full expressions, filters, grouping, order and resolved/unresolved/ambiguous column references. Wildcards stay explicit; duplicate output aliases are retained with a warning.

The importer supports common PostgreSQL, MySQL and SQL Server `CREATE TABLE` definitions and `ALTER TABLE ... ADD` columns or primary/unique/foreign keys. Composite keys, quoted/schema-qualified names and references to tables defined later are retained. Foreign-key arrows run from the referencing child table to the referenced parent table. Missing definitions remain **External table · definition missing**; unresolved referenced columns are not invented.

Cards show up to 12 columns and PK/FK/UQ/nullability badges. Select a table to inspect its complete schema and keys in Properties, with 100 columns per page. Select a foreign-key connection for its column pairs and delete/update actions. Move, rename and connect imported objects, assign status or draw over them. Schema objects save locally and survive JSON export, backups and reload.

SQL is never executed or sent to a database. Query diagrams show logical structure; they do not show returned rows or a physical optimizer plan. Unsupported query constructs are rejected with a clear error. For DDL, row data and unsupported statements are ignored; DROP/RENAME/MODIFY changes are not applied and produce notes. Review schemas because they represent imported CREATE/ADD definitions, not the final state of every migration. Scripts are limited to 50 MiB. Schema limits are 2,000 table objects, 100,000 columns and 10,000 foreign keys; query limits are 100 blocks, nesting depth 16, 2,000 sources, 10,000 outputs and 10,000 relationships.

The raw script is a temporary draft. **Query output expressions, JOIN conditions and clauses retain their literal values** in local storage, JSON, backups and recognized text exports. DDL INSERT/COPY rows, default and CHECK expressions and procedure bodies are excluded; ENUM labels within data types may remain as schema structure. Comments and the complete source script are not saved. Review names, expressions and filters before sharing. [How your data is stored](/privacy/#sql-schema-import).

## Build an app with Lovable

Choose **Build with Lovable** beside Export, or **… → Build with Lovable** on a phone. Describe the app in **App instructions**, choose the entire diagram, current CSV groups or selected objects, and review the complete build prompt. Your draft is saved locally with the diagram.

Objects become app features and workflow steps. Connections preserve their directions, labels, conditions and relationships; hierarchy is distinguished from execution order. Duplicate titles remain separate. Done objects still describe features to build. Connections to objects outside your selected scope appear as external context.

**Open in Lovable** opens a new, unsent prompt. Review it there and press **Send** to start building. This explicitly shares the previewed text with Lovable. Raw CSV rows, complete source SQL scripts, arbitrary metadata and owner email addresses are excluded; grouping values, calculated summaries and written descriptions may be included. SQL tables contribute recognized column types, nullability, primary/unique keys and foreign-key column pairs/actions; query diagrams contribute aliases, outputs, expressions, joins and clauses, including literal filter values. Missing definitions and unresolved references remain explicit. Freehand notes are not translated into requirements, so explain their meaning in your instructions.

Use **Copy build prompt** or **Download build brief** if the prompt is too large for a link. The brief stays complete. No API key or local MCP bridge is needed. [Lovable's handoff documentation](https://docs.lovable.dev/integrations/build-with-url).

## Save and work offline

The editor saves changes immediately in this browser's IndexedDB. **Saved** means the local database transaction committed. The server and internet can be unavailable while you edit, create projects, search and export. After the first visit the production app can reload offline. Use the same browser profile and address to return to the same workspace.

Changes from other tabs appear through local database updates. A version conflict preserves your unsaved edits in the current tab and offers **Save local copy**, **Use saved version** or **Replace saved version**. Resolve it before closing the tab.
## Exchange and backups

JSON is the complete restorable format, including owners, metadata, hierarchy, layout, viewport and imported SQL schema. Markdown exports semantic outlines and process relationships. Import accepts Visual Nerve JSON, headings/lists in Markdown, CSV data or the older CSV diagram format with a title column, and SQL/DDL schema scripts through their preview. PNG exports viewport, selection or full graph at 1×, 2× or 4×. PDF supports A4/A3, portrait/landscape and tiled pages. Complete rendered exports include collapsed and off-screen objects.

Settings controls theme and **Data & Privacy**. **Export all data** downloads a dated complete backup of projects, owners, portable settings, templates and CSV datasets. **Restore backup** previews Merge (keep current diagrams) or Replace (remove current work, requiring confirmation). Connection grants and storage acceptance are never imported. **Export diagram** remains a separate PNG/PDF/Markdown/JSON choice.

Clearing site data, resetting a browser profile or uninstalling the browser may remove work. Private/incognito sessions may discard it on closing. Another browser/profile/device, or a different website address, opens an independent workspace; nothing synchronizes automatically. Export a backup to move or keep a copy. Storage details shows estimated usage and, after you create a diagram, an optional browser retention request. A grant cannot prevent manual clearing or guarantee retention. Global deletion is separately confirmed under Data & Privacy. [How your data is stored](/privacy/).

## Codex and MCP

MCP access is **Off** by default. Start a bridge on your own computer with `--bridge`, then choose **Read only** or **Read + write** in Settings. Visual Nerve must remain open. Tools can read content you grant access to and, with write access, change it. `POST /sql/preview` with `{sql,name?}` analyzes a supplied query/schema without saving and is permitted in Read only. `POST /sql/diagrams` saves and opens its graph and requires write access. Read-only commands cannot mutate or elevate access. Turning it Off or closing the browser stops access; the bridge keeps no database or cloud copy.

```text
Codex → local MCP bridge → your active browser → IndexedDB
```

For an app hosted at a public HTTPS address, start the loopback bridge with `--allowed-origin https://YOUR-APP-DOMAIN`. Some browsers require local network permission or secure WebSockets: use `--tls-cert` and `--tls-key` with a certificate your browser trusts, and set `wss://127.0.0.1:4317/bridge` under **Local connection details**. Connections can only target this computer. An optional token configured through `VISUAL_NERVE_BRIDGE_TOKEN` lasts for the browser session when entered in Settings. The public website has no content API. The reference at **/api/docs** describes the optional local bridge.
