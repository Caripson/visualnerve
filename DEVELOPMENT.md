# Development

Install Go ≥1.26, Node ≥22.12, npm and Hugo ≥0.140. `./dev.sh` builds and starts the static server. `./dev.sh --watch` serves the editor through Vite at localhost:5173. Add `--bridge` to either command to enable optional integration; browser Settings must enable it too. Restart Go after backend changes.

```sh
./scripts/test.sh
./scripts/test.sh --e2e
./build.sh
./bin/visual-nerve --static ./public
```

Install browser test dependencies once: `cd frontend && npx playwright install --with-deps chromium`. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH selects an existing Chromium binary. E2E uses its own server on 127.0.0.1:4327 and isolated browser contexts, never the user's workspace. The integration fixture opens a browser first; HTTP requests are forwarded to that browser and committed in its IndexedDB. Static/offline scenarios disable integration and verify no graph network requests.

Unit tests use fake-indexeddb and real Dexie transactions. They verify six-table schema, upgrades from existing records, templates, graph ordering/metadata/viewport, versions, rollback, hierarchy/groups, owner reassignment, backup/restore, collisions, indexed external IDs, 5,000 records and optimistic controller behavior. Browser tests exercise editing, deep mind maps, touch/mobile, multiple tabs, offline reload, layout, exports, restore and optional REST/MCP integration. Go tests verify static serving, bridge lifetime, MCP forwarding, host/origin/token checks and canonical DTO validation.

Persistence changes belong in frontend/src/storage. Evolve the schema with a new Dexie version and a transactional upgrade; preserve older installed data. Keep canonical models, integration DTOs, docs/openapi.yaml and contract tests consistent. Multi-entity operations must roll back completely on failure. Use bulkPut/bulkDelete and diagram/external-ID indexes rather than individual writes per entity.

Add node kinds through the canonical type list and nodes/registry.tsx. Preserve separation of graph semantics, coordinates and rendering. Run `npm run format` for frontend files; format:check is included in the test script. Use gofmt for Go. build.sh regenerates OpenAPI and license notices, bundles React, builds Hugo and its offline shell, then compiles the static/bridge binary.

Configuration: VISUAL_NERVE_ADDR, VISUAL_NERVE_STATIC_DIR and optional VISUAL_NERVE_BRIDGE_TOKEN. Runtime flags: --addr, --static, --dev and --bridge. The server has no database/data-directory configuration. Build artifacts, dependency directories, browser reports and local environment files are ignored by git.

## Origins and privacy tests

`http://localhost:1313`, `http://localhost:5173`, `http://localhost:4317`, `http://127.0.0.1:4317` and `https://visualnerve.example.com` each have separate IndexedDB databases. Development data does not appear in production. Export/import deliberately when changing profile or origin. Do not use a real user browser profile in tests.

The browser suite also starts a read-only HTTPS static fixture on port 4340 and a separate loopback TLS MCP bridge on 4329. `public-app.test` resolves to loopback only inside isolated Chromium test processes; no public DNS or AWS resources are created. Self-signed test certificates and relaxed certificate checks are test-only; real MCP setup needs trusted local certificates. Persistent-profile acceptance tests create and delete temporary browser profiles outside the repository and actually close/reopen Chromium.

Privacy scenarios prove explicit consent cannot be dismissed/bypassed, same-URL profile isolation, no remote persistence requests, manual backup portability, confirmed replacement/deletion, read-only/write/Off MCP and browser-closed errors. Normal browser requests are audited for method and destination. Schema tests cover v1/v3 upgrades, replacement rollback and excluded grants/consent. Deployment tests verify canonical redirects, read-only infrastructure and rejection of backups in the app bundle. See docs/REQUIREMENTS.md and docs/ACCEPTANCE.md.

Additional runtime flags: --allowed-origin (repeatable), --tls-cert and --tls-key. Environment counterparts are VISUAL_NERVE_ALLOWED_ORIGINS (comma-separated), VISUAL_NERVE_TLS_CERT and VISUAL_NERVE_TLS_KEY. Bridge use stays loopback-only. Static hosting needs no Go process. See docs/DEPLOYMENT.md.

## Module size and code analysis

Work on `main` as specified in AGENTS.md. Keep new functionality separated by responsibility rather than adding language switches, import UI or analysis endpoints to the largest files. Code analysis lives in `frontend/src/code`: contracts/catalog, lexical utilities, program families, specialized families, graph resolution/layout and cancellable worker client. Import routing is in `frontend/src/imports`; SQL/code API commands are in `storage/analysis-commands.ts`. Import dialog subcomponents, card summaries and Properties sections are independent. Backend code, SQL and spatial OpenAPI schemas and the MCP tool description are separate modules.

Continue extracting cohesive responsibilities when touching large App, Properties, editor and Repository files. Avoid a broad rewrite mixed with a new feature. Family analyzers must ignore comments/nonstructural strings, preserve original line evidence, bound work and report uncertainty instead of picking arbitrary duplicate symbols. Add a meaningful fixture for each supported language and cross-file tests for resolution/ambiguity. API tests verify read-only preview, transactional save, grant/consent revocation and metadata/export preservation. [Code import](docs/CODE_IMPORT.md) is the supported capability contract.
