import { sqlColumnRuleLabel } from '../ui/editor-labels';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import type { GraphEdge, GraphNode } from '../model/types';
import { getSqlRelationship, getSqlTable, type SqlColumn } from '../sql/schema';
import './sql-table.css';

function ColumnRules({ column, compact = false }: { column: SqlColumn; compact?: boolean }) {
  const { t } = useI18n();
  const rules = [
    ...(column.primaryKey ? [{ short: 'PK', label: 'Primary key' }] : []),
    ...(column.foreignKey ? [{ short: 'FK', label: 'Foreign key' }] : []),
    ...(column.unique ? [{ short: 'UQ', label: 'Unique' }] : []),
    { short: column.nullable ? '?' : 'NN', label: column.nullable ? 'Nullable' : 'Not null' },
  ];
  return (
    <span className="sql-column-rules">
      {rules.map((rule) => (
        <span
          key={rule.short}
          className="sql-column-rule"
          title={sqlColumnRuleLabel(t, rule.label)}
        >
          {compact ? (
            <abbr title={sqlColumnRuleLabel(t, rule.label)}>{rule.short}</abbr>
          ) : (
            sqlColumnRuleLabel(t, rule.label)
          )}
        </span>
      ))}
    </span>
  );
}

function Columns({ columns, compact = false }: { columns: SqlColumn[]; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <table
      className="sql-columns"
      aria-label={
        compact ? t('editor.sql.table.sqlTableColumns') : t('editor.sql.table.allSqlColumns')
      }
    >
      <thead>
        <tr>
          <th scope="col">{t('editor.sql.table.column')}</th>
          <th scope="col">{t('editor.properties.type')}</th>
          <th scope="col">{t('editor.sql.table.rules')}</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((column, index) => (
          <tr key={`${index}:${column.name}`}>
            <th scope="row" title={column.name}>
              {column.name}
            </th>
            <td title={column.dataType}>{column.dataType}</td>
            <td>
              <ColumnRules column={column} compact={compact} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SqlTableSummary({ node }: { node: GraphNode }) {
  const { t, plural } = useI18n();
  const table = getSqlTable(node);
  if (!table) return null;
  if (table.external)
    return (
      <div className="sql-table-summary sql-external-table" data-testid="sql-table-summary">
        {t('editor.sql.table.externalTableDefinitionMissing')}
      </div>
    );
  return (
    <div className="sql-table-summary" data-testid="sql-table-summary">
      <Columns columns={table.columns.slice(0, 12)} compact />
      {table.columns.length > 12 && (
        <p className="sql-columns-overflow">
          {plural(
            'editor.sql.table.moreColumns.one',
            'editor.sql.table.moreColumns.other',
            table.columns.length - 12,
          )}
        </p>
      )}
      <p className="sql-column-legend">
        {t('editor.sql.table.pkPrimaryFkForeignUqUniqueNullableNnNotNull')}
      </p>
    </div>
  );
}

export function SqlTableDetails({ node }: { node: GraphNode }) {
  const { t } = useI18n();
  const table = getSqlTable(node);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const pageCount = Math.ceil((table?.columns.length ?? 0) / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  useEffect(() => setPage(0), [node.id, table]);
  if (!table) return null;
  const first = currentPage * pageSize;
  const columns = table.columns.slice(first, first + pageSize);
  return (
    <section className="sql-table-details" aria-label={t('editor.sql.table.sqlTableSchema')}>
      <h3 className="property-section">{t('editor.sql.table.sqlTableSchema')}</h3>
      <p className="sql-qualified-name">{table.qualifiedName.join('.')}</p>
      {table.external ? (
        <p className="sql-schema-notice">
          {t('editor.sql.table.externalTableDefinitionMissingItsColumnsAndKeysWereNotSuppliedIn')}
        </p>
      ) : (
        <>
          <div className="sql-columns-scroll">
            <Columns columns={columns} />
          </div>
          {table.columns.length > pageSize && (
            <nav
              className="sql-schema-pagination"
              aria-label={t('editor.sql.table.sqlColumnPages')}
            >
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t('editor.sql.table.previousColumns')}
              </button>
              <span aria-label={t('editor.sql.table.sqlColumnRange')}>
                {t('editor.sql.table.columnRange', {
                  firstColumn: first + 1,
                  lastColumn: first + columns.length,
                  totalColumns: table.columns.length,
                })}
              </span>
              <button
                type="button"
                disabled={currentPage + 1 === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                {t('editor.sql.table.nextColumns')}
              </button>
            </nav>
          )}
          <dl className="sql-schema-keys">
            <dt>{t('editor.sql.table.primaryKey')}</dt>
            <dd>
              {table.primaryKey.length
                ? `(${table.primaryKey.join(', ')})`
                : t('editor.sql.table.noneDeclared')}
            </dd>
            <dt>{t('editor.sql.table.uniqueKeys')}</dt>
            <dd>
              {table.uniqueKeys.length ? (
                <ul>
                  {table.uniqueKeys.map((key, index) => (
                    <li key={index}>({key.join(', ')})</li>
                  ))}
                </ul>
              ) : (
                t('editor.sql.table.noneDeclared')
              )}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}

export function SqlRelationshipDetails({ edge }: { edge: GraphEdge }) {
  const { t } = useI18n();
  const relationship = getSqlRelationship(edge);
  if (!relationship) return null;
  return (
    <section className="sql-table-details" aria-label={t('editor.sql.table.sqlForeignKey')}>
      <h3 className="property-section">{t('editor.sql.table.sqlForeignKey')}</h3>
      <p className="sql-schema-notice">
        {t('editor.sql.table.theStoredReferenceRunsFromTheChildTableSourceToTheParent')}
      </p>
      {relationship.unresolved && (
        <p className="sql-schema-notice">
          {t(
            'editor.sql.table.referencedColumnsUnknownTheExternalTableDefinitionAndItsPrimaryKeyWere',
          )}
        </p>
      )}
      <dl className="sql-schema-keys">
        {relationship.name && (
          <>
            <dt>{t('editor.sql.table.constraint')}</dt>
            <dd>{relationship.name}</dd>
          </>
        )}
        <dt>{t('editor.sql.table.columnReferences')}</dt>
        <dd>
          <ul>
            {relationship.columns.map((column, index) => (
              <li key={index}>
                {column} →{' '}
                {relationship.unresolved
                  ? t('editor.sql.table.unknownReferencedColumn')
                  : relationship.referencedColumns[index]}
              </li>
            ))}
          </ul>
        </dd>
        <dt>{t('editor.sql.table.onDelete')}</dt>
        <dd>{relationship.onDelete || t('editor.sql.table.notSpecified')}</dd>
        <dt>{t('editor.sql.table.onUpdate')}</dt>
        <dd>{relationship.onUpdate || t('editor.sql.table.notSpecified')}</dd>
      </dl>
    </section>
  );
}
