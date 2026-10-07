import { describe, expect, it } from 'vitest';
import { DeliveryNetworkExample } from '../src/simulation/delivery-example';
import { ProcessProjection, getSimulationProcessId } from '../src/simulation/process-projection';
import { ProcessViewLayout } from '../src/simulation/process-view-layout';
import {
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import { projectGraph } from '../src/canvas/projection';
import { addConnectedNode, connectedNodeChoices } from '../src/nodes/connected-node';
import { newNode, newEdge } from '../src/model/types';

function capacityGraph() {
  const graph = new DeliveryNetworkExample().graph();
  const projection = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
  return { graph, view: { ...graph, nodes: projection.nodes, edges: projection.edges } };
}
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
describe('compact semantic process view geometry', () => {
  it('reduces the complex root view to five shared pools, three arrival cards and two main processes', () => {
    const { graph, view } = capacityGraph();
    const before = structuredClone(graph);
    const result = new ProcessProjection(graph.simulation!).project(view, { mode: 'hierarchy' });
    expect(result.graph.nodes.filter((node) => node.metadata.simulationPoolSummary)).toHaveLength(
      5,
    );
    expect(result.graph.nodes.filter((node) => getSimulationProcessId(node))).toHaveLength(2);
    expect(result.graph.nodes).toHaveLength(10);
    expect(result.focusNodeIds).toHaveLength(2);
    expect(
      result.focusNodeIds.every(
        (id) =>
          result.graph.nodes.find((node) => node.id === id)?.metadata.simulationProcessRole ===
          'primary',
      ),
    ).toBe(true);
    const width = Math.max(...result.graph.nodes.map((node) => node.x + node.width));
    const height = Math.max(...result.graph.nodes.map((node) => node.y + node.height));
    expect(width).toBeLessThanOrEqual(1000);
    expect(height).toBeLessThanOrEqual(800);
    const layout = new ProcessViewLayout();
    expect(
      layout.fitNodeIds(
        result.graph.nodes,
        result.focusNodeIds,
        { width: 1100, height: 800 },
        false,
      ),
    ).toHaveLength(10);
    expect(
      layout.fitNodeIds(
        result.graph.nodes,
        result.focusNodeIds,
        { width: 1100, height: 300 },
        false,
      ),
    ).toEqual(result.focusNodeIds);
    expect(
      layout.fitNodeIds(result.graph.nodes, result.focusNodeIds, { width: 390, height: 700 }, true),
    ).toEqual(result.focusNodeIds.slice(0, 1));
    expect(
      result.graph.nodes
        .filter((node) => node.metadata.simulationPoolSummary)
        .every((node) => node.height === 150),
    ).toBe(true);
    for (let index = 0; index < result.graph.nodes.length; index++)
      for (const other of result.graph.nodes.slice(index + 1))
        expect(overlaps(result.graph.nodes[index], other)).toBe(false);
    expect(graph).toEqual(before);
    expect(new ProcessProjection(graph.simulation!).project(view, { mode: 'all' }).graph).toBe(
      view,
    );
  });
  it('keeps every drilldown deterministically bounded in width and preserves valid boundary edges', () => {
    const { graph, view } = capacityGraph();
    const projector = new ProcessProjection(graph.simulation!);
    for (const process of graph.simulation!.processes!) {
      const result = projector.project(view, { mode: 'hierarchy', processId: process.id });
      expect(
        Math.max(...result.graph.nodes.map((node) => node.x + node.width)),
      ).toBeLessThanOrEqual(1000);
      expect(result.graph.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
        projector
          .project(view, { mode: 'hierarchy', processId: process.id })
          .graph.nodes.map((node) => [node.id, node.x, node.y]),
      );
      const ids = new Set(result.graph.nodes.map((node) => node.id));
      expect(
        result.graph.edges.every(
          (edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId),
        ),
      ).toBe(true);
      for (let index = 0; index < result.graph.nodes.length; index++)
        for (const other of result.graph.nodes.slice(index + 1))
          expect(overlaps(result.graph.nodes[index], other)).toBe(false);
    }
  });
  it('keeps real Work steps selectable and extendable through the authoritative graph after compact projection', () => {
    const { graph, view } = capacityGraph();
    const work = graph.simulation!.nodes.find((node) => node.name === 'Pick equipment')!;
    const scoped = new ProcessProjection(graph.simulation!).project(view, {
      mode: 'hierarchy',
      processId: 'warehouse',
    });
    const canvas = projectGraph(scoped.graph, [], [work.id]);
    expect(canvas.nodes.find((node) => node.id === work.id)).toMatchObject({
      selected: true,
      draggable: false,
    });
    expect(
      graph.nodes.find((node) => node.id === work.id)?.metadata.simulationLayoutProjected,
    ).toBeUndefined();
    expect(
      connectedNodeChoices(graph, work.id).some((choice) => choice.label === 'Insert work step'),
    ).toBe(true);
    const added = addConnectedNode(graph, work.id, 'work')!;
    expect(added.graph.simulation!.nodes.find((node) => node.id === added.nodeId)?.processId).toBe(
      'warehouse',
    );
    expect(graph.nodes).toHaveLength(23);
    expect(added.graph.nodes).toHaveLength(24);
  });
  it('handles cyclic and disconnected routing without an unbounded horizontal diagram', () => {
    const diagramId = crypto.randomUUID();
    const nodes = Array.from({ length: 1000 }, (_, index) =>
      newNode(diagramId, { id: `node-${index}`, width: 250, height: 170 }),
    );
    const edges = [
      newEdge(diagramId, nodes[0].id, nodes[1].id),
      newEdge(diagramId, nodes[1].id, nodes[0].id),
    ];
    const layout = new ProcessViewLayout().arrange(nodes, edges);
    expect(layout).toHaveLength(1000);
    expect(Math.max(...layout.map((node) => node.x + node.width))).toBeLessThanOrEqual(1000);
    expect(layout.every((node) => node.metadata.simulationLayoutProjected)).toBe(true);
    expect(nodes.every((node) => !node.metadata.simulationLayoutProjected)).toBe(true);
  });
  it('focuses the original Work bank on mobile with arbitrary API node order and capacity replicas', () => {
    const diagramId = crypto.randomUUID();
    const outcome = newNode(diagramId, { nodeType: 'end' });
    const source = newNode(diagramId, { nodeType: 'start' });
    const work = newNode(diagramId, { nodeType: 'process' });
    work.metadata = {
      simulationProjected: true,
      simulationLogicalNodeId: work.id,
      simulationCapacityUnit: 1,
      simulationCapacityTotal: 3,
    };
    const replicas = [2, 3].map((unit) =>
      newNode(diagramId, {
        id: `simulation-capacity:${work.id}:${unit}`,
        nodeType: 'process',
        metadata: {
          simulationProjected: true,
          simulationLogicalNodeId: work.id,
          simulationCapacityUnit: unit,
          simulationCapacityTotal: 3,
        },
      }),
    );
    const nodes = [outcome, source, ...replicas, work];
    const before = structuredClone(nodes);
    expect(
      new ProcessViewLayout().fitNodeIds(
        nodes,
        nodes.map((node) => node.id),
        { width: 390, height: 160 },
        true,
      ),
    ).toEqual([work.id]);
    expect(nodes).toEqual(before);
  });
  it('preserves resized Work content width while spacing neighboring hierarchy cards apart', () => {
    const { graph, view } = capacityGraph();
    const work = graph.simulation!.nodes.find((node) => node.name === 'Pick equipment')!;
    const wide = {
      ...view,
      nodes: view.nodes.map((node) =>
        node.id === work.id ? { ...node, width: 560, height: 470 } : node,
      ),
    };
    const before = structuredClone(wide);
    const result = new ProcessProjection(graph.simulation!).project(wide, {
      mode: 'hierarchy',
      processId: 'warehouse',
    });
    expect(result.graph.nodes.find((node) => node.id === work.id)).toMatchObject({
      width: 560,
      height: 470,
    });
    for (let index = 0; index < result.graph.nodes.length; index++)
      for (const other of result.graph.nodes.slice(index + 1))
        expect(overlaps(result.graph.nodes[index], other)).toBe(false);
    expect(wide).toEqual(before);
    expect(new ProcessProjection(graph.simulation!).project(wide, { mode: 'all' }).graph).toBe(
      wide,
    );
  });
});
