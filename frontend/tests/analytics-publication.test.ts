import { describe, expect, it } from 'vitest';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { evaluateSignals, backtest, aggregateOHLC, querySeries } from '../src/analytics/engine';
import type { AnalyticsExtension, AnalyticsRule, SignalExpression } from '../src/analytics/types';

const day = (index: number) => new Date(Date.UTC(2024, 0, index + 1)).toISOString();
const primary = (threshold = 0): SignalExpression => ({
  kind: 'comparison',
  left: { kind: 'series', seriesId: 'primary' },
  operator: '>',
  right: { kind: 'constant', value: threshold },
});
const secondary = (): SignalExpression => ({
  kind: 'comparison',
  left: { kind: 'series', seriesId: 'secondary' },
  operator: '>',
  right: { kind: 'constant', value: 50 },
});
function model(values: (number | null)[], other = values): AnalyticsExtension {
  const value = blankAnalytics();
  value.series = ['primary', 'secondary'].map((id) => ({
    id,
    name: id,
    datasetId: 'data',
    dimensions: {},
    unit: { kind: 'count', label: 'customers' },
    semantics: 'snapshot',
    provenance: 'observed',
    resolution: 'day',
    timezone: 'UTC',
    periodBoundary: 'start',
    aggregation: 'last',
    direction: 'neutral',
    definition: 'Synthetic publication fixture.',
  }));
  value.datasets = [
    {
      id: 'data',
      name: 'Illustrative example data',
      version: 1,
      source: { kind: 'example', name: 'Illustrative example data', illustrative: true },
      observations: [values, other].flatMap((rows, seriesIndex) =>
        rows.map((point, index) => ({
          id: `${seriesIndex}-${index}`,
          seriesId: value.series[seriesIndex].id,
          time: day(index),
          value: point,
          dimensions: {},
          quality: point === null ? 'missing' : 'valid',
        })),
      ),
      transformations: [],
      importedAt: day(0),
      revisionHistory: 'unavailable',
    },
  ];
  return value;
}
function setRule(
  value: AnalyticsExtension,
  family: AnalyticsRule['family'],
  parameters: AnalyticsRule['parameters'] = {},
  expression?: SignalExpression,
) {
  value.rules = [
    {
      id: 'rule',
      name: 'Publication test',
      version: 1,
      enabled: true,
      family,
      seriesId: 'primary',
      severity: 'warning',
      parameters,
      ...(expression ? { expression } : {}),
      ...(family === 'kpi-divergence' ? { secondSeriesId: 'secondary' } : {}),
    },
  ];
  return value;
}
function delay(value: AnalyticsExtension, seriesId: string, index: number, release: number) {
  value.datasets[0].observations.find(
    (row) => row.seriesId === seriesId && row.time === day(index),
  )!.knownAt = day(release);
}
function captured(value: AnalyticsExtension, cutoff: number) {
  return evaluateSignals(value, {}, { cutoff: day(cutoff) }).signals;
}

describe('causal publication-time scheduling', () => {
  it('detects delayed secondary KPI at its earliest release, without a later primary observation', () => {
    const value = setRule(model([100, 120], [100, 80]), 'kpi-divergence', { window: 1 });
    delay(value, 'secondary', 1, 5);
    expect(captured(value, 4)).toEqual([]);
    expect(
      captured(value, 5).map((signal) => [signal.observationTime, signal.detectedAt, signal.state]),
    ).toEqual([[day(1), day(5), 'onset']]);
    expect(evaluateSignals(value).signals).toEqual(captured(value, 5));
  });
  it('derived-series decisions wait for every source publication', () => {
    const value = setRule(model([10, 20], [2, 2]), 'threshold', { threshold: 15 });
    value.series.push({
      ...value.series[0],
      id: 'derived',
      name: 'Combined customers',
      provenance: 'derived',
      derived: { operation: 'sum', seriesIds: ['primary', 'secondary'] },
    });
    value.rules[0].seriesId = 'derived';
    delay(value, 'secondary', 1, 5);
    expect(captured(value, 4)).toEqual([]);
    expect(captured(value, 5)[0]).toMatchObject({
      observationTime: day(1),
      detectedAt: day(5),
      value: 22,
      state: 'onset',
    });
  });
  it.each(['sma', 'ema', 'macd', 'rsi'] as const)(
    'includes all required %s indicator history releases',
    (kind) => {
      const other = kind === 'rsi' ? [10, 20, 30] : [100, 100, 100];
      const value = setRule(
        model([1, 1, 1], other),
        'custom',
        {},
        {
          kind: 'comparison',
          left: { kind: 'indicator', indicatorId: 'indicator' },
          operator: kind === 'macd' ? '>=' : '>',
          right: { kind: 'constant', value: kind === 'macd' ? 0 : 50 },
        },
      );
      value.indicators = [{ id: 'indicator', name: kind, kind, seriesId: 'secondary', window: 2 }];
      delay(value, 'secondary', kind === 'sma' ? 1 : 0, 5);
      expect(captured(value, 4)).toEqual([]);
      const signals = captured(value, 5);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({
        observationTime: day(2),
        detectedAt: day(5),
        state: 'onset',
      });
    },
  );
  it('a nested sustained/window condition waits for every required released period', () => {
    const value = setRule(
      model([1, 1, 1], [100, 100, 100]),
      'custom',
      {},
      {
        kind: 'sustained',
        periods: 2,
        child: {
          kind: 'window',
          periods: 2,
          operation: 'mean',
          operand: { kind: 'series', seriesId: 'secondary' },
          operator: '>',
          threshold: 50,
        },
      },
    );
    delay(value, 'secondary', 0, 5);
    expect(captured(value, 4)).toEqual([]);
    expect(captured(value, 5)).toHaveLength(1);
    expect(captured(value, 5)[0].detectedAt).toBe(day(5));
  });
  it('AND false and OR true resolve without waiting for irrelevant delayed branches', () => {
    const and = setRule(
      model([1, -1], [0, 100]),
      'custom',
      {},
      { kind: 'and', children: [primary(), secondary()] },
    );
    delay(and, 'secondary', 1, 5);
    expect(evaluateSignals(and).unknown).toBe(0);
    const or = setRule(
      model([1, 1], [0, 100]),
      'custom',
      {},
      { kind: 'or', children: [primary(), secondary()] },
    );
    delay(or, 'secondary', 1, 5);
    expect(captured(or, 1).map((signal) => signal.detectedAt)).toEqual([day(0), day(1)]);
    expect(evaluateSignals(or).signals).toEqual(captured(or, 1));
  });
  it('a crossing can decide false immediately when its current direction is impossible', () => {
    const value = setRule(
      model([1, 1], [100, 20]),
      'custom',
      {},
      {
        kind: 'crossing',
        direction: 'up',
        left: { kind: 'series', seriesId: 'secondary' },
        right: { kind: 'constant', value: 50 },
      },
    );
    delay(value, 'secondary', 0, 5);
    const result = evaluateSignals(value, {}, { cutoff: day(1) });
    expect(result.evaluated).toBe(1);
    expect(result.unknown).toBe(1);
    expect(result.signals).toEqual([]);
  });
  it('late old false cannot resolve a newer true condition or change its earlier-prefix evidence', () => {
    const value = setRule(model([1, 1, 1], [0, 0, 100]), 'custom', {}, secondary());
    delay(value, 'secondary', 1, 5);
    const prefix = captured(value, 2);
    expect(prefix).toHaveLength(1);
    expect(prefix[0]).toMatchObject({
      observationTime: day(2),
      detectedAt: day(2),
      state: 'onset',
    });
    expect(evaluateSignals(value).signals).toEqual(prefix);
  });
  it('late old true cannot replace a newer already-known false condition', () => {
    const value = setRule(model([1, 1, 1], [0, 100, 0]), 'custom', {}, secondary());
    delay(value, 'secondary', 1, 5);
    expect(evaluateSignals(value).signals).toEqual([]);
  });
  it('delayed earlier periods complete the latest configured N-period confirmation', () => {
    const value = setRule(
      model([1, 1, 1], [100, 100, 100]),
      'custom',
      { consecutive: 3 },
      secondary(),
    );
    delay(value, 'secondary', 0, 5);
    expect(captured(value, 4)).toEqual([]);
    const signal = captured(value, 5)[0];
    expect(signal).toMatchObject({ observationTime: day(2), detectedAt: day(5), state: 'onset' });
    const threshold = setRule(model([10, 10, 10]), 'threshold', { threshold: 5, consecutive: 3 });
    delay(threshold, 'primary', 0, 5);
    expect(captured(threshold, 4)).toEqual([]);
    expect(captured(threshold, 5)[0]).toMatchObject({
      observationTime: day(2),
      detectedAt: day(5),
      state: 'onset',
    });
  });
  it('stateful CUSUM does not consume later values before a required earlier publication', () => {
    const value = setRule(model([10, 12, 12, 12]), 'structural-change', {
      mu0: 10,
      k: 1,
      h: 2,
      direction: 'up',
    });
    delay(value, 'primary', 1, 6);
    expect(captured(value, 5)).toEqual([]);
    expect(captured(value, 6)[0]).toMatchObject({
      observationTime: day(3),
      detectedAt: day(6),
      state: 'onset',
    });
  });
  it('future extrema do not change previously detected causal events', () => {
    const value = setRule(
      model([1, 1, 1], [0, 0, 100]),
      'custom',
      {},
      { kind: 'or', children: [primary(), secondary()] },
    );
    delay(value, 'secondary', 1, 5);
    const prefix = captured(value, 2).map(
      ({ interval, definitionFingerprint, ...signal }) => signal,
    );
    for (const id of ['primary', 'secondary'])
      value.datasets[0].observations.push({
        id: `future-${id}`,
        seriesId: id,
        time: day(7),
        knownAt: day(8),
        value: 1e12,
        dimensions: {},
        quality: 'valid',
      });
    expect(
      evaluateSignals(value)
        .signals.filter((signal) => signal.detectedAt <= day(2))
        .map(({ interval, definitionFingerprint, ...signal }) => signal),
    ).toEqual(prefix);
  });
  it('Signal Lab split-boundary replay sees a delayed dependency even in a split without primary arrivals', () => {
    const value = setRule(model([100, 120], [100, 80]), 'kpi-divergence', { window: 1 });
    delay(value, 'secondary', 1, 7);
    const result = backtest(value, {
      id: 'test',
      name: 'Release replay',
      ruleIds: ['rule'],
      from: day(0),
      trainEnd: day(2),
      validationEnd: day(4),
      holdoutStart: day(5),
      to: day(8),
      walkForwardPeriods: 1,
      trials: 1,
    });
    expect(result.results.find((row) => row.split === 'train')?.episodes).toBe(0);
    expect(result.results.find((row) => row.split === 'holdout')).toMatchObject({
      episodes: 1,
      exposedPeriods: 0,
    });
    expect(result.notes.join(' ')).toContain('1 parameter/rule trial is recorded');
  });
  it('seasonality refuses incomplete full cycles rather than only checking the matching positions', () => {
    const value = setRule(model([10, 10, 10, null, 100]), 'seasonality-deviation', {
      seasonLength: 2,
      tolerance: 1,
    });
    expect(evaluateSignals(value).signals).toEqual([]);
  });
  it('aggregated values and OHLC retain the latest required publication time', () => {
    const value = model([100, 110, 95, 105]);
    delay(value, 'primary', 1, 7);
    const aggregate = querySeries(value, 'primary', { resolution: 'month' })[0];
    const candle = aggregateOHLC(value, 'primary', 'month')[0];
    expect(aggregate.knownAt).toBe(day(7));
    expect(candle.knownAt).toBe(day(7));
    expect(candle.ohlc).toEqual({ open: 100, high: 110, low: 95, close: 105 });
  });
  it('opening-customer churn requires explicit ratio/rate semantics while unrelated metrics remain unbounded', () => {
    const value = model([0.02]);
    value.series[0].riskPopulation = 'opening-customers';
    expect(() => validateAnalytics(value)).toThrow(/rate semantics and a ratio unit/);
    value.series[0].unit = { kind: 'ratio', label: 'churn' };
    value.series[0].semantics = 'rate';
    value.series[0].aggregation = 'none';
    expect(() => validateAnalytics(value)).not.toThrow();
    delete value.series[0].riskPopulation;
    value.datasets[0].observations[0].value = 1.2;
    expect(() => validateAnalytics(value)).not.toThrow();
  });
  it('missing reported churn cannot hide invalid supplied losses', () => {
    const value = model([null]);
    Object.assign(value.series[0], {
      unit: { kind: 'ratio', label: 'churn' },
      semantics: 'rate',
      aggregation: 'none',
      riskPopulation: 'opening-customers',
    });
    Object.assign(value.datasets[0].observations[0], { numerator: -1, denominator: 100 });
    expect(() => validateAnalytics(value)).toThrow(/losses no greater/);
  });
  it('derived customer churn cannot exceed its defined risk population', () => {
    const value = model([0.7], [0.6]);
    for (const definition of value.series)
      Object.assign(definition, {
        unit: { kind: 'ratio', label: 'churn' },
        semantics: 'rate',
        aggregation: 'none',
      });
    value.series.push({
      ...value.series[0],
      id: 'derived',
      name: 'Derived churn',
      riskPopulation: 'opening-customers',
      provenance: 'derived',
      derived: { operation: 'sum', seriesIds: ['primary', 'secondary'] },
    });
    expect(() => validateAnalytics(value)).not.toThrow();
    expect(() => querySeries(value, 'derived')).toThrow(/Derived customer churn/);
  });
});
