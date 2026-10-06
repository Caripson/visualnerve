import type { Graph } from '../model/types';
import { getCsvNode } from '../data/csv';
import {
  analysisLimits,
  validateExploration,
  type ExplorationResult,
  type RelationshipExploration,
} from './types';

export interface RelationshipGraph {
  nodes: { id: string; outsideView: boolean; parentId?: string; group: boolean; csv: boolean }[];
  edges: {
    id: string;
    source: string;
    target: string;
    direction: 'forward' | 'backward' | 'both' | 'none';
    outsideView?: boolean;
  }[];
}
export function relationshipGraph(graph: Graph): RelationshipGraph {
  const edges: RelationshipGraph['edges'] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    direction: edge.direction,
    outsideView: edge.metadata.csvModelVisible === false,
  }));
  if (graph.diagram.type === 'mindmap') {
    const pairs = new Set(
      edges.flatMap((edge) => [`${edge.source}:${edge.target}`, `${edge.target}:${edge.source}`]),
    );
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of graph.nodes)
      if (
        node.parentId &&
        !getCsvNode(node) &&
        byId.get(node.parentId)?.nodeType !== 'group' &&
        !pairs.has(`${node.parentId}:${node.id}`)
      )
        edges.push({
          id: `hierarchy:${node.id}`,
          source: node.parentId,
          target: node.id,
          direction: 'forward',
        });
  }
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      outsideView: getCsvNode(node)?.visible === false,
      parentId: node.parentId,
      group: node.nodeType === 'group',
      csv: !!getCsvNode(node),
    })),
    edges,
  };
}
export function exploreRelationships(
  graph: RelationshipGraph,
  config: RelationshipExploration,
): ExplorationResult {
  validateExploration(config);
  const allowed = new Map(
    graph.nodes
      .filter((node) => config.includeHidden || !node.outsideView)
      .map((node) => [node.id, node]),
  );
  const empty: ExplorationResult = {
    nodeIds: [],
    edgeIds: [],
    totalNodes: 0,
    truncated: false,
    found: false,
    outsideViewIds: [],
    outsideViewEdgeIds: [],
  };
  if (!allowed.has(config.startId) || (config.mode === 'path' && !allowed.has(config.targetId!)))
    return empty;
  const adjacency = new Map<string, { node: string; edge: string }[]>();
  const put = (source: string, target: string, edge: string) => {
    if (!allowed.has(source) || !allowed.has(target)) return;
    const entries = adjacency.get(source) ?? [];
    entries.push({ node: target, edge });
    adjacency.set(source, entries);
  };
  const undirected = config.mode === 'path' ? !config.directed : config.direction === 'all';
  for (const edge of graph.edges) {
    if (edge.outsideView && !config.includeHidden) continue;
    if (undirected) {
      put(edge.source, edge.target, edge.id);
      put(edge.target, edge.source, edge.id);
    } else {
      const incoming = config.mode === 'neighbors' && config.direction === 'incoming';
      if (edge.direction === 'forward' || edge.direction === 'both')
        put(incoming ? edge.target : edge.source, incoming ? edge.source : edge.target, edge.id);
      if (edge.direction === 'backward' || edge.direction === 'both')
        put(incoming ? edge.source : edge.target, incoming ? edge.target : edge.source, edge.id);
    }
  }
  const reached = new Map<string, { distance: number; previous?: string; edge?: string }>([
    [config.startId, { distance: 0 }],
  ]);
  const queue = [config.startId];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const distance = reached.get(current)!.distance;
    if (config.mode === 'path' && current === config.targetId) break;
    if (config.mode === 'neighbors' && distance >= config.steps) continue;
    for (const connection of adjacency.get(current) ?? []) {
      if (reached.has(connection.node)) continue;
      reached.set(connection.node, {
        distance: distance + 1,
        previous: current,
        edge: connection.edge,
      });
      queue.push(connection.node);
    }
  }
  let nodeIds: string[], edgeIds: string[];
  if (config.mode === 'path') {
    if (!reached.has(config.targetId!))
      return { ...empty, nodeIds: [config.startId], totalNodes: 1 };
    nodeIds = [];
    edgeIds = [];
    let current: string | undefined = config.targetId;
    while (current !== undefined) {
      nodeIds.push(current);
      const item = reached.get(current)!;
      if (item.edge) edgeIds.push(item.edge);
      current = item.previous;
    }
    nodeIds.reverse();
    edgeIds.reverse();
  } else {
    nodeIds = queue;
    const included = new Set(nodeIds);
    edgeIds = graph.edges
      .filter(
        (edge) =>
          (config.includeHidden || !edge.outsideView) &&
          included.has(edge.source) &&
          included.has(edge.target),
      )
      .map((edge) => edge.id);
  }
  const totalNodes = nodeIds.length;
  if (nodeIds.length > analysisLimits.visibleNodes) {
    // A path must never be shown as a falsely complete, disconnected prefix.
    if (config.mode === 'path') return { ...empty, totalNodes, truncated: true, found: true };
    nodeIds = nodeIds.slice(0, analysisLimits.visibleNodes);
  }
  const included = new Set(nodeIds);
  // Keep containing group frames, bounded by the same projection budget.
  for (const id of [...nodeIds]) {
    let parent = allowed.get(id)?.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const node = allowed.get(parent);
      if (!node?.group || included.size >= analysisLimits.visibleNodes) break;
      included.add(parent);
      parent = node.parentId;
    }
  }
  nodeIds = [...included];
  const edges = new Set(edgeIds);
  edgeIds = graph.edges
    .filter((edge) => edges.has(edge.id) && included.has(edge.source) && included.has(edge.target))
    .map((edge) => edge.id);
  const tooManyEdges = edgeIds.length > 2000;
  edgeIds = edgeIds.slice(0, 2000);
  const displayedEdges = new Set(edgeIds);
  return {
    nodeIds,
    edgeIds,
    totalNodes,
    truncated: totalNodes > analysisLimits.visibleNodes || tooManyEdges,
    found: true,
    outsideViewIds: nodeIds.filter((id) => allowed.get(id)?.outsideView),
    outsideViewEdgeIds: graph.edges
      .filter((edge) => edge.outsideView && displayedEdges.has(edge.id))
      .map((edge) => edge.id),
  };
}
