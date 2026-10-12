import type { Graph } from '../model/types';
/** Preserve internal references and discard references outside a copied selection. Node IDs themselves are remapped by the caller. */
export function remapNotationGraph(graph: Graph, nodeIds: ReadonlyMap<string, string>): Graph {
  const existing = new Set(graph.nodes.map((node) => nodeIds.get(node.id) ?? node.id));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (!node.notation) return node;
      const notation = { ...node.notation };
      for (const key of ['attachmentId', 'relatedNodeId'] as const) {
        const value = notation[key];
        if (value === undefined) continue;
        const mapped = nodeIds.get(value) ?? value;
        if (existing.has(mapped)) notation[key] = mapped;
        else delete notation[key];
      }
      return { ...node, notation };
    }),
  };
}
