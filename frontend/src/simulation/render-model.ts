import type { Graph, GraphEdge } from '../model/types';
import type { Improvement, RunOptions, SimulationModel } from './types';
import { resolveScenario } from './schema';
export {
  projectSimulationCapacityNodes,
  logicalNodeId,
  getSimulationCapacityCard,
  MAX_CAPACITY_CARDS_PER_BANK,
  MAX_ADDITIONAL_CAPACITY_CARDS,
} from './capacity-projection';
export type {
  SimulationCapacityGroup,
  SimulationCapacityCard,
  SimulationCapacityProjection,
} from './capacity-projection';

export interface SimulationRenderRun {
  model: SimulationModel;
  options: RunOptions;
}
export interface SimulationRenderProjection {
  model: SimulationModel;
  edges: GraphEdge[];
  resourceEdges: GraphEdge[];
}
const resolvedModels = new WeakMap<SimulationModel, Map<string, SimulationModel>>();
const projections = new WeakMap<Graph, WeakMap<SimulationModel, SimulationRenderProjection>>();
const MAX_RESOLVED_VIEWS_PER_MODEL = 24;

/** Cache effective semantics independently of clock updates and particle rendering. */
export function resolveSimulationRenderModel(model: SimulationModel, options?: RunOptions) {
  if (!options?.scenarioId && options?.demandMultiplier === undefined) return model;
  const key = JSON.stringify([options.scenarioId ?? null, options.demandMultiplier ?? null]);
  let cache = resolvedModels.get(model);
  if (!cache) resolvedModels.set(model, (cache = new Map()));
  let resolved = cache.get(key);
  if (!resolved) {
    resolved = resolveScenario(model, options.scenarioId, options.demandMultiplier);
    cache.set(key, resolved);
    if (cache.size > MAX_RESOLVED_VIEWS_PER_MODEL) cache.delete(cache.keys().next().value!);
  }
  return resolved;
}

/** Resource links are a read-only view of the frozen run; native flow geometry stays intact. */
export function projectSimulationRenderModel(
  graph: Graph,
  run?: SimulationRenderRun,
): SimulationRenderProjection {
  const source = run?.model ?? graph.simulation;
  if (!source) throw new Error('Resource projection requires a Process Simulator model.');
  const model = resolveSimulationRenderModel(source, run?.options);
  if (!run)
    return {
      model,
      edges: graph.edges,
      resourceEdges: graph.edges.filter((edge) => edge.edgeType === 'simulation-resource'),
    };
  let cache = projections.get(graph);
  if (!cache) projections.set(graph, (cache = new WeakMap()));
  const cached = cache.get(model);
  if (cached) return cached;
  const visibleIds = new Set(graph.nodes.map((node) => node.id));
  const resourceNodes = new Map<string, string[]>();
  for (const node of model.nodes)
    if (node.type === 'resource' && visibleIds.has(node.id))
      resourceNodes.set(node.resourceId, [...(resourceNodes.get(node.resourceId) ?? []), node.id]);
  const resources = new Map(model.resources.map((resource) => [resource.id, resource]));
  const nodeFeatures = new Map<string, Improvement[]>(),
    resourceFeatures = new Map<string, Improvement[]>();
  for (const feature of model.improvements)
    if (feature.enabled) {
      if (feature.nodeId)
        nodeFeatures.set(feature.nodeId, [...(nodeFeatures.get(feature.nodeId) ?? []), feature]);
      if (feature.resourceId)
        resourceFeatures.set(feature.resourceId, [
          ...(resourceFeatures.get(feature.resourceId) ?? []),
          feature,
        ]);
    }
  const previous = new Map(
    graph.edges
      .filter((edge) => edge.edgeType === 'simulation-resource')
      .map((edge) => [`${edge.sourceNodeId}:${edge.targetNodeId}`, edge]),
  );
  const resourceEdges: GraphEdge[] = [];
  for (const node of model.nodes)
    if (node.type === 'work' && visibleIds.has(node.id))
      for (const requirement of node.work.resourceRequirements ?? [])
        for (const sourceNodeId of resourceNodes.get(requirement.resourceId) ?? []) {
          const native = previous.get(`${sourceNodeId}:${node.id}`);
          const features = new Set([
            ...(nodeFeatures.get(node.id) ?? []),
            ...(resourceFeatures.get(requirement.resourceId) ?? []),
          ]);
          const units =
            requirement.units *
            [...features].reduce(
              (multiplier, feature) => multiplier * (feature.resourceUnitsMultiplier ?? 1),
              1,
            );
          resourceEdges.push({
            ...(native ?? {
              id: `simulation-resource-view:${sourceNodeId}:${node.id}`,
              version: graph.diagram.version,
              createdAt: graph.diagram.createdAt,
              updatedAt: graph.diagram.updatedAt,
              diagramId: graph.diagram.id,
              sourceNodeId,
              targetNodeId: node.id,
              edgeType: 'simulation-resource',
              direction: 'forward',
              style: 'dashed',
              metadata: {},
            }),
            label: `${Number(units.toPrecision(12))} ${resources.get(requirement.resourceId)?.unit ?? 'units'}`,
            metadata: {
              ...native?.metadata,
              simulationProjected: true,
              simulationResourceId: requirement.resourceId,
              simulationResourceUnits: units,
            },
          });
        }
  const projection = {
    model,
    edges: [
      ...graph.edges.filter((edge) => edge.edgeType !== 'simulation-resource'),
      ...resourceEdges,
    ],
    resourceEdges,
  };
  cache.set(model, projection);
  return projection;
}
