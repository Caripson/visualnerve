# Process Simulator acceptance coverage

This maps the requested functional criteria to automated cases and records the verified runs below. UI/API/MCP integration cases use actual Chrome, the real loopback HTTP/WebSocket bridge, IndexedDB and the production Web Worker engine. Engine tests use the same pure engine directly for exact clocks, economics and large populations.

| Acceptance | Automated evidence |
| --- | --- |
| AT-01 first-class template | `simulation-ui.spec.ts`: template selector, explicit type/schema, save/reopen; template/document unit tests |
| AT-02 deterministic flow | `simulation-engine.test.ts`: ten particles, ten minutes, exact revenue/event order; MCP headless parity case |
| AT-03 capacity throughput | Engine capacity-one/two conservation, completion time and queue comparison |
| AT-04 overload | Engine queue/wait/utilization; UI actual queue and MCP live node inspection |
| AT-05 shared contention | Engine atomic acquisition across two Work nodes, shared capacity one/two and cross-node priority |
| AT-06 scale-up | Engine semantic event/cost/maximum; UI capacity units and actual queue-driven expansion |
| AT-07 scale-down | Engine low-utilization hold/minimum/cost; UI sixty-minute contraction case |
| AT-08 complexity | Engine Standard five-minute versus Complex ten-minute processing |
| AT-09 TTR | Engine two-stage fifteen-minute TTR and route statistics |
| AT-10 accounting | Engine 1,000 revenue/400 cost/600 contribution; E2E UI, REST and MCP exact ledger parity |
| AT-11 abandonment | Engine five-minute patience, one abandonment and 100 lost revenue; semantic events and no completion |
| AT-12 kiosk baseline | Bundled example/document tests and engine baseline type/resource/economic metrics |
| AT-13 kiosk stress | Engine 10→1,000 packages, actual resource/queue pressure and increased lost core revenue; UI scenario resource names and bindings |
| AT-14 intervention | Engine paid package staff/counter intervention, core/package throughput/waits/cost/contribution; UI capacity and read-only resource projection without changing Baseline |
| AT-15 investment/payback | Engine observed positive incremental-payback crossing and no-payback case |
| AT-16 scenarios | Engine/document isolation; UI independent assumptions and comparable saved runs |
| AT-17 bidirectional model | UI Work capacity/time/cost editing, REST reflected edit, MCP full round trip |
| AT-18 discovery | Go MCP initialize/guide/OpenAPI discovery without browser; real MCP capability/model inspection |
| AT-19 live MCP state | Real MCP node/resource/queue/throughput inspection, same values on the canvas and pause freeze |
| AT-20 MCP changes | Real MCP capacity one→three, UI configuration reflects three, new result uses node/shared-resource capacity |
| AT-21 headless | Real MCP async runs while no simulator is selected; frozen duration/seed and complete results |
| AT-22 UI/MCP parity | UI and MCP 24-hour Baseline at seed 12345; exact metrics, event ordering, node/resource statistics and capacities |
| AT-23 automated stress | Real MCP demand multipliers 1.0–1.5, distinct IDs, six results and five comparisons with no manual canvas edits |
| AT-24 bottleneck migration | Engine upstream intervention identifies the new dominant downstream constraint |
| AT-25 truthful visuals | Engine transit/processing timestamps; UI actual edge/state samples, queues and paused particle canvas |
| AT-26 animated/MAX parity | Engine incremental versus full run; real UI animated 100× versus MCP headless MAX exact deterministic metrics/events |
| AT-27 bounded rendering | Engine one million completed particles with bounded retention; UI sampled canvas below full simulated count |
| AT-28 persistence | v8 storage close/reopen, offline model/JSON/backup/history; real UI reload |
| AT-29 compatibility | v7 upgrade fixtures, existing document types, browser flowchart compatibility and original product E2E suites |
| AT-30 validation | Engine strict semantic/reference/rule validation; API structured errors, version guards and atomic rollback |
| AT-31 capability completeness | Real MCP model with two types, three Work nodes, Router, two shared resources, scaling, investment and two scenarios |
| AT-32 programmatic round trip | Actual MCP creates complete model through typed CRUD, connects it, runs it, opens UI, edits assumptions and reads them back |

Files:

- `frontend/tests/simulation-engine.test.ts`
- `frontend/tests/simulation-document.test.ts`
- `frontend/tests/simulation-storage.test.ts`
- `frontend/tests/simulation-api.test.ts`
- `frontend/tests/simulation-render-model.test.tsx`
- `frontend/tests/simulation-capacity-projection.test.ts`
- `frontend/tests/simulation-capacity-summary.test.tsx`
- `frontend/tests/simulation-presentation-slots.test.ts`
- `frontend/tests/simulation-particle-view.test.ts`
- `frontend/tests/e2e/simulation-ui.spec.ts`
- `frontend/tests/e2e/simulation-api.spec.ts`
- `backend/cmd/openapi/simulation_test.go`
- `backend/internal/server/simulation_test.go`
- Existing MCP forwarding/discovery, native validation, storage, templates and original diagram E2E suites.

No browserless server engine is claimed. Headless acceptance means the connected browser worker runs without active diagram rendering or animation. The model's optional `untilComplete` stops arrivals at the configured horizon and drains existing work, while ordinary fixed-duration comparisons use the same exact horizon. Retention/percentile approximation and topology ceilings are documented in [Process Simulator](PROCESS_SIMULATOR.md).

## Verified runs — 2026-10-07

| Check | Result |
| --- | --- |
| Complete frontend unit suite | 139 files, 1,443 tests passed |
| Complete product Chrome E2E suite | 118 cases executed: 117 passed; one compact selection-toolbar overlap was found and corrected |
| Final Chrome E2E regression checks | All 28 affected cases passed: eight mobile, three status, four drawing, eight native editor, three quick-work and two toolbar cases; the phone-status case was rechecked separately after correcting its touch-gesture origin |
| Go race suite | All four packages passed `go test -race ./...` |
| Go static analysis | `go vet ./...` passed |
| Production build | TypeScript, Vite, Hugo and Go build passed; 305 application files audited, 50 offline shell assets, no user data files |
| API contract | API 0.3.0; all 1,732 OpenAPI references resolved; source, Hugo and public specifications match |
| Formatting and patch whitespace | Frontend Prettier check and `git diff --check` passed |

The complete 118-case Chrome run includes all 15 simulator UI/API/MCP cases, the original product regressions and eight new touch-layout cases. It found a real overlap between wrapped selection controls and the Fit/drawing buttons on a 320-pixel phone. The final production bundle measures the selection toolbar and places those controls above its actual height. The affected suites were rerun: 27 cases passed together, and the phone-status case passed separately after its native two-finger gesture was moved to verified empty canvas. That final case checks actual zoom increase, unobstructed controls, status changes, hidden relationships, reload and undo. These records describe a complete run followed by affected regression checks, rather than a second complete 118-case run.

Resource/scenario rendering does not change persisted Baseline nodes, edges or simulation assumptions. Full cards preserve native color/icon/shape, show three real processing assignments, expose the shared queue once, map mouse and keyboard activation to the logical process and reject geometry nudges of runtime projections. Mobile checks cover 320×640, 360×740, 390×844 and 844×390, portrait/landscape camera preservation, shared model edits, live queues, scenario isolation, readable subtitles and return from 3D to the same saved 2D document. [The mobile guide](MOBILE.md) describes the navigation and implementation modules.

Capacity projection unit tests cover scale-up/down, zero capacity, anonymous processing/departure placement, explicit overflow aggregation and the eight-card/256-extra-card limits. A 7,000-node layout test verifies deterministic non-overlap and bounded nearby-candidate checks. Particle-view tests verify valid fan branches, shared-input routing, missed-observation fallback, filtered geometry and semantic relationship exploration. Engine state is unchanged by these presentation modules.

The million-particle engine case verifies complete population accounting with bounded completed-particle/event retention. UI/MCP parity compares exact seeded metrics, event ordering, node/resource statistics and final capacities. The external six-step demand test collects six separately identified runs and compares their system-wide outcomes.

To reproduce the complete browser suite, run from `frontend` after `./build.sh`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npm run test:e2e
```
