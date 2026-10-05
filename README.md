# Visual Nerve

Visual Nerve is a local-first visual workspace for mind maps, flowcharts, timelines and connected diagrams. The application itself can be publicly hosted, but all diagrams and user-created content are stored only in the user’s browser using IndexedDB. No account or cloud database is required. Opening the same URL on another browser or device does not expose or synchronize your diagrams.

Before the workspace opens, users must explicitly accept local browser storage and offline app caching. Without acceptance, the service cannot be used. Acceptance is remembered in that browser profile, excluded from backups, and removed when all local data is deleted.

Hugo builds the application shell and help pages. React and TypeScript power the editor, React Flow renders the canvas, ELK performs explicit layouts, and Dexie manages IndexedDB transactions. The built site can run on a static HTTP server. An optional Go server serves the files and bridges local REST/MCP commands to an open browser; it stores no application data.

Mind maps use a central topic, colored curved branches and rounded topic backgrounds at every depth, with a balanced layout on both sides. Edit topics directly by double-clicking or F2, extend them with the branch **+** buttons or Tab/Enter, and use **Focus map** to give the canvas the whole workspace. While editing, Tab saves the topic and opens a new child in view. Diagram modes keep their node cards and directional connections. Switching modes preserves the canonical graph.

Click the project name to rename it. Selection actions give quick access to editing, colors, domain icons, duplication and deletion; deleting a whole branch is a separate undoable action. The green theme uses darker text and eight contrasting colors. Sixteen open source Lucide icons cover work, learning, people, health, technology and other areas. On phones, the canvas fills the screen, project navigation opens in a drawer, properties open in a bottom panel, and touch gestures pan and zoom.

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

MCP uses Streamable HTTP at `http://localhost:4317/mcp` and exposes `visual_nerve_request` with `path`, optional `method`, `data` and `workspaceId`. See [API.md](API.md).

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

Use **Settings → Data & Privacy → Export all data** for a dated complete backup of diagrams, nodes, edges, owners, portable settings and templates. **Restore backup** previews Merge or Replace; replacement requires explicit confirmation. Both restore atomically and remap collisions. Consent and MCP grants are never imported. Per-diagram JSON export is also lossless. Clearing this site's browser data deletes the workspace, so retain exported backups. The app creates no server data directory and has no filesystem database.

Existing browser records upgrade in place, including pending edits. The historical IndexedDB name is retained for this purpose; it now contains the canonical tables. If you have data exported by an earlier version, use Import to add it to the browser workspace.

Optional integration configuration: `VISUAL_NERVE_BRIDGE_TOKEN` protects reads and writes; enter it in Settings for the browser session. `VISUAL_NERVE_ADDR` and `VISUAL_NERVE_STATIC_DIR` control serving. For a hosted app, configure its exact `--allowed-origin` and a trusted local TLS bridge; [deployment setup](docs/DEPLOYMENT.md#optional-local-mcp) explains browser requirements. Read [SECURITY.md](SECURITY.md).
Architecture, canonical data and exchange formats are described in [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md) and [EXPORT_FORMAT.md](EXPORT_FORMAT.md). Third-party licenses are listed in [DEPENDENCIES.md](DEPENDENCIES.md).

## License and credit

Created by **Johan Caripson**. Visual Nerve is released under the [MIT License](LICENSE). [Source code on GitHub](https://github.com/Caripson/visualnerve). Third-party libraries retain their respective licenses and notices.

Storage and privacy: [PRIVACY.md](docs/PRIVACY.md), [STORAGE.md](docs/STORAGE.md). Settings includes local storage details, an optional browser retention request and separately confirmed deletion of all local data. Private/incognito sessions may discard data on closing; there is no private-mode detection.
