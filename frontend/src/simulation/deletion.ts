import { resolveScenario } from './schema';
import { toScenarioPatch } from './scenario-patch';
import { StorageError } from '../model/errors';
import type { SimulationModel, SimulationNode, Improvement, ScenarioOverrides } from './types';

export type SimulationCollection =
  | 'processes'
  | 'nodes'
  | 'edges'
  | 'resources'
  | 'particleTypes'
  | 'improvements';
const collections: SimulationCollection[] = [
  'processes',
  'nodes',
  'edges',
  'resources',
  'particleTypes',
  'improvements',
];

/** Semantic deletion removes the references it owns, including isolated scenario assumptions. */
export function removeSimulationEntity(
  model: SimulationModel,
  collection: SimulationCollection,
  id: string,
) {
  if (collection === 'nodes') {
    const node = model.nodes.find((candidate) => candidate.id === id);
    if (node?.type === 'fork' || node?.type === 'join')
      throw new StorageError(
        422,
        'Remove the complete parallel fork/join pair and reconnect its branches in one model edit. A single fork or join cannot be deleted independently.',
      );
  }
  if (collection === 'processes') {
    const deleted = model.processes?.find((process) => process.id === id);
    if (!deleted) return model;
    return pruneSimulationReferences({
      ...model,
      processes: model
        .processes!.filter((process) => process.id !== id)
        .map((process) =>
          process.parentId === id ? { ...process, parentId: deleted.parentId } : process,
        ),
      nodes: model.nodes.map((node) =>
        node.processId === id ? { ...node, processId: deleted.parentId } : node,
      ),
    });
  }
  return pruneSimulationReferences({
    ...model,
    [collection]: model[collection].filter((item) => item.id !== id),
  });
}

function pruneTopology(input: SimulationModel, fallback?: SimulationModel): SimulationModel {
  const processIds = new Set((input.processes ?? []).map((process) => process.id));
  const particleIds = new Set(input.particleTypes.map((type) => type.id));
  const resourceIds = new Set(input.resources.map((resource) => resource.id));
  const fallbackNodes = new Map(fallback?.nodes.map((node) => [node.id, node]));
  const nodes = input.nodes.flatMap((node): SimulationNode[] => {
    const original = fallbackNodes.get(node.id);
    if (node.processId !== undefined && !processIds.has(node.processId))
      node = { ...node, processId: original?.processId };
    if (node.type === 'source' && !particleIds.has(node.source.particleTypeId))
      return original?.type === 'source'
        ? [{ ...node, source: { ...node.source, particleTypeId: original.source.particleTypeId } }]
        : [];
    if (node.type === 'resource' && !resourceIds.has(node.resourceId))
      return original?.type === 'resource' ? [{ ...node, resourceId: original.resourceId }] : [];
    return [node];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes)
    if (
      (node.type === 'fork' && !nodeIds.has(node.fork.joinNodeId)) ||
      (node.type === 'join' && !nodeIds.has(node.join.forkNodeId))
    )
      throw new StorageError(
        422,
        'A parallel fork and join must stay paired. Remove the complete pair and reconnect its branches in one model edit.',
      );
  const edges = input.edges
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    .map((edge) => ({
      ...edge,
      ...(edge.particleTypeIds
        ? { particleTypeIds: edge.particleTypeIds.filter((id) => particleIds.has(id)) }
        : {}),
    }));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const linked = (from: string, to: string) =>
    edges.some((edge) => edge.sourceNodeId === from && edge.targetNodeId === to);
  const cleanNodes = nodes.map((node): SimulationNode => {
    if (node.type === 'work')
      return {
        ...node,
        work: {
          ...node.work,
          resourceRequirements: node.work.resourceRequirements?.filter((requirement) =>
            resourceIds.has(requirement.resourceId),
          ),
          acceptedParticleTypeIds: node.work.acceptedParticleTypeIds?.filter((id) =>
            particleIds.has(id),
          ),
          overflowNodeId:
            node.work.overflowNodeId && linked(node.id, node.work.overflowNodeId)
              ? node.work.overflowNodeId
              : undefined,
        },
      };
    if (node.type === 'router')
      return {
        ...node,
        router: {
          ...node.router,
          fallbackEdgeId:
            node.router.fallbackEdgeId && edgeIds.has(node.router.fallbackEdgeId)
              ? node.router.fallbackEdgeId
              : undefined,
          rules: node.router.rules?.filter((rule) => {
            if (!edges.some((edge) => edge.id === rule.edgeId && edge.sourceNodeId === node.id))
              return false;
            const condition = rule.condition;
            if (!condition) return true;
            if (condition.field === 'particleTypeId') return particleIds.has(condition.value);
            if ('nodeId' in condition && condition.nodeId && !nodeIds.has(condition.nodeId))
              return false;
            return (
              !('resourceId' in condition && condition.resourceId) ||
              resourceIds.has(condition.resourceId)
            );
          }),
        },
      };
    return node;
  });
  const fallbackFeatures = new Map(fallback?.improvements.map((feature) => [feature.id, feature]));
  const improvements = input.improvements.flatMap((feature): Improvement[] => {
    const original = fallbackFeatures.get(feature.id);
    const nodeId =
      feature.nodeId && nodeIds.has(feature.nodeId) ? feature.nodeId : original?.nodeId;
    const resourceId =
      feature.resourceId && resourceIds.has(feature.resourceId)
        ? feature.resourceId
        : original?.resourceId;
    if (!nodeId && !resourceId) return [];
    const affected = cleanNodes.filter(
      (node) =>
        node.type === 'work' &&
        (node.id === nodeId ||
          node.work.resourceRequirements?.some(
            (requirement) => requirement.resourceId === resourceId,
          )),
    );
    const failureNodeId =
      feature.failureNodeId &&
      nodeIds.has(feature.failureNodeId) &&
      affected.every((node) => linked(node.id, feature.failureNodeId!))
        ? feature.failureNodeId
        : undefined;
    return [{ ...feature, nodeId, resourceId, failureNodeId }];
  });
  const processes = input.processes?.map((process) => {
    const original = fallback?.processes?.find((candidate) => candidate.id === process.id);
    return process.parentId !== undefined && !processIds.has(process.parentId)
      ? { ...process, parentId: original?.parentId }
      : process;
  });
  return {
    ...input,
    ...(processes ? { processes } : {}),
    nodes: cleanNodes,
    edges,
    improvements,
    scenarios: [],
  };
}

/** Reusable by canvas topology cleanup and structured settings; layout never enters this operation. */
export function pruneSimulationReferences(input: SimulationModel): SimulationModel {
  const baseline = pruneTopology(input);
  const scenarios = input.scenarios.map((scenario) => {
    const overrides: ScenarioOverrides = { ...scenario.overrides };
    for (const collection of collections) {
      const ids = new Set((baseline[collection] ?? []).map((item) => item.id));
      const changes = overrides[collection];
      if (changes)
        Object.defineProperty(overrides, collection, {
          value: Object.fromEntries(Object.entries(changes).filter(([id]) => ids.has(id))),
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    const resolved = resolveScenario(
      { ...baseline, scenarios: [{ ...scenario, overrides }] },
      scenario.id,
      1,
    );
    const cleaned = pruneTopology(resolved, baseline);
    const differences: ScenarioOverrides = {};
    for (const collection of collections) {
      const original = new Map((baseline[collection] ?? []).map((item) => [item.id, item]));
      const values = Object.fromEntries(
        (cleaned[collection] ?? [])
          .filter((item) => JSON.stringify(item) !== JSON.stringify(original.get(item.id)))
          .map((item) => [item.id, toScenarioPatch(item, original.get(item.id))]),
      );
      if (Object.keys(values).length)
        Object.defineProperty(differences, collection, {
          value: values,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    if (scenario.overrides.economics !== undefined)
      differences.economics = scenario.overrides.economics;
    return { ...scenario, overrides: differences };
  });
  return { ...baseline, scenarios };
}
