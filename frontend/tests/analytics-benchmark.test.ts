// @vitest-environment node
import { it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { evaluateSignals } from '../src/analytics/engine';
import type { AnalyticsExtension } from '../src/analytics/types';
import { archiveResult } from '../src/analytics/document';
import { reconcileAnalytics } from '../src/analytics/reconcile';
it('AT38 bounded100k-observation10-series100-rulebenchmark', () => {
  const model: AnalyticsExtension = blankAnalytics();
  const start = Date.UTC(1990, 0, 1);
  model.datasets.push({
    id: 'benchmark-data',
    name: '100000 synthetic observations',
    version: 1,
    source: { kind: 'example', name: 'Illustrative benchmark', illustrative: true },
    observations: [],
    transformations: [],
    importedAt: new Date(start).toISOString(),
    revisionHistory: 'unavailable',
  });
  for (let s = 0; s < 10; s++) {
    const id = `series-${s}`;
    model.series.push({
      id,
      name: `Synthetic ${s}`,
      datasetId: 'benchmark-data',
      dimensions: {},
      unit: { kind: 'count', label: 'units' },
      semantics: 'snapshot',
      provenance: 'observed',
      resolution: 'day',
      timezone: 'UTC',
      periodBoundary: 'start',
      aggregation: 'last',
      direction: 'neutral',
      definition: 'Locally generated deterministic benchmark.',
    });
    for (let p = 0; p < 10000; p++)
      model.datasets[0].observations.push({
        id: `${id}-${p}`,
        seriesId: id,
        time: new Date(start + p * 86400000).toISOString(),
        value: 100 + Math.sin(p / 100),
        dimensions: {},
        quality: 'valid',
      });
    for (let r = 0; r < 10; r++)
      model.rules.push({
        id: `rule-${s}-${r}`,
        version: 1,
        name: 'Threshold benchmark',
        enabled: true,
        family: 'threshold',
        seriesId: id,
        severity: 'info',
        parameters: { threshold: 1000 + r, comparator: '>', consecutive: 3 },
      });
  }
  const before = process.memoryUsage();
  let progress = 0;
  const validationStart = performance.now();
  validateAnalytics(model);
  const validationMs = performance.now() - validationStart;
  const analysisStart = performance.now();
  const result = evaluateSignals(
    model,
    {},
    {
      progress: (done, total) => {
        progress = done / total;
      },
    },
  );
  const analysisMs = performance.now() - analysisStart;
  const archiveStart = performance.now();
  const archived = archiveResult(model, result, { ruleIds: model.rules.map((rule) => rule.id) }, 1);
  const archivePreparationMs = performance.now() - archiveStart;
  const reconcileStart = performance.now();
  reconcileAnalytics(model, archived);
  const archiveReconciliationMs = performance.now() - reconcileStart;
  const after = process.memoryUsage();
  const evidence = {
    date: new Date().toISOString(),
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
    observations: 100000,
    series: 10,
    rules: 100,
    validationMs,
    analysisMs,
    archivePreparationMs,
    archiveReconciliationMs,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    rssBefore: before.rss,
    rssAfter: after.rss,
    evaluated: result.evaluated,
    unknown: result.unknown,
    scope:
      'Node engine benchmark; browser interaction/cancellation requires separate browser evidence; memory is sampled process usage, not peak.',
  };
  mkdirSync('../tmp', { recursive: true });
  writeFileSync('../tmp/analytics-benchmark.json', JSON.stringify(evidence, null, 2) + '\n');
  console.info('Analytics benchmark', JSON.stringify(evidence));
  expect(result.evaluated).toBe(1000000);
  expect(result.signals).toHaveLength(0);
  expect(progress).toBe(1);
  expect(analysisMs).toBeLessThan(30000);
}, 60000);
