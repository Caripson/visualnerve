import type { Diagram, Graph, GraphEdge, GraphNode } from '../model/types';
import type { CsvDataset } from '../data/types';
import { graphDatasets } from '../data/model';
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
  /** Immutable source references; ordinary commands never clone or stringify raw cells. */
  sources?: Change<CsvDataset>[];
  sourceOrder?: { before: string[]; after: string[] };
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
  const oldSources = graphDatasets(before),
    newSources = graphDatasets(after);
  const sourceIndex = new Map(oldSources.map((source) => [source.id, source]));
  const sourceChanges: Change<CsvDataset>[] = [];
  for (const source of newSources) {
    const old = sourceIndex.get(source.id);
    if (old !== source) sourceChanges.push({ id: source.id, before: old, after: source });
    sourceIndex.delete(source.id);
  }
  for (const [id, source] of sourceIndex) sourceChanges.push({ id, before: source });
  const oldOrder = oldSources.map((source) => source.id),
    newOrder = newSources.map((source) => source.id);
  const orderChanged = JSON.stringify(oldOrder) !== JSON.stringify(newOrder);
  if (orderChanged && !sourceChanges.length && newSources[0])
    sourceChanges.push({ id: newSources[0].id, before: newSources[0], after: newSources[0] });
  return {
    label,
    timestamp: Date.now(),
    nodes: changes(before.nodes, after.nodes),
    edges: changes(before.edges, after.edges),
    ...(sourceChanges.length
      ? { sources: sourceChanges, sourceOrder: { before: oldOrder, after: newOrder } }
      : {}),
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
  const sources = delta.sources ? apply(graphDatasets(graph), delta.sources, forward) : undefined;
  if (sources && delta.sourceOrder) {
    const order = new Map(
      (forward ? delta.sourceOrder.after : delta.sourceOrder.before).map((id, index) => [
        id,
        index,
      ]),
    );
    sources.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return {
    ...graph,
    nodes: apply(graph.nodes, delta.nodes, forward),
    edges: apply(graph.edges, delta.edges, forward),
    diagram: delta.diagram ? (forward ? delta.diagram.after : delta.diagram.before) : graph.diagram,
    ...(sources ? { dataset: sources[0], datasets: sources.slice(1) } : {}),
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
    sources: a.sources || b.sources ? merge(a.sources ?? [], b.sources ?? []) : undefined,
    sourceOrder: b.sourceOrder
      ? { before: a.sourceOrder?.before ?? b.sourceOrder.before, after: b.sourceOrder.after }
      : a.sourceOrder,
  };
}
