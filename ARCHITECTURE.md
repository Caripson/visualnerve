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
       diagrams · nodes · edges · owners · settings · templates

Nothing is uploaded. Other profiles and devices have separate databases.

Optional: Codex → local MCP → loopback WebSocket bridge → active browser → IndexedDB
```

## Boundaries

`hugo/` builds the shell, navigation and documentation. Vite bundles the editor into Hugo's static directory; Hugo produces `public/`. Serve that directory with any static HTTP server. `backend/cmd/visual-nerve` is a convenient static server with an opt-in integration bridge (`--bridge`). `backend/internal/server` keeps only connected sockets and pending requests in memory. It opens no database, writes no application files, and has no repository for graph records. Without a browser, the integration cannot read or edit a workspace.

The canonical TypeScript model is `frontend/src/model/types.ts`. The Go model supplies matching documented integration DTOs, not persistence. The editor separates semantic models, canvas projection/rendering, layout, state/commands, storage, optional integration, and exports. Node renderers remain registered in one extensible registry.

The optional 3D canvas is a lazy-loaded Three.js view over the same projection, canonical objects and relationships. Spatial metadata supplies independent world coordinates and camera state; 2D geometry remains the export source. Bounded scene construction, shared geometries, event-driven rendering and explicit disposal keep the view usable over large data diagrams. Context failure retains a keyboard object list and an immediate return to 2D. See [3D diagrams](docs/SPATIAL_DIAGRAMS.md).

## Persistence and state

`storage/database.ts` defines the seven Dexie tables and upgrades existing browser data in place. `storage/repository.ts` validates and applies graph operations inside IndexedDB transactions. `storage/workspace.ts` opens IndexedDB, loads diagrams/owners/preferences and the last project, then connects editor state. UI commands update optimistically and immediately queue database transactions. Saved means the transaction committed; it does not depend on a server or internet connection. Drag and resize gestures commit at their end.

Entity and diagram versions are checked inside transactions. Dexie live queries refresh committed changes across tabs. A stale edit retains its unsaved graph in the editing tab and offers a separate copy, the committed version, or explicit replacement. Unsaved conflict data remains in memory until resolved; export a copy before closing that tab. Normal operation has no graph HTTP requests, polling, secondary store or synchronization database.

Theme, required storage acceptance and integration grants are in `settings`. Viewport, grid, snap, timeline scale and entity order are diagram settings. Metadata stays on canonical entities. Selection, filters and bounded undo history are transient UI state. Integration credentials are ephemeral session storage values, excluded from workspace exports. The historical IndexedDB name discovers existing data for in-place upgrades. Storage acceptance is required before graphs load, templates seed, commands run or offline caching is registered; Escape, declining or backup import cannot grant it.

Production builds precache the static shell and editor assets in a service worker. This asset cache contains no graph records and bypasses integration requests. After the first visit the editor can reload and save offline. New application assets activate after older tabs close.

## Transactions and scale

Graph replacement, bulk upsert, import, complete workspace restore, subtree deletion, diagram deletion and owner reassignment are atomic. Indexed diagram queries retrieve nodes/edges; compound unique external-ID indexes scope identities by diagram. Bulk puts/deletes handle large graphs, and unchanged records retain their version and references. Validation rejects cycles, foreign references, invalid geometry/dates and unsupported URL schemes before committing.

History stores bounded entity deltas, not repeated complete snapshots for pointer movement. React Flow projects parent-relative coordinates while canonical coordinates remain absolute. Group movement shifts descendants; hierarchy is expressed by parentId and edges rather than coordinates. Timelines derive placement from dates. Layout is explicit and undoable. Mind maps render curved colored branches and topic backgrounds at every depth; generic diagrams retain their registered node shapes.

The canvas renders visible elements and memoizes unchanged projections. Export mounts an isolated full renderer, including off-screen and collapsed branches. ELK layouts run in a worker. Unit and browser tests include 1,000 nodes/2,000 edges and 5,000 nodes.

## Optional integration

`integration/bridge.ts` connects only after an explicit Off (default), Read only or Read + write choice. Destinations are literal loopback hosts; the server rejects remote peers and checks exact trusted app origins. Public HTTPS apps can use a trusted local TLS bridge. Go forwards REST/MCP requests to the selected active browser. Commands use the same repository validation and commit before acknowledging. Read-only access rejects mutations, including grant escalation. Off or browser disconnection produces clear errors, with no retained data or fallback database. Multiple workspaces need a target ID; MCP never accesses IndexedDB directly.

```text
UI ─────────────┐
MCP ────────────┼→ Workspace → Repository validation → IndexedDB transaction
Import/restore ─┘
```

Complete backup is a deliberate download. Merge retains current projects; Replace and global deletion each require explicit confirmation. Deployment uploads only allowlisted application files; CloudFront has GET/HEAD access and S3 has no browser upload permission. See [storage](docs/STORAGE.md), [privacy](docs/PRIVACY.md) and [deployment](docs/DEPLOYMENT.md).
