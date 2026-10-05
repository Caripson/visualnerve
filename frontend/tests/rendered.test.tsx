import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawingSvg } from '../src/drawing/DrawingSvg';
import { graphPNG, renderedScene, type RenderOptions } from '../src/export/rendered';
import { blankGraph, newNode } from '../src/model/types';
import type { DrawingStroke } from '../src/drawing/types';

const mocks = vi.hoisted(() => ({
  toSvg: vi.fn(),
  decode: vi.fn(),
  setViewport: vi.fn(),
  drawImage: vi.fn(),
  hasNodes: false,
  imageWidth: 92,
  imageHeight: 92,
}));
vi.mock('html-to-image', () => ({ toSvg: mocks.toSvg }));
vi.mock('../src/nodes/registry', () => ({ nodeTypes: {} }));
vi.mock('../src/mindmap/Branch', () => ({ edgeTypes: {} }));
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ViewportPortal: ({ children }: { children: ReactNode }) => (
      <div className="react-flow__viewport-portal">{children}</div>
    ),
    ReactFlow: ({ children, nodes }: { children: ReactNode; nodes: unknown[] }) => {
      mocks.hasNodes = nodes.length > 0;
      return <div className="react-flow">{children}</div>;
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
  mocks.decode.mockResolvedValue(undefined);
  mocks.setViewport.mockResolvedValue(true);
  mocks.imageWidth = 92;
  mocks.imageHeight = 92;
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      width = mocks.imageWidth;
      height = mocks.imageHeight;
      decode = mocks.decode;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: mocks.drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('raster-image');
});
afterEach(() => {
  mocks.toSvg.mockReset();
  mocks.decode.mockReset();
  mocks.setViewport.mockReset();
  mocks.drawImage.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('.canvas-shell')?.remove();
  if (fonts) Object.defineProperty(document, 'fonts', fonts);
  else Reflect.deleteProperty(document, 'fonts');
});

function ink(points: [number, number][], width = 10): DrawingStroke {
  return { id: crypto.randomUUID(), color: '#ef0088', width, points };
}

describe('rendered exports with freehand annotations', () => {
  it('expands complete bounds for visible strokes outside nodes, without changing model geometry', () => {
    const graph = blankGraph('Annotated');
    graph.nodes.push(newNode(graph.diagram.id, { x: 100, y: 200, width: 200, height: 100 }));
    const stroke = ink([
      [-100, -50],
      [600, 350],
    ]);
    graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [stroke] };
    const before = structuredClone(graph);
    expect(renderedScene(graph, 'complete', []).bounds).toEqual({
      x: -105,
      y: -55,
      width: 710,
      height: 410,
    });
    expect(graph).toEqual(before);
  });

  it('keeps selection bounds while rendering ink for cropping and excludes unrelated nodes', () => {
    const graph = blankGraph('Selection');
    const selected = newNode(graph.diagram.id, { x: 100, y: 200, width: 200, height: 100 });
    graph.nodes = [selected, newNode(graph.diagram.id, { x: 5000, y: 5000 })];
    const stroke = ink([
      [-1000, -1000],
      [6000, 6000],
    ]);
    graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [stroke] };
    const scene = renderedScene(graph, 'selected', [selected.id]);
    expect(scene.bounds).toEqual({ x: 100, y: 200, width: 200, height: 100 });
    expect(scene.nodes.map((node) => node.id)).toEqual([selected.id]);
    expect(scene.strokes).toEqual([stroke]);
    expect(() => renderedScene(graph, 'selected', [])).toThrow('Select one or more nodes');
  });

  it('omits hidden ink from image content and bounds while retaining exact stored strokes', () => {
    const graph = blankGraph('Hidden ink');
    graph.nodes.push(newNode(graph.diagram.id, { x: 100, y: 200 }));
    const stroke = ink([
      [-1000, -1000],
      [5000, 5000],
    ]);
    graph.diagram.settings.drawing = { version: 1, visible: false, strokes: [stroke] };
    const scene = renderedScene(graph, 'complete', []);
    expect(scene.bounds).toEqual({ x: 100, y: 200, width: 200, height: 86 });
    expect(scene.strokes).toEqual([]);
    expect(graph.diagram.settings.drawing.strokes).toEqual([stroke]);
    expect(JSON.parse(JSON.stringify(graph)).diagram.settings.drawing.strokes).toEqual([stroke]);
    graph.nodes = [];
    expect(() => renderedScene(graph, 'complete', [])).toThrow('draw a stroke');
  });

  it('renders a drawing-only diagram without waiting for nonexistent nodes, with pen-radius bounds and cleanup', async () => {
    const graph = blankGraph('Just a dot');
    const dot = ink([[40, -20]], 12);
    graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [dot] };
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    let capturedMarkup = '';
    mocks.toSvg.mockImplementation(
      async (element: HTMLElement, capturedOptions: { width: number; height: number }) => {
        capturedMarkup = element.querySelector('[data-testid="drawing-layer"]')!.outerHTML;
        expect(capturedOptions).toMatchObject({ width: 92, height: 92, pixelRatio: 1 });
        return 'data:image/svg+xml;charset=utf-8,exported-dot';
      },
    );
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(
      'data:image/png;base64,exported-dot',
    );
    expect(await graphPNG(graph, options, [])).toBe('data:image/png;base64,exported-dot');
    expect(mocks.setViewport).toHaveBeenCalledWith({ x: 6, y: 66, zoom: 1 });
    const actual = document.createElement('div');
    actual.innerHTML = capturedMarkup;
    const shared = document.createElement('div');
    shared.innerHTML = renderToStaticMarkup(<DrawingSvg strokes={[dot]} />);
    expect(actual.querySelector('circle')!.outerHTML).toBe(
      shared.querySelector('circle')!.outerHTML,
    );
    expect(document.querySelector('.export-canvas')).toBeNull();
  });

  it('captures the viewport including the same live drawing SVG without changing its crop', async () => {
    const graph = blankGraph('Viewport');
    const stroke = ink([
      [10, 20],
      [100, 200],
    ]);
    graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [stroke] };
    const canvas = document.createElement('div');
    canvas.className = 'canvas-shell';
    canvas.innerHTML = `<div class="react-flow">${renderToStaticMarkup(<DrawingSvg strokes={[stroke]} />)}</div>`;
    document.body.append(canvas);
    mocks.toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,viewport');
    mocks.imageWidth = 640;
    mocks.imageHeight = 480;
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue('viewport-image');
    expect(await graphPNG(graph, { ...options, scope: 'viewport', multiplier: 2 }, [])).toBe(
      'viewport-image',
    );
    expect(mocks.toSvg).toHaveBeenCalledWith(
      canvas.firstElementChild,
      expect.objectContaining({ pixelRatio: 2 }),
    );
    expect(
      canvas.querySelector('[data-drawing-stroke-id]')!.getAttribute('data-drawing-stroke-id'),
    ).toBe(stroke.id);
    const captured = mocks.toSvg.mock.calls[0][1] as { filter: (element: HTMLElement) => boolean };
    const element = document.createElement('div');
    for (const className of ['drawing-surface', 'drawing-draft', 'react-flow__panel']) {
      element.className = className;
      expect(captured.filter(element)).toBe(false);
    }
    element.className = 'drawing-layer';
    expect(captured.filter(element)).toBe(true);
    const target = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances[0];
    expect(target).toMatchObject({ width: 1280, height: 960 });
  });

  it('waits for native SVG image decoding before drawing pixels or returning a PNG', async () => {
    const graph = blankGraph('Decode barrier');
    const shell = document.createElement('div');
    shell.className = 'canvas-shell';
    shell.innerHTML = '<div class="react-flow"></div>';
    document.body.append(shell);
    mocks.toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,complex-scene');
    let decoded!: () => void;
    mocks.decode.mockReturnValue(new Promise<void>((resolve) => (decoded = resolve)));
    const result = graphPNG(graph, { ...options, scope: 'viewport' }, []);
    await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
    expect(mocks.drawImage).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    decoded();
    expect(await result).toBe('raster-image');
    expect(mocks.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ src: 'data:image/svg+xml;charset=utf-8,complex-scene' }),
      0,
      0,
      92,
      92,
    );
  });
});
