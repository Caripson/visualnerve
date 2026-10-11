import type {
  AnalyticsExtension,
  AnalyticsResult,
  AnalyticsResultContent,
  AnalysisContext,
  ImportPreview,
} from './types';
import { AnalyticsError, validateAnalytics } from './validation';
import { retainAnalyticsResults } from './retention';

export type AnalyticsImportMode = 'create' | 'replace' | 'update';

function observationKey(value: ImportPreview['dataset']['observations'][number]) {
  return JSON.stringify([
    value.seriesId,
    value.time,
    Object.entries(value.dimensions).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

/** Pure reconciliation; callers save the complete validated payload in one existing transaction. */
export function applyImport(
  model: AnalyticsExtension,
  preview: ImportPreview,
  mode: AnalyticsImportMode,
  targetDatasetId?: string,
): AnalyticsExtension {
  if (!preview.valid || preview.issues.some((issue) => issue.severity === 'error'))
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'Correct the import report before committing observations.',
    );
  const next = structuredClone(model);
  const incoming = structuredClone(preview);
  const id = targetDatasetId ?? incoming.dataset.id;
  const previous = next.datasets.find((dataset) => dataset.id === id);
  if (mode === 'create' && previous)
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'This dataset already exists. Choose replace or update explicitly.',
    );
  if (mode !== 'create' && !previous)
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'Choose an existing dataset for replace or update.',
    );
  const previousSeries = next.series.filter((series) => series.datasetId === id);
  const remapped = new Map<string, string>();
  for (const series of incoming.series) {
    const candidates = previousSeries.filter(
      (entry) => entry.columnId && entry.columnId === series.columnId,
    );
    const existing =
      previousSeries.find((entry) => entry.id === series.id) ??
      previousSeries.find(
        (entry) =>
          entry.name === series.name &&
          JSON.stringify(entry.dimensions) === JSON.stringify(series.dimensions),
      ) ??
      (candidates.length === 1 &&
      incoming.series.filter((entry) => entry.columnId === series.columnId).length === 1
        ? candidates[0]
        : undefined);
    if (existing && [...remapped.values()].includes(existing.id))
      throw new AnalyticsError(
        'INVALID_ANALYTICS',
        'Several imported columns resolve to the same existing series. Use distinct semantic IDs.',
      );
    remapped.set(series.id, existing?.id ?? series.id);
    series.id = existing?.id ?? series.id;
    series.datasetId = id;
    series.version = existing?.version ?? series.version ?? 1;
    if (next.series.some((entry) => entry.id === series.id && entry.datasetId !== id))
      throw new AnalyticsError(
        'INVALID_ANALYTICS',
        'A series ID belongs to another dataset. Use a distinct series ID.',
      );
  }
  incoming.dataset.id = id;
  incoming.dataset.version = (previous?.version ?? 0) + 1;
  incoming.dataset.observations = incoming.dataset.observations.map((observation) => ({
    ...observation,
    seriesId: remapped.get(observation.seriesId) ?? observation.seriesId,
  }));
  if (mode === 'update' && previous) {
    const keys = new Set(incoming.dataset.observations.map(observationKey));
    incoming.dataset.observations = [
      ...previous.observations.filter((observation) => !keys.has(observationKey(observation))),
      ...incoming.dataset.observations,
    ].sort(
      (a, b) =>
        a.time.localeCompare(b.time) ||
        a.seriesId.localeCompare(b.seriesId) ||
        a.id.localeCompare(b.id),
    );
    incoming.dataset.transformations = [
      ...previous.transformations,
      ...incoming.dataset.transformations,
      'Update: matching time/series/segment keys replaced atomically.',
    ];
  }
  // Retain definitions for columns not supplied in a refresh. Their absence is a visible data gap.
  next.series = [
    ...next.series.filter((entry) => !incoming.series.some((series) => series.id === entry.id)),
    ...incoming.series,
  ];
  next.datasets = [...next.datasets.filter((dataset) => dataset.id !== id), incoming.dataset];
  next.results = next.results.map((result) => ({
    ...result,
    stale: result.stale || result.dataVersions[id] !== undefined,
  }));
  validateAnalytics(next);
  return next;
}

/** Archives retain actual immutable inputs; a hash alone cannot reproduce a historical run. */
export function archiveResult(
  model: AnalyticsExtension,
  content: AnalyticsResultContent,
  parameters: Record<string, unknown>,
  modelVersion: number,
  context: AnalysisContext = {},
): AnalyticsExtension {
  context.signal?.throwIfAborted();
  validateAnalytics(model);
  const next = structuredClone(model);
  const times = model.datasets
    .flatMap((dataset) => dataset.observations.map((observation) => observation.time))
    .sort();
  const now = context.now?.() ?? new Date().toISOString();
  const result: AnalyticsResult = {
    id: crypto.randomUUID(),
    engineVersion: model.engineVersion,
    dataVersions: Object.fromEntries(
      model.datasets.map((dataset) => [dataset.id, dataset.version]),
    ),
    modelVersion,
    createdAt: now,
    interval: { from: times[0] ?? now, to: times.at(-1) ?? now },
    parameters: structuredClone(parameters),
    inputSnapshot: structuredClone({
      datasets: model.datasets,
      series: model.series,
      rules: model.rules,
      indicators: model.indicators,
    }),
    stale: false,
    content: structuredClone(content),
  };
  next.results.push(result);
  const retained = retainAnalyticsResults(next);
  validateAnalytics(retained);
  context.signal?.throwIfAborted();
  return retained;
}
