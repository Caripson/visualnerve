# Acceptance evidence

Verified on 2026-10-05 in the provided Linux/WSL workspace with Go 1.27.1, Node 24.2.0, Hugo 0.165.0 and Playwright Chromium. The browser persistence architecture is implemented; [REQUIREMENTS.md](REQUIREMENTS.md) maps each specification section to its implementation and checks.

## Final report

| Area | Result |
| --- | --- |
| Architecture | Public static application files served by any static host; private content remains in the browser. S3/CloudFront deployment artifacts are supplied, without provisioning AWS resources. |
| Storage | IndexedDB is authoritative, with seven stores and explicit Dexie v1–v5 upgrades. React holds working state; complete exports and atomic Merge/Replace restore provide manual portability. |
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
