import type { GraphEdge } from '../model/types';
import type { SimulationCapacityGroup } from './capacity-projection';

/** Banks meet at shared inputs: linear fans preserve observed outgoing unit leases. */
export function projectCapacityEdges(
  edges: GraphEdge[],
  groups: Map<string, SimulationCapacityGroup>,
  semanticEdgeIds: Set<string>,
) {
  return edges.flatMap((edge) => {
    const source = groups.get(edge.sourceNodeId),
      target = groups.get(edge.targetNodeId);
    const resource = edge.edgeType === 'simulation-resource';
    if (!semanticEdgeIds.has(edge.id) && !resource) return [edge];
    const sources = source?.cardIds ?? [edge.sourceNodeId],
      targets = target?.cardIds ?? [edge.targetNodeId];
    const branches = [
      [0, 0],
      ...sources.slice(1).map((_, index) => [index + 1, 0]),
      ...targets.slice(1).map((_, index) => [0, index + 1]),
    ];
    return branches.map(([sourceUnit, targetUnit], index) => ({
      ...edge,
      id:
        index === 0
          ? edge.id
          : `simulation-capacity-edge:${edge.id}:${sourceUnit + 1}:${targetUnit + 1}`,
      sourceNodeId: sources[sourceUnit],
      targetNodeId: targets[targetUnit],
      label: resource && edge.label ? `${edge.label} · shared pool` : edge.label,
      metadata: {
        ...edge.metadata,
        simulationProjected: true,
        simulationLogicalEdgeId: edge.id,
        simulationLogicalSourceNodeId: edge.sourceNodeId,
        simulationLogicalTargetNodeId: edge.targetNodeId,
        simulationSourceCapacityUnit: sourceUnit + 1,
        simulationTargetCapacityUnit: targetUnit + 1,
        simulationCapacityBranch: index + 1,
        ...(resource ? { simulationResourcePool: true } : {}),
      },
    }));
  });
}
