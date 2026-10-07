import type { GraphEdge, GraphNode } from '../model/types';
import { getViewportForBounds } from '@xyflow/react';

export const PROCESS_VIEW_COLUMNS = 3;
const GAP = 42;
const CELL_WIDTH = 300;

/** Compact presentation coordinates; the editable document retains its original world geometry. */
export class ProcessViewLayout {
  fitNodeIds(
    nodes: GraphNode[],
    focusNodeIds: string[],
    viewport: { width: number; height: number },
    touch: boolean,
  ): string[] {
    if (touch) {
      const focus = new Set(focusNodeIds);
      const work = nodes.find(
        (node) =>
          focus.has(node.id) &&
          node.nodeType === 'process' &&
          !node.metadata.simulationProcessId &&
          (!node.metadata.simulationProjected || node.metadata.simulationLogicalNodeId === node.id),
      );
      return work ? [work.id] : focusNodeIds.slice(0, 1);
    }
    if (!nodes.length) return [];
    const x = Math.min(...nodes.map((node) => node.x));
    const y = Math.min(...nodes.map((node) => node.y));
    const width = Math.max(...nodes.map((node) => node.x + node.width)) - x;
    const height = Math.max(...nodes.map((node) => node.y + node.height)) - y;
    // Include pools and boundary context when all cards remain readable on this canvas.
    const fit = getViewportForBounds(
      { x, y, width, height },
      viewport.width,
      viewport.height,
      0.05,
      1,
      0.16,
    );
    return fit.zoom >= 0.72 ? nodes.map((node) => node.id) : focusNodeIds;
  }
  arrange(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
    const pools = nodes.filter((node) => node.metadata.simulationPoolSummary === true);
    const flow = nodes.filter((node) => node.metadata.simulationPoolSummary !== true);
    const index = new Map(flow.map((node, order) => [node.id, order]));
    const incoming = new Map(flow.map((node) => [node.id, 0]));
    const outgoing = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (
        edge.edgeType === 'simulation-resource' ||
        !index.has(edge.sourceNodeId) ||
        !index.has(edge.targetNodeId) ||
        edge.sourceNodeId === edge.targetNodeId
      )
        continue;
      const destinations = outgoing.get(edge.sourceNodeId) ?? new Set();
      if (!destinations.has(edge.targetNodeId))
        incoming.set(edge.targetNodeId, incoming.get(edge.targetNodeId)! + 1);
      destinations.add(edge.targetNodeId);
      outgoing.set(edge.sourceNodeId, destinations);
    }
    let ready = flow.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    const ordered: GraphNode[] = [],
      seen = new Set<string>();
    while (ready.length) {
      const next: string[] = [];
      ready.sort((a, b) => index.get(a)! - index.get(b)!);
      for (const id of ready) {
        if (seen.has(id)) continue;
        seen.add(id);
        ordered.push(flow[index.get(id)!]);
        for (const target of outgoing.get(id) ?? []) {
          incoming.set(target, incoming.get(target)! - 1);
          if (incoming.get(target) === 0) next.push(target);
        }
      }
      ready = next;
    }
    // Cyclic routing remains a valid diagram. Its remaining cards keep stable model order.
    ordered.push(...flow.filter((node) => !seen.has(node.id)));
    const placed = new Map<string, GraphNode>();
    const poolColumns = Math.min(5, Math.max(1, pools.length));
    const poolRows = Math.ceil(pools.length / poolColumns);
    for (let order = 0; order < pools.length; order++) {
      const node = pools[order];
      placed.set(node.id, {
        ...node,
        x: (order % poolColumns) * 200,
        y: Math.floor(order / poolColumns) * 172,
        width: 180,
        height: 150,
      });
    }
    let y = pools.length ? poolRows * 172 + 38 : 0;
    for (let start = 0; start < ordered.length; start += PROCESS_VIEW_COLUMNS) {
      const row = ordered.slice(start, start + PROCESS_VIEW_COLUMNS);
      const height = Math.max(...row.map((node) => node.height));
      let x = 0;
      for (const node of row) {
        placed.set(node.id, { ...node, x, y });
        x += Math.max(CELL_WIDTH, node.width) + GAP;
      }
      y += height + GAP;
    }
    return nodes.map((node) => ({
      ...placed.get(node.id)!,
      metadata: { ...node.metadata, simulationLayoutProjected: true },
    }));
  }
}
