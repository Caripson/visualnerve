import { getSmoothStepPath, Position } from '@xyflow/react';
import type { GraphEdge, GraphNode } from '../model/types';

/** Presentation routes only. SVG connections and particle motion consume the same path. */
export class ProcessConnections {
  project(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rows = new Map<number, number>();
    const rowMembers = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      rows.set(node.y, Math.max(rows.get(node.y) ?? 0, node.y + node.height));
      const members = rowMembers.get(node.y) ?? [];
      members.push(node);
      rowMembers.set(node.y, members);
    }
    const columnIndex = new Map<string, number>();
    for (const members of rowMembers.values())
      members.sort((a, b) => a.x - b.x).forEach((node, index) => columnIndex.set(node.id, index));
    const rowYs = [...rows.keys()].sort((a, b) => a - b);
    const rowIndex = new Map(rowYs.map((y, index) => [y, index]));
    const gutter = Math.min(0, ...nodes.map((node) => node.x)) - 28;
    return edges.map((edge, index) => {
      const source = byId.get(edge.sourceNodeId),
        target = byId.get(edge.targetNodeId);
      if (!source || !target) return edge;
      const resource = edge.edgeType === 'simulation-resource';
      const sx = source.x + source.width / 2,
        tx = target.x + target.width / 2;
      const down = target.y > source.y,
        sameRow = source.y === target.y;
      let sourceHandle = 'out-bottom',
        targetHandle = 'in-top';
      let path: string,
        labelX = (sx + tx) / 2,
        labelY: number;
      const rowBottom = rows.get(source.y)!;
      const adjacent =
        !resource &&
        sameRow &&
        target.x > source.x &&
        columnIndex.get(target.id)! - columnIndex.get(source.id)! === 1;
      if (adjacent) {
        sourceHandle = 'out';
        targetHandle = 'in';
        [path, labelX, labelY] = getSmoothStepPath({
          sourceX: source.x + source.width,
          sourceY: source.y + source.height / 2,
          sourcePosition: Position.Right,
          targetX: target.x,
          targetY: target.y + target.height / 2,
          targetPosition: Position.Left,
        });
      } else if (sameRow && !resource) {
        targetHandle = 'in-bottom';
        labelY = rowBottom + 21;
        path = `M ${sx} ${source.y + source.height} V ${labelY} H ${tx} V ${target.y + target.height}`;
      } else if (down && !resource && rowIndex.get(target.y)! - rowIndex.get(source.y)! === 1) {
        labelY = (rowBottom + target.y) / 2;
        path = `M ${sx} ${source.y + source.height} V ${labelY} H ${tx} V ${target.y}`;
      } else {
        const bus = gutter - (index % 5) * 8;
        const start = down ? source.y + source.height : source.y;
        const leave = down ? rowBottom + 18 : source.y - 18;
        const end = down ? target.y : target.y + target.height;
        const enter = down ? target.y - 18 : rows.get(target.y)! + 18;
        if (!down) {
          sourceHandle = 'out-top';
          targetHandle = 'in-bottom';
        }
        labelY = enter;
        labelX = (bus + tx) / 2;
        path = `M ${sx} ${start} V ${leave} H ${bus} V ${enter} H ${tx} V ${end}`;
      }
      return {
        ...edge,
        metadata: {
          ...edge.metadata,
          simulationProcessPath: path,
          simulationProcessSourceHandle: sourceHandle,
          simulationProcessTargetHandle: targetHandle,
          simulationProcessLabelX: labelX,
          simulationProcessLabelY: labelY,
        },
      };
    });
  }
}

export function projectedProcessPath(edge: GraphEdge): string | undefined {
  return typeof edge.metadata.simulationProcessPath === 'string'
    ? edge.metadata.simulationProcessPath
    : undefined;
}
