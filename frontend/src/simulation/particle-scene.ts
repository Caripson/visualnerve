import type { GraphEdge, GraphNode } from '../model/types';
import { logicalNodeId } from './render-model';
import {
  particleCapacityCard,
  particleTransitEdge,
  type SimulationParticleView,
} from './particle-view';
import type { SimulationPresentationSlots } from './presentation-slots';
import { indexSimulationTraffic, type SimulationTraffic } from './traffic';
import type { ParticleSnapshot, SimulationModel, SimulationState } from './types';

export const MAX_RENDERED_PARTICLES = 400;
export const MAX_RENDERED_TRAFFIC_EDGES = 1200;
export const MAX_QUEUE_SAMPLE = 12;
export interface ParticleMark {
  particle: ParticleSnapshot;
  node: GraphNode;
  index: number;
}
export interface TransitMark {
  particle: ParticleSnapshot;
  edge: GraphEdge;
}
export interface TrafficPath {
  edge: GraphEdge;
  traffic: SimulationTraffic;
  resource: boolean;
}
export interface ParticleSceneBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Sampling changes presentation only. Missing retained work is never replaced with invented dots. */
export function buildSimulationParticleScene(
  view: SimulationParticleView,
  model: SimulationModel,
  state: SimulationState,
  slots: SimulationPresentationSlots,
  bounds?: ParticleSceneBounds,
) {
  const semanticEdges = new Set(model.edges.map((edge) => edge.id));
  const traffic = indexSimulationTraffic(model, state);
  const processing: ParticleMark[] = [];
  const transit: TransitMark[] = [];
  const queues: ParticleMark[] = [];
  const losses: ParticleMark[] = [];
  const queueCounts = new Map<string, number>();
  const inBounds = (node: GraphNode) =>
    !bounds ||
    (node.x + node.width + 32 >= bounds.left &&
      node.x - 32 <= bounds.right &&
      node.y + node.height + 32 >= bounds.top &&
      node.y - 32 <= bounds.bottom);
  const edgeInBounds = (edge: GraphEdge) => {
    if (!bounds) return true;
    const source = view.nodes.get(edge.sourceNodeId)!;
    const target = view.nodes.get(edge.targetNodeId)!;
    return (
      Math.max(source.x + source.width, target.x + target.width) + 64 >= bounds.left &&
      Math.min(source.x, target.x) - 64 <= bounds.right &&
      Math.max(source.y + source.height, target.y + target.height) + 64 >= bounds.top &&
      Math.min(source.y, target.y) - 64 <= bounds.bottom
    );
  };
  for (const particle of state.particles) {
    if (particle.pendingAdmission) continue;
    if (particle.status === 'transit' && transit.length < 200) {
      if (!particle.edgeId || !semanticEdges.has(particle.edgeId)) continue;
      const edge = particleTransitEdge(view, particle, slots);
      if (
        edge &&
        edgeInBounds(edge) &&
        particleTransitFraction(particle, state.timeSeconds) !== undefined
      )
        transit.push({ particle, edge });
    } else if (particle.status === 'processing' && processing.length < 100) {
      const unit = slots.selectProcessingUnit(particle.nodeId, particle);
      const node =
        unit === undefined ? undefined : particleCapacityCard(view, particle.nodeId, unit);
      if (node && inBounds(node)) processing.push({ particle, node, index: 0 });
    } else if (particle.status === 'queued' && queues.length < 80) {
      if (!state.nodes[particle.nodeId]?.queue.current) continue;
      const node = particleCapacityCard(view, particle.nodeId);
      const count = queueCounts.get(particle.nodeId) ?? 0;
      if (node && inBounds(node) && count < MAX_QUEUE_SAMPLE) {
        queues.push({ particle, node, index: count });
        queueCounts.set(particle.nodeId, count + 1);
      }
    } else if (
      (particle.status === 'abandoned' || particle.status === 'failed') &&
      losses.length < 20 &&
      particle.completedAtSeconds !== undefined &&
      state.timeSeconds - particle.completedAtSeconds <= 60
    ) {
      const node = particleCapacityCard(view, particle.nodeId);
      if (node && inBounds(node)) losses.push({ particle, node, index: losses.length });
    }
  }
  const paths: TrafficPath[] = [];
  for (const edge of view.flowEdges) {
    if (paths.length >= MAX_RENDERED_TRAFFIC_EDGES) break;
    const id = edge.metadata.simulationLogicalEdgeId;
    if (!semanticEdges.has(typeof id === 'string' ? id : edge.id) || !edgeInBounds(edge)) continue;
    const target = view.nodes.get(edge.targetNodeId)!;
    const pressure = traffic.get(logicalNodeId(target));
    if (pressure) paths.push({ edge, traffic: pressure, resource: false });
  }
  for (const edge of view.resourceEdges) {
    if (paths.length >= MAX_RENDERED_TRAFFIC_EDGES) break;
    if (!edgeInBounds(edge)) continue;
    const target = view.nodes.get(edge.targetNodeId)!;
    const source = view.nodes.get(edge.sourceNodeId)!;
    const targetTraffic = traffic.get(logicalNodeId(target));
    const resourceId = edge.metadata.simulationResourceId;
    const pool = typeof resourceId === 'string' ? state.resources[resourceId] : undefined;
    // A saturated but unrelated pool must not falsely mark every consuming flow blocked.
    const waiting =
      pool?.waitingNodeIds.includes(logicalNodeId(target)) &&
      targetTraffic?.waitingResources.includes(pool.name);
    const pressure = waiting ? targetTraffic : traffic.get(logicalNodeId(source));
    if (pressure) paths.push({ edge, traffic: pressure, resource: true });
  }
  return { processing, transit, queues, losses, paths };
}

/** Zero-time transfers are instant. No particle can leave before its observed departure. */
export function particleTransitFraction(particle: ParticleSnapshot, timeSeconds: number) {
  const departed = particle.departedAtSeconds;
  const arrives = particle.arrivesAtSeconds;
  if (
    particle.status !== 'transit' ||
    departed === undefined ||
    arrives === undefined ||
    !Number.isFinite(departed) ||
    !Number.isFinite(arrives) ||
    arrives <= departed ||
    timeSeconds < departed ||
    timeSeconds >= arrives
  )
    return;
  return (timeSeconds - departed) / (arrives - departed);
}
