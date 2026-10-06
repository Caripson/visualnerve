import type { Edge } from '@xyflow/react';
import type { Graph } from '../model/types';
import { emptyFilters } from '../model/types';
import { projectGraph, type CanvasNode } from '../canvas/projection';
import { getExploration } from '../analysis/types';
import { exploreRelationships, relationshipGraph } from '../analysis/relationships';
import {
  getOverviewConfig,
  overviewLimits,
  overviewZoomLevel,
  type OverviewProjection,
} from './types';
import { overviewTree, groupSummary, type OverviewTree } from './tree';
import { overviewCard, layoutOverview } from './layout';
import { overviewRelationships } from './relationships';

export interface OverviewOptions {
  zoom?: number;
  revealNodeIds?: string[];
  disabled?: boolean;
}
export function projectOverview(
  graph: Graph,
  nodes: CanvasNode[],
  edges: Edge[],
  options: OverviewOptions = {},
): OverviewProjection {
  const config = getOverviewConfig(graph),
    zoomLevel = overviewZoomLevel(options.zoom);
  const counts = {
    originalNodes: nodes.filter((node) => !node.hidden).length,
    originalEdges: edges.filter((edge) => !edge.hidden).length,
    representedNodes: nodes.filter((node) => !node.hidden).length,
    representedEdges: edges.filter((edge) => !edge.hidden).length,
    groups: 0,
  };
  const nodeMap: Record<string, string> = Object.create(null),
    edgeMap: Record<string, string> = Object.create(null);
  if (!config.enabled || options.disabled) {
    for (const node of nodes) if (!node.hidden) nodeMap[node.id] = node.id;
    for (const edge of edges) if (!edge.hidden) edgeMap[edge.id] = edge.id;
    return {
      active: false,
      nodes,
      edges,
      groups: [],
      relationships: [],
      nodeMap,
      edgeMap,
      counts,
      bounded: false,
      zoomLevel,
    };
  }
  const visible = nodes.filter((node) => !node.hidden),
    { root, trees } = overviewTree(graph, visible, config.grouping);
  const expanded = new Set(config.expanded),
    reveal = new Set(options.revealNodeIds ?? []);
  let frontier: (OverviewTree | CanvasNode)[] = [...root.children.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const opened = new Set<string>();
  let bounded = false;
  for (let index = 0; index < frontier.length; index++) {
    const item = frontier[index];
    if (!('members' in item)) continue;
    const required = item.members.some((node) => reveal.has(node.id));
    if (!required && !expanded.has(item.id) && item.depth >= zoomLevel) continue;
    const children: (OverviewTree | CanvasNode)[] = [
      ...[...item.children.values()].sort((a, b) => a.key.localeCompare(b.key)),
      ...item.own,
    ];
    if (!children.length) continue;
    if (frontier.length - 1 + children.length > overviewLimits.visible) {
      bounded = true;
      continue;
    }
    opened.add(item.id);
    frontier.splice(index, 1, ...children);
    index--;
  }
  const groups = trees.map((tree) => groupSummary(tree, opened.has(tree.id))),
    byGroup = new Map(groups.map((group) => [group.id, group]));
  const result: CanvasNode[] = frontier.map((item) => {
    if (!('members' in item)) {
      nodeMap[item.id] = item.id;
      return item;
    }
    const group = byGroup.get(item.id)!;
    for (const node of item.members) nodeMap[node.id] = item.id;
    return overviewCard(graph, group, item.members);
  });
  const layout = layoutOverview(result),
    relationships = overviewRelationships(graph, edges, nodeMap, layout);
  for (const relation of relationships.relationships)
    if (relation.internal && byGroup.has(relation.source))
      byGroup.get(relation.source)!.internalEdgeCount += relation.edgeIds.length;
  return {
    active: true,
    nodes: layout,
    edges: relationships.edges,
    groups,
    relationships: relationships.relationships,
    nodeMap,
    edgeMap: relationships.edgeMap,
    counts: {
      ...counts,
      representedNodes: layout.length,
      representedEdges: relationships.edges.length,
      groups: layout.filter((node) => byGroup.has(node.id)).length,
    },
    bounded,
    zoomLevel,
  };
}

/** API/MCP snapshots use the same filter and relationship view as the editor. */
export function projectCanonicalOverview(graph: Graph, options: OverviewOptions = {}) {
  const filters = graph.diagram.settings.analysisFilters as typeof emptyFilters | undefined;
  const exploration = getExploration(graph);
  const explored = exploration
    ? exploreRelationships(relationshipGraph(graph), exploration)
    : undefined;
  const projected = projectGraph(
    graph,
    graph.owners,
    [],
    [],
    filters ?? emptyFilters,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    explored,
  );
  return projectOverview(graph, projected.nodes, projected.edges, options);
}
