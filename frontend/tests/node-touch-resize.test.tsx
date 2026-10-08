import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { nodeTypes } from '../src/nodes/registry';
import { projectGraph, type CanvasNode } from '../src/canvas/projection';
import { blankGraph, emptyFilters, newNode } from '../src/model/types';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import {
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../src/simulation/render-model';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  // Connection handles require React Flow's private NodeId provider; retain the actual resizer/store.
  Handle: () => null,
}));

afterEach(() => cleanup());

it.each(['flowchart', 'mindmap', 'simulation'] as const)(
  'preserves the actual D3 touch gesture through %s dimension renders',
  (mode) => {
    const simulation = mode === 'simulation';
    const graph = simulation
      ? createSimulationGraph('Touch resize', createBasicModel({ capacity: 2 }))
      : blankGraph('Touch resize', mode === 'mindmap' ? 'mindmap' : 'flowchart');
    if (!simulation)
      graph.nodes = [newNode(graph.diagram.id, { nodeType: 'process', width: 200, height: 140 })];
    const shape = simulation
      ? graph.nodes.find((node) => node.externalId === 'work')!
      : graph.nodes[0];
    shape.x = 0;
    shape.y = 0;
    shape.width = 200;
    const capacity = simulation
      ? projectSimulationCapacityNodes(graph, projectSimulationRenderModel(graph))
      : undefined;
    const rendered = capacity ? { ...graph, nodes: capacity.nodes, edges: capacity.edges } : graph;
    const resized = vi.fn();
    const node = projectGraph(
      rendered,
      [],
      [shape.id],
      [],
      emptyFilters,
      false,
      resized,
    ).nodes.find((node) => node.id === shape.id)!;
    const height = node.height!;
    const Renderer = nodeTypes[node.type!] as ComponentType<NodeProps<CanvasNode>>;
    const component = (width: number) => (
      <ReactFlowProvider initialNodes={[node]}>
        <Renderer
          {...node}
          selected
          dragging={false}
          draggable
          selectable
          deletable
          type={node.type!}
          zIndex={1}
          width={width}
          height={height}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          isConnectable
        />
      </ReactFlowProvider>
    );
    const { container, rerender } = render(component(200));
    const handle = container.querySelector('.react-flow__resize-control.handle.bottom.right')!;
    expect(handle).toBeTruthy();
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => {
      const point = { identifier: 1, clientX: x, clientY: y, pageX: x, pageY: y, target: handle };
      fireEvent[type](handle, {
        changedTouches: [point],
        touches: type === 'touchEnd' ? [] : [point],
        bubbles: true,
        cancelable: true,
      });
    };
    act(() => touch('touchStart', 200, height));
    act(() => touch('touchMove', 220, height + 10));
    // Every resize gesture causes node dimensions to render before it ends.
    rerender(component(220));
    act(() => touch('touchMove', 240, height + 25));
    act(() => touch('touchEnd', 240, height + 25));
    expect(resized).toHaveBeenCalledOnce();
    expect(resized).toHaveBeenCalledWith(node.id, {
      ...node.position,
      width: 240,
      height: height + 25,
    });
  },
);
