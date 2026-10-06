import type { Graph, GraphEdge, GraphNode } from '../model/types';

export const sqlQueryLimits = {
  blocks: 100,
  depth: 16,
  sources: 2000,
  outputs: 10_000,
  references: 100_000,
  relationships: 10_000,
  expressionLength: 100_000,
} as const;

/** Logical scope/alias references deliberately contain no editor node IDs. */
export interface SqlQueryReference {
  scope?: string;
  sourceAlias?: string;
  column: string;
  resolution: 'resolved' | 'unresolved' | 'ambiguous';
  correlated?: boolean;
}
export interface SqlQueryOutput {
  ordinal: number;
  name: string;
  alias?: string;
  expression: string;
  references: SqlQueryReference[];
  duplicateAlias?: boolean;
}
export interface SqlQueryClauses {
  from?: string;
  where?: string;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: string;
}
export interface SqlQuerySource {
  version: 1;
  scope: string;
  alias: string;
  kind: 'table' | 'derived' | 'cte';
  qualifiedName: string[];
  /** Observed references only; this is not a database schema. */
  columns: string[];
  queryScope?: string;
}
export interface SqlQueryResult {
  version: 1;
  scope: string;
  parentScope?: string;
  name: string;
  distinct: boolean;
  columns: SqlQueryOutput[];
  clauses: SqlQueryClauses;
}
export interface SqlQueryRelationship {
  version: 1;
  scope: string;
  kind: 'join' | 'input' | 'lineage' | 'subquery';
  joinType?: string;
  condition?: string;
  references?: SqlQueryReference[];
  outputOrdinals?: number[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const text = (value: unknown, max = 1000): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalText = (value: unknown, max = 1000) => value === undefined || text(value, max);
const strings = (value: unknown, max: number, allowEmpty = true): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  (allowEmpty || value.length > 0) &&
  value.every((entry) => text(entry));
function reference(value: unknown): value is SqlQueryReference {
  return (
    object(value) &&
    keys(value, ['scope', 'sourceAlias', 'column', 'resolution', 'correlated']) &&
    text(value.column) &&
    optionalText(value.scope, 100) &&
    optionalText(value.sourceAlias) &&
    typeof value.resolution === 'string' &&
    ['resolved', 'unresolved', 'ambiguous'].includes(value.resolution) &&
    (value.correlated === undefined || typeof value.correlated === 'boolean') &&
    (value.resolution !== 'resolved' || (text(value.scope, 100) && text(value.sourceAlias)))
  );
}
function references(value: unknown): value is SqlQueryReference[] {
  return (
    Array.isArray(value) && value.length <= sqlQueryLimits.references && value.every(reference)
  );
}
export function isSqlQuerySource(value: unknown): value is SqlQuerySource {
  return (
    object(value) &&
    keys(value, ['version', 'scope', 'alias', 'kind', 'qualifiedName', 'columns', 'queryScope']) &&
    value.version === 1 &&
    text(value.scope, 100) &&
    text(value.alias) &&
    typeof value.kind === 'string' &&
    ['table', 'derived', 'cte'].includes(value.kind) &&
    strings(value.qualifiedName, 32) &&
    (value.kind !== 'table' || value.qualifiedName.length > 0) &&
    strings(value.columns, sqlQueryLimits.references) &&
    optionalText(value.queryScope, 100) &&
    (value.kind === 'table' || text(value.queryScope, 100))
  );
}
export function isSqlQueryResult(value: unknown): value is SqlQueryResult {
  if (
    !object(value) ||
    !keys(value, ['version', 'scope', 'parentScope', 'name', 'distinct', 'columns', 'clauses']) ||
    value.version !== 1 ||
    !text(value.scope, 100) ||
    !optionalText(value.parentScope, 100) ||
    !text(value.name) ||
    typeof value.distinct !== 'boolean' ||
    !Array.isArray(value.columns) ||
    !value.columns.length ||
    value.columns.length > sqlQueryLimits.outputs ||
    !object(value.clauses)
  )
    return false;
  if (
    !Object.entries(value.clauses).every(
      ([key, entry]) =>
        ['from', 'where', 'groupBy', 'having', 'orderBy', 'limit'].includes(key) &&
        text(entry, sqlQueryLimits.expressionLength),
    )
  )
    return false;
  return value.columns.every(
    (column, index) =>
      object(column) &&
      keys(column, ['ordinal', 'name', 'alias', 'expression', 'references', 'duplicateAlias']) &&
      column.ordinal === index + 1 &&
      text(column.name) &&
      optionalText(column.alias) &&
      text(column.expression, sqlQueryLimits.expressionLength) &&
      references(column.references) &&
      (column.duplicateAlias === undefined || typeof column.duplicateAlias === 'boolean'),
  );
}
export function isSqlQueryRelationship(value: unknown): value is SqlQueryRelationship {
  return (
    object(value) &&
    keys(value, [
      'version',
      'scope',
      'kind',
      'joinType',
      'condition',
      'references',
      'outputOrdinals',
    ]) &&
    value.version === 1 &&
    text(value.scope, 100) &&
    typeof value.kind === 'string' &&
    ['join', 'input', 'lineage', 'subquery'].includes(value.kind) &&
    optionalText(value.joinType, 100) &&
    optionalText(value.condition, sqlQueryLimits.expressionLength) &&
    (value.references === undefined || references(value.references)) &&
    (value.outputOrdinals === undefined ||
      (Array.isArray(value.outputOrdinals) &&
        value.outputOrdinals.length <= sqlQueryLimits.outputs &&
        value.outputOrdinals.every(
          (entry) => Number.isInteger(entry) && entry > 0 && entry <= sqlQueryLimits.outputs,
        )))
  );
}
export function getSqlQuerySource(node: GraphNode): SqlQuerySource | undefined {
  const value = node.metadata?.sqlQuerySource;
  return isSqlQuerySource(value) ? value : undefined;
}
export function getSqlQueryResult(node: GraphNode): SqlQueryResult | undefined {
  const value = node.metadata?.sqlQueryResult;
  return isSqlQueryResult(value) ? value : undefined;
}
export function getSqlQueryRelationship(edge: GraphEdge): SqlQueryRelationship | undefined {
  const value = edge.metadata?.sqlQueryRelationship;
  return isSqlQueryRelationship(value) ? value : undefined;
}

/** Validate reserved query metadata without interpreting arbitrary custom metadata. */
export function validateSqlQueryGraph(graph: Graph): void {
  let blocks = 0;
  let sources = 0;
  let outputs = 0;
  let refs = 0;
  let relationships = 0;
  for (const node of graph.nodes) {
    if (node.metadata?.sqlQuerySource !== undefined) {
      const source = getSqlQuerySource(node);
      if (!source) throw new Error('Invalid SQL query source metadata.');
      sources++;
      refs += source.columns.length;
    }
    if (node.metadata?.sqlQueryResult !== undefined) {
      const result = getSqlQueryResult(node);
      if (!result) throw new Error('Invalid SQL query result metadata.');
      blocks++;
      outputs += result.columns.length;
      refs += result.columns.reduce((sum, column) => sum + column.references.length, 0);
    }
  }
  for (const edge of graph.edges) {
    if (edge.metadata?.sqlQueryRelationship !== undefined) {
      const relationship = getSqlQueryRelationship(edge);
      if (!relationship) throw new Error('Invalid SQL query relationship metadata.');
      relationships++;
      refs += relationship.references?.length ?? 0;
    }
  }
  if (
    blocks > sqlQueryLimits.blocks ||
    sources > sqlQueryLimits.sources ||
    outputs > sqlQueryLimits.outputs ||
    refs > sqlQueryLimits.references ||
    relationships > sqlQueryLimits.relationships
  )
    throw new Error('SQL query metadata exceeds structural import limits.');
}
