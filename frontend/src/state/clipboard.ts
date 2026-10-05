import { base, type Graph, type GraphNode, type GraphEdge } from '../model/types';
export interface Clip {
  format: 'visual-nerve-clipboard';
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export function copySelection(graph: Graph, ids: string[]): Clip {
  const set = new Set(ids);
  return structuredClone({
    format: 'visual-nerve-clipboard' as const,
    nodes: graph.nodes.filter((n) => set.has(n.id)),
    edges: graph.edges.filter((e) => set.has(e.sourceNodeId) && set.has(e.targetNodeId)),
  });
}
export function pasteSelection(
  clip: Clip,
  diagramId: string,
  offset = 40,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const remap = new Map(clip.nodes.map((n) => [n.id, crypto.randomUUID()]));
  return {
    nodes: clip.nodes.map((n) => ({
      ...structuredClone(n),
      ...base(),
      id: remap.get(n.id)!,
      diagramId,
      externalId: undefined,
      parentId: n.parentId ? remap.get(n.parentId) : undefined,
      x: n.x + offset,
      y: n.y + offset,
    })),
    edges: clip.edges.map((e) => ({
      ...structuredClone(e),
      ...base(),
      diagramId,
      externalId: undefined,
      sourceNodeId: remap.get(e.sourceNodeId)!,
      targetNodeId: remap.get(e.targetNodeId)!,
    })),
  };
}
