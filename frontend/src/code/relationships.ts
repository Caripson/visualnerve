import type { GraphEdge } from '../model/types';
import { getCodeRelation } from './schema';

/** Source evidence no longer describes a relationship after the user moves an endpoint. */
export function reconnectedCodeEdge(previous: GraphEdge, next: GraphEdge): GraphEdge {
  if (
    !getCodeRelation(previous) ||
    (previous.sourceNodeId === next.sourceNodeId && previous.targetNodeId === next.targetNodeId)
  )
    return next;
  const { codeRelation: _evidence, ...metadata } = { ...previous.metadata, ...next.metadata };
  return {
    ...next,
    metadata,
    edgeType: next.edgeType.startsWith('code-') ? 'relationship' : next.edgeType,
  };
}
