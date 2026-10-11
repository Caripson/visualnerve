import type {
  AnalyticsExtension,
  AnalyticsMeasurement,
  AnalyticsIndicator,
  MeasurementResult,
  IndicatorResult,
  AnalysisContext,
  MetricValue,
  Observation,
  AnalyticsSeries,
} from './types';
import { compactAnalysisModel } from './signal-history';
import {
  querySeries,
  compatibleUnits,
  DAY_MS,
  periodOrdinal,
  checkAnalysis,
  contiguous,
  calculationValues,
} from './series';
import {
  mean,
  median,
  stddev,
  sum,
  relativeChange,
  regression,
  pearson,
  ranks,
  metric,
  sma,
  ema,
  finiteResult,
} from './math';
import { requireAnalysis, validateAnalytics } from './validation';
function requireSingleSegment(rows: Observation[]) {
  requireAnalysis(
    new Set(
      rows.map((item) =>
        JSON.stringify(
          Object.entries(item.dimensions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
      ),
    ).size <= 1,
    'Select one segment before measuring this series. Measurements never join unlike dimensions implicitly.',
    undefined,
    'INCOMPATIBLE_UNITS',
  );
}
function stats(
  rows: Observation[],
  allowSum: boolean,
  series?: AnalyticsSeries,
  from?: string,
  to?: string,
) {
  const valid = rows.filter((o) => o.value !== null && o.quality === 'valid').map((o) => o.value!);
  const expected =
    series && series.resolution !== 'observation' && from && to
      ? periodOrdinal(to, series.resolution, series.timezone) -
        periodOrdinal(from, series.resolution, series.timezone) +
        1
      : null;
  const supplied = series
    ? new Set(rows.map((o) => periodOrdinal(o.time, series.resolution, series.timezone))).size
    : rows.length;
  const validPeriods = series
    ? new Set(
        rows
          .filter((o) => o.value !== null && o.quality === 'valid')
          .map((o) => periodOrdinal(o.time, series.resolution, series.timezone)),
      ).size
    : valid.length;
  return {
    observations: metric(rows.length),
    actualObservations: metric(rows.length),
    observationCoverage: metric(rows.length ? valid.length / rows.length : null),
    expectedCalendarPeriods: metric(expected),
    missingCalendarPeriods: metric(expected === null ? null : Math.max(0, expected - supplied)),
    calendarCoverage: metric(expected ? Math.min(1, validPeriods / expected) : null),
    validObservations: metric(valid.length),
    coverage: metric(rows.length ? valid.length / rows.length : null),
    min: metric(valid.length ? valid.reduce((a, b) => Math.min(a, b), Infinity) : null),
    max: metric(valid.length ? valid.reduce((a, b) => Math.max(a, b), -Infinity) : null),
    mean: metric(mean(valid)),
    median: metric(median(valid)),
    standardDeviation: metric(stddev(valid)),
    ...(allowSum
      ? {
          sum: metric(
            valid.length === rows.length &&
              valid.length &&
              (expected === null || validPeriods === expected)
              ? sum(valid)
              : null,
          ),
        }
      : {}),
  };
}
export function measure(
  model: AnalyticsExtension,
  definition: AnalyticsMeasurement,
  context?: AnalysisContext,
): MeasurementResult {
  checkAnalysis(context);
  const { resultId: _lockedResult, ...calculation } = definition;
  validateAnalytics({ ...compactAnalysisModel(model), measurements: [calculation] });
  const series = model.series.find((s) => s.id === definition.seriesIds[0]);
  requireAnalysis(series, 'Unknown measurement series.');
  const rows = querySeries(
    model,
    series.id,
    { from: definition.from, to: definition.to, dimensions: definition.dimensions },
    context,
  );
  if (!['time-range', 'annotation'].includes(definition.kind)) requireSingleSegment(rows);
  const valid = rows.filter((o) => o.value !== null && o.quality === 'valid');
  const metrics: Record<string, MetricValue> = {};
  const result: MeasurementResult = {
    kind: 'measurement',
    measurementId: definition.id,
    metrics,
    notes: [],
  };
  const first = valid[0],
    last = valid.at(-1);
  switch (definition.kind) {
    case 'point-to-point':
      if (first && last) {
        metrics.start = metric(first.value);
        metrics.end = metric(last.value);
        metrics.absoluteChange = metric(last.value! - first.value!);
        metrics.relativeChange = relativeChange(first.value!, last.value!);
        if (series.unit.kind === 'ratio')
          metrics.percentagePoints = metric((last.value! - first.value!) * 100);
      } else metrics.absoluteChange = metric(null);
      break;
    case 'time-range':
      metrics.elapsedSeconds = metric(
        (Date.parse(definition.to) - Date.parse(definition.from)) / 1000,
      );
      metrics.actualObservations = metric(rows.length);
      metrics.validObservations = metric(valid.length);
      metrics.calendarPeriods = metric(
        series.resolution === 'observation'
          ? null
          : periodOrdinal(definition.to, series.resolution, series.timezone) -
              periodOrdinal(definition.from, series.resolution, series.timezone) +
              1,
      );
      result.notes.push(
        'Elapsed time, calendar periods and actual observations are different quantities.',
      );
      break;
    case 'range-statistics':
      Object.assign(
        metrics,
        stats(
          rows,
          series.semantics === 'flow' && series.aggregation === 'sum',
          series,
          definition.from,
          definition.to,
        ),
      );
      result.notes.push(
        'Observation coverage is the valid fraction of provided rows. Calendar coverage separately includes absent native-resolution periods; observation-resolution series have no assumed calendar grid.',
      );
      if (series.semantics !== 'flow')
        result.notes.push('A temporal sum of balances or ratios is not meaningful and is omitted.');
      break;
    case 'trend-line':
      requireAnalysis(definition.points?.length === 2, 'Choose two time/value anchors.');
      {
        const [a, b] = definition.points;
        requireAnalysis(
          Date.parse(a.time) !== Date.parse(b.time),
          'Trend anchors must have different times.',
        );
        metrics.slopePerDay = metric(
          (b.value - a.value) / ((Date.parse(b.time) - Date.parse(a.time)) / DAY_MS),
        );
        metrics.absoluteChange = metric(b.value - a.value);
        metrics.elapsedDays = metric((Date.parse(b.time) - Date.parse(a.time)) / DAY_MS);
        result.values = definition.points;
        result.notes.push('This is a hand-positioned line, not a fitted regression.');
      }
      break;
    case 'regression':
      {
        const origin = valid[0] ? Date.parse(valid[0].time) : 0;
        const fit = regression(
          valid.map((o) => (Date.parse(o.time) - origin) / DAY_MS),
          valid.map((o) => o.value!),
        );
        metrics.slopePerDay = metric(fit?.slope ?? null);
        metrics.intercept = metric(fit?.intercept ?? null);
        metrics.rSquared = metric(
          fit?.rSquared ?? null,
          'R² is undefined for a constant response.',
        );
        metrics.observations = metric(valid.length);
        result.residuals = fit
          ? valid.map((o, i) => ({ time: o.time, value: fit.residuals[i] }))
          : [];
        result.values = fit
          ? valid.map((o) => ({
              time: o.time,
              value: fit.intercept + (fit.slope * (Date.parse(o.time) - origin)) / DAY_MS,
            }))
          : [];
        result.notes.push(
          'Full-history descriptive fit; intercept is at the first included observation. Not a causal monitoring indicator.',
        );
      }
      break;
    case 'compare-periods':
      requireAnalysis(
        definition.comparisonFrom && definition.comparisonTo,
        'Choose a second interval.',
      );
      {
        const second = querySeries(
          model,
          series.id,
          {
            from: definition.comparisonFrom,
            to: definition.comparisonTo,
            dimensions: definition.dimensions,
          },
          context,
        );
        requireSingleSegment(second);
        const a = stats(
            rows,
            series.semantics === 'flow' && series.aggregation === 'sum',
            series,
            definition.from,
            definition.to,
          ),
          b = stats(
            second,
            series.semantics === 'flow' && series.aggregation === 'sum',
            series,
            definition.comparisonFrom,
            definition.comparisonTo,
          );
        for (const [k, v] of Object.entries(a)) metrics[`first.${k}`] = v;
        for (const [k, v] of Object.entries(b)) metrics[`second.${k}`] = v;
        metrics.firstElapsedDays = metric(
          (Date.parse(definition.to) - Date.parse(definition.from)) / DAY_MS,
        );
        metrics.secondElapsedDays = metric(
          (Date.parse(definition.comparisonTo) - Date.parse(definition.comparisonFrom)) / DAY_MS,
        );
        result.notes.push(
          'Intervals are not automatically equalized or seasonally adjusted. Compare lengths, coverage and season explicitly.',
        );
      }
      break;
    case 'compare-series':
    case 'correlation':
      {
        requireAnalysis(definition.seriesIds.length === 2, 'Choose exactly two series.');
        const other = model.series.find((s) => s.id === definition.seriesIds[1]);
        requireAnalysis(other, 'Unknown second series.');
        const second = querySeries(
          model,
          other.id,
          { from: definition.from, to: definition.to, dimensions: definition.dimensions },
          context,
        );
        requireSingleSegment(second);
        requireAnalysis(
          series.resolution === other.resolution &&
            series.timezone === other.timezone &&
            series.periodBoundary === other.periodBoundary,
          'Pair measurements require matching resolution, time zone and period boundaries.',
          undefined,
          'INCOMPATIBLE_UNITS',
        );
        if (series.resolution !== 'observation')
          requireAnalysis(
            new Set(
              rows.map((item) => periodOrdinal(item.time, series.resolution, series.timezone)),
            ).size === rows.length &&
              new Set(
                second.map((item) => periodOrdinal(item.time, other.resolution, other.timezone)),
              ).size === second.length,
            'Pair measurements require one observation per native period. Explicitly aggregate intraperiod observations first.',
            undefined,
            'INCOMPATIBLE_UNITS',
          );
        if (definition.kind === 'compare-series')
          requireAnalysis(
            definition.normalized || compatibleUnits(series, other),
            'Compare incompatible units in separate panels or explicitly normalize.',
            undefined,
            'INCOMPATIBLE_UNITS',
          );
        const lag = definition.lag ?? 0;
        const map = new Map(
          second.map((o, i) => [
            series.resolution === 'observation'
              ? i
              : periodOrdinal(o.time, series.resolution, series.timezone),
            o,
          ]),
        );
        const pairs = rows.flatMap((o, i) => {
          const key =
            series.resolution === 'observation'
              ? i
              : periodOrdinal(o.time, series.resolution, series.timezone);
          const peer = map.get(key + lag);
          return o.value !== null &&
            o.quality === 'valid' &&
            peer?.value !== null &&
            peer?.value !== undefined &&
            peer.quality === 'valid'
            ? [[o.value, peer.value] as [number, number]]
            : [];
        });
        let x = pairs.map((p) => p[0]),
          y = pairs.map((p) => p[1]);
        metrics.matchedObservations = metric(pairs.length);
        if (definition.kind === 'correlation') {
          if (definition.method === 'spearman') {
            x = ranks(x);
            y = ranks(y);
          }
          metrics.correlation = metric(
            pearson(x, y),
            'Correlation requires at least two matched, nonconstant series.',
          );
          metrics.lag = metric(lag);
          result.notes.push(
            `Positive lag pairs X[t] with Y[t+lag]; negative lag pairs with earlier Y. ${definition.method ?? 'pearson'} correlation is descriptive, not evidence of causation; no independence-based significance is claimed.`,
          );
        } else {
          metrics.firstMean = metric(mean(x));
          metrics.secondMean = metric(mean(y));
          if (definition.normalized) {
            requireAnalysis(
              x[0] > 0 && y[0] > 0,
              'Normalized comparison requires positive first matched values.',
              undefined,
              'INSUFFICIENT_DATA',
            );
            metrics.firstChange = relativeChange(x[0], x.at(-1)!);
            metrics.secondChange = relativeChange(y[0], y.at(-1)!);
            result.notes.push(
              'Display normalization uses first matched observations; source units/values are unchanged.',
            );
          }
        }
      }
      break;
    case 'annotation':
      metrics.observations = metric(rows.length);
      result.notes.push(definition.note ?? 'Named event annotation.');
      break;
  }
  checkAnalysis(context);
  return result;
}
export function calculateIndicator(
  model: AnalyticsExtension,
  definition: AnalyticsIndicator,
  context?: AnalysisContext,
): IndicatorResult {
  checkAnalysis(context);
  validateAnalytics({
    ...compactAnalysisModel(model),
    indicators: [...model.indicators.filter((i) => i.id !== definition.id), definition],
  });
  const s = model.series.find((s) => s.id === definition.seriesId);
  requireAnalysis(s, 'Unknown indicator series.');
  const rows = querySeries(model, s.id, {}, context);
  const { values, indices } = calculationValues(rows, s, context?.cutoff);
  let computed: (number | null)[] = [];
  const w = definition.window;
  const notes: string[] = [];
  let upper: (number | null)[] | undefined,
    lower: (number | null)[] | undefined,
    signal: (number | null)[] | undefined,
    histogram: (number | null)[] | undefined;
  switch (definition.kind) {
    case 'sma':
      computed = sma(values, w);
      notes.push('Simple moving average requires a complete trailing window.');
      break;
    case 'ema':
      computed = ema(values, definition.alpha ?? 2 / (w + 1));
      notes.push('EMA seeds at the first valid value; missing values/gaps reset its state.');
      break;
    case 'roc':
      computed = values.map((value, i) =>
        i >= w &&
        value !== null &&
        values[i - w] !== null &&
        values[i - w]! > 0 &&
        values.slice(i - w, i + 1).every((v) => v !== null)
          ? relativeChange(values[i - w]!, value).value
          : null,
      );
      notes.push('ROC uses a positive base; zero/negative bases are undefined.');
      break;
    case 'rolling-stddev':
      computed = values.map((_, i) => {
        const window = values.slice(Math.max(0, i - w + 1), i + 1);
        return window.length === w && window.every((v) => v !== null)
          ? stddev(window as number[])
          : null;
      });
      notes.push('Sample standard deviation, divisor n−1, over a complete trailing window.');
      break;
    case 'bollinger':
      computed = sma(values, w);
      {
        const deviations = values.map((_, i) => {
          const win = values.slice(Math.max(0, i - w + 1), i + 1);
          return win.length === w && win.every((v) => v !== null) ? stddev(win as number[]) : null;
        });
        upper = computed.map((v, i) =>
          v !== null && deviations[i] !== null
            ? v + (definition.multiplier ?? 2) * deviations[i]!
            : null,
        );
        lower = computed.map((v, i) =>
          v !== null && deviations[i] !== null
            ? v - (definition.multiplier ?? 2) * deviations[i]!
            : null,
        );
      }
      notes.push(
        'SMA ± multiplier × sample standard deviation; an exploratory band, not a confidence interval.',
      );
      break;
    case 'macd':
      {
        const short = ema(values, 2 / ((definition.shortWindow ?? 12) + 1)),
          long = ema(values, 2 / ((definition.longWindow ?? 26) + 1));
        computed = short.map((v, i) => (v !== null && long[i] !== null ? v - long[i]! : null));
        signal = ema(computed, 2 / ((definition.signalWindow ?? 9) + 1));
        histogram = computed.map((v, i) =>
          v !== null && signal![i] !== null ? v - signal![i]! : null,
        );
      }
      notes.push(
        'MACD is short EMA minus long EMA; each EMA seeds at its first valid value; signal is an EMA of MACD. Exploratory, not a business boundary.',
      );
      break;
    case 'rsi':
      {
        let gains: number[] = [],
          losses: number[] = [],
          avgGain: number | null = null,
          avgLoss: number | null = null;
        computed = values.map((value, i) => {
          if (value === null || i === 0 || values[i - 1] === null) {
            gains = [];
            losses = [];
            avgGain = null;
            avgLoss = null;
            return null;
          }
          const delta = value - values[i - 1]!,
            gain = Math.max(delta, 0),
            loss = Math.max(-delta, 0);
          if (avgGain === null) {
            gains.push(gain);
            losses.push(loss);
            if (gains.length < w) return null;
            avgGain = mean(gains)!;
            avgLoss = mean(losses)!;
          } else {
            avgGain = (avgGain * (w - 1) + gain) / w;
            avgLoss = (avgLoss! * (w - 1) + loss) / w;
          }
          if (avgGain === 0 && avgLoss === 0) return 50;
          if (avgLoss === 0) return 100;
          return 100 - 100 / (1 + avgGain / avgLoss!);
        });
      }
      notes.push(
        'Wilder RSI: first n changes seed simple average gains/losses, then smoothing alpha=1/n; unchanged series=50, no losses=100. Exploratory, not a purchase signal.',
      );
      break;
  }
  const points = rows.map((o, rowIndex) => {
    const i = indices[rowIndex];
    return {
      time: o.time,
      value: computed[i] === null ? null : finiteResult(computed[i]),
      ...(upper ? { upper: upper[i] } : {}),
      ...(lower ? { lower: lower[i] } : {}),
      ...(signal ? { signal: signal[i] } : {}),
      ...(histogram ? { histogram: histogram[i] } : {}),
      ...(computed[i] === null ? { reason: 'INSUFFICIENT_DATA' as const } : {}),
    };
  });
  checkAnalysis(context);
  return { kind: 'indicator', indicatorId: definition.id, points, notes };
}
