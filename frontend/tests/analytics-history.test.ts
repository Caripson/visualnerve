import { describe, expect, it } from 'vitest';
import { blankAnalytics, validateAnalytics, AnalyticsError } from '../src/analytics/validation';
import { evaluateSignals } from '../src/analytics/engine';
import { archiveResult } from '../src/analytics/document';
import { compactAnalysisModel, reconcileSignalHistory } from '../src/analytics/signal-history';
import {
  isCurrentSignal,
  signalDefinitionFingerprint,
  signalEpisodeIdentity,
} from '../src/analytics/identity';
import { remapAnalytics } from '../src/analytics/remap';
import type { AnalyticsScenario } from '../src/analytics/types';

const day = (index: number) => new Date(Date.UTC(2024, 0, index + 1)).toISOString();
function model() {
  const value = blankAnalytics();
  value.datasets = [
    {
      id: 'data',
      name: 'History fixture',
      version: 1,
      source: { kind: 'example', name: 'Illustrative fixture', illustrative: true },
      observations: [0, 2, 3, 0].map((number, index) => ({
        id: `p-${index}`,
        seriesId: 'series',
        time: day(index),
        value: number,
        quality: 'valid',
        dimensions: {},
      })),
      transformations: [],
      importedAt: day(0),
      revisionHistory: 'unavailable',
    },
  ];
  value.series = [
    {
      id: 'series',
      name: 'Customers',
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
      definition: 'Synthetic.',
    },
  ];
  value.rules = [
    {
      id: 'rule',
      name: 'Above one',
      version: 1,
      enabled: true,
      family: 'threshold',
      seriesId: 'series',
      severity: 'warning',
      parameters: { threshold: 1 },
    },
  ];
  value.signals = evaluateSignals(value).signals;
  return value;
}
function scenario(sourceSignalId: string): AnalyticsScenario {
  return {
    id: 'scenario',
    name: 'Reviewed',
    version: 1,
    model: 'growth-churn',
    start: '2024-02-01T00:00:00.000Z',
    periods: 1,
    resolution: 'month',
    reviewed: true,
    sourceSignalId,
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
  };
}
describe('shared bounded signal history', () => {
  it('rerun preserves user handling and links without mutating numerical input', () => {
    const original = model();
    Object.assign(original.signals[0], {
      acknowledged: true,
      muted: true,
      nodeId: 'node',
      annotationId: 'annotation',
    });
    const incoming = evaluateSignals(original).signals;
    const history = reconcileSignalHistory(original, incoming);
    expect(history.signals.find((signal) => signal.id === original.signals[0].id)).toMatchObject({
      acknowledged: true,
      muted: true,
      nodeId: 'node',
      annotationId: 'annotation',
    });
    expect(incoming[0].acknowledged).toBeUndefined();
    expect(history.signals).not.toBe(original.signals);
    expect(history.notes).toEqual([]);
  });
  it('refresh retains linked originals while current events receive remaining priority', () => {
    const original = model();
    original.scenarios = [scenario(original.signals[0].id)];
    original.datasets[0].version = 2;
    const incoming = evaluateSignals(original).signals;
    const history = reconcileSignalHistory(original, incoming, 2);
    expect(history.signals).toHaveLength(2);
    expect(
      history.signals.some((signal) => signal.id === original.scenarios[0].sourceSignalId),
    ).toBe(true);
    expect(history.signals.some((signal) => signal.id === incoming.at(-1)!.id)).toBe(true);
    expect(history.omittedCurrent).toBe(2);
    expect(history.evictedHistorical).toBe(2);
    expect(history.notes.join(' ')).toMatch(/omitted 2 current/);
    expect(() => validateAnalytics({ ...original, signals: history.signals })).not.toThrow();
    expect(reconcileSignalHistory(original, incoming, 2)).toEqual(history);
  });
  it('protected history never silently disappears when it cannot fit', () => {
    const original = model();
    original.signals.forEach((signal) => (signal.acknowledged = true));
    try {
      reconcileSignalHistory(original, [], 2);
      throw new Error('Expected bounded rejection.');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalyticsError);
      expect((error as AnalyticsError).code).toBe('IMPORT_LIMIT');
    }
    expect(original.signals).toHaveLength(3);
  });
  it('retained archive can recover an explicitly linked former live event', () => {
    let original = model();
    original = archiveResult(original, evaluateSignals(original), {}, 1);
    original.scenarios = [scenario(original.signals[0].id)];
    original.signals = [];
    const history = reconcileSignalHistory(original, []);
    expect(history.signals).toHaveLength(1);
    expect(history.signals[0].id).toBe(original.scenarios[0].sourceSignalId);
    expect(() => validateAnalytics({ ...original, signals: history.signals })).not.toThrow();
  });
  it('compact numeric payload removes only presentation references and retains canonical provenance', () => {
    let original = model();
    original = archiveResult(
      original,
      {
        kind: 'measurement',
        measurementId: 'measurement',
        metrics: { difference: { value: 0 } },
        notes: [],
      },
      {},
      1,
    );
    original.measurements = [
      {
        id: 'measurement',
        name: 'Locked change',
        kind: 'point-to-point',
        seriesIds: ['series'],
        from: day(0),
        to: day(3),
        resultId: original.results[0].id,
      },
    ];
    original.scenarios = [scenario(original.signals[0].id)];
    expect(() => validateAnalytics(original)).not.toThrow();
    const compact = compactAnalysisModel(original);
    expect(compact.results).toEqual([]);
    expect(compact.signals).toEqual([]);
    expect(compact.measurements[0].resultId).toBeUndefined();
    expect(compact.scenarios[0].sourceSignalId).toBeUndefined();
    expect(original.measurements[0].resultId).toBeDefined();
    expect(original.scenarios[0].sourceSignalId).toBeDefined();
    expect(() => validateAnalytics(compact)).not.toThrow();
    expect(evaluateSignals(compact)).toEqual(evaluateSignals(original));
  });
  it('scenario source links are scalar IDs and must resolve retained history', () => {
    const original = model();
    original.scenarios = [scenario('missing')];
    expect(() => validateAnalytics(original)).toThrow(/retained live history/);
    original.scenarios[0].sourceSignalId = [] as any;
    expect(() => validateAnalytics(original)).toThrow(/ID/);
    original.scenarios[0].sourceSignalId = original.signals[0].id;
    original.scenarios[0].nodeId = {} as any;
    expect(() => validateAnalytics(original)).toThrow(/ID/);
  });
  it('backtest baseline and name fields are validated before a job can start', () => {
    const original = model();
    original.backtests = [
      {
        id: 'test',
        name: 'Strict',
        ruleIds: ['rule'],
        from: day(0),
        to: day(3),
        trainEnd: day(0),
        validationEnd: day(1),
        holdoutStart: day(2),
        walkForwardPeriods: 1,
        trials: 1,
        baselineRuleId: 'missing',
      },
    ];
    expect(() => validateAnalytics(original)).toThrow(/baseline/);
    original.backtests[0].baselineRuleId = 'rule';
    original.backtests[0].name = {} as any;
    expect(() => validateAnalytics(original)).toThrow(/text/);
    original.backtests[0].name = 'Strict';
    expect(() => validateAnalytics(original)).not.toThrow();
  });
});

describe('immutable signal semantic provenance', () => {
  it('series definition changes make new events without replacing linked original evidence', () => {
    const original = model();
    const before = structuredClone(original.signals[0]);
    original.scenarios = [scenario(before.id)];
    expect(before.seriesVersion).toBe(1);
    expect(isCurrentSignal(original, before)).toBe(true);
    original.series[0].version = 2;
    original.series[0].unit = { kind: 'count', label: 'accounts' };
    const incoming = evaluateSignals(original).signals;
    expect(incoming[0].seriesVersion).toBe(2);
    expect(incoming[0].id).not.toBe(before.id);
    expect(incoming[0].definitionFingerprint).not.toBe(before.definitionFingerprint);
    expect(isCurrentSignal(original, before)).toBe(false);
    expect(isCurrentSignal(original, incoming[0])).toBe(true);
    const history = reconcileSignalHistory(original, incoming);
    expect(history.signals.find((event) => event.id === before.id)).toEqual(before);
    expect(history.signals.some((event) => event.id === original.scenarios[0].sourceSignalId)).toBe(
      true,
    );
    expect(() => validateAnalytics({ ...original, signals: history.signals })).not.toThrow();
  });
  it('derived formula and upstream semantic changes enter dependency identity', () => {
    const original = model();
    original.signals = [];
    original.series.push({ ...original.series[0], id: 'second', name: 'Adjustments' });
    original.datasets[0].observations.push(
      ...[1, 1, 1, 1].map((value, index) => ({
        id: `second-${index}`,
        seriesId: 'second',
        time: day(index),
        value,
        quality: 'valid' as const,
        dimensions: {},
      })),
    );
    original.series.push({
      ...original.series[0],
      id: 'derived',
      name: 'Derived customers',
      provenance: 'derived',
      derived: { operation: 'sum', seriesIds: ['series', 'second'] },
    });
    original.rules[0].seriesId = 'derived';
    original.rules[0].parameters.threshold = 0.5;
    const before = evaluateSignals(original).signals;
    original.series[2].derived!.operation = 'subtract';
    original.series[2].version = 2;
    const after = evaluateSignals(original).signals;
    expect(after[0].value).not.toBe(
      before.find((event) => event.observationTime === after[0].observationTime)!.value,
    );
    expect(after[0].id).not.toBe(before[0].id);
    const formulaFingerprint = signalDefinitionFingerprint(original, 'rule');
    original.series[1].definition = 'Changed upstream interpretation.';
    expect(signalDefinitionFingerprint(original, 'rule')).not.toBe(formulaFingerprint);
    expect(isCurrentSignal(original, after[0])).toBe(false);
  });
  it('secondary KPI and custom indicator dependencies cannot be mislabeled current', () => {
    const original = model();
    original.signals = [];
    original.datasets[0].observations.forEach((row, index) => (row.value = index + 1));
    original.series.push({ ...original.series[0], id: 'secondary', name: 'Other customers' });
    original.datasets[0].observations.push(
      ...[4, 3, 2, 1].map((value, index) => ({
        id: `secondary-${index}`,
        seriesId: 'secondary',
        time: day(index),
        value,
        quality: 'valid' as const,
        dimensions: {},
      })),
    );
    original.rules[0].family = 'kpi-divergence';
    original.rules[0].secondSeriesId = 'secondary';
    original.rules[0].parameters = { window: 1, threshold: 0 };
    const secondaryEvidence = evaluateSignals(original).signals[0];
    expect(secondaryEvidence).toBeDefined();
    original.series[1].version = 2;
    expect(isCurrentSignal(original, secondaryEvidence)).toBe(false);
    expect(evaluateSignals(original).signals[0].id).not.toBe(secondaryEvidence.id);
    original.rules[0] = {
      ...original.rules[0],
      family: 'custom',
      secondSeriesId: undefined,
      parameters: {},
      expression: {
        kind: 'comparison',
        operator: '>',
        left: { kind: 'indicator', indicatorId: 'average' },
        right: { kind: 'constant', value: 1 },
      },
    };
    original.indicators = [
      { id: 'average', name: 'Average', seriesId: 'series', kind: 'sma', window: 1 },
    ];
    const indicatorEvidence = evaluateSignals(original).signals[0];
    original.indicators[0].window = 2;
    expect(isCurrentSignal(original, indicatorEvidence)).toBe(false);
    expect(evaluateSignals(original).signals[0].definitionFingerprint).not.toBe(
      indicatorEvidence.definitionFingerprint,
    );
  });
  it('ID remapping preserves versioned dependency fingerprints and handled episode identities', () => {
    const original = model();
    original.series[0].version = 2;
    original.signals = evaluateSignals(original).signals;
    original.signals[0].acknowledged = true;
    original.signals[0].muted = true;
    original.scenarios = [scenario(original.signals[0].id)];
    const copy = remapAnalytics(original);
    expect(signalDefinitionFingerprint(copy, copy.rules[0].id)).toBe(
      signalDefinitionFingerprint(original, 'rule'),
    );
    const incoming = evaluateSignals(copy).signals;
    expect(incoming.map((event) => event.id)).toEqual(copy.signals.map((event) => event.id));
    const history = reconcileSignalHistory(copy, incoming);
    expect(
      history.signals.find((event) => event.id === copy.scenarios[0].sourceSignalId),
    ).toMatchObject({ acknowledged: true, muted: true, seriesVersion: 2 });
  });
  it('legacy absent versions mean one, while absent fingerprints remain historical evidence', () => {
    const original = model();
    const implicit = evaluateSignals(original);
    original.series[0].version = 1;
    expect(evaluateSignals(original)).toEqual(implicit);
    const legacy = structuredClone(original.signals[0]);
    delete legacy.seriesVersion;
    delete legacy.definitionFingerprint;
    expect(() => validateAnalytics({ ...original, signals: [legacy] })).not.toThrow();
    expect(isCurrentSignal(original, legacy)).toBe(false);
    const provenance = {
      ruleId: 'rule',
      ruleVersion: 1,
      dataVersion: 1,
      dimensions: {},
      onsetTime: day(1),
    };
    expect(signalEpisodeIdentity(provenance)).toBe(
      signalEpisodeIdentity({ ...provenance, seriesVersion: 1 }),
    );
  });
  it('invalid captured versions or fingerprints reject before persistence', () => {
    for (const version of [0, -1, 1.5, 1e9 + 1]) {
      const original = model();
      original.series[0].version = version;
      expect(() => validateAnalytics(original)).toThrow();
      delete original.series[0].version;
      original.signals[0].seriesVersion = version;
      expect(() => validateAnalytics(original)).toThrow();
    }
    const original = model();
    original.signals[0].definitionFingerprint = 'not-a-digest';
    expect(() => validateAnalytics(original)).toThrow(/fingerprint/);
  });
});
