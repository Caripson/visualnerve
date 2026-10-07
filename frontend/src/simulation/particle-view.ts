import type { Graph, GraphEdge, GraphNode } from '../model/types';
import { getSimulationCapacityCard, logicalNodeId } from './render-model';
import type { ParticleSnapshot } from './types';
import type { SimulationPresentationSlots } from './presentation-slots';

export interface SimulationParticleVisibility {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
}
export function indexSimulationParticleView(
  graph: Graph,
  visibility?: SimulationParticleVisibility,
) {
  const nodes = new Map(
    graph.nodes
      .filter((node) => !visibility || visibility.nodeIds.has(node.id))
      .map((node) => [node.id, node]),
  );
  const cards = new Map<string, GraphNode[]>();
  const edges = new Map<string, GraphEdge[]>();
  const flowEdges: GraphEdge[] = [];
  const resourceEdges: GraphEdge[] = [];
  for (const node of nodes.values()) {
    const id = logicalNodeId(node);
    const group = cards.get(id) ?? [];
    group.push(node);
    cards.set(id, group);
    if (Array.isArray(node.metadata.simulationProcessRepresentedNodeIds))
      for (const represented of node.metadata.simulationProcessRepresentedNodeIds) {
        if (typeof represented !== 'string') continue;
        const representedCards = cards.get(represented) ?? [];
        representedCards.push(node);
        cards.set(represented, representedCards);
      }
  }
  for (const edge of graph.edges) {
    if (visibility && !visibility.edgeIds.has(edge.id)) continue;
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) continue;
    if (edge.edgeType === 'simulation-resource') {
      resourceEdges.push(edge);
      continue;
    }
    flowEdges.push(edge);
    const id = edge.metadata.simulationLogicalEdgeId;
    const logicalId = typeof id === 'string' ? id : edge.id;
    const ids = Array.isArray(edge.metadata.simulationLogicalEdgeIds)
      ? edge.metadata.simulationLogicalEdgeIds.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [logicalId];
    for (const id of ids) {
      const group = edges.get(id) ?? [];
      group.push(edge);
      edges.set(id, group);
    }
  }
  return { nodes, cards, edges, flowEdges, resourceEdges };
}
export type SimulationParticleView = ReturnType<typeof indexSimulationParticleView>;

/** Hidden capacity is represented by the final aggregate card, never an invented node. */
export function particleCapacityCard(view: SimulationParticleView, logicalId: string, unit = 1) {
  const cards = view.cards.get(logicalId) ?? [];
  return (
    cards.find(
      (node) =>
        typeof node.metadata.simulationProcessId === 'string' ||
        (getSimulationCapacityCard(node)?.unit ?? 1) === unit,
    ) ??
    cards.find((node) => {
      const card = getSimulationCapacityCard(node);
      return card && card.hidden > 0 && unit >= card.unit && unit <= card.total;
    })
  );
}

/** Incoming work reaches the shared queue. Departure uses a unit only if observed processing there. */
export function particleTransitEdge(
  view: SimulationParticleView,
  particle: ParticleSnapshot,
  slots: SimulationPresentationSlots,
) {
  if (particle.status !== 'transit' || !particle.edgeId) return;
  const branches = view.edges.get(particle.edgeId) ?? [];
  const observedUnit = slots.departureUnit(particle, particle.nodeId);
  const source =
    particleCapacityCard(view, particle.nodeId, observedUnit ?? 1) ??
    particleCapacityCard(view, particle.nodeId);
  if (!source) return;
  return branches.find((edge) => {
    const target = view.nodes.get(edge.targetNodeId);
    return (
      edge.sourceNodeId === source.id &&
      target &&
      (getSimulationCapacityCard(target)?.unit ?? 1) === 1
    );
  });
}
