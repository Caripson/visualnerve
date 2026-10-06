import type { Graph, GraphNode } from '../model/types';
import type { CanvasNode } from '../canvas/projection';
import type { OverviewGroup } from './types';

export function overviewCard(
  graph: Graph,
  group: OverviewGroup,
  members: CanvasNode[],
): CanvasNode {
  const colors = new Map<string, number>();
  for (const member of members) {
    const color =
      member.data.mindmap?.color ??
      member.data.node.color ??
      member.data.owners[0]?.color ??
      '#31766c';
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  const color = [...colors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const node: GraphNode = {
    id: group.id,
    version: 1,
    createdAt: '',
    updatedAt: '',
    diagramId: graph.diagram.id,
    nodeType: 'generic',
    title: group.label,
    description: `${group.nodeIds.length} diagram objects. Expand this summary to inspect its original objects and relationships.`,
    x: 0,
    y: 0,
    width: 280,
    height: 172,
    ownerIds: [],
    tags: [],
    collapsed: false,
    color,
    metadata: { overviewGroup: group },
  };
  return {
    id: node.id,
    type: 'overview-group',
    position: { x: 0, y: 0 },
    width: node.width,
    height: node.height,
    measured: { width: node.width, height: node.height },
    style: { width: node.width, height: node.height },
    data: { node, owners: [], childCount: 0, exporting: false },
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    ariaLabel: `${group.label}, ${group.nodeIds.length} objects, semantic summary`,
  };
}
/** A compact view layout; its positions are never written to canonical nodes. */
export function layoutOverview(nodes: CanvasNode[]) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const width =
    Math.max(320, ...nodes.map((view) => Math.min(600, view.width ?? view.data.node.width))) + 48;
  const height =
    Math.max(210, ...nodes.map((view) => Math.min(600, view.height ?? view.data.node.height))) + 36;
  return nodes.map((view, index) => {
    const w = Math.min(600, view.width ?? view.data.node.width),
      h = Math.min(600, view.height ?? view.data.node.height);
    return {
      ...view,
      className: [view.className, 'overview-detail-card'].filter(Boolean).join(' '),
      parentId: undefined,
      extent: undefined,
      expandParent: false,
      position: { x: (index % columns) * width, y: Math.floor(index / columns) * height },
      width: w,
      height: h,
      measured: { width: w, height: h },
      style: { ...view.style, width: w, height: h },
      draggable: false,
      connectable: false,
      data: { ...view.data, exporting: !view.id.startsWith('overview-group:'), resize: undefined },
    };
  });
}
/** The 3D relief uses the exact same projected card positions/dimensions as 2D. */
export function overviewRenderGraph(graph: Graph, views: CanvasNode[]): Graph {
  return {
    ...graph,
    diagram: { ...graph.diagram, type: 'freeform' },
    nodes: views
      .filter((view) => !view.hidden)
      .map((view) => {
        const metadata = { ...view.data.node.metadata };
        delete metadata.spatial;
        return {
          ...view.data.node,
          x: view.position.x,
          y: view.position.y,
          width: view.width ?? view.data.node.width,
          height: view.height ?? view.data.node.height,
          parentId: undefined,
          metadata,
        };
      }),
  };
}
