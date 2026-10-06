import type { GraphEdge } from '../model/types';
import { getSqlRelationship } from './schema';
import { getSqlQueryRelationship } from './query-schema';

/** Parsed column pairs describe their original tables, so a reconnect becomes a user relationship. */
export function reconnectedSqlEdge(previous: GraphEdge, next: GraphEdge): GraphEdge {
  if (
    (!getSqlRelationship(previous) && !getSqlQueryRelationship(previous)) ||
    (previous.sourceNodeId === next.sourceNodeId && previous.targetNodeId === next.targetNodeId)
  )
    return next;
  const {
    sqlRelationship: _sqlRelationship,
    sqlQueryRelationship: _sqlQueryRelationship,
    ...metadata
  } = {
    ...previous.metadata,
    ...next.metadata,
  };
  return {
    ...next,
    metadata,
    edgeType:
      next.edgeType === 'foreign-key' ||
      (getSqlQueryRelationship(previous) && next.edgeType.startsWith('sql-'))
        ? 'relationship'
        : next.edgeType,
  };
}
