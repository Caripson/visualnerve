import { describe, expect, it } from 'vitest';
import type { AnalyticsExtension } from '../src/analytics/types';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { archiveResult } from '../src/analytics/document';
import { measure } from '../src/analytics/engine';
import { analyticsDataVersionKey, retainAnalyticsResults } from '../src/analytics/retention';

function fixture(): AnalyticsExtension {
  let model = blankAnalytics();
  model.datasets = [
    {
      id: 'history',
      name: 'Illustrative example data',
      version: 1,
      source: { kind: 'example', name: 'Illustrative example data', illustrative: true },
      observations: ['2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z'].map((time, index) => ({
        id: `observation-${index}`,
        seriesId: 'customers',
        time,
        value: 100 + index * 10,
        dimensions: {},
        quality: 'valid',
      })),
      transformations: [],
      importedAt: '2025-03-01T00:00:00.000Z',
      revisionHistory: 'unavailable',
    },
  ];
  model.series = [
    {
      id: 'customers',
      name: 'Customers',
      datasetId: 'history',
      dimensions: {},
      unit: { kind: 'count', label: 'customers' },
      semantics: 'snapshot',
      provenance: 'observed',
      resolution: 'month',
      timezone: 'UTC',
      periodBoundary: 'start',
      aggregation: 'last',
      direction: 'higher-is-better',
      definition: 'Illustrative monthly customer snapshot.',
    },
  ];
  model.measurements = [
    {
      id: 'change',
      name: 'Customer change',
      kind: 'point-to-point',
      seriesIds: ['customers'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-02-01T00:00:00.000Z',
    },
  ];
  for (const version of [1, 1, 2, 3, 3]) {
    model.datasets[0].version = version;
    model.datasets[0].observations[0].value = version * 100;
    model.results = model.results.map((result) => ({
      ...result,
      stale: result.stale || result.dataVersions.history !== version,
    }));
    model = archiveResult(
      model,
      measure(model, model.measurements[0]),
      {
        measurement: model.measurements[0],
      },
      version,
      { now: () => '2025-03-01T00:00:00.000Z' },
    );
  }
  validateAnalytics(model);
  return model;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe('explicit immutable analytics archive retention', () => {
  it('reduces three retained version sets to one and keeps all newest-version snapshots', () => {
    const before = fixture();
    before.measurements[0].resultId = before.results[0].id;
    const original = structuredClone(before);
    freeze(before);
    const next = retainAnalyticsResults(before, { results: 12, dataVersions: 1 });
    expect(next.results.map((result) => result.id)).toEqual(
      before.results.slice(-2).map((result) => result.id),
    );
    expect(next.results.every((result) => result.dataVersions.history === 3)).toBe(true);
    expect(next.results[0].inputSnapshot.datasets[0].observations[0].value).toBe(300);
    expect(next.results[0].inputSnapshot).toBe(before.results[3].inputSnapshot);
    expect(next.retention).toEqual({ results: 12, dataVersions: 1 });
    expect(next.measurements[0].resultId).toBeUndefined();
    expect(next.measurements[0].name).toBe('Customer change');
    expect(before).toEqual(original);
    validateAnalytics(next);
  });

  it('applies both limits in canonical archive order and preserves only live locked-result links', () => {
    const before = fixture();
    const oldest = before.results[0].id;
    const newest = before.results.at(-1)!.id;
    before.measurements[0].resultId = oldest;
    before.measurements.push({
      ...before.measurements[0],
      id: 'latest-change',
      name: 'Latest locked result',
      resultId: newest,
    });
    const next = retainAnalyticsResults(before, { results: 1, dataVersions: 2 });
    expect(next.results.map((result) => result.id)).toEqual([newest]);
    expect(next.measurements[0]).toEqual({
      id: 'change',
      name: 'Customer change',
      kind: 'point-to-point',
      seriesIds: ['customers'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-02-01T00:00:00.000Z',
    });
    expect(next.measurements[1].resultId).toBe(newest);
    expect(before.measurements[0].resultId).toBe(oldest);
    validateAnalytics(next);
  });

  it('uses complete dataset-version sets independently of object insertion order', () => {
    expect(analyticsDataVersionKey({ dataVersions: { b: 2, a: 1 } })).toBe(
      analyticsDataVersionKey({ dataVersions: { a: 1, b: 2 } }),
    );
    expect(analyticsDataVersionKey({ dataVersions: { a: 1, b: 2 } })).not.toBe(
      analyticsDataVersionKey({ dataVersions: { a: 1, b: 3 } }),
    );
    const before = fixture();
    const combined = retainAnalyticsResults(before, { results: 3, dataVersions: 1 });
    expect(combined.results).toEqual(before.results.slice(-2));
    const same = retainAnalyticsResults(before);
    expect(same.results).toEqual(before.results);
    expect(same.datasets).toBe(before.datasets);
  });

  it.each([
    { results: 0, dataVersions: 1 },
    { results: 13, dataVersions: 1 },
    { results: 1.5, dataVersions: 1 },
    { results: 1, dataVersions: 0 },
    { results: 1, dataVersions: 4 },
    { results: 1, dataVersions: Number.NaN },
  ])('rejects invalid retention limits without modifying archive inputs: %j', (retention) => {
    const before = fixture();
    const original = structuredClone(before);
    expect(() => retainAnalyticsResults(before, retention)).toThrow(/Retention/);
    expect(before).toEqual(original);
  });
});
