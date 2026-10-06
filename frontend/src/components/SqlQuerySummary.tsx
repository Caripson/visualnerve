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
const sourceKind = { table: 'Table source', derived: 'Derived query', cte: 'CTE source' };

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
  if (!references.length)
    return <span className="muted">Literal or expression without a column reference</span>;
  return (
    <ul className="sql-query-reference-list">
      {references.slice(0, 30).map((reference, index) => (
        <li key={index}>
          <code>{[reference.sourceAlias, reference.column].filter(Boolean).join('.')}</code>
          {reference.resolution !== 'resolved' && (
            <span className="sql-query-warning"> {reference.resolution}</span>
          )}
          {reference.correlated && <span className="muted"> · outer query</span>}
        </li>
      ))}
      {references.length > 30 && (
        <li>+{references.length - 30} more references in this expression</li>
      )}
    </ul>
  );
}

function Outputs({ columns, compact = false }: { columns: SqlQueryOutput[]; compact?: boolean }) {
  return (
    <table
      className="sql-query-outputs"
      aria-label={compact ? 'SQL query output' : 'All SQL query output'}
    >
      <thead>
        <tr>
          <th scope="col">Output</th>
          <th scope="col">Expression</th>
          {!compact && <th scope="col">Column sources</th>}
        </tr>
      </thead>
      <tbody>
        {columns.map((column) => (
          <tr key={column.ordinal}>
            <th scope="row">
              {column.name}
              {column.duplicateAlias && (
                <span className="sql-query-warning"> · duplicate name</span>
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
  const source = getSqlQuerySource(node);
  const query = getSqlQueryResult(node);
  if (!source && !query) return null;
  return (
    <div className="sql-query-summary" data-testid="sql-query-summary">
      {source && (
        <>
          <p className="sql-query-badges">
            <span>{sourceKind[source.kind]}</span>
            <code>{source.alias}</code>
          </p>
          <p className="sql-query-table-name">
            {source.qualifiedName.join('.') || source.queryScope || source.scope}
          </p>
          {source.columns.length > 0 && (
            <ul className="sql-query-observed-columns" aria-label="Referenced SQL columns">
              {source.columns.slice(0, 12).map((column, index) => (
                <li key={index}>{column}</li>
              ))}
            </ul>
          )}
          {source.columns.length > 12 && (
            <p className="sql-query-overflow">
              +{source.columns.length - 12} more referenced columns
            </p>
          )}
          <p className="sql-query-overflow">Referenced columns · schema types unknown</p>
        </>
      )}
      {query && (
        <>
          <p className="sql-query-badges">
            <span>SELECT{query.distinct ? ' DISTINCT' : ''}</span>
            <span>{query.columns.length} outputs</span>
          </p>
          <Outputs columns={query.columns.slice(0, 12)} compact />
          {query.columns.length > 12 && (
            <p className="sql-query-overflow">
              +{query.columns.length - 12} more outputs · inspect Properties
            </p>
          )}
          <QueryClauses clauses={query.clauses} compact />
        </>
      )}
    </div>
  );
}

export function SqlQueryDetails({ node }: { node: GraphNode }) {
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
    <section className="sql-query-details" aria-label="SQL query details">
      <h3 className="property-section">{source ? 'SQL query source' : 'SQL query result'}</h3>
      <p className="sql-query-notice">
        Query structure and column references. The SQL has not been executed.
      </p>
      {source && (
        <>
          <dl className="sql-query-fields">
            <dt>Source kind</dt>
            <dd>{sourceKind[source.kind]}</dd>
            <dt>Alias</dt>
            <dd>
              <code>{source.alias}</code>
            </dd>
            <dt>Query scope</dt>
            <dd>{source.scope}</dd>
            {source.qualifiedName.length > 0 && (
              <>
                <dt>Table</dt>
                <dd>{source.qualifiedName.join('.')}</dd>
              </>
            )}
            {source.queryScope && (
              <>
                <dt>Source query</dt>
                <dd>{source.queryScope}</dd>
              </>
            )}
          </dl>
          <p className="sql-query-notice">
            Only referenced columns are shown. Types, keys and row counts require a database schema
            or query execution.
          </p>
          <ul className="sql-query-source-columns" aria-label="All referenced SQL columns">
            {source.columns.slice(first, first + pageSize).map((column, index) => (
              <li key={index}>
                <code>{column}</code>
              </li>
            ))}
          </ul>
          {!source.columns.length && (
            <p className="sql-query-notice">No explicit column references in this source.</p>
          )}
        </>
      )}
      {query && (
        <>
          <p className="sql-query-badges">
            <span>SELECT{query.distinct ? ' DISTINCT' : ''}</span>
            <span>{query.scope}</span>
          </p>
          {query.parentScope && <p className="sql-query-notice">Nested in {query.parentScope}</p>}
          <div className="sql-query-output-scroll">
            <Outputs columns={query.columns.slice(first, first + pageSize)} />
          </div>
        </>
      )}
      {total > pageSize && (
        <nav className="sql-query-pagination" aria-label="SQL query column pages">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous columns
          </button>
          <span aria-label="SQL query column range">
            Columns {first + 1}–{Math.min(first + pageSize, total)} of {total}
          </span>
          <button
            type="button"
            disabled={current + 1 === pages}
            onClick={() => setPage(current + 1)}
          >
            Next columns
          </button>
        </nav>
      )}
      {query && <QueryClauses clauses={query.clauses} />}
    </section>
  );
}

export function SqlQueryRelationshipDetails({ edge }: { edge: GraphEdge }) {
  const relationship = getSqlQueryRelationship(edge);
  if (!relationship) return null;
  const label = relationship.kind === 'join' ? 'SQL join' : 'SQL query connection';
  return (
    <section className="sql-query-details" aria-label={label}>
      <h3 className="property-section">{label}</h3>
      <dl className="sql-query-fields">
        <dt>Kind</dt>
        <dd>{relationship.joinType || relationship.kind}</dd>
        <dt>Query scope</dt>
        <dd>{relationship.scope}</dd>
        {relationship.condition && (
          <>
            <dt>Condition</dt>
            <dd className="sql-query-condition">
              <code>{relationship.condition}</code>
            </dd>
          </>
        )}
        {!!relationship.references?.length && (
          <>
            <dt>Column references</dt>
            <dd>
              <References references={relationship.references} />
            </dd>
          </>
        )}
        {!!relationship.outputOrdinals?.length && (
          <>
            <dt>Output positions</dt>
            <dd>{relationship.outputOrdinals.join(', ')}</dd>
          </>
        )}
      </dl>
      <p className="sql-query-notice">
        This connection describes the SELECT statement. It is not a foreign key or database
        execution plan.
      </p>
    </section>
  );
}
