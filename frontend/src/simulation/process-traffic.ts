import { simulationNodeTraffic, type SimulationTraffic } from './traffic';
import type { SimulationModel, SimulationState, SimulationNode } from './types';

const nodesByModel = new WeakMap<SimulationModel, Map<string, SimulationNode>>();

/** A parent exposes the most constrained real child; a quiet sibling cannot dilute it. */
export function simulationProcessTraffic(
  processId: string,
  model: SimulationModel,
  state?: SimulationState,
): SimulationTraffic {
  const metric = state?.processes?.[processId];
  if (!metric)
    return {
      level: 'inactive',
      label: 'Ready',
      reason: 'Run to observe this process',
      queue: 0,
      utilization: 0,
      waitingResources: [],
    };
  let nodes = nodesByModel.get(model);
  if (!nodes) {
    nodes = new Map(model.nodes.map((node) => [node.id, node]));
    nodesByModel.set(model, nodes);
  }
  const children = metric.nodeIds.flatMap((id) => {
    const node = nodes.get(id);
    return node ? [simulationNodeTraffic(node, state, model)] : [];
  });
  const rank = { inactive: 0, clear: 1, busy: 2, congested: 3 };
  const worst = children.reduce<SimulationTraffic | undefined>(
    (previous, child) => (!previous || rank[child.level] > rank[previous.level] ? child : previous),
    undefined,
  );
  return {
    level: worst?.level ?? 'clear',
    label:
      worst?.level === 'congested'
        ? 'Bottleneck inside'
        : worst?.level === 'busy'
          ? 'Pressure building'
          : 'Flowing',
    reason: metric.currentBottleneck
      ? `Constrained step: ${state?.nodes[metric.currentBottleneck]?.name ?? state?.resources[metric.currentBottleneck]?.name ?? metric.currentBottleneck}`
      : 'Observed child process state',
    queue: metric.queue.current,
    utilization: metric.currentUtilization,
    waitingResources: [...new Set(children.flatMap((child) => child.waitingResources))],
  };
}
