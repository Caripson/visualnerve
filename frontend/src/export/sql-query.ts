import {
  type SqlQueryReference,
  type SqlQueryRelationship,
  type SqlQueryResult,
  type SqlQuerySource,
} from '../sql/query-schema';

// Share the explicit query contract, never arbitrary properties supplied by an import.
const reference = (value: SqlQueryReference) => ({
  scope: value.scope,
  sourceAlias: value.sourceAlias,
  column: value.column,
  resolution: value.resolution,
  correlated: value.correlated,
});
export const sqlQuerySourceSummary = (source?: SqlQuerySource) =>
  source && {
    scope: source.scope,
    alias: source.alias,
    kind: source.kind,
    qualifiedName: source.qualifiedName,
    observedColumns: source.columns,
    queryScope: source.queryScope,
  };
export const sqlQueryResultSummary = (result?: SqlQueryResult) =>
  result && {
    scope: result.scope,
    parentScope: result.parentScope,
    name: result.name,
    distinct: result.distinct,
    columns: result.columns.map((column) => ({
      ordinal: column.ordinal,
      name: column.name,
      alias: column.alias,
      expression: column.expression,
      references: column.references.map(reference),
      duplicateAlias: column.duplicateAlias,
    })),
    clauses: {
      from: result.clauses.from,
      where: result.clauses.where,
      groupBy: result.clauses.groupBy,
      having: result.clauses.having,
      orderBy: result.clauses.orderBy,
      limit: result.clauses.limit,
    },
  };
export const sqlQueryRelationshipSummary = (relationship?: SqlQueryRelationship) =>
  relationship && {
    scope: relationship.scope,
    kind: relationship.kind,
    joinType: relationship.joinType,
    condition: relationship.condition,
    references: relationship.references?.map(reference),
    outputOrdinals: relationship.outputOrdinals,
  };
