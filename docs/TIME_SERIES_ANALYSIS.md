# Time Series & Signal Analysis

This is a canonical template (`time-series-analysis`) and a typed `Diagram.analytics`
extension, not a new top-level diagram type or a Process Simulator resource model.
The quantitative workspace follows Import → Explore → Measure → Detect → Validate → Simulate.
Business Growth & Churn is a synthetic example; the numeric series engine is general-purpose.

## Boundaries

```text
Canonical Diagram.analytics (schemaVersion 1)
  ├─ datasets / observations / semantic series / transformations
  ├─ charts / indicators / data-anchored measurements / annotations
  ├─ declarative rules / semantic signal episodes
  ├─ chronological backtest definitions / explicit scenario assumptions
  └─ retained immutable results + actual input snapshots
       ↓
Versioned commands + validation + originating vault/grant guards
       ↓
AnalyticsService → bounded local workers → DOM-free numeric engine
       ↓
Paged summaries / UI chart projection / explicit exports
```

`frontend/src/analytics/types.ts` defines the schema. `validation.ts` rejects nonfinite
values, unknown fields/references, incompatible aggregation, invalid OHLC/rates, unsafe
expressions and excessive payloads. `engine.ts` dispatches pure calculation functions;
`series.ts`, `math.ts`, `measurements.ts`, `signals.ts`, `backtest.ts` and `scenarios.ts`
contain the numerical implementation. Worker and direct/headless execution call it alike.
`client.ts` terminates a worker on cancellation. `service.ts` bounds concurrency/queueing
and checks authorization before work, after waiting and before returning a result.

`document.ts` reconciles imports without discarding user definitions and captures actual
immutable run inputs. `reconcile.ts` advances semantic versions and marks stale results.
`remap.ts` remaps internal IDs and archived references during portable copy/import.
`example.ts` packages 60 complete illustrative months and timestamped daily observations;
all prefilled result content is calculated through the ordinary engine/service.

## Persistence and compatibility

The extension is optional on an existing Diagram record. Its schema is versioned at 1;
the logical workspace schema remains 8 and the physical vault schema remains 1. No new
store, SQLite, server database or migration that reinterprets old diagrams is introduced.
The existing encrypted adapter chunks `diagrams.analytics` separately, allowing unrelated
diagram field changes to reuse unchanged payload chunks. Source data and analysis objects
are never persisted in localStorage, service-worker caches or public build artifacts.

Native JSON and full workspace backups retain the extension, including retained result
inputs. Duplicate/import remapping covers datasets, series, observations, rules, signals,
measurements, charts, scenarios and archived content/parameters. External process links
remain explicit external references. Missing local node links are detached during copy.
Generic graph replacement from a client that omits analytics preserves the current extension;
changing it requires versioned analytics commands. An unsupported live-room sharing attempt
returns an explicit compatibility error rather than silently dropping this extension.

The native chart workspace is lazy-loaded. Opening the gallery does not load the example,
numeric engine or worker. Ordinary template seed records contain an empty validated extension;
actual example creation loads and calculates the example only after consent/unlock. Public
pages render a small transparent SVG, without importing the analysis application.

## Time, meaning and provenance

Observations retain canonical UTC ISO time with milliseconds, optional period end and optional `knownAt`. Series declare
IANA time zone, resolution, period boundary, unit, aggregation, desired business direction,
definition, dimensions and observed/derived provenance. Scenario points carry scenario
provenance separately. A chart's scale, normalization and style do not change these meanings.
Calendar grouping uses the declared IANA zone and Gregorian day/week/month/quarter/year periods;
custom business-day and holiday calendars are not supported.

Flows can sum; snapshots require first/last; rates require compatible numerator/denominator
aggregation. Segment-weighted churn is not cumulative temporal cohort churn. Currency conversion
is absent. Only customer churn tied to an opening-customer population receives that population's
0..1 constraint; net growth and unrelated ratios are not incorrectly clamped. Missing values
remain missing and insufficient data yields a structured reason, not NaN or Infinity.

Indicators and monitoring signals are causal; a tested observation is excluded from its anomaly
baseline. Known-at cutoffs constrain historical replay. Retrospective datasets are labeled when
historical publication/revision versions are unavailable. There is no arbitrary executable formula
engine, automatic causality claim or default predictive-confidence score.
Signals capture their compound expression, secondary KPI references and original units. Episode
onset timestamps support deterministic identity remapping, preserving user handling and scenario
links across copy/import and reruns. Exact numerical reproduction still requires the retained
actual input snapshot; a captured expression or hash alone cannot replace observations.

See [numerical methods](ANALYTICS_METHODS.md) for formulas, warm-up, missing values, lag convention,
sample variance, indicator initialization, zero-scale behavior, signal reset and validation matching.

## Import contract

CSV/XLSX/JSON have equivalent normalized row mapping. Preview reads source data, chosen decimal,
percentage, calendar/date conventions, sheet and semantic fields. A validation report has localized
issues and explicit skipped-row/duplicate handling. Create/replace/update commits the complete
validated extension atomically through `saveGraph` and the existing document save queue.

Date-only values use the selected zone. Excel date systems are explicit; DST ambiguity/gaps and
ambiguous source formats require correction. Formula cells, macros and external workbook links
are rejected. Import never executes supplied code or causes a runtime network/AI request.
CSV string export prefixes formula-like cells to protect spreadsheet consumers.

Refresh retains definitions/notes, advances source version and marks old result archives stale.
Those archives retain their original actual inputs; stale status cannot be silently cleared or
the archived computation mutated. Retention deletes an archive and its snapshot together.

## API, MCP and authority

`frontend/src/storage/analytics-commands.ts` is the shared versioned command surface. Existing
`Workspace.execute` calls it for human UI saves; `Workspace.external` supplies current MCP grants
and captured vault-operation guards. MCP remains `visual_nerve_api_docs` + `visual_nerve_request`.
The local Go bridge forwards commands, provides discovery/OpenAPI and holds no analytics database.

Discover `GET /analytics/capabilities`, then compact `GET /diagrams?analytics=true` and
`GET /diagrams/{id}/analytics`. Raw observations, archived inputs and results have bounded paging.
Writes carry `baseVersion` and return compact authoritative acknowledgements. The UI reloads the
saved graph locally, avoiding a full dataset/snapshot response through the WebSocket envelope.
Pure previews/jobs are read-only; import commits, definitions and archives require write access.

Async jobs retain the original grant/vault lease, not a new authorization after an HTTP response.
Lock, grant revocation, app teardown or expiry clears them and prevents late publication/commit,
including after unlock. Human screen jobs have equivalent lifetime fences. Analytics cannot
unlock a vault or extend human inactivity. A browser must remain available/unlocked with an
appropriate grant; no always-on server alerts are promised.

Recovery uses existing `operationId` receipts, version conflicts and reconcile policy. It is
bounded browser/grant-scoped recovery, not an exactly-once guarantee across app reloads.
Timeout can mean unknown outcome, so read receipt/saved state before retrying a write.
See [API](../API.md), [MCP](MCP.md) and [the user guide](../hugo/content/help/time-series-analysis.md).

## Documented bounds

- Current model: 8 datasets, 100 series, 200,000 observations, 100 signal rules.
- Declarative expressions: depth 8, 64 conditions, bounded lookback; no eval/Function.
- Import: 200 columns, 10 million cells; expanded XLSX 100 MiB; ordinary file limits still apply.
- Interactive analysis: two concurrent local jobs, bounded pending queue and cancellation.
- Raw/result data pages: at most 1,000 rows; analytics response envelope 8 MiB.
- Archives: at most 12 results and three distinct data-version sets, complete retained inputs
  subject to a 64 MiB combined serialized extension budget. Each archive retains actual inputs;
  repeated large runs can materially increase local storage and save cost.
- Async API jobs: two active, four retained, 32 MiB retained input/results, 15-minute retention
  and a 120-second deadline. Signal Lab has an explicit maximum prefix-replay workload.
- Growth & Churn: monthly UTC boundaries, up to 120 future periods, decimal expected counts,
  explicit independent MRC outflows or a reviewed revenue-per-lost-customer assumption.

These are implemented product boundaries, not a claim that arbitrary files or unlimited scale
have been verified. Actual benchmark and browser evidence belongs in the acceptance report.

Chart SVG is a bounded vector representation of the selected chart/range/layers, not the complete
raw data archive. UI and API use the same DOM-free serializer and numeric worker preparation.
Optional `analytics.scenarioView` stores explicitly selected `customerHistorySeriesId` and
`mrcHistorySeriesId` as visualization configuration. Selected sources must be observed snapshot
balances with compatible count/currency units; scenario comparisons retain separate customer/MRC
panels, solid historical observations, dashed future projections and an explicit projection-start
boundary. Source queries use the complete canonical observations before that boundary, never
rendering samples or invented historical values. Saving this view does not change assumptions
or historical observations. Scenario SVG export uses the same saved source references and boundary.
Historical comparison currently supports UTC first/last snapshots at observation/day/week/month
resolution. Other calendar boundaries and coarser snapshots are rejected instead of silently shifted
or interpolated.
Dataset CSV/JSON export is the explicit route for complete observations. Process links record
reviewed semantic mappings and never silently change another process document. Analytics live
room synchronization is explicitly unavailable; the room boundary rejects such documents.

## Verification ledger

[Implementation/acceptance evidence](ANALYTICS_IMPLEMENTATION.md) records AT01–AT38, exact commands,
environment, numerical tolerances, timings and remaining limitations. Pure tests verify numeric
golden fixtures and prefix invariance; encrypted repository tests cover persistence/backup/remapping;
API contract tests cover permissions/versioning/jobs/paging; browser tests exercise actual UI,
REST/MCP parity, responsive light/dark views, offline and cancellation.

Production deployment remains a separate manual, exact-revision workflow.
