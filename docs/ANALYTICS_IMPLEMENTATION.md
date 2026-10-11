# Time Series & Signal Analysis implementation

Status: implementation and local acceptance verification complete within the documented product boundaries. Production deployment is not part of this goal.

The authoritative payload is `Diagram.analytics`, schema version 1. Existing diagram types,
workspace schema 8 and the encrypted adapter remain unchanged. Semantic references use IDs;
chart positions never identify observations. The template ID is `time-series-analysis`.

## Work list

- [x] Typed extension, validation, encrypted payload chunking, copy/import reference remapping.
- [x] Bounded CSV/XLSX/JSON preview and atomic create/replace/update with explicit mappings.
- [x] Shared deterministic numeric engine, indicators, causal signals, historical validation.
- [x] Growth & Churn example, reconciled projections and immutable retained input snapshots.
- [x] Lazy-loaded chart workspace, measurement tools, rule builder, Signal Lab and scenarios.
- [x] Existing REST/MCP command parity, capability discovery, jobs, grant/lock fences.
- [x] Homepage section, transparent illustration, help, schemas and executable examples.
- [x] Unit, storage, API, browser, offline, responsive, security and performance verification.

## Acceptance evidence

AT01–AT38 are the delivery contract. The final report must distinguish automated tests,
visual/manual review and unverified limitations. Results, timings and exact test commands
will be recorded here after execution, rather than described as promises.

The following fixtures trace the contract. A listed fixture is not, by itself, a claim that
the final complete regression run passed; the execution results below are the evidence.
Paths in the table are relative to `frontend/tests/` unless otherwise specified.

| Acceptance case | Verification fixture / scope |
| --- | --- |
| AT01 Template and reload deduplication | `templates.test.ts`, `template-runtime.test.ts`, `e2e/analytics-ui.spec.ts`, `e2e/analytics-security-site.spec.ts` |
| AT02 Equivalent import conventions | `analytics-import.test.ts`: literal CSV/XLSX/JSON, explicit decimals/percent/DMY/MDY, Excel 1900/1904, DST gaps/folds |
| AT03 Real and invalid OHLC | `analytics-engine.test.ts`, `analytics-import.test.ts`, `analytics-validation.test.ts`: 100/110/95/105, no artificial one-point wick |
| AT04 Missing data, duplicates, atomic cancellation | `analytics-import.test.ts`, `analytics-api.test.ts`, `analytics-worker.test.ts`, browser import/cancellation workflows |
| AT05 Weighted same-period exposure | `analytics-engine.test.ts`: 92/1000; temporal cohort-rate aggregation rejection |
| AT06 Point changes and undefined baselines | `analytics-engine.test.ts`: absolute/relative changes, percentage points, zero/negative baseline reasons |
| AT07 Time-based regression | `analytics-engine.test.ts`: regular/irregular intervals and constant series |
| AT08 Pearson/Spearman | `analytics-engine.test.ts`: golden correlation, average tie ranks, missing pairs, constant inputs and signed lag |
| AT09 Indicators | `analytics-engine.test.ts`: independent SMA/EMA, Wilder RSI, MACD, sample-variance band fixtures |
| AT10 Sustained condition | `analytics-engine.test.ts`: strict >, onset in period 5, resolve in 6, gaps break confirmation |
| AT11 Crossover and stable episodes | `analytics-engine.test.ts`, `analytics-document.test.ts`: SMA warm-up and deterministic episode copy/rerun |
| AT12 Prior-only anomaly baseline | `analytics-engine.test.ts`: z=3, median/MAD zero-scale policy |
| AT13 Two-sided CUSUM | `analytics-engine.test.ts`: explicit k=1/h=3, strict crossing at observation 6 |
| AT14 Seasonal requirements | `analytics-engine.test.ts`: exact season fixture, injected deviation and insufficient cycles |
| AT15 Prefix invariance | `analytics-engine.test.ts`, `analytics-publication.test.ts`: each causal signal family, delayed required publications and indicator/preprocessing prefix invariance |
| AT16 Knowledge versus observation time | `analytics-engine.test.ts`, `analytics-publication.test.ts`: knowledge-time replay, late dependency completion, stale endpoint suppression, split-boundary replay and retrospective labeling |
| AT17 Explicit outcome matching | `analytics-engine.test.ts`: no invented accuracy, incomplete windows and one-to-one outcomes |
| AT18 Chronological holdout | `analytics-engine.test.ts`: untouched holdout cannot alter validation selection; recorded trials |
| AT19 Safe declarative rules | `analytics-engine.test.ts`, `analytics-validation.test.ts`: AND/OR/NOT/unknown, window/sustained AST, hysteresis/cooldown, complexity and injection rejection |
| AT20 Customer reconciliation | `analytics-engine.test.ts`, `analytics-document.test.ts`: 1010/990, subsequent opening balances and unrounded expectations |
| AT21 Independent MRC accounting | `analytics-engine.test.ts`: 101000, explicit customer-revenue assumption and currency compatibility |
| AT22 Churn adjustments | `analytics-engine.test.ts`: relative versus percentage points; invalid rate/population rejection |
| AT23 Reviewed signal-to-scenario | `analytics-engine.test.ts`, `e2e/analytics-ui.spec.ts`: reviewed separate objects, original observations untouched |
| AT24 UI/REST/MCP numerical parity | `analytics-api.test.ts`, `analytics-worker.test.ts`, `e2e/analytics-mcp.spec.ts`: compare numeric content apart from IDs/timestamps |
| AT25 Portable encrypted persistence | `analytics-encrypted.test.ts`, `analytics-document.test.ts`, `analytics-retention.test.ts`, `e2e/analytics-security-site.spec.ts`: native JSON/full backup, schema 8, remapped expressions/signals/references and explicit archive pruning |
| AT26 Refresh and optimistic conflict | `analytics-api.test.ts`, `analytics-encrypted.test.ts`, `e2e/analytics-mcp.spec.ts`: source/definition versions, retained immutable stale results, stale baseVersion |
| AT27 Effect-based grants | `analytics-api.test.ts`, `analytics-authority.test.ts`, `e2e/analytics-mcp.spec.ts`: pure POST previews versus writes, exact path matching including paged queries |
| AT28 Lock/revocation fences | `analytics-worker.test.ts`, `analytics-authority.test.ts`, `analytics-api-jobs.test.ts`, encrypted browser and MCP workflows |
| AT29 Recoverable operations | `e2e/analytics-mcp.spec.ts`, existing `e2e/mcp-operations*.spec.ts`: same reserved operation receipt, no new-ID blind retry |
| AT30 Content confidentiality and injection | `analytics-import.test.ts`, `analytics-api.test.ts`, `analytics-encrypted.test.ts`, `e2e/analytics-security-site.spec.ts`: encrypted records, no canary in browser storage/cache/logs/network, formula/XML safeguards |
| AT31 Existing product compatibility | Existing frontend unit and browser suites; Go race tests; explicit rejection of unsupported analytics live rooms |
| AT32 Anchors and sampled rendering | `analytics-ui.test.tsx`, `e2e/analytics-ui.spec.ts`: numeric anchors unchanged by zoom/resize/sampling, segment and unit separation |
| AT33 Responsive accessible workflow | `analytics-ui.test.tsx`, `e2e/analytics-ui.spec.ts`: 390/768/1440, light/dark, keyboard/numeric fields, touch, millisecond-preserving UTC controls and reviewed retention changes |
| AT34 Public section | `e2e/analytics-security-site.spec.ts`: 320/390/768/1440 light/dark, transparent text-free SVG, real links, no engine/document creation |
| AT35 Documentation and discovery | Existing site/Help tests; Go OpenAPI/server tests; actual REST/MCP script workflow in `e2e/analytics-mcp.spec.ts` |
| AT36 Old bridge compatibility | `mcp-bridge-diagnostics.test.ts`, Go discovery tests, documented 0.8.2/analytics-v1 binary requirement |
| AT37 Offline/local computation | `e2e/analytics-security-site.spec.ts`: fresh encrypted app, offline reload, measurement/signals, no external requests or AI |
| AT38 Bounded scale and cancellation | `analytics-benchmark.test.ts`, `analytics-api-jobs.test.ts`, `e2e/analytics-ui.spec.ts`: 100k/10 series/100 rules, progress and actual browser responsiveness/cancellation |

## Test environment and execution evidence

The local verification environment uses macOS/Darwin x64, Intel Core i5-6500 at 3.20 GHz,
Node 22.17.0 and isolated Google Chrome 155.0.8059.39 profiles. Playwright's synthetic DNS/TLS
fixtures use loopback only. No real user workspace, AWS resource or production deployment is used.

The final focused numerical/publication/import/validation run passed 193 tests across nine files.
The UI and shared SVG run passed 59 tests, including full-export versus bounded-table checks. Explicit
archive retention and document tests passed 14 tests, and encrypted repository/worker ownership,
lock and optimistic-save tests passed seven tests. Full TypeScript checking passed after the
precision, retention and delayed-publication fixes. Complete-suite results on the frozen final sources are recorded below.

The final browser run regenerated seven real light/dark screenshot pairs; all 14 were visually reviewed. Captures use
synthetic data and actual controls; mobile captures retain a normal 390-pixel viewport and do not
hide controls or restyle the application.

### Verification log

| Check | Final local result |
| --- | --- |
| Complete frontend unit/integration suite (`cd frontend && npm test`) | **3,813/3,813 PASS**, 345 files, 527.23 seconds |
| Focused numerical/import/validation/publication suite | 193/193 PASS, nine files |
| Focused UI/shared SVG suite | 59/59 PASS, two files |
| Explicit result/version retention and document cases | 14/14 PASS |
| Encrypted repository/worker ownership, lock, cancellation and version conflicts | 7/7 PASS |
| Go race/vet and final OpenAPI generator assertions | PASS; unchanged server regression plus final generator checks |
| `./build.sh` | PASS: TypeScript, regenerated OpenAPI, Vite, licenses, Hugo, offline shell and static audits |
| `cd frontend && npm run format:check` / `git diff --check` | PASS |
| Four analytics browser specs, `VN_CAPTURE_ANALYTICS=1 npx playwright test tests/e2e/analytics-{ui,mcp,security-site,ui-vault}.spec.ts` | 25/25 PASS, 3.0 minutes |
| Fresh Help and virtualized API reference follow-up | 10/10 PASS, 1.0 minute |
| Existing simulator currency and real 60-minute scale-down cases | 2/2 PASS, 12.6 seconds, normal Chrome |
| Actual encrypted collaboration rollback regression | Three Chrome runs PASS: 15 checks without CSV, 16 checks with CSV twice |
| MCP operation reservation, timeout recovery and grant isolation follow-up | 3/3 PASS, including a genuinely lost browser acknowledgement |
| Browser/bridge version alignment and analytics MCP parity | 47 focused unit tests, Go discovery/generator race tests, vet, build and formatting PASS; 6/6 real MCP browser workflows PASS |

The analytics browser run exercises actual UI/REST/MCP numerical parity, both executable client
examples, operation recovery, effect-based grants, source conflicts, encrypted reload/offline
computation, storage/cache/network/log canaries, late worker responses after lock and fresh unlock,
import confirmation, reviewed process links, dirty-form protection and the large cancellable job.
The responsive matrix covers the analytics workflow at 390/768/1440 pixels and the homepage at
320/390/768/1440 pixels, both appearances. The 14 new Help images and representative public
sections were visually reviewed. Physical Safari/mobile-device behavior has not been verified.

The original complete legacy browser batch contained 310 cases: **284 passed, 11 failed and
15 deliberately skipped**. The failures were nine Help/API-reference cases and two simulator
cases. All eleven subsequently passed in the targeted runs recorded above; the initial batch
itself is not reported as green. The skips are 14 optional existing screenshot-regeneration
cases plus one opt-in live Alan voice-model download. No core feature case was skipped. Local
verification uses synthetic isolated profiles; CI is a separate execution of the complete suite.

The first CI collaboration run exposed a test synchronization race: the rollback baseline was
captured before an already accepted edit's owner-mediated activity checkpoint arrived. The
test now waits for the exact protected workflow checkpoint and drains the incoming/save/outbox
queues before capturing that baseline. The full graph and private-state rollback comparisons
and subsequent real MLS edit remain unchanged. Three actual Chrome runs passed with the local
relay, encrypted vaults and MLS; no production permission or persistence behavior was relaxed.

The first complete CI execution on the pushed sources passed all 3,813 frontend tests and
the production build, then completed 335 browser cases with 319 passes, 15 optional skips
and one failed legacy MCP check. That check still expected bridge 0.8.1 although the analytics
bridge correctly advertised 0.8.2. Its exact version and analytics capability assertions were
aligned; the operation reservation, recovery and content-preservation assertions remain intact.
The final CI execution is reported separately from that failed run.

### Bounded performance evidence

The final Chrome workload uses 100,000 observations across 10 series and 100 simple signal rules.
Only 1,152 representative points are rendered; all observations participate in analysis. The
complete browser workflow took **11,463 ms**, cancellation acknowledged in **222 ms**, and the
instrumented interval recorded 550 animation frames with a maximum frame gap of **349.9 ms**.
Pan and zoom remained usable during the real worker job. Sampled renderer JavaScript heap was
477,259,105 bytes (about 455 MiB); it is neither a peak measurement nor combined browser/worker
memory. This fixed desktop environment does not establish unlimited scale or mobile hardware capacity.

The final full-suite Node benchmark evaluated 1,000,000 rule/observation combinations with no
unknown assessments. Validation took **450.8 ms**, numerical analysis **687.1 ms**, immutable
archive preparation **1,698.1 ms**, and reconciliation **2,009.0 ms**. Sampled heap was
57.9→245.5 MB and RSS 132.1→465.1 MB, both decimal process measurements rather than peaks.
Keeping full replayable inputs has a material memory/copy cost; numerical execution time alone
is not end-to-end latency. The original measurements and environment are retained in
[`acceptance/analytics-benchmark.json`](acceptance/analytics-benchmark.json).

The final bundle audit reports entry/largest main-thread chunk **395,698 bytes**, initial static
imports **897,804 bytes**, lazy analytics workspace **154.69 kB** (42.81 kB gzip), and analytics
worker **214.55 kB**. No chunk exceeds 500 kB, no new dependency is introduced, and the homepage
illustration does not load this workspace or numerical engine. The offline shell includes 343
local assets; the static audit checked 1,033 application files with no user data files.

## Implemented product boundaries

- Current observations: 200,000; datasets: 8; series: 100; rules: 100.
- Signal batch work: 50 million weighted evaluations; published events: 10,000. Complete event
  counters remain available; Signal Lab rejects truncated replay rather than evaluating partial history.
- Archives: 12 results / three data-version sets maximum, with a 64 MiB combined serialized
  analytics extension limit. Each archive retains actual inputs; storage is not free or indefinite.
- Local execution uses two concurrent workers with a bounded queue and cancellation. API jobs
  have two active/four retained slots, 32 MiB retention, a 120-second deadline and 15-minute expiry.
- Raw data/result pages are at most 1,000 rows. Indicator and residual tables explicitly show
  their first 1,000 rows; JSON exports retain the complete result. The analytics response budget
  is 8 MiB and is separate from file-upload and bridge transport limits.
- Scenarios are monthly Growth & Churn projections, at most 120 future periods. Custom holiday
  calendars, fabricated cohorts, statistical significance, guaranteed forecasts and trading operations
  are not offered. Process mappings require explicit review and do not modify another document.
- Live-room synchronization of analytics documents is rejected with a compatibility error.
  Deliberate native exports/encrypted backups and authorized local API/MCP responses remain supported.

## Main modules and integration points

| Area | Added or changed modules |
| --- | --- |
| Canonical extension | `frontend/src/analytics/types.ts`, `validation.ts`, `result-validation.ts`, `document.ts`, `reconcile.ts`, `remap.ts`, `identity.ts`, `signal-history.ts`, `retention.ts`; optional field in `frontend/src/model/types.ts` |
| Numerical implementation | `engine.ts`, `math.ts`, `series.ts`, `measurements.ts`, `signals.ts`, `backtest.ts`, `scenarios.ts` under `frontend/src/analytics/` |
| Local import and workers | `import.ts` (including bounded XLSX parsing), `client.ts`, `worker.ts`, `service.ts`, `lifecycle.ts`; encrypted workspace payload fields and lock/transfer cleanup |
| Template and user interface | Template manifest/create/starter flow; `AnalyticsFeature.tsx`, `AnalyticsToolbar.tsx` and the focused components under `frontend/src/analytics/ui/`; UTC date/time fields and historical-unit display helpers; existing App, dialogs and export integration |
| Shared vector output | `frontend/src/analytics/vector-export.ts` and `vector-renderer.ts`, used by the UI and API |
| Existing commands and permissions | `frontend/src/storage/analytics-commands.ts`, `analytics-api-input.ts`, `analytics-api-format.ts`, `analytics-api-jobs.ts`, `analytics-api-jobs-command.ts`; existing Repository, Workspace and MCP access boundary |
| Bridge and contract | `backend/cmd/openapi/analytics.go`, canonical OpenAPI generator and `docs/openapi.yaml`; existing server routing, MCP discovery/descriptions and version metadata |
| Public website and help | `hugo/layouts/partials/home-analytics.html`, existing homepage/site styles, feature/use-case/developer/MCP pages, `hugo/content/help/time-series-analysis.md`, paired real screenshots |
| Specification and examples | `docs/TIME_SERIES_ANALYSIS.md`, `docs/ANALYTICS_METHODS.md`, this evidence ledger, existing README/architecture/data/storage/export/API/MCP docs and `scripts/examples/analytics.mjs` |

The schema envelope remains an ordinary diagram with `analytics: { schemaVersion: 1,
engineVersion: "1.0.0", datasets, series, charts, indicators, measurements, rules, signals,
backtests, scenarios, results, retention }`. Semantic inputs, visualization settings and
immutable captured result inputs are separate fields; scenario output does not replace observations.

## Migration and release

No workspace database upgrade is required: logical schema 8, physical vault schema 1 and the
optional analytics extension schema 1 remain distinct. Existing documents without the extension
are unchanged. Browser semantic API, bridge transport and OpenAPI report version 0.8.2;
the bridge capability is `analytics-v1`, and local binary 0.8.2 adds routing and discovery.
A web update cannot update an installed bridge. Production publication stays a separate manual workflow.

No account, AI call, external runtime CDN, server database or additional persistent store
is introduced. Exports, explicitly approved collaboration and authorized MCP responses can
share content; local-first does not mean that content can never leave the browser.
