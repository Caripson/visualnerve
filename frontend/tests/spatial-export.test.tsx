import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { getViewportForBounds } from '@xyflow/react';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import {
  exportRendered,
  graphPNG,
  rendered2DViewport,
  renderedScene,
  type RenderOptions,
} from '../src/export/rendered';
const mocks = vi.hoisted(() => ({
  toSvg: vi.fn(),
  setViewport: vi.fn(),
  drawImage: vi.fn(),
  download: vi.fn(),
  pdfImage: vi.fn(),
  hasNodes: false,
}));
vi.mock('html-to-image', () => ({ toSvg: mocks.toSvg }));
vi.mock('../src/nodes/registry', () => ({ nodeTypes: {} }));
vi.mock('../src/mindmap/Branch', () => ({ edgeTypes: {} }));
vi.mock('../src/export/semantic', () => ({ download: mocks.download, safeName: () => 'spatial' }));
vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    addImage = mocks.pdfImage;
    output = () => new Blob(['pdf']);
  },
}));
vi.mock('@xyflow/react', async (original) => {
  const actual = await original<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ViewportPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ReactFlow: ({ children, nodes }: { children: ReactNode; nodes: { id: string }[] }) => {
      mocks.hasNodes = nodes.length > 0;
      return (
        <div className="react-flow" data-node-ids={nodes.map((node) => node.id).join(',')}>
          {children}
        </div>
      );
    },
    useNodesInitialized: () => mocks.hasNodes,
    useReactFlow: () => ({ viewportInitialized: true, setViewport: mocks.setViewport }),
  };
});
const options: RenderOptions = {
  scope: 'complete',
  multiplier: 1,
  page: 'a4',
  orientation: 'landscape',
  tiled: false,
};
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
beforeEach(() => {
  mocks.setViewport.mockResolvedValue(true);
  mocks.toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,2d-diagram');
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    'Image',
    class {
      width = 640;
      height = 480;
      onload?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
      decode = () => Promise.resolve();
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: mocks.drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,2d');
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('.canvas-shell')?.remove();
  if (fonts) Object.defineProperty(document, 'fonts', fonts);
  else Reflect.deleteProperty(document, 'fonts');
});
function graph(): Graph {
  const graph = blankGraph('Spatial diagram');
  const left = newNode(graph.diagram.id, {
    title: 'Plan',
    x: 100,
    y: 200,
    width: 200,
    height: 100,
  });
  const right = newNode(graph.diagram.id, {
    title: 'Ship',
    x: 500,
    y: 200,
    width: 200,
    height: 100,
  });
  left.metadata.spatial = { version: 1, position: { x: -900, y: 3000, z: 700 } };
  right.metadata.spatial = { version: 1, position: { x: 900, y: -3000, z: -700 } };
  graph.nodes = [left, right];
  graph.edges = [
    newEdge(graph.diagram.id, left.id, right.id, { label: 'Ready', direction: 'both' }),
  ];
  graph.diagram.settings.spatialView = {
    version: 1,
    mode: '3d',
    camera: { position: { x: 15, y: 27, z: 90 }, target: { x: 0, y: 0, z: 0 } },
  };
  graph.diagram.settings.drawing = {
    version: 1,
    visible: true,
    strokes: [
      {
        id: 'ink',
        color: '#ff00aa',
        width: 8,
        points: [
          [80, 160],
          [740, 160],
        ],
      },
    ],
  };
  return graph;
}
function shell() {
  const element = document.createElement('div');
  element.className = 'canvas-shell';
  element.innerHTML = '<canvas data-testid="spatial-canvas"></canvas>';
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width: 640,
    height: 480,
  } as DOMRect);
  document.body.append(element);
  return element;
}
describe('2D export while the interactive diagram is 3D', () => {
  it.each(['complete', 'selected'] as const)(
    'renders %s from canonical 2D geometry with ink when no ReactFlow is mounted',
    async (scope) => {
      const source = graph();
      const before = structuredClone(source);
      shell();
      let capturedIds = '';
      mocks.toSvg.mockImplementation(async (element: HTMLElement) => {
        expect(element.closest('.export-canvas')).not.toBeNull();
        expect(element.querySelector('[data-drawing-stroke-id="ink"]')).not.toBeNull();
        capturedIds = element.dataset.nodeIds!;
        return 'data:image/svg+xml;charset=utf-8,2d-diagram';
      });
      expect(await graphPNG(source, { ...options, scope }, [source.nodes[0].id])).toContain(
        'data:image/png',
      );
      expect(capturedIds.split(',')).toEqual(
        scope === 'selected' ? [source.nodes[0].id] : source.nodes.map((node) => node.id),
      );
      expect(mocks.setViewport).toHaveBeenCalledWith(
        scope === 'selected' ? { x: -60, y: -160, zoom: 1 } : { x: -36, y: -116, zoom: 1 },
      );
      expect(source).toEqual(before);
      expect(document.querySelector('.export-canvas')).toBeNull();
    },
  );
  it('uses the saved 2D crop and canvas dimensions instead of the 3D camera or a hidden live flow', async () => {
    const source = graph();
    source.diagram.settings.viewport = { x: 23, y: -91, zoom: 0.75 };
    const canvas = shell();
    canvas.append(Object.assign(document.createElement('div'), { className: 'react-flow' }));
    await graphPNG(source, { ...options, scope: 'viewport', multiplier: 2 }, []);
    expect(mocks.setViewport).toHaveBeenCalledWith({ x: 23, y: -91, zoom: 0.75 });
    expect(mocks.toSvg.mock.calls[0][0]).not.toBe(canvas.querySelector('.react-flow'));
    expect(mocks.toSvg.mock.calls[0][1]).toMatchObject({ width: 640, height: 480, pixelRatio: 2 });
    expect(source.diagram.settings.viewport).toEqual({ x: 23, y: -91, zoom: 0.75 });
  });
  it('fits canonical nodes and visible ink when a valid 2D crop has never been saved', async () => {
    const source = graph();
    const bounds = renderedScene(source, 'complete', []).bounds;
    const expected = getViewportForBounds(bounds, 640, 480, 0.01, 1, 0.2);
    expect(rendered2DViewport(source, bounds, { width: 640, height: 480 })).toEqual(expected);
    source.diagram.settings.viewport = { x: 0, y: 0, zoom: 0 };
    shell();
    await graphPNG(source, { ...options, scope: 'viewport' }, []);
    expect(mocks.setViewport).toHaveBeenCalledWith(expected);
    expect(source.diagram.settings.viewport.zoom).toBe(0);
  });
  it('keeps CSV summaries and visible source groups without exposing retained groups', () => {
    const dataset = parseCsv('Customer,Amount\nAda,2\nAda,3\nBen,9', 'customers.csv');
    const analysis = defaultAnalysis(dataset);
    analysis.levels = ['c0'];
    analysis.metrics = [{ id: 'sum', operation: 'sum', columnId: 'c1' }];
    const source = csvGraph(dataset, analysis);
    source.diagram.settings.spatialView = { version: 1, mode: '3d' };
    const hidden = source.nodes.find((node) => node.title === 'Ben')!;
    (hidden.metadata.csv as { visible?: boolean }).visible = false;
    const before = structuredClone(source);
    const scene = renderedScene(source, 'complete', []);
    expect(scene.nodes.some((node) => node.id === hidden.id)).toBe(false);
    expect(
      scene.nodes.find((node) => node.data.node.title === 'Ada')!.data.node.metadata.csv,
    ).toMatchObject({ measures: [{ id: 'sum', value: 5 }] });
    expect(source).toEqual(before);
  });
  it('prints the isolated 2D raster into PDF without needing a WebGL canvas', async () => {
    const source = graph();
    shell();
    await exportRendered(source, 'pdf', options, []);
    expect(mocks.pdfImage).toHaveBeenCalledWith(
      'data:image/png;base64,2d',
      'PNG',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      undefined,
      'FAST',
    );
    expect(mocks.download).toHaveBeenCalledWith('spatial.pdf', expect.any(Blob), 'application/pdf');
    expect(mocks.drawImage).toHaveBeenCalledOnce();
  });
});
