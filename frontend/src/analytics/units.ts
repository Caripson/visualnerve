import type { AnalyticsUnit, AnalyticsSeries, IndicatorKind } from './types';

export function indicatorUnit(series: AnalyticsSeries, kind: IndicatorKind): AnalyticsUnit {
  if (kind === 'roc') return { kind: 'ratio', label: 'relative change' };
  if (kind === 'rsi') return { kind: 'number', label: 'RSI points' };
  return { ...series.unit };
}

/** Currency codes and named count/custom units remain separate; ratios share fractional scale. */
export function unitsCompatible(a: AnalyticsUnit, b: AnalyticsUnit) {
  return (
    a.kind === b.kind &&
    (a.kind === 'currency'
      ? a.currency === b.currency
      : a.kind === 'count' || a.kind === 'number'
        ? a.label === b.label
        : true)
  );
}
