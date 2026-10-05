import type { ElkNode } from 'elkjs/lib/elk-api';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { Graph, GraphNode, TimelineScale } from '../model/types';
import { balancedMindmap } from '../mindmap/tree';
export type Direction = 'DOWN' | 'RIGHT' | 'LEFT' | 'UP' | 'RADIAL' | 'BALANCED';
export type Geometry = { x: number; y: number; width?: number; height?: number };
export async function layoutGraph(
  graph: Graph,
  direction: Direction,
): Promise<Map<string, Geometry>> {
  if (!graph.nodes.length) return new Map();
  if (direction === 'BALANCED') return balancedMindmap(graph.nodes);
  if (direction === 'RADIAL') return radial(graph.nodes);
  const ELK =
    typeof Worker === 'undefined'
      ? (await import('elkjs/lib/elk.bundled.js')).default
      : (await import('elkjs/lib/elk-api.js')).default;
  const elk = new ELK(
    typeof Worker === 'undefined' ? {} : { workerFactory: () => new Worker(workerUrl) },
  );
  const groupIds = new Set(graph.nodes.filter((n) => n.nodeType === 'group').map((n) => n.id));
  const children = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const parent = n.parentId && groupIds.has(n.parentId) ? n.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  const build = (parent: string): ElkNode[] =>
    (children.get(parent) ?? []).map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      ...(groupIds.has(n.id)
        ? {
            children: build(n.id),
            layoutOptions: { 'elk.padding': '[top=50,left=30,bottom=30,right=30]' },
          }
        : {}),
    }));
  try {
    const result = await elk.layout({
      id: graph.diagram.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.spacing.nodeNode': '48',
        'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      },
      children: build(''),
      edges: graph.edges.map((e) => ({
        id: e.id,
        sources: [e.sourceNodeId],
        targets: [e.targetNodeId],
      })),
    });
    const positions = new Map<string, Geometry>();
    const walk = (nodes: ElkNode[], x = 0, y = 0) => {
      for (const n of nodes) {
        const px = x + (n.x ?? 0),
          py = y + (n.y ?? 0);
        positions.set(n.id, { x: px, y: py, width: n.width, height: n.height });
        if (n.children) walk(n.children, px, py);
      }
    };
    walk(result.children ?? []);
    return positions;
  } finally {
    if (typeof Worker !== 'undefined') elk.terminateWorker();
  }
}
function radial(nodes: GraphNode[]): Map<string, Geometry> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  const weight = new Map<string, number>();
  const visited = new Set<string>();
  const weigh = (n: GraphNode): number => {
    if (visited.has(n.id)) return 1;
    visited.add(n.id);
    const count = Math.max(
      1,
      (children.get(n.id) ?? []).reduce((sum, c) => sum + weigh(c), 0),
    );
    weight.set(n.id, count);
    return count;
  };
  for (const n of children.get('') ?? []) weigh(n);
  const result = new Map<string, Geometry>();
  const place = (n: GraphNode, depth: number, start: number, end: number, cx: number) => {
    const angle = (start + end) / 2;
    result.set(n.id, { x: cx + depth * 300 * Math.cos(angle), y: depth * 300 * Math.sin(angle) });
    let cursor = start;
    for (const c of children.get(n.id) ?? []) {
      const span = ((end - start) * (weight.get(c.id) ?? 1)) / (weight.get(n.id) ?? 1);
      place(c, depth + 1, cursor, cursor + span, cx);
      cursor += span;
    }
  };
  (children.get('') ?? []).forEach((n, i) => place(n, 0, -Math.PI, Math.PI, i * 1300));
  return result;
}
export const dayMS = 86400000;
export const pixelsPerDay: Record<TimelineScale, number> = {
  day: 100,
  week: 30,
  month: 9,
  quarter: 3,
  year: 0.9,
};
export function timelineGeometry(nodes: GraphNode[], scale: TimelineScale) {
  const dated = nodes.filter((n) => n.startDate);
  const origin = dated.length
    ? Math.min(...dated.map((n) => Date.parse(n.startDate!)))
    : Date.parse(new Date().toISOString().slice(0, 10));
  const p = pixelsPerDay[scale];
  const positions = new Map<string, Geometry>();
  nodes.forEach((n) => {
    const start = n.startDate ? Date.parse(n.startDate) : origin;
    const end = n.endDate ? Date.parse(n.endDate) : start;
    positions.set(n.id, {
      x: ((start - origin) / dayMS) * p,
      y: n.y,
      width: Math.max(180, ((end - start) / dayMS + 1) * p),
      height: n.height,
    });
  });
  return { positions, origin, pixelsPerDay: p };
}
