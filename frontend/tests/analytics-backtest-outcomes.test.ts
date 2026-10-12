import { describe, expect, it } from 'vitest';
import { backtest, executeAnalysis } from '../src/analytics/engine';
import { blankAnalytics } from '../src/analytics/validation';
import type { AnalyticsExtension, AnalyticsSeries, BacktestConfig } from '../src/analytics/types';

const month = (index: number) => new Date(Date.UTC(2024, index, 1)).toISOString();

function fixture(outcomes: (number | null)[]): {
  model: AnalyticsExtension;
  config: BacktestConfig;
} {
  const series = (id: string): AnalyticsSeries => ({
    id,
    name: id,
    datasetId: 'data',
    dimensions: {},
    unit: { kind: 'count', label: 'cases' },
    semantics: 'snapshot',
    provenance: 'observed',
    resolution: 'month',
    timezone: 'UTC',
    periodBoundary: 'start',
    aggregation: 'last',
    direction: 'neutral',
    definition: 'Independent synthetic outcome-publication fixture.',
  });
  const model: AnalyticsExtension = {
    ...blankAnalytics(),
    series: [series('primary'), series('outcome')],
    datasets: [
      {
        id: 'data',
        name: 'Outcome release fixture',
        version: 1,
        source: { kind: 'example', name: 'Illustrative example data', illustrative: true },
        observations: ['primary', 'outcome'].flatMap((id) =>
          Array.from({ length: 12 }, (_, index) => {
            const value = id === 'primary' ? (index === 0 ? 2 : 0) : (outcomes[index] ?? null);
            return {
              id: `${id}-${index}`,
              seriesId: id,
              time: month(index),
              value,
              dimensions: {},
              quality: value === null ? ('missing' as const) : ('valid' as const),
            };
          }),
        ),
        transformations: [],
        importedAt: month(0),
        revisionHistory: 'point-in-time',
      },
    ],
    rules: [
      {
        id: 'rule',
        version: 1,
        name: 'Primary exceeds one',
        enabled: true,
        family: 'threshold',
        seriesId: 'primary',
        severity: 'warning',
        parameters: { threshold: 1, comparator: '>' },
      },
    ],
  };
  const config: BacktestConfig = {
    id: 'outcome-lab',
    name: 'Outcome publication validation',
    ruleIds: ['rule'],
    from: month(0),
    to: month(11),
    trainEnd: month(5),
    validationEnd: month(8),
    holdoutStart: month(9),
    walkForwardPeriods: 1,
    trials: 1,
    outcome: {
      seriesId: 'outcome',
      comparator: '>',
      threshold: 1,
      horizon: 2,
      matching: 'first-unmatched',
    },
  };
  return { model, config };
}

describe('Signal Lab outcome publication and continuity', () => {
  it('an unpublished preceding high cannot suppress a known next-period outcome', () => {
    const { model, config } = fixture([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    model.datasets[0].observations.find((point) => point.id === 'outcome-0')!.knownAt = month(6);
    const result = backtest(model, config);
    expect(result.results[0]).toMatchObject({
      episodes: 1,
      outcomeCount: 1,
      matchedSignals: 1,
      matchedOutcomes: 1,
      evaluablePeriods: 1,
      precision: { value: 1 },
      recall: { value: 1 },
      falseAlarms: 0,
    });
    // Releasing the stale January high in July does not introduce a second onset.
    expect(result.results[1].outcomeCount).toBe(0);
    expect(executeAnalysis({ kind: 'backtest', model, config })).toEqual(result);
  });

  it('an incomplete preceding high cannot suppress a complete next-period outcome', () => {
    const { model, config } = fixture([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    model.datasets[0].observations.find((point) => point.id === 'outcome-0')!.quality =
      'incomplete';
    expect(backtest(model, config).results[0]).toMatchObject({
      outcomeCount: 1,
      matchedSignals: 1,
      matchedOutcomes: 1,
      precision: { value: 1 },
      recall: { value: 1 },
    });
  });

  it('complete adjacent known highs remain one episode without a fabricated future onset', () => {
    const { model, config } = fixture([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(backtest(model, config).results[0]).toMatchObject({
      outcomeCount: 1,
      matchedSignals: 0,
      matchedOutcomes: 0,
      precision: { value: 0 },
      recall: { value: 0 },
      falseAlarms: 1,
    });
  });

  it('a missing native period breaks an outcome episode and excludes incomplete prediction windows', () => {
    const { model, config } = fixture([2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    model.datasets[0].observations = model.datasets[0].observations.filter(
      (point) => point.id !== 'outcome-1',
    );
    expect(backtest(model, config).results[0]).toMatchObject({
      outcomeCount: 2,
      matchedSignals: 0,
      evaluablePeriods: 0,
      precision: { value: null },
      recall: { value: 0 },
    });
  });

  it('late older high evidence cannot create a stale outcome after a newer known low', () => {
    const { model, config } = fixture([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    model.datasets[0].observations.find((point) => point.id === 'outcome-0')!.knownAt = month(4);
    expect(backtest(model, config).results[0]).toMatchObject({
      outcomeCount: 0,
      matchedSignals: 0,
      recall: { value: null },
    });
  });

  it('a late older low cannot resolve the known ongoing outcome episode', () => {
    const { model, config } = fixture([0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    model.datasets[0].observations.find((point) => point.id === 'outcome-0')!.knownAt = month(4);
    expect(backtest(model, config).results[0]).toMatchObject({
      outcomeCount: 1,
      matchedOutcomes: 1,
    });
  });

  it('future changes and fold-size changes preserve earlier split outcomes and holdout selection', () => {
    const { model, config } = fixture([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    model.datasets[0].observations.find((point) => point.id === 'outcome-0')!.knownAt = month(6);
    const original = backtest(model, config);
    for (const point of model.datasets[0].observations)
      if (point.time >= month(9)) point.value = 999;
    const extended = backtest(model, { ...config, walkForwardPeriods: 3 });
    expect(extended.results[0]).toEqual(original.results[0]);
    expect(extended.results[1]).toEqual(original.results[1]);
    expect(extended.selectedRuleId).toBe(original.selectedRuleId);
  });

  it('rejects mixed outcome segments while preserving an explicit semantic series filter', () => {
    const { model, config } = fixture([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const rows = model.datasets[0].observations.filter((point) => point.seriesId === 'outcome');
    for (const point of rows) point.dimensions = { region: 'A' };
    model.datasets[0].observations.push(
      ...rows.map((point) => ({ ...point, id: `${point.id}-B`, dimensions: { region: 'B' } })),
    );
    expect(() => backtest(model, config)).toThrowError(
      expect.objectContaining({ code: 'INCOMPATIBLE_UNITS' }),
    );
    model.series.find((series) => series.id === 'outcome')!.dimensions = { region: 'A' };
    expect(backtest(model, config).results[0]).toMatchObject({
      outcomeCount: 1,
      matchedSignals: 1,
      matchedOutcomes: 1,
    });
  });

  it('rejects duplicate outcome time keys rather than silently choosing one observation', () => {
    const { model, config } = fixture([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const original = model.datasets[0].observations.find((point) => point.id === 'outcome-1')!;
    model.datasets[0].observations.push({ ...original, id: 'duplicate-outcome-period' });
    expect(() => backtest(model, config)).toThrowError(
      expect.objectContaining({ code: 'INCOMPATIBLE_UNITS' }),
    );
  });
});
