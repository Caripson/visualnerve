import type { AnalyticsExtension, AnalyticsResult } from './types';
import { AnalyticsError, validateAnalytics } from './validation';

/** Ordered arrays and unordered JSON object keys, without allocating complete data strings. */
export function analyticsDefinitionsEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++)
      if (!analyticsDefinitionsEqual(left[index], right[index])) return false;
    return true;
  }
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys)
    if (
      !Object.hasOwn(right, key) ||
      !analyticsDefinitionsEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      )
    )
      return false;
  return true;
}
function withoutVersion(value: { version?: number }) {
  const { version, ...content } = value;
  return content;
}

export function sourceDefinitionChanged(
  result: AnalyticsResult,
  previous: AnalyticsExtension,
  next: AnalyticsExtension,
): boolean {
  for (const [parameter, collection] of [
    ['measurement', 'measurements'],
    ['indicator', 'indicators'],
    ['config', 'backtests'],
    ['scenario', 'scenarios'],
  ] as const) {
    const captured = result.parameters[parameter] as { id?: string; resultId?: string } | undefined;
    if (!captured || typeof captured !== 'object' || typeof captured.id !== 'string') continue;
    const before = previous[collection].find((definition) => definition.id === captured.id);
    const current = next[collection].find((definition) => definition.id === captured.id);
    // A preview may use an unsaved definition. Only track a canonical definition
    // when the retained parameters actually match it; result links are not inputs.
    const calculation = (definition: object) => {
      const { resultId: omitted, ...inputs } = definition as { resultId?: string };
      return inputs;
    };
    if (
      before &&
      analyticsDefinitionsEqual(calculation(before), calculation(captured)) &&
      (!current || !analyticsDefinitionsEqual(calculation(current), calculation(captured)))
    )
      return true;
  }
  return false;
}

/** Semantic source changes advance versions and keep original archive input intact. */
export function reconcileAnalytics(
  previous: AnalyticsExtension,
  value: AnalyticsExtension,
): AnalyticsExtension {
  validateAnalytics(value);
  const next = structuredClone(value);
  const changedSeries = new Set(
    next.series
      .filter((series) => {
        const before = previous.series.find((entry) => entry.id === series.id);
        return before && !analyticsDefinitionsEqual(withoutVersion(before), withoutVersion(series));
      })
      .map((series) => series.id),
  );
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const series of next.series)
      if (
        !changedSeries.has(series.id) &&
        previous.series.some((entry) => entry.id === series.id) &&
        series.derived?.seriesIds.some((id) => changedSeries.has(id))
      ) {
        changedSeries.add(series.id);
        propagated = true;
      }
  }
  for (const series of next.series) {
    const before = previous.series.find((entry) => entry.id === series.id);
    const requested = series.version ?? 1;
    if (!before) {
      if (requested !== 1)
        throw new AnalyticsError(
          'INVALID_ANALYTICS',
          'New semantic series must start at version 1.',
          `series.${series.id}.version`,
        );
      continue;
    }
    const current = before.version ?? 1;
    if (changedSeries.has(series.id)) {
      if (requested !== current && requested !== current + 1)
        throw new AnalyticsError(
          'INVALID_ANALYTICS',
          'A changed series must retain its current version or advance it by exactly one.',
          `series.${series.id}.version`,
        );
      series.version = current + 1;
    } else if (requested !== current)
      throw new AnalyticsError(
        'INVALID_ANALYTICS',
        'An unchanged series cannot change its version.',
        `series.${series.id}.version`,
      );
  }
  const changedIndicators = new Set(
    next.indicators
      .filter((indicator) => {
        const before = previous.indicators.find((entry) => entry.id === indicator.id);
        return before && !analyticsDefinitionsEqual(before, indicator);
      })
      .map((indicator) => indicator.id),
  );
  const ruleInputsChanged = (rule: AnalyticsExtension['rules'][number]) => {
    const seriesIds = new Set(
      [rule.seriesId, rule.secondSeriesId].filter((id): id is string => !!id),
    );
    const indicatorIds = new Set<string>();
    const collect = (expression: unknown) => {
      if (Array.isArray(expression)) expression.forEach(collect);
      else if (expression && typeof expression === 'object')
        for (const [key, value] of Object.entries(expression)) {
          if (key === 'seriesId' && typeof value === 'string') seriesIds.add(value);
          else if (key === 'indicatorId' && typeof value === 'string') indicatorIds.add(value);
          else if (value && typeof value === 'object') collect(value);
        }
    };
    collect(rule.expression);
    for (const id of indicatorIds) {
      if (changedIndicators.has(id)) return true;
      const indicator = next.indicators.find((entry) => entry.id === id);
      if (indicator) seriesIds.add(indicator.seriesId);
    }
    return [...seriesIds].some((id) => changedSeries.has(id));
  };
  for (const collection of ['datasets', 'rules', 'scenarios'] as const) {
    for (const entity of next[collection]) {
      const before = previous[collection].find((old) => old.id === entity.id);
      if (!before) {
        if (entity.version !== 1)
          throw new AnalyticsError(
            'INVALID_ANALYTICS',
            'New datasets, rules and scenarios must start at version 1.',
            `${collection}.${entity.id}.version`,
          );
        continue;
      }
      const differs =
        !analyticsDefinitionsEqual(withoutVersion(before), withoutVersion(entity)) ||
        (collection === 'rules' &&
          ruleInputsChanged(entity as AnalyticsExtension['rules'][number]));
      if (differs) {
        if (entity.version !== before.version && entity.version !== before.version + 1)
          throw new AnalyticsError(
            'INVALID_ANALYTICS',
            'A changed definition must retain its current version or advance it by exactly one.',
            `${collection}.${entity.id}.version`,
          );
        entity.version = before.version + 1;
      } else if (entity.version !== before.version) {
        throw new AnalyticsError(
          'INVALID_ANALYTICS',
          'An unchanged definition cannot change its version.',
          `${collection}.${entity.id}.version`,
        );
      }
    }
  }
  const definitionsChanged =
    !analyticsDefinitionsEqual(previous.series, next.series) ||
    !analyticsDefinitionsEqual(previous.indicators, next.indicators);
  for (const result of next.results) {
    const before = previous.results.find((old) => old.id === result.id);
    if (before) {
      const { stale: oldStale, ...oldContent } = before;
      const { stale: newStale, ...newContent } = result;
      if (!analyticsDefinitionsEqual(oldContent, newContent) || (oldStale && !newStale))
        throw new AnalyticsError(
          'INVALID_ANALYTICS',
          'A saved result and its retained original input are immutable. Recalculate into a new archive.',
          `results.${result.id}`,
        );
    }
    if (
      definitionsChanged ||
      !analyticsDefinitionsEqual(result.inputSnapshot.series, next.series) ||
      !analyticsDefinitionsEqual(result.inputSnapshot.indicators, next.indicators) ||
      sourceDefinitionChanged(result, previous, next) ||
      Object.entries(result.dataVersions).some(
        ([id, version]) => next.datasets.find((dataset) => dataset.id === id)?.version !== version,
      ) ||
      result.inputSnapshot.rules.some(
        (rule) => next.rules.find((current) => current.id === rule.id)?.version !== rule.version,
      )
    )
      result.stale = true;
  }
  validateAnalytics(next);
  return next;
}
