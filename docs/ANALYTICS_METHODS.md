# Analytics engine methods

Engine version: **1.0.0**. Canonical source: `frontend/src/analytics/`. This specification describes the implemented algorithms; it is not a claim that a business rule has statistically validated predictive performance.

## Time, units and missing observations

Stored timestamps use canonical UTC millisecond ISO (`Date.toISOString()`); imports normalize supported input representations. Observations retain UTC timestamps, optional period ends and optional `knownAt` publication timestamps. Series define an IANA time zone, calendar resolution and boundary convention. Local calendar dates are converted using the selected zone. Ambiguous daylight-saving folds and nonexistent local times require an explicit-offset ISO timestamp. Excel serial systems are explicitly selected; the fictitious 1900-02-29 is rejected. An import timestamp does not become `knownAt`.

Sorting uses timestamp followed by a stable code-unit ID order. Duplicate keys require an explicit import policy. Missing values stay `null`; incomplete observations do not participate as valid values. No interpolation or zero filling is performed. A missing calendar period breaks consecutive confirmation and resets rolling state. Analysis uses the complete selected observations, independently of chart sampling.

Temporal sums are supported for flows. Snapshot aggregation uses explicit first/last within one segment. Rates require positive compatible numerators and denominators to pool disjoint segments at the same observation time. Pooling period rates across different times does not establish cumulative cohort churn and is refused. The opening-customer risk-population constraint applies only to explicitly identified customer churn; it does not cap NRR or net growth.

Opening-customer churn requires ratio units and rate semantics. Import preserves reported rates, including rounding. When a reported value differs from its supplied numerator/denominator by more than `1e-10 × max(1, |reported|, |exposure rate|)`, preview shows a row/column warning and records the policy in transformations. Explicit compatible same-period segment pooling uses the exact supplied exposures; it does not silently rewrite the raw reported observation. Aggregated values and OHLC retain the latest contributing publication timestamp and last contributing period end.

Addition/subtraction require compatible units, currencies and period definitions. Named count units such as customers and orders remain separate. Custom comparisons require compatible operand units, while an AND can combine independent conditions on unlike KPIs. Constants use their compared operand’s original scale. Multiplication supports one dimensional series and dimensionless ratios; automatic composite-unit inference is not implemented. Division supports matching units producing a ratio, or a dimensionless divisor retaining the numerator's unit. No currency conversion occurs.

## Measurements

- Measurement definitions can persist explicit dimension filters. Unlike segments are not silently joined; pair tools require matching calendars and one observation per native matching period.
- Absolute change is `end − start`. Relative change is `(end − start) / start`, with a strictly positive base. A zero or negative base returns a structured undefined value; absolute change remains available.
- For ratio units, percentage-point change is `100 × (end − start)`. Thus 0.02 to 0.03 is one percentage point and 50% relative change.
- Range statistics report minimum, maximum, mean, median, sample standard deviation and provided-observation coverage and separate calendar coverage. Absent native-resolution periods count against calendar coverage; irregular observation-resolution data has no assumed calendar grid. Sample variance divides squared deviations by `n − 1`; fewer than two observations yields undefined deviation. Sums are offered only for flow semantics, with complete valid input and no absent periods in the selected native-resolution calendar.
- Time range reports elapsed seconds, calendar-period span and actual observation count separately. Calendar counts include the selected boundary periods; this is not a count of fabricated observations.
- Hand-positioned trend lines use two saved time/value anchors and slope per elapsed day. Statistical regression fits ordinary least squares against elapsed days since the first included timestamp. It returns slope, intercept, residuals, sample count and R². Constant responses have undefined R²; coincident timestamps cannot define a slope. Regression is explicitly a descriptive, full-interval fit.
- Period comparison reports each interval's statistics, length and coverage. It does not equalize intervals or silently adjust seasonality.
- Pearson correlation uses centered matched values. Spearman first replaces values with average ranks for exact ties, then applies Pearson. At least two matched nonconstant series are required. Positive lag pairs `X[t]` with `Y[t + lag]`; negative lag pairs with earlier Y. Calendar resolutions match calendar ordinals; observation resolution uses observation positions. No p-value or independence assumption is silently added.

Computations use JavaScript double precision and retain precision until display. Non-finite results return structured errors/undefined metrics. Golden tests generally use an absolute/relative numerical tolerance of approximately `1e-10`; exact integer results remain exact where representable.

## Indicators

| Indicator            | Variant and initialization                                                                     | Minimum input                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| SMA(n)               | Arithmetic mean of a complete trailing n-observation window                                    | n valid contiguous observations                     |
| EMA                  | `alpha × current + (1−alpha) × previous`, seeded at first valid value; default alpha `2/(n+1)` | One valid observation                               |
| ROC(n)               | Relative change against n observations earlier; positive base and complete intervening input   | n+1 valid contiguous observations                   |
| Rolling deviation(n) | Sample standard deviation in a complete trailing window                                        | n ≥ 2                                               |
| Bollinger-style band | SMA ± configured multiplier × sample standard deviation                                        | n ≥ 2                                               |
| MACD                 | Short EMA − long EMA; signal EMA of that difference; histogram is difference − signal          | First-value seeds, available from first observation |
| RSI(n)               | Wilder average gain/loss: initial simple mean of n changes, then alpha=1/n smoothing           | n+1 valid observations                              |

Missing observations/calendar gaps reset EMA, MACD and RSI. SMA/ROC/deviation/bands require fresh complete windows. RSI returns 50 for no gains and no losses, and 100 for gains with no losses. MACD, RSI and bands are exploratory; no buy/sell behavior or universal business threshold is implied. A band is not a statistical confidence interval.

The [NIST EWMA discussion](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm) documents the exponential recurrence and the assumptions needed for control limits. Visual Nerve uses a first-observation EMA seed rather than NIST's historical-target control-chart seed. It does not implement or claim NIST's EWMA control-limit calibration.

## Signal families

Threshold comparisons use the selected strict/inclusive comparator. Confirmation requires N consecutive valid complete periods. Unknown input breaks confirmation, keeps an existing episode unresolved, and does not mean false. Hysteresis changes the release threshold for above/below threshold rules. After resolution, cooldown suppresses new onsets for the configured number of subsequent observation periods.

Moving-average crossover compares configured SMA/EMA windows, with no onset during the long-window warm-up. Crossing up requires a previous short value at/below long followed by short above long; crossing down is the converse. A confirmed episode remains active while the averages retain that direction.

Momentum uses trailing rate of change against a positive base and a nonnegative threshold magnitude. Downward detection compares the rate of change with the negated magnitude; positive growth does not trigger a downward threshold. KPI divergence compares trailing relative changes in two named, time-matched series and requires opposite signs plus the configured divergence magnitude. All primary and secondary window observations must be complete, contiguous and published by detection time. Indicator operands require their full numerical dependencies to be available: finite rolling windows for SMA/deviation/bands/ROC, and the complete valid contiguous recursive history for EMA/MACD/RSI. Negative/zero bases do not manufacture a rate of change.

The monitor orders decisions by knowledge time, with observation index as a deterministic tie-break. An endpoint waits for its required primary, secondary, derived and indicator publications; it is reevaluated at the first release that can decide the condition. AND-false and OR-true do not wait for an irrelevant unknown branch. A configured N-period confirmation can complete when delayed earlier periods arrive, and the latest endpoint is reevaluated then. Missing/incomplete periods and calendar gaps still break confirmation. Recursive EMA/CUSUM state never consumes a later observation before its required preceding history is available.

Episodes describe the latest published primary endpoint. Late evidence for an older endpoint can supply a current trailing window, but cannot replace or resolve a newer condition. If a high value from an old period arrives after a newer already-known low value, it does not create a stale current alert. Earlier emitted causal events remain unchanged when later evidence arrives. Historical observation time and actual first deciding release remain separate; no event is emitted after an explicit knowledge cutoff. This is monitoring-history replay, not an exhaustive retrospective labeling of every old period regardless of when it became known.

Anomaly baselines exclude the assessed observation. Rolling z-score is `(current − prior mean) / prior sample standard deviation`. The robust variant divides `(current − prior median)` by `1.4826 × median(abs(prior − median))`. A zero scale with an unchanged current value gives no anomaly; a changed current value with zero scale is unknown, rather than an infinite score or claimed statistical confidence.

Variation spike compares sample deviation in the current trailing window with deviation in the immediately preceding non-overlapping window. Its score is their ratio. Two complete windows are required. A zero/zero deviation produces no spike; nonzero current variation over a zero baseline is unknown.

Structural change uses two-sided tabular CUSUM in native units:

```text
S_hi[t] = max(0, S_hi[t−1] + x[t] − mu0 − k)
S_lo[t] = max(0, S_lo[t−1] + mu0 − x[t] − k)
```

Both sums start at zero. Detection is strictly `S > h`; `mu0`, `k`, `h` and direction are explicit. With `on-detect`, sums reset when detection occurs, so a new accumulated exceedance is required after resolution. With `on-resolve`, an active episode remains active while its raw deviation exceeds k in the selected direction; sums reset on return to that release condition. Calendar gaps reset both sums. This release policy is a product choice, distinct from the mathematical accumulation. The [NIST tabular CUSUM equations](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm) support the recurrence; Visual Nerve does not estimate or promise an average run length or false-alarm rate from arbitrary business data.

Seasonal deviation compares the current value with the mean of corresponding positions one and two complete cycles earlier. Two complete historical cycles and a contiguous comparison span are required. Tolerance is in the series' native units. Short data yields insufficient-data notes, not a guessed seasonal model.

Custom rules are a bounded JSON AST: AND/OR/NOT, comparisons, crossing, per-condition sustained confirmation and trailing-window mean/min/max/sample deviation/ROC. Unknown follows three-valued logic. Expressions have no executable code, script runtime or eval. Limits on depth, condition count and lookback are enforced. A batch has a deterministic 50-million weighted evaluation budget, with nested confirmation/window cost included; narrow the interval or split a complex batch when exceeded.

Signal publication retains at most 10,000 lifecycle events per batch. `totalEvents`, `omittedEvents` and `episodeCount` still count the entire evaluated population. The publication limit is explicit; narrow the interval to inspect omitted events. Signal Lab refuses truncated event histories instead of computing biased predictive metrics.

Each signal stores observed value in its series unit. `deviationMagnitude` and `deviationUnit` carry the method score separately; `thresholdUnit` describes its threshold. A z-score of 3 is not reported as three customers. IDs encode the rule/version, dataset version, captured semantic series version, dependency-definition fingerprint, dimensions and episode onset, so reruns do not duplicate an episode. Severity is configured by the user, not a confidence probability. Detection timestamps retain publication delay; a resolution cannot precede the episode's known onset.

Series definition versions advance when their meaning changes, including changes propagated through derived inputs. Each new signal captures `seriesVersion` and an ID-neutral `definitionFingerprint` of the relevant series definitions, dependency dataset versions, secondary KPIs, indicator parameters and resolved rule expression. Copying a document preserves these semantic digests while remapping local identifiers. Referenced indicator definition/source changes also advance dependent rule versions, conservatively protecting against switches between identically described sources. The digest detects changed calculation dependencies; it is not a cryptographic integrity proof and cannot reproduce a run without retained input. Legacy omitted series versions mean version 1. Legacy signals without a captured dependency fingerprint remain valid historical evidence but are not asserted current from today's definitions. User handling and scenario links stay attached to their original evidence when recalculation creates new events.

Custom signal records capture the bounded declarative expression that produced them. A compound condition has no single threshold or deviation score, so those values are null. Divergence records retain the second series identifier. Captured syntax and units remain meaningful after rule edits; rerunning a historical result still requires the retained immutable input snapshot. Removing its archive does not leave enough raw data to reconstruct an old run from a signal alone.

New lifecycle events also retain `onsetTime`, including an active event queried after its onset. Copy/import remaps rule identities and recomputes deterministic episode/event identities from this provenance so acknowledgement, mute state and scenario links survive reruns. Older records without onset provenance can be reconstructed when their onset event is retained; an active-only legacy history cannot recover an absent onset timestamp.

UI and API share a 10,000-event live-history policy. Signal originals referenced by scenarios, explicitly acknowledged or muted records, and user-linked events receive protection. Remaining space retains the newest current events before unprotected prior history. Retention reports removed historical events or omitted current live events; the separate analysis archive keeps its bounded published batch. If protected records alone exceed the limit, saving fails with a structured limit error instead of silently deleting them. Obsolete links or handled records must be cleared explicitly. Numeric worker payloads omit archives, live handling state, measurement result links and scenario source-signal links because those references do not affect computation; canonical persisted definitions retain them.

## Signal Lab

Rules are replayed against increasing time-ordered prefixes. A fold's cutoff restricts observation/publication availability, transformations and trailing baselines. Every split also replays its final boundary, so a delayed secondary release can be detected even when the split contains no new primary observation. For history replay, exposed/evaluable period counts describe primary observations released in the split; a delayed dependent signal can therefore occur in a split with zero newly exposed primary periods. In predictive mode, `evaluablePeriods` counts onset signals with complete future outcome windows, the precision denominator. There is no random train/test shuffle. Candidate rules are fixed definitions: automatic numerical parameter fitting is not implemented. The supplied trial count records multiple tested candidates; validation evidence can select a candidate, and only that candidate plus an optional baseline is evaluated on holdout.

Without an explicit outcome, results contain replay counts and timing, with no precision/recall. With an outcome, matching is one-to-one between onset episodes and future outcome onsets. Matching begins at actual `detectedAt`, not at an earlier historical observation timestamp. Incomplete, missing or unpublished future windows are excluded. Overlapping signals cannot claim the same outcome twice. Precision reports matched eligible signals / eligible signals; recall reports matched outcome episodes / known outcome episodes in the split. Detection delay is observed-to-known delay in days; it is not a fitted change-point estimate.

Datasets without point-in-time revision/publication history are labeled retrospective current-data analysis. A saved result retains actual immutable input, not only a version number/hash. Retention and deletion are explicit. Prefix replay is bounded by a 20-million-observation fold-work budget; narrow the interval or increase fold size when exceeded.

The [time-series cross-validation discussion in Forecasting: Principles and Practice](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation) motivates evaluation on increasing historical prefixes. Signal Lab uses that ordering discipline; it does not imply a fitted forecasting model or scientifically validated causal/predictive performance.

## Scenario model

Monthly Growth & Churn projections use opening customers as the risk population. Losses are `opening × churnRate`, then new/reactivated customers enter. Next month's opening is the previous closing. Counts remain decimal expected values. A relative churn adjustment of 0.20 multiplies 2% by 1.20; a percentage-point adjustment of 0.20 adds 0.002 to the stored ratio.

MRC independently reconciles opening + new + expansion − contraction − churned MRC. Customer losses affect MRC only with an explicit revenue-per-customer assumption; otherwise churned MRC remains independently configured. Negative population/MRC or invalid rates are rejected without clipping. Comparisons require the same currency, start and horizon. Scenarios preserve history and require review before calculation. They are assumptions, not guaranteed forecasts, revenue-recognition models or confidence intervals.

## Execution and bounds

DOM-free numerical modules serve worker/UI/API/MCP paths. Heavy browser work runs in locally bundled module workers. The shared service allows two active jobs and eight waiting jobs. Abort terminates its worker; session/grant guards are checked before queue entry, after queue wait and before result publication. No job grants access or refreshes human-idle policy. Results and models remain under the existing encrypted IndexedDB adapter.

Strict archive construction, import commit preparation, semantic version reconciliation and complete model validation also have internal worker operations. These preserve complete retained input snapshots and references instead of applying the compact numerical-payload transformation. They prepare a candidate document only: the caller must still recheck its originating session/grant and document version before the existing atomic save. These preparation operations are implementation details, not additional public REST or MCP commands. Semantic equality compares ordered arrays and object fields directly, avoiding whole-document sorted-string copies without changing version or immutable-archive checks.

DOM-free runners without a `Worker` implementation call the same engine in process, retaining the scheduler's session, cancellation and authorization checks. This fallback does not offer browser worker termination or establish a separate server API; normal supported browser execution remains in workers.

Supported document limits include 200,000 current observations, 100 series, 100 rules, 12 archived results, three retained data versions and a 64 MiB complete analytics payload. XLSX parsing additionally caps expanded material at 100 MiB and compressed input at the supported 50 MiB limit. Formula cells, macros, embedded objects, DTDs and external workbook links are refused. A configured larger generic upload budget does not promise unbounded XLSX expansion. MCP transport limits remain separate.

`frontend/tests/analytics-benchmark.test.ts` writes measured Node environment/time/memory evidence to ignored `tmp/analytics-benchmark.json`. Browser responsiveness and real-worker cancellation require the browser suite; sampled process memory is not a peak-memory guarantee. No unlimited-scale or closed-browser/server-alert claim is made.
