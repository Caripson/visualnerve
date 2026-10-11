import { describe, expect, it } from 'vitest';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { remapAnalytics } from '../src/analytics/remap';
import { archiveResult } from '../src/analytics/document';
import {
  measure,
  calculateIndicator,
  evaluateSignals,
  backtest,
  runScenario,
  aggregateOHLC,
  querySeries,
  adjustedChurn,
  sma,
  ema,
  pearson,
  ranks,
  compareScenarios,
  executeAnalysis,
} from '../src/analytics/engine';
import type {
  AnalyticsExtension,
  AnalyticsRule,
  AnalyticsMeasurement,
  AnalyticsScenario,
  BacktestConfig,
  AnalyticsSeries,
} from '../src/analytics/types';
const day = (index: number) => new Date(Date.UTC(2024, 0, index + 1)).toISOString();
const month = (index: number) => new Date(Date.UTC(2024, index, 1)).toISOString();
function fixture(
  values: (number | null)[],
  extra: {
    id?: string;
    resolution?: AnalyticsSeries['resolution'];
    unit?: AnalyticsSeries['unit'];
    semantics?: AnalyticsSeries['semantics'];
    aggregation?: AnalyticsSeries['aggregation'];
  } = {},
): AnalyticsExtension {
  const id = extra.id ?? 'series';
  return {
    ...blankAnalytics(),
    datasets: [
      {
        id: 'data',
        name: 'Synthetic',
        version: 1,
        source: { kind: 'example', name: 'Illustrative example data', illustrative: true },
        observations: values.map((value, index) => ({
          id: `${id}-${index}`,
          seriesId: id,
          time: extra.resolution === 'month' ? month(index) : day(index),
          value,
          dimensions: {},
          quality: value === null ? 'missing' : 'valid',
        })),
        transformations: [],
        importedAt: day(0),
        revisionHistory: 'unavailable',
      },
    ],
    series: [
      {
        id,
        name: id,
        datasetId: 'data',
        dimensions: {},
        unit: extra.unit ?? { kind: 'count', label: 'customers' },
        semantics: extra.semantics ?? 'snapshot',
        provenance: 'observed',
        resolution: extra.resolution ?? 'day',
        timezone: 'UTC',
        periodBoundary: 'start',
        aggregation: extra.aggregation ?? 'last',
        direction: 'higher-is-better',
        definition: 'Explicit synthetic fixture.',
      },
    ],
  };
}
function measurement(
  kind: AnalyticsMeasurement['kind'],
  model: AnalyticsExtension,
  extra: Partial<AnalyticsMeasurement> = {},
): AnalyticsMeasurement {
  return {
    id: 'measure',
    name: kind,
    kind,
    seriesIds: [model.series[0].id],
    from: model.datasets[0].observations[0].time,
    to: model.datasets[0].observations.at(-1)!.time,
    ...extra,
  };
}
function rule(
  family: AnalyticsRule['family'],
  parameters: AnalyticsRule['parameters'] = {},
  extra: Partial<AnalyticsRule> = {},
): AnalyticsRule {
  return {
    id: 'rule',
    version: 1,
    name: 'Fixture rule',
    enabled: true,
    family,
    seriesId: 'series',
    severity: 'warning',
    parameters,
    ...extra,
  };
}
function signalModel(values: (number | null)[], definition: AnalyticsRule) {
  const model = fixture(values, { resolution: 'month' });
  model.rules = [definition];
  return model;
}
function scenario(extra: Partial<AnalyticsScenario['assumptions']> = {}): AnalyticsScenario {
  return {
    id: 'baseline',
    name: 'Baseline',
    version: 1,
    model: 'growth-churn',
    start: month(0),
    periods: 2,
    resolution: 'month',
    reviewed: true,
    assumptions: {
      openingCustomers: 1000,
      newCustomers: 30,
      reactivatedCustomers: 0,
      churnRate: 0.02,
      newCustomerGrowth: 0,
      openingMrc: 100000,
      newMrc: 5000,
      expansionMrc: 1000,
      contractionMrc: 2000,
      churnedMrc: 3000,
      currency: 'SEK',
      ...extra,
    },
  };
}
function withSecond(model: AnalyticsExtension, values: (number | null)[]) {
  const second = fixture(values, { id: 'second', resolution: model.series[0].resolution });
  model.series.push(second.series[0]);
  model.datasets[0].observations.push(...second.datasets[0].observations);
  return model;
}
describe('analytics measurement mathematics AT06–AT09', () => {
  it('absolute and relative change use full data, never viewport pixels', () => {
    const model = fixture([100, 120]);
    const result = measure(model, measurement('point-to-point', model));
    expect(result.metrics.absoluteChange.value).toBe(20);
    expect(result.metrics.relativeChange.value).toBe(0.2);
  });
  it('saved measurement dimensions select one segment rather than joining unlike rows', () => {
    const model = fixture([100, 120]);
    model.datasets[0].observations.forEach((item) => {
      item.dimensions = { country: 'SE' };
    });
    model.datasets[0].observations.push(
      ...model.datasets[0].observations.map((item) => ({
        ...item,
        id: `${item.id}-other`,
        value: item.value! * 10,
        dimensions: { country: 'NO' },
      })),
    );
    expect(() => measure(model, measurement('point-to-point', model))).toThrow(/segment/);
    const selected = measure(
      model,
      measurement('point-to-point', model, { dimensions: { country: 'SE' } }),
    );
    expect(selected.metrics.absoluteChange.value).toBe(20);
    expect(selected.metrics.relativeChange.value).toBe(0.2);
  });
  it('ratio change exposes percentage points separately', () => {
    const model = fixture([0.02, 0.03], {
      unit: { kind: 'ratio', label: 'churn' },
      semantics: 'rate',
      aggregation: 'none',
    });
    const r = measure(model, measurement('point-to-point', model));
    expect(r.metrics.percentagePoints.value).toBeCloseTo(1);
    expect(r.metrics.relativeChange.value).toBeCloseTo(0.5);
  });
  it.each([0, -10])('relative change is structured undefined for base %s', (value) => {
    const model = fixture([value, 20]);
    const r = measure(model, measurement('point-to-point', model));
    expect(r.metrics.relativeChange.value).toBeNull();
    expect(r.metrics.relativeChange.explanation).toMatch(/zero|negative/);
    expect(JSON.stringify(r)).not.toMatch(/Infinity|NaN/);
  });
  it('regression uses elapsed days with slope10 R²1', () => {
    const model = fixture([10, 20, 30, 40]);
    const r = measure(model, measurement('regression', model));
    expect(r.metrics.slopePerDay.value).toBe(10);
    expect(r.metrics.rSquared.value).toBe(1);
    expect(r.residuals?.every((p) => p.value === 0)).toBe(true);
  });
  it('regression respects irregular elapsed timestamps', () => {
    const model = fixture([10, 30, 60]);
    model.datasets[0].observations[1].time = day(2);
    model.datasets[0].observations[2].time = day(5);
    const r = measure(model, measurement('regression', model));
    expect(r.metrics.slopePerDay.value).toBeCloseTo(10);
    expect(r.metrics.rSquared.value).toBe(1);
  });
  it('constant regression R² is undefined, slope remains0', () => {
    const model = fixture([5, 5, 5]);
    const r = measure(model, measurement('regression', model));
    expect(r.metrics.slopePerDay.value).toBe(0);
    expect(r.metrics.rSquared.value).toBeNull();
  });
  it.each(['pearson', 'spearman'] as const)('%s correlation golden1', (method) => {
    const model = withSecond(fixture([1, 2, 3, 4]), [2, 4, 6, 8]);
    const r = measure(
      model,
      measurement('correlation', model, { seriesIds: ['series', 'second'], method }),
    );
    expect(r.metrics.correlation.value).toBe(1);
    expect(r.metrics.matchedObservations.value).toBe(4);
  });
  it('Spearman assigns average tie ranks', () => {
    expect(ranks([1, 2, 2, 4])).toEqual([1, 2.5, 2.5, 4]);
    expect(pearson(ranks([1, 2, 2, 4]), ranks([1, 3, 3, 4]))).toBe(1);
  });
  it('correlation constant and missing pairs are explicit', () => {
    const model = withSecond(fixture([1, null, 3, 4]), [2, 4, null, 8]);
    expect(
      measure(model, measurement('correlation', model, { seriesIds: ['series', 'second'] })).metrics
        .matchedObservations.value,
    ).toBe(2);
    const constant = withSecond(fixture([1, 1, 1]), [2, 3, 4]);
    expect(
      measure(constant, measurement('correlation', constant, { seriesIds: ['series', 'second'] }))
        .metrics.correlation.value,
    ).toBeNull();
  });
  it('positive/negative lag has documented X[t],Y[t+lag] matching', () => {
    const model = withSecond(fixture([1, 2, 4, 8]), [0, 1, 2, 4]);
    const m = measurement('correlation', model, { seriesIds: ['series', 'second'], lag: 1 });
    expect(measure(model, m).metrics.correlation.value).toBe(1);
    expect(measure(model, { ...m, lag: -1 }).metrics.matchedObservations.value).toBe(3);
  });
  it('range statistics use sample deviation and preserve missing coverage', () => {
    const model = fixture([10, 20, null, 30]);
    const r = measure(model, measurement('range-statistics', model));
    expect(r.metrics.mean.value).toBe(20);
    expect(r.metrics.median.value).toBe(20);
    expect(r.metrics.standardDeviation.value).toBe(10);
    expect(r.metrics.coverage.value).toBe(0.75);
    expect(r.metrics.sum).toBeUndefined();
  });
  it('calendar coverage counts absent periods separately from provided valid rows', () => {
    const model = fixture([10, 20]);
    model.datasets[0].observations[1].time = day(9);
    const result = measure(model, measurement('range-statistics', model));
    expect(result.metrics.observationCoverage.value).toBe(1);
    expect(result.metrics.expectedCalendarPeriods.value).toBe(10);
    expect(result.metrics.missingCalendarPeriods.value).toBe(8);
    expect(result.metrics.calendarCoverage.value).toBe(0.2);
    model.series[0].resolution = 'observation';
    expect(
      measure(model, measurement('range-statistics', model)).metrics.calendarCoverage.value,
    ).toBeNull();
  });
  it('flow totals remain undefined when selected calendar periods are absent', () => {
    const model = fixture([10, 20], { semantics: 'flow', aggregation: 'sum' });
    model.datasets[0].observations[1].time = day(9);
    expect(measure(model, measurement('range-statistics', model)).metrics.sum.value).toBeNull();
    model.datasets[0].observations[1].time = day(1);
    expect(measure(model, measurement('range-statistics', model)).metrics.sum.value).toBe(30);
  });
  it('time range separates elapsed time, calendar and observed counts', () => {
    const model = fixture([1, 2]);
    model.datasets[0].observations[1].time = day(9);
    const r = measure(model, measurement('time-range', model));
    expect(r.metrics.elapsedSeconds.value).toBe(9 * 86400);
    expect(r.metrics.calendarPeriods.value).toBe(10);
    expect(r.metrics.actualObservations.value).toBe(2);
  });
  it('manual trend anchors use actual slope independent of fit', () => {
    const model = fixture([1, 10]);
    const r = measure(
      model,
      measurement('trend-line', model, {
        points: [
          { time: day(0), value: 10 },
          { time: day(2), value: 50 },
        ],
      }),
    );
    expect(r.metrics.slopePerDay.value).toBe(20);
  });
  it('SMA and first-value-seeded EMA match independent golden fixtures', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5], 0.5)).toEqual([1, 1.5, 2.25, 3.125, 4.0625]);
  });
  it('EMA resets after missing data', () => {
    expect(ema([1, 2, null, 5, 7], 0.5)).toEqual([1, 1.5, null, 5, 6]);
  });
  it('Bollinger uses sample n-1 variation and no confidence label', () => {
    const m = fixture([1, 2, 3]);
    const r = calculateIndicator(m, {
      id: 'band',
      name: 'Band',
      seriesId: 'series',
      kind: 'bollinger',
      window: 3,
      multiplier: 2,
    });
    expect(r.points.at(-1)).toMatchObject({ value: 2, upper: 4, lower: 0 });
  });
  it('Wilder RSI seeds n changes and handles zero variation', () => {
    const m = fixture([1, 2, 3, 4, 3]);
    const r = calculateIndicator(m, {
      id: 'rsi',
      name: 'RSI',
      seriesId: 'series',
      kind: 'rsi',
      window: 3,
    });
    expect(r.points.slice(0, 4).map((p) => p.value)).toEqual([null, null, null, 100]);
    expect(r.points[4].value).toBeCloseTo(200 / 3);
    const constant = calculateIndicator(fixture([1, 1, 1, 1]), {
      id: 'rsi',
      name: 'RSI',
      seriesId: 'series',
      kind: 'rsi',
      window: 3,
    });
    expect(constant.points.at(-1)?.value).toBe(50);
  });
  it('MACD independent first-value-seed golden', () => {
    const r = calculateIndicator(fixture([1, 2, 3, 4]), {
      id: 'macd',
      name: 'MACD',
      seriesId: 'series',
      kind: 'macd',
      window: 2,
      shortWindow: 2,
      longWindow: 3,
      signalWindow: 2,
    });
    expect(r.points[0]).toMatchObject({ value: 0, signal: 0, histogram: 0 });
    expect(r.points[1].value).toBeCloseTo(1 / 6);
    expect(r.points[1].signal).toBeCloseTo(1 / 9);
    expect(r.points[1].histogram).toBeCloseTo(1 / 18);
  });
});

describe('portable deterministic signal identities', () => {
  it('copy then rerun preserves acknowledgement, mute state and linked signal identity', () => {
    let model = fixture([0, 2, 3, 0]);
    model.rules = [rule('threshold', { threshold: 1 })];
    model.signals = evaluateSignals(model).signals;
    const onset = model.signals.find((signal) => signal.state === 'onset')!;
    onset.acknowledged = true;
    onset.muted = true;
    model.scenarios = [
      {
        id: 'linked',
        name: 'Reviewed scenario',
        version: 1,
        model: 'growth-churn',
        start: month(5),
        periods: 1,
        resolution: 'month',
        reviewed: true,
        sourceSignalId: onset.id,
        assumptions: {
          openingCustomers: 1000,
          newCustomers: 30,
          reactivatedCustomers: 0,
          churnRate: 0.02,
          newCustomerGrowth: 0,
          openingMrc: 0,
          newMrc: 0,
          expansionMrc: 0,
          contractionMrc: 0,
          churnedMrc: 0,
          currency: 'SEK',
        },
      },
    ];
    model = archiveResult(model, evaluateSignals(model), {}, 1);
    const copy = remapAnalytics(model);
    const replay = evaluateSignals(copy).signals;
    expect(replay.map((signal) => signal.id)).toEqual(copy.signals.map((signal) => signal.id));
    expect(replay.map((signal) => signal.episodeId)).toEqual(
      copy.signals.map((signal) => signal.episodeId),
    );
    const archived = copy.results[0].content;
    expect(archived.kind).toBe('signals');
    if (archived.kind === 'signals')
      expect(archived.signals.map((signal) => signal.id)).toEqual(
        replay.map((signal) => signal.id),
      );
    const linked = replay.find((signal) => signal.id === copy.scenarios[0].sourceSignalId)!;
    const previous = copy.signals.find((signal) => signal.id === linked.id)!;
    expect(previous.acknowledged).toBe(true);
    expect(previous.muted).toBe(true);
    expect(linked.onsetTime).toBe(day(1));
  });
  it('filtered active-only histories retain their original onset when copied', () => {
    const model = fixture([0, 2, 3, 4, 0]);
    model.rules = [rule('threshold', { threshold: 1 })];
    model.signals = evaluateSignals(model, { from: day(2), to: day(3) }).signals;
    expect(model.signals.every((signal) => signal.state === 'active')).toBe(true);
    expect(model.signals[0].onsetTime).toBe(day(1));
    model.signals[0].acknowledged = true;
    const copy = remapAnalytics(model);
    expect(
      evaluateSignals(copy, { from: day(2), to: day(3) }).signals.map((signal) => signal.id),
    ).toEqual(copy.signals.map((signal) => signal.id));
    expect(copy.signals[0].acknowledged).toBe(true);
  });
  it('an older complete history can infer onset provenance and invalid onset is rejected', () => {
    const model = fixture([0, 2, 3, 0]);
    model.rules = [rule('threshold', { threshold: 1 })];
    model.signals = evaluateSignals(model).signals;
    for (const signal of model.signals) delete signal.onsetTime;
    const copy = remapAnalytics(model);
    expect(evaluateSignals(copy).signals.map((signal) => signal.id)).toEqual(
      copy.signals.map((signal) => signal.id),
    );
    copy.signals[0].onsetTime = day(3);
    expect(() => validateAnalytics(copy)).toThrow(/onset/);
  });
});
describe('causal signal engine AT10–AT19', () => {
  it('strict sustained threshold onset period5 resolve6', () => {
    const m = signalModel(
      [0.01, 0.02, 0.021, 0.025, 0.027, 0.019],
      rule('sustained', { threshold: 0.02, comparator: '>', consecutive: 3 }),
    );
    const r = evaluateSignals(m);
    expect(r.signals.map((s) => [s.state, s.observationTime])).toEqual([
      ['onset', month(4)],
      ['resolved', month(5)],
    ]);
    expect(evaluateSignals(m)).toEqual(r);
  });
  it('a missing period breaks confirmation sequence', () => {
    const m = signalModel(
      [0.03, 0.03, 0.03, 0.03],
      rule('sustained', { threshold: 0.02, consecutive: 3 }),
    );
    m.datasets[0].observations.splice(1, 1);
    expect(evaluateSignals(m).signals).toEqual([]);
  });
  it('SMA2/SMA3 crosses upward only at fifth observation', () => {
    const m = signalModel(
      [3, 2, 1, 2, 4],
      rule('moving-average-crossover', { shortWindow: 2, longWindow: 3, direction: 'up' }),
    );
    expect(evaluateSignals(m).signals.map((s) => s.observationTime)).toEqual([month(4)]);
  });
  it('z-score excludes current point: 8,10,12 then16 gives3', () => {
    const m = signalModel(
      [8, 10, 12, 16],
      rule('anomaly', { window: 3, threshold: 2.99, method: 'zscore' }),
    );
    const s = evaluateSignals(m).signals[0];
    expect(s.value).toBe(16);
    expect(s.deviationMagnitude).toBe(3);
    expect(s.deviationUnit).toBe('standard deviations');
    expect(s.baseline).toBe(10);
  });
  it('MAD zero scale is unknown, never fabricated confidence', () => {
    const m = signalModel(
      [10, 10, 10, 20],
      rule('anomaly', { window: 3, method: 'mad', threshold: 3 }),
    );
    const r = evaluateSignals(m);
    expect(r.signals).toEqual([]);
    expect(r.unknown).toBe(4);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|confidence":/);
  });
  it('two-sided CUSUM strict S_hi>h triggers observation6', () => {
    const m = signalModel(
      [10, 10, 12, 12, 12, 12],
      rule('structural-change', { mu0: 10, k: 1, h: 3, direction: 'up', reset: 'on-resolve' }),
    );
    const r = evaluateSignals(m);
    expect(r.signals.map((s) => s.observationTime)).toEqual([month(5)]);
    expect(r.signals[0].value).toBe(12);
    expect(r.signals[0].deviationMagnitude).toBe(4);
  });
  it('seasonality requires two complete cycles and detects injected point', () => {
    const values = Array.from(
      { length: 36 },
      (_, i) => 100 + [0, 10, 20, 0, -10, -20, 0, 10, 20, 0, -10, -20][i % 12],
    );
    const m = signalModel(
      values,
      rule('seasonality-deviation', { seasonLength: 12, tolerance: 1 }),
    );
    expect(evaluateSignals(m).signals).toEqual([]);
    m.datasets[0].observations[30].value! += 50;
    expect(evaluateSignals(m).signals.find((s) => s.state === 'onset')?.observationTime).toBe(
      month(30),
    );
    expect(evaluateSignals(signalModel(values.slice(0, 12), m.rules[0])).notes.join(' ')).toContain(
      'INSUFFICIENT_DATA',
    );
  });
  it.each([
    'anomaly',
    'momentum',
    'variation-spike',
    'structural-change',
    'seasonality-deviation',
  ] as const)('prefix invariance for %s', (family) => {
    const definition = rule(family, {
      window: 3,
      threshold: 1,
      mu0: 10,
      k: 1,
      h: 3,
      seasonLength: 3,
      tolerance: 1,
    });
    const m = signalModel([10, 11, 9, 10, 15, 14, 9, 11, 10], definition);
    const first = evaluateSignals(m, { to: month(8) });
    const later = signalModel([10, 11, 9, 10, 15, 14, 9, 11, 10, 100000, -100000], definition);
    expect(evaluateSignals(later, { to: month(8) })).toEqual(first);
  });
  it('late publication is unavailable before its knowledge cutoff', () => {
    const m = signalModel([1, 100, 1], rule('threshold', { threshold: 50 }));
    m.datasets[0].observations[1].knownAt = month(6);
    expect(querySeries(m, 'series', { cutoff: month(2) }).map((o) => o.value)).toEqual([1, 1]);
    expect(evaluateSignals(m, { to: month(2) }, { cutoff: month(2) }).signals).toEqual([]);
  });
  it('momentum down uses a positive magnitude and ignores positive growth', () => {
    const positive = signalModel(
      [100, 105],
      rule('momentum', { window: 1, threshold: 0.1, direction: 'down' }),
    );
    expect(evaluateSignals(positive).signals).toEqual([]);
    positive.datasets[0].observations[1].value = 85;
    expect(evaluateSignals(positive).signals[0].state).toBe('onset');
    positive.rules[0].parameters.threshold = -0.1;
    expect(() => evaluateSignals(positive)).toThrow(/finite/);
  });
  it('divergence cannot use unpublished secondary observations or incomplete windows', () => {
    const model = withSecond(
      signalModel(
        [100, 110, 120],
        rule('kpi-divergence', { window: 1 }, { secondSeriesId: 'second' }),
      ),
      [100, 90, 80],
    );
    const last = model.datasets[0].observations.find(
      (item) => item.seriesId === 'second' && item.time === month(2),
    )!;
    last.knownAt = month(6);
    expect(
      evaluateSignals(model, {}, { cutoff: month(2) }).signals.filter(
        (item) => item.observationTime === month(2),
      ),
    ).toEqual([]);
    expect(evaluateSignals(model, {}, { cutoff: month(2) }).unknown).toBeGreaterThan(0);
    expect(evaluateSignals(model).signals.at(-1)?.detectedAt).toBe(month(6));
    delete last.knownAt;
    expect(evaluateSignals(model).signals.at(-1)?.state).toBe('active');
    model.datasets[0].observations.find(
      (item) => item.seriesId === 'second' && item.time === month(1),
    )!.quality = 'incomplete';
    expect(evaluateSignals(model).signals).toEqual([]);
  });
  it('custom indicator operands require publication at the current detection timestamp', () => {
    const model = withSecond(
      signalModel(
        [1, 1, 1],
        rule(
          'custom',
          {},
          {
            expression: {
              kind: 'comparison',
              left: { kind: 'indicator', indicatorId: 'average' },
              operator: '>',
              right: { kind: 'constant', value: 50 },
            },
          },
        ),
      ),
      [1, 100, 1],
    );
    model.indicators = [{ id: 'average', name: 'SMA', kind: 'sma', seriesId: 'second', window: 1 }];
    model.datasets[0].observations.find(
      (item) => item.seriesId === 'second' && item.time === month(1),
    )!.knownAt = month(6);
    expect(evaluateSignals(model, {}, { cutoff: month(2) }).signals).toEqual([]);
    expect(evaluateSignals(model, {}, { cutoff: month(2) }).unknown).toBe(1);
    // The later observation is already false when the older high value arrives;
    // obsolete evidence cannot replace the newer monitoring endpoint.
    expect(evaluateSignals(model).signals).toEqual([]);
  });
  it('dense histories preserve complete counters while event publication remains bounded', () => {
    const model = fixture(
      Array.from({ length: 10002 }, () => 10),
      { resolution: 'day' },
    );
    model.rules = [rule('threshold', { threshold: 5 })];
    const result = evaluateSignals(model);
    expect(result.signals).toHaveLength(10000);
    expect(result.totalEvents).toBe(10002);
    expect(result.omittedEvents).toBe(2);
    expect(result.episodeCount).toBe(1);
    expect(result.notes.join(' ')).toMatch(/omitted/);
  });
  it('AND OR NOT propagate unknown without coercing absent values to0', () => {
    const m = signalModel(
      [1, null, 2, 0],
      rule(
        'custom',
        {},
        {
          expression: {
            kind: 'and',
            children: [
              {
                kind: 'comparison',
                left: { kind: 'series', seriesId: 'series' },
                operator: '>',
                right: { kind: 'constant', value: 0 },
              },
              {
                kind: 'not',
                child: {
                  kind: 'comparison',
                  left: { kind: 'series', seriesId: 'series' },
                  operator: '<',
                  right: { kind: 'constant', value: 0 },
                },
              },
            ],
          },
        },
      ),
    );
    const r = evaluateSignals(m);
    expect(r.unknown).toBe(1);
    expect(r.signals.map((s) => s.state)).toEqual(['onset', 'active', 'resolved']);
  });
  it('hysteresis preserves active episode and cooldown prevents immediate re-onset', () => {
    const m = signalModel(
      [11, 9, 7, 11, 11, 11],
      rule('threshold', { threshold: 10, hysteresis: 2, cooldown: 2 }),
    );
    expect(evaluateSignals(m).signals.map((s) => [s.state, s.observationTime])).toEqual([
      ['onset', month(0)],
      ['active', month(1)],
      ['resolved', month(2)],
      ['onset', month(5)],
    ]);
  });
  it('custom AST rejects executable/overdeep/cyclic content', () => {
    const m = signalModel(
      [1],
      rule(
        'custom',
        {},
        {
          expression: {
            kind: 'comparison',
            left: { kind: 'series', seriesId: 'series' },
            operator: '>',
            right: { kind: 'constant', value: 0 },
          },
        },
      ),
    );
    (m.rules[0].expression as any).code = 'globalThis.pwned=true';
    expect(() => validateAnalytics(m)).toThrow(/Unsupported field/);
    expect((globalThis as any).pwned).toBeUndefined();
    delete (m.rules[0].expression as any).code;
    const cyclic: any = { kind: 'not' };
    cyclic.child = cyclic;
    m.rules[0].expression = cyclic;
    expect(() => validateAnalytics(m)).toThrow(/Cyclic/);
  });
  it('backtest without outcome does not invent predictive accuracy', () => {
    const m = signalModel(
      Array.from({ length: 24 }, (_, i) => (i % 4 === 0 ? 2 : 0)),
      rule('threshold', { threshold: 1 }),
    );
    const c: BacktestConfig = {
      id: 'lab',
      name: 'Lab',
      ruleIds: ['rule'],
      from: month(0),
      to: month(23),
      trainEnd: month(7),
      validationEnd: month(15),
      holdoutStart: month(16),
      walkForwardPeriods: 3,
      trials: 1,
    };
    const r = backtest(m, c);
    expect(r.retrospective).toBe(true);
    expect(r.results.every((row) => row.precision === undefined && row.recall === undefined)).toBe(
      true,
    );
    expect(r.results.map((row) => row.split)).toEqual(['train', 'validation', 'holdout']);
  });
  it('predictive outcome requires one-to-one matching and excludes incomplete windows', () => {
    const m = withSecond(
      signalModel([2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0], rule('threshold', { threshold: 1 })),
      [0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2],
    );
    const c: BacktestConfig = {
      id: 'lab',
      name: 'Lab',
      ruleIds: ['rule'],
      from: month(0),
      to: month(11),
      trainEnd: month(3),
      validationEnd: month(7),
      holdoutStart: month(8),
      walkForwardPeriods: 1,
      trials: 1,
      outcome: {
        seriesId: 'second',
        comparator: '>',
        threshold: 1,
        horizon: 3,
        matching: 'first-unmatched',
      },
    };
    const r = backtest(m, c);
    expect(r.results.every((row) => (row.matchedSignals ?? 0) <= (row.episodes ?? 0))).toBe(true);
    expect(r.results.at(-1)?.evaluablePeriods).toBeLessThan(r.results.at(-1)!.episodes);
  });
  it('holdout changes cannot alter validation selection', () => {
    const m = signalModel(
      Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 2 : 0)),
      rule('threshold', { threshold: 1 }),
    );
    m.rules.push(rule('threshold', { threshold: 3 }, { id: 'other' }));
    const config: BacktestConfig = {
      id: 'lab',
      name: 'Lab',
      ruleIds: ['rule', 'other'],
      from: month(0),
      to: month(23),
      trainEnd: month(7),
      validationEnd: month(15),
      holdoutStart: month(16),
      walkForwardPeriods: 3,
      trials: 2,
    };
    const first = backtest(m, config);
    for (const o of m.datasets[0].observations.slice(16)) o.value = 999;
    const second = backtest(m, config);
    expect(first.selectedRuleId).toBe(second.selectedRuleId);
    expect(first.results.filter((r) => r.split !== 'holdout')).toEqual(
      second.results.filter((r) => r.split !== 'holdout'),
    );
    expect(first.trials).toBe(2);
  });
});
describe('data semantics and scenarios AT03 AT05 AT20–AT23', () => {
  it('actual intraperiod observations produce valid OHLC10011095105', () => {
    const m = fixture([100, 110, 95, 105]);
    const result = aggregateOHLC(m, 'series', 'month');
    expect(result[0].ohlc).toEqual({ open: 100, high: 110, low: 95, close: 105 });
  });
  it('one monthly observation cannot fabricate a candle', () => {
    expect(() => aggregateOHLC(fixture([100], { resolution: 'month' }), 'series', 'month')).toThrow(
      /fewer than two/,
    );
  });
  it('disjoint sameperiod exposure pools to92/1000, notunweighted6%', () => {
    const m = fixture([0.02, 0.1], {
      unit: { kind: 'ratio', label: 'churn' },
      semantics: 'rate',
      aggregation: 'ratio',
      resolution: 'month',
    });
    m.series[0].riskPopulation = 'opening-customers';
    const [a, b] = m.datasets[0].observations;
    a.dimensions = { segment: 'A' };
    b.dimensions = { segment: 'B' };
    b.time = a.time;
    a.numerator = 2;
    a.denominator = 100;
    b.numerator = 90;
    b.denominator = 900;
    expect(querySeries(m, 'series', { resolution: 'month' })[0].value).toBe(0.092);
    expect(() => querySeries(m, 'series', { resolution: 'year' })).not.toThrow();
    b.time = month(1);
    expect(() => querySeries(m, 'series', { resolution: 'year' })).toThrow(/cohort/);
  });
  it('population balance1010 then1019.8 with2% withoutperiodrounding', () => {
    const r = runScenario(scenario());
    expect(r.points[0].closingCustomers).toBe(1010);
    expect(r.points[1].openingCustomers).toBe(1010);
    expect(r.points[1].closingCustomers).toBeCloseTo(1019.8);
    expect(runScenario(scenario({ churnRate: 0.04 })).points[0].closingCustomers).toBe(990);
  });
  it('MRC independently reconciles101000', () => {
    expect(runScenario(scenario()).points[0].closingMrc).toBe(101000);
    expect(runScenario(scenario({ churnRate: 0.04 })).points[0].closingMrc).toBe(101000);
    expect(runScenario(scenario({ revenuePerCustomer: 100 })).points[0].churnedMrc).toBe(2000);
  });
  it('relative andpercentagepoint churn adjustments are distinct', () => {
    expect(adjustedChurn(0.02, { kind: 'relative', value: 0.2 })).toBeCloseTo(0.024);
    expect(adjustedChurn(0.02, { kind: 'percentage-points', value: 0.2 })).toBeCloseTo(0.022);
  });
  it('negative population/MRC invalidrates andunreviewed scenarios reject', () => {
    expect(() => runScenario(scenario({ churnRate: 1.1 }))).toThrow();
    expect(() => runScenario(scenario({ openingMrc: 1, churnedMrc: 10000 }))).toThrow(
      /negative MRC/,
    );
    expect(() => runScenario({ ...scenario(), reviewed: false })).toThrow(/Review/);
  });
  it('scenario results cannotmutate observations andcurrency mismatch rejects', () => {
    const m = fixture([100, 110]);
    const copy = structuredClone(m);
    const a = runScenario(scenario());
    const b = runScenario({
      ...scenario(),
      id: 'stress',
      assumptions: { ...scenario().assumptions, churnRate: 0.04 },
    });
    expect(compareScenarios([a, b])[1].customerDifference).toBeLessThan(0);
    expect(m).toEqual(copy);
    expect(() => compareScenarios([a, { ...b, currency: 'EUR' }])).toThrow(/currencies/);
  });
  it('worker/headless dispatcher uses exactlysamefunctionresult', () => {
    const m = signalModel([1, 2, 3], rule('threshold', { threshold: 1 }));
    expect(executeAnalysis({ kind: 'signals', model: m })).toEqual(evaluateSignals(m));
    expect(
      executeAnalysis({
        kind: 'measurement',
        model: m,
        measurement: measurement('range-statistics', m),
      }),
    ).toEqual(measure(m, measurement('range-statistics', m)));
    expect(executeAnalysis({ kind: 'scenario', scenario: scenario() })).toEqual(
      runScenario(scenario()),
    );
  });
});

describe('publication timing and per-condition windows', () => {
  it('monthly publication delay does not erase causal EMA/SMA', () => {
    const m = fixture([1, 2, 3], { resolution: 'month' });
    for (let i = 0; i < 3; i++) m.datasets[0].observations[i].knownAt = month(i + 1);
    const r = calculateIndicator(m, {
      id: 'sma',
      name: 'SMA',
      seriesId: 'series',
      kind: 'sma',
      window: 3,
    });
    expect(r.points.map((p) => p.value)).toEqual([null, null, 2]);
    const cutoff = calculateIndicator(
      m,
      { id: 'ema', name: 'EMA', seriesId: 'series', kind: 'ema', window: 3, alpha: 0.5 },
      { cutoff: month(2) },
    );
    expect(cutoff.points.map((p) => p.value)).toEqual([1, 1.5]);
  });
  it('gaps reset EMA and require a new complete SMA warmup', () => {
    const m = fixture([1, 2, 10, 20, 30]);
    m.datasets[0].observations.slice(2).forEach((o, i) => (o.time = day(i + 5)));
    const ema = calculateIndicator(m, {
      id: 'ema',
      name: 'EMA',
      seriesId: 'series',
      kind: 'ema',
      window: 3,
      alpha: 0.5,
    });
    expect(ema.points.map((p) => p.value)).toEqual([1, 1.5, 10, 15, 22.5]);
    const sma = calculateIndicator(m, {
      id: 'sma',
      name: 'SMA',
      seriesId: 'series',
      kind: 'sma',
      window: 3,
    });
    expect(sma.points.map((p) => p.value)).toEqual([null, null, null, null, 20]);
  });
  it('per-condition sustained AST can be ANDed with a contemporaneous KPI', () => {
    const m = withSecond(
      signalModel(
        [0.03, 0.03, 0.03, 0.03],
        rule(
          'custom',
          {},
          {
            expression: {
              kind: 'and',
              children: [
                {
                  kind: 'sustained',
                  periods: 3,
                  child: {
                    kind: 'comparison',
                    left: { kind: 'series', seriesId: 'series' },
                    operator: '>',
                    right: { kind: 'constant', value: 0.02 },
                  },
                },
                {
                  kind: 'comparison',
                  left: { kind: 'series', seriesId: 'second' },
                  operator: '<',
                  right: { kind: 'constant', value: 0 },
                },
              ],
            },
          },
        ),
      ),
      [1, 1, -1, -1],
    );
    const r = evaluateSignals(m);
    expect(r.signals[0].observationTime).toBe(month(2));
    expect(r.signals[0].state).toBe('onset');
  });
  it('window AST rejects insufficient/gapped input and computes trailing mean', () => {
    const m = signalModel(
      [1, 2, 3, 4],
      rule(
        'custom',
        {},
        {
          expression: {
            kind: 'window',
            operand: { kind: 'series', seriesId: 'series' },
            operation: 'mean',
            periods: 3,
            operator: '>',
            threshold: 2,
          },
        },
      ),
    );
    const r = evaluateSignals(m);
    expect(r.unknown).toBe(2);
    expect(r.signals.map((s) => s.observationTime)).toEqual([month(3)]);
  });
  it('an outcome occurring before delayed detection cannot count as predicted', () => {
    const m = withSecond(
      signalModel([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rule('threshold', { threshold: 1 })),
      [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    m.datasets[0].observations.find(
      (o) => o.seriesId === 'series' && o.time === month(0),
    )!.knownAt = month(2);
    m.datasets[0].observations = m.datasets[0].observations.filter(
      (o) => o.seriesId !== 'series' || o.time === month(0),
    );
    const c: BacktestConfig = {
      id: 'late',
      name: 'Late detection',
      ruleIds: ['rule'],
      from: month(0),
      to: month(11),
      trainEnd: month(5),
      validationEnd: month(8),
      holdoutStart: month(9),
      walkForwardPeriods: 2,
      trials: 1,
      outcome: {
        seriesId: 'second',
        comparator: '>',
        threshold: 1,
        horizon: 2,
        matching: 'first-unmatched',
      },
    };
    const r = backtest(m, c);
    expect(r.results[0].matchedSignals).toBe(0);
    expect(r.results[0].falseAlarms).toBe(1);
    const event = evaluateSignals(m).signals[0];
    expect(event.observationTime).toBe(month(0));
    expect(event.detectedAt).toBe(month(2));
    expect(r.results[0].detectionDelay?.value).toBe(60);
  });
  it('an outcome unpublished at split cutoff is outside recall denominator', () => {
    const m = withSecond(
      signalModel(
        Array.from({ length: 12 }, () => 0),
        rule('threshold', { threshold: 1 }),
      ),
      [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    m.datasets[0].observations.find(
      (o) => o.seriesId === 'second' && o.time === month(1),
    )!.knownAt = month(7);
    const c: BacktestConfig = {
      id: 'late',
      name: 'Late outcome',
      ruleIds: ['rule'],
      from: month(0),
      to: month(11),
      trainEnd: month(5),
      validationEnd: month(8),
      holdoutStart: month(9),
      walkForwardPeriods: 2,
      trials: 1,
      outcome: {
        seriesId: 'second',
        comparator: '>',
        threshold: 1,
        horizon: 2,
        matching: 'first-unmatched',
      },
    };
    expect(backtest(m, c).results[0].outcomeCount).toBe(0);
  });
  it('abort stops a bounded rulebatch before any result publication', () => {
    const m = signalModel([1, 2, 3], rule('threshold', { threshold: 1 }));
    m.rules.push(rule('threshold', { threshold: 1 }, { id: 'second-rule' }));
    const controller = new AbortController();
    expect(() =>
      evaluateSignals(m, {}, { signal: controller.signal, progress: () => controller.abort() }),
    ).toThrow(/cancelled/);
  });
});
