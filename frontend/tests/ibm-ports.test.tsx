import { render } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ibmPortPoint, type IBMPortSide } from '../src/flowchart/ibm-ports';
import { ibmSymbols, type IBMSymbolId } from '../src/flowchart/ibm-symbols';
import { IbmNodePorts } from '../src/flowchart/IbmNodePorts';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { projectGraph, type RenderCache } from '../src/canvas/projection';
import { SvgModelRenderer } from '../src/export/svg-model-renderer';
import { MessageFormatter } from '../src/i18n/message-formatter';
import type { SvgWorkerRequest } from '../src/export/svg-job-types';
import en from '../src/i18n/catalogs/en';
import { createIbmFlowchartGraph } from '../src/flowchart/template';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useUpdateNodeInternals: () => refresh,
  Handle: ({ id, style }: { id: string; style: CSSProperties }) => (
    <div data-port={id} style={style} />
  ),
}));
beforeEach(() => refresh.mockClear());

const fixtures: [IBMSymbolId, IBMPortSide, number, number][] = [
  ['ibm-input-output', 'left', 0.075, 0.5],
  ['ibm-input-output', 'right', 0.925, 0.5],
  ['ibm-manual-operation', 'left', 0.12, 0.5],
  ['ibm-manual-operation', 'right', 0.88, 0.5],
  ['ibm-document', 'bottom', 0.5, 0.91],
  ['ibm-magnetic-disk', 'left', 0, 0.5],
  ['ibm-magnetic-disk', 'right', 1, 0.5],
];
it.each(fixtures)(
  'places %s %s port on its independently specified outline coordinate',
  (id, side, x, y) => {
    const point = ibmPortPoint(id, side);
    expect(point[0]).toBeCloseTo(x, 10);
    expect(point[1]).toBeCloseTo(y, 10);
  },
);
it('removes the 22.5px I/O and 36px manual-operation side gaps and the 18px document bottom gap', () => {
  expect(ibmPortPoint('ibm-input-output', 'left')[0] * 300).toBeCloseTo(22.5, 10);
  expect((1 - ibmPortPoint('ibm-input-output', 'right')[0]) * 300).toBeCloseTo(22.5, 10);
  expect(ibmPortPoint('ibm-manual-operation', 'left')[0] * 300).toBeCloseTo(36, 10);
  expect((1 - ibmPortPoint('ibm-manual-operation', 'right')[0]) * 300).toBeCloseTo(36, 10);
  expect((1 - ibmPortPoint('ibm-document', 'bottom')[1]) * 200).toBeCloseTo(18, 10);
  for (const symbol of ibmSymbols)
    for (const side of ['left', 'right', 'top', 'bottom'] as const)
      for (const coordinate of ibmPortPoint(symbol.id, side)) {
        expect(Number.isFinite(coordinate)).toBe(true);
        expect(coordinate).toBeGreaterThanOrEqual(0);
        expect(coordinate).toBeLessThanOrEqual(1);
      }
});
it('refreshes same-sized handles when the glyph changes and when clearing restores ordinary ports', () => {
  const props = {
    id: 'node',
    width: 300,
    height: 200,
    connectable: true,
    exporting: false,
    layoutProjected: false,
  };
  const { container, rerender, unmount } = render(
    <IbmNodePorts {...props} symbol="ibm-input-output" />,
  );
  expect(refresh).toHaveBeenCalledWith('node');
  expect(container.querySelector<HTMLElement>('[data-port="in"]')!.style.left).toBe('7.5%');
  expect(container.querySelector<HTMLElement>('[data-port="out"]')!.style.left).toBe('92.5%');
  // The handle's outer edge is the routed endpoint, including at high/low zoom.
  expect(container.querySelector<HTMLElement>('[data-port="out"]')!.style.transform).toBe(
    'translate(-100%, -50%)',
  );
  refresh.mockClear();
  rerender(<IbmNodePorts {...props} symbol="ibm-manual-operation" />);
  expect(refresh).toHaveBeenCalledWith('node');
  expect(container.querySelector<HTMLElement>('[data-port="in"]')!.style.left).toBe('12%');
  expect(container.querySelector<HTMLElement>('[data-port="out"]')!.style.left).toBe('88%');
  rerender(<IbmNodePorts {...props} symbol="ibm-document" />);
  expect(container.querySelector<HTMLElement>('[data-port="out-bottom"]')!.style.top).toBe('91%');
  refresh.mockClear();
  unmount();
  expect(refresh).toHaveBeenCalledWith('node');
});
it('restores the template bottom/top routes and ignores invalid, wrong-role and ordinary-node metadata', () => {
  const graph = createIbmFlowchartGraph('IBM route sides'),
    document = graph.nodes.find((node) => node.title === 'Print batch report')!,
    terminal = graph.nodes.find((node) => node.title === 'Batch complete')!,
    route = graph.edges.find(
      (edge) => edge.sourceNodeId === document.id && edge.targetNodeId === terminal.id,
    )!;
  const cache: RenderCache = { nodes: new Map(), edges: new Map() };
  const project = () =>
    projectGraph(graph, [], [], [], undefined, false, undefined, undefined, cache).edges.find(
      (edge) => edge.id === route.id,
    )!;
  expect(project().sourceHandle).toBe('out-bottom');
  expect(project().targetHandle).toBe('in-top');
  const no = graph.edges.find((edge) => edge.label === 'No')!;
  expect(projectGraph(graph, []).edges.find((edge) => edge.id === no.id)).toMatchObject({
    sourceHandle: 'out-bottom',
    targetHandle: 'in-top',
  });
  graph.nodes = graph.nodes.map((node) =>
    node.id === document.id ? { ...node, flowchartSymbol: undefined } : node,
  );
  expect(project().sourceHandle).toBeUndefined();
  expect(project().targetHandle).toBe('in-top');
  route.metadata = { sourceHandle: 'out-bottom', targetHandle: 'out-bottom' };
  expect(project().targetHandle).toBeUndefined();
  graph.nodes = graph.nodes.map((node) =>
    node.id === document.id ? { ...node, flowchartSymbol: 'ibm-document' } : node,
  );
  route.metadata = { sourceHandle: 'invented', targetHandle: 'in-top' };
  expect(project().sourceHandle).toBeUndefined();
  graph.diagram.type = 'mindmap';
  expect(project().sourceHandle).toMatch(/^source-/);
  expect(project().targetHandle).toMatch(/^target-/);
});

it('exports endpoints on independent contour fixtures using the same routed sides as 2D', () => {
  const graph = blankGraph('IBM connector endpoints', 'flowchart');
  const input = newNode(graph.diagram.id, {
      flowchartSymbol: 'ibm-input-output',
      x: 100,
      y: 50,
      width: 300,
      height: 200,
    }),
    process = newNode(graph.diagram.id, { x: 500, y: 50, width: 300, height: 200 }),
    manual = newNode(graph.diagram.id, {
      flowchartSymbol: 'ibm-manual-operation',
      x: 900,
      y: 300,
      width: 300,
      height: 200,
    }),
    document = newNode(graph.diagram.id, {
      flowchartSymbol: 'ibm-document',
      x: 1300,
      y: 300,
      width: 300,
      height: 200,
    }),
    terminal = newNode(graph.diagram.id, {
      flowchartSymbol: 'ibm-terminal',
      x: 1300,
      y: 700,
      width: 310,
      height: 120,
    });
  graph.nodes = [input, process, manual, document, terminal];
  graph.edges = [
    newEdge(graph.diagram.id, input.id, process.id),
    newEdge(graph.diagram.id, manual.id, input.id),
    newEdge(graph.diagram.id, document.id, terminal.id, {
      metadata: { sourceHandle: 'out-bottom', targetHandle: 'in-top' },
    }),
  ];
  const request: SvgWorkerRequest = {
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
  };
  const result = new SvgModelRenderer({
    measure: (text, size) => text.length * size * 0.55,
  }).render(request, new MessageFormatter('en', en));
  const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  const expected = [
    [
      [377.5, 150],
      [500, 150],
    ],
    [
      [1164, 400],
      [122.5, 150],
    ],
    [
      [1450, 482],
      [1455, 700],
    ],
  ];
  for (const [index, edge] of graph.edges.entries()) {
    const d = svg.querySelector(`[data-edge-id="${edge.id}"] > path`)!.getAttribute('d')!,
      values = d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    expect(values[0]).toBeCloseTo(expected[index][0][0], 8);
    expect(values[1]).toBeCloseTo(expected[index][0][1], 8);
    expect(values.at(-2)).toBeCloseTo(expected[index][1][0], 8);
    expect(values.at(-1)).toBeCloseTo(expected[index][1][1], 8);
  }
});
