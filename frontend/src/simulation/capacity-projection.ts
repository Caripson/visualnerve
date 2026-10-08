import type { Graph, GraphNode } from '../model/types';
import type { SimulationRenderProjection } from './render-model';
import type { SimulationNode, SimulationState } from './types';
import { CAPACITY_CARD_GAP, layoutCapacityBanks } from './capacity-layout';
import { projectCapacityEdges } from './capacity-edges';
import { SimulationCardSizing } from './card-sizing';

export const MAX_CAPACITY_CARDS_PER_BANK = 8;
export const MAX_ADDITIONAL_CAPACITY_CARDS = 256;
export interface SimulationCapacityGroup {
  cardIds: string[];
  actualCapacity: number;
  hidden: number;
}
export interface SimulationCapacityCard {
  logicalId: string;
  unit: number;
  total: number;
  hidden: number;
}
export interface SimulationCapacityProjection extends SimulationRenderProjection {
  nodes: GraphNode[];
  capacityGroups: Map<string, SimulationCapacityGroup>;
}
export function logicalNodeId(node: GraphNode) {
  const value = node.metadata.simulationLogicalNodeId;
  return typeof value === 'string' ? value : node.id;
}
export function getSimulationCapacityCard(node: GraphNode): SimulationCapacityCard | undefined {
  const unit = node.metadata.simulationCapacityUnit,
    total = node.metadata.simulationCapacityTotal;
  if (typeof unit !== 'number' || typeof total !== 'number') return;
  return {
    logicalId: logicalNodeId(node),
    unit,
    total,
    hidden: Number(node.metadata.simulationCapacityHidden) || 0,
  };
}
const cache = new WeakMap<
  Graph,
  WeakMap<SimulationRenderProjection, Map<string, SimulationCapacityProjection>>
>();

/** Capacity cards are interchangeable visual slots, never extra process/resource entities. */
export function projectSimulationCapacityNodes(
  graph: Graph,
  projection: SimulationRenderProjection,
  state?: SimulationState,
): SimulationCapacityProjection {
  const model = projection.model;
  const semantic = new Map(model.nodes.map((node) => [node.id, node]));
  const resources = new Map(model.resources.map((resource) => [resource.id, resource]));
  const enabled = model.improvements.filter((feature) => feature.enabled);
  const capacities = new Map<string, number>();
  for (const shape of graph.nodes) {
    const node = semantic.get(shape.id);
    if (!node || (node.type !== 'work' && node.type !== 'resource')) continue;
    const configured =
      node.type === 'work' ? node.work.capacity : (resources.get(node.resourceId)?.capacity ?? 0);
    const initial = enabled.reduce(
      (value, feature) =>
        value +
        (node.type === 'work'
          ? feature.nodeId === node.id
            ? (feature.capacityIncrease ?? 0)
            : 0
          : feature.resourceId === node.resourceId
            ? (feature.capacityIncrease ?? 0)
            : 0),
      configured,
    );
    capacities.set(
      node.id,
      node.type === 'work'
        ? (state?.nodes[node.id]?.capacity ?? initial)
        : (state?.resources[node.resourceId]?.capacity ?? initial),
    );
  }
  let byProjection = cache.get(graph);
  if (!byProjection) cache.set(graph, (byProjection = new WeakMap()));
  let views = byProjection.get(projection);
  if (!views) byProjection.set(projection, (views = new Map()));
  const key = JSON.stringify([...capacities]);
  const cached = views.get(key);
  if (cached) return cached;
  const capacityGroups = new Map<string, SimulationCapacityGroup>();
  let remaining = MAX_ADDITIONAL_CAPACITY_CARDS;
  for (const [id, actualCapacity] of capacities) {
    const count = Math.min(Math.max(1, actualCapacity), MAX_CAPACITY_CARDS_PER_BANK, remaining + 1);
    remaining -= count - 1;
    capacityGroups.set(id, {
      cardIds: Array.from({ length: count }, (_, index) =>
        index === 0 ? id : `simulation-capacity:${id}:${index + 1}`,
      ),
      actualCapacity,
      hidden: Math.max(0, actualCapacity - count),
    });
  }
  const sizing = new SimulationCardSizing();
  const contentNodes = graph.nodes.map((node) => sizing.fit(node, semantic.get(node.id)));
  const positions = layoutCapacityBanks(
    contentNodes.map((node) => ({ node, cards: capacityGroups.get(node.id)?.cardIds.length ?? 1 })),
    undefined,
    contentNodes.some((node, index) => node !== graph.nodes[index]),
  );
  const nodes = contentNodes.flatMap((node, index) => {
    const position = positions.get(node.id)!,
      group = capacityGroups.get(node.id);
    if (!group)
      return node === graph.nodes[index] && position.x === node.x && position.y === node.y
        ? [node]
        : [
            {
              ...node,
              ...position,
              metadata: {
                ...node.metadata,
                simulationProjected: true,
                simulationLogicalNodeId: node.id,
              },
            },
          ];
    const config = semantic.get(node.id) as SimulationNode;
    return group.cardIds.map((id, index) => ({
      ...node,
      ...position,
      id,
      y: position.y + index * (node.height + CAPACITY_CARD_GAP),
      title: group.actualCapacity > 1 ? `${config.name} ${index + 1}` : config.name,
      metadata: {
        ...node.metadata,
        simulationProjected: true,
        simulationLogicalNodeId: node.id,
        simulationCapacityUnit: index + 1,
        simulationCapacityTotal: group.actualCapacity,
        simulationCapacityHidden: index === group.cardIds.length - 1 ? group.hidden : 0,
        ...(config.type === 'resource' ? { simulationResourceId: config.resourceId } : {}),
      },
    }));
  });
  const edges = projectCapacityEdges(
    projection.edges,
    capacityGroups,
    new Set(model.edges.map((edge) => edge.id)),
  );
  const result = {
    ...projection,
    nodes,
    edges,
    resourceEdges: edges.filter((edge) => edge.edgeType === 'simulation-resource'),
    capacityGroups,
  };
  views.set(key, result);
  if (views.size > 16) views.delete(views.keys().next().value!);
  return result;
}
