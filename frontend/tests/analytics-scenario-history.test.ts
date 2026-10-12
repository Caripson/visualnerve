import { describe, expect, it, vi } from 'vitest';
import { growthChurnInput } from '../src/analytics/example';
import { executeAnalysis } from '../src/analytics/engine';
import { prepareScenarioHistory } from '../src/analytics/scenario-history';
import { validateAnalytics } from '../src/analytics/validation';
import { remapAnalytics } from '../src/analytics/remap';
import { reconcileAnalytics } from '../src/analytics/reconcile';
import { analyticsCommand, type AnalyticsRepository } from '../src/storage/analytics-commands';
import { blankGraph, type Graph } from '../src/model/types';
import type { AnalyticsExtension } from '../src/analytics/types';

vi.mock('../src/analytics/service', () => ({
  analyticsService: {
    run: async (
      request: Parameters<typeof executeAnalysis>[0],
      options: { guard?: () => Promise<void> } = {},
    ) => {
      await options.guard?.();
      const result = executeAnalysis(request);
      await options.guard?.();
      return result;
    },
  },
}));

function input() {
  const model = growthChurnInput();
  model.scenarioView = {
    customerHistorySeriesId: 'closing-customers',
    mrcHistorySeriesId: 'closing-mrc',
  };
  return model;
}

describe('explicit observed scenario history', () => {
  it('retains canonical observations before the future boundary with separate compatible panel units', async () => {
    const model = input(),
      before = structuredClone(model);
    const prepared = await prepareScenarioHistory(model, model.scenarios);
    expect(prepared.history).toHaveLength(2);
    expect(prepared.history.every((series) => series.provenance === 'observed')).toBe(true);
    expect(prepared.history.map((series) => series.points.length)).toEqual([60, 60]);
    expect(
      prepared.history
        .flatMap((series) => series.points)
        .every((point) => point.time < Date.parse(model.scenarios[0].start)),
    ).toBe(true);
    expect(prepared.customerUnit).toEqual(
      model.series.find((series) => series.id === 'closing-customers')!.unit,
    );
    expect(prepared.mrcUnit).toEqual(
      model.series.find((series) => series.id === 'closing-mrc')!.unit,
    );
    expect(model).toEqual(before);
  });

  it('does not infer historical source identities from names, matching units or assumptions', async () => {
    const model = growthChurnInput();
    expect((await prepareScenarioHistory(model, model.scenarios)).history).toEqual([]);
  });

  it('uses the originating query runner and fences each result before publication', async () => {
    const model = input();
    const controller = new AbortController();
    const guard = vi.fn(async () => {});
    const run = vi.fn(
      async (request: Extract<Parameters<typeof executeAnalysis>[0], { kind: 'query' }>) =>
        executeAnalysis(request),
    );
    await prepareScenarioHistory(
      model,
      model.scenarios,
      model.scenarioView,
      { guard, signal: controller.signal },
      run,
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenCalledTimes(6);
    const aborting = vi.fn(
      async (request: Extract<Parameters<typeof executeAnalysis>[0], { kind: 'query' }>) => {
        const result = executeAnalysis(request);
        controller.abort();
        return result;
      },
    );
    await expect(
      prepareScenarioHistory(
        model,
        model.scenarios,
        model.scenarioView,
        { signal: controller.signal },
        aborting,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborting).toHaveBeenCalledTimes(1);
  });

  it('preserves missing months and never includes source observations at or beyond projection start', async () => {
    const model = input();
    model.datasets[0].observations = model.datasets[0].observations.filter(
      (point) =>
        point.seriesId !== 'closing-customers' || point.time !== '2020-02-01T00:00:00.000Z',
    );
    model.datasets[0].observations.push({
      id: 'future-observation',
      seriesId: 'closing-customers',
      time: model.scenarios[0].start,
      value: 999999,
      quality: 'valid',
      dimensions: {},
    });
    const result = await prepareScenarioHistory(model, model.scenarios);
    expect(result.history[0].points).toHaveLength(59);
    expect(result.history[0].points[1].breakBefore).toBe(true);
    expect(result.history[0].points.some((point) => point.value === 999999)).toBe(false);
  });

  it.each(['new-customers', 'churn-rate', 'unknown'])(
    'rejects incompatible or missing historical source %s',
    (id) => {
      const model = input();
      model.scenarioView!.customerHistorySeriesId = id;
      expect(() => validateAnalytics(model)).toThrow();
    },
  );

  it('rejects unsupported calendars, coarse disaggregation and unselected mixed segments', async () => {
    for (const patch of [
      { timezone: 'Europe/Stockholm' },
      { resolution: 'quarter' as const },
      { aggregation: 'none' as const },
    ]) {
      const model = input();
      Object.assign(model.series.find((series) => series.id === 'closing-customers')!, patch);
      expect(() => validateAnalytics(model)).toThrow();
    }
    const model = input();
    const observation = model.datasets[0].observations.find(
      (point) => point.seriesId === 'closing-customers',
    )!;
    observation.dimensions = { region: 'A' };
    model.datasets[0].observations.push({
      ...observation,
      id: 'other-segment',
      dimensions: { region: 'B' },
    });
    await expect(prepareScenarioHistory(model, model.scenarios)).rejects.toMatchObject({
      code: 'INCOMPATIBLE_UNITS',
    });
  });

  it('validates MRC currency against the chosen comparison without reinterpreting independent scenarios', async () => {
    const model = input();
    const usd = {
      ...model.scenarios[0],
      id: 'usd',
      assumptions: { ...model.scenarios[0].assumptions, currency: 'USD' },
    };
    model.scenarios.push(usd);
    expect(() => validateAnalytics(model)).not.toThrow();
    await expect(prepareScenarioHistory(model, [usd])).rejects.toMatchObject({
      code: 'INCOMPATIBLE_UNITS',
    });
  });

  it('remaps saved observed history identities and treats view edits separately from assumptions', () => {
    const model = input(),
      copied = remapAnalytics(model);
    const customers = copied.series.find((series) => series.name === 'Closing customers')!;
    expect(copied.scenarioView!.customerHistorySeriesId).toBe(customers.id);
    expect(customers.id).not.toBe(model.scenarioView!.customerHistorySeriesId);
    const changed = reconcileAnalytics(model, { ...model, scenarioView: {} });
    expect(changed.scenarios).toEqual(model.scenarios);
    expect(changed.datasets).toEqual(model.datasets);
  });

  it('rejects untyped comparison fields and exposes the same saved choices in compact API configuration', async () => {
    const model = input();
    expect(() =>
      validateAnalytics({ ...model, scenarioView: null } as unknown as AnalyticsExtension),
    ).toThrow();
    expect(() =>
      validateAnalytics({
        ...model,
        scenarioView: { customerHistorySeriesId: 'closing-customers', guessedHistory: true },
      } as unknown as AnalyticsExtension),
    ).toThrow();
    const graph = blankGraph('Observed history');
    graph.diagram.analytics = model;
    const repo: AnalyticsRepository = {
      getGraph: async () => structuredClone(graph),
      saveGraph: async () => graph,
    };
    const url = new URL(`/diagrams/${graph.diagram.id}/analytics`, 'http://local');
    const result = await analyticsCommand(
      repo,
      graph.diagram.id,
      url.pathname.split('/').filter(Boolean),
      url,
      'GET',
      undefined,
    );
    expect(result).toMatchObject({
      diagramId: graph.diagram.id,
      analytics: { scenarioView: model.scenarioView },
    });
    expect(
      (
        result as {
          analytics: { datasets: { observationCount: number; observations?: unknown }[] };
        }
      ).analytics.datasets[0],
    ).toMatchObject({ observationCount: model.datasets[0].observations.length });
    expect(
      (result as { analytics: { datasets: { observations?: unknown }[] } }).analytics.datasets[0]
        .observations,
    ).toBeUndefined();
  });

  it('versioned series deletion detaches visualization-only references without modifying remaining selections', async () => {
    const model = input();
    model.charts = [];
    model.indicators = [];
    model.measurements = [];
    model.rules = [];
    model.backtests = [];
    model.signals = [];
    model.results = [];
    model.datasets[0].observations = [];
    model.series = model.series.filter((series) =>
      ['closing-customers', 'closing-mrc'].includes(series.id),
    );
    let graph: Graph = blankGraph('Observed history');
    graph.diagram.analytics = model;
    const repo = {
      getGraph: async () => structuredClone(graph),
      saveGraph: async (next: Graph) => {
        graph = structuredClone(next);
        graph.diagram.version++;
        return graph;
      },
    } as AnalyticsRepository;
    const url = new URL(
      `/diagrams/${graph.diagram.id}/analytics/series/closing-customers?baseVersion=${graph.diagram.version}`,
      'http://local',
    );
    await analyticsCommand(
      repo,
      graph.diagram.id,
      url.pathname.split('/').filter(Boolean),
      url,
      'DELETE',
      undefined,
    );
    expect(graph.diagram.analytics!.scenarioView).toEqual({ mrcHistorySeriesId: 'closing-mrc' });
    expect(graph.diagram.analytics!.scenarios).toEqual(model.scenarios);
  });
});
