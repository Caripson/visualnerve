import type { Graph } from '../model/types';
import type { SimulationModel } from './types';
import { ProcessHierarchy } from './process-hierarchy';
import { remapSimulationModel } from './copy';
import { StorageError } from '../model/errors';

export interface SimulationClipboard {
  diagramId: string;
  model: SimulationModel;
}

export function copySimulationSelection(
  graph: Graph,
  ids: Set<string>,
): SimulationClipboard | undefined {
  if (!graph.simulation) return;
  const nodes = graph.simulation.nodes.filter((node) => ids.has(node.id));
  const hierarchy = new ProcessHierarchy(graph.simulation);
  const processes = new Set(nodes.flatMap((node) => [...hierarchy.forNode(node.id)]));
  const resources = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'resource') resources.add(node.resourceId);
    if (node.type === 'work')
      for (const requirement of node.work.resourceRequirements ?? [])
        resources.add(requirement.resourceId);
    if (node.type === 'router')
      for (const rule of node.router.rules ?? [])
        if (rule.condition && 'resourceId' in rule.condition && rule.condition.resourceId)
          resources.add(rule.condition.resourceId);
  }
  return {
    diagramId: graph.diagram.id,
    model: {
      ...graph.simulation,
      nodes,
      ...(graph.simulation.processes
        ? { processes: graph.simulation.processes.filter((process) => processes.has(process.id)) }
        : {}),
      edges: graph.simulation.edges.filter(
        (edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId),
      ),
      resources: graph.simulation.resources.filter((resource) => resources.has(resource.id)),
      improvements: graph.simulation.improvements.filter(
        (feature) =>
          (feature.nodeId && ids.has(feature.nodeId)) ||
          (feature.resourceId && resources.has(feature.resourceId)),
      ),
      scenarios: [],
    },
  };
}

/** Copy processing assumptions and dependencies; shared resources stay shared within a document. */
export function pasteSimulationSelection(
  clip: SimulationClipboard,
  target: Graph,
  nodeIds: ReadonlyMap<string, string>,
  edgeIds: ReadonlyMap<string, string>,
): SimulationModel | undefined {
  if (!target.simulation) return;
  if (target.simulation.currency !== clip.model.currency)
    throw new StorageError(422, 'Copy simulation objects into a document with the same currency.');
  const sameDocument = clip.diagramId === target.diagram.id;
  const processIds = new Map(
    (clip.model.processes ?? []).map((process) => [
      process.id,
      sameDocument ? process.id : crypto.randomUUID(),
    ]),
  );
  const copied = remapSimulationModel(clip.model, nodeIds, edgeIds, processIds);
  const resourceIds = new Map(
    copied.resources.map((resource) => [
      resource.id,
      sameDocument ? resource.id : crypto.randomUUID(),
    ]),
  );
  const particleIds = new Map(
    copied.particleTypes.map((type) => [type.id, sameDocument ? type.id : crypto.randomUUID()]),
  );
  const availableNodes = new Set([
    ...target.simulation.nodes.map((node) => node.id),
    ...copied.nodes.map((node) => node.id),
  ]);
  const availableEdges = new Set([
    ...target.simulation.edges.map((edge) => edge.id),
    ...copied.edges.map((edge) => edge.id),
  ]);
  copied.nodes = copied.nodes.map((node) => {
    if (node.type === 'source')
      return {
        ...node,
        source: { ...node.source, particleTypeId: particleIds.get(node.source.particleTypeId)! },
      };
    if (node.type === 'resource') return { ...node, resourceId: resourceIds.get(node.resourceId)! };
    if (node.type === 'work')
      return {
        ...node,
        work: {
          ...node.work,
          ...(node.work.resourceRequirements
            ? {
                resourceRequirements: node.work.resourceRequirements.map((requirement) => ({
                  ...requirement,
                  resourceId: resourceIds.get(requirement.resourceId)!,
                })),
              }
            : {}),
          ...(node.work.acceptedParticleTypeIds
            ? {
                acceptedParticleTypeIds: node.work.acceptedParticleTypeIds.map(
                  (id) => particleIds.get(id)!,
                ),
              }
            : {}),
          overflowNodeId:
            node.work.overflowNodeId && availableNodes.has(node.work.overflowNodeId)
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
            node.router.fallbackEdgeId && availableEdges.has(node.router.fallbackEdgeId)
              ? node.router.fallbackEdgeId
              : undefined,
          rules: node.router.rules
            ?.filter(
              (rule) =>
                availableEdges.has(rule.edgeId) &&
                (!rule.condition ||
                  !('nodeId' in rule.condition) ||
                  !rule.condition.nodeId ||
                  availableNodes.has(rule.condition.nodeId)),
            )
            .map((rule) => ({
              ...rule,
              condition:
                rule.condition &&
                (rule.condition.field === 'particleTypeId'
                  ? { ...rule.condition, value: particleIds.get(rule.condition.value)! }
                  : 'resourceId' in rule.condition && rule.condition.resourceId
                    ? { ...rule.condition, resourceId: resourceIds.get(rule.condition.resourceId)! }
                    : rule.condition),
            })),
        },
      };
    return node;
  });
  return {
    ...target.simulation,
    ...(target.simulation.processes || copied.processes
      ? {
          processes: [
            ...(target.simulation.processes ?? []),
            ...(copied.processes ?? []).filter(
              (process) =>
                !target.simulation!.processes?.some((existing) => existing.id === process.id),
            ),
          ],
        }
      : {}),
    nodes: [...target.simulation.nodes, ...copied.nodes],
    edges: [
      ...target.simulation.edges,
      ...copied.edges.map((edge) => ({
        ...edge,
        ...(edge.particleTypeIds
          ? { particleTypeIds: edge.particleTypeIds.map((id) => particleIds.get(id)!) }
          : {}),
      })),
    ],
    resources: [
      ...target.simulation.resources,
      ...copied.resources
        .filter(
          (resource) =>
            !sameDocument ||
            !target.simulation!.resources.some((entry) => entry.id === resource.id),
        )
        .map((resource) => ({ ...resource, id: resourceIds.get(resource.id)! })),
    ],
    particleTypes: [
      ...target.simulation.particleTypes,
      ...copied.particleTypes
        .filter(
          (type) =>
            !sameDocument ||
            !target.simulation!.particleTypes.some((entry) => entry.id === type.id),
        )
        .map((type) => ({ ...type, id: particleIds.get(type.id)! })),
    ],
    improvements: [
      ...target.simulation.improvements,
      // Features of a shared resource already affect every consumer in this document.
      // Duplicating them would charge the investment and apply their effect twice.
      ...copied.improvements
        .filter((feature) => !sameDocument || !feature.resourceId)
        .map((feature) => ({
          ...feature,
          id: crypto.randomUUID(),
          nodeId: feature.nodeId && availableNodes.has(feature.nodeId) ? feature.nodeId : undefined,
          ...(feature.resourceId ? { resourceId: resourceIds.get(feature.resourceId)! } : {}),
          failureNodeId:
            feature.failureNodeId && availableNodes.has(feature.failureNodeId)
              ? feature.failureNodeId
              : undefined,
        })),
    ],
  };
}
