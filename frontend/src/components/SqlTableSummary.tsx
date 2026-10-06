import { useEffect, useState } from 'react';
import type { GraphEdge, GraphNode } from '../model/types';
import { getSqlRelationship, getSqlTable, type SqlColumn } from '../sql/schema';
import './sql-table.css';

function ColumnRules({ column, compact = false }: { column: SqlColumn; compact?: boolean }) {
  const rules = [
    ...(column.primaryKey ? [{ short: 'PK', label: 'Primary key' }] : []),
    ...(column.foreignKey ? [{ short: 'FK', label: 'Foreign key' }] : []),
    ...(column.unique ? [{ short: 'UQ', label: 'Unique' }] : []),
    { short: column.nullable ? '?' : 'NN', label: column.nullable ? 'Nullable' : 'Not null' },
  ];
  return (
    <span className="sql-column-rules">
      {rules.map((rule) => (
        <span key={rule.short} className="sql-column-rule" title={rule.label}>
          {compact ? <abbr title={rule.label}>{rule.short}</abbr> : rule.label}
        </span>
      ))}
    </span>
  );
}

function Columns({ columns, compact = false }: { columns: SqlColumn[]; compact?: boolean }) {
  return (
    <table className="sql-columns" aria-label={compact ? 'SQL table columns' : 'All SQL columns'}>
      <thead>
        <tr>
          <th scope="col">Column</th>
          <th scope="col">Type</th>
          <th scope="col">Rules</th>
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
  const table = getSqlTable(node);
  if (!table) return null;
  if (table.external)
    return (
      <div className="sql-table-summary sql-external-table" data-testid="sql-table-summary">
        External table · definition missing
      </div>
    );
  return (
    <div className="sql-table-summary" data-testid="sql-table-summary">
      <Columns columns={table.columns.slice(0, 12)} compact />
      {table.columns.length > 12 && (
        <p className="sql-columns-overflow">+{table.columns.length - 12} more columns</p>
      )}
      <p className="sql-column-legend">
        PK primary · FK foreign · UQ unique · ? nullable · NN not null
      </p>
    </div>
  );
}

export function SqlTableDetails({ node }: { node: GraphNode }) {
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
    <section className="sql-table-details" aria-label="SQL table schema">
      <h3 className="property-section">SQL table schema</h3>
      <p className="sql-qualified-name">{table.qualifiedName.join('.')}</p>
      {table.external ? (
        <p className="sql-schema-notice">
          External table · definition missing. Its columns and keys were not supplied in this
          schema.
        </p>
      ) : (
        <>
          <div className="sql-columns-scroll">
            <Columns columns={columns} />
          </div>
          {table.columns.length > pageSize && (
            <nav className="sql-schema-pagination" aria-label="SQL column pages">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous columns
              </button>
              <span aria-label="SQL column range">
                Columns {first + 1}–{first + columns.length} of {table.columns.length}
              </span>
              <button
                type="button"
                disabled={currentPage + 1 === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next columns
              </button>
            </nav>
          )}
          <dl className="sql-schema-keys">
            <dt>Primary key</dt>
            <dd>
              {table.primaryKey.length ? `(${table.primaryKey.join(', ')})` : 'None declared'}
            </dd>
            <dt>Unique keys</dt>
            <dd>
              {table.uniqueKeys.length ? (
                <ul>
                  {table.uniqueKeys.map((key, index) => (
                    <li key={index}>({key.join(', ')})</li>
                  ))}
                </ul>
              ) : (
                'None declared'
              )}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}

export function SqlRelationshipDetails({ edge }: { edge: GraphEdge }) {
  const relationship = getSqlRelationship(edge);
  if (!relationship) return null;
  return (
    <section className="sql-table-details" aria-label="SQL foreign key">
      <h3 className="property-section">SQL foreign key</h3>
      <p className="sql-schema-notice">
        The stored reference runs from the child table (source) to the parent table (target). It is
        a data relationship, not an execution step.
      </p>
      {relationship.unresolved && (
        <p className="sql-schema-notice">
          Referenced columns unknown. The external table definition and its primary key were not
          supplied.
        </p>
      )}
      <dl className="sql-schema-keys">
        {relationship.name && (
          <>
            <dt>Constraint</dt>
            <dd>{relationship.name}</dd>
          </>
        )}
        <dt>Column references</dt>
        <dd>
          <ul>
            {relationship.columns.map((column, index) => (
              <li key={index}>
                {column} →{' '}
                {relationship.unresolved
                  ? 'Unknown referenced column'
                  : relationship.referencedColumns[index]}
              </li>
            ))}
          </ul>
        </dd>
        <dt>On delete</dt>
        <dd>{relationship.onDelete || 'Not specified'}</dd>
        <dt>On update</dt>
        <dd>{relationship.onUpdate || 'Not specified'}</dd>
      </dl>
    </section>
  );
}
