import { MarkerType, type Edge } from '@xyflow/react';
import type { Graph } from '../model/types';
import type { CanvasNode } from '../canvas/projection';
import { overviewId, OVERVIEW_EDGE_PREFIX, type OverviewRelationship } from './types';

export function overviewRelationships(
  graph: Graph,
  edges: Edge[],
  nodeMap: Record<string, string>,
  nodes: CanvasNode[],
) {
  const original = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const views = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, { summary: OverviewRelationship; view: Edge }>();
  const edgeMap: Record<string, string> = Object.create(null);
  for (const edge of [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (edge.hidden) continue;
    let source = nodeMap[edge.source],
      target = nodeMap[edge.target];
    if (!source || !target) continue;
    const model = original.get(edge.id),
      edgeType = model?.edgeType ?? 'hierarchy',
      direction = model?.direction ?? 'none',
      style = model?.style ?? 'solid';
    if ((direction === 'none' || direction === 'both') && source > target)
      [source, target] = [target, source];
    const key = JSON.stringify([graph.diagram.id, source, target, edgeType, direction, style]);
    const id = overviewId(OVERVIEW_EDGE_PREFIX, key);
    let group = groups.get(id);
    if (!group) {
      const summary: OverviewRelationship = {
        id,
        source,
        target,
        edgeType,
        direction,
        style,
        edgeIds: [],
        labels: [],
        internal: source === target,
      };
      const right = (views.get(source)?.position.x ?? 0) <= (views.get(target)?.position.x ?? 0);
      const handle = (node: string, from: boolean) =>
        views.get(node)?.type === 'mindmap-topic'
          ? `${from ? 'source' : 'target'}-${from ? (right ? 'right' : 'left') : right ? 'left' : 'right'}`
          : from
            ? 'out'
            : 'in';
      group = {
        summary,
        view: {
          ...edge,
          id,
          source,
          target,
          type: 'overview-relation',
          sourceHandle: handle(source, true),
          targetHandle: handle(target, false),
          selected: !!edge.selected,
          hidden: false,
          selectable: false,
          reconnectable: false,
          deletable: false,
          markerStart:
            direction === 'backward' || direction === 'both'
              ? { type: MarkerType.ArrowClosed, width: 16, height: 16 }
              : undefined,
          markerEnd:
            direction === 'forward' || direction === 'both'
              ? { type: MarkerType.ArrowClosed, width: 16, height: 16 }
              : undefined,
          data: { overviewRelationship: summary },
          ariaLabel: `${edgeType}, ${direction}, summarized relationships`,
        },
      };
      groups.set(id, group);
    }
    group.summary.edgeIds.push(edge.id);
    group.view.selected ||= !!edge.selected;
    if (model?.label && !group.summary.labels.includes(model.label))
      group.summary.labels.push(model.label);
    edgeMap[edge.id] = id;
  }
  const lanes = new Map<string, number>();
  const records = [...groups.values()].sort((a, b) => a.summary.id.localeCompare(b.summary.id));
  for (const group of records) {
    group.summary.edgeIds.sort();
    group.summary.labels.sort();
    const key = `${group.summary.source}:${group.summary.target}`,
      lane = lanes.get(key) ?? 0;
    lanes.set(key, lane + 1);
    group.view.label = `${group.summary.edgeType} ×${group.summary.edgeIds.length}`;
    group.view.data = { ...group.view.data, lane };
    group.view.ariaLabel = `${group.summary.edgeIds.length} ${group.summary.edgeType} relationships, ${group.summary.direction}`;
  }
  return {
    edges: records.map((group) => group.view),
    relationships: records.map((group) => group.summary),
    edgeMap,
  };
}
