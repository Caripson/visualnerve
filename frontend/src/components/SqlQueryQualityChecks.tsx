import type { Graph } from '../model/types';
import { getSqlQueryResult } from '../sql/query-schema';

export function SqlQueryQualityChecks({ graph }: { graph: Graph }) {
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
    <section aria-label="SQL query quality checks">
      <h3>SQL SELECT structure checks</h3>
      <p>
        {queries.length} query blocks · {columns.length} output columns · {duplicate.length}{' '}
        repeated output names · {unresolved} unresolved or ambiguous output references.
      </p>
      <p className="muted">
        These checks describe aliases and output references in the imported query. Database schemas,
        returned values and runtime correctness are not verified.
      </p>
      {issues.length > 0 && (
        <ul>
          {issues.slice(0, 50).map(({ query, column }) => (
            <li key={`${query.scope}:${column.ordinal}`}>
              {query.name}: {column.name}
              {column.duplicateAlias ? ' · repeated output name' : ''}
              {column.references
                .filter((reference) => reference.resolution !== 'resolved')
                .slice(0, 10)
                .map((reference, index) => (
                  <span key={index}>
                    {' '}
                    · {reference.sourceAlias ? `${reference.sourceAlias}.` : ''}
                    {reference.column}: {reference.resolution}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 50 && (
        <p>
          Showing 50 of {issues.length} output columns needing review. Select their result objects
          to inspect all references.
        </p>
      )}
    </section>
  );
}
