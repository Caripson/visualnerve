# Architecture

The application code can be publicly hosted. IndexedDB is the only persistent application database; normal use needs no backend. The isolated `app.visualnerve.com` workspace stores its content encrypted and opens only after human password/recovery authentication. Existing `www` and staging workspaces remain separate legacy databases until the user explicitly transfers them.

```text
Internet → CloudFront → S3: static app files only
                          ↓ downloaded application
Hugo static shell + bundled React/TypeScript + React Flow in your browser
                       ↕
                 editor state
                       ↕
               WorkspaceStorage
                       ↕
       encrypted adapter → WebCrypto → native IndexedDB
       graph records · owners · settings · templates · CSV sources
       saved history · simulation models/runs/checkpoints

Other profiles and devices have separate databases.

Optional: MCP client → local HTTP/stdio MCP → loopback WebSocket bridge
          → active browser → same session and WorkspaceStorage
```

Normal editor use does not upload workspace records. Deliberate exports, MCP responses sent to a connected client and the reviewed Lovable handoff can disclose the selected content. Downloaded voice-model assets have a separate cache; narration text remains local.

## Boundaries

`hugo/` builds the shell, navigation and documentation. Vite bundles the editor into Hugo's static directory; Hugo produces `public/`. Serve that directory with any static HTTP server. `backend/cmd/visual-nerve` is a convenient static server with an opt-in integration bridge (`--bridge`). `backend/internal/server` keeps only connected sockets and pending requests in memory. It opens no database, writes no application files, and has no repository for graph records. Without a browser, the integration cannot read or edit a workspace.

`scripts/build-app-surface.mjs` produces a separate audited `public-app/` package, with the encrypted-workspace requirement, local Help/API reference and no marketing/Analytics executables. Its production distribution uses a private S3 REST origin, CloudFront OAC, explicit routing and blocking security headers. The package does not redirect, read or delete old-origin workspace data. See [isolated hosting and release gates](docs/APP_ORIGIN_DEPLOYMENT.md).

The canonical TypeScript model is `frontend/src/model/types.ts`. The Go model supplies matching documented integration DTOs, not persistence. The editor separates semantic models, canvas projection/rendering, layout, state/commands, storage, optional integration, and exports. Node renderers remain registered in one extensible registry.

## Module loading and ownership

On the isolated app surface, the entry module mounts `VaultGate` before loading private editor code. `WorkspaceLoader` downloads `WorkspaceSurface` only after unlock and checks the originating session and component lifetime before mounting it. Analysis dialogs, the simulator wizard/model editor, presentation controls and exports have genuine dynamic imports. The repository loads optional analysis/import/simulation command implementations outside native transactions and rechecks the originating capability after each import. Missing optional modules offer a recoverable error; they do not bypass authorization.

Classes own stateful lifecycles: `Workspace` and `Repository` coordinate edits and persistence; `VaultSession`, `VaultCrypto`, `VaultRecordStorage`, `VaultJournal` and record codecs own encryption and durable commits; `SimulationService` owns runs; `PresentationPlayer`, `SpeechService`, `PiperEngine` and `NarrationClipStore` own narration; `VideoExporter` and `VideoCleanupCoordinator` own movie work and settled resource cleanup. React views subscribe to those owners. Rendering and module loading cannot become a second authority for simulation state or session access.

The optional 3D canvas is a lazy-loaded Three.js relief view over the same projection, canonical objects and relationships. Ordinary cards retain their 2D positions and dimensions. Their front textures come from the actual registered 2D node components, preserving text, colors, icons, status and data summaries while the complete diagram rotates. An isolated local renderer captures at most 120 nearby faces with two capture jobs and bounded texture sizes; selected objects are prioritized, and camera changes refresh the resident set. Shared relief geometries and relationship buffers, event-driven rendering and explicit disposal bound rendering work. Spatial metadata retains optional independent world coordinates and camera state; canonical 2D geometry remains the PNG/PDF/SVG export source. Context failure retains a keyboard object list and an immediate return to 2D. See [3D diagrams](docs/SPATIAL_DIAGRAMS.md).

## Persistence and state

The logical workspace schema is version **8**, with 14 stores: six core graph/preferences/template stores, one CSV dataset store, four history stores and three simulation stores. `storage/contracts.ts` provides explicitly scoped transactions and originating-session operations. `storage/database.ts` implements the legacy Dexie backend; `storage/encrypted-database.ts` implements the same contract using physical vault schema **1**, with native `metadata` and `records` stores. All 14 logical stores use authenticated encryption on the isolated app; record/query identifiers use keyed tokens. Bounded chunks support large logical records. Cryptography runs outside short native transactions; revision and revocation checks guard reads, commits and publication. See [schema and limits](docs/ENCRYPTED_WORKSPACE_SCHEMA.md).

`storage/repository.ts` validates and applies graph operations through this contract. `storage/workspace.ts` loads diagrams/owners/preferences and the last project, then connects editor state. UI commands update optimistically and immediately queue database transactions. Saved means the transaction committed; it does not depend on a server or internet connection. Drag and resize gestures commit at their end.

Entity and diagram versions are checked inside transactions. Backend subscriptions notify committed changes across tabs; the encrypted backend also verifies the current durable session/revision before returning records. A stale edit retains its unsaved graph in the editing tab and offers a separate copy, the committed version, or explicit replacement. Unsaved conflict data remains in memory until resolved; export a copy before closing that tab. Normal operation has no graph HTTP requests, polling, secondary store or synchronization database.

Required storage acceptance and workspace preferences use the logical `settings` store. A technical appearance preference is available before unlock; it contains no workspace content. Viewport, grid, snap, timeline scale and entity order are diagram settings. Metadata stays on canonical entities. Selection, filters and bounded undo history are transient UI state. Integration credentials are ephemeral session storage values, excluded from workspace exports. Existing-origin Dexie upgrades preserve the historical database; the isolated origin never opens that legacy database. Storage acceptance is required before graphs load, templates seed, commands run or offline caching is registered; Escape, declining or backup import cannot grant it.

The vault session enforces configurable human-idle and absolute deadlines, cross-tab revocation and originating-operation checks. Locking removes private UI, workers, audio and pending export material; re-entry waits for old resource cleanup. Background/API work cannot renew human activity or inherit a later unlock. Integration returns structured locked errors and requires a fresh human grant after unlock. Password/recovery setup, session policy, content-key rotation, verified encrypted transfer, backup boundaries and cache deletion are described in [storage](docs/STORAGE.md) and [Help](hugo/content/help/settings.md).

Production builds precache the static shell and editor assets in a service worker. This asset cache contains no graph records and bypasses integration requests. After the first visit the editor can reload and save offline. New application assets activate after older tabs close.

## Transactions and scale

Graph replacement, bulk upsert, import, complete workspace restore, subtree deletion, diagram deletion and owner reassignment are atomic. Indexed diagram queries retrieve nodes/edges; compound unique external-ID indexes scope identities by diagram. Bulk puts/deletes handle large graphs, and unchanged records retain their version and references. Validation rejects cycles, foreign references, invalid geometry/dates and unsupported URL schemes before committing.

Transient undo/redo stores bounded entity deltas rather than repeated complete snapshots for pointer movement. Named history and automatic safety checkpoints persist separately in four logical history stores, deduplicating structural snapshots and unchanged CSV rows. Full backups include this saved history; single-diagram JSON exports current content only. React Flow projects parent-relative coordinates while canonical coordinates remain absolute. Group movement shifts descendants; hierarchy is expressed by parentId and edges rather than coordinates. Timelines derive placement from dates. Layout is explicit and undoable. Mind maps render curved colored branches and topic backgrounds at every depth; generic diagrams retain their registered node shapes.

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
