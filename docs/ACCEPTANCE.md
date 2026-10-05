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
