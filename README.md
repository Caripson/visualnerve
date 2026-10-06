# Visual Nerve

Visual Nerve is a local-first visual workspace for mind maps, flowcharts, timelines and connected diagrams. The application itself can be publicly hosted, but all diagrams and user-created content are stored only in the user’s browser using IndexedDB. No account or cloud database is required. Opening the same URL on another browser or device does not expose or synchronize your diagrams.

Before the workspace opens, users must explicitly accept local browser storage and offline app caching. Without acceptance, the service cannot be used. Acceptance is remembered in that browser profile, excluded from backups, and removed when all local data is deleted.

Hugo builds the application shell and help pages. React and TypeScript power the editor, React Flow renders the canvas, ELK performs explicit layouts, and Dexie manages IndexedDB transactions. The built site can run on a static HTTP server. An optional Go server serves the files and bridges local REST/MCP commands to an open browser; it stores no application data.

## Explore diagrams in 3D

Use **3D** to tilt and inspect the same diagram as a physical relief. Nodes retain their 2D positions and sizes; the same capture of their actual 2D appearance supplies both readable sides, including fonts, colors, icons and status. Back text stays unmirrored. Text and connections follow the perspective when the diagram turns. Visible **Move**, **Rotate** and **Scale** controls provide colored axis handles for camera pan, rotation and zoom; **−10°/+10°** make small turns predictable. **2D** and **Return to 2D** restore the editable overview. Front, Back, Left, Right, Top, Fit and Focus selected provide named views. Select a card or relationship, or an entry in **Objects and relationships** to edit its title, description, notes, status and connections in Properties.

Enable **Move objects** to drag selected cards in world X/Y while keeping their depth. Groups include nested descendants once; release saves one undoable movement and Escape cancels the whole preview. **3D placement** permits explicit X/Y/Z overrides; automatic placement follows the 2D layout. These 3D movements preserve the native 2D layout for PNG/PDF. Moving an object in 2D also moves an existing explicit 3D placement in X/Y while retaining Z. The pen layer remains available in the 2D overview and exports. Detailed appearances are limited to 120 logical cards, and each pair of front/back faces shares its capture and GPU resources.

Choose **Examples → New 3D truck lifecycle example** (phones: **…**) for a truck lifecycle mind map with manufacturing, delivery, operation, maintenance, second life and recycling branches. MCP can create an empty 3D diagram using `POST /spatial-diagrams`, then populate any subject through the existing node/bulk commands. Camera and object placements persist in IndexedDB, JSON and workspace backups. PNG and PDF always render the canonical 2D diagram; no 3D screenshot is required. See [3D diagrams](docs/SPATIAL_DIAGRAMS.md) for the data contract, export behavior and bounded rendering.

Mind maps use a central topic, colored curved branches and rounded topic backgrounds at every depth, with a balanced layout on both sides. Edit topics directly by double-clicking or F2, extend them with the branch **+** buttons or Tab/Enter, and use **Focus map** to give the canvas the whole workspace. While editing, Tab saves the topic and opens a new child in view. Diagram modes keep their node cards and directional connections. Switching modes preserves the canonical graph.

Click the project name to rename it. Selection actions give quick access to editing, colors, domain icons, duplication and deletion; deleting a whole branch is a separate undoable action. The green theme uses darker text and eight contrasting colors. Sixteen open source Lucide icons cover work, learning, people, health, technology and other areas. On phones, the canvas fills the screen, project navigation opens in a drawer, properties open in a bottom panel, and touch gestures pan and zoom.

Select one or more objects and choose **Status**: None, Planned, In progress, Blocked or Done. **Done** marks the whole selection complete in one click; **Reopen** returns completed objects to In progress. Completed objects show a checkmark and a distinct outline in diagrams and mind maps, including overview zoom and PNG/PDF exports. Status supports undo/redo, local saving and CSV regrouping; existing custom statuses are preserved. Use **Filters → Status** to inspect a particular state.

## Explore CSV data

Drop a CSV anywhere in the accepted workspace or use **Import**. Choose cleanup rules, filters, ordered grouping columns and measures, then create a data diagram. For example, remove a customer prefix with `^\d+\s*-\s*`, filter a column with **Starts with → AAA**, and group customers by region. Numeric measures support decimal dots and commas; choose a column's explicit number format when a value such as `1,234` is ambiguous. Original cells remain available.

The groups are ordinary diagram objects: move them, add or edit connections, labels and directions, and use undo. Explore a group, return to all data or page through groups. Hidden groups retain their objects and connections so they return when included again. Each object can show selected measures and source columns; **Show source rows** previews up to 100 matching rows with an original-values toggle.

Parsing, cleanup and aggregation run in a Web Worker. A view renders at most 600 data objects, while count, sum, average, median, minimum, maximum and distinct count use all matching rows. The regression suite includes 100,000 rows and 2,000 customers. Raw source rows and analysis choices are stored locally in IndexedDB and included in diagram JSON and full backups. See [CSV exploration](docs/CSV_EXPLORER.md) for limits and usage.

## Connected data and saved analysis views

The **Explore data** menu contains CSV/SQL tools; its menu opens outside the scrolling toolbar and stays within the screen. Use **Explore data → Data sources** to connect CSV files through explicit matching columns and review match counts before applying. Each source keeps its own aggregates without multiplying joined rows. **Explore this group** follows matching entities across connected sources. **Explore relationships and views** in Properties shows neighbors or paths and saves named perspectives over shared data. **Explore data → Refresh source** previews keyed CSV or SQL updates while preserving matched annotations and status. **Why this value?** traces measures to contributing rows; **Explore data → Data quality** inspects duplicate identities, cleanup collisions, ambiguous numbers and missing references. See [analysis workflows](docs/ANALYSIS_WORKFLOWS.md).

## Draw on a diagram

Choose the pencil in the canvas controls to draw over any diagram with a mouse, finger or pen. Choose a color and thickness, erase whole strokes or hide the drawing layer. **Done drawing** or Escape returns to normal diagram editing. Drawing uses a separate layer that follows pan and zoom, supports undo/redo, persists in IndexedDB and appears in PNG/PDF exports. Diagram JSON and full backups preserve it, including hidden strokes. See [drawing on diagrams](docs/DRAWING.md).

## Visualize SQL queries and schemas

Drop a `.sql` or `.ddl` file, use **Import**, or choose **Import SQL script** (on phones: **… → Import SQL script**). Paste or load the script, preview it, review counts and warnings, then **Create diagram**. SELECT/WITH queries become source/alias cards, derived query/CTE results, JOIN connections and ordered output expressions with column lineage. Repeated table aliases stay separate; SELECT DISTINCT, CASE, functions/casts, filters and grouping retain their logical meaning. Local worker analysis also extracts common PostgreSQL/MySQL/SQL Server `CREATE TABLE` and `ALTER TABLE ... ADD` columns, primary/unique keys and foreign keys, including composite keys, quoted names and forward references. Missing referenced tables remain explicit external objects.

Cards show bounded summaries; Properties shows complete schema columns or query output expressions and clauses in pages. The objects support normal movement, connections, status, drawing, 2D/3D, local saving and JSON/backup export. SQL is never executed, and query visualization describes logical structure rather than a physical query plan. Query expressions and filters retain literal values; the raw script and comments are temporary. DDL row/default/check/procedure values are excluded; ENUM type labels may remain as schema. Unsupported query constructs fail clearly instead of producing a misleading partial graph. Schema limits are 50 MiB, 2,000 table objects, 100,000 columns and 10,000 foreign keys; queries are bounded to 100 blocks, nesting depth 16, 2,000 sources, 10,000 outputs and 10,000 relationships. See [SQL import](docs/SQL_IMPORT.md).

## Visualize code in 50 languages

Choose **Visualize code** to paste a script, select multiple source files or choose a folder. Start with **File overview**, or choose **Declarations and dependencies** for recognized declarations, calls, data and resource dependencies. Select a language for ambiguous file extensions. Preview first, review syntax/heuristic/unresolved connections, then create a normal editable diagram. **Focus** matches a path/name substring and includes immediate neighbors; the existing relationship explorer provides further navigation and saved views.

The local worker provides structural analyzers for all 50 languages in the [support matrix](docs/CODE_IMPORT.md), including programming, query, BI and infrastructure languages. This is bounded static analysis, not compilation or execution. Original source, comments and nonstructural literal values are temporary; identifiers, paths, source lines and confidence are saved locally. Code cards and links share normal editing, status, drawing, 2D/3D and exports. API/MCP provides `GET /code/languages`, `POST /code/preview` and `POST /code/diagrams`.

## Build an app with Lovable

Choose **Build with Lovable** (on phones: **… → Build with Lovable**), describe the app you want and review the generated build prompt. Include the entire diagram, the current CSV groups or selected objects. The brief preserves objects, responsibilities, hierarchy and relationships with their directions and branch conditions. Your instructions are saved locally with the diagram. **Open in Lovable** opens a new, unsent prompt; review it and press **Send** there to start building. No API key is needed.

This explicit handoff shares the previewed text with Lovable. Source CSV rows, raw SQL scripts, arbitrary metadata and owner email addresses are excluded; group summaries, recognized SQL schema/foreign keys, query aliases/expressions/joins/clauses and written descriptions are included. Query literals may contain sensitive filters; unresolved SQL references stay explicit. Copy or download the complete brief when it exceeds the link limits. See [Lovable handoff](docs/LOVABLE.md).

## Requirements

- Go 1.26 or newer, Node.js 22.12 or newer, npm, and Hugo 0.140 or newer (standard or extended).
- Linux, WSL or macOS. Installation downloads Go/npm dependencies; subsequent builds and runtime can operate offline after dependencies are cached.
- For browser tests: `cd frontend && npx playwright install --with-deps chromium` once.

## Run

```sh
./dev.sh
```

Open http://localhost:4317. This command installs missing frontend dependencies, builds React and Hugo, compiles the Go binary and starts it. For frontend hot reload, run `./dev.sh --watch`; the editor is then at http://localhost:5173 and the optional integration server at http://localhost:4317. The watch command starts and cleans up both processes.

## Build and run the production application

```sh
./build.sh
./bin/visual-nerve --static ./public
```

`public/` is the deployable static application: serve it on S3/CloudFront or any HTTPS static host. The binary is optional, for convenient local serving and opt-in MCP. See [static deployment](docs/DEPLOYMENT.md). No Node, Hugo or Go toolchain is needed at runtime. The default listen address is `127.0.0.1:4317`.

GitHub Actions runs CI on pull requests and pushes to `main`. Publishing is manual: **Actions → Deploy S3 → Run workflow** on `main` builds the static app, uploads it to S3 and waits for CloudFront cache invalidation. The deploy workflow runs no tests. See [deployment setup and required AWS secrets](docs/DEPLOYMENT.md#manual-production-deployment).

## Test

```sh
./scripts/test.sh
# Full suite, including browser acceptance and scale tests:
./scripts/test.sh --e2e
```

Browser tests use isolated browser contexts and their own static/integration server. They cover IndexedDB persistence, offline reload, multiple tabs, integration, exports and restore. See [DEVELOPMENT.md](DEVELOPMENT.md).

The editor and browser persistence are implemented. The full Nordic Product Launch acceptance workflow passes, along with offline recovery, conflict handling and 1,000/5,000-node scale checks. See [acceptance evidence](docs/ACCEPTANCE.md) and the [specification audit](docs/REQUIREMENTS.md).

## Programmatic editing

Start with `./dev.sh --bridge` (or add `--bridge` to the binary), open the browser, and choose **Settings → MCP access → Read only** or **Read + write** (default Off). Commands follow **MCP/REST → local WebSocket bridge → browser → IndexedDB**. With integration disabled or no connected browser, graph API requests return 503. The server never reads browser storage or persists graph records.

Settings shows the current **Visual Nerve website** and its API documentation separately from the **MCP server URL for Codex**. The website domain is the allowed app origin; the MCP process runs on this computer. Codex uses HTTP(S) `/mcp`, while the browser uses WebSocket `/bridge`. The copyable **Instructions for Codex** explains these addresses and 2D/3D support without including the integration token.

MCP uses Streamable HTTP, for example `http://localhost:4317/mcp`. Call the read-only `visual_nerve_api_docs` first: default arguments return a compact guide; `document: "openapi"` returns the entire bundled contract. MCP resources provide the same guide/OpenAPI, so a separate documentation URL is unnecessary. `initialize` and tool descriptions explicitly announce 2D and requested 3D via `POST /spatial-diagrams`. Use `visual_nerve_request` with `path`, optional `method`, `data` and `workspaceId` for graph commands. See [API.md](API.md).

```sh
curl -s http://localhost:4317/api/v1/health
curl -s -X POST http://localhost:4317/api/v1/diagrams \
  -H 'Content-Type: application/json' \
  -d '{"name":"Customer onboarding","type":"flowchart"}'
# Replace DIAGRAM_ID with the returned UUID.
curl -s -X POST http://localhost:4317/api/v1/diagrams/DIAGRAM_ID/nodes \
  -H 'Content-Type: application/json' \
  -d '{"title":"Contract signed","nodeType":"process","externalId":"contract"}'
```

Use `POST /diagrams/{id}/bulk` for transactional graph population and `upsert: true` with external IDs for repeatable synchronization. API reference and locally bundled interactive documentation: http://localhost:4317/api/docs. Full contract: [API.md](API.md) and [docs/openapi.yaml](docs/openapi.yaml).

## Data and backups

Data belongs to the browser profile and the exact origin (scheme, hostname and port). Keep using the same address; `localhost` and `127.0.0.1` are separate workspaces. Startup reads IndexedDB; all editor changes commit there, including offline changes. The production service worker stores application assets so the editor can reload offline after a first visit.

Use **Settings → Data & Privacy → Export all data** for a dated complete backup of diagrams, nodes, edges, owners, portable settings, templates and CSV datasets. **Restore backup** previews Merge or Replace; replacement requires explicit confirmation. Both restore atomically and remap collisions. Consent and MCP grants are never imported. Per-diagram JSON export is also lossless. Clearing this site's browser data deletes the workspace, so retain exported backups. The app creates no server data directory and has no filesystem database.

Existing browser records upgrade in place, including pending edits. The historical IndexedDB name is retained for this purpose; it now contains the canonical tables. If you have data exported by an earlier version, use Import to add it to the browser workspace.

Optional integration configuration: `VISUAL_NERVE_BRIDGE_TOKEN` protects reads and writes; enter it in Settings for the browser session. `VISUAL_NERVE_ADDR` and `VISUAL_NERVE_STATIC_DIR` control serving. For a hosted app, configure its exact `--allowed-origin` and a trusted local TLS bridge; [deployment setup](docs/DEPLOYMENT.md#optional-local-mcp) explains browser requirements. Read [SECURITY.md](SECURITY.md).
Architecture, canonical data and exchange formats are described in [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md) and [EXPORT_FORMAT.md](EXPORT_FORMAT.md). Third-party licenses are listed in [DEPENDENCIES.md](DEPENDENCIES.md).

## License and credit

Created by **Johan Caripson**. Visual Nerve is released under the [MIT License](LICENSE). [Source code on GitHub](https://github.com/Caripson/visualnerve). Third-party libraries retain their respective licenses and notices.

Storage and privacy: [PRIVACY.md](docs/PRIVACY.md), [STORAGE.md](docs/STORAGE.md). Settings includes local storage details, an optional browser retention request and separately confirmed deletion of all local data. Private/incognito sessions may discard data on closing; there is no private-mode detection.
