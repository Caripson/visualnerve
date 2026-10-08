import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGraph } from '../src/canvas/projection';
import {
  absoluteCanvasMoves,
  canonicalGeometry,
  isReadonlyCanvasNode,
} from '../src/canvas/logical-geometry';
import { blankGraph, emptyFilters, newNode } from '../src/model/types';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import {
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';
import { ProcessProjection } from '../src/simulation/process-projection';
import { useEditor } from '../src/state/editor';

afterEach(() => useEditor.getState().setGraph(null));

function fixture(capacity = 1) {
  const graph = createSimulationGraph('Editable capacity', createBasicModel({ capacity }));
  const projection = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
  const renderGraph = { ...graph, nodes: projection.nodes, edges: projection.edges };
  const work = graph.nodes.find((node) => node.externalId === 'work')!;
  return { graph, renderGraph, work };
}

describe('primary simulation shapes remain editable', () => {
  it.each([1, 3])('allows editing the native primary Work with capacity %s', (capacity) => {
    const { graph, renderGraph, work } = fixture(capacity);
    const original = structuredClone(graph);
    const resize = vi.fn();
    const projected = projectGraph(renderGraph, [], [work.id], [], emptyFilters, false, resize);
    const primary = projected.nodes.find((node) => node.id === work.id)!;
    expect(primary.selected).toBe(true);
    expect(primary.draggable).not.toBe(false);
    expect(primary.selectable).not.toBe(false);
    expect(primary.connectable).not.toBe(false);
    expect(primary.data.resize).toBe(resize);
    expect(primary.data.minimumHeight).toBe(280);
    expect(primary.ariaRole).toBe('group');
    expect(isReadonlyCanvasNode(primary.data.node)).toBe(false);
    const replicas = projected.nodes.filter((node) => node.id.startsWith('simulation-capacity:'));
    expect(replicas).toHaveLength(capacity - 1);
    for (const replica of replicas) {
      expect(replica).toMatchObject({ draggable: false, selectable: false, connectable: false });
      expect(replica.data.resize).toBeUndefined();
      expect(isReadonlyCanvasNode(replica.data.node)).toBe(true);
    }
    expect(graph).toEqual(original);
  });

  it('allows a shared Resource primary while keeping compact pool summaries locked', () => {
    const graph = createSimulationGraph('Kiosk');
    const projection = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    const renderGraph = { ...graph, nodes: projection.nodes, edges: projection.edges };
    const resourceId = graph.simulation!.nodes.find((node) => node.type === 'resource')!.id;
    const primary = projectGraph(renderGraph, [], [resourceId]).nodes.find(
      (node) => node.id === resourceId,
    )!;
    expect(isReadonlyCanvasNode(primary.data.node)).toBe(false);
    expect(primary.data.minimumHeight).toBe(240);
    expect(primary.connectable).not.toBe(false);
    expect(
      isReadonlyCanvasNode({
        ...primary.data.node,
        metadata: { ...primary.data.node.metadata, simulationPoolSummary: true },
      }),
    ).toBe(true);
  });

  it('locks compact hierarchical layout but restores native editing in All steps', () => {
    const model = createBasicModel({ capacity: 2 });
    model.processes = [{ id: 'assembly', name: 'Assembly' }];
    model.nodes.find((node) => node.type === 'work')!.processId = 'assembly';
    const graph = createSimulationGraph('Scoped', model);
    const capacity = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    const renderGraph = { ...graph, nodes: capacity.nodes, edges: capacity.edges };
    const projector = new ProcessProjection(graph.simulation!);
    const scoped = projector.project(renderGraph, { mode: 'hierarchy', processId: 'assembly' });
    const work = graph.nodes.find((node) => node.externalId === 'work')!;
    const compactWork = projectGraph(scoped.graph, [], [work.id]).nodes.find(
      (node) => node.id === work.id,
    )!;
    expect(compactWork.draggable).toBe(false);
    expect(compactWork.data.resize).toBeUndefined();
    const all = projector.project(renderGraph, { mode: 'all' });
    const native = projectGraph(all.graph, [], [work.id]).nodes.find(
      (node) => node.id === work.id,
    )!;
    expect(native.draggable).not.toBe(false);
    expect(native.connectable).not.toBe(false);
  });

  it('keeps a displaced native Outcome editable and commits only the user displacement', () => {
    const { graph, work } = fixture(3);
    const outcome = graph.nodes.find((node) => node.externalId === 'outcome')!;
    outcome.x = work.x;
    outcome.y = work.y + 180;
    const projection = projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph));
    const rendered = projection.nodes.find((node) => node.id === outcome.id)!;
    expect(rendered.y).toBeGreaterThan(outcome.y);
    expect(isReadonlyCanvasNode(rendered)).toBe(false);
    const move = canonicalGeometry(outcome, rendered, {
      x: rendered.x + 90,
      y: rendered.y + 45,
      width: 340,
      height: 220,
    });
    expect(move).toEqual({ x: outcome.x + 90, y: outcome.y + 45, width: 340, height: 220 });
    useEditor.getState().setGraph(graph);
    useEditor.getState().updateNode(outcome.id, move);
    const after = useEditor.getState().graph!;
    expect(after.nodes.find((node) => node.id === outcome.id)).toMatchObject(move);
    expect(after.simulation).toEqual(graph.simulation);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
  });

  it('does not change ordinary node geometry or expose synthetic scope cards to editing', () => {
    const graph = blankGraph('Normal');
    const node = newNode(graph.diagram.id, { x: 30, y: 60 });
    expect(isReadonlyCanvasNode(node)).toBe(false);
    expect(canonicalGeometry(node, undefined, { x: 50, y: 100 })).toEqual({ x: 50, y: 100 });
    expect(
      isReadonlyCanvasNode({
        ...node,
        metadata: { simulationProjected: true, simulationProcessId: 'scope' },
      }),
    ).toBe(true);
  });
});

describe('nested native group geometry', () => {
  it('resolves moved inner frames and members through their unmoved outer frame', () => {
    const graph = blankGraph('Nested drag');
    const outer = newNode(graph.diagram.id, { nodeType: 'group', x: 100, y: 70 });
    const inner = newNode(graph.diagram.id, {
      nodeType: 'group',
      parentId: outer.id,
      x: 150,
      y: 100,
    });
    const child = newNode(graph.diagram.id, { parentId: inner.id, x: 190, y: 130 });
    const index = new Map([outer, inner, child].map((node) => [node.id, node]));
    const absolute = absoluteCanvasMoves(
      index,
      new Map([
        [child.id, { x: 40, y: 30 }],
        [inner.id, { x: 60, y: 40 }],
      ]),
    );
    expect(absolute.get(inner.id)).toEqual({ x: 160, y: 110 });
    expect(absolute.get(child.id)).toEqual({ x: 200, y: 140 });
    const allMoved = absoluteCanvasMoves(
      index,
      new Map([
        [child.id, { x: 40, y: 30 }],
        [inner.id, { x: 50, y: 30 }],
        [outer.id, { x: 120, y: 90 }],
      ]),
    );
    expect(allMoved.get(child.id)).toEqual({ x: 210, y: 150 });
    expect(
      absoluteCanvasMoves(index, new Map([[child.id, { x: 50, y: 40 }]])).get(child.id),
    ).toEqual({ x: 200, y: 140 });
    expect(child).toMatchObject({ x: 190, y: 130 });
  });

  it('resolves thousands of reversed moved groups without recursion or repeated ancestor walks', () => {
    const graph = blankGraph('Deep groups');
    for (let index = 0; index < 6000; index++)
      graph.nodes.push(
        newNode(graph.diagram.id, {
          nodeType: index === 5999 ? 'process' : 'group',
          parentId: graph.nodes[index - 1]?.id,
          x: index * 5,
          y: index * 10,
        }),
      );
    const moves = new Map(
      [...graph.nodes].reverse().map((node) => [
        node.id,
        {
          x: node.parentId ? 5 : 50,
          y: node.parentId ? 10 : 100,
        },
      ]),
    );
    const absolute = absoluteCanvasMoves(
      new Map(graph.nodes.map((node) => [node.id, node])),
      moves,
    );
    expect(absolute.get(graph.nodes.at(-1)!.id)).toEqual({ x: 5999 * 5 + 50, y: 5999 * 10 + 100 });
    expect(absolute.size).toBe(6000);
  });
});
