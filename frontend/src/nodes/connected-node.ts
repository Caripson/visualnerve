import { newEdge, newNode, type Graph, type GraphNode, type NodeKind } from '../model/types';
import { setSimulationModel } from '../simulation/document';
import type { SimulationNode } from '../simulation/types';

export type ConnectedNodeType = NodeKind | SimulationNode['type'];
export interface ConnectedNodeChoice {
  type: ConnectedNodeType;
  label: string;
  description: string;
}
const work: ConnectedNodeChoice = {
  type: 'work',
  label: 'Work step',
  description: 'Process work with a capacity and queue.',
};
const router: ConnectedNodeChoice = {
  type: 'router',
  label: 'Decision',
  description: 'Choose which path work follows.',
};
const outcome: ConnectedNodeChoice = {
  type: 'outcome',
  label: 'Outcome',
  description: 'Complete work and optionally realize revenue.',
};
const source: ConnectedNodeChoice = {
  type: 'source',
  label: 'Arrivals',
  description: 'Generate work that enters this step.',
};
const resource: ConnectedNodeChoice = {
  type: 'resource',
  label: 'Shared resource',
  description: 'Add staff or equipment required by this step.',
};

/** Only authoritative entities may be extended; visual capacity slots never become model nodes. */
export function connectedNodeChoices(graph: Graph, sourceId: string): ConnectedNodeChoice[] {
  const node = graph.nodes.find((item) => item.id === sourceId);
  if (!node || node.metadata.simulationProjected === true || graph.diagram.type === 'mindmap')
    return [];
  if (graph.simulation) {
    const semantic = graph.simulation.nodes.find((item) => item.id === sourceId);
    if (!semantic) return [];
    if (semantic.type === 'resource') return [work];
    if (semantic.type === 'outcome') {
      const incoming = graph.simulation.edges.some((edge) => edge.targetNodeId === sourceId);
      return [work, source, router].map((choice) =>
        incoming && choice.type !== 'source'
          ? { ...choice, label: `Insert ${choice.label.toLowerCase()}` }
          : choice,
      );
    }
    const outgoing = graph.simulation.edges.filter((edge) => edge.sourceNodeId === sourceId);
    const flow =
      semantic.type === 'router' || !outgoing.length ? [work, router, outcome] : [work, router];
    const next = semantic.type === 'work' ? [...flow, resource] : flow;
    return outgoing.length === 1 && semantic.type !== 'router'
      ? next.map((choice) =>
          choice.type === 'work' || choice.type === 'router'
            ? { ...choice, label: `Insert ${choice.label.toLowerCase()}` }
            : choice,
        )
      : next;
  }
  const main: ConnectedNodeChoice =
    graph.diagram.type === 'timeline'
      ? { type: 'timeline', label: 'Timeline item', description: 'Add the next event.' }
      : ['flowchart', 'process', 'responsibility'].includes(graph.diagram.type)
        ? { type: 'process', label: 'Process', description: 'Add the next step.' }
        : { type: 'generic', label: 'Node', description: 'Add a connected object.' };
  return [
    main,
    { type: 'decision', label: 'Decision', description: 'Add a branching point.' },
    { type: 'end', label: 'End', description: 'Add the final step.' },
    { type: 'note', label: 'Note', description: 'Attach an explanation.' },
  ];
}

function nextPosition(
  nodes: GraphNode[],
  anchor: GraphNode,
  width: number,
  height: number,
  direction: 'before' | 'after' | 'above',
) {
  const x =
    direction === 'before'
      ? anchor.x - width - 120
      : direction === 'above'
        ? anchor.x
        : anchor.x + anchor.width + 120;
  const startY = direction === 'above' ? anchor.y - height - 110 : anchor.y;
  const ancestors = new Set<string>();
  let parent = anchor.parentId;
  while (parent && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = nodes.find((node) => node.id === parent)?.parentId;
  }
  const obstacles = nodes.filter(
    (node) => !ancestors.has(node.id) && node.x < x + width + 28 && node.x + node.width + 28 > x,
  );
  for (let attempt = 0; attempt <= obstacles.length * 2 + 2; attempt++) {
    const row = attempt === 0 ? 0 : Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1);
    const y = startY + row * (height + 64);
    if (obstacles.every((node) => y + height + 28 <= node.y || y >= node.y + node.height + 28))
      return { x, y };
  }
  return { x, y: Math.max(startY, ...obstacles.map((node) => node.y + node.height + 64)) };
}

function nextName(graph: Graph, name: string) {
  const names = new Set(graph.nodes.map((node) => node.title));
  if (!names.has(name)) return name;
  let index = 2;
  while (names.has(`${name} ${index}`)) index++;
  return `${name} ${index}`;
}

/** Reserve a column for an inserted step so a forward process does not double back. */
function insertionLayout(graph: Graph, anchor: GraphNode, width: number, type: ConnectedNodeType) {
  const semantic = graph.simulation?.nodes.find((node) => node.id === anchor.id);
  const flowEdges = graph.simulation?.edges ?? [];
  const outgoing = flowEdges.filter((edge) => edge.sourceNodeId === anchor.id);
  let boundary: number | undefined;
  let destination: number | undefined;
  if (
    semantic?.type !== 'router' &&
    semantic?.type !== 'resource' &&
    semantic?.type !== 'outcome' &&
    type !== 'resource' &&
    outgoing.length === 1
  ) {
    const next = graph.nodes.find((node) => node.id === outgoing[0].targetNodeId);
    if (next && next.x > anchor.x) {
      boundary = next.x;
      destination = anchor.x + anchor.width + 120 + width + 120;
    }
  } else if (semantic?.type === 'outcome' && type !== 'source') {
    const predecessors = new Set(
      flowEdges.filter((edge) => edge.targetNodeId === anchor.id).map((edge) => edge.sourceNodeId),
    );
    const preceding = graph.nodes.filter((node) => predecessors.has(node.id) && node.x < anchor.x);
    if (preceding.length) {
      boundary = anchor.x;
      destination = Math.max(...preceding.map((node) => node.x + node.width)) + 120 + width + 120;
    }
  }
  if (boundary === undefined || destination === undefined || destination <= boundary)
    return { nodes: graph.nodes, anchor };
  const delta = destination - boundary;
  const nodes = graph.nodes.map((node) =>
    node.x >= boundary && node.nodeType !== 'group' ? { ...node, x: node.x + delta } : node,
  );
  return { nodes, anchor: nodes.find((node) => node.id === anchor.id)! };
}

/** One complete graph change supplies the existing command/history/persistence boundary. */
export function addConnectedNode(
  graph: Graph,
  sourceId: string,
  requested?: ConnectedNodeType,
): { graph: Graph; nodeId: string } | undefined {
  const choices = connectedNodeChoices(graph, sourceId);
  const choice = requested ? choices.find((item) => item.type === requested) : choices[0];
  if (!choice) return;
  const anchor = graph.nodes.find((node) => node.id === sourceId)!;
  const semantic = graph.simulation?.nodes.find((node) => node.id === sourceId);
  const incoming = semantic?.type === 'outcome';
  const above = choice.type === 'resource';
  const simulation = !!graph.simulation;
  const width = simulation ? 250 : 200;
  const height = simulation
    ? choice.type === 'work'
      ? 240
      : choice.type === 'resource'
        ? 210
        : 170
    : 100;
  const placement = simulation
    ? insertionLayout(graph, anchor, width, choice.type)
    : { nodes: graph.nodes, anchor };
  const kind = simulation
    ? ({ source: 'start', work: 'process', router: 'decision', outcome: 'end', resource: 'system' }[
        choice.type as SimulationNode['type']
      ] as NodeKind)
    : (choice.type as NodeKind);
  const name = simulation
    ? { work, router, outcome, source, resource }[choice.type as SimulationNode['type']].label
    : choice.label;
  const node = newNode(graph.diagram.id, {
    title: nextName(graph, name),
    nodeType: kind,
    width,
    height,
    color: anchor.color,
    parentId: anchor.parentId,
    ...nextPosition(
      placement.nodes,
      placement.anchor,
      width,
      height,
      above ? 'above' : incoming ? 'before' : 'after',
    ),
  });
  if (!graph.simulation) {
    const edge = newEdge(graph.diagram.id, anchor.id, node.id);
    return {
      nodeId: node.id,
      graph: { ...graph, nodes: [...graph.nodes, node], edges: [...graph.edges, edge] },
    };
  }
  const model = graph.simulation;
  const common = {
    id: node.id,
    name: node.title,
    ...(semantic?.processId ? { processId: semantic.processId } : {}),
  };
  let addition: SimulationNode;
  let resources = model.resources;
  let particleTypes = model.particleTypes;
  let nodes = model.nodes;
  if (choice.type === 'resource') {
    const resourceId = crypto.randomUUID();
    resources = [
      ...resources,
      { id: resourceId, name: node.title, capacity: 1, unit: 'capacity units' },
    ];
    addition = { ...common, type: 'resource', resourceId };
    nodes = nodes.map((item) =>
      item.id === sourceId && item.type === 'work'
        ? {
            ...item,
            work: {
              ...item.work,
              resourceRequirements: [
                ...(item.work.resourceRequirements ?? []),
                { resourceId, units: 1 },
              ],
            },
          }
        : item,
    );
  } else if (choice.type === 'source') {
    if (!particleTypes.length)
      particleTypes = [
        {
          id: crypto.randomUUID(),
          name: 'Work item',
          color: '#538971',
          revenue: 0,
          complexity: { min: 1, max: 1 },
          priority: 0,
        },
      ];
    addition = {
      ...common,
      type: 'source',
      source: { particleTypeId: particleTypes[0].id, ratePerHour: 10, distribution: 'regular' },
    };
  } else if (choice.type === 'work')
    addition = {
      ...common,
      type: 'work',
      work: {
        capacity: 1,
        processingSeconds: 60,
        queueDiscipline: 'fifo',
        ...(semantic?.type === 'resource'
          ? { resourceRequirements: [{ resourceId: semantic.resourceId, units: 1 }] }
          : {}),
      },
    };
  else if (choice.type === 'router')
    addition = { ...common, type: 'router', router: { mode: 'weighted' } };
  else addition = { ...common, type: 'outcome', outcome: { status: 'completed', revenue: true } };
  const flow = addition.type !== 'resource' && semantic?.type !== 'resource';
  const outgoing = model.edges.filter((edge) => edge.sourceNodeId === sourceId);
  const insertingAfter = flow && !incoming && semantic?.type !== 'router' && outgoing.length === 1;
  const incomingEdges = model.edges.filter((edge) => edge.targetNodeId === sourceId);
  const insertingBefore = incoming && addition.type !== 'source' && !!incomingEdges.length;
  const edge = flow
    ? newEdge(
        graph.diagram.id,
        incoming ? node.id : insertingAfter ? node.id : sourceId,
        incoming ? sourceId : insertingAfter ? outgoing[0].targetNodeId : node.id,
        { edgeType: 'simulation-flow' },
      )
    : undefined;
  const updatedEdges = model.edges.map((item) =>
    insertingAfter && item.id === outgoing[0].id
      ? { ...item, targetNodeId: node.id }
      : insertingBefore && item.targetNodeId === sourceId
        ? { ...item, targetNodeId: node.id }
        : item,
  );
  const updatedById = new Map(updatedEdges.map((item) => [item.id, item]));
  const shapeEdges = graph.edges.map((item) => {
    const semanticEdge = updatedById.get(item.id);
    return semanticEdge
      ? {
          ...item,
          sourceNodeId: semanticEdge.sourceNodeId,
          targetNodeId: semanticEdge.targetNodeId,
        }
      : item;
  });
  return {
    nodeId: node.id,
    graph: setSimulationModel(
      {
        ...graph,
        nodes: [...placement.nodes, node],
        edges: edge ? [...shapeEdges, edge] : shapeEdges,
      },
      {
        ...model,
        nodes: [...nodes, addition],
        resources,
        particleTypes,
        edges: edge
          ? [
              ...updatedEdges,
              {
                id: edge.id,
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: edge.targetNodeId,
                travelSeconds: 3,
              },
            ]
          : updatedEdges,
      },
    ),
  };
}
