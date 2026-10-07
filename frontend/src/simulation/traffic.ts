import type { Resource, SimulationModel, SimulationNode, SimulationState } from './types';

export type SimulationTrafficLevel = 'clear' | 'busy' | 'congested' | 'inactive';
export const simulationTrafficColors: Record<SimulationTrafficLevel, string> = {
  clear: '#169b65',
  busy: '#d49a16',
  congested: '#dc5055',
  inactive: '#8994a6',
};
export interface SimulationTraffic {
  level: SimulationTrafficLevel;
  label: string;
  reason: string;
  queue: number;
  utilization: number;
  waitingResources: string[];
}
const modelIndices = new WeakMap<
  SimulationModel,
  {
    resources: Map<string, Resource>;
    resourceMultipliers: Map<string, Map<string, number>>;
  }
>();
function index(model?: SimulationModel) {
  if (!model) return;
  let value = modelIndices.get(model);
  if (!value) {
    const resourceMultipliers = new Map<string, Map<string, number>>();
    for (const node of model.nodes)
      if (node.type === 'work') {
        const requirements = new Map<string, number>();
        for (const requirement of node.work.resourceRequirements ?? []) {
          let multiplier = 1;
          for (const feature of model.improvements)
            if (
              feature.enabled &&
              (feature.nodeId === node.id || feature.resourceId === requirement.resourceId)
            )
              multiplier *= feature.resourceUnitsMultiplier ?? 1;
          requirements.set(requirement.resourceId, requirement.units * multiplier);
        }
        resourceMultipliers.set(node.id, requirements);
      }
    value = {
      resources: new Map(model.resources.map((resource) => [resource.id, resource])),
      resourceMultipliers,
    };
    modelIndices.set(model, value);
  }
  return value;
}
function resourceOpen(resource: Resource | undefined, timeSeconds: number) {
  return (
    !resource?.schedule?.length ||
    resource.schedule.some((window) => {
      const timestamp = Math.round(timeSeconds * 1000);
      const time =
        window.repeatSeconds === undefined
          ? timestamp
          : timestamp % Math.round(window.repeatSeconds * 1000);
      return (
        time >= Math.round(window.startSeconds * 1000) &&
        time < Math.round(window.endSeconds * 1000)
      );
    })
  );
}

/** Current engine state, not cumulative utilization or a node's configured capacity. */
export function simulationNodeTraffic(
  node: SimulationNode,
  state?: SimulationState,
  model?: SimulationModel,
): SimulationTraffic {
  const metric = state?.nodes[node.id];
  const resource = node.type === 'resource' ? state?.resources[node.resourceId] : undefined;
  const queue = resource?.queue.current ?? metric?.queue.current ?? 0;
  const utilization = resource?.currentUtilization ?? metric?.currentUtilization ?? 0;
  const lookup = index(model);
  const resourceBlocked =
    node.type === 'resource' &&
    resource &&
    resource.waitingNodeIds.some((id) => {
      const work = state?.nodes[id];
      const required = lookup?.resourceMultipliers.get(id)?.get(node.resourceId);
      return (
        work &&
        work.busy < work.capacity &&
        required !== undefined &&
        resource.capacity - resource.busy + 1e-9 < required
      );
    });
  const waitingResources =
    node.type === 'work' && queue > 0 && metric && metric.busy < metric.capacity
      ? (node.work.resourceRequirements ?? []).flatMap(({ resourceId, units }) => {
          const pool = state?.resources[resourceId];
          const required = lookup?.resourceMultipliers.get(node.id)?.get(resourceId) ?? units;
          return pool?.waitingNodeIds.includes(node.id) &&
            (!resourceOpen(lookup?.resources.get(resourceId), state!.timeSeconds) ||
              pool.capacity - pool.busy + 1e-9 < required)
            ? [pool.name]
            : [];
        })
      : [];
  const value = { queue, utilization, waitingResources };
  if (!metric && !resource)
    return { ...value, level: 'inactive', label: 'Ready', reason: 'Run to observe traffic' };
  if (metric?.status === 'failed')
    return { ...value, level: 'congested', label: 'Failed', reason: 'Processing failed' };
  if (waitingResources.length)
    return {
      ...value,
      level: 'congested',
      label: 'Resource blocked',
      reason: `Waiting for ${waitingResources.join(', ')} · ${queue} queued`,
    };
  if (
    queue > 0 &&
    (utilization >= 1 ||
      (node.type === 'work' && metric?.status === 'blocked') ||
      resourceBlocked ||
      (resource?.capacity ?? metric?.capacity ?? 0) === 0 ||
      (node.type === 'resource' &&
        !resourceOpen(lookup?.resources.get(node.resourceId), state!.timeSeconds)))
  )
    return {
      ...value,
      level: 'congested',
      label:
        metric?.status === 'scaling'
          ? 'Scaling · congested'
          : metric?.status === 'blocked' && node.type === 'work'
            ? 'Blocked'
            : 'Congested',
      reason: `${queue} queued · ${Math.round(utilization * 100)}% occupied`,
    };
  if (queue > 0 || utilization >= 0.85 || metric?.status === 'scaling')
    return {
      ...value,
      level: 'busy',
      label:
        metric?.status === 'scaling'
          ? 'Scaling'
          : queue > 0
            ? node.type === 'resource'
              ? 'Queued demand'
              : 'Queue building'
            : utilization >= 1
              ? 'At capacity'
              : 'Busy',
      reason: `${queue} queued · ${Math.round(utilization * 100)}% occupied`,
    };
  return {
    ...value,
    level: 'clear',
    label: utilization > 0 ? 'Flowing' : 'Clear',
    reason: `No queue · ${Math.round(utilization * 100)}% occupied`,
  };
}

/** Queue pressure colors incoming flow. Resource connectors never carry work particles. */
export function indexSimulationTraffic(model: SimulationModel, state?: SimulationState) {
  return new Map(model.nodes.map((node) => [node.id, simulationNodeTraffic(node, state, model)]));
}
