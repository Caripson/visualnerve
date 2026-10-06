import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph } from '../src/model/types';
import { VideoVectors } from '../src/presentation/video-vectors';
import type { VideoCanvasInfo } from '../src/presentation/video-frame-events';

const paths: string[] = [];
beforeEach(() => {
  paths.length = 0;
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(public data: string) {
        paths.push(data);
      }
    },
  );
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}
function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  host.innerHTML = `<svg class="react-flow__marker"><defs><marker id="arrow" markerWidth="20" markerHeight="20" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse"><polyline style="fill:red;stroke:red;stroke-width:1" points="-5,-4 0,0 -5,4 -5,-4" /></marker></defs></svg>
    <div class="react-flow__viewport"><svg><g class="react-flow__edge" data-id="edge1" style="opacity:.5">
      <path class="react-flow__edge-path" d="M 0 0 C 20 0 30 50 50 50" marker-end="url('#arrow')" style="stroke:blue;stroke-width:2;fill:none;stroke-dasharray:5,3"/>
      <g transform="translate(25 25)"><rect class="react-flow__edge-textbg" x="-2" y="-4" width="44" height="20" rx="2" style="fill:white"/><text class="react-flow__edge-text" y="6" dy=".3em" style="fill:green;font-size:12px;font-family:Arial">relation</text></g>
    </g></svg></div>`;
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 10 } as DOMRect);
  for (const element of host.querySelectorAll<SVGGraphicsElement>('path,rect,text')) {
    element.getScreenCTM = () => ({ a: 2, b: 0, c: 0, d: 2, e: 120, f: 80 }) as DOMMatrix;
  }
  const path = host.querySelector('path')!;
  path.getTotalLength = () => 100;
  path.getPointAtLength = (length: number) => ({ x: length / 2, y: length / 2 }) as DOMPoint;
  const info: VideoCanvasInfo = {
    graph: blankGraph('vectors'),
    nodes: [],
    edges: [{ id: 'edge1', source: 'a', target: 'b' }],
    host,
    width: 800,
    height: 600,
    viewport: { x: 100, y: 70, zoom: 2 },
    absolute: () => undefined,
  };
  return { host, info };
}

it('compiles exact native curves, arrowheads, label backgrounds and text once, preserving opacity and dash style', () => {
  const { info } = setup(),
    renderer = new VideoVectors(info.host),
    ctx = context();
  try {
    renderer.update(info);
    renderer.drawEdges(ctx);
    expect(paths).toContain('M 0 0 C 20 0 30 50 50 50');
    expect(paths).toContain('M -5,-4 0,0 -5,4 -5,-4');
    expect(ctx.transform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 3]);
    expect(ctx.translate).toHaveBeenCalledWith(50, 50);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(ctx.roundRect).toHaveBeenCalledWith(-2, -4, 44, 20, 2);
    expect(ctx.fillText).toHaveBeenCalledWith('relation', 0, 9.6);
    const count = paths.length;
    renderer.update(info);
    renderer.drawEdges(ctx);
    expect(paths).toHaveLength(count);
  } finally {
    renderer.dispose();
  }
});

it('retains compiled virtualized edge geometry during camera movement and removes deleted edges', async () => {
  const { host, info } = setup(),
    renderer = new VideoVectors(host),
    ctx = context();
  try {
    renderer.update(info);
    host.querySelector('.react-flow__edge')!.remove();
    await Promise.resolve();
    info.viewport = { x: 600, y: 300, zoom: 3 };
    renderer.update(info);
    renderer.drawEdges(ctx);
    expect(ctx.stroke).toHaveBeenCalled();
    vi.mocked(ctx.stroke).mockClear();
    info.edges = [];
    renderer.update(info);
    renderer.drawEdges(ctx);
    expect(ctx.stroke).not.toHaveBeenCalled();
  } finally {
    renderer.dispose();
  }
});

it('draws native midpoint pen curves and single-point dots above the cards, respecting drawing visibility', () => {
  const { info } = setup(),
    renderer = new VideoVectors(info.host),
    ctx = context();
  info.graph.diagram.settings.drawing = {
    version: 1,
    visible: true,
    strokes: [
      {
        id: 'curve',
        color: '#aa3322',
        width: 4,
        points: [
          [10, 20],
          [20, 30],
          [40, 50],
        ],
      },
      { id: 'point', color: '#334455', width: 6, points: [[80, 90]] },
    ],
  };
  try {
    renderer.update(info);
    renderer.drawDrawing(ctx);
    expect(paths).toContain('M 10 20 Q 20 30 30 40 L 40 50');
    expect(ctx.arc).toHaveBeenCalledWith(80, 90, 3, 0, Math.PI * 2);
    expect(ctx.lineWidth).toBe(6);
    expect(ctx.fillStyle).toBe('#334455');
    vi.mocked(ctx.stroke).mockClear();
    vi.mocked(ctx.arc).mockClear();
    info.graph.diagram.settings.drawing = {
      ...info.graph.diagram.settings.drawing,
      visible: false,
    };
    renderer.update(info);
    renderer.drawDrawing(ctx);
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  } finally {
    renderer.dispose();
  }
});
