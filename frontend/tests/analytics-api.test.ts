import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, type Graph } from '../src/model/types';
import { StorageError } from '../src/model/errors';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { executeAnalysis, measure, evaluateSignals } from '../src/analytics/engine';
import type {
  AnalyticsExtension,
  AnalyticsMeasurement,
  AnalyticsScenario,
  ImportMapping,
} from '../src/analytics/types';
import { analyticsCommand } from '../src/storage/analytics-commands';
import { AnalyticsApiJobs } from '../src/storage/analytics-api-jobs';
import { archiveResult } from '../src/analytics/document';
import { reconcileAnalytics } from '../src/analytics/reconcile';
import { isCurrentSignal } from '../src/analytics/identity';
import { assertMcpAccess } from '../src/integration/access';
import { analyticsService } from '../src/analytics/service';

vi.mock('../src/analytics/service', () => ({
  analyticsService: {
    run: async (
      input: Parameters<typeof executeAnalysis>[0],
      options: { signal?: AbortSignal; guard?: () => Promise<void> },
    ) => {
      await options.guard?.();
      const result = executeAnalysis(input, {
        signal: options.signal,
        now: () => '2026-10-11T00:00:00.000Z',
      });
      await options.guard?.();
      return result;
    },
  },
}));

function model(): AnalyticsExtension {
  const value = blankAnalytics();
  value.datasets = [
    {
      id: 'history',
      name: 'History',
      version: 1,
      source: { kind: 'example', name: 'Illustrative example data', illustrative: true },
      observations: [0.01, 0.02, 0.021, 0.025, 0.027, 0.019].map((number, index) => ({
        id: `obs-${index}`,
        seriesId: 'churn',
        time: `2026-0${index + 1}-01T00:00:00.000Z`,
        value: number,
        dimensions: {},
        quality: 'valid',
      })),
      transformations: [],
      importedAt: '2026-10-11T00:00:00.000Z',
      revisionHistory: 'unavailable',
    },
  ];
  value.series = [
    {
      id: 'churn',
      name: 'Customer churn',
      datasetId: 'history',
      dimensions: {},
      unit: { kind: 'ratio', label: '%' },
      semantics: 'rate',
      provenance: 'observed',
      resolution: 'month',
      timezone: 'UTC',
      periodBoundary: 'start',
      aggregation: 'none',
      direction: 'lower-is-better',
      riskPopulation: 'opening-customers',
      definition: 'Lost customers divided by opening customers.',
    },
  ];
  value.measurements = [
    {
      id: 'change',
      name: 'Change',
      kind: 'point-to-point',
      seriesIds: ['churn'],
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-05-01T00:00:00.000Z',
    },
  ];
  value.rules = [
    {
      id: 'retention',
      name: 'Retention pressure',
      version: 1,
      enabled: true,
      family: 'sustained',
      seriesId: 'churn',
      severity: 'warning',
      parameters: { threshold: 0.02, comparator: '>', consecutive: 3 },
    },
  ];
  value.scenarios = [scenario('baseline', 0.02), scenario('stress', 0.04)];
  validateAnalytics(value);
  return value;
}
function scenario(id: string, churnRate: number): AnalyticsScenario {
  return {
    id,
    name: id,
    version: 1,
    model: 'growth-churn',
    start: '2026-07-01T00:00:00.000Z',
    periods: 2,
    resolution: 'month',
    reviewed: true,
    assumptions: {
      openingCustomers: 1000,
      newCustomers: 30,
      reactivatedCustomers: 0,
      churnRate,
      newCustomerGrowth: 0,
      openingMrc: 100000,
      newMrc: 5000,
      expansionMrc: 1000,
      contractionMrc: 2000,
      churnedMrc: 3000,
      currency: 'SEK',
    },
  };
}
function fixture(input = model()) {
  let graph = blankGraph('Analysis');
  graph.diagram.analytics = input;
  const beforeWrite = vi.fn(async () => {}),
    authorize = vi.fn(async () => {});
  const repo = {
    getGraph: vi.fn(async () => structuredClone(graph)),
    saveGraph: vi.fn(async (next: Graph, version: number, guard?: () => Promise<void>) => {
      if (version !== graph.diagram.version) throw new StorageError(409, 'Stale baseVersion.');
      await guard?.();
      graph = { ...next, diagram: { ...next.diagram, version: version + 1 } };
      return structuredClone(graph);
    }),
  };
  const jobs = new AnalyticsApiJobs(async (input, options) => {
    await options.guard();
    const result = executeAnalysis(input, {
      signal: options.signal,
      now: () => '2026-10-11T00:00:00.000Z',
    });
    await options.guard();
    return result;
  });
  const authorityController = new AbortController();
  const dispose = vi.fn(() => authorityController.abort());
  const createAuthority = async () => ({
    guard: {
      signal: authorityController.signal,
      assertCurrent: () => authorityController.signal.throwIfAborted(),
      check: async () => {
        authorityController.signal.throwIfAborted();
        await authorize();
      },
    },
    dispose,
  });
  const request = (path = '', method = 'GET', data?: unknown) => {
    const url = new URL(`/diagrams/${graph.diagram.id}/analytics${path}`, 'http://local');
    return analyticsCommand(
      repo,
      graph.diagram.id,
      url.pathname.split('/').filter(Boolean),
      url,
      method,
      data,
      { authorize, beforeWrite, createAuthority },
      jobs,
    );
  };
  return {
    repo,
    request,
    graph: () => graph,
    beforeWrite,
    authorize,
    jobs,
    authorityController,
    dispose,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('Time Series authoritative API commands', () => {
  it('returns detached explicit summaries and complete bounded configuration on request', async () => {
    const f = fixture();
    const compact = (await f.request()) as {
      analytics: { datasets: { observationCount: number; observations?: unknown }[] };
    };
    expect(compact.analytics.datasets[0]).toMatchObject({ observationCount: 6 });
    expect(compact.analytics.datasets[0].observations).toBeUndefined();
    const full = (await f.request('?full=true')) as { analytics: AnalyticsExtension };
    full.analytics.series[0].name = 'changed';
    expect(f.graph().diagram.analytics!.series[0].name).toBe('Customer churn');
    await expect(f.request('?full=maybe')).rejects.toMatchObject({ status: 422 });
  });
  it('rechecks original authority before publishing read data or private validation details', async () => {
    const f = fixture();
    f.authorize.mockImplementation(async () => {
      if (f.authorize.mock.calls.length > 1)
        throw new StorageError(403, 'Original grant revoked before publication.');
    });
    await expect(f.request()).rejects.toMatchObject({ status: 403 });
    f.authorize.mockClear();
    await expect(
      f.request('/measurements', 'POST', {
        baseVersion: 1,
        value: { privateSecret: 'must not escape' },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
  });
  it('preserves single authoritative model and returns compact versioned write acknowledgements', async () => {
    const f = fixture();
    const reply = (await f.request('/measurements/change', 'PATCH', {
      baseVersion: 1,
      value: { name: 'A named measurement' },
    })) as { baseVersion: number; analytics: unknown };
    expect(reply.baseVersion).toBe(2);
    expect(f.graph().diagram.analytics!.measurements[0].name).toBe('A named measurement');
    expect(f.beforeWrite).toHaveBeenCalledOnce();
    await expect(
      f.request('/measurements/change', 'PATCH', { baseVersion: 1, value: { name: 'Stale' } }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.request('/measurements/change', 'PATCH', { value: { name: 'No version' } }),
    ).rejects.toMatchObject({ status: 428, code: 'VERSION_REQUIRED' });
    await expect(
      f.request('/measurements/change', 'PATCH', { baseVersion: 2, value: { id: 'other' } }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('rechecks baseVersion after worker preparation before attempting a document write', async () => {
    const f = fixture();
    const original = analyticsService.run;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const waiting = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(analyticsService, 'run').mockImplementation(async (input, options = {}) => {
      if (input.kind === 'reconcile') {
        enter();
        await waiting;
      }
      return original(input, options);
    });
    const pending = f.request('/measurements/change', 'PATCH', {
      baseVersion: 1,
      value: { name: 'Prepared in the worker' },
    });
    const rejected = expect(pending).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
    });
    await entered;
    f.graph().diagram.version = 2;
    release();
    await rejected;
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    expect(f.graph().diagram.analytics!.measurements[0].name).toBe('Change');
  });
  it('prevents a late worker-prepared mutation after its original authority is revoked', async () => {
    const f = fixture();
    const original = analyticsService.run;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const waiting = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(analyticsService, 'run').mockImplementation(async (input, options = {}) => {
      if (input.kind === 'reconcile') {
        enter();
        await waiting;
      }
      return original(input, options);
    });
    const pending = f.request('/measurements/change', 'PATCH', {
      baseVersion: 1,
      value: { name: 'Revoked mutation' },
    });
    const rejected = expect(pending).rejects.toMatchObject({ status: 403 });
    await entered;
    f.authorize.mockRejectedValue(new StorageError(403, 'The original grant was revoked.'));
    release();
    await rejected;
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    expect(f.graph().diagram.version).toBe(1);
  });
  it.each(['validate', 'archive', 'reconcile', 'commit-import'])(
    'does not expose internal %s preparation jobs as programmatic analysis',
    async (kind) => {
      const f = fixture();
      await expect(f.request('/jobs', 'POST', { kind, input: {} })).rejects.toMatchObject({
        status: 422,
      });
      expect(f.repo.saveGraph).not.toHaveBeenCalled();
      expect(f.dispose).not.toHaveBeenCalled();
    },
  );
  it('uses the exact shared numerical engine for measurements, signals and scenarios', async () => {
    const f = fixture();
    const extension = f.graph().diagram.analytics!;
    expect(await f.request('/measure', 'POST', { id: 'change' })).toEqual(
      measure(extension, extension.measurements[0]),
    );
    expect(await f.request('/evaluate', 'POST', {})).toEqual(evaluateSignals(extension));
    const result = (await f.request('/project', 'POST', { id: 'baseline' })) as {
      points: { closingCustomers: number; closingMrc: number }[];
    };
    expect(result.points[0]).toMatchObject({ closingCustomers: 1010, closingMrc: 101000 });
    const compare = (await f.request('/compare', 'POST', {
      scenarioIds: ['baseline', 'stress'],
    })) as { results: { points: { closingCustomers: number }[] }[] };
    expect(compare.results.map((result) => result.points[0].closingCustomers)).toEqual([1010, 990]);
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
  });
  it('marks retained scenario inputs stale after assumption changes while preserving immutable results', async () => {
    const initial = model();
    const source = initial.scenarios[0];
    const content = executeAnalysis({ kind: 'scenario', scenario: source });
    if (!('kind' in content) || content.kind !== 'scenario')
      throw new Error('Expected scenario fixture.');
    const archived = archiveResult(initial, content, { scenario: source }, 1);
    const changed = structuredClone(archived);
    changed.scenarios[0].assumptions.churnRate = 0.04;
    const next = reconcileAnalytics(archived, changed);
    expect(next.scenarios[0].version).toBe(2);
    expect(next.results[0].stale).toBe(true);
    expect(next.results[0].content).toEqual(content);
    expect(next.results[0].parameters.scenario).toEqual(source);
    expect(archived.results[0].stale).toBe(false);
  });
  it('pages original observations without changing their resolution silently', async () => {
    const f = fixture();
    const page = (await f.request('/query?offset=1&limit=2', 'POST', { seriesId: 'churn' })) as {
      items: { value: number }[];
      nextOffset: number;
      total: number;
    };
    expect(page.items.map((point) => point.value)).toEqual([0.02, 0.021]);
    expect(page.nextOffset).toBe(3);
    expect(page.total).toBe(6);
    for (const path of ['/query?limit=1001', '/query?offset=-1', '/query?limit=1&limit=2'])
      await expect(f.request(path, 'POST', { seriesId: 'churn' })).rejects.toMatchObject({
        status: 422,
      });
    await expect(
      f.request('/query', 'POST', { seriesId: 'churn', resolution: 'quarter' }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNITS' });
    await expect(
      f.request('/query', 'POST', { seriesId: 'churn', from: '01/02/26' }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('does not commit rejected imports, then imports explicitly reviewed valid data atomically', async () => {
    const f = fixture();
    const mapping: ImportMapping = {
      format: 'wide',
      timeColumn: 'date',
      valueColumns: [
        {
          column: 'sales',
          seriesId: 'sales',
          name: 'Sales',
          unit: { kind: 'count', label: 'orders' },
          semantics: 'flow',
          aggregation: 'sum',
          direction: 'higher-is-better',
        },
      ],
      dimensions: [],
      decimal: '.',
      percent: 'ratio',
      dateFormat: 'iso',
      timezone: 'UTC',
      resolution: 'month',
      duplicatePolicy: 'reject',
      invalidRows: 'reject',
      missingValues: 'preserve',
    };
    const input = {
      datasetId: 'sales-history',
      source: {
        kind: 'csv',
        name: 'Synthetic sales.csv',
        text: 'date,sales\n2026-01-01,10\n2026-02-01,20',
      },
      mapping,
    };
    const preview = (await f.request('/import/preview', 'POST', input)) as {
      valid: boolean;
      rows: number;
    };
    expect(preview).toMatchObject({ valid: true, rows: 2 });
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    await expect(
      f.request('/import/commit', 'POST', { baseVersion: 1, input, mode: 'create' }),
    ).rejects.toMatchObject({ status: 422 });
    await f.request('/import/commit', 'POST', {
      baseVersion: 1,
      input,
      mode: 'create',
      confirmed: true,
    });
    expect(f.graph().diagram.analytics!.datasets).toHaveLength(2);
    await expect(
      f.request('/import/commit', 'POST', {
        baseVersion: 2,
        input,
        mode: 'create',
        confirmed: true,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.repo.saveGraph).toHaveBeenCalledOnce();
  });
  it('rejects malformed binary, unknown payload fields and invalid configurations before save', async () => {
    const f = fixture();
    await expect(
      f.request('/import/inspect', 'POST', {
        source: { kind: 'xlsx', name: 'x.xlsx', data: 'not base64!' },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request('/measure', 'POST', { id: 'change', measurement: {} }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request('/rules/retention', 'PATCH', {
        baseVersion: 1,
        value: { parameters: { threshold: Infinity } },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.request('/rules/retention', 'PATCH', {
        baseVersion: 1,
        value: JSON.parse('{"__proto__":{}}'),
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
  });
  it('rechecks authorization after computation and immediately before commit', async () => {
    const f = fixture();
    f.authorize.mockRejectedValueOnce(new StorageError(403, 'Revoked'));
    await expect(f.request('/measure', 'POST', { id: 'change' })).rejects.toMatchObject({
      status: 403,
    });
    expect(f.repo.saveGraph).not.toHaveBeenCalled();
    f.authorize.mockResolvedValue(undefined);
    f.beforeWrite.mockRejectedValueOnce(new StorageError(403, 'Revoked inside transaction'));
    await expect(
      f.request('/measurements/change', 'PATCH', {
        baseVersion: 1,
        value: { name: 'No late write' },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.graph().diagram.version).toBe(1);
  });
  it('classifies exact pure-preview effects independently of POST and archive writes', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const path of [
      'measure',
      'indicator',
      'waterfall',
      'evaluate',
      'validate',
      'project',
      'compare',
      'export',
      'query',
      'query?offset=0&limit=100',
      'export?limit=1',
      'import/inspect',
      'import/preview',
      'jobs',
    ])
      expect(() =>
        assertMcpAccess('read', `/diagrams/${id}/analytics/${path}`, 'POST'),
      ).not.toThrow();
    for (const path of [
      'measurements',
      'rules',
      'query/commit',
      'import/commit',
      'jobs/00000000-0000-4000-8000-000000000002/archive',
    ])
      expect(() => assertMcpAccess('read', `/diagrams/${id}/analytics/${path}`, 'POST')).toThrow(
        /read-only/i,
      );
    expect(() => assertMcpAccess('off', `/diagrams/${id}/analytics`, 'GET')).toThrow(/off/i);
    expect(() =>
      assertMcpAccess(
        'read',
        `/diagrams/${id}/analytics/jobs/00000000-0000-4000-8000-000000000002`,
        'DELETE',
      ),
    ).not.toThrow();
  });
  it('archives completed jobs with actual original input and pages that input after source refresh', async () => {
    const f = fixture();
    const status = (await f.request('/jobs', 'POST', {
      kind: 'measurement',
      input: { id: 'change' },
    })) as { jobId: string };
    await expect
      .poll(async () => ((await f.request(`/jobs/${status.jobId}`)) as { state: string }).state)
      .toBe('succeeded');
    const archived = (await f.request(`/jobs/${status.jobId}/archive`, 'POST', {
      baseVersion: 1,
    })) as { baseVersion: number };
    expect(archived.baseVersion).toBe(2);
    const result = f.graph().diagram.analytics!.results[0];
    expect(result.modelVersion).toBe(1);
    expect(result.parameters).toMatchObject({ kind: 'measurement', measurement: { id: 'change' } });
    await f.request('/datasets/history', 'PATCH', {
      baseVersion: 2,
      value: {
        observations: f
          .graph()
          .diagram.analytics!.datasets[0].observations.map((point, index) =>
            index === 0 ? { ...point, value: 0.011 } : point,
          ),
      },
    });
    expect(f.graph().diagram.analytics!.results[0].stale).toBe(true);
    const original = (await f.request(`/results/${result.id}/input?datasetId=history&limit=1`)) as {
      items: { value: number }[];
    };
    expect(original.items[0].value).toBe(0.01);
    const content = (await f.request(`/results/${result.id}/content`)) as {
      summary: { metrics: unknown };
    };
    expect(content.summary.metrics).toBeDefined();
    f.jobs.clear();
  });
  it('erases transient job/results on original-session revocation; a new grant cannot revive them', async () => {
    const f = fixture();
    const status = (await f.request('/jobs', 'POST', { kind: 'signals', input: {} })) as {
      jobId: string;
    };
    f.authorityController.abort();
    await expect(f.request(`/jobs/${status.jobId}`)).rejects.toMatchObject({ status: 404 });
    expect(f.dispose).toHaveBeenCalledOnce();
  });
  it('job archive evicts expired locked results while preserving current measurement definitions', async () => {
    const input = model();
    input.retention.results = 2;
    const initial = archiveResult(input, measure(input, input.measurements[0]), {}, 1);
    const expiredId = initial.results[0].id;
    initial.measurements[0].resultId = expiredId;
    const f = fixture(initial);
    const status = (await f.request('/jobs', 'POST', {
      kind: 'measurement',
      input: { id: 'change' },
    })) as { jobId: string };
    await expect
      .poll(async () => ((await f.request(`/jobs/${status.jobId}`)) as { state: string }).state)
      .toBe('succeeded');
    const edited = structuredClone(f.graph().diagram.analytics!);
    edited.retention.results = 1;
    edited.measurements[0].name = 'Edited while analysis was running';
    edited.measurements[0].note = 'Keep the latest definition.';
    await f.request('', 'PUT', { baseVersion: 1, value: edited });
    await f.request(`/jobs/${status.jobId}/archive`, 'POST', { baseVersion: 2 });
    const saved = f.graph().diagram.analytics!;
    expect(saved.results).toHaveLength(1);
    expect(saved.results[0].id).not.toBe(expiredId);
    expect(saved.measurements[0]).toMatchObject({
      name: 'Edited while analysis was running',
      note: 'Keep the latest definition.',
    });
    expect(saved.measurements[0].resultId).toBeUndefined();
    validateAnalytics(saved);
    f.jobs.clear();
  });
  it('archives original numerical inputs as stale after semantic source changes', async () => {
    const f = fixture();
    const status = (await f.request('/jobs', 'POST', {
      kind: 'measurement',
      input: { id: 'change' },
    })) as { jobId: string };
    await expect
      .poll(async () => ((await f.request(`/jobs/${status.jobId}`)) as { state: string }).state)
      .toBe('succeeded');
    await f.request('/series/churn', 'PATCH', {
      baseVersion: 1,
      value: { direction: 'neutral', definition: 'Revised semantic interpretation.' },
    });
    await f.request(`/jobs/${status.jobId}/archive`, 'POST', { baseVersion: 2 });
    const saved = f.graph().diagram.analytics!;
    expect(saved.datasets[0].version).toBe(1);
    expect(saved.results[0].stale).toBe(true);
    expect(saved.results[0].inputSnapshot.series[0]).toMatchObject({
      direction: 'lower-is-better',
      definition: 'Lost customers divided by opening customers.',
    });
    expect(saved.series[0].direction).toBe('neutral');
    f.jobs.clear();
  });
  it('preserves handled historical signal provenance when API detection runs on refreshed data', async () => {
    const initial = model();
    initial.signals = evaluateSignals(initial).signals;
    const original = initial.signals[0];
    original.acknowledged = true;
    initial.scenarios[0].sourceSignalId = original.id;
    const f = fixture(initial);
    await f.request('/datasets/history', 'PATCH', {
      baseVersion: 1,
      value: {
        observations: initial.datasets[0].observations.map((point, index) =>
          index === 3 ? { ...point, value: 0.04 } : point,
        ),
      },
    });
    const status = (await f.request('/jobs', 'POST', { kind: 'signals', input: {} })) as {
      jobId: string;
    };
    await expect
      .poll(async () => ((await f.request(`/jobs/${status.jobId}`)) as { state: string }).state)
      .toBe('succeeded');
    await f.request(`/jobs/${status.jobId}/archive`, 'POST', { baseVersion: 2 });
    const saved = f.graph().diagram.analytics!;
    expect(saved.signals.find((signal) => signal.id === original.id)).toMatchObject({
      acknowledged: true,
      dataVersion: 1,
    });
    expect(saved.signals.some((signal) => signal.dataVersion === 2)).toBe(true);
    expect(new Set(saved.signals.map((signal) => signal.id)).size).toBe(saved.signals.length);
    expect(saved.scenarios[0].sourceSignalId).toBe(original.id);
    const preview = await f.request('/project', 'POST', { id: 'baseline' });
    expect(preview).toMatchObject({ kind: 'scenario', scenarioId: 'baseline' });
    validateAnalytics(saved);
    f.jobs.clear();
  });
  it.each(['measurement', 'indicator', 'backtest', 'scenario'] as const)(
    'marks a retained %s job stale after its canonical definition changes',
    async (kind) => {
      const input = model();
      input.indicators = [
        {
          id: 'smooth',
          name: 'Moving average',
          seriesId: 'churn',
          kind: 'sma',
          window: 2,
        },
      ];
      input.backtests = [
        {
          id: 'validation',
          name: 'Historical validation',
          ruleIds: ['retention'],
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-06-01T00:00:00.000Z',
          trainEnd: '2026-02-01T00:00:00.000Z',
          validationEnd: '2026-03-01T00:00:00.000Z',
          holdoutStart: '2026-04-01T00:00:00.000Z',
          walkForwardPeriods: 1,
          trials: 1,
        },
      ];
      const definitions = {
        measurement: {
          id: 'change',
          collection: 'measurements',
          value: { from: '2026-03-01T00:00:00.000Z' },
          parameter: 'measurement',
        },
        indicator: {
          id: 'smooth',
          collection: 'indicators',
          value: { window: 3 },
          parameter: 'indicator',
        },
        backtest: {
          id: 'validation',
          collection: 'backtests',
          value: { walkForwardPeriods: 2 },
          parameter: 'config',
        },
        scenario: {
          id: 'baseline',
          collection: 'scenarios',
          value: { assumptions: { churnRate: 0.03 } },
          parameter: 'scenario',
        },
      };
      const definition = definitions[kind];
      const original = structuredClone(input[definition.collection as 'measurements'][0]);
      const f = fixture(input);
      const status = (await f.request('/jobs', 'POST', { kind, input: { id: definition.id } })) as {
        jobId: string;
      };
      await expect
        .poll(async () => ((await f.request(`/jobs/${status.jobId}`)) as { state: string }).state)
        .toBe('succeeded');
      await f.request(`/${definition.collection}/${definition.id}`, 'PATCH', {
        baseVersion: 1,
        value: definition.value,
      });
      await f.request(`/jobs/${status.jobId}/archive`, 'POST', { baseVersion: 2 });
      const result = f.graph().diagram.analytics!.results[0];
      expect(result.stale).toBe(true);
      expect(result.parameters[definition.parameter]).toEqual(original);
      f.jobs.clear();
    },
  );
  it('does not export formula-like annotation text as executable CSV cells', async () => {
    const f = fixture();
    const m: AnalyticsMeasurement = {
      ...f.graph().diagram.analytics!.measurements[0],
      id: 'annotation',
      kind: 'annotation',
      note: '=HYPERLINK("https://bad.invalid")',
    };
    await f.request('/measurements', 'POST', { baseVersion: 1, value: m });
    const exported = (await f.request('/export', 'POST', {
      scope: 'measurement',
      id: 'annotation',
      format: 'csv',
    })) as { data: string; warnings: string[] };
    expect(exported.warnings[0]).toContain('apostrophe');
    expect(exported.data).not.toContain('HYPERLINK');
  });
});

describe('source versions and immutable historical result reconciliation', () => {
  it('advances changed semantic series and dependent DAG versions once without accepting forged rewinds', () => {
    const initial = model();
    initial.series.push({
      ...initial.series[0],
      id: 'first-difference',
      name: 'First difference',
      provenance: 'derived',
      riskPopulation: 'other',
      derived: { operation: 'difference', seriesIds: ['churn'] },
    });
    initial.series.push({
      ...initial.series[1],
      id: 'second-difference',
      name: 'Second difference',
      derived: { operation: 'difference', seriesIds: ['first-difference'] },
    });
    const changed = structuredClone(initial);
    changed.series[0].definition = 'Revised source definition';
    changed.series[1].name = 'Renamed difference';
    const next = reconcileAnalytics(initial, changed);
    expect(next.series.map((series) => series.version)).toEqual([2, 2, 2]);
    expect(reconcileAnalytics(next, structuredClone(next)).series).toEqual(next.series);
    const forged = structuredClone(next);
    forged.series[0].version = 1;
    expect(() => reconcileAnalytics(next, forged)).toThrow(/unchanged series/);
    const jumped = structuredClone(next);
    jumped.series[0].definition = 'Another definition';
    jumped.series[0].version = 5;
    expect(() => reconcileAnalytics(next, jumped)).toThrow(/exactly one/);
  });
  it('custom indicator source identity changes advance affected rules even for identically described series', () => {
    const initial = model();
    initial.series.push({ ...initial.series[0], id: 'alternate' });
    initial.datasets[0].observations.push(
      ...initial.datasets[0].observations.map((point) => ({
        ...point,
        id: `alternate-${point.id}`,
        seriesId: 'alternate',
        value: point.value! > 0.02 ? point.value! + 0.002 : point.value! - 0.001,
      })),
    );
    initial.indicators = [
      { id: 'smooth', name: 'Smooth churn', seriesId: 'churn', kind: 'sma', window: 1 },
    ];
    initial.rules[0] = {
      ...initial.rules[0],
      family: 'custom',
      parameters: {},
      expression: {
        kind: 'comparison',
        left: { kind: 'indicator', indicatorId: 'smooth' },
        operator: '>',
        right: { kind: 'constant', value: 0.02 },
      },
    };
    initial.signals = evaluateSignals(initial).signals;
    const original = initial.signals[0];
    const changed = structuredClone(initial);
    changed.indicators[0].seriesId = 'alternate';
    const next = reconcileAnalytics(initial, changed);
    expect(next.rules[0].version).toBe(2);
    expect(next.datasets[0].version).toBe(1);
    expect(next.series[0].version ?? 1).toBe(1);
    expect(next.signals[0]).toEqual(original);
    expect(isCurrentSignal(next, original)).toBe(false);
    const current = evaluateSignals(next).signals[0];
    expect(current.observationTime).toBe(original.observationTime);
    expect(current.ruleVersion).toBe(2);
    expect(current.id).not.toBe(original.id);
  });
  it('advances changed semantic versions and prevents forged rewind/rewritten archives', () => {
    const previous = archiveResult(model(), measure(model(), model().measurements[0]), {}, 1, {
      now: () => '2026-10-11T00:00:00.000Z',
    });
    const next = structuredClone(previous);
    next.rules[0].parameters.threshold = 0.03;
    expect(reconcileAnalytics(previous, next)).toMatchObject({
      rules: [{ version: 2 }],
      results: [{ stale: true }],
    });
    next.rules[0].version = 8;
    expect(() => reconcileAnalytics(previous, next)).toThrow(/exactly one/);
    const rewritten = structuredClone(previous);
    rewritten.results[0].inputSnapshot.datasets[0].observations[0].value = 0.99;
    expect(() => reconcileAnalytics(previous, rewritten)).toThrow(/immutable/);
  });
});

it('semantic source edits retain original signal identity and evidence on unchanged observation data', async () => {
  const initial = model();
  initial.signals = evaluateSignals(initial).signals;
  const original = structuredClone(initial.signals[0]);
  initial.signals[0].acknowledged = true;
  initial.scenarios[0].sourceSignalId = original.id;
  const f = fixture(initial);
  await f.request('/series/churn', 'PATCH', {
    baseVersion: 1,
    value: { unit: { label: 'customer churn fraction' } },
  });
  expect(f.graph().diagram.analytics!.series[0].version).toBe(2);
  expect(f.graph().diagram.analytics!.datasets[0].version).toBe(1);
  expect(f.graph().diagram.analytics!.rules[0].version).toBe(2);
  const status = (await f.request('/jobs', 'POST', { kind: 'signals', input: {} })) as {
    jobId: string;
  };
  await expect
    .poll(async () => ((await f.request(`/jobs/${status.jobId}`)) as { state: string }).state)
    .toBe('succeeded');
  await f.request(`/jobs/${status.jobId}/archive`, 'POST', { baseVersion: 2 });
  const history = f.graph().diagram.analytics!.signals;
  expect(history.find((signal) => signal.id === original.id)).toMatchObject({
    ...original,
    acknowledged: true,
  });
  const current = history.find(
    (signal) => signal.seriesVersion === 2 && signal.state === original.state,
  )!;
  expect(current.id).not.toBe(original.id);
  expect(current.dataVersion).toBe(original.dataVersion);
  expect(current.unit.label).toBe('customer churn fraction');
  validateAnalytics(f.graph().diagram.analytics!);
  f.jobs.clear();
});

it('SVG API export uses canonical data, explicit viewport and pure read-only authority', async () => {
  const input = model();
  input.charts = [
    {
      id: 'chart',
      name: 'Customer churn',
      kind: 'line',
      seriesIds: ['churn'],
      resolution: 'observation',
      normalized: false,
    },
  ];
  const f = fixture(input);
  const result = (await f.request('/export', 'POST', {
    scope: 'chart',
    id: 'chart',
    format: 'svg',
    options: { width: 900, height: 410, appearance: 'dark' },
  })) as { data: string; renderedPoints: number };
  expect(result.renderedPoints).toBe(6);
  expect(result.data).toContain('Customer churn');
  expect(result.data).toContain('width="900"');
  expect(f.repo.saveGraph).not.toHaveBeenCalled();
  await expect(
    f.request('/export?limit=1', 'POST', { scope: 'chart', id: 'chart', format: 'svg' }),
  ).rejects.toMatchObject({ status: 422 });
});
it('deleting an immutable result preserves its measurement definition and clears only the retained result link', async () => {
  const input = model();
  const measured = measure(input, input.measurements[0]);
  const archived = archiveResult(input, measured, { measurement: input.measurements[0] }, 1, {
    now: () => '2026-10-11T00:00:00.000Z',
  });
  archived.measurements[0].resultId = archived.results[0].id;
  const f = fixture(archived);
  await f.request(
    `/results/${archived.results[0].id}?baseVersion=${f.graph().diagram.version}`,
    'DELETE',
  );
  expect(f.graph().diagram.analytics!.results).toHaveLength(0);
  expect(f.graph().diagram.analytics!.measurements[0]).toEqual(input.measurements[0]);
});

it('regression measurement SVG exports remain pure read-only engine previews', async () => {
  const input = model();
  input.measurements[0].kind = 'regression';
  const f = fixture(input);
  const result = await f.request('/export', 'POST', {
    scope: 'measurement',
    id: 'change',
    format: 'svg',
  });
  expect(result).toMatchObject({ scope: 'measurement', format: 'svg', mimeType: 'image/svg+xml' });
  expect(result).toHaveProperty('data', expect.stringContaining('computed regression fit'));
  expect(f.repo.saveGraph).not.toHaveBeenCalled();
  await expect(
    f.request('/export', 'POST', { scope: 'measurement', id: 'missing', format: 'svg' }),
  ).rejects.toMatchObject({ status: 422 });
});
