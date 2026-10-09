import {
  sqlResolutionLabel,
  sqlSourceKindLabel,
  sqlRelationshipKindLabel,
} from '../ui/editor-labels';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import type { GraphEdge, GraphNode } from '../model/types';
import {
  getSqlQueryRelationship,
  getSqlQueryResult,
  getSqlQuerySource,
  type SqlQueryClauses,
  type SqlQueryOutput,
  type SqlQueryReference,
} from '../sql/query-schema';
import './sql-query.css';

const snippet = (value: string, limit = 220) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const clauseLabels: [keyof SqlQueryClauses, string][] = [
  ['from', 'FROM'],
  ['where', 'WHERE'],
  ['groupBy', 'GROUP BY'],
  ['having', 'HAVING'],
  ['orderBy', 'ORDER BY'],
  ['limit', 'LIMIT'],
];

function QueryClauses({
  clauses,
  compact = false,
}: {
  clauses: SqlQueryClauses;
  compact?: boolean;
}) {
  const present = clauseLabels.filter(([key]) => clauses[key] && (!compact || key !== 'from'));
  if (!present.length) return null;
  return (
    <dl className={`sql-query-clauses ${compact ? 'sql-query-clauses-compact' : ''}`}>
      {present.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{compact ? snippet(clauses[key]!) : clauses[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

function References({ references }: { references: SqlQueryReference[] }) {
  const { t, plural } = useI18n();
  if (!references.length)
    return (
      <span className="muted">
        {t('editor.sql.query.literalOrExpressionWithoutAColumnReference')}
      </span>
    );
  return (
    <ul className="sql-query-reference-list">
      {references.slice(0, 30).map((reference, index) => (
        <li key={index}>
          <code>{[reference.sourceAlias, reference.column].filter(Boolean).join('.')}</code>
          {reference.resolution !== 'resolved' && (
            <span className="sql-query-warning">{sqlResolutionLabel(t, reference.resolution)}</span>
          )}
          {reference.correlated && (
            <span className="muted">{t('editor.sql.query.outerQuery')}</span>
          )}
        </li>
      ))}
      {references.length > 30 && (
        <li>
          {plural(
            'editor.sql.query.moreReferences.one',
            'editor.sql.query.moreReferences.other',
            references.length - 30,
          )}
        </li>
      )}
    </ul>
  );
}

function Outputs({ columns, compact = false }: { columns: SqlQueryOutput[]; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <table
      className="sql-query-outputs"
      aria-label={
        compact ? t('editor.sql.query.sqlQueryOutput') : t('editor.sql.query.allSqlQueryOutput')
      }
    >
      <thead>
        <tr>
          <th scope="col">{t('editor.nodes.typeLabel.output')}</th>
          <th scope="col">{t('editor.sql.query.expression')}</th>
          {!compact && <th scope="col">{t('editor.sql.query.columnSources')}</th>}
        </tr>
      </thead>
      <tbody>
        {columns.map((column) => (
          <tr key={column.ordinal}>
            <th scope="row">
              {column.name}
              {column.duplicateAlias && (
                <span className="sql-query-warning">{t('editor.sql.query.duplicateName')}</span>
              )}
            </th>
            <td>
              <code>{compact ? snippet(column.expression, 140) : column.expression}</code>
            </td>
            {!compact && (
              <td>
                <References references={column.references} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SqlQuerySummary({ node }: { node: GraphNode }) {
  const { t, plural } = useI18n();
  const source = getSqlQuerySource(node);
  const query = getSqlQueryResult(node);
  if (!source && !query) return null;
  return (
    <div className="sql-query-summary" data-testid="sql-query-summary">
      {source && (
        <>
          <p className="sql-query-badges">
            <span>{sqlSourceKindLabel(t, source.kind)}</span>
            <code>{source.alias}</code>
          </p>
          <p className="sql-query-table-name">
            {source.qualifiedName.join('.') || source.queryScope || source.scope}
          </p>
          {source.columns.length > 0 && (
            <ul
              className="sql-query-observed-columns"
              aria-label={t('editor.sql.query.referencedSqlColumns')}
            >
              {source.columns.slice(0, 12).map((column, index) => (
                <li key={index}>{column}</li>
              ))}
            </ul>
          )}
          {source.columns.length > 12 && (
            <p className="sql-query-overflow">
              {plural(
                'editor.sql.query.moreColumns.one',
                'editor.sql.query.moreColumns.other',
                source.columns.length - 12,
              )}
            </p>
          )}
          <p className="sql-query-overflow">
            {t('editor.sql.query.referencedColumnsSchemaTypesUnknown')}
          </p>
        </>
      )}
      {query && (
        <>
          <p className="sql-query-badges">
            <span>SELECT{query.distinct ? ' DISTINCT' : ''}</span>
            <span>
              {plural(
                'editor.sql.query.outputCount.one',
                'editor.sql.query.outputCount.other',
                query.columns.length,
              )}
            </span>
          </p>
          <Outputs columns={query.columns.slice(0, 12)} compact />
          {query.columns.length > 12 && (
            <p className="sql-query-overflow">
              {plural(
                'editor.sql.query.moreOutputs.one',
                'editor.sql.query.moreOutputs.other',
                query.columns.length - 12,
              )}
            </p>
          )}
          <QueryClauses clauses={query.clauses} compact />
        </>
      )}
    </div>
  );
}

export function SqlQueryDetails({ node }: { node: GraphNode }) {
  const { t } = useI18n();
  const source = getSqlQuerySource(node);
  const query = getSqlQueryResult(node);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const total = query?.columns.length ?? source?.columns.length ?? 0;
  const pages = Math.ceil(total / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  const first = current * pageSize;
  useEffect(() => setPage(0), [node.id, source, query]);
  if (!source && !query) return null;
  return (
    <section className="sql-query-details" aria-label={t('editor.sql.query.sqlQueryDetails')}>
      <h3 className="property-section">
        {source ? t('editor.sql.query.sqlQuerySource') : t('editor.sql.query.sqlQueryResult')}
      </h3>
      <p className="sql-query-notice">
        {t('editor.sql.query.queryStructureAndColumnReferencesTheSqlHasNotBeenExecuted')}
      </p>
      {source && (
        <>
          <dl className="sql-query-fields">
            <dt>{t('editor.sql.query.sourceKind')}</dt>
            <dd>{sqlSourceKindLabel(t, source.kind)}</dd>
            <dt>{t('editor.sql.query.alias')}</dt>
            <dd>
              <code>{source.alias}</code>
            </dd>
            <dt>{t('editor.sql.query.queryScope')}</dt>
            <dd>{source.scope}</dd>
            {source.qualifiedName.length > 0 && (
              <>
                <dt>{t('editor.sql.query.table')}</dt>
                <dd>{source.qualifiedName.join('.')}</dd>
              </>
            )}
            {source.queryScope && (
              <>
                <dt>{t('editor.sql.query.sourceQuery')}</dt>
                <dd>{source.queryScope}</dd>
              </>
            )}
          </dl>
          <p className="sql-query-notice">
            {t('editor.sql.query.onlyReferencedColumnsAreShownTypesKeysAndRowCountsRequireA')}
          </p>
          <ul
            className="sql-query-source-columns"
            aria-label={t('editor.sql.query.allReferencedSqlColumns')}
          >
            {source.columns.slice(first, first + pageSize).map((column, index) => (
              <li key={index}>
                <code>{column}</code>
              </li>
            ))}
          </ul>
          {!source.columns.length && (
            <p className="sql-query-notice">
              {t('editor.sql.query.noExplicitColumnReferencesInThisSource')}
            </p>
          )}
        </>
      )}
      {query && (
        <>
          <p className="sql-query-badges">
            <span>SELECT{query.distinct ? ' DISTINCT' : ''}</span>
            <span>{query.scope}</span>
          </p>
          {query.parentScope && (
            <p className="sql-query-notice">
              {t('editor.sql.query.nestedScope', { scopeName: query.parentScope })}
            </p>
          )}
          <div className="sql-query-output-scroll">
            <Outputs columns={query.columns.slice(first, first + pageSize)} />
          </div>
        </>
      )}
      {total > pageSize && (
        <nav
          className="sql-query-pagination"
          aria-label={t('editor.sql.query.sqlQueryColumnPages')}
        >
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            {t('editor.sql.table.previousColumns')}
          </button>
          <span aria-label={t('editor.sql.query.sqlQueryColumnRange')}>
            {t('editor.sql.table.columnRange', {
              firstColumn: first + 1,
              lastColumn: Math.min(first + pageSize, total),
              totalColumns: total,
            })}
          </span>
          <button
            type="button"
            disabled={current + 1 === pages}
            onClick={() => setPage(current + 1)}
          >
            {t('editor.sql.table.nextColumns')}
          </button>
        </nav>
      )}
      {query && <QueryClauses clauses={query.clauses} />}
    </section>
  );
}

export function SqlQueryRelationshipDetails({ edge }: { edge: GraphEdge }) {
  const { t } = useI18n();
  const relationship = getSqlQueryRelationship(edge);
  if (!relationship) return null;
  const label = t(
    relationship.kind === 'join'
      ? 'editor.sql.query.sqlJoin'
      : 'editor.sql.query.sqlQueryConnection',
  );
  return (
    <section className="sql-query-details" aria-label={label}>
      <h3 className="property-section">{label}</h3>
      <dl className="sql-query-fields">
        <dt>{t('editor.sql.query.kind')}</dt>
        <dd>{relationship.joinType || sqlRelationshipKindLabel(t, relationship.kind)}</dd>
        <dt>{t('editor.sql.query.queryScope')}</dt>
        <dd>{relationship.scope}</dd>
        {relationship.condition && (
          <>
            <dt>{t('editor.sql.query.condition')}</dt>
            <dd className="sql-query-condition">
              <code>{relationship.condition}</code>
            </dd>
          </>
        )}
        {!!relationship.references?.length && (
          <>
            <dt>{t('editor.sql.table.columnReferences')}</dt>
            <dd>
              <References references={relationship.references} />
            </dd>
          </>
        )}
        {!!relationship.outputOrdinals?.length && (
          <>
            <dt>{t('editor.sql.query.outputPositions')}</dt>
            <dd>{relationship.outputOrdinals.join(', ')}</dd>
          </>
        )}
      </dl>
      <p className="sql-query-notice">
        {t('editor.sql.query.thisConnectionDescribesTheSelectStatementItIsNotAForeignKey')}
      </p>
    </section>
  );
}
