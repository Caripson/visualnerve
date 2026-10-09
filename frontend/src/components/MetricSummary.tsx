import { useI18n } from '../i18n';
import type { GraphNode } from '../model/types';
import { getCsvNode } from '../data/csv';
import './csv-properties.css';

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export function formatCsvMeasure(
  value: number | null,
  format: (value: number, options: Intl.NumberFormatOptions) => string = (value) =>
    numberFormat.format(value),
): string {
  return value === null || !Number.isFinite(value)
    ? '—'
    : format(value, { maximumFractionDigits: 6 });
}

export function MetricSummary({ node }: { node: GraphNode }) {
  const { t, number } = useI18n();
  const data = getCsvNode(node);
  if (!data) return null;
  const hidden = new Set(data.hiddenMetricIds ?? []);
  const measures = data.measures.filter((measure) => !hidden.has(measure.id));
  if (!measures.length && !data.hiddenChildren) return null;
  return (
    <div className="csv-metric-block">
      {measures.length > 0 && (
        <dl className="csv-metric-summary" aria-label={t('data.metricSummary.region')}>
          {measures.map((measure) => (
            <div key={measure.id} data-csv-metric-id={measure.id}>
              <dt title={measure.label}>{measure.label}</dt>
              <dd>{formatCsvMeasure(measure.value, number)}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.hiddenChildren > 0 && (
        <p className="csv-group-overflow">
          {t('data.metricSummary.moreGroups', { count: number(data.hiddenChildren) })}
        </p>
      )}
    </div>
  );
}
