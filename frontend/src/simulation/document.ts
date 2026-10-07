import { blankGraph, newEdge, newNode, type Graph, type GraphNode } from '../model/types';
import { StorageError } from '../model/errors';
import { createKioskModel } from './examples';
import { remapSimulationModel } from './copy';
import { validateSimulationModel } from './schema';
import { pruneSimulationReferences } from './deletion';
import type { SimulationModel, SimulationNode } from './types';

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const annotations = new Set(['note', 'group']);
const kind = (node: SimulationNode): GraphNode['nodeType'] =>
  ({ source: 'start', work: 'process', router: 'decision', resource: 'system', outcome: 'end' })[
    node.type
  ] as GraphNode['nodeType'];

/** Semantic edits produce matching canvas entities while retaining their placement/style. */
export function setSimulationModel(graph: Graph, input: SimulationModel): Graph {
  validateSimulationModel(input);
  const previousNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeAliases = new Map(
    graph.nodes.filter((node) => node.externalId).map((node) => [node.externalId!, node.id]),
  );
  const previousEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edgeAliases = new Map(
    graph.edges.filter((edge) => edge.externalId).map((edge) => [edge.externalId!, edge.id]),
  );
  const nodeIds = new Map(
    input.nodes.map((node) => [
      node.id,
      previousNodes.has(node.id)
        ? node.id
        : (nodeAliases.get(node.id) ?? (uuid.test(node.id) ? node.id : crypto.randomUUID())),
    ]),
  );
  const edgeIds = new Map(
    input.edges.map((edge) => [
      edge.id,
      previousEdges.has(edge.id)
        ? edge.id
        : (edgeAliases.get(edge.id) ?? (uuid.test(edge.id) ? edge.id : crypto.randomUUID())),
    ]),
  );
  const unchangedIds =
    input.nodes.every((node) => nodeIds.get(node.id) === node.id) &&
    input.edges.every((edge) => edgeIds.get(edge.id) === edge.id);
  const model = unchangedIds ? input : remapSimulationModel(input, nodeIds, edgeIds);
  validateSimulationModel(model);
  const semanticNodes = model.nodes.map((node, index) => {
    const previous = previousNodes.get(node.id);
    const alias = input.nodes[index].id;
    const title = node.name;
    const nodeType = kind(node);
    if (
      previous &&
      previous.title === title &&
      previous.description === node.description &&
      previous.nodeType === nodeType
    )
      return previous;
    return {
      ...(previous ??
        newNode(graph.diagram.id, {
          id: node.id,
          externalId: uuid.test(alias) ? undefined : alias,
          x: (index % 4) * 280,
          y: Math.floor(index / 4) * 180,
          width: model.processes?.length ? 250 : 220,
          height: model.processes?.length
            ? node.type === 'work'
              ? 240
              : node.type === 'resource'
                ? 210
                : 170
            : node.type === 'work' || node.type === 'resource'
              ? 170
              : 130,
        })),
      title,
      description: node.description,
      nodeType,
    };
  });
  const semanticIds = new Set(model.nodes.map((node) => node.id));
  const nodes = [
    ...semanticNodes,
    ...graph.nodes.filter((node) => annotations.has(node.nodeType) && !semanticIds.has(node.id)),
  ];
  const edges = model.edges.map((edge, index) => {
    const previous = previousEdges.get(edge.id);
    if (
      previous &&
      previous.sourceNodeId === edge.sourceNodeId &&
      previous.targetNodeId === edge.targetNodeId &&
      previous.direction === 'forward'
    )
      return previous;
    return {
      ...(previous ??
        newEdge(graph.diagram.id, edge.sourceNodeId, edge.targetNodeId, {
          id: edge.id,
          externalId: uuid.test(input.edges[index].id) ? undefined : input.edges[index].id,
          edgeType: 'simulation-flow',
        })),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      direction: 'forward' as const,
    };
  });
  const resourceNodes = new Map(
    model.nodes
      .filter((node) => node.type === 'resource')
      .map((node) => [node.resourceId, node.id]),
  );
  for (const node of model.nodes)
    if (node.type === 'work')
      for (const requirement of node.work.resourceRequirements ?? []) {
        const source = resourceNodes.get(requirement.resourceId);
        if (!source) continue;
        const alias = `sim-resource:${source}:${node.id}`;
        const previous = graph.edges.find(
          (edge) =>
            edge.edgeType === 'simulation-resource' &&
            edge.sourceNodeId === source &&
            edge.targetNodeId === node.id,
        );
        const label = `${requirement.units} ${model.resources.find((resource) => resource.id === requirement.resourceId)?.unit ?? 'units'}`;
        edges.push(
          previous
            ? previous.label === label
              ? previous
              : { ...previous, label }
            : newEdge(graph.diagram.id, source, node.id, {
                externalId: alias,
                edgeType: 'simulation-resource',
                style: 'dashed',
                label,
              }),
        );
      }
  return {
    ...graph,
    diagram: { ...graph.diagram, type: 'process-simulator' },
    simulation: model,
    nodes,
    edges,
  };
}

export function createSimulationGraph(
  name = 'Process Simulator',
  model = createKioskModel(),
): Graph {
  const graph = setSimulationModel(blankGraph(name, 'process-simulator'), model);
  const kioskPositions: Record<string, { x: number; y: number }> = {
    'core-source': { x: 40, y: 200 },
    'core-sales': { x: 380, y: 200 },
    'core-revenue': { x: 740, y: 200 },
    'package-source': { x: 40, y: 430 },
    'package-counter': { x: 380, y: 430 },
    'package-revenue': { x: 740, y: 430 },
    'staff-display': { x: 260, y: -50 },
    'counter-display': { x: 560, y: -50 },
  };
  if (
    graph.nodes.some((node) => node.externalId === 'core-source') &&
    graph.nodes.some((node) => node.externalId === 'package-source')
  )
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      ...(node.externalId ? kioskPositions[node.externalId] : undefined),
    }));
  return graph;
}

/** Common canvas edits and semantic API edits both cross this document boundary. */
export function reconcileSimulationGraph(previous: Graph | undefined, next: Graph): Graph {
  if (next.diagram.type !== 'process-simulator') {
    if (next.simulation)
      throw new StorageError(422, 'Simulation data requires a Process Simulator document.');
    return next;
  }
  if (!next.simulation)
    throw new StorageError(422, 'Process Simulator requires its semantic model.');
  if (
    !previous?.simulation ||
    JSON.stringify(previous.simulation) !== JSON.stringify(next.simulation)
  )
    return setSimulationModel(next, next.simulation);
  const shapeIds = new Set(next.nodes.map((node) => node.id));
  const shapeById = new Map(next.nodes.map((node) => [node.id, node]));
  let nodes = next.simulation.nodes.filter((node) => shapeIds.has(node.id));
  const resources = [...next.simulation.resources];
  const removedResources = previous.simulation.nodes.filter(
    (node) => node.type === 'resource' && !shapeIds.has(node.id),
  );
  for (const removed of removedResources)
    if (
      removed.type === 'resource' &&
      !nodes.some((node) => node.type === 'resource' && node.resourceId === removed.resourceId)
    ) {
      if (
        nodes.some(
          (node) =>
            node.type === 'work' &&
            node.work.resourceRequirements?.some(
              (requirement) => requirement.resourceId === removed.resourceId,
            ),
        )
      )
        throw new StorageError(
          422,
          'Disconnect this shared resource from its Work nodes before deleting it.',
        );
      const index = resources.findIndex((resource) => resource.id === removed.resourceId);
      if (index >= 0) resources.splice(index, 1);
    }
  const particleTypes = [...next.simulation.particleTypes];
  const known = new Set(nodes.map((node) => node.id));
  for (const shape of next.nodes)
    if (!known.has(shape.id) && !annotations.has(shape.nodeType)) {
      const common = { id: shape.id, name: shape.title, description: shape.description };
      if (shape.nodeType === 'start') {
        if (!particleTypes.length)
          particleTypes.push({
            id: crypto.randomUUID(),
            name: 'Work item',
            color: '#538971',
            revenue: 0,
            complexity: { min: 1, max: 1 },
            priority: 0,
          });
        nodes.push({
          ...common,
          type: 'source',
          source: { particleTypeId: particleTypes[0].id, ratePerHour: 10, distribution: 'regular' },
        });
      } else if (shape.nodeType === 'decision')
        nodes.push({ ...common, type: 'router', router: { mode: 'weighted' } });
      else if (shape.nodeType === 'end' || shape.nodeType === 'output')
        nodes.push({ ...common, type: 'outcome', outcome: { status: 'completed', revenue: true } });
      else
        nodes.push({
          ...common,
          type: 'work',
          work: { processingSeconds: 60, capacity: 1, queueDiscipline: 'fifo' },
        });
    }
  nodes = nodes.map((node) => ({
    ...node,
    name: shapeById.get(node.id)!.title,
    description: shapeById.get(node.id)!.description,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const bindings = new Map<string, Set<string>>();
  const oldBindings = new Map<string, Set<string>>();
  const readBindings = (graph: Graph, target: Map<string, Set<string>>) => {
    for (const edge of graph.edges) {
      const a = byId.get(edge.sourceNodeId),
        b = byId.get(edge.targetNodeId);
      const resource = a?.type === 'resource' ? a : b?.type === 'resource' ? b : undefined;
      const work = a?.type === 'work' ? a : b?.type === 'work' ? b : undefined;
      if (resource && work) {
        const set = target.get(work.id) ?? new Set();
        set.add(resource.resourceId);
        target.set(work.id, set);
      }
    }
  };
  readBindings(previous, oldBindings);
  readBindings(next, bindings);
  nodes = nodes.map((node) => {
    if (node.type !== 'work') return node;
    if (!oldBindings.has(node.id) && !bindings.has(node.id)) return node;
    const requirements = (node.work.resourceRequirements ?? []).filter(
      (requirement) =>
        !oldBindings.get(node.id)?.has(requirement.resourceId) ||
        bindings.get(node.id)?.has(requirement.resourceId),
    );
    for (const id of bindings.get(node.id) ?? [])
      if (!requirements.some((requirement) => requirement.resourceId === id))
        requirements.push({ resourceId: id, units: 1 });
    return { ...node, work: { ...node.work, resourceRequirements: requirements } };
  });
  const previousEdges = new Map(next.simulation.edges.map((edge) => [edge.id, edge]));
  const edges = next.edges
    .filter(
      (edge) =>
        byId.has(edge.sourceNodeId) &&
        byId.has(edge.targetNodeId) &&
        byId.get(edge.sourceNodeId)!.type !== 'resource' &&
        byId.get(edge.targetNodeId)!.type !== 'resource',
    )
    .map((edge) => ({
      ...previousEdges.get(edge.id),
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    }));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  nodes = nodes.map((node) =>
    node.type === 'router'
      ? {
          ...node,
          router: {
            ...node.router,
            rules: node.router.rules?.filter((rule) => edgeIds.has(rule.edgeId)),
            fallbackEdgeId:
              node.router.fallbackEdgeId && edgeIds.has(node.router.fallbackEdgeId)
                ? node.router.fallbackEdgeId
                : undefined,
          },
        }
      : node,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const model: SimulationModel = {
    ...next.simulation,
    nodes,
    edges,
    resources,
    particleTypes,
    improvements: next.simulation.improvements.filter(
      (feature) =>
        (!feature.nodeId || nodeIds.has(feature.nodeId)) &&
        (!feature.resourceId || resourceIds.has(feature.resourceId)),
    ),
    scenarios: next.simulation.scenarios.map((scenario) => ({
      ...scenario,
      overrides: {
        ...scenario.overrides,
        ...(scenario.overrides.nodes
          ? {
              nodes: Object.fromEntries(
                Object.entries(scenario.overrides.nodes).filter(([id]) => nodeIds.has(id)),
              ),
            }
          : {}),
        ...(scenario.overrides.edges
          ? {
              edges: Object.fromEntries(
                Object.entries(scenario.overrides.edges).filter(([id]) => edgeIds.has(id)),
              ),
            }
          : {}),
        ...(scenario.overrides.resources
          ? {
              resources: Object.fromEntries(
                Object.entries(scenario.overrides.resources).filter(([id]) => resourceIds.has(id)),
              ),
            }
          : {}),
      },
    })),
  };
  const unchanged = JSON.stringify(model) === JSON.stringify(next.simulation);
  return setSimulationModel(next, unchanged ? next.simulation : pruneSimulationReferences(model));
}

export function validateSimulationGraph(graph: Graph) {
  if (graph.diagram.type !== 'process-simulator') {
    if (graph.simulation !== undefined)
      throw new StorageError(422, 'Simulation data requires a Process Simulator document.');
    return;
  }
  validateSimulationModel(graph.simulation);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  for (const node of graph.simulation.nodes)
    if (!nodes.has(node.id))
      throw new StorageError(422, 'Simulation node has no matching diagram object.');
  for (const edge of graph.simulation.edges) {
    const shape = edges.get(edge.id);
    if (
      !shape ||
      shape.sourceNodeId !== edge.sourceNodeId ||
      shape.targetNodeId !== edge.targetNodeId
    )
      throw new StorageError(422, 'Simulation connection does not match its diagram connection.');
  }
}
