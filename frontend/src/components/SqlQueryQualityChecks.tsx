import { sqlResolutionLabel } from '../ui/editor-labels';
import { useI18n } from '../i18n';
import type { Graph } from '../model/types';
import { getSqlQueryResult } from '../sql/query-schema';

export function SqlQueryQualityChecks({ graph }: { graph: Graph }) {
  const { t } = useI18n();
  const queries = graph.nodes.flatMap((node) => {
    const query = getSqlQueryResult(node);
    return query ? [query] : [];
  });
  if (!queries.length) return null;
  const columns = queries.flatMap((query) => query.columns.map((column) => ({ query, column })));
  const duplicate = columns.filter(({ column }) => column.duplicateAlias);
  const unresolved = columns.reduce(
    (count, { column }) =>
      count + column.references.filter((reference) => reference.resolution !== 'resolved').length,
    0,
  );
  const issues = columns.filter(
    ({ column }) =>
      column.duplicateAlias ||
      column.references.some((reference) => reference.resolution !== 'resolved'),
  );
  return (
    <section aria-label={t('data.sqlQuality.region')}>
      <h3>{t('data.sqlQuality.title')}</h3>
      <p>
        {t('data.sqlQuality.counts', {
          queries: queries.length,
          columns: columns.length,
          repeated: duplicate.length,
          unresolved: unresolved,
        })}
      </p>
      <p className="muted">{t('data.sqlQuality.noRuntimeVerification')}</p>
      {issues.length > 0 && (
        <ul>
          {issues.slice(0, 50).map(({ query, column }) => (
            <li key={`${query.scope}:${column.ordinal}`}>
              {query.name}: {column.name}
              {column.duplicateAlias ? t('data.sqlQuality.repeatedSuffix') : ''}
              {column.references
                .filter((reference) => reference.resolution !== 'resolved')
                .slice(0, 10)
                .map((reference, index) => (
                  <span key={index}>
                    {' '}
                    · {reference.sourceAlias ? `${reference.sourceAlias}.` : ''}
                    {reference.column}: {sqlResolutionLabel(t, reference.resolution)}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 50 && <p>{t('data.sqlQuality.shownColumns', { total: issues.length })}</p>}
    </section>
  );
}
