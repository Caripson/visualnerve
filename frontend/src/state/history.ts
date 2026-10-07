import type { Diagram, Graph, GraphEdge, GraphNode } from '../model/types';
import type { CsvDataset } from '../data/types';
import { graphDatasets } from '../data/model';
export interface Change<T> {
  id: string;
  before?: T;
  after?: T;
}
interface OrderChange {
  before: string[];
  after: string[];
}
export interface Delta {
  label: string;
  timestamp: number;
  nodes: Change<GraphNode>[];
  edges: Change<GraphEdge>[];
  /** Branch colors and diagram stacking depend on canonical entity order. */
  nodeOrder?: OrderChange;
  edgeOrder?: OrderChange;
  diagram?: { before: Diagram; after: Diagram };
  simulation?: { before?: Graph['simulation']; after?: Graph['simulation'] };
  /** Immutable source references; ordinary commands never clone or stringify raw cells. */
  sources?: Change<CsvDataset>[];
  sourceOrder?: OrderChange;
}
function changedOrder(before: { id: string }[], after: { id: string }[]): OrderChange | undefined {
  if (before.length === after.length && before.every((item, index) => item.id === after[index].id))
    return;
  return { before: before.map((item) => item.id), after: after.map((item) => item.id) };
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
    nodeOrder: changedOrder(before.nodes, after.nodes),
    edgeOrder: changedOrder(before.edges, after.edges),
    ...(before.simulation !== after.simulation &&
    JSON.stringify(before.simulation) !== JSON.stringify(after.simulation)
      ? { simulation: { before: before.simulation, after: after.simulation } }
      : {}),
    ...(sourceChanges.length
      ? { sources: sourceChanges, sourceOrder: { before: oldOrder, after: newOrder } }
      : {}),
    ...(before.diagram !== after.diagram &&
    JSON.stringify(before.diagram) !== JSON.stringify(after.diagram)
      ? { diagram: { before: before.diagram, after: after.diagram } }
      : {}),
  };
}
function apply<T extends { id: string }>(
  items: T[],
  delta: Change<T>[],
  forward: boolean,
  order?: OrderChange,
): T[] {
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
  if (order) {
    const positions = new Map(
      (forward ? order.after : order.before).map((id, index) => [id, index]),
    );
    result.sort(
      (a, b) =>
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return result;
}
export function applyDelta(graph: Graph, delta: Delta, forward: boolean): Graph {
  const sources = delta.sources
    ? apply(graphDatasets(graph), delta.sources, forward, delta.sourceOrder)
    : undefined;
  return {
    ...graph,
    nodes: apply(graph.nodes, delta.nodes, forward, delta.nodeOrder),
    edges: apply(graph.edges, delta.edges, forward, delta.edgeOrder),
    diagram: delta.diagram ? (forward ? delta.diagram.after : delta.diagram.before) : graph.diagram,
    ...(delta.simulation
      ? { simulation: forward ? delta.simulation.after : delta.simulation.before }
      : {}),
    ...(sources ? { dataset: sources[0], datasets: sources.slice(1) } : {}),
  };
}
export function mergeDelta(a: Delta, b: Delta): Delta {
  const merge = <T>(x: Change<T>[], y: Change<T>[]) => {
    const map = new Map(x.map((c) => [c.id, c]));
    for (const c of y) map.set(c.id, map.has(c.id) ? { ...c, before: map.get(c.id)!.before } : c);
    return [...map.values()];
  };
  const order = (first?: OrderChange, last?: OrderChange) =>
    last ? { before: first?.before ?? last.before, after: last.after } : first;
  return {
    ...b,
    nodes: merge(a.nodes, b.nodes),
    edges: merge(a.edges, b.edges),
    nodeOrder: order(a.nodeOrder, b.nodeOrder),
    edgeOrder: order(a.edgeOrder, b.edgeOrder),
    diagram: b.diagram
      ? { before: a.diagram?.before ?? b.diagram.before, after: b.diagram.after }
      : a.diagram,
    simulation: b.simulation
      ? {
          before: a.simulation ? a.simulation.before : b.simulation.before,
          after: b.simulation.after,
        }
      : a.simulation,
    sources: a.sources || b.sources ? merge(a.sources ?? [], b.sources ?? []) : undefined,
    sourceOrder: order(a.sourceOrder, b.sourceOrder),
  };
}
