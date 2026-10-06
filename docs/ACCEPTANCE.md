# Acceptance evidence

Initial acceptance was verified on 2026-10-05 in the provided Linux/WSL workspace with Go 1.27.1, Node 24.2.0, Hugo 0.165.0 and Playwright Chromium. Later verification records follow below; the [2026-10-07 product audit](#2026-10-07-deep-product-audit) is the latest. [REQUIREMENTS.md](REQUIREMENTS.md) maps each specification section to its implementation and checks.

## Final report

| Area | Result |
| --- | --- |
| Architecture | Public static application files served by any static host; private content remains in the browser. S3/CloudFront deployment artifacts are supplied, without provisioning AWS resources. |
| Storage | IndexedDB is authoritative, with eleven stores and explicit Dexie v1–v7 upgrades. React holds working state; complete exports and atomic Merge/Replace restore provide manual portability. |
| Privacy | Normal editing uploads no content. Another browser, profile, device or origin has independent data. Optional MCP returns content only through the explicitly enabled local bridge. |
| UI | Required remembered storage/cache acceptance, Local only badge, Data & Privacy settings, separate diagram/full-backup exports, confirmed restore/deletion, storage details and dismissible backup reminder. |
| MCP | Active browser required; loopback-only bridge; Off, Read only and Read + write permissions; shared graph validation; clear failure when disconnected. An authenticated user-requested example was created successfully. |
| Documentation | README, ARCHITECTURE, DATA_MODEL, API, EXPORT_FORMAT, DEVELOPMENT and SECURITY updated; DEPLOYMENT, PRIVACY, STORAGE and the complete requirements audit supplied. |
| Tests | 10 Go tests with race detection and vet, 67 frontend tests, formatting, strict TypeScript, production build and 25 Chromium browser tests passed. Evidence and practical limits appear below. |
| Network audit | Same-origin static GET assets and documentation, plus an optional granted literal-loopback WebSocket. No content analytics, remote graph saving or cloud synchronization. |
| Repository audit | No SQLite, alternative backend content database, server-side JSON store or graph persistence driver remains. Static deployment rejects exports/state; generated test fixture images/PDF are excluded from the app bundle. |

## Complete suite

```sh
./scripts/test.sh --e2e
```

| Final check | Result |
| --- | --- |
| Go tests with race detection | 10 tests passed (CLI, model and static/bridge server) |
| Go vet | Passed |
| Frontend unit/component tests | 67 passed in 11 files |
| Formatting and strict TypeScript | Passed |
| Production Vite/Hugo/OpenAPI/Go build | Passed |
| Chromium browser tests | 25 passed in 1.7 minutes |
| Source persistence audit | 138 project files reviewed; no active server persistence, graph database file or schema scripts in the project |

The current implementation passed 67 unit/component tests in 11 frontend files. Go static/bridge/model tests passed with race detection and vet. The production TypeScript/Vite/Hugo/OpenAPI/Go build passed. The final complete browser suite passed all 25 tests in 1.7 minutes.

The browser suite covers Nordic Product Launch, keyboard mind maps, groups/resizing, clipboard/connection reconnect, deep hierarchy, phone gestures and controls, timelines/filters/theme, IndexedDB offline reload, competing transactions with preserved copies, local Swagger, 1,000/5,000-node scale, rendered exports, complete workspace backup/restore without graph network requests, and MCP commands committed by the browser.


## Public application, private data and required acceptance

The updated specification is mapped section by section in [REQUIREMENTS.md](REQUIREMENTS.md). The existing editor remains intact. [privacy.spec.ts](../frontend/tests/e2e/privacy.spec.ts) adds nine browser scenarios on a read-only HTTPS static host at `https://public-app.test:4340`. The hostname is mapped to loopback only within isolated test browsers; no public DNS or AWS resources are created.

- Explicit checkbox and **Accept and continue** are required. Decline, Escape, backdrop clicks and shortcuts cannot open the editor. A new profile has no stored content/settings/templates or installed service worker before acceptance. Stored acceptance survives reload and cannot be imported from another profile.
- Context A creates Private A and a child; context B creates Private B at the same URL. Native IndexedDB reads prove independent data. A's downloaded backup is imported into B only through the preview, while B's existing work remains.
- A persistent Chromium profile creates My Strategy, closes the browser, relaunches the same profile and retains exact nodes/edges and project identity. The normal browser request audit sees only same-origin static GETs, with zero remote destinations, persistence methods or content API requests.
- Full export includes an unassigned owner, custom template and appearance preference, with schema/date headers and no token/grant/consent. Global deletion and Replace each require explicit confirmation. Export → confirmed clear → renewed acceptance → restore succeeds, and replacement/cancel semantics are checked.
- The public HTTPS app connects explicitly to a local TLS MCP bridge. Read-only GET/export works, mutations and permission escalation return 403. Read + write adds a visible node; reload retains it. Off and actual browser closure return clean 503/isError responses, without retained data. Remote bridge URLs are rejected before any socket opens.
- Export distinguishes one diagram from a full backup. Browser retention denial is explained. Storage/privacy controls fit 390 px and 320 px mobile widths. A ten-diagram reminder is dismissible across reload. Public Swagger has no Try it out action and sends no content.

Retained visual evidence:

- [Required local storage acceptance](acceptance/storage-acceptance.png)
- [Data & Privacy in dark Settings](acceptance/data-privacy-settings.png)
- [Mobile Data & Privacy](acceptance/data-privacy-mobile.png)
- [Separate replacement confirmation](acceptance/restore-confirmation.png)

The complete build produces 237 audited static application/license files and a 16-asset offline shell including the privacy page. [deployment.test.ts](../frontend/tests/deployment.test.ts) verifies canonical-origin redirects with query preservation, directory indexes, GET/HEAD-only infrastructure and rejection of a backup placed in the app bundle. CloudFormation lint reports no schema errors; its W1030 warning concerns the empty default certificate ARN, which is unused for the default distribution domain. Template Rules require a real constrained ACM ARN when a custom domain is selected. AWS provisioning and certificate/DNS configuration have not been performed.

The older running v0.1 service held an obsolete external database. Its read-only API confirmed zero diagrams and owners before graceful replacement with the current v0.2 loopback bridge at the same address. The replacement opens no persistent application database. A user-requested, explicitly marked fictional example was created through authenticated MCP and read back from the user's active browser; the user confirmed it works. That graph was not written into the repository or static host.

## Mind maps and diagrams

The mind map revision uses the [supplied MindMeister example](https://a.storyblok.com/f/340293/1360x850/61d4129d53/carousel-map_exam-prep.png) as a visual reference for a central topic, colored curved branches and lighter subtopics. It has its own renderer, rounded backgrounds at every depth, balanced tree layout, branch color inheritance, inline topic editing, branch creation/collapse controls and an optional full-width focus view. New maps begin with four main branches and eight subtopics; existing manual layouts change only through an explicit layout action. Tab commits the current topic, creates its child and brings the new editor into view.

[mindmap.test.ts](../frontend/tests/mindmap.test.ts) verifies two-sided subtree placement without overlaps, inheritance and color overrides, same-side sibling creation, undo, mode-aware render caches, derived parent links and selected-subtopic export appearance. [mindmap.spec.ts](../frontend/tests/e2e/mindmap.spec.ts) verifies real topic editing/cancel/undo, plus buttons, collapse, full-width focus, persisted layout, PNG pixels and dark tablet rendering. Switching the same graph to flowchart mode changes its cards and connections while retaining nodes, edges, parent IDs and geometry exactly. Offscreen frame dimensions also prevent fitting from waiting for virtualized nodes to mount after search navigation.

Retained visual evidence:

- [Mind map with workspace panels](acceptance/mindmap-workspace.png)
- [Mind map in focus view](acceptance/mindmap-focus.png)
- [The same graph in diagram mode](acceptance/mindmap-as-diagram.png)
- [Complete mind map PNG export](acceptance/mindmap-complete.png)
- [Dark mind map at 1024 × 768](acceptance/mindmap-dark-tablet.png)
- [Mind map with eight topic levels](acceptance/mindmap-many-levels.png)

## Quick editing, colors, icons and phones

Clicking the project name or pressing F2 with no selection opens an inline name editor. Selection actions float over the canvas without moving topics and provide editing, colors, domain icons, duplication, deletion and whole-branch deletion. Deletion is undoable; ordinary node deletion preserves unselected children. Sixteen Lucide area icons are stored in namespaced metadata, retaining custom integration fields through copying and persistence. The palette chooses black or white text with at least 4.5:1 contrast for solid topic backgrounds, including custom colors.

[quick-edit.test.ts](../frontend/tests/quick-edit.test.ts) verifies contrast, metadata preservation, inline draft commit/cancel/undo, thirty levels of inherited branch color and complete branch deletion/undo. [quick-work.spec.ts](../frontend/tests/e2e/quick-work.spec.ts) verifies quick project renaming, persisted colors/icons, duplicate/delete/undo, eight levels created through Tab, backgrounds at every depth, collapse/expand, branch removal, saved hierarchy and reload. It also verifies the GitHub link, Johan Caripson credit and MIT license page.

Touch-emulated Chromium at 390 × 844 verifies a readable initial topic, a project drawer, bottom properties panel, on-screen color/icon pickers, topic creation at multiple depths, one-finger pan, pinch zoom and quick deletion/undo. A 320 × 640 check verifies that the toolbar stays within the phone viewport. Mobile canvas controls remain accessible above the selection actions. Desktop viewports are distinguished from touch viewports when opening a map on another device.

- [Phone workspace](acceptance/mobile-workspace.png)
- [Phone properties panel](acceptance/mobile-properties.png)
- [Editing a deeper topic on a phone](acceptance/mobile-mindmap-editing.png)

[storage.test.ts](../frontend/tests/storage.test.ts) verifies schema upgrades, canonical records, compound identity indexes, transactions/rollback, shared owners, backups, stale versions, queued optimistic edits and a 5,000-node graph. The browser conflict test uses overlapping IndexedDB transactions from two tabs and verifies a preserved local copy alongside the other tab's committed version.
## Required workflow

[acceptance.spec.ts](../frontend/tests/e2e/acceptance.spec.ts) creates Idea, Research, Business Case, Development, Testing and Launch through the editor, connects them and assigns Johan, Commercial, Engineering, QA and Marketing. It drags a node, reloads and compares coordinates and ownership exactly. An independent REST request adds Post-launch review after Launch; the browser bridge commits it to IndexedDB and refreshes the editor. The test runs ELK, downloads PNG/PDF/Markdown/JSON, deletes the diagram, imports JSON and compares restored nodes, edges, owners, metadata and settings. No browser runtime errors occurred.

The browser persistence acceptance workflow passed in 13.6 seconds in the final run. Retained fixture artifacts:

- [Desktop workspace](acceptance/nordic-product-launch.png)
- [Complete diagram PNG](acceptance/nordic-product-launch-diagram.png)
- [A4 landscape PDF](acceptance/nordic-product-launch-diagram.pdf)
- [1024 × 768 tablet workspace](acceptance/tablet-workspace.png)

These are generated test fixtures. Actual user workspace data is never committed.

## Scale and rendering

The IndexedDB unit test stores and retrieves 5,000 nodes using bulk writes and a scoped external-ID lookup. The browser scale workflow populated, opened, edited, saved and fit 1,000 nodes/2,000 edges and 5,000 nodes/6,000 edges, then added a further node. Both passed open-under-15-seconds and edit/save-under-12-seconds checks. The final browser persistence run completed this combined workflow in 22.3 seconds with tracing enabled. These are environment-specific measurements, not hardware-independent guarantees.

PNG checks decode actual pixels and verify selection dimensions, 4× viewport dimensions and complete 2× graph bounds, including off-screen nodes. A distant nested-group regression verifies absolute export bounds. The PDF checks cover fit-to-page A4 landscape and a six-page A3 portrait tiled export. Generated PDF pages were rendered with Poppler and inspected: titles, owners and arrows are present; tiles preserve continuous graph sections and page captions. JSON restoration compares semantic relationships and layout directly.

## Startup and local operation

Production build and static serving were verified locally. A separate Python static HTTP server served the Hugo output without Go, successfully created and reloaded a 13-node mind map, exposed the bundled Swagger documentation, and recorded zero graph API requests or browser errors. `/api/v1/health` identifies `storage: indexeddb` and reports whether the optional bridge is enabled and connected. The Go server creates no application records or data files.

The offline browser test disables networking, edits, waits for Saved, reloads the precached shell and verifies the committed IndexedDB value. The independent normal-workspace test aborts all API requests, creates/searches/exports/restores offline, and asserts zero graph network requests. The MCP browser scenario verifies a tool creates a root and child in IndexedDB, the editor updates, reload retains them, and opting out leaves the server unable to return graph data. Integration and Swagger assets remain on the local origin.

## Practical limits

Raster export rejects a bitmap above 16,384 pixels in either dimension or 80 million pixels. Tiled PDF rejects more than 200 pages. Use a lower resolution or a selection for very large raster exports; canonical JSON and Markdown remain available. Layout and export cost depends on graph shape and hardware. Overview zoom reduces unselected node detail; selection or zoom restores it, and complete exports retain full details.

The implemented concurrency model is optimistic version checking with explicit conflict resolution. Selection and filters are transient; diagram viewport/settings and edits persist. macOS runtime execution was not available in this environment. Browser storage is scoped to the browser profile and origin; exported backups move data between them. The portable Go/Hugo/Node setup is documented.

## CSV exploration as connected diagrams

[CSV exploration](CSV_EXPLORER.md) describes the import, cleanup, grouping, filtering and display controls. The browser acceptance uses a fictional 100,000-row ledger with 2,000 customers, mixed decimal dot/comma cells and numeric customer prefixes. It verifies all-row count, sum, average, median, minimum, maximum and distinct count while only a page of groups is visible. Cleaning prefixes before grouping, Company starts with AAA, group focus, original source previews, per-object measure/column choices and reload all preserve the expected values.

The result contains canonical diagram objects and connections. Browser checks draw and select real strokes, add labels and arrows in both directions, change their style, move objects, filter out endpoints and bring their connections back, and regroup without losing manual relationships. Unit checks also cover deleted/reconnected generated links, undo, copies within a data diagram and source-free measure snapshots copied into another diagram. Snapshot DELETE/PATCH/bulk API regressions preserve the copied metadata without creating a source binding.

IndexedDB schema 5 stores original source strings separately from drawing objects. Tests cover older schema/backup upgrades, dataset identity remapping on diagram import, Merge/Replace, rollback, source replacement in another connection, lossless JSON/backup round trips and deletion of a source with its diagram. Ordinary diagram edits retain the immutable source without rewriting all rows.

The full 128-case frontend unit/component run passed. The final API guard then passed all 51 storage cases, including three additional snapshot regressions. Go race tests and vet, TypeScript/Vite/Hugo/OpenAPI/Go production build, formatting and the 240-file static bundle audit passed. The offline application shell contains 18 local assets, including the CSV worker.

All 27 browser scenarios were verified: 22 unchanged scenarios passed in the complete run, followed by five passing final scenarios covering both CSV flows, 1,000/5,000-node editing, schema-5 backup controls and the phone workspace. The original scale timing limits and strict phone viewport check remain in place. The final five-scenario run passed in two minutes; no CSV browser runtime errors occurred.

On this macOS test machine, the final isolated Chrome CSV flow measured 445 ms to open the import configuration, 2,010 ms to configure the selected measures and 1,125 ms to create/persist the diagram. The import interval produced 27 animation frames with a maximum gap of 33.3 ms. These are measurements of this fixture and environment, not guarantees for other files, devices or a comparison against Excel. The test uses a file path; injecting the same file as an in-memory Playwright buffer also stalled a blank file-input page and therefore did not measure application responsiveness accurately.

Retained fixture evidence: [CSV groups, source rows and editable connections](acceptance/csv-explorer.png). No actual user data is included. GitHub review and CI are separate from the existing manual S3/CloudFront deployment workflow.

## Freehand drawing over diagrams

[Drawing on diagrams](DRAWING.md) describes the separate pen layer and its controls. Mouse, finger and stylus gestures create world-coordinate strokes above objects and connections. Color, width, erasing whole strokes, visibility, clearing and undo/redo preserve diagram objects, relationships and CSV source data. Saved strokes survive IndexedDB reload, diagram JSON, copied imports and workspace backups; unfinished gestures and brush/tool choice are transient.

[drawing.spec.ts](../frontend/tests/e2e/drawing.spec.ts) exercises drawing across cards and connections, keyboard undo after choosing a brush, pan/zoom alignment, erase/clear/history, hidden layers, reload, JSON import, backups, and normal handle connections after leaving the pen. Real touch/stylus input and bounded tools are checked at 390 and 320 px. Pixel checks cover complete, viewport and selection PNGs, including ink above a selected outer group with three nested group levels. Drawing-only PNG/PDF and importing a distant dot without a saved viewport verify automatic framing and fit controls.

Raster capture waits for mounted content and native SVG decoding, then requests a canvas suitable for pixel reads. This avoids an intermittent Chrome accelerated-canvas failure that could turn a valid SVG, its ordinary objects and its annotations into a fully transparent image. Hidden-layer exports must remain fully opaque as well as omit the ink.

The full frontend suite passed 169 cases. Final export tests, Go race tests and vet, formatting, the production TypeScript/Vite/Hugo/OpenAPI/Go build and the 240-file static bundle audit passed. The four new drawing browser scenarios and existing image-export scenario passed against the final production build; both CSV workflows, groups/connections and phone editing also passed during this change. Four further desktop repetitions passed with unchanged pixel, history, storage and connection assertions, without diagnostic wrappers.

Retained fictional fixture evidence: [Drawing tools over objects and connections](acceptance/drawing-layer.png), [320 px phone drawing](acceptance/drawing-mobile.png) and [Ink above nested selected groups](acceptance/drawing-nested-groups.png). No actual user data is included. S3/CloudFront deployment remains manual.

## Object status and visible completion

Selected objects expose a Status picker with None, Planned, In progress, Blocked and Done. Mixed selections are identified before applying a shared status. The separate Done action completes the selection; Reopen returns completed objects to In progress. Done uses a check, readable label and green outline in diagrams and mind maps, including the overview view and rendered exports.

[status.spec.ts](../frontend/tests/e2e/status.spec.ts) verifies both renderers, mixed selection, keyboard undo after a native status choice, a single undo/redo step for each batch, clearing status and IndexedDB reload. It compares creation times, IDs, geometry, colors, metadata, parent links and every connection endpoint, label, arrow direction and style; only status and normal update/version fields may change. A 60 px mind map leaf with a long title retains its complete badge inside the object. The PNG regression compares an object without status against its completed export, requiring visible check/text and outline pixels with a fully opaque image.

The phone scenario starts at 320 × 640, opens its project through the real drawer and uses the status picker, Done, Reopen and undo. It checks viewport containment and the topmost click target of Draw, Fit View and Zoom In while the selection toolbar wraps, then taps the controls and enters/exits drawing before setting status. The collapsed child's hidden relationship survives the workflow. The mobile project drawer scrolls as a complete panel so its diagram list cannot collapse behind the filters or footer.

The full frontend suite passed 179 unit/component cases. Go race tests and vet, formatting, the production TypeScript/Vite/Hugo/OpenAPI/Go build and the 240-file static bundle audit passed. All three status browser scenarios passed against the final production build in 20.081 seconds: diagram 7.188 seconds, mind map 6.529 seconds and phone 3.566 seconds. The existing acceptance images were preserved.

Retained fictional fixture evidence: [Status for selected diagram objects](acceptance/object-status.png) and [Done on a 320 px phone](acceptance/object-status-mobile.png). No actual user data is included.

## Build with Lovable

[Build with Lovable](LOVABLE.md) turns a diagram into an application brief with the user's own instructions. Every included object has a distinct reference, including duplicate titles. Relationships retain their labels, types and directions; loops and crossing connections remain explicit. Planning status does not remove a feature, and parent hierarchy is described without inventing workflow order. The user reviews the complete prompt before opening Lovable with an unsent prefilled prompt.

[lovable.test.ts](../frontend/tests/lovable.test.ts) covers 11 exporter cases, and [lovable-dialog.test.tsx](../frontend/tests/lovable-dialog.test.tsx) covers 10 component cases. These 21 new cases bring the frontend suite to 200. All 200 cases passed across the full suite and final focused component run. Go race tests and vet, formatting, the production TypeScript/Vite/Hugo/OpenAPI/Go build and the 240-file static bundle audit passed. The offline shell contains 18 local assets.

All three new [Lovable browser scenarios](../frontend/tests/e2e/lovable.spec.ts) passed against the production build in 14.1 seconds. They verify duplicate titles, a collapsed branch, reverse directions, loops, Done features, responsibilities, exact selection boundaries, persisted instructions and the saved scope after IndexedDB reload. The downloaded brief matches the preview exactly. The new-tab URL matches the complete encoded prompt fragment; its navigation is fulfilled by the isolated test browser, so no live upload or Lovable build occurs.

The CSV scenario includes schema and group summaries, retains a manual relationship to a group outside the current view and compares original source rows in IndexedDB. Raw source cells and arbitrary metadata are absent from the brief. The 320 px phone scenario opens the entry through More tools, keeps the dialog within the viewport and verifies that instructions above 50,000 characters remain complete in the preview and download while the oversized link is disabled. The complete 37-scenario browser suite is part of GitHub CI; this section records the three focused cases that ran locally.

Retained fictional fixture evidence: [Lovable application brief and instructions](acceptance/lovable-handoff.png). No actual user data is included.

## SQL schemas as connected diagrams

[SQL import](SQL_IMPORT.md) supports dropped/selected SQL or DDL files and pasted scripts with an explicit preview before project creation. Common CREATE TABLE and ALTER ADD definitions produce ordinary database objects with ordered column types, nullability, primary/unique keys and foreign-key column pairs/actions. Composite, forward and self references retain their meaning. Missing table definitions and unknown referenced columns stay explicit. Unsupported migration changes produce notes; no SQL is executed or connected to a database.

The 33 parser cases cover PostgreSQL/MySQL/SQL Server syntax, arrays, quoted and qualified identifiers, same-name schemas, composite keys, inline/table constraints, ALTER ADD, missing targets, comments, routines, dollar strings, COPY payloads, malformed input and byte/table/column/relationship limits. Large INSERT payloads are streamed without building row token arrays. Source SQL, inserted rows, defaults, CHECK expressions and routine contents do not enter the generated graph. ENUM type labels remain schema. Dialog/worker cases cover explicit preview/create, cancellation, input replacement, stale results, timeout and transaction errors. Rendering, schema-only Lovable export, reconnect history and JSON/backup preservation have separate regressions.

The full frontend suite passed all 288 unit/component cases. Go race tests and vet, formatting, TypeScript/Vite/Hugo/OpenAPI/Go production build and the static audit passed. The audit found 246 application files with no user data; the offline shell contains 24 local assets, including SQL parsing and layout dependencies. Self connections use a rounded path outside the card for all handle pairs, preserving labels, arrows, style and interaction. Reconnecting a parsed foreign key removes the original column binding; undo restores it.

All three [SQL browser scenarios](../frontend/tests/e2e/sql.spec.ts) passed against the final production build, alongside the existing CSV draft/drop replacement and PNG/PDF export scenarios. The SQL file scenario verifies preview without persistence, generated columns/keys/three relationships, object status, edited connection style/label, reconnect/undo, reload, lossless JSON and schema-only Lovable text. It checks that the self-reference path exits the card and that its path/label produces pixels outside the card in a complete PNG export. The 320 px phone scenario covers pasted input, malformed/SELECT-only rejection, missing definitions, unresolved keys and complete column details without page overflow. A fictional 100,000-row SQL dump is imported after an offline reload: animation frames continue during worker analysis, and the saved one-table/two-column graph contains none of the row payload. This fixture is a functional acceptance check, not a performance guarantee for arbitrary scripts or devices.

Retained fictional evidence: [SQL tables and foreign-key properties](acceptance/sql-schema.png). No actual user data is included. The complete browser suite remains part of GitHub CI; S3/CloudFront publication remains manual.

## Connected sources, repeatable views and source review

[Analysis workflows](ANALYSIS_WORKFLOWS.md) describes relationship neighbors and
shortest paths, explicit CSV column matches, named analysis views, reviewed source
refreshes, and aggregate explanations with quality evidence. All source rows and
saved views remain in IndexedDB; source files are shared between views rather
than copied into every saved perspective.

The connected-source browser fixture drops a 2,001-row customer file and a
100,000-row order file together. It checks explicit matching, duplicate customer
keys without inflated order totals, an unmatched order key, related-customer
focus, original source row numbers in aggregate explanations, and restoration
after reload. The quality fixture checks original strings merged by regex
cleanup and excluded/ambiguous numeric cells.

The refresh fixture replaces 100,000 keyed CSV rows, reviewing additions,
changes, removals and column mappings before applying. It verifies preserved
object identity, notes, status, geometry, pen strokes, manual relationships,
undo, reload and saved views. A separate SQL fixture reviews foreign-key and
table changes while preserving surviving annotations and undo. Multiple-source
backup and named-view scenarios verify that switching perspectives retains
current annotations and complete native sources.

These large fixtures are functional checks on the test machine, rather than a
performance guarantee for arbitrary files or devices. Calculation and previews
use workers with cached source data, bounded evidence pages and rendered groups.
Display limits never limit aggregate totals.

Verified locally on 2026-10-06 with the production build in system Chrome. The
full frontend run passed 363 unit/component cases, followed by passing targeted
regressions for selection pruning and stable analysis-dialog mounting. Formatting,
TypeScript, Go race tests/vet and the production build passed; the static audit
found 253 application files and a 31-asset offline shell, with no user data.
All 45 distinct browser scenarios passed across the full run and final six-case
rerun. The rerun kept the existing 5,000-object performance thresholds unchanged.
The final 100,000-row source-refresh review took 1,229 ms, with 69 animation frames
and a largest frame gap of 100 ms on this machine.

## The same diagram in 2D and 3D relief

Activating 3D lifts the existing diagram objects into shallow relief cards with
their existing appearance printed on each front face. The face capture uses
the actual 2D node renderer, including its text, colors, icons and status.
Object positions, widths, heights and
relationships follow the 2D diagram; switching views does not rearrange a mind
map into a new layout. Turning the camera rotates the complete diagram and its
text together, so a ten-degree turn shows the same cards from an oblique angle.
The same canonical objects retain their notes, status, parent hierarchy and
relationships. Returning to 2D and exporting PNG/PDF preserves the original
diagram overview. The saved camera and optional object depth remain separate
from the canonical 2D geometry.

The fictional Truck lifecycle example contains 25 objects and 24 relationships:
one root, six lifecycle stages and three subtopics per stage. Manufacturing,
delivery, operation, maintenance, second life and recycling occupy the same
arrangement in the flat overview and the rotatable relief view.

The seven [spatial browser scenarios](../frontend/tests/e2e/spatial.spec.ts) cover
rotation and saved camera state while editing objects, statuses and connections;
MCP creation and population with nonblank canonical 2D PNG/PDF exports and JSON
round trips; offline reload and full workspace backup restoration; usable
Return to 2D controls at 320 px; recovery of the complete saved 2D diagram when
the deferred 3D module cannot load; and an interactive relief mind map with
2,501 ordinary cards and 2,500 relationships. A dedicated three-card fixture
starts in 2D, checks identical relative placement and card aspect ratios from
the front, compares a rendered Rocket icon against its original 2D pixels, then
uses the actual ten-degree tilt control. Its projected front faces become
perspective trapezoids, their text stays attached to those faces, and a real
WebGL pointer selects the correct object. Returning to 2D compares every node
and relationship to the original records.

The [navigation browser scenario](../frontend/tests/e2e/spatial-navigation.spec.ts)
uses actual pointer drags on the visible Move, Rotate and Scale gizmo. It checks
rotation at a fixed target and distance, equal camera/target displacement during
pan, uniform zoom, keyboard axis control and Z-axis roll restored into the actual
WebGL camera after reload. All canonical node and relationship records remain
unchanged. Unit regressions cover turns after roll, rotation from the named Top
view, camera bounds, JSON/database/backup preservation and rejection of invalid
up vectors.

The large fixture checks actual rendered counts, front-face text visibility
when viewed from the front and its absence when viewing the backs, focus of a
searched object, and unchanged 2D geometry and relationships. It is a functional
check on the test machine, rather than a performance guarantee for arbitrary
devices or graphs.

The full frontend run passed 487 unit/component cases. Formatting, Go race tests
and vet, and the TypeScript/Vite/Hugo/OpenAPI/Go production build passed. The
static audit found 262 application files and a 33-asset offline shell with no
user data. All eight distinct spatial browser scenarios passed against this
production build, including the final three-case rerun for the gizmo and direct
canvas navigation. The visual review uses the actual relief renderer and native
card appearance.

Retained fictional fixture evidence:
[Truck lifecycle in 3D](acceptance/spatial-truck-lifecycle.png),
[The same 2D cards turned ten degrees](acceptance/spatial-relief-10deg.png),
[Move, Rotate and Scale controls](acceptance/spatial-navigation-controls.png),
[2,501-object mind map](acceptance/spatial-2501-mindmap.png),
[Canonical 2D export](acceptance/spatial-2d-export.png) and
[320 px phone 2D overview](acceptance/spatial-phone-2d.png).
No actual user data is included. S3/CloudFront deployment remains manual.

## SELECT query diagrams and consolidated main

The SQL importer now distinguishes SELECT/WITH queries from table definitions.
An anonymized service-contract fixture exercises 26 JOIN operations, 29 scoped
source aliases, two derived SELECTs, DISTINCT, CASE, functions, chained casts,
complex AND/OR filters and repeated output names. It produces 32 ordinary diagram
objects and 58 connections, including a second dependency for a JOIN condition
that refers to two earlier aliases. Source columns are observed references rather
than invented schema definitions. Duplicate names and uncertain references remain
explicit warnings.

Query cards keep the normal colors, icons, status and renderer. Properties exposes
full expressions and clauses with paginated column lists. JSON/backup imports
preserve query metadata and real endpoints; clipboard copies get fresh logical
scopes so repeated pastes cannot accidentally share an alias identity. Reconnecting
a parsed SQL edge removes its old query binding, and undo restores it. Markdown
and Lovable use typed query summaries, including literal expression/filter values.
Large query graphs use a non-overlapping grid after 300 objects.

REST/MCP `POST /sql/preview` is permitted in read-only mode and writes no query
diagram. `POST /sql/diagrams` requires write permission, imports transactionally
and opens the result. Revocation, cancellation, invalid syntax/metadata and
unsupported query constructs are tested without partial records. OpenAPI, API,
data model, import/export, privacy, Lovable and user help are updated.

The complete frontend run passed 543 cases in 60 files (one worker and a 20-second
Vitest timeout on the shared macOS machine; performance assertions were retained). Final SQL/parser/API/UI
checks passed 102 cases across six files, followed by all ten integration cases
after the large-graph layout regression. Go race tests and vet, formatting and the
production TypeScript/Vite/Hugo/OpenAPI/Go build passed. The static audit found
262 application files and a 33-asset offline shell. All 56 distinct browser cases
passed: the five SQL/query and related-data cases, followed by the remaining 51
editor/export/privacy/status/spatial cases. The final 51-case run took 14.3 minutes.
The CSV related-scope test now waits for the committed filter before opening its
measure explanation, avoiding a stale Saved state while its analysis worker runs.
The final sharing-text correction passed 21 Lovable/integration cases and a fresh
production build; all three SELECT browser cases then passed again in 15.5 seconds.

Retained fictional fixture evidence: [SELECT result and connections](acceptance/sql-query.png)
and [SELECT properties at 320 px](acceptance/sql-query-phone.png). No real user SQL
or database records are included. All completed analysis and 3D work is consolidated
on `main`; [AGENTS.md](../AGENTS.md) records the main-only workflow and manual
S3/CloudFront deployment preference.

## 2026-10-06: Code dependency diagrams and toolbar menus

The code importer offers structural analysis for all 50 requested language IDs.
It accepts pasted scripts, multiple files and folders, with explicit language
selection for ambiguous extensions. File overview and Declarations and
dependencies produce native editable objects, source locations and typed
connections with syntax, heuristic or unresolved confidence. Focus keeps a
matching path/name and its immediate neighbors. Local workers bound input,
structure, graph size and execution time; they never run imported code.
Original source, comments and ordinary literal values remain temporary. Saved
identifiers and paths can still be sensitive.

REST/MCP language discovery and preview/create endpoints share the browser
analyzers and transactional repository. Read-only preview saves no graph;
creation requires write access, and revocation cancels pending analysis.
Strict metadata survives native JSON, backups and clipboard remapping. Text
and Lovable exports use explicit code metadata allowlists and retain uncertainty
and analysis notes. Reconnecting an analyzed edge removes stale source evidence.
API, MCP, OpenAPI, data model, privacy, export and user documentation agree.

Analysis, lexical handling, language families, worker lifecycle, file import
routing, code UI sections, SQL/code repository commands and backend schemas
are separate modules. Existing editing, status, pen, relationship exploration,
2D/3D and exports continue to use the same native diagram model and renderers.

The old Data popup was clipped by the scrolling toolbar. Explore data and the
phone's More tools now use a viewport-bounded body portal. The menu explains
CSV/SQL tools and disables unavailable checks; Examples contains the separate
truck fixture. SELECT quality checks report duplicate output names and uncertain
references without claiming database validation.

The new 3D-to-2D regression compares card, title and wrapper transforms plus
stored nodes through three transitions, including cancelled face captures and
rotated views. The user's intermittent skewed-node case has not been reproduced;
this is regression coverage, not evidence that that specific bug is fixed.
Input/output cards retain their intentional slanted 2D shape.

The unit/component corpus passed 729 cases in 73 files: 723 cases in the complete
run, the two contract cases after correcting their test-environment file path,
and four additional catalog-capability cases. The full run used one worker and
a 20-second Vitest timeout on the shared macOS machine; stored test defaults and
performance assertions were retained. Formatting, Go race tests and vet, and the
TypeScript/Vite/Hugo/OpenAPI/Go production build passed. The final static audit
found 265 application files and a 36-asset offline shell with no user data files.

All 63 distinct browser cases passed. The initial complete run passed 61 cases
in 19.7 minutes; two test assertions needed corrections for an automatically
saved fitted viewport and the mobile menu's new accessible selector. After the
final catalog/documentation correction and fresh production build, all seven
code-import/API and quick-work cases passed in 33.9 seconds, including both
corrected cases. Coverage includes 100,000-row data, native edits and links,
permissions, exports, privacy/offline/backup behavior, constrained desktop and
phone menus, actual 3D navigation, unchanged 2D transitions and a 2,501-card
mind map. Historical screenshot fixtures were retained. Work stays on `main`;
S3/CloudFront deployment remains manual.

## 2026-10-06: Readable 3D cards, object movement and MCP discovery

Native 2D captures now cover both physical card faces. Back text retains its
reading direction, styles and icons; front/back pairs share GPU resources and
count as one card within the 120-card detail budget. Tests verify normals, UV
orientation, picking and exactly-once resource disposal.

Move objects separates object dragging from camera navigation. GPU previews
move selected nodes, nested group descendants, connection lines, arrows and
labels without saving partial placement. Release commits one undoable command;
Escape and pointer cancellation restore the previous view. Existing 2D geometry
remains the export source, and 2D moves now shift explicit 3D X/Y while retaining
Z. Tests include API conflicts, atomic rejection, editor/storage synchronization,
timeline-origin changes and shared-geometry bounds updates.

Settings separates the real website origin and its documentation URL from the
local Codex MCP endpoint and advanced browser WebSocket address. Copyable setup
instructions exclude tokens. MCP announces native 2D and requested 3D through
initialization, the read-only documentation tool and resources. Both guide and
complete OpenAPI discovery work without a connected browser. The local bridge
was restarted with the existing loopback address and hosted-app origin; live
read-only checks verified both tools, resource capability and the full contract.

758 distinct unit/component cases are verified across 76 files. The full run
passed 757 cases; after the final timeline/group adjustments, all 67 relevant
spatial cases passed, including the remaining timeline regression. Formatting,
Go race tests and vet, TypeScript and the production build passed. The final
static audit found 265 application files and 36 offline-shell assets, with no
user data files.

All 22 relevant browser cases passed in 5.6 minutes: documentation discovery,
public HTTPS/TLS settings and grants, phone layout, 3D drag/undo/cancellation from
both sides, an actual 2D drag followed by 3D and reload, camera gizmos, repeated
2D/3D transitions, PNG/PDF/JSON export, offline backups, rendering/download
fallbacks and a complete 2,501-node/2,500-link relief diagram with readable back
faces. Historical screenshot fixtures were retained. Work stays on main and
S3/CloudFront deployment remains manual.

## 2026-10-06: Visio and draw.io file import

The file picker and one-file drop accept `.vsdx` and `.drawio`. Local worker
analysis previews all source pages without writes; users choose and name one
page before creating an ordinary editable native graph. The bounded thumbnail
does not discard objects from the imported graph. Geometry, groups, text, safe
links and recognized connection directions/patterns/colors are retained.
Special stencils, source rotations, rich formatting and connector routing can
be simplified with notices. Unbound connectors are omitted with notices.

Draw.io supports compressed, escaped and embedded XML pages. Visio resolves OPC
parts, page/master relationships and cached master/style properties, converts
page coordinates and keeps recognized declared connections. XML, ZIP expansion,
hierarchy, page and total object/relationship budgets are checked before saving.
Source data and unselected pages remain temporary. Scripts, external resources
and embedded image/object bytes are neither executed nor fetched.

The exact read-only `/diagram-files/preview` command and selected-page `/import`
contract agree across REST, MCP, browser repository and generated OpenAPI.
Multipage input requires a known page ID; invalid input and unknown selection
leave storage untouched. Pending analysis cancels on access revocation and
write/consent checks run again before creation. Parser, ZIP/XML, worker client,
storage command and UI responsibilities live in separate modules.

All 887 unit/component cases in 82 files passed in 200.7 seconds. Formatting,
Go race tests and vet, TypeScript and the TypeScript/Vite/Hugo/OpenAPI/Go
production build passed. Runtime dependencies are pinned; the saxes npm package
omits its license, so its exact upstream notice is retained offline and copied
by the notice generator. After notice regeneration the static audit contains
269 application files and 39 offline-shell assets, with no user data files.

All 25 relevant browser cases passed: five new import cases plus 20 regressions
for native edits, group/connection behavior, SQL/code/CSV imports, read/write
grants, discovery, toolbar menus and rendered exports. The new cases cover real
ZIP worker parsing, multipage draw.io selection, source preview without writes,
cancel/error atomicity, persistence, phone layout, MCP preview/create access,
actual 3D/2D transitions and nonblank PNG/PDF output. The first picker assertion
was corrected to distinguish the page select from its preview image by exact
accessible name; no application correction was needed. Preview screenshots
were visually inspected. Historical screenshot fixtures were retained.

Seven real upstream `.vsdx` samples at
[dave-howard/vsdx commit 6703e6c](https://github.com/dave-howard/vsdx/tree/6703e6c2c906bea4051f43525ec9af9dcf735c13/tests)
also parsed and validated: 14 pages, 53 objects, nine groups and all four declared
connections. Six identify Microsoft Visio as the authoring application.
The Lucidchart-exported master sample contains three lines with numeric endpoints
and no declared object connections; these are omitted with notices. This is
compatibility evidence for those samples, not a claim of exact stencil fidelity.
No upstream or user source file was added to the repository.

The local bridge was restarted with its existing loopback bind and hosted-app
origin. Live read-only MCP checks confirm import discovery during initialization,
the preview/page-selection guide and the complete updated OpenAPI schema
(192,706 bytes), without modifying browser records.

Work stays on main; deployment to S3/CloudFront remains manual.

## 2026-10-06: Configurable local import size and dialog spacing

Settings now saves a browser-local integer import limit from 50 through 1024
MB (MiB), with 50 MB as the supported default and 1 GiB as the hard ceiling.
Only imports up to 50 MB are supported and guaranteed. Higher limits show an
experimental warning in Settings and large-source import dialogs; format,
row/object counts and analysis deadlines remain enforced. Shared nonallocating
UTF-8 byte counting and captured worker budgets replace the former fixed byte
checks across CSV, source refresh, SQL, code, diagram files and native imports.
Backup file reads also check the selected limit before reading. Code checks
both each file and the complete project. Compressed diagram expansion remains
bounded, scaling with the preference up to an absolute 1 GiB.

The preference persists in IndexedDB, is excluded from exported backups, and
Merge/Replace ignore incoming values while retaining the destination's own
limit. Invalid numeric values, extra setting fields and failed storage writes
cannot replace the committed preference. GET returns the effective integer,
defaulting to 50 for absent/invalid saved data; PUT validates an exact value
payload. REST/MCP commands capture the browser preference rather than accepting
an override in source input. Their JSON/WebSocket envelopes remain 32 MiB.
API, generated OpenAPI, MCP discovery and user/privacy/storage docs agree.

Common dialog styles moved to a separate CSS module. Modal block spacing,
paragraph line height, label/control gaps, touch checkboxes and wrapped action
rows are consistent; source refresh and nested SQL quality text receive explicit
spacing. The new browser cases measure those gaps and confirm no horizontal
overflow at 320 pixels. Phone Settings, source refresh, SQL diagnostics and the
large-file warning screenshots were visually inspected.

The complete frontend run passed 922 cases across 86 files in 189.5 seconds.
After the final batch CSV fix, all 65 relevant cases passed: the first file is
deferred while the preference changes, and every file retains the budget that
was captured at batch start. Formatting, Go race tests/vet and the production
TypeScript/Vite/Hugo/OpenAPI/Go build passed. The static audit contains 269
application files and 39 offline-shell assets, without user data files.

All 36 relevant browser scenarios passed across focused runs: three new cases
and regressions for CSV/SQL/code/Visio/draw.io imports, source refresh, quality,
MCP/read-write grants, public HTTPS storage, backups, phone layout and rendered
exports. A real draw.io file slightly above 50 MiB is refused before parsing at
the default, then parses in a worker and persists one native object after the
limit is raised to 60 MB. Its large ignored source comment is not retained.
The 1 GiB setting/validation boundary is tested without allocating a 1 GiB
file; this is not a claim that every browser/format can process that size.

An existing linked-data scenario attempted analysis before search finished its
camera animation and viewport save. Its helper now waits for the selected
object to be centered and for the displayed viewport to match its persisted
coordinates before issuing the next command; totals and focus assertions remain
unchanged. Five subsequent complete 100,000-order runs passed, and the final
two repeated runs of both linked-data and quality cases were green. Historical
screenshot fixtures were retained.

The local bridge was restarted with its existing bind/origin configuration.
Live read-only MCP checks confirm initialization and request-tool discovery,
the import guide, GET/PUT setting contract and the full updated OpenAPI resource,
without changing browser records. Work stays on main and S3/CloudFront
deployment remains manual.

## 2026-10-06: Five understanding workflows

Semantic overview projects the canonical graph into stable summary cards with
status counts and typed, directed relationship aggregates. Expand, Back one
level and Details navigate without replacing original IDs, styles, icons,
positions or connections. The same projection supports 2D, 3D and rendered
exports; canonical JSON/Markdown and the Details pen layer retain their original
coordinates. The reproducible 10,000-node/30,000-edge fixture produces 65 cards
and 393 aggregates, retaining every original reference. Five measured pure
projections have a 438 ms median on the documented host. This excludes browser
painting and GPU rendering and is not a cross-machine frame-rate guarantee.

Relationship questions and modeled impact analysis traverse multiple levels
with direction, type, cycle, uncertainty and depth handling. Paths carry
retained code/SQL/CSV or manual evidence. Analysis runs in a worker, respects
documented size/page limits, preserves HTTP error statuses and rejects stale
focus results. Static relationships are not asserted to prove runtime impact.
Raw CSV measure cells are shared only by an explicitly requested evidence page;
ordinary questions and app briefs exclude them and arbitrary custom metadata.

Named local history supports semantic comparisons, automatic checkpoints before
source refresh and atomic safety checkpoints before restoration. Restore retains
exact canonical 2D/3D positions and IDs. Portable workspace backups include
history and deduplicate immutable source rows; older backups remain supported.
Deferred real WebCrypto regressions revoke MCP grants or storage consent during
snapshot/restore preparation and verify 403 with all history tables and current
graph unchanged. The local UI history remains available with MCP Off. Capacity,
stale-version and failed-checkpoint cases preserve current work.

Storyboards extend numbered presentations with editable multi-object scenes,
highlighted connections, separate narration, ordering, dwell/transition times
and captured 2D/3D views. Saved views require Details and their matching mode;
Auto-fit works in either mode and semantic overview. Playback and film export
reuse local English-default/Swedish narration, subtitles and preload. Temporary
selection, reveal and camera navigation leave the canonical layout intact. The
2D camera now uses a directly cancellable viewport animation instead of queuing
a late fit after pause or cancellation; controller regressions cover that race.

Lovable handoff adds editable reviewed sections and decision answers. Source
facts remain distinct from proposed screens/read APIs, explicit constraints
supply acceptance criteria, and missing behavior becomes an open decision.
The preview is read-only and unsent; the existing copy, download and explicit
Lovable controls complete handoff. SQL export uses shared strict allowlists so
unknown metadata and original scripts cannot leak into the brief.

REST, generated OpenAPI, MCP initialization, tool descriptions and bundled
guide/resources expose all five workflows. An isolated instance of the final
production binary returned the exact 389,729-byte OpenAPI resource and every new
workflow during read-only discovery without a browser or workspace writes.
Implementation is split into overview, questions, history, storyboard and
specification modules, with shared repository command routing.

The complete final frontend run passed 1,154 tests across 118 files. TypeScript,
formatting, Go race tests/vet and the TypeScript/Vite/Hugo/OpenAPI/Go production
build passed. The static audit contains 304 application files and 49 offline
shell assets, with no user data. The benchmark and compact overview screenshot
were checked; summary counts, internal loops, both directed relation types and
readable native cards are visible.

All six new production-browser scenarios passed across focused runs: overview
expansion/back and identical 2D/3D rendered projection; source-backed questions,
read-only MCP preview and Lovable draft persistence; reviewed restoration and
safety checkpoint persistence; storyboard editing/exact saved 2D view; authored
3D view and a decoded, playable 1280×720 scene movie; and Overview capture
guards with Auto-fit highlighting. The original node/edge records and canonical
layouts remain unchanged by presentation and overview navigation.

Across the broad regression run and focused final retries, all 86 distinct
browser scenarios passed. The first broad run passed 72 of 80 older scenarios;
its failures led to the cancellable 2D camera fix, Details reveal fast path and
schema-7 backup expectations. Final runs passed both legacy movie exports, all
nine privacy/backup/grant cases, all three numbered-player cases and the complete
2,501-card/2,500-connection 3D regression. That large case verifies rotation,
readable physical faces, search/edit/focus and return to unchanged 2D geometry;
its screenshot was inspected.

The manual-player fixture now uses a 30-second dwell and asserts that Pause
retains the first node before Forward. Its trace showed a 2.459-second stable
click wait outlasting the former two-second dwell, followed by correct natural
advancement. Runtime timing and short movie assertions remain covered. A final
3D readiness timeout coincided with ReadPixels GPU stalls; the renderer became
ready immediately afterward and the isolated retry passed with the original
time limits. Software-GPU suites were serialized on the development host.

Historical screenshot fixtures were retained. Work is committed directly to
main; S3/CloudFront deployment remains manual and no deployment was triggered.

## 2026-10-06: Piper voice preparation and Chrome video colors

Alan is the default British male Piper voice for new or unset preferences.
Settings previews and saves any of the four catalog voices; existing explicit
English or Swedish selections survive reopening. Alan's pinned model is
63,201,294 bytes, compared with 114,199,011 bytes for the previous default.
REST, generated OpenAPI, MCP initialization and the bundled guide expose the
same catalog and preload contract. An isolated production binary returned the
exact 390,075-byte OpenAPI resource through MCP without workspace writes.

The local Piper adapter awaits initialization and inference failures, warms
both engines and retains ONNX across narration chunks. The pinned phonemizer's
retained stack arguments are bounded by renewing that module at 8 KiB of
encoded arguments or 32 calls, using already downloaded runtime buffers.
Descriptions are split into chunks of at most 240 characters without truncation.
Local runtime downloads report actual byte movement and reject failed HTTP
loads, while compressed responses use decoded byte limits. Shared queued
requests, independent cancellation and retained bounded lookahead avoid
unnecessary restarts on Pause and Forward. Preload shows completed work and
actual phase progress; opaque initialization does not invent a percentage.

Video export supplies explicit opaque sRGB/RGBA pixels to the encoder and
awaits the same cleanup promise after every cancellation request. The reported
pink output could not be reproduced in the baseline on the development host;
the new path is a compatibility fix, not a proven diagnosis of that device.
Both production Chrome color scenarios passed for native 2D and 3D movies,
including RGB/neutral swatches and unchanged canonical diagrams. Independent
FFmpeg decoding of eight early, middle and final frames measured mean RGB
error 0.337–0.491 on the 0–255 scale, with no pink neutral pixels. Source and
decoded frames were visually inspected for readable cards, relationships and
captions.

Real Chrome synthesis downloaded both pinned Alan and Swedish models from
Hugging Face. Cold Alan preload prepared the engine and three narrations in
25.9 seconds; cached Play reached playback in 497 ms. A warm 35-narration sweep
took 37.2 seconds with one worker, no terminations, one ONNX session and bounded
phonemizer renewal, without refetching the model. Swedish preview completed in
10.4 seconds. Both 22,050 Hz WAVs contain nonzero PCM; measured RMS was 0.140
for Alan and 0.102 for Swedish. These are measurements on the development host,
not timing or subjective voice-quality guarantees for other devices.

Browser checks passed monotonic preload/model-byte progress, WebAudio
Play/Pause/resume, unchanged canonical graph, failed local data-file loading
and retry, explicit download cancellation and retry, and foreground Play joining
active preload without duplicate synthesis. A local data-file 404 surfaced in
4.47 seconds instead of waiting for the watchdog. No browser page errors or
outbound narration text were observed. The canonical comparison waits for the
ordinary initial viewport save before taking its baseline; playback itself
retains that exact graph. Preload layout was inspected and its label/bar spacing
was improved.

A warm Alan player also handed off to a real narrated 2D movie in 5.23 seconds.
The 475,072-byte MP4 decoded as AVC/AAC with a 7.445-second timeline, audio RMS
0.087 and peak 0.400, while preserving the saved graph. Chrome measurements
confirmed the preload label and full-width bar are separated by 6 pixels.
The opt-in browser acceptance runner is split into server, fixture, probe,
speech-case and movie modules, and refuses an occupied port. Normal tests and
CI do not download speech models.

A final portable run from a fresh temporary directory passed all six speech
acceptance cases without existing model fixtures. Cached Play started in
556 ms; the exported movie decoded with nonzero AAC audio, and both model and
config cache files matched the pinned SHA-256 hashes. The local MCP bridge was
restarted with the updated binary while preserving its existing configuration.

The final frontend suite passed 1,180 tests across 120 files. Formatting,
TypeScript, Go race tests/vet and the production build passed. Six existing
player/storyboard Chrome regressions passed, including narrow-screen controls,
3D playback, MCP permissions, captured scene views and a decoded storyboard
movie. The static audit contains 304 application files and 49 offline-shell
assets, without user data. Work remains directly on main and deployment to
S3/CloudFront remains manual.

## 2026-10-07: Deep product audit

The audit ran on macOS with Node 22 and the installed Google Chrome, using
isolated test profiles and synthetic diagrams. It covered editing and undo,
IndexedDB persistence and backup/restore, CSV exploration and relationships,
SQL/code visualization, native/Draw.io/Visio imports, permissions and privacy,
REST/MCP, 2D/3D interaction, walkthroughs and rendered exports.

Verified regressions and fixes:

- Dialogs retained keyboard focus while their controlled inputs updated.
  Previously a changed close callback restarted the focus effect after each
  character. Tab navigation now skips disabled and explicitly hidden controls.
- Invalid native field shapes return a validation error before normalization
  or saving. Malformed imports and REST/MCP mutations leave existing records
  unchanged; nested custom metadata is preserved.
- A pending clipboard read cannot paste into a different diagram or into the
  editor after a modal opens or local-storage consent is revoked.
- Undo/Redo retains canonical node and connection order, preserving diagram
  stacking and inherited mind-map colors. Opening another diagram or creating
  a backup first commits the active inline title draft.
- Linked CSV exploration accepts a valid source with no matching selected
  rows: count is zero and numeric measures are empty. Original source rows,
  notes, status and manual relationships survive clearing the focus.
- SQL output parsing keeps operands after word operators such as NOT, AND,
  BETWEEN, IN and COLLATE in the expression rather than treating them as
  implicit output aliases. Explicit and qualified-column aliases still work.
- Failed background voice preparation can retry at the same walkthrough step.
  Keys that neither edit the diagram nor operate the camera do not pause a
  3D walkthrough.
- 3D movie preparation waits for the complete bounded set of resident card
  textures. A held second-card decode prevents recording the first frame
  until its appearance is ready.
- A failed 3D module download offers a reload that first settles local edits
  and saves. Saving failures retain the open changes. Short-screen 3D panels
  share a scrollable stack without covering each other's summaries; desktop
  sidebar projects and footer actions remain reachable at 780 × 400.

The final unit/component suite passed **1,228 tests in 124 files**, including
48 additional regression tests. Go race tests and vet, Prettier, strict
TypeScript, and the production Vite/Hugo/OpenAPI/Go build passed. The static
audit contains 304 application files and 49 offline-shell assets.

The final complete Chrome E2E run passed **all 95 tests in 17.0 minutes**.
Coverage includes the 100,000-row/2,000-customer CSV fixture, 1,000/5,000-node
2D graphs and the 2,501-card 3D fixture. Two newly added test setup errors were
corrected and checked independently before rerunning the complete suite.
These are checks on the development host, not performance guarantees for
other devices.

An additional real-Piper Chrome acceptance run used the pinned local Alan
model fixture with the production neural runtime. The warm player exported
a 467,700-byte AVC/AAC MP4 in 5.16 seconds. It decoded as a 7.317-second movie
with nonzero audio (RMS 0.081, peak 0.374), no page errors or outbound narration
text, and an unchanged saved graph. Its decoded frame was visually inspected.
Normal tests and CI still do not download voice models.

The previously failing CI 3D object-list toggle was reproduced as overlapping
panels and passes with the corrected layout. API and export documentation,
the 3D/speech guides and the bundled user guide describe the changed behavior.
No API routes or exchange-format versions changed. Work remains directly on
main; deployment to S3/CloudFront remains manual.
