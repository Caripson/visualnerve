import { afterEach, describe, expect, it, vi } from 'vitest';
import { getViewportForBounds, type Node, type ReactFlowInstance } from '@xyflow/react';
import { canvasFitPadding } from '../src/canvas/fit-padding';
import { fitDiagram } from '../src/drawing/navigation';
import { blankGraph, type Graph } from '../src/model/types';
import { drawingBounds, unionBounds } from '../src/drawing/geometry';
import { getDrawingLayer } from '../src/drawing/types';

afterEach(() => vi.restoreAllMocks());

function surface(height = 444) {
  const host = document.createElement('div');
  const tools = document.createElement('div');
  tools.className = 'canvas-tools-panel';
  host.append(tools);
  const canvas = new DOMRect(235, 426, 764, height);
  const panel = new DOMRect(535, canvas.bottom - 65, 164, 40);
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(canvas);
  vi.spyOn(tools, 'getBoundingClientRect').mockReturnValue(panel);
  return { host, tools, canvas, panel };
}

function flowFixture(bounds: { x: number; y: number; width: number; height: number }) {
  const visible: Node = { id: 'work', position: { x: bounds.x, y: bounds.y }, data: {} };
  const hidden: Node = { id: 'filtered', position: { x: -9999, y: -9999 }, data: {}, hidden: true };
  const flow = {
    fitView: vi.fn().mockResolvedValue(true),
    fitBounds: vi.fn().mockResolvedValue(true),
    setViewport: vi.fn().mockResolvedValue(true),
    getNodes: vi.fn(() => [visible, hidden]),
    getNodesBounds: vi.fn((nodes: Node[]) => {
      expect(nodes).toEqual([visible]);
      return bounds;
    }),
  };
  return { flow, instance: flow as unknown as ReactFlowInstance, visible, hidden };
}

describe('explicit canvas fit around floating tools', () => {
  it('keeps a tall rendered bank above the actual toolbar in a short desktop canvas', () => {
    const { host, canvas, panel } = surface();
    const bounds = { x: 40, y: -50, width: 920, height: 834 };
    const previous = getViewportForBounds(bounds, canvas.width, canvas.height, 0.05, 2, 0.25);
    expect(canvas.top + previous.y + (bounds.y + bounds.height) * previous.zoom).toBeGreaterThan(
      panel.top,
    );
    const padding = canvasFitPadding(0.25, host);
    const viewport = getViewportForBounds(bounds, canvas.width, canvas.height, 0.05, 2, padding);
    const bottom = canvas.top + viewport.y + (bounds.y + bounds.height) * viewport.zoom;
    expect(bottom).toBeLessThanOrEqual(panel.top - 8);
    expect(canvas.top + viewport.y + bounds.y * viewport.zoom).toBeGreaterThanOrEqual(canvas.top);
    expect(viewport.zoom).toBeGreaterThan(0.35);
    expect(padding).toEqual({ top: 0.25, right: 0.25, bottom: '73px', left: 0.25 });
  });

  it('retains sufficient ratio margins and ignores missing, hidden or outside toolbars', () => {
    const large = surface(900);
    expect(canvasFitPadding(0.25, large.host)).toBe(0.25);
    expect(canvasFitPadding(0.25)).toBe(0.25);
    expect(canvasFitPadding(0.25, document.createElement('div'))).toBe(0.25);
    const { host, tools } = surface();
    vi.mocked(tools.getBoundingClientRect).mockReturnValue(new DOMRect());
    expect(canvasFitPadding(0.25, host)).toBe(0.25);
    vi.mocked(tools.getBoundingClientRect).mockReturnValue(new DOMRect(2000, 400, 160, 40));
    expect(canvasFitPadding(0.25, host)).toBe(0.25);
  });

  it('uses the live fitView with the same zoom cap and requested animation for ordinary objects', async () => {
    const { host } = surface();
    const { flow, instance } = flowFixture({ x: 40, y: -50, width: 920, height: 834 });
    await fitDiagram(instance, blankGraph('Fit'), 0.25, 180, 1, {
      width: 764,
      height: 444,
      minZoom: 0.05,
      domNode: host,
    });
    expect(flow.fitView).toHaveBeenCalledWith({
      padding: { top: 0.25, right: 0.25, bottom: '73px', left: 0.25 },
      duration: 180,
      maxZoom: 1,
    });
    expect(flow.fitBounds).not.toHaveBeenCalled();
  });

  it('retains live rendered node and ink bounds for both fitBounds and capped viewport fit', async () => {
    const { host, canvas, panel } = surface();
    const bounds = { x: 40, y: -50, width: 920, height: 834 };
    const { flow, instance } = flowFixture(bounds);
    const graph: Graph = blankGraph('Fit with ink');
    graph.diagram.settings.drawing = {
      version: 1,
      visible: true,
      strokes: [
        {
          id: 'ink',
          color: '#126783',
          width: 8,
          points: [
            [-100, -100],
            [1000, 900],
          ],
        },
      ],
    };
    const expected = unionBounds(
      bounds,
      drawingBounds(getDrawingLayer(graph.diagram.settings.drawing)!.strokes),
    )!;
    const size = {
      width: canvas.width,
      height: canvas.height,
      minZoom: 0.05,
      maxZoom: 2,
      domNode: host,
    };
    await fitDiagram(instance, graph, 0.25, 180, undefined, size);
    expect(flow.fitBounds).not.toHaveBeenCalled();
    const uncapped = flow.setViewport.mock.calls[0][0];
    expect(
      canvas.top + uncapped.y + (expected.y + expected.height) * uncapped.zoom,
    ).toBeLessThanOrEqual(panel.top - 8);
    expect(canvas.left + uncapped.x + expected.x * uncapped.zoom).toBeGreaterThanOrEqual(
      canvas.left,
    );
    await fitDiagram(instance, graph, 0.25, 180, 0.2, size);
    const viewport = flow.setViewport.mock.calls[1][0];
    expect(viewport.zoom).toBe(0.2);
    expect(
      canvas.top + viewport.y + (expected.y + expected.height) * viewport.zoom,
    ).toBeLessThanOrEqual(panel.top - 8);
    expect(flow.setViewport.mock.calls[1][1]).toEqual({ duration: 180 });
    await fitDiagram(instance, graph, 0.25, 180, undefined, { ...size, domNode: undefined });
    expect(flow.fitBounds).toHaveBeenCalledWith(expected, { padding: 0.25, duration: 180 });
    graph.diagram.settings.overview = { version: 1, enabled: true, grouping: 'auto', expanded: [] };
    await fitDiagram(instance, graph, 0.25, 0, undefined, size);
    expect(flow.fitView).toHaveBeenLastCalledWith({
      padding: canvasFitPadding(0.25, host),
      duration: 0,
    });
  });
});
