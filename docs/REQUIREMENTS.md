# Public application, private data — requirements audit

Scope: the 52-section public-hosting/private-local-data specification, plus the user’s requirement for mandatory local-storage/cache acceptance. All changes apply to the existing working editor; evidence below refers to current source and executable tests.

Source paths below are relative to frontend/src or frontend/tests where appropriate. Public hosting is verified on an equivalent read-only named HTTPS static fixture; AWS deployment artifacts are supplied, while real AWS provisioning/domain configuration has not been performed.

| Requirement | Implemented behavior | Evidence |
| --- | --- | --- |
| 1. Public app, private content | Static public/ bundle, private S3/OAC GET-only distribution; browser IndexedDB contains all user content. Deployment allowlist excludes exports and state. | deployment/template.mjs; deployment.test.ts; audit-static.mjs |
| 2. Sole persistent store | Seven canonical IndexedDB tables include diagrams, nodes, edges, owners, preferences, user templates, viewport and metadata; React is working state. | storage/database.ts; storage.test.ts; STORAGE.md |
| 3. No server database | No database driver, server repository, SQL schema or JSON content store remains. Running legacy service was replaced with the current browser bridge after confirming it had no diagrams/owners. | backend/go.mod; server.go; source/runtime audit below |
| 4. Static public hosting | public/ works on a read-only named HTTPS static fixture without any Go API; S3/CloudFront template and upload script deliver only app code. | privacy.spec.ts; DEPLOYMENT.md; deployment tests |
| 5. Profile separation | Same HTTPS URL in contexts A/B has independent Private A/Private B records; app explains browser/profile/device/origin scope. | privacy.spec.ts: same HTTPS static URL; PRIVACY.md |
| 6. Honest language | Stored in this browser, Local only, no automatic sync/account/cloud; no implied automatic online backup. | Sidebar.tsx; DataPrivacy.tsx; privacy page |
| 7. First-run explanation | Once-per-profile explanation plus required explicit checkbox and Accept and continue. Decline/Escape/backdrop/shortcuts cannot open the workspace; acceptance is saved locally. | PrivacyIntro; storage and privacy tests |
| 8. Persistent indicator | Local only badge appears in empty state and canvas status bar; hover explains storage, click opens Settings. | LocalBadge; desktop/mobile browser tests |
| 9. Data & Privacy | Settings shows browser location, cloud not used, no automatic sync and optional MCP. IndexedDB, schema, origin and workspace ID are in advanced details. | DataPrivacy; privacy.spec.ts |
| 10. Plain language | Product text explains browser-local saving and manual moving/backups; technical details stay in expandable sections. | PrivacyIntro; Settings; /privacy/ |
| 11. Browser clearing | Settings, both export targets and docs explain clearing/profile reset/uninstall; portable exports keep an independent copy. | StorageNotice; privacy/help pages; PRIVACY.md |
| 12. Export all data | Dated portable JSON contains all eleven tables, appropriate settings, schemaVersion and exportedAt; credentials/grants/consent/local identity excluded. | storage/backup.ts; database.backup; unit/browser tests |
| 13. Restore modes | Preview defaults to Merge; Replace has a separate confirmation. All eleven stores restore atomically; invalid data rolls back replacement. | RestoreBackup; Repository.restore; tests |
| 14. Subtle reminder | At ten diagrams with no export, a small dismissible reminder appears; dismissal persists and export records suppress it. | BackupNudge; privacy.spec.ts |
| 15. MCP path | Codex → loopback MCP → local WebSocket → active browser → shared repository → IndexedDB. No second copy or S3 content access. | mcp.go; bridge.ts; architecture; tests |
| 16. MCP explanation/states | Settings explains tool access, active-browser requirement and local-only data, showing Disabled/Waiting/Connected/Error. | McpSettings; bridge.ts; privacy browser tests |
| 17. Permissions | Off default, Read only and Read + write are explicit local choices. Reads, exports and exact SQL/code previews are permitted with Read only; checks reject mutations and escalation before dispatch. Pending analysis cancels on revocation and rechecks write grants before saving. | integration/access.ts; Workspace.external; sql-query-api.test.ts; code-api.test.ts; code-integration.test.ts |
| 18. Open browser required | Disconnected/closed browser requests fail with 503 and plain error; MCP returns isError. No database fallback. | server.forward; closed-browser HTTPS test |
| 19. Local bridge | Loopback binding and peer checks; literal localhost/127.0.0.1/::1 destinations only. Hosted origins require exact allowlisting; trusted TLS supported. | main.go; access.ts; Go origin/peer tests; HTTPS MCP test |
| 20. Shared business rules | UI and external commands use Workspace/Repository; restore uses the same importGraph/saveGraph validation and transactions. | workspace.ts; repository.ts; storage and MCP tests |
| 21. Data-flow diagrams | Simple public app → browser → IndexedDB and Codex → local MCP → browser → IndexedDB illustrations. | ARCHITECTURE.md; PRIVACY.md; /privacy/; /help/ |
| 22. In-app privacy page | How Visual Nerve stores your data explains public code/private content, profile separation, exports, deletion and opt-in MCP. | hugo/content/privacy.md; links in nav/intro/Settings |
| 23. Code versus content | The site downloads app files; browser saves content. Public URL does not publish diagrams. | Intro; privacy/help pages; README |
| 24. Empty state | Welcome copy reinforces browser-local work without account/cloud; persistent local badge remains discoverable. | App.tsx |
| 25. Export distinction | Export target separates Export diagram (PNG/PDF/Markdown/JSON) from Export all data / backup. | ExportDialog; privacy.spec.ts; existing rendered export tests |
| 26. Capacity | Storage details uses navigator.storage.estimate/persisted when supported, otherwise reports unavailable; estimate includes app cache. | DataPrivacy; PRIVACY.md |
| 27. Retention request | Explicit persist button only after a diagram exists; denied/granted outcomes explain limits. Never requested immediately or guaranteed. | DataPrivacy; denied-persistence browser test |
| 28. Incognito | Temporary storage is explained, with no fragile detection code. | StorageNotice; PRIVACY.md; STORAGE.md |
| 29. Canonical origin | Deployment function redirects aliases/distribution domain before app execution; directory index rewriting preserves URLs/query values. | viewer-request.js; deployment tests; DEPLOYMENT.md |
| 30. Development origins | localhost ports, IP hostname and production HTTPS own separate databases; development data does not appear in production. | DEVELOPMENT.md: Origins and privacy tests |
| 31. Versioning | Explicit Dexie v1–v4, no reset/delete-database upgrade; legacy records and current tables retained. | database.ts; STORAGE.md |
| 32. Migrations | Tests upgrade legacy v1 including pending edits and v3 preserving graphs/preferences while removing the obsolete boolean grant. | storage.test.ts |
| 33. No content telemetry | No analytics, remote reporting, CDN/font runtime service or content telemetry is installed. | source/dependency/network audit below |
| 34. Runtime network | Only same-origin app/documentation GET assets and explicitly granted loopback MCP sockets. Normal create/add/reload/backup/restore sends no persistence requests. | networkAudit in privacy.spec.ts; browser-storage.spec.ts |
| 35. Offline | Existing service worker preserved; 16 code/assets/pages precached after acceptance. User content never enters asset caches. | service-worker.mjs; main/App; offline reload browser tests |
| 36. Deployment docs | Static bundle build, private S3/OAC, CloudFront, canonical origins, code-only uploads, updates and local MCP setup. | docs/DEPLOYMENT.md |
| 37. Privacy docs | Plain explanation of local data, separation, retention, exports/deletion, network traffic and opt-in tool access. | docs/PRIVACY.md |
| 38. Storage docs | Authoritative IndexedDB schema/upgrades/transactions, no backend persistence or S3 content, no CloudFront synchronization. | docs/STORAGE.md |
| 39. Architecture docs | Primary public static delivery diagram and separate local MCP path; one shared graph service. | ARCHITECTURE.md |
| 40. README | Opening paragraphs clearly state public application/private IndexedDB/no accounts or cloud, separate profiles and mandatory acceptance. | README.md |
| 41. Global deletion | Separate confirmed Delete all local Visual Nerve data clears user tables/settings/consent; only built-in seeds and new identity remain. No fake recovery. | DataPrivacy; clearAll; unit/browser tests |
| 42. Diagram versus global delete | Normal project deletion stays separate from advanced Settings global deletion. | DeleteDialog; DataPrivacy; existing deletion tests |
| 43. No persistence APIs | Static HTTPS create/add/reload/exports/restore asserts zero POST/PUT/PATCH/DELETE, external destinations or content API calls. | privacy.spec.ts: networkAudit; browser-storage.spec.ts |
| 44. Two browser contexts | Private A and Private B coexist independently at identical named HTTPS URL; native IndexedDB snapshots prove isolation. | privacy.spec.ts: same HTTPS static URL |
| 45. Manual portability | A downloads backup, B imports through preview/confirmation and retains its own diagrams while adding A. | same-URL privacy test; full backup test |
| 46. MCP integration tests | Public HTTPS app → local TLS bridge: read-only GET/export/SQL/code previews allowed, mutations/escalation denied; write commits visibly, reload preserves, Off/closed fail. SELECT and code preview/create share browser parsing and transactional validation. | privacy.spec.ts; browser-storage.spec.ts; SQL/code E2E; sql-query-api.test.ts; code-integration.test.ts; Go tests |
| 47. Consistent wording | Local only/this browser across shell, Settings, intro, exports, guide and privacy; no invented cloud features. | UI/docs audit |
| 48. Unobtrusive UI | One-time required acceptance, subtle persistent badge, expandable technical/destructive details and dismissible reminder; mobile overflow checks. | privacy.spec.ts; retained screenshots |
| 49. End-to-end acceptance | My Strategy survives actual Chromium profile closure/relaunch, independent profile sees none, zero uploads; export/clear/restore and local MCP write/reload/Off verified. | privacy.spec.ts; authenticated live user example |
| 50. Full audit | Source, manifests/locks, docs, scripts, schema, network, generated bundle, static infrastructure and running service reviewed; obsolete persistence excluded. | audit below; ACCEPTANCE.md |
| 51. Final report | Results grouped as Architecture, Storage, Privacy, UI, MCP, Documentation, Tests, Network audit and Repository audit; evidence links retained. | ACCEPTANCE.md: Final report and final response |
| 52. Systematic implementation | Working editor retained; implementation, data/privacy UX, optional MCP, static hosting and tests updated and verified in running browsers. | complete suite and live browser MCP verification |

## Repository and network audit

- Reviewed the project file inventory, frontend/Go dependencies and locks, source, tests, documentation, generated OpenAPI/license notices, build/service-worker/deployment scripts and runtime sockets. The source inventory was 138 files before this final audit update; build and dependency trees are separately ignored.
- Repository-wide searches covered sqlite, SQL, database server, S3 storage, cloud persistence, remote storage, sync backend and common server-database/telemetry drivers. The only sqlite match is the deployment guard that rejects such files. The dependency match text-segmentation is a Unicode text helper for rendered exports, not analytics. No application database driver, schema script, remote persistence client or graph file exists in project source.
- Runtime network entry points: local bundled imports/workers; same-origin service-worker GET asset fallback; same-origin GET of the generated OpenAPI document; and one optional literal-loopback WebSocket. There is no frontend graph fetch/save transport. Swagger validation is disabled; public Swagger cannot execute API calls and local Swagger targets its local origin.
- localStorage is used only to migrate/remove the historical theme preference. sessionStorage holds only a transient integration token. Both are distinct from authoritative content persistence in IndexedDB. All required acceptance/grants/preferences live in IndexedDB.
- The generated public bundle contains 237 allowlisted application/license files and a 16-asset offline shell; no diagram backup/export/state file is uploaded by deployment. Deliberate generated test screenshots/PDF fixtures in docs/acceptance are excluded from public/. No real user diagram content is added to the repository.
- The previously running v0.1 process was still holding an obsolete external database. After read-only confirmation that it contained zero diagrams and owners, it was gracefully replaced by the current v0.2 loopback bridge at the same address for the explicitly requested MCP action. The new process opens no persistent database; legacy files outside this repository were not deleted.

## Retained editor behavior

Deep mind maps retain colored curved branches and backgrounds at every depth. Direct editing, Tab/Enter creation, balanced layout, focus, quick naming/deletion/undo, contrast-aware palette, Lucide icons, mobile drawers/pan/pinch, owners, timeline/groups/search and rendered/semantic exports remain covered by the existing browser suite. Johan Caripson credit, MIT license and upper-right GitHub link remain present.

Executed checks and visual evidence are recorded in [ACCEPTANCE.md](ACCEPTANCE.md).

## 2026-10-06: Code analysis and toolbar follow-up

All 50 requested language IDs have bounded structural analyzers, with their
actual capabilities and limitations documented in [CODE_IMPORT.md](CODE_IMPORT.md).
Imports remain ephemeral until a reviewed diagram is created; extracted names,
paths, lines and confidence save in the existing IndexedDB graph model. Native
objects retain normal links, status, drawing, 2D/3D and export behavior.

The local REST/MCP contract adds language discovery, exact read-only code preview
and write-gated transactional creation. Pending analysis cancels when grants or
storage consent are revoked. Metadata validation and export allowlists cover the
new code provenance. Modular analyzers, import routing, UI sections and backend
schema files keep these responsibilities separate from the larger editor files.

Explore data and phone tools now open outside the scrolling toolbar, explain
their purpose and expose checks only when the current diagram supplies suitable
CSV/SQL data. Desktop and phone browser checks verify placement and interaction.
The 3D-to-2D regression verifies unchanged transforms and canonical nodes; the
reported intermittent skew has not been reproduced and is not marked fixed.

## 2026-10-06: Readable 3D objects and MCP discovery

The same styled native node must be readable from either physical face in 3D,
with its back text unmirrored. Front and back share captured appearance and GPU
resources within the existing detailed-card budget.

Move objects is distinct from camera navigation. Dragging changes world X/Y,
preserves each object's Z and moves selected groups with their descendants once.
Connected lines and labels follow the preview. Release commits one undoable
command; cancellation leaves no partial object changes. A 2D movement also
shifts existing explicit 3D X/Y, while explicit new coordinates in the same
command take precedence. The canonical 2D layout remains the export source.

Settings identifies the actual website origin, website API reference and local
Codex MCP endpoint separately. Copyable connection instructions exclude tokens.
MCP initialization and read-only documentation tools/resources advertise native
2D and requested 3D without requiring a separate documentation link or connected
workspace. Discovery does not grant access to private browser records.

## 2026-10-06: Visio and draw.io imports

Users can choose or drop `.vsdx` and `.drawio` files, preview the source pages,
review conversion warnings and create one selected page as an editable native
diagram. Preview and cancellation save nothing. The selected graph uses existing
IndexedDB tables, ordinary objects and relationships, groups, geometry, safe
links and basic colors. Native status, undo, 2D/3D and export behavior applies.

Conversion simplifies unsupported stencils, rotations, images and connector
routes with notices; it does not provide source-format export. XML/ZIP source,
embedded bytes and unselected pages remain temporary. Parsing does not execute
code or fetch external resources. Worker, XML/ZIP, total graph and page limits
bound analysis. Read-only REST/MCP preview and write-gated page creation use the
same parser and repository, rechecking consent/access before saving. API,
OpenAPI, MCP discovery and user/privacy documentation describe the contracts.
See [DIAGRAM_IMPORT.md](DIAGRAM_IMPORT.md) for formats, limits and fidelity.

## 2026-10-06: Import size preference and dialog spacing

Settings lets users save a browser-local import file size limit from 50 through
1024 MB (UI MB means MiB; 1024 MB is 1 GiB). The default remains 50 MB. Only
imports up to 50 MB are supported and guaranteed. Raising the limit shows an
experimental warning; actual large source imports also show a notice. Browser
memory, format, object/count and analysis deadline limits still apply.

The captured preference governs local CSV, SQL, code, draw.io/Visio,
JSON/Markdown imports and backup file reads. Code uses the same ceiling per file
and for the project total. The setting persists in IndexedDB, remains local to
the device and cannot be changed by restoring a backup. API/MCP analysis uses
the saved browser preference; HTTP/JSON and WebSocket envelopes remain 32 MiB.
The exact GET/PUT setting contract is documented in API, OpenAPI and MCP.

Common dialog styles provide separate blocks, readable paragraph line spacing,
label/control gaps, wrapped action rows and reachable controls on narrow
screens. Settings, source refresh and nested SQL quality diagnostics must stay
within a 320-pixel viewport without horizontal overflow. Shared modal styles
live in their own CSS module.

## 2026-10-06: Five workflows for understanding systems

| Workflow | Required behavior | Implementation and verification |
| --- | --- | --- |
| Semantic overview | Stable group summaries, statuses, directed typed aggregate links and original-ID mappings; shared 2D/3D/export, bounded detail, exact canonical layout preserved | overview modules; overview unit/browser tests; reproducible 10,000-node/30,000-edge benchmark |
| Relationship questions | Paged multi-level paths, cycles/directions/types and retained source evidence, explicit uncertainty; focus original objects without deleting them | questions modules and relationship exploration; question/contract/browser tests |
| Local history | Named snapshots, semantic comparison and modeled dependencies; pre-refresh/pre-restore checkpoints, atomic restore, bounded deduplicated history and portable backups | history modules, IndexedDB schema 7; persistence/compare/dialog/contract/browser regressions |
| Storyboard | Editable multi-object scenes, highlighted edges, authored narration/timings, captured or auto-fit views, legacy numbering preserved; same scene playback/movie | presentation storyboard/sequence/camera/video modules; definition/editor/runtime/camera/movie/browser tests |
| Reviewed app specification | Observed data and explicit rules separated from proposed screens/API; editable additions/answers, acceptance criteria and missing decisions; complete unsent Lovable brief | modular build-specification and source allowlists; specification/Lovable/SQL privacy/contract/browser tests |

The same workflows are documented through API/OpenAPI and MCP discovery.
English remains the default speech language; Swedish is available. A captured
scene view requires Details (overview off) and its matching current mode. Source facts and modeled impact
do not imply executed behavior. Work stays local in IndexedDB and all S3
deployment remains manual. See [UNDERSTANDING.md](UNDERSTANDING.md) for the full
contracts, quotas and privacy behavior.
