import { describe, expect, it } from 'vitest';
import { DeliveryNetworkExample } from '../src/simulation/delivery-example';
import { ProcessProjection } from '../src/simulation/process-projection';
import { projectedProcessPath } from '../src/simulation/process-connections';
import { projectGraph } from '../src/canvas/projection';
import { newNode, newEdge } from '../src/model/types';
import { ProcessViewLayout } from '../src/simulation/process-view-layout';
import { ProcessConnections } from '../src/simulation/process-connections';

type Point = { x: number; y: number };
function corners(path: string): Point[] {
  const commands = [...path.matchAll(/([MVH])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
  let point = { x: 0, y: 0 };
  return commands.map((match) => {
    point =
      match[1] === 'M'
        ? { x: Number(match[2]), y: Number(match[3]) }
        : match[1] === 'H'
          ? { ...point, x: Number(match[2]) }
          : { ...point, y: Number(match[2]) };
    return point;
  });
}
describe('hierarchy presentation connection geometry', () => {
  it('routes shared pools around the outside of cards and uses one SVG/particle definition', () => {
    const graph = new DeliveryNetworkExample().graph();
    const result = new ProcessProjection(graph.simulation!).project(graph, { mode: 'hierarchy' });
    const canvas = projectGraph(result.graph, []);
    for (const edge of result.graph.edges) {
      const view = canvas.edges.find((entry) => entry.id === edge.id)!;
      expect(view.type).toBe('simulation-process-connection');
      expect(view.data?.path).toBe(projectedProcessPath(edge));
      if (edge.edgeType !== 'simulation-resource') continue;
      expect(view.sourceHandle).toBe('out-bottom');
      expect(view.targetHandle).toBe('in-top');
      const points = corners(projectedProcessPath(edge)!);
      expect(points.some((point) => point.x < 0)).toBe(true);
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1],
          b = points[index];
        for (const node of result.graph.nodes) {
          const vertical =
            a.x === b.x &&
            a.x > node.x &&
            a.x < node.x + node.width &&
            Math.max(a.y, b.y) > node.y &&
            Math.min(a.y, b.y) < node.y + node.height;
          const horizontal =
            a.y === b.y &&
            a.y > node.y &&
            a.y < node.y + node.height &&
            Math.max(a.x, b.x) > node.x &&
            Math.min(a.x, b.x) < node.x + node.width;
          expect(vertical || horizontal).toBe(false);
        }
      }
    }
    expect(new ProcessProjection(graph.simulation!).project(graph, { mode: 'all' }).graph).toBe(
      graph,
    );
    expect(graph.edges.every((edge) => !projectedProcessPath(edge))).toBe(true);
  });
  it('uses top/bottom flow ports when going to a new row instead of crossing process headings', () => {
    const graph = new DeliveryNetworkExample().graph();
    const result = new ProcessProjection(graph.simulation!).project(graph, { mode: 'hierarchy' });
    for (const edge of result.graph.edges.filter(
      (entry) => entry.edgeType !== 'simulation-resource',
    )) {
      const source = result.graph.nodes.find((node) => node.id === edge.sourceNodeId)!;
      const target = result.graph.nodes.find((node) => node.id === edge.targetNodeId)!;
      if (target.y <= source.y) continue;
      expect(edge.metadata.simulationProcessSourceHandle).toBe('out-bottom');
      expect(edge.metadata.simulationProcessTargetHandle).toBe('in-top');
      expect(corners(projectedProcessPath(edge)!)[0]).toEqual({
        x: source.x + source.width / 2,
        y: source.y + source.height,
      });
      expect(corners(projectedProcessPath(edge)!).at(-1)).toEqual({
        x: target.x + target.width / 2,
        y: target.y,
      });
    }
  });
  it('focuses a real editable Work step on mobile even when a parent context was listed first', () => {
    const diagramId = crypto.randomUUID();
    const context = newNode(diagramId, {
      metadata: { simulationProcessId: 'parent', simulationProcessBoundary: true },
    });
    const child = newNode(diagramId, { metadata: { simulationProcessId: 'child' } });
    const replica = newNode(diagramId, {
      nodeType: 'process',
      metadata: { simulationProjected: true },
    });
    const work = newNode(diagramId, { nodeType: 'process' });
    expect(
      new ProcessViewLayout().fitNodeIds(
        [context, child, replica, work],
        [child.id, replica.id, work.id],
        { width: 390, height: 100 },
        true,
      ),
    ).toEqual([work.id]);
  });
  it('routes backward and skip connections through a free row or outside gutter', () => {
    const id = crypto.randomUUID();
    const nodes = Array.from({ length: 7 }, () => newNode(id, { width: 250, height: 240 }));
    const edges = [newEdge(id, nodes[0].id, nodes[2].id), newEdge(id, nodes[6].id, nodes[0].id)];
    const layout = new ProcessViewLayout().arrange(nodes, []);
    const routed = new ProcessConnections().project(layout, edges);
    expect(routed[0].metadata.simulationProcessTargetHandle).toBe('in-bottom');
    expect(routed[1].metadata.simulationProcessSourceHandle).toBe('out-top');
    expect(corners(projectedProcessPath(routed[1])!).some((point) => point.x < 0)).toBe(true);
  });
});
