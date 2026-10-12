import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, CSSProperties } from 'react';
import type { NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { projectGraph, type CanvasNode } from '../src/canvas/projection';
import { nodeTypes } from '../src/nodes/registry';
import { useEditor } from '../src/state/editor';
import { getIbmSymbol } from '../src/flowchart/ibm-symbols';
import { SvgModelRenderer } from '../src/export/svg-model-renderer';
import { MessageFormatter } from '../src/i18n/message-formatter';
import en from '../src/i18n/catalogs/en';
import {
  createSpatialBatches,
  disposeSpatialScene,
  spatialNodeAppearance,
} from '../src/spatial/scene';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: ({ id, style }: { id: string; style: CSSProperties }) => (
    <div data-port={id} style={style} />
  ),
  NodeResizer: () => null,
  useUpdateNodeInternals: () => refresh,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));
beforeEach(() => {
  useEditor.getState().setGraph(null);
  refresh.mockClear();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const graph = blankGraph('Mixed topics', 'mindmap');
  const root = newNode(graph.diagram.id, { title: 'Plan', width: 300, height: 200 });
  const input = newNode(graph.diagram.id, {
    title: 'Receive requests',
    nodeType: 'process',
    parentId: root.id,
    x: 500,
    width: 300,
    height: 200,
    color: '#ab5522',
    flowchartSymbol: 'ibm-input-output',
  });
  const manual = newNode(graph.diagram.id, {
    title: 'Review requests',
    nodeType: 'process',
    parentId: root.id,
    x: -500,
    width: 300,
    height: 200,
    color: '#4b7bba',
    flowchartSymbol: 'ibm-manual-operation',
  });
  const topic = newNode(graph.diagram.id, {
    title: 'Follow up',
    parentId: input.id,
    x: 1000,
    width: 300,
    height: 200,
  });
  graph.nodes = [root, input, manual, topic];
  const cross = newEdge(graph.diagram.id, manual.id, input.id, {
    label: 'Coordinate',
    direction: 'forward',
  });
  graph.edges = [cross];
  return { graph, root, input, manual, topic, cross };
}

function draw(views: CanvasNode[]) {
  return (
    <>
      {views.map((view) => {
        const Renderer = nodeTypes[view.type!] as ComponentType<NodeProps<CanvasNode>>;
        return (
          <Renderer
            key={view.id}
            {...view}
            type={view.type!}
            selected={false}
            dragging={false}
            draggable
            selectable
            deletable
            isConnectable
            zIndex={1}
            width={view.width!}
            height={view.height!}
            positionAbsoluteX={view.position.x}
            positionAbsoluteY={view.position.y}
          />
        );
      })}
    </>
  );
}

it('keeps ordinary topics and hierarchy while routing mixed left/right stencil branches to exposed ports', () => {
  const { graph, root, input, manual, topic, cross } = fixture();
  const before = structuredClone(graph);
  const projected = projectGraph(graph, []);
  const view = (id: string) => projected.nodes.find((node) => node.id === id)!;
  expect(view(root.id).type).toBe('mindmap-topic');
  expect(view(topic.id).type).toBe('mindmap-topic');
  expect(view(input.id).type).toBe('process');
  expect(view(manual.id).type).toBe('process');
  expect(view(input.id).data.mindmap).toEqual({ depth: 1, color: '#ab5522', side: 'right' });
  expect(view(topic.id).data.mindmap).toEqual({ depth: 2, color: '#ab5522', side: 'right' });
  expect(projected.edges.find((edge) => edge.id === `hierarchy:${manual.id}`)).toMatchObject({
    type: 'mindmap-branch',
    sourceHandle: 'source-left',
    targetHandle: 'target-right',
    style: { stroke: '#4b7bba', strokeWidth: 4 },
    markerEnd: undefined,
  });
  expect(projected.edges.find((edge) => edge.id === `hierarchy:${topic.id}`)).toMatchObject({
    sourceHandle: 'source-right',
    targetHandle: 'target-left',
    style: { stroke: '#ab5522', strokeWidth: 2.5 },
  });
  expect(projected.edges.find((edge) => edge.id === cross.id)?.markerEnd).toBeDefined();
  expect(graph).toEqual(before);
  const { container, rerender } = render(draw(projected.nodes));
  const card = container.querySelector<HTMLElement>(`[data-node-id="${input.id}"]`)!;
  expect(card.style.getPropertyValue('--node-accent')).toBe('#ab5522');
  expect(card.querySelector('.ibm-node-shape .ibm-symbol-outline')?.getAttribute('d')).toBe(
    getIbmSymbol('ibm-input-output')!.outlinePath,
  );
  expect(card.querySelector<HTMLElement>('[data-port="target-left"]')!.style.left).toBe('7.5%');
  expect(card.querySelector<HTMLElement>('[data-port="source-right"]')!.style.left).toBe('92.5%');
  expect(card.querySelector('[data-port="source-left"]')).not.toBeNull();
  expect(card.querySelector('[data-port="target-right"]')).not.toBeNull();
  expect(container.querySelector(`[data-node-id="${root.id}"]`)?.className).toContain(
    'mindmap-root',
  );
  graph.nodes = graph.nodes.map((node) =>
    node.id === input.id ? { ...node, flowchartSymbol: undefined } : node,
  );
  rerender(draw(projectGraph(graph, []).nodes));
  expect(container.querySelector(`[data-node-id="${input.id}"]`)?.className).toContain(
    'mindmap-main',
  );
  expect(container.querySelector(`[data-node-id="${input.id}"] .ibm-node-shape`)).toBeNull();
  expect(refresh).toHaveBeenCalledWith(input.id);
});

it('uses the shared in-node title draft and Enter commit for a stencil topic', () => {
  const { graph, input } = fixture();
  useEditor.getState().setGraph(graph);
  render(draw(projectGraph(graph, []).nodes));
  act(() => useEditor.getState().beginEditing(input.id)); // F2 uses this same editor action.
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Approved requests' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  expect(useEditor.getState().graph!.nodes.find((node) => node.id === input.id)?.title).toBe(
    input.title,
  );
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(useEditor.getState().graph!.nodes.find((node) => node.id === input.id)).toMatchObject({
    title: 'Approved requests',
    flowchartSymbol: 'ibm-input-output',
    parentId: input.parentId,
  });
  expect(useEditor.getState().editingNode).toBeNull();
});

it('exports native stencil shapes and independently specified branch endpoints without changing ordinary topics', () => {
  const { graph, root, input, manual, topic, cross } = fixture();
  const rendered = new SvgModelRenderer({
    measure: (text, size) => text.length * size * 0.55,
  }).render(
    {
      graph,
      options: {},
      locale: 'en',
      viewportSize: { width: 800, height: 600 },
      theme: {
        background: '#fafaf7',
        node: '#ffffff',
        surface: '#fdfdfb',
        text: '#1f2d28',
        muted: '#56675d',
        border: '#e2e5df',
        doneBackground: '#dcfce7',
        doneText: '#075b2c',
        doneBorder: '#16803d',
      },
    },
    new MessageFormatter('en', en),
  );
  const svg = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
  expect(svg.querySelector(`[data-node-id="${root.id}"] [data-ibm-outline]`)).toBeNull();
  expect(svg.querySelector(`[data-node-id="${topic.id}"] [data-ibm-outline]`)).toBeNull();
  expect(
    svg.querySelector(`[data-node-id="${input.id}"] [data-ibm-outline]`)?.getAttribute('stroke'),
  ).toBe('#ab5522');
  expect(
    svg.querySelector(`[data-node-id="${manual.id}"] [data-ibm-outline]`)?.getAttribute('d'),
  ).toBe(getIbmSymbol('ibm-manual-operation')!.outlinePath);
  const cases = [
    [`hierarchy:${input.id}`, [300, 100], [522.5, 100]],
    [`hierarchy:${manual.id}`, [0, 100], [-236, 100]],
    [`hierarchy:${topic.id}`, [777.5, 100], [1000, 100]],
    [cross.id, [-236, 100], [522.5, 100]],
  ] as const;
  for (const [id, start, end] of cases) {
    const numbers = svg
      .querySelector(`[data-edge-id="${id}"] path`)!
      .getAttribute('d')!
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
      .map(Number);
    expect(numbers.slice(0, 2)).toEqual(start);
    expect(numbers.slice(-2)).toEqual(end);
  }
});

it('extrudes mixed stencil topics and keeps inherited accents plus real contour connections in 3D', () => {
  const { graph, root, input, manual, topic } = fixture();
  const projected = projectGraph(graph, []);
  const positions = new Map(graph.nodes.map((node) => [node.id, { x: node.x / 100, y: 0, z: 0 }]));
  const batches = createSpatialBatches(projected.nodes, projected.edges, positions);
  try {
    expect(batches.nodes.get(input.id)!.mesh.geometry.userData.flowchartSymbol).toBe(
      'ibm-input-output',
    );
    expect(batches.nodes.get(manual.id)!.mesh.geometry.userData.flowchartSymbol).toBe(
      'ibm-manual-operation',
    );
    expect(batches.nodes.get(root.id)!.mesh.geometry.userData.flowchartSymbol).toBeUndefined();
    expect(batches.nodes.get(topic.id)!.mesh.geometry.userData.flowchartSymbol).toBeUndefined();
    const appearance = spatialNodeAppearance(projected.nodes.find((node) => node.id === input.id)!);
    expect(appearance).toEqual({ accent: '#ab5522', background: '#ffffff', color: '#182c25' });
    const right = batches.edgePoints.get(`hierarchy:${input.id}`)!;
    expect(right.at(-1)!.x).toBeCloseTo(5 - 1.275, 8);
    const left = batches.edgePoints.get(`hierarchy:${manual.id}`)!;
    expect(left.at(-1)!.x).toBeCloseTo(-5 + 1.14, 8);
  } finally {
    disposeSpatialScene(batches.group);
  }
});
