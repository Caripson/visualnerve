# Architecture

The application code can be publicly hosted. User content is private to its browser profile and IndexedDB is the only persistent application database. No backend is needed for normal use.

```text
Internet → CloudFront → S3: static app files only
                          ↓ downloaded application
Hugo static shell + bundled React/TypeScript + React Flow in your browser
                       ↕
                 editor state
                       ↕
               Dexie / IndexedDB
       graph records · owners · settings · templates · CSV sources
       saved history · simulation models/runs/checkpoints

Other profiles and devices have separate databases.

Optional: Codex → local MCP → loopback WebSocket bridge → active browser → IndexedDB
```

Normal editor use does not upload workspace records. Deliberate exports, MCP responses sent to a connected client and the reviewed Lovable handoff can disclose the selected content. Downloaded voice-model assets have a separate cache; narration text remains local.

## Boundaries

`hugo/` builds the shell, navigation and documentation. Vite bundles the editor into Hugo's static directory; Hugo produces `public/`. Serve that directory with any static HTTP server. `backend/cmd/visual-nerve` is a convenient static server with an opt-in integration bridge (`--bridge`). `backend/internal/server` keeps only connected sockets and pending requests in memory. It opens no database, writes no application files, and has no repository for graph records. Without a browser, the integration cannot read or edit a workspace.

The canonical TypeScript model is `frontend/src/model/types.ts`. The Go model supplies matching documented integration DTOs, not persistence. The editor separates semantic models, canvas projection/rendering, layout, state/commands, storage, optional integration, and exports. Node renderers remain registered in one extensible registry.

The optional 3D canvas is a lazy-loaded Three.js relief view over the same projection, canonical objects and relationships. Ordinary cards retain their 2D positions and dimensions. Their front textures come from the actual registered 2D node components, preserving text, colors, icons, status and data summaries while the complete diagram rotates. An isolated local renderer captures at most 120 nearby faces with two capture jobs and bounded texture sizes; selected objects are prioritized, and camera changes refresh the resident set. Shared relief geometries and relationship buffers, event-driven rendering and explicit disposal bound rendering work. Spatial metadata retains optional independent world coordinates and camera state; canonical 2D geometry remains the PNG/PDF/SVG export source. Context failure retains a keyboard object list and an immediate return to 2D. See [3D diagrams](docs/SPATIAL_DIAGRAMS.md).

## Persistence and state

`frontend/src/storage/database.ts` defines schema version 8 with 14 Dexie tables: six core graph/preferences/template tables, one CSV dataset table, four history tables and three simulation tables. Additive upgrades preserve existing browser records. `storage/repository.ts` validates and applies graph operations inside IndexedDB transactions. `storage/workspace.ts` opens IndexedDB, loads diagrams/owners/preferences and the last project, then connects editor state. UI commands update optimistically and immediately queue database transactions. Saved means the transaction committed; it does not depend on a server or internet connection. Drag and resize gestures commit at their end.

Entity and diagram versions are checked inside transactions. Dexie live queries refresh committed changes across tabs. A stale edit retains its unsaved graph in the editing tab and offers a separate copy, the committed version, or explicit replacement. Unsaved conflict data remains in memory until resolved; export a copy before closing that tab. Normal operation has no graph HTTP requests, polling, secondary store or synchronization database.

Theme, required storage acceptance and integration grants are in `settings`. Viewport, grid, snap, timeline scale and entity order are diagram settings. Metadata stays on canonical entities. Selection, filters and bounded undo history are transient UI state. Integration credentials are ephemeral session storage values, excluded from workspace exports. The historical IndexedDB name discovers existing data for in-place upgrades. Storage acceptance is required before graphs load, templates seed, commands run or offline caching is registered; Escape, declining or backup import cannot grant it.

Production builds precache the static shell and editor assets in a service worker. This asset cache contains no graph records and bypasses integration requests. After the first visit the editor can reload and save offline. New application assets activate after older tabs close.

## Transactions and scale

Graph replacement, bulk upsert, import, complete workspace restore, subtree deletion, diagram deletion and owner reassignment are atomic. Indexed diagram queries retrieve nodes/edges; compound unique external-ID indexes scope identities by diagram. Bulk puts/deletes handle large graphs, and unchanged records retain their version and references. Validation rejects cycles, foreign references, invalid geometry/dates and unsupported URL schemes before committing.

Transient undo/redo stores bounded entity deltas rather than repeated complete snapshots for pointer movement. Named history and automatic safety checkpoints persist separately in four IndexedDB tables, deduplicating structural snapshots and unchanged CSV rows. Full backups include this saved history; single-diagram JSON exports current content only. React Flow projects parent-relative coordinates while canonical coordinates remain absolute. Group movement shifts descendants; hierarchy is expressed by parentId and edges rather than coordinates. Timelines derive placement from dates. Layout is explicit and undoable. Mind maps render curved colored branches and topic backgrounds at every depth; generic diagrams retain their registered node shapes.

The canvas renders visible elements and memoizes unchanged projections. PNG/PDF/SVG export mounts an isolated canonical 2D renderer, including off-screen and collapsed branches. Export-local simulation models and compatible view state supply capacity summaries without changing or borrowing the open editor graph. SVG serializes native shapes, text, icons, connections and saved pen strokes; PNG rasterizes the scene and PDF embeds that bitmap. [Export formats](EXPORT_FORMAT.md) documents scope, clipping and limits. ELK layouts run in a worker. Unit and browser tests include 1,000 nodes/2,000 edges and 5,000 nodes.

## Process Simulator

A `process-simulator` graph carries a typed `graph.simulation` model with schema version 1, separate from visual geometry. IndexedDB stores the model by diagram ID and archives captured run models/options/results plus bounded replay checkpoints. Temporary capacity cards and folded process views project the logical model; they are not additional persisted business nodes. Seeded simulation runs execute in a browser worker; headless/MAX removes animation but still requires the browser. UI, API and MCP use the same model and engine. See [Process Simulator](docs/PROCESS_SIMULATOR.md).

## Optional integration

`integration/bridge.ts` connects only after an explicit Off (default), Read only or Read + write choice. Destinations are literal loopback hosts; the server rejects remote peers and checks exact trusted app origins. Public HTTPS apps can use a trusted local TLS bridge. Go forwards REST/MCP requests to the selected active browser. Commands use the same repository validation and commit before acknowledging. Read-only access rejects mutations, including grant escalation. Off or browser disconnection produces clear errors, with no retained data or fallback database. Multiple workspaces need a target ID; MCP never accesses IndexedDB directly.

```text
UI ─────────────┐
MCP ────────────┼→ Workspace → Repository validation → IndexedDB transaction
Import/restore ─┘
```

Complete backup is a deliberate download. Merge retains current projects; Replace and global deletion each require explicit confirmation. Deployment uploads only allowlisted application files; CloudFront has GET/HEAD access and S3 has no browser upload permission. See [storage](docs/STORAGE.md), [privacy](docs/PRIVACY.md) and [deployment](docs/DEPLOYMENT.md).
