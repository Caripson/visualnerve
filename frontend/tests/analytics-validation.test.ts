import { describe, it, expect } from 'vitest';
import {
  blankAnalytics,
  validateAnalytics,
  validateRule,
  validateScenario,
  validateOhlc,
  AnalyticsError,
} from '../src/analytics/validation';
import { querySeries } from '../src/analytics/series';
import { evaluateSignals } from '../src/analytics/signals';
import type { AnalyticsExtension, AnalyticsSeries, AnalyticsResult } from '../src/analytics/types';
const t = '2024-01-01T00:00:00.000Z';
function model() {
  const m: AnalyticsExtension = blankAnalytics();
  m.datasets = [
    {
      id: 'data',
      name: 'Synthetic',
      version: 1,
      source: { kind: 'example', name: 'Synthetic', illustrative: true },
      observations: [
        { id: 'point', seriesId: 'a', time: t, value: 100, quality: 'valid', dimensions: {} },
      ],
      transformations: [],
      importedAt: t,
      revisionHistory: 'unavailable',
    },
  ];
  m.series = [
    {
      id: 'a',
      name: 'A',
      datasetId: 'data',
      dimensions: {},
      unit: { kind: 'currency', label: 'SEK', currency: 'SEK' },
      semantics: 'snapshot',
      provenance: 'observed',
      resolution: 'month',
      timezone: 'UTC',
      periodBoundary: 'start',
      aggregation: 'last',
      direction: 'neutral',
      definition: 'Synthetic.',
    },
  ];
  return m;
}
function derived(
  m: AnalyticsExtension,
  operation: NonNullable<AnalyticsSeries['derived']>['operation'],
  ids: string[],
  unit = m.series[0].unit,
) {
  m.series.push({
    ...m.series[0],
    id: 'derived',
    name: 'Derived',
    unit,
    provenance: 'derived',
    derived: { operation, seriesIds: ids },
  });
  return m;
}
function optionalFixture() {
  const value = model();
  value.rules = [
    {
      id: 'rule',
      name: 'Threshold',
      version: 1,
      enabled: true,
      family: 'threshold',
      seriesId: 'a',
      severity: 'warning',
      parameters: { threshold: 10 },
    },
  ];
  value.charts = [
    {
      id: 'chart',
      name: 'Observed',
      kind: 'line',
      seriesIds: ['a'],
      resolution: 'observation',
      normalized: false,
    },
  ];
  value.measurements = [
    { id: 'measurement', name: 'Change', kind: 'point-to-point', seriesIds: ['a'], from: t, to: t },
  ];
  value.scenarios = [
    {
      id: 'scenario',
      name: 'Reviewed',
      version: 1,
      model: 'growth-churn',
      start: t,
      periods: 1,
      resolution: 'month',
      reviewed: true,
      assumptions: {
        openingCustomers: 100,
        newCustomers: 0,
        reactivatedCustomers: 0,
        churnRate: 0,
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
  value.backtests = [
    {
      id: 'backtest',
      name: 'Ordered',
      ruleIds: ['rule'],
      from: t,
      to: '2024-01-04T00:00:00.000Z',
      trainEnd: t,
      validationEnd: '2024-01-02T00:00:00.000Z',
      holdoutStart: '2024-01-03T00:00:00.000Z',
      walkForwardPeriods: 1,
      trials: 1,
    },
  ];
  return value;
}
function snapshot(m: AnalyticsExtension): AnalyticsResult {
  return {
    id: 'result',
    engineVersion: '1.0.0',
    dataVersions: { data: 1 },
    modelVersion: 1,
    createdAt: t,
    interval: { from: t, to: t },
    parameters: {},
    inputSnapshot: {
      datasets: structuredClone(m.datasets),
      series: structuredClone(m.series),
      rules: [],
      indicators: [],
    },
    stale: false,
    content: {
      kind: 'measurement',
      measurementId: 'measure',
      metrics: { value: { value: 100 } },
      notes: [],
    },
  };
}
describe('strict versioned analytics contract', () => {
  it.each([
    'datasets.0.observations.0.knownAt',
    'datasets.0.observations.0.periodEnd',
    'datasets.0.observations.0.ohlc',
    'series.0.columnId',
    'series.0.riskPopulation',
    'series.0.derived',
    'rules.0.secondSeriesId',
    'rules.0.expression',
    'charts.0.from',
    'charts.0.to',
    'charts.0.waterfall',
    'measurements.0.comparisonFrom',
    'measurements.0.comparisonTo',
    'measurements.0.points',
    'measurements.0.method',
    'scenarios.0.processLink',
    'scenarios.0.assumptions.churnAdjustment',
    'backtests.0.outcome',
  ])('rejects supplied falsy malformed optional field %s with a structured error', (path) => {
    for (const invalid of [null, false, '']) {
      const value = optionalFixture();
      const parts = path.split('.');
      let target: any = value;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)!] = invalid;
      expect(() => validateAnalytics(value)).toThrow(AnalyticsError);
    }
  });
  it('literal empty notes and zero-valued observations remain valid', () => {
    const value = optionalFixture();
    value.measurements[0].note = '';
    value.datasets[0].observations[0].value = 0;
    value.rules[0].enabled = false;
    value.scenarios[0].reviewed = false;
    expect(() => validateAnalytics(value)).not.toThrow();
    for (const invalid of [null, false, 0]) {
      value.measurements[0].note = invalid as any;
      expect(() => validateAnalytics(value)).toThrow(AnalyticsError);
    }
  });
  it('an observed source cannot be mislabeled derived without a calculation', () => {
    const value = model();
    value.series[0].provenance = 'derived';
    expect(() => validateAnalytics(value)).toThrow(/explicit validated expression/);
  });
  it('noncustom rules and nondivergence rules reject ignored calculation fields', () => {
    const value = optionalFixture();
    value.rules[0].expression = {
      kind: 'comparison',
      left: { kind: 'series', seriesId: 'a' },
      operator: '>',
      right: { kind: 'constant', value: 1 },
    };
    expect(() => validateAnalytics(value)).toThrow(/Only custom rules/);
    delete value.rules[0].expression;
    value.rules[0].secondSeriesId = 'a';
    expect(() => validateAnalytics(value)).toThrow(/Only KPI divergence/);
  });
  it('old nonanalytics documents need no conversion and empty extension is valid', () => {
    expect(() => validateAnalytics(blankAnalytics())).not.toThrow();
    expect(() => validateAnalytics(model())).not.toThrow();
  });
  it('chart segment selection is persisted display configuration and strictly validated', () => {
    const m = model();
    m.charts = [
      {
        id: 'chart',
        name: 'Selected segment',
        kind: 'line',
        seriesIds: ['a'],
        resolution: 'month',
        normalized: false,
        dimensions: { region: 'North' },
      },
    ];
    expect(() => validateAnalytics(m)).not.toThrow();
    (m.charts[0].dimensions as any).region = { unexpected: 'code' };
    expect(() => validateAnalytics(m)).toThrow();
  });
  it('optional handling and presentation fields keep their strict scalar contracts', () => {
    const m = model();
    m.charts = [
      {
        id: 'chart',
        name: {} as any,
        kind: 'line',
        seriesIds: ['a'],
        resolution: 'month',
        normalized: false,
      },
    ];
    expect(() => validateAnalytics(m)).toThrow(/text/);
    m.charts = [];
    m.indicators = [{ id: 'indicator', name: [] as any, kind: 'sma', seriesId: 'a', window: 1 }];
    expect(() => validateAnalytics(m)).toThrow(/text/);
    m.indicators = [];
    m.measurements = [
      {
        id: 'measurement',
        name: 'Strict',
        kind: 'point-to-point',
        seriesIds: ['a'],
        from: t,
        to: t,
        normalized: 'false' as any,
      },
    ];
    expect(() => validateAnalytics(m)).toThrow(/boolean/);
    delete m.measurements[0].normalized;
    m.measurements[0].resultId = 'missing';
    expect(() => validateAnalytics(m)).toThrow(/not retained/);
    delete m.measurements[0].resultId;
    m.measurements[0].nodeId = [] as any;
    expect(() => validateAnalytics(m)).toThrow(/ID/);
    m.measurements = [null as any];
    expect(() => validateAnalytics(m)).toThrow(/entries must be objects/);
  });
  it.each([
    ['schemaVersion', 2],
    ['engineVersion', '999'],
    ['unknownKey', {}],
  ])('rejects unsupported %s', (key, value) => {
    const m = model();
    (m as any)[key] = value;
    expect(() => validateAnalytics(m)).toThrow();
  });
  it.each([NaN, Infinity, -Infinity])('rejects nonfinite observations %s', (value) => {
    const m = model();
    m.datasets[0].observations[0].value = value;
    expect(() => validateAnalytics(m)).toThrow(/finite/);
  });
  it('rejects foreignseries datasets andduplicate IDs', () => {
    const m = model();
    m.series[0].datasetId = 'missing';
    expect(() => validateAnalytics(m)).toThrow(/dataset/);
    m.series[0].datasetId = 'data';
    m.datasets[0].observations.push({ ...m.datasets[0].observations[0] });
    expect(() => validateAnalytics(m)).toThrow(/Duplicate/);
  });
  it('enforcessemanticaggregation including no rateaverage', () => {
    const m = model();
    m.series[0].aggregation = 'sum';
    expect(() => validateAnalytics(m)).toThrow(/Aggregation/);
    m.series[0].semantics = 'rate';
    m.series[0].aggregation = 'last';
    expect(() => validateAnalytics(m)).toThrow(/Aggregation/);
  });
  it('net-growth numerators may be negative while churn losses require a risk denominator', () => {
    const m = model();
    m.series[0].unit = { kind: 'ratio', label: 'net growth' };
    m.series[0].semantics = 'rate';
    m.series[0].aggregation = 'ratio';
    Object.assign(m.datasets[0].observations[0], { value: -0.1, numerator: -10, denominator: 100 });
    expect(() => validateAnalytics(m)).not.toThrow();
    m.series[0].riskPopulation = 'opening-customers';
    expect(() => validateAnalytics(m)).toThrow();
    Object.assign(m.datasets[0].observations[0], {
      value: 0.1,
      numerator: 10,
      denominator: undefined,
    });
    expect(() => validateAnalytics(m)).toThrow(/risk population/);
  });
  it('derived differences preserve earlier publication in a narrow query interval', () => {
    const m = model();
    m.series[0].resolution = 'day';
    m.datasets[0].observations.push({
      ...m.datasets[0].observations[0],
      id: 'second',
      time: '2024-01-02T00:00:00.000Z',
      value: 120,
    });
    m.datasets[0].observations[0].knownAt = '2024-02-01T00:00:00.000Z';
    derived(m, 'difference', ['a']);
    const rows = querySeries(m, 'derived', { from: '2024-01-02T00:00:00.000Z' });
    expect(rows[0].value).toBe(20);
    expect(rows[0].knownAt).toBe('2024-02-01T00:00:00.000Z');
    expect(querySeries(m, 'derived', { cutoff: '2024-01-03T00:00:00.000Z' })[0].value).toBeNull();
  });
  it('derivedsameunit addition succeeds and mixedcurrency fails', () => {
    const m = model();
    m.series.push({ ...m.series[0], id: 'b', name: 'B' });
    m.datasets[0].observations.push({
      ...m.datasets[0].observations[0],
      id: 'point-b',
      seriesId: 'b',
      value: 50,
    });
    derived(m, 'sum', ['a', 'b']);
    expect(() => validateAnalytics(m)).not.toThrow();
    expect(querySeries(m, 'derived')[0].value).toBe(150);
    m.series[1].unit = { ...m.series[1].unit, currency: 'EUR' };
    expect(() => validateAnalytics(m)).toThrow(/compatible/);
  });
  it('ratio derivation requiresratiooutput withouttemporalaggregation', () => {
    const m = model();
    derived(m, 'relative-change', ['a']);
    expect(() => validateAnalytics(m)).toThrow(/ratio/);
    m.series[1].unit = { kind: 'ratio', label: 'change' };
    m.series[1].semantics = 'rate';
    m.series[1].aggregation = 'none';
    expect(() => validateAnalytics(m)).not.toThrow();
  });
  it('cannotmultiplydimensionalseries orinventcompositeunits', () => {
    const m = model();
    m.series.push({
      ...m.series[0],
      id: 'b',
      name: 'B',
      unit: { kind: 'count', label: 'customers' },
    });
    derived(m, 'multiply', ['a', 'b']);
    expect(() => validateAnalytics(m)).toThrow(/dimensional/);
    m.series[1].unit = { kind: 'ratio', label: 'multiplier' };
    m.series[1].semantics = 'rate';
    m.series[1].aggregation = 'none';
    expect(() => validateAnalytics(m)).not.toThrow();
  });
  it('divisionmatchingcurrency yieldsratio but wrongarity isrejected', () => {
    const m = model();
    m.series.push({ ...m.series[0], id: 'b', name: 'B' });
    derived(m, 'divide', ['a', 'b'], { kind: 'ratio', label: 'ratio' });
    m.series[2].semantics = 'rate';
    m.series[2].aggregation = 'none';
    expect(() => validateAnalytics(m)).not.toThrow();
    m.series[2].derived!.seriesIds = ['a'];
    expect(() => validateAnalytics(m)).toThrow(/operand count/);
  });
  it('derivedcycles and mixedperioddefinitions areinvalid', () => {
    const m = model();
    derived(m, 'difference', ['a']);
    m.series[0].provenance = 'derived';
    m.series[0].derived = { operation: 'difference', seriesIds: ['derived'] };
    expect(() => validateAnalytics(m)).toThrow(/Cyclic/);
    delete m.series[0].derived;
    m.series[0].provenance = 'observed';
    m.series[1].derived!.seriesIds = ['a', 'derived'];
    m.series[1].derived!.operation = 'sum';
    m.series[1].timezone = 'Europe/Stockholm';
    expect(() => validateAnalytics(m)).toThrow(/time zone/);
  });
  it('OHLC rejects missing,extra andinvertedfields', () => {
    expect(() => validateOhlc({ open: 1, high: 2, low: 0, close: 1 })).not.toThrow();
    expect(() => validateOhlc({ open: 1, high: 2, low: 0 })).toThrow();
    expect(() => validateOhlc({ open: 1, high: 0, low: 2, close: 1 })).toThrow();
    expect(() =>
      validateOhlc({ open: 1, high: 2, low: 0, close: 1, script: 'alert(1)' }),
    ).toThrow();
  });
  it('keepsimmutable data availablefor archivedresult andenforcesversionretention', () => {
    const m = model();
    m.results = [snapshot(m)];
    expect(() => validateAnalytics(m)).not.toThrow();
    m.datasets[0].observations[0].value = 200;
    expect(m.results[0].inputSnapshot.datasets[0].observations[0].value).toBe(100);
    for (let version = 2; version <= 4; version++) {
      const r = snapshot(m);
      r.id = `result-${version}`;
      r.inputSnapshot.datasets[0].version = version;
      r.dataVersions.data = version;
      m.results.push(r);
    }
    expect(() => validateAnalytics(m)).toThrow(/retained data versions/);
  });
  it('archive without actualobservations cannotpretend toholdreproducibledata', () => {
    const m = model();
    m.results = [snapshot(m)];
    (m.results[0].inputSnapshot as any).hash = 'no-data';
    expect(() => validateAnalytics(m)).toThrow(/Unsupported field/);
  });
  it.each([null, false, {}, [null], [{ observations: null }]])(
    'returns a structured validation error for malformed archived datasets: %j',
    (datasets) => {
      const m = model();
      m.results = [snapshot(m)];
      (m.results[0].inputSnapshot as any).datasets = datasets;
      expect(() => validateAnalytics(m)).toThrow(AnalyticsError);
    },
  );
  it('archives validate content keys, input versions and model metadata', () => {
    const m = model();
    m.results = [snapshot(m)];
    (m.results[0].content as any).untrusted = 'ignored';
    expect(() => validateAnalytics(m)).toThrow(/Unsupported field/);
    delete (m.results[0].content as any).untrusted;
    m.results[0].dataVersions.data = 999;
    expect(() => validateAnalytics(m)).toThrow(/immutable inputs/);
    m.results[0].dataVersions.data = 1;
    m.results[0].modelVersion = 0;
    expect(() => validateAnalytics(m)).toThrow(/positive/);
  });
  it('custom history captures its expression without inventing one threshold', () => {
    const m = model();
    m.rules = [
      {
        id: 'custom',
        name: 'Captured',
        version: 1,
        enabled: true,
        family: 'custom',
        seriesId: 'a',
        severity: 'warning',
        parameters: { threshold: 999 },
        expression: {
          kind: 'comparison',
          left: { kind: 'series', seriesId: 'a' },
          operator: '>',
          right: { kind: 'constant', value: 50 },
        },
      },
    ];
    m.signals = evaluateSignals(m).signals;
    expect(m.signals[0].threshold).toBeNull();
    expect(m.signals[0].deviationMagnitude).toBeNull();
    expect(m.signals[0].expression).toEqual(m.rules[0].expression);
    expect(m.signals[0].expression).not.toBe(m.rules[0].expression);
    m.rules = [];
    m.datasets[0].version = 2;
    m.series[0].unit = { kind: 'currency', label: 'EUR', currency: 'EUR' };
    expect(m.signals[0].unit.currency).toBe('SEK');
    expect(() => validateAnalytics(m)).not.toThrow();
    delete m.signals[0].expression;
    expect(() => validateAnalytics(m)).toThrow(/captured expression/);
  });
  it('historical expressions keep deleted indicator IDs but reject code and unbounded syntax', () => {
    const m = model();
    m.indicators = [{ id: 'average', name: 'Average', seriesId: 'a', kind: 'sma', window: 1 }];
    m.rules = [
      {
        id: 'custom',
        name: 'Captured',
        version: 1,
        enabled: true,
        family: 'custom',
        seriesId: 'a',
        severity: 'warning',
        parameters: {},
        expression: {
          kind: 'comparison',
          left: { kind: 'indicator', indicatorId: 'average' },
          operator: '>',
          right: { kind: 'constant', value: 50 },
        },
      },
    ];
    m.signals = evaluateSignals(m).signals;
    m.indicators = [];
    m.rules = [];
    expect(() => validateAnalytics(m)).not.toThrow();
    (m.signals[0].expression as any).code = 'fetch("https://example.com")';
    expect(() => validateAnalytics(m)).toThrow(/Unsupported field/);
  });
  it('stored timestamp representation is canonical so filtering cannot depend on formatting', () => {
    const m = model();
    m.datasets[0].observations[0].time = '2024-01-01T00:00:00Z';
    expect(() => validateAnalytics(m)).toThrow(/canonical/);
  });
  it('cross-series custom comparisons reject incompatible source units', () => {
    const m = model();
    m.series.push({
      ...m.series[0],
      id: 'count',
      name: 'Count',
      unit: { kind: 'count', label: 'customers' },
    });
    m.rules = [
      {
        id: 'rule',
        version: 1,
        name: 'Rule',
        enabled: true,
        family: 'custom',
        seriesId: 'a',
        severity: 'warning',
        parameters: {},
        expression: {
          kind: 'comparison',
          left: { kind: 'series', seriesId: 'a' },
          operator: '>',
          right: { kind: 'series', seriesId: 'count' },
        },
      },
    ];
    expect(() => validateAnalytics(m)).toThrow(/compatible units/);
    m.rules[0].expression = {
      kind: 'and',
      children: [
        {
          kind: 'comparison',
          left: { kind: 'series', seriesId: 'a' },
          operator: '>',
          right: { kind: 'constant', value: 100 },
        },
        {
          kind: 'comparison',
          left: { kind: 'series', seriesId: 'count' },
          operator: '<',
          right: { kind: 'constant', value: 10 },
        },
      ],
    };
    expect(() => validateAnalytics(m)).not.toThrow();
  });
  it('query rejects invalidinterval resolution andunknownfield', () => {
    const m = model();
    expect(() => querySeries(m, 'a', { from: 'not-a-date' })).toThrow(/UTC ISO/);
    expect(() => querySeries(m, 'a', { resolution: 'hour' as any })).toThrow(/resolution/);
    expect(() => querySeries(m, 'a', { code: 'alert(1)' } as any)).toThrow(/Unsupported field/);
  });
  it('declarative expressions cannot multiply nested window cost beyond the batch budget', () => {
    const m = model();
    const times = Array.from({ length: 100 }, (_, index) =>
      new Date(Date.UTC(2024, index, 1)).toISOString(),
    );
    m.datasets[0].observations = times.map((time, index) => ({
      id: `p-${index}`,
      seriesId: 'a',
      time,
      value: 100,
      dimensions: {},
      quality: 'valid',
    }));
    m.rules = [
      {
        id: 'rule',
        version: 1,
        name: 'Bounded',
        family: 'custom',
        enabled: true,
        seriesId: 'a',
        severity: 'warning',
        parameters: {},
        expression: {
          kind: 'sustained',
          periods: 1000,
          child: {
            kind: 'sustained',
            periods: 1000,
            child: {
              kind: 'comparison',
              left: { kind: 'series', seriesId: 'a' },
              operator: '>',
              right: { kind: 'constant', value: 1 },
            },
          },
        },
      },
    ];
    expect(() => evaluateSignals(m)).toThrow(/weighted evaluation budget/);
  });
  it('rules cannotrefer nonexistentseries orunboundedlooks', () => {
    const rule: any = {
      id: 'rule',
      version: 1,
      name: 'Rule',
      enabled: true,
      family: 'anomaly',
      seriesId: 'a',
      severity: 'warning',
      parameters: { window: 10001 },
    };
    expect(() => validateRule(rule, new Set(['a']), new Set())).toThrow();
    rule.parameters.window = 12;
    rule.seriesId = 'missing';
    expect(() => validateRule(rule, new Set(['a']), new Set())).toThrow(/unknown/);
  });
});
