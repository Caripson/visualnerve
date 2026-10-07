import { describe, expect, it, vi } from 'vitest';
import {
  canvasViewportGraph,
  persistCanvasFocus,
  resizedCanvasViewport,
} from '../src/canvas/navigation';
import { instantiate } from '../src/templates/templates';
import { getSpatialView } from '../src/spatial/types';

it('keeps the same world centre and zoom when a phone rotates and returns', () => {
  const portrait = { width: 390, height: 679 };
  const landscape = { width: 844, height: 233 };
  const viewport = { x: -321, y: 82, zoom: 0.9 };
  const resized = resizedCanvasViewport(viewport, portrait, landscape);
  expect((landscape.width / 2 - resized.x) / resized.zoom).toBeCloseTo(
    (portrait.width / 2 - viewport.x) / viewport.zoom,
  );
  expect((landscape.height / 2 - resized.y) / resized.zoom).toBeCloseTo(
    (portrait.height / 2 - viewport.y) / viewport.zoom,
  );
  expect(resizedCanvasViewport(resized, landscape, portrait)).toEqual(viewport);
  expect(resizedCanvasViewport(viewport, portrait, { width: 0, height: 0 })).toBe(viewport);
});

function fixture() {
  let graph = instantiate('mind-map', 'Search focus');
  let selectedNodes = [graph.nodes[0].id];
  let active = true;
  let resolve!: (completed: boolean) => void;
  const viewport = { x: 321.123456, y: -48.345678, zoom: 1.1 };
  const options = {
    completion: new Promise<boolean>((done) => {
      resolve = done;
    }),
    diagramId: graph.diagram.id,
    nodeId: selectedNodes[0],
    active: () => active,
    current: () => ({ graph, selectedNodes }),
    viewport: () => viewport,
    persist: vi.fn((next: typeof viewport) => {
      graph = canvasViewportGraph(graph, options.diagramId, next, false)!;
    }),
  };
  return {
    options,
    resolve,
    viewport,
    graph: () => graph,
    changeGraph: (next: typeof graph) => {
      graph = next;
    },
    select: (ids: string[]) => {
      selectedNodes = ids;
    },
    replaceNavigation: () => {
      active = false;
    },
  };
}

describe('completed canvas search navigation', () => {
  it('saves the final viewport after animation and retains canonical drawing content', async () => {
    const f = fixture(),
      original = f.graph();
    const completion = persistCanvasFocus(f.options);
    expect(f.options.persist).not.toHaveBeenCalled();
    f.resolve(true);
    await completion;
    expect(f.graph().diagram.settings).toMatchObject({
      viewport: f.viewport,
      viewportDevice: 'desktop',
    });
    expect(f.graph().nodes).toBe(original.nodes);
    expect(f.graph().edges).toBe(original.edges);
    expect(original.diagram.settings.viewport).not.toEqual(f.viewport);
    expect(canvasViewportGraph(f.graph(), f.options.diagramId, f.viewport, false)).toBeNull();
  });
  it.each(['document', 'selection', 'new focus', '3d', 'overview'] as const)(
    'does not save a stale or transient %s navigation',
    async (change) => {
      const f = fixture();
      const completion = persistCanvasFocus(f.options);
      if (change === 'document') f.changeGraph(instantiate('mind-map', 'Another document'));
      if (change === 'selection') f.select([]);
      if (change === 'new focus') f.replaceNavigation();
      if (change === '3d') {
        const graph = f.graph();
        f.changeGraph({
          ...graph,
          diagram: {
            ...graph.diagram,
            settings: {
              ...graph.diagram.settings,
              spatialView: { ...getSpatialView(graph), mode: '3d' },
            },
          },
        });
      }
      if (change === 'overview') {
        const graph = f.graph();
        f.changeGraph({
          ...graph,
          diagram: {
            ...graph.diagram,
            settings: {
              ...graph.diagram.settings,
              overview: { version: 1, enabled: true, grouping: 'auto', expanded: [] },
            },
          },
        });
      }
      f.resolve(true);
      await completion;
      expect(f.options.persist).not.toHaveBeenCalled();
    },
  );
  it('does not save a cancelled animation or invalid camera and tracks touch separately', async () => {
    const f = fixture();
    const completion = persistCanvasFocus(f.options);
    f.resolve(false);
    await completion;
    expect(f.options.persist).not.toHaveBeenCalled();
    expect(
      canvasViewportGraph(f.graph(), f.options.diagramId, { ...f.viewport, zoom: NaN }, false),
    ).toBeNull();
    expect(
      canvasViewportGraph(f.graph(), f.options.diagramId, f.viewport, true)!.diagram.settings
        .viewportDevice,
    ).toBe('touch');
  });
});
