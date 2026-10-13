import type { Graph } from '../model/types';
import { GameIdentityCopy } from './copy';
import { gameProjection, setGameDefinition } from './document';

/** Native IDs are already copied by the common graph path; remap semantic IDs once. */
export function remapGameGraph(
  graph: Graph,
  makeId: () => string = () => crypto.randomUUID(),
): Graph {
  if (!graph.diagram.game) return graph;
  const copy = new GameIdentityCopy(graph.diagram.game, makeId);
  const nodes = graph.nodes.map((node) => {
    const ref = gameProjection(node);
    return ref
      ? {
          ...node,
          metadata: { ...node.metadata, roblox: { ...ref, id: copy.reference(ref.kind, ref.id) } },
        }
      : node;
  });
  const edges = graph.edges.map((edge) =>
    edge.metadata.robloxGenerated === true && typeof edge.metadata.robloxKey === 'string'
      ? {
          ...edge,
          metadata: { ...edge.metadata, robloxKey: copy.edgeKey(edge.metadata.robloxKey) },
        }
      : edge,
  );
  return setGameDefinition({ ...graph, nodes, edges }, copy.model());
}
