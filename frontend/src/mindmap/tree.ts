import type { GraphNode } from '../model/types';
import type { Geometry } from '../layouts/layout';
import { colorPalette } from '../ui/colors';

export const branchColors = colorPalette.slice(0, 6).map((color) => color.value);
export type MindmapTopic = { depth: number; color: string; side: 'root' | 'left' | 'right' };

export function topicTree(nodes: GraphNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, GraphNode[]>();
  const roots: GraphNode[] = [];
  for (const node of nodes) {
    if (node.nodeType === 'group') continue;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.nodeType !== 'group') {
      const siblings = children.get(parent.id) ?? [];
      siblings.push(node);
      children.set(parent.id, siblings);
    } else roots.push(node);
  }
  return { byId, children, roots };
}

export function mindmapTopics(nodes: GraphNode[]): Map<string, MindmapTopic> {
  const { children, roots } = topicTree(nodes);
  const topics = new Map<string, MindmapTopic>();
  const pending: { node: GraphNode; topic: MindmapTopic }[] = roots
    .map((node) => ({
      node,
      topic: { depth: 0, color: node.color || '#23664d', side: 'root' as const },
    }))
    .reverse();
  while (pending.length) {
    const { node, topic } = pending.pop()!;
    if (topics.has(node.id)) continue;
    topics.set(node.id, topic);
    const list = children.get(node.id) ?? [];
    for (let index = list.length - 1; index >= 0; index--) {
      const child = list[index];
      const first = topic.depth === 0;
      pending.push({
        node: child,
        topic: {
          depth: topic.depth + 1,
          color: child.color || (first ? branchColors[index % branchColors.length] : topic.color),
          side: first
            ? child.x + child.width / 2 < node.x + node.width / 2
              ? 'left'
              : 'right'
            : topic.side,
        },
      });
    }
  }
  return topics;
}

// Each subtree reserves enough vertical space for all of its descendants.
// Root branches alternate sides; descendants keep their branch's direction.
export function balancedMindmap(nodes: GraphNode[]): Map<string, Geometry> {
  const { children, roots } = topicTree(nodes);
  const spans = new Map<string, number>();
  const positions = new Map<string, Geometry>();
  const gap = 24;
  const measure = (node: GraphNode): number => {
    const pending = [{ node, measured: false }];
    while (pending.length) {
      const current = pending.pop()!;
      const list = children.get(current.node.id) ?? [];
      if (!current.measured) {
        pending.push({ node: current.node, measured: true });
        for (let index = list.length - 1; index >= 0; index--)
          pending.push({ node: list[index], measured: false });
      } else
        spans.set(
          current.node.id,
          Math.max(
            current.node.height,
            list.reduce((sum, child) => sum + spans.get(child.id)!, 0) +
              Math.max(0, list.length - 1) * gap,
          ),
        );
    }
    return spans.get(node.id)!;
  };
  const placeChildren = (
    list: GraphNode[],
    parent: GraphNode,
    x: number,
    centerY: number,
    sign: number,
  ) => {
    const frame = (siblings: GraphNode[], parent: GraphNode, x: number, centerY: number) => ({
      siblings,
      parent,
      x,
      index: 0,
      top:
        centerY -
        (siblings.reduce((sum, child) => sum + spans.get(child.id)!, 0) +
          Math.max(0, siblings.length - 1) * gap) /
          2,
    });
    const pending = [frame(list, parent, x, centerY)];
    while (pending.length) {
      const current = pending.at(-1)!;
      const child = current.siblings[current.index++];
      if (!child) {
        pending.pop();
        continue;
      }
      const cy = current.top + spans.get(child.id)! / 2;
      const cx = sign > 0 ? current.x + current.parent.width + 96 : current.x - 96 - child.width;
      positions.set(child.id, { x: cx, y: cy - child.height / 2 });
      current.top += spans.get(child.id)! + gap;
      const descendants = children.get(child.id) ?? [];
      // Finish a subtree before the next sibling, retaining the public Map's DFS order.
      if (descendants.length) pending.push(frame(descendants, child, cx, cy));
    }
  };
  let nextRootY: number | undefined;
  for (const root of roots) {
    // A group is a spatial container; preserve the manually arranged contents.
    if (root.parentId) continue;
    measure(root);
    const list = children.get(root.id) ?? [];
    const right = list.filter((_, i) => i % 2 === 0);
    const left = list.filter((_, i) => i % 2 === 1);
    const height = (branch: GraphNode[]) =>
      branch.reduce((sum, child) => sum + spans.get(child.id)!, 0) +
      Math.max(0, branch.length - 1) * gap;
    const span = Math.max(root.height, height(left), height(right));
    const centerY = nextRootY === undefined ? root.y + root.height / 2 : nextRootY + span / 2;
    positions.set(root.id, { x: root.x, y: centerY - root.height / 2 });
    placeChildren(right, root, root.x, centerY, 1);
    placeChildren(left, root, root.x, centerY, -1);
    nextRootY = centerY + span / 2 + 120;
  }
  return positions;
}

// Adding a topic does not rearrange the user's existing manual positions.
export function newTopicPosition(
  nodes: GraphNode[],
  parent: GraphNode,
  width: number,
  height: number,
  sibling?: GraphNode,
): Geometry {
  const topics = mindmapTopics(nodes);
  const topic = topics.get(parent.id);
  const siblings = nodes.filter((node) => node.parentId === parent.id);
  const sign = sibling
    ? topics.get(sibling.id)?.side === 'left'
      ? -1
      : 1
    : topic?.depth === 0
      ? siblings.filter((node) => topics.get(node.id)?.side === 'right').length <=
        siblings.filter((node) => topics.get(node.id)?.side === 'left').length
        ? 1
        : -1
      : topic?.side === 'left'
        ? -1
        : 1;
  const x = sign > 0 ? parent.x + parent.width + 96 : parent.x - width - 96;
  let y = sibling ? sibling.y + sibling.height + 24 : parent.y + (parent.height - height) / 2;
  // Walk past occupied rows, including descendants of neighboring branches.
  let occupied: GraphNode | undefined;
  while (
    (occupied = nodes.find(
      (node) =>
        x < node.x + node.width + 16 &&
        x + width + 16 > node.x &&
        y < node.y + node.height + 24 &&
        y + height + 24 > node.y,
    ))
  )
    y = occupied.y + occupied.height + 24;
  return { x, y, width, height };
}
