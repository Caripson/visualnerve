import { base, type Graph, type GraphNode, type GraphEdge } from '../model/types';
import { getCsvNode } from '../data/csv';
import { graphDatasets } from '../data/model';
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
  target: Graph | string,
  offset = 40,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const diagramId = typeof target === 'string' ? target : target.diagram.id;
  const datasetIds = new Set(
    typeof target === 'string' ? [] : graphDatasets(target).map((source) => source.id),
  );
  const remap = new Map(clip.nodes.map((n) => [n.id, crypto.randomUUID()]));
  return {
    nodes: clip.nodes.map((n) => {
      const copy = structuredClone(n);
      const csv = getCsvNode(copy);
      if (csv && copy.metadata.csv !== undefined) {
        if (!datasetIds.has(csv.datasetId)) {
          const { csv: _binding, ...metadata } = copy.metadata;
          copy.metadata = { ...metadata, csvSnapshot: { ...csv, visible: true } };
        } else copy.metadata = { ...copy.metadata, csv: { ...csv, visible: true } };
      } else if (csv && copy.metadata.csvSnapshot !== undefined) {
        copy.metadata = { ...copy.metadata, csvSnapshot: { ...csv, visible: true } };
      }
      return {
        ...copy,
        ...base(),
        id: remap.get(n.id)!,
        diagramId,
        externalId: undefined,
        parentId: n.parentId ? remap.get(n.parentId) : undefined,
        x: n.x + offset,
        y: n.y + offset,
      };
    }),
    edges: clip.edges.map((e) => ({
      ...structuredClone(e),
      ...base(),
      diagramId,
      externalId: undefined,
      sourceNodeId: remap.get(e.sourceNodeId)!,
      targetNodeId: remap.get(e.targetNodeId)!,
      ...(e.metadata.csvGenerated === true || e.metadata.csvModelGenerated === true
        ? {
            metadata: {
              ...structuredClone(e.metadata),
              csvGenerated: false,
              csvModelGenerated: false,
            },
          }
        : {}),
    })),
  };
}
