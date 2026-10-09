import { newEdge, newNode, type Graph, type GraphNode } from '../model/types';
import { setSimulationModel } from '../simulation/document';
import { ParallelFlowDraft } from '../simulation/editor/parallel-flow-draft';
import { parallelLimits } from '../simulation/parallel-topology';
import type { SimulationNode } from '../simulation/types';

const gap = 120;
const width = 250;
const workHeight = 240;
const syncHeight = 170;
const laneGap = 64;
type Addition = { graph: Graph; nodeId: string };

function card(graph: Graph, node: SimulationNode, anchor: GraphNode, x: number, y: number) {
  return newNode(graph.diagram.id, {
    id: node.id,
    title: node.name,
    nodeType: node.type === 'work' ? 'process' : 'decision',
    width,
    height: node.type === 'work' ? workHeight : syncHeight,
    color: anchor.color,
    parentId: anchor.parentId,
    // Carry authored visual identity, without duplicating a fixed 3D position or
    // simulation projection metadata onto a new authoritative process object.
    metadata: anchor.metadata.visualNerve
      ? { visualNerve: structuredClone(anchor.metadata.visualNerve) }
      : {},
    x,
    y,
  });
}

/** Parallel quick-add is one semantic graph edit in both 2D and 3D. */
export class ParallelConnectedNodes {
  insert(graph: Graph, sourceId: string): Addition | undefined {
    const model = graph.simulation;
    const anchor = graph.nodes.find((node) => node.id === sourceId);
    const semantic = model?.nodes.find((node) => node.id === sourceId);
    if (!model || !anchor || !semantic || !['source', 'work', 'join'].includes(semantic.type))
      return;
    const outgoing = model.edges.filter((edge) => edge.sourceNodeId === sourceId);
    if (outgoing.length > 1) return;
    const draft = new ParallelFlowDraft().add(model, semantic.processId);
    const fork = draft.model.nodes.find((node) => node.id === draft.id)!;
    if (fork.type !== 'fork') return;
    const join = draft.model.nodes.find((node) => node.id === fork.fork.joinNodeId)!;
    const oldIds = new Set(model.nodes.map((node) => node.id));
    const branches = draft.model.nodes.filter(
      (node) => !oldIds.has(node.id) && node.type === 'work',
    );
    const forkX = anchor.x + anchor.width + gap;
    const workX = forkX + width + gap;
    const joinX = workX + width + gap;
    const centerY = anchor.y + anchor.height / 2;
    const nextX = joinX + width + gap;
    const downstream = graph.nodes.find((node) => node.id === outgoing[0]?.targetNodeId);
    const boundary = downstream && downstream.x > anchor.x ? downstream.x : forkX;
    const shift = Math.max(0, nextX - boundary);
    const nodes = graph.nodes.map((node) =>
      node.id !== anchor.id && node.nodeType !== 'group' && node.x >= boundary
        ? { ...node, x: node.x + shift }
        : node,
    );
    const cards = [
      card(graph, fork, anchor, forkX, centerY - syncHeight / 2),
      ...branches.map((branch, index) =>
        card(
          graph,
          branch,
          anchor,
          workX,
          centerY + (index - (branches.length - 1) / 2) * (workHeight + laneGap) - workHeight / 2,
        ),
      ),
      card(graph, join, anchor, joinX, centerY - syncHeight / 2),
    ];
    const edge = newEdge(graph.diagram.id, sourceId, fork.id, { edgeType: 'simulation-flow' });
    return {
      nodeId: fork.id,
      graph: setSimulationModel(
        { ...graph, nodes: [...nodes, ...cards], edges: [...graph.edges, edge] },
        {
          ...draft.model,
          edges: [
            ...draft.model.edges.map((item) =>
              item.id === outgoing[0]?.id ? { ...item, sourceNodeId: join.id } : item,
            ),
            { id: edge.id, sourceNodeId: sourceId, targetNodeId: fork.id, travelSeconds: 3 },
          ],
        },
      ),
    };
  }

  addBranch(graph: Graph, forkId: string): Addition | undefined {
    const model = graph.simulation;
    const fork = model?.nodes.find((node) => node.id === forkId);
    const anchor = graph.nodes.find((node) => node.id === forkId);
    if (!model || !anchor || fork?.type !== 'fork') return;
    const join = model.nodes.find((node) => node.id === fork.fork.joinNodeId);
    const joinCard = graph.nodes.find((node) => node.id === join?.id);
    if (
      join?.type !== 'join' ||
      !joinCard ||
      fork.fork.branchEdgeIds.length >= parallelLimits.branches
    )
      return;
    const branchIds = new Set(
      model.edges.filter((edge) => edge.sourceNodeId === forkId).map((edge) => edge.targetNodeId),
    );
    const lanes = graph.nodes.filter((node) => branchIds.has(node.id));
    const work: SimulationNode = {
      id: crypto.randomUUID(),
      name: `Parallel task ${fork.fork.branchEdgeIds.length + 1}`,
      type: 'work',
      ...(fork.processId ? { processId: fork.processId } : {}),
      work: { capacity: 1, processingSeconds: 60 },
    };
    const workX = anchor.x + anchor.width + gap;
    let y = Math.max(anchor.y, ...lanes.map((node) => node.y + node.height)) + laneGap;
    const obstacles = graph.nodes.filter((node) => node.nodeType !== 'group');
    while (
      obstacles.some(
        (node) =>
          workX < node.x + node.width + 28 &&
          workX + width + 28 > node.x &&
          y < node.y + node.height + 28 &&
          y + workHeight + 28 > node.y,
      )
    )
      y += workHeight + laneGap;
    const nextJoinX = Math.max(
      joinCard.x,
      workX + width + gap,
      ...lanes.map((node) => node.x + node.width + gap),
    );
    const shift = nextJoinX - joinCard.x;
    const downstreamIds = new Set([join.id]);
    const todo = [join.id];
    const outgoingById = new Map<string, string[]>();
    for (const edge of model.edges) {
      const targets = outgoingById.get(edge.sourceNodeId) ?? [];
      targets.push(edge.targetNodeId);
      outgoingById.set(edge.sourceNodeId, targets);
    }
    for (let index = 0; index < todo.length; index++)
      for (const target of outgoingById.get(todo[index]) ?? [])
        if (!downstreamIds.has(target)) {
          downstreamIds.add(target);
          todo.push(target);
        }
    const nodes = graph.nodes.map((node) =>
      shift > 0 && downstreamIds.has(node.id) ? { ...node, x: node.x + shift } : node,
    );
    const branch = card(graph, work, anchor, workX, y);
    const into = newEdge(graph.diagram.id, forkId, work.id, { edgeType: 'simulation-flow' });
    const out = newEdge(graph.diagram.id, work.id, join.id, { edgeType: 'simulation-flow' });
    return {
      nodeId: work.id,
      graph: setSimulationModel(
        { ...graph, nodes: [...nodes, branch], edges: [...graph.edges, into, out] },
        {
          ...model,
          nodes: [
            ...model.nodes.map((node) =>
              node.id === forkId && node.type === 'fork'
                ? {
                    ...node,
                    fork: { ...node.fork, branchEdgeIds: [...node.fork.branchEdgeIds, into.id] },
                  }
                : node,
            ),
            work,
          ],
          edges: [
            ...model.edges,
            { id: into.id, sourceNodeId: forkId, targetNodeId: work.id, travelSeconds: 0 },
            { id: out.id, sourceNodeId: work.id, targetNodeId: join.id, travelSeconds: 0 },
          ],
        },
      ),
    };
  }
}
