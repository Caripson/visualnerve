import type { CanvasNode } from '../canvas/projection';
import type { Graph } from '../model/types';
import { overviewGrouping, type GroupPart } from './grouping';
import {
  overviewId,
  overviewLimits,
  OVERVIEW_GROUP_PREFIX,
  type OverviewGroup,
  type OverviewGrouping,
} from './types';

export interface OverviewTree {
  id: string;
  key: string;
  label: string;
  reason: OverviewGroup['reason'];
  parentId?: string;
  depth: number;
  members: CanvasNode[];
  own: CanvasNode[];
  children: Map<string, OverviewTree>;
}
function branch(key: string, part: GroupPart, parent?: OverviewTree): OverviewTree {
  return {
    id: overviewId(OVERVIEW_GROUP_PREFIX, key),
    key,
    label: part.label,
    reason: part.reason,
    parentId: parent?.id,
    depth: parent ? parent.depth + 1 : -1,
    members: [],
    own: [],
    children: new Map(),
  };
}
function digit(key: string, level: number) {
  return overviewId('', key)[level % 16];
}
/** Split unusually broad source/group boundaries by stable ID, never discard members. */
function balance(tree: OverviewTree, level = 0) {
  if (tree.depth >= overviewLimits.depth) return;
  if (tree.own.length > overviewLimits.leaf) {
    const own = tree.own;
    tree.own = [];
    for (const view of own) {
      const code = digit(view.id, level),
        key = `${tree.key}\0objects:${code}`;
      let group = tree.children.get(key);
      if (!group) {
        group = branch(
          key,
          { key, label: `Part ${parseInt(code, 16) + 1}`, reason: 'partition' },
          tree,
        );
        tree.children.set(key, group);
      }
      group.members.push(view);
      group.own.push(view);
    }
  }
  if (tree.children.size > overviewLimits.branch) {
    const children = [...tree.children.values()];
    tree.children.clear();
    for (const child of children) {
      const code = digit(child.key, level),
        key = `${tree.key}\0areas:${code}`;
      let group = tree.children.get(key);
      if (!group) {
        group = branch(
          key,
          { key, label: `Areas ${parseInt(code, 16) + 1}`, reason: 'partition' },
          tree,
        );
        tree.children.set(key, group);
      }
      child.parentId = group.id;
      child.depth = group.depth + 1;
      group.children.set(child.key, child);
      group.members.push(...child.members);
    }
  }
  for (const child of tree.children.values()) balance(child, level + 1);
}
export function overviewTree(graph: Graph, views: CanvasNode[], grouping: OverviewGrouping) {
  const path = overviewGrouping(graph, grouping);
  const root = branch(`diagram:${graph.diagram.id}`, {
    key: 'root',
    label: graph.diagram.name,
    reason: 'hierarchy',
  });
  const ids = new Map<string, string>();
  for (const view of [...views].sort((a, b) => a.id.localeCompare(b.id))) {
    let current = root;
    current.members.push(view);
    for (const part of path(view.data.node)) {
      const key = `${current.key}\0${part.key}`;
      let child = current.children.get(key);
      if (!child) {
        child = branch(key, part, current);
        current.children.set(key, child);
      }
      const previous = ids.get(child.id);
      if (previous && previous !== key)
        throw new Error('Overview group ID collision. Choose a different grouping.');
      ids.set(child.id, key);
      child.members.push(view);
      current = child;
    }
    current.own.push(view);
  }
  balance(root);
  const trees: OverviewTree[] = [];
  const collect = (tree: OverviewTree, depth: number, parent?: string) => {
    tree.depth = depth;
    tree.parentId = parent;
    if (tree !== root) trees.push(tree);
    for (const child of tree.children.values()) collect(child, depth + 1, tree.id);
  };
  collect(root, -1);
  return { root, trees };
}
export function groupSummary(tree: OverviewTree, expanded: boolean): OverviewGroup {
  const statusCounts: Record<string, number> = Object.create(null),
    nodeTypeCounts: Record<string, number> = Object.create(null);
  let matchingNodeCount = 0;
  for (const view of tree.members) {
    const status = view.data.node.status || 'none';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const type = view.data.node.nodeType;
    nodeTypeCounts[type] = (nodeTypeCounts[type] ?? 0) + 1;
    if (Number(view.style?.opacity ?? 1) >= 0.99) matchingNodeCount++;
  }
  return {
    id: tree.id,
    label: tree.label,
    reason: tree.reason,
    parentId: tree.depth ? tree.parentId : undefined,
    depth: tree.depth,
    nodeIds: tree.members.map((view) => view.id),
    childGroupIds: [...tree.children.values()].map((child) => child.id).sort(),
    statusCounts,
    nodeTypeCounts,
    matchingNodeCount,
    internalEdgeCount: 0,
    expanded,
  };
}
