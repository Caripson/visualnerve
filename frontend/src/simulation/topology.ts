import type { SimulationModel } from './types';

const signatures = new WeakMap<SimulationModel, string>();
const byId = <T extends { id: string }>(values: readonly T[]) =>
  [...values].sort((a, b) => a.id.localeCompare(b.id));

/** Cached for immutable document/run models; quantities and presentation are not topology. */
export function simulationTopologySignature(model: SimulationModel): string {
  const previous = signatures.get(model);
  if (previous !== undefined) return previous;
  const signature = JSON.stringify({
    processes: byId(model.processes ?? []).map((process) => [process.id, process.parentId ?? null]),
    nodes: byId(model.nodes).map((node) => [
      node.id,
      node.type,
      node.processId ?? null,
      node.type === 'source' ? node.source.particleTypeId : null,
      node.type === 'resource' ? node.resourceId : null,
      node.type === 'fork' ? [node.fork.joinNodeId, node.fork.branchEdgeIds] : null,
      node.type === 'join' ? node.join.forkNodeId : null,
      node.type === 'work'
        ? (node.work.resourceRequirements ?? []).map((requirement) => requirement.resourceId).sort()
        : null,
    ]),
    edges: byId(model.edges).map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId]),
    resources: byId(model.resources).map((resource) => resource.id),
    particleTypes: byId(model.particleTypes).map((type) => type.id),
  });
  signatures.set(model, signature);
  return signature;
}

/** Compare base topology, allowing a frozen scenario to project its own resource assumptions. */
export function simulationTopologyCompatible(current: SimulationModel, captured: SimulationModel) {
  return simulationTopologySignature(current) === simulationTopologySignature(captured);
}
