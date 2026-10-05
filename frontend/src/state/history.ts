import type { Diagram, Graph, GraphEdge, GraphNode } from '../model/types';
export interface Change<T> {
  id: string;
  before?: T;
  after?: T;
}
export interface Delta {
  label: string;
  timestamp: number;
  nodes: Change<GraphNode>[];
  edges: Change<GraphEdge>[];
  diagram?: { before: Diagram; after: Diagram };
}
function changes<T extends { id: string }>(before: T[], after: T[]): Change<T>[] {
  const old = new Map(before.map((v) => [v.id, v]));
  const result: Change<T>[] = [];
  for (const value of after) {
    const prev = old.get(value.id);
    if (prev !== value && JSON.stringify(prev) !== JSON.stringify(value))
      result.push({ id: value.id, before: prev, after: value });
    old.delete(value.id);
  }
  for (const [id, value] of old) result.push({ id, before: value });
  return result;
}
export function diffGraph(before: Graph, after: Graph, label: string): Delta {
  return {
    label,
    timestamp: Date.now(),
    nodes: changes(before.nodes, after.nodes),
    edges: changes(before.edges, after.edges),
    ...(before.diagram !== after.diagram &&
    JSON.stringify(before.diagram) !== JSON.stringify(after.diagram)
      ? { diagram: { before: before.diagram, after: after.diagram } }
      : {}),
  };
}
function apply<T extends { id: string }>(items: T[], delta: Change<T>[], forward: boolean): T[] {
  const pending = new Map(delta.map((c) => [c.id, forward ? c.after : c.before]));
  const result: T[] = [];
  for (const item of items) {
    if (!pending.has(item.id)) {
      result.push(item);
      continue;
    }
    const value = pending.get(item.id);
    if (value) result.push(value);
    pending.delete(item.id);
  }
  for (const value of pending.values()) if (value) result.push(value);
  return result;
}
export function applyDelta(graph: Graph, delta: Delta, forward: boolean): Graph {
  return {
    ...graph,
    nodes: apply(graph.nodes, delta.nodes, forward),
    edges: apply(graph.edges, delta.edges, forward),
    diagram: delta.diagram ? (forward ? delta.diagram.after : delta.diagram.before) : graph.diagram,
  };
}
export function mergeDelta(a: Delta, b: Delta): Delta {
  const merge = <T>(x: Change<T>[], y: Change<T>[]) => {
    const map = new Map(x.map((c) => [c.id, c]));
    for (const c of y) map.set(c.id, map.has(c.id) ? { ...c, before: map.get(c.id)!.before } : c);
    return [...map.values()];
  };
  return {
    ...b,
    nodes: merge(a.nodes, b.nodes),
    edges: merge(a.edges, b.edges),
    diagram: b.diagram
      ? { before: a.diagram?.before ?? b.diagram.before, after: b.diagram.after }
      : a.diagram,
  };
}
