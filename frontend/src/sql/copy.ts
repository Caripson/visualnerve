import type { GraphEdge, GraphNode } from '../model/types';
import {
  getSqlQuerySource,
  getSqlQueryResult,
  getSqlQueryRelationship,
  type SqlQueryReference,
} from './query-schema';

/** A pasted query is a separate logical instance, even in the same diagram. */
export function remapCopiedSqlQuery(nodes: GraphNode[], edges: GraphEdge[]) {
  const scopes = new Map<string, string>();
  const prefix = `copy-${crypto.randomUUID()}`;
  const scope = (value?: string) => {
    if (value === undefined) return undefined;
    if (!scopes.has(value)) scopes.set(value, `${prefix}-${scopes.size + 1}`);
    return scopes.get(value)!;
  };
  const reference = (value: SqlQueryReference) => ({ ...value, scope: scope(value.scope) });
  return {
    nodes: nodes.map((node) => {
      const source = getSqlQuerySource(node);
      const result = getSqlQueryResult(node);
      if (!source && !result) return node;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          ...(source
            ? {
                sqlQuerySource: {
                  ...source,
                  scope: scope(source.scope),
                  queryScope: scope(source.queryScope),
                },
              }
            : {}),
          ...(result
            ? {
                sqlQueryResult: {
                  ...result,
                  scope: scope(result.scope),
                  parentScope: scope(result.parentScope),
                  columns: result.columns.map((column) => ({
                    ...column,
                    references: column.references.map(reference),
                  })),
                },
              }
            : {}),
        },
      };
    }),
    edges: edges.map((edge) => {
      const relationship = getSqlQueryRelationship(edge);
      if (!relationship) return edge;
      return {
        ...edge,
        metadata: {
          ...edge.metadata,
          sqlQueryRelationship: {
            ...relationship,
            scope: scope(relationship.scope),
            references: relationship.references?.map(reference),
          },
        },
      };
    }),
  };
}
