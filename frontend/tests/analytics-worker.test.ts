import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsClient } from '../src/analytics/client';
import { AnalyticsService } from '../src/analytics/service';
import { clearAnalyticsIfLoaded } from '../src/analytics/lifecycle';
import { executeAnalysis } from '../src/analytics/engine';
import { blankAnalytics } from '../src/analytics/validation';
import type { AnalysisJobRequest } from '../src/analytics/types';
import { growthChurnInput } from '../src/analytics/example';
import { archiveResult, applyImport } from '../src/analytics/document';
import { measure } from '../src/analytics/engine';
import type { ImportPreview } from '../src/analytics/types';
const request: AnalysisJobRequest = {
  kind: 'scenario',
  scenario: {
    id: 'baseline',
    name: 'Baseline',
    version: 1,
    model: 'growth-churn',
    start: '2024-01-01T00:00:00.000Z',
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
    },
  },
};
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: any) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  request?: AnalysisJobRequest;
  cutoff?: string;
  postMessage(data: { request: AnalysisJobRequest; cutoff?: string }) {
    this.request = data.request;
    this.cutoff = data.cutoff;
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    this.onmessage?.({
      data: { kind: 'result', value: executeAnalysis(this.request!, { cutoff: this.cutoff }) },
    });
  }
  constructor() {
    WorkerStub.instances.push(this);
  }
}
beforeEach(() => {
  WorkerStub.instances = [];
  vi.stubGlobal('Worker', WorkerStub);
});
afterEach(() => {
  clearAnalyticsIfLoaded();
  vi.unstubAllGlobals();
});
describe('analysis owner lifecycle and security fences', () => {
  it('DOM-free service fallback uses the same engine and rechecks authority after calculation', async () => {
    vi.stubGlobal('Worker', undefined);
    const service = new AnalyticsService();
    expect(await service.run(request)).toEqual(executeAnalysis(request));
    let checks = 0;
    const revoked = service.run(request, {
      guard: async () => {
        checks++;
        if (checks === 4) throw new Error('Grant revoked');
      },
    });
    await expect(revoked).rejects.toThrow('Grant revoked');
    expect(WorkerStub.instances).toHaveLength(0);
    service.dispose();
  });
  it('worker import reconciliation matches the atomic pure implementation and leaves its source intact', async () => {
    const original = growthChurnInput();
    const preview: ImportPreview = {
      dataset: structuredClone(original.datasets[0]),
      series: structuredClone(original.series),
      valid: true,
      issues: [],
      columns: [],
      sample: [],
      rows: original.datasets[0].observations.length,
      skippedRows: 0,
    };
    preview.dataset.observations[0].value! += 5;
    const expected = applyImport(original, preview, 'replace');
    const client = new AnalyticsClient();
    const pending = client.run({
      kind: 'commit-import',
      model: original,
      preview,
      mode: 'replace',
    });
    WorkerStub.instances[0].finish();
    expect(await pending).toEqual(expected);
    expect(original.datasets[0].version).toBe(1);
    expect(original.datasets[0].observations[0].value).not.toBe(
      preview.dataset.observations[0].value,
    );
    expect(() =>
      executeAnalysis({
        kind: 'commit-import',
        model: original,
        preview: { ...preview, valid: false },
        mode: 'replace',
      }),
    ).toThrow(/Correct the import report/);
    client.dispose();
  });
  it('save preparation preserves full retained archives and validates every input', async () => {
    const initial = growthChurnInput();
    const content = measure(initial, initial.measurements[0]);
    const archived = archiveResult(initial, content, { measurement: initial.measurements[0] }, 1);
    archived.measurements[0].resultId = archived.results[0].id;
    const client = new AnalyticsClient();
    const pending = client.run({
      kind: 'archive',
      model: archived,
      content,
      parameters: {},
      modelVersion: 2,
    });
    expect(WorkerStub.instances[0].request).toMatchObject({
      kind: 'archive',
      model: { results: archived.results, measurements: archived.measurements },
    });
    WorkerStub.instances[0].finish();
    const prepared = await pending;
    expect('schemaVersion' in prepared && prepared.results).toHaveLength(2);
    expect('schemaVersion' in prepared && prepared.results[0]).toEqual(archived.results[0]);
    expect(archived.results).toHaveLength(1);
    client.dispose();
  });
  it('validate and reconcile worker requests keep history and reject archive tampering', async () => {
    const initial = growthChurnInput();
    const archived = archiveResult(initial, measure(initial, initial.measurements[0]), {}, 1);
    const client = new AnalyticsClient();
    const validated = client.run({ kind: 'validate', model: archived });
    expect(WorkerStub.instances[0].request).toMatchObject({
      kind: 'validate',
      model: { results: archived.results },
    });
    WorkerStub.instances[0].finish();
    expect(await validated).toEqual(archived);
    const changed = structuredClone(archived);
    changed.datasets[0].observations.at(-1)!.value! += 1;
    const reconciled = client.run({ kind: 'reconcile', previous: archived, model: changed });
    WorkerStub.instances[1].finish();
    expect(await reconciled).toMatchObject({
      datasets: [{ version: 2 }],
      results: [{ stale: true }],
    });
    const forged = structuredClone(archived);
    forged.results[0].inputSnapshot.datasets[0].observations[0].value = 999;
    expect(() => executeAnalysis({ kind: 'reconcile', previous: archived, model: forged })).toThrow(
      /immutable/,
    );
    client.dispose();
  });
  it('client worker result exactly matches direct engine content', async () => {
    const client = new AnalyticsClient();
    const result = client.run(request);
    WorkerStub.instances[0].finish();
    expect(await result).toEqual(executeAnalysis(request));
    expect(WorkerStub.instances[0].terminated).toBe(true);
    client.dispose();
  });
  it('worker forwards publication cutoff and matches direct numerical output', async () => {
    const model = blankAnalytics();
    model.datasets = [
      {
        id: 'data',
        name: 'Synthetic',
        version: 1,
        source: { kind: 'example', name: 'Synthetic', illustrative: true },
        observations: [
          {
            id: 'point',
            seriesId: 'series',
            time: '2024-01-01T00:00:00.000Z',
            knownAt: '2024-02-01T00:00:00.000Z',
            value: 100,
            quality: 'valid',
            dimensions: {},
          },
        ],
        importedAt: '2024-01-01T00:00:00.000Z',
        transformations: [],
        revisionHistory: 'unavailable',
      },
    ];
    model.series = [
      {
        id: 'series',
        name: 'Series',
        datasetId: 'data',
        dimensions: {},
        unit: { kind: 'count', label: 'customers' },
        resolution: 'month',
        timezone: 'UTC',
        periodBoundary: 'start',
        semantics: 'snapshot',
        aggregation: 'last',
        direction: 'neutral',
        provenance: 'observed',
        definition: 'Synthetic',
      },
    ];
    const request: AnalysisJobRequest = { kind: 'query', model, seriesId: 'series' };
    const cutoff = '2024-01-02T00:00:00.000Z';
    const client = new AnalyticsClient();
    const pending = client.run(request, { cutoff });
    WorkerStub.instances[0].finish();
    expect(await pending).toEqual(executeAnalysis(request, { cutoff }));
    expect(await pending).toEqual([]);
    client.dispose();
  });
  it('abort terminates worker immediately and rejects late response', async () => {
    const client = new AnalyticsClient(),
      abort = new AbortController();
    const result = client.run(request, { signal: abort.signal });
    const caught = result.catch((error) => error.code);
    abort.abort();
    expect(WorkerStub.instances[0].terminated).toBe(true);
    WorkerStub.instances[0].finish();
    expect(await caught).toBe('CANCELLED');
    client.dispose();
  });
  it('global vault lock clears all active clients', async () => {
    const client = new AnalyticsClient();
    const caught = client.run(request).catch((error) => error.code);
    clearAnalyticsIfLoaded();
    expect(await caught).toBe('CANCELLED');
    expect(WorkerStub.instances[0].terminated).toBe(true);
    expect(await client.run(request).catch((error) => error.code)).toBe('CANCELLED');
  });
  it('service checks authorization again after worker result', async () => {
    const service = new AnalyticsService();
    let allowed = true;
    const guard = vi.fn(async () => {
      if (!allowed) throw new Error('Grant revoked');
    });
    const pending = service.run(request, { guard }).catch((error) => error.message);
    await vi.waitFor(() => expect(WorkerStub.instances).toHaveLength(1));
    allowed = false;
    WorkerStub.instances[0].finish();
    expect(await pending).toBe('Grant revoked');
    expect(guard).toHaveBeenCalledTimes(3);
    service.dispose();
  });
  it('service bounds active workers and rejects queued job after permission changes', async () => {
    const service = new AnalyticsService();
    let allowed = true;
    const guard = async () => {
      if (!allowed) throw new Error('Grant revoked');
    };
    const first = service.run(request),
      second = service.run(request);
    await vi.waitFor(() => expect(WorkerStub.instances).toHaveLength(2));
    const third = service.run(request, { guard }).catch((error) => error.message);
    await Promise.resolve();
    allowed = false;
    WorkerStub.instances[0].finish();
    expect(await third).toBe('Grant revoked');
    WorkerStub.instances[1].finish();
    await Promise.all([first, second]);
    expect(WorkerStub.instances).toHaveLength(2);
    service.dispose();
  });
  it('lock clears queued private requests without inheriting a new session', async () => {
    const service = new AnalyticsService();
    const promises = Array.from({ length: 4 }, () =>
      service.run(request).catch((error) => error.code),
    );
    await vi.waitFor(() => expect(WorkerStub.instances).toHaveLength(2));
    service.dispose();
    expect(await Promise.all(promises)).toEqual([
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
    ]);
  });
});
