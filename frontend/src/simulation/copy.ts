import type {
  Improvement,
  SimulationEdge,
  SimulationModel,
  SimulationNode,
  ScenarioPatch,
} from './types';

/** Remap semantic references with the same identity map as the document shapes. */
export function remapSimulationModel(
  model: SimulationModel,
  nodeIds: ReadonlyMap<string, string>,
  edgeIds: ReadonlyMap<string, string>,
): SimulationModel {
  const nodeId = (id: string) => nodeIds.get(id) ?? id;
  const edgeId = (id: string) => edgeIds.get(id) ?? id;
  const node = <T extends SimulationNode | ScenarioPatch<SimulationNode>>(input: T): T => {
    const result = structuredClone(input);
    if (result.id) result.id = nodeId(result.id);
    if ('work' in result && result.work?.overflowNodeId)
      result.work.overflowNodeId = nodeId(result.work.overflowNodeId);
    if ('router' in result && result.router) {
      if (result.router.fallbackEdgeId)
        result.router.fallbackEdgeId = edgeId(result.router.fallbackEdgeId);
      for (const rule of result.router.rules ?? []) {
        rule.edgeId = edgeId(rule.edgeId);
        if (rule.condition && 'nodeId' in rule.condition && rule.condition.nodeId)
          rule.condition.nodeId = nodeId(rule.condition.nodeId);
      }
    }
    return result;
  };
  const edge = <T extends SimulationEdge | ScenarioPatch<SimulationEdge>>(input: T): T => {
    const result = structuredClone(input);
    if (result.id) result.id = edgeId(result.id);
    if (result.sourceNodeId) result.sourceNodeId = nodeId(result.sourceNodeId);
    if (result.targetNodeId) result.targetNodeId = nodeId(result.targetNodeId);
    return result;
  };
  const improvement = <T extends Improvement | ScenarioPatch<Improvement>>(input: T): T => ({
    ...input,
    ...(input.nodeId ? { nodeId: nodeId(input.nodeId) } : {}),
    ...(input.failureNodeId ? { failureNodeId: nodeId(input.failureNodeId) } : {}),
  });
  const record = <T>(
    values: Record<string, T> | undefined,
    identity: (id: string) => string,
    convert: (value: T) => T,
  ) =>
    values &&
    Object.fromEntries(Object.entries(values).map(([id, value]) => [identity(id), convert(value)]));
  return {
    ...structuredClone(model),
    nodes: model.nodes.map(node),
    edges: model.edges.map(edge),
    improvements: model.improvements.map(improvement),
    scenarios: model.scenarios.map((scenario) => ({
      ...structuredClone(scenario),
      overrides: {
        ...structuredClone(scenario.overrides),
        ...(scenario.overrides.nodes
          ? { nodes: record(scenario.overrides.nodes, nodeId, node) }
          : {}),
        ...(scenario.overrides.edges
          ? { edges: record(scenario.overrides.edges, edgeId, edge) }
          : {}),
        ...(scenario.overrides.improvements
          ? { improvements: record(scenario.overrides.improvements, (id) => id, improvement) }
          : {}),
      },
    })),
  };
}
