import type { GraphEdge, GraphNode } from '../model/types';

const sides = new Set(['left', 'right', 'top', 'bottom']);
/** Stable saved ports are semantic names; React Flow handles are only a view adapter. */
export function notationPortFromHandle(
  handle: string | null | undefined,
  endpoint: 'source' | 'target',
): string | undefined {
  if (!handle) return undefined;
  const prefix = endpoint === 'source' ? 'out' : 'in';
  if (handle === prefix) return endpoint === 'source' ? 'right' : 'left';
  if (handle.startsWith(`${prefix}-port-`)) return handle.slice(prefix.length + 6);
  const side = handle.replace(/^(?:out|in|source|target)-/, '');
  return sides.has(side) ? side : undefined;
}
export function notationPortHandle(
  node: GraphNode | undefined,
  port: string | undefined,
  endpoint: 'source' | 'target',
): string | undefined {
  if (!node?.notation || !port) return undefined;
  const prefix = endpoint === 'source' ? 'out' : 'in';
  if (node.notation.ports?.some((value) => value.id === port)) return `${prefix}-port-${port}`;
  return port === (endpoint === 'source' ? 'right' : 'left')
    ? prefix
    : sides.has(port)
      ? `${prefix}-${port}`
      : undefined;
}
export function notationConnectionPorts(
  edge: Pick<GraphEdge, 'notation' | 'metadata'>,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): Pick<GraphEdge, 'notation' | 'metadata'> {
  return {
    notation: edge.notation
      ? {
          ...edge.notation,
          sourcePort: notationPortFromHandle(sourceHandle, 'source'),
          targetPort: notationPortFromHandle(targetHandle, 'target'),
        }
      : undefined,
    metadata: {
      ...edge.metadata,
      sourceHandle: sourceHandle ?? undefined,
      targetHandle: targetHandle ?? undefined,
    },
  };
}
