import type { AnalyticsExtension, AnalyticsResult } from './types';
import { analyticsLimits } from './types';
import { requireAnalysis, strictKeys } from './validation';

/** Complete input-version sets, independent of the order of dataset properties. */
export function analyticsDataVersionKey(result: Pick<AnalyticsResult, 'dataVersions'>): string {
  return JSON.stringify(Object.entries(result.dataVersions).sort(([a], [b]) => a.localeCompare(b)));
}

/** Pure candidate preparation; callers review evictions before the ordinary versioned save. */
export function retainAnalyticsResults(
  model: AnalyticsExtension,
  retention: AnalyticsExtension['retention'] = model.retention,
): AnalyticsExtension {
  strictKeys(retention, ['results', 'dataVersions'], 'retention');
  for (const [key, maximum] of [
    ['results', analyticsLimits.results],
    ['dataVersions', analyticsLimits.versions],
  ] as const)
    requireAnalysis(
      Number.isInteger(retention[key]) && retention[key] >= 1 && retention[key] <= maximum,
      `Retention ${key} must be a whole number from 1 to ${maximum}.`,
      `retention.${key}`,
    );

  // Archive insertion order is canonical: the last entry is the newest saved run.
  const candidates = model.results.slice(-retention.results);
  const versions = new Set(
    [...new Set(candidates.map(analyticsDataVersionKey).reverse())].slice(
      0,
      retention.dataVersions,
    ),
  );
  const results = candidates.filter((result) => versions.has(analyticsDataVersionKey(result)));
  const retainedIds = new Set(results.map((result) => result.id));
  const measurements = model.measurements.map((measurement) => {
    if (!measurement.resultId || retainedIds.has(measurement.resultId)) return measurement;
    const { resultId: _expired, ...definition } = measurement;
    return definition;
  });
  return { ...model, retention: { ...retention }, results, measurements };
}
