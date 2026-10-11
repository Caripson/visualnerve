import type { AnalyticsMeasurement, AnalyticsSeries } from '../types';
import { valueLabel } from './display';

/** Normalizing a chart never changes the original units of a measurement result. */
export function measurementMetricLabel(
  name: string,
  value: number | null,
  definition: AnalyticsMeasurement,
  sourceSeries: AnalyticsSeries[],
): string {
  if (value === null) return 'Not applicable';
  const primary = sourceSeries.find((series) => series.id === definition.seriesIds[0]);
  const source =
    name === 'secondMean' && definition.kind === 'compare-series'
      ? sourceSeries.find((series) => series.id === definition.seriesIds[1])
      : primary;
  const unit =
    source?.unit.kind === 'currency'
      ? source.unit.currency
      : source?.unit.kind === 'ratio'
        ? 'ratio'
        : source?.unit.label;
  const key = name.split('.').at(-1)!;
  if (key === 'percentagePoints') return `${valueLabel(value)} pp`;
  if (['relativeChange', 'firstChange', 'secondChange'].includes(key) || /coverage/i.test(key))
    return valueLabel(value, 'ratio');
  if (key === 'slopePerDay')
    return `${valueLabel(value)} ${source?.unit.kind === 'ratio' ? 'ratio units' : (unit ?? 'units')} / day`;
  if (key === 'elapsedSeconds') return valueLabel(value, 'seconds');
  if (['elapsedDays', 'firstElapsedDays', 'secondElapsedDays'].includes(key))
    return valueLabel(value, 'days');
  if (
    [
      'start',
      'end',
      'mean',
      'median',
      'min',
      'max',
      'intercept',
      'standardDeviation',
      'sum',
      'firstMean',
      'secondMean',
    ].includes(key)
  )
    return valueLabel(value, unit);
  return valueLabel(value);
}
