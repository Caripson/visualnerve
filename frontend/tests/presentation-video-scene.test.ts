import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import { useEditor } from '../src/state/editor';
import {
  VIDEO_CANVAS_INFO,
  VIDEO_SPATIAL_FRAME,
  VIDEO_SPATIAL_PREPARE,
  VIDEO_SPATIAL_LIMIT_ERROR,
  type VideoCanvasInfo,
  type VideoCanvasInfoRequest,
  type VideoSpatialFrameRequest,
  type VideoSpatialPrepareRequest,
} from '../src/presentation/video-frame-events';
import {
  createVideoScene,
  videoFrameBounds,
  videoSpriteRatio,
  videoVisibleCards,
  VIDEO_SCENE_CACHE_BYTES,
} from '../src/presentation/video-scene';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  vectorsUpdate: vi.fn(),
  vectorsDraw: vi.fn(),
  vectorsDispose: vi.fn(),
}));
vi.mock('../src/spatial/faces', () => ({
  SPATIAL_FACE_CAPTURE_LIMIT: 120,
  captureSpatialNodeFaces: mocks.capture,
}));
vi.mock('../src/presentation/video-vectors', () => ({
  VideoVectors: class {
    update = mocks.vectorsUpdate;
    drawEdges = mocks.vectorsDraw;
    drawDrawing = vi.fn();
    dispose = mocks.vectorsDispose;
  },
}));
let detach: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockImplementation(
    async (_graph, views, _signal, { pixelRatio }) =>
      new Map(
        views.map((view: VideoCanvasInfo['nodes'][number]) => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(view.width! * pixelRatio));
          canvas.height = Math.max(1, Math.floor(view.height! * pixelRatio));
          return [view.id, canvas];
        }),
      ),
  );
});
afterEach(() => {
  detach.forEach((fn) => fn());
  detach = [];
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
});
function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}
function setup(count = 1) {
  const graph = blankGraph('Native video');
  graph.nodes = Array.from({ length: count }, (_, index) =>
    newNode(graph.diagram.id, {
      id: `node${index}`,
      x: (index % 50) * 20,
      y: Math.floor(index / 50) * 20,
      width: 15,
      height: 12,
    }),
  );
  useEditor.getState().setGraph(graph);
  const host = document.createElement('div');
  host.style.setProperty('--canvas', '#f0f1f2');
  const info: VideoCanvasInfo = {
    graph,
    host,
    ...projectGraph(graph, []),
    width: 1000,
    height: 800,
    viewport: { x: 0, y: 0, zoom: 1 },
    absolute: () => undefined,
  };
  const listen = (event: Event) =>
    (event as CustomEvent<VideoCanvasInfoRequest>).detail.receive(info);
  window.addEventListener(VIDEO_CANVAS_INFO, listen);
  detach.push(() => window.removeEventListener(VIDEO_CANVAS_INFO, listen));
  return { graph, info };
}

it('draws all 2000 visible native cards, bounded batches and cache reuse during live camera movement', async () => {
  const { info } = setup(2000),
    scene = await createVideoScene(new AbortController().signal),
    ctx = context();
  try {
    await scene.prepare('node5');
    const before = mocks.capture.mock.calls.length;
    await scene.draw(ctx, 1280, 720);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2000);
    expect(mocks.capture.mock.calls.every((call) => call[1].length <= 120)).toBe(true);
    expect(mocks.capture.mock.calls.length).toBe(before);
    info.viewport = { x: 30, y: 10, zoom: 0.9 };
    await scene.draw(ctx, 1280, 720);
    expect(mocks.capture.mock.calls.length).toBe(before);
    expect(ctx.translate).toHaveBeenCalledWith(30, 10);
    expect(mocks.vectorsUpdate).toHaveBeenLastCalledWith(info);
    const latest = new Map<string, HTMLCanvasElement>();
    for (const result of mocks.capture.mock.results)
      for (const [id, canvas] of await result.value) latest.set(id, canvas);
    expect(
      [...latest.values()].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
    ).toBeLessThanOrEqual(VIDEO_SCENE_CACHE_BYTES);
  } finally {
    scene.dispose();
  }
  expect(mocks.vectorsDispose).toHaveBeenCalledOnce();
});

it('prepares offscreen target native cards without compiling SVGs against a synthetic camera', async () => {
  const { info } = setup(3);
  info.nodes[2].position.x = 1800;
  const scene = await createVideoScene(new AbortController().signal);
  try {
    await scene.prepare('node2');
    expect(
      mocks.capture.mock.calls.some((call) =>
        call[1].some((view: { id: string }) => view.id === 'node2'),
      ),
    ).toBe(true);
    expect(mocks.vectorsUpdate).toHaveBeenCalledOnce();
    expect(mocks.vectorsUpdate).toHaveBeenCalledWith(info);
    const before = mocks.capture.mock.calls.length;
    info.viewport = { x: -1500, y: 0, zoom: 1 };
    await scene.draw(context(), 1280, 720);
    expect(mocks.capture.mock.calls.length).toBe(before);
  } finally {
    scene.dispose();
  }
});

it('includes nested absolute group positions, excludes hidden nodes and adapts overview sprite memory', () => {
  const { info } = setup(3);
  info.nodes[0].position = { x: 100, y: 200 };
  info.nodes[1].parentId = info.nodes[0].id;
  info.nodes[1].position = { x: 20, y: 40 };
  info.nodes[2].hidden = true;
  const cards = videoVisibleCards(info);
  expect(cards.map((card) => [card.view.id, card.x, card.y])).toEqual([
    ['node0', 100, 200],
    ['node1', 120, 240],
  ]);
  for (const card of cards) {
    card.width = 10000;
    card.height = 10000;
  }
  const ratio = videoSpriteRatio(cards, 2, 2);
  expect(
    cards.reduce((sum, card) => sum + card.width * card.height * ratio * ratio * 4, 0),
  ).toBeLessThanOrEqual(VIDEO_SCENE_CACHE_BYTES);
  expect(videoSpriteRatio(cards, 0.001, 1)).toBeCloseTo(0.00125);
});

it('rejects more than 5000 visible cards explicitly instead of omitting them', async () => {
  const { info } = setup(5001);
  info.height = 10000;
  const scene = await createVideoScene(new AbortController().signal);
  try {
    await expect(scene.draw(context(), 1280, 720)).rejects.toThrow('at most 5000 visible cards');
  } finally {
    scene.dispose();
  }
  expect(mocks.capture).not.toHaveBeenCalled();
});

it('rejects changed views and clears native sprites on disposal', async () => {
  const { graph } = setup();
  const signal = new AbortController(),
    scene = await createVideoScene(signal.signal);
  await scene.prepare();
  const captures = (await mocks.capture.mock.results[0].value) as Map<string, HTMLCanvasElement>;
  graph.diagram.settings.spatialView = { version: 1, mode: '3d' };
  await expect(scene.draw(context(), 1280, 720)).rejects.toThrow('view changed');
  scene.dispose();
  expect([...captures.values()].every((canvas) => !canvas.width && !canvas.height)).toBe(true);
  await expect(scene.draw(context(), 1280, 720)).rejects.toMatchObject({ name: 'AbortError' });
});

it('copies a fresh 3D buffer synchronously inside the capture event and letterboxes its aspect', async () => {
  const { graph } = setup();
  graph.diagram.settings.spatialView = { version: 1, mode: '3d' };
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  const ctx = context();
  let copiedInsideHandler = false;
  const capture = (event: Event) => {
    const request = (event as CustomEvent<VideoSpatialFrameRequest>).detail;
    request.capture(canvas);
    copiedInsideHandler = vi.mocked(ctx.drawImage).mock.calls.length === 1;
  };
  window.addEventListener(VIDEO_SPATIAL_FRAME, capture);
  detach.push(() => window.removeEventListener(VIDEO_SPATIAL_FRAME, capture));
  const scene = await createVideoScene(new AbortController().signal);
  try {
    await scene.draw(ctx, 1280, 720);
  } finally {
    scene.dispose();
  }
  expect(copiedInsideHandler).toBe(true);
  expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 280, 0, 720, 720);
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(videoFrameBounds(1000, 800, 1280, 720)).toEqual({
    x: 190,
    y: 0,
    width: 900,
    height: 720,
    scale: 0.9,
  });
});

it('keeps every storyboard object prioritized and waits for all resident 3D faces before recording', async () => {
  const { graph } = setup(2);
  graph.diagram.settings.spatialView = { version: 1, mode: '3d' };
  const canvas = document.createElement('canvas');
  canvas.dataset.testid = 'spatial-canvas';
  canvas.dataset.faceSource = 'loading';
  canvas.dataset.faceProjections = JSON.stringify([
    { id: 'node0', source: '2d-node' },
    { id: 'node1', source: 'fallback' },
  ]);
  document.body.append(canvas);
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const tick = async () => {
    frames.splice(0).forEach((callback) => callback(0));
    await Promise.resolve();
    await Promise.resolve();
  };
  let targets: string[] | undefined;
  const prepare = (event: Event) => {
    targets = (event as CustomEvent<VideoSpatialPrepareRequest>).detail.nodeIds;
  };
  window.addEventListener(VIDEO_SPATIAL_PREPARE, prepare);
  detach.push(() => window.removeEventListener(VIDEO_SPATIAL_PREPARE, prepare));
  const signal = new AbortController();
  const scene = await createVideoScene(signal.signal);
  let ready = false;
  const pending = scene.prepare('node0', ['node0', 'node1']).then(() => {
    ready = true;
  });
  void pending.catch(() => undefined);
  try {
    await tick();
    await tick();
    await tick();
    expect(targets).toEqual(['node0', 'node1']);
    expect(ready).toBe(false);
    canvas.dataset.faceSource = '2d-node';
    canvas.dataset.faceProjections = JSON.stringify([
      { id: 'node0', source: '2d-node' },
      { id: 'node1', source: '2d-node' },
    ]);
    await tick();
    await pending;
    expect(ready).toBe(true);
  } finally {
    signal.abort();
    scene.dispose();
    canvas.remove();
  }
});

it('reports unavailable 3D frames and aborts without emitting a blank scene', async () => {
  const { graph } = setup();
  graph.diagram.settings.spatialView = { version: 1, mode: '3d' };
  const signal = new AbortController(),
    scene = await createVideoScene(signal.signal),
    ctx = context();
  try {
    await expect(Promise.resolve().then(() => scene.draw(ctx, 1280, 720))).rejects.toThrow(
      'unavailable',
    );
    expect(ctx.drawImage).not.toHaveBeenCalled();
    signal.abort();
    await expect(scene.prepare()).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    scene.dispose();
  }
});

it('rejects a truncated 3D renderer before preparing or recording a partial movie', async () => {
  const { graph } = setup();
  graph.diagram.settings.spatialView = { version: 1, mode: '3d' };
  const frame = (event: Event) =>
    (event as CustomEvent<VideoSpatialFrameRequest>).detail.error(VIDEO_SPATIAL_LIMIT_ERROR);
  const prepare = (event: Event) =>
    (event as CustomEvent<VideoSpatialPrepareRequest>).detail.error?.(VIDEO_SPATIAL_LIMIT_ERROR);
  window.addEventListener(VIDEO_SPATIAL_FRAME, frame);
  window.addEventListener(VIDEO_SPATIAL_PREPARE, prepare);
  detach.push(() => {
    window.removeEventListener(VIDEO_SPATIAL_FRAME, frame);
    window.removeEventListener(VIDEO_SPATIAL_PREPARE, prepare);
  });
  const scene = await createVideoScene(new AbortController().signal),
    ctx = context();
  try {
    await expect(scene.prepare('node0')).rejects.toThrow(
      'at most 8000 visible nodes and 16000 visible connections',
    );
    await expect(Promise.resolve().then(() => scene.draw(ctx, 1280, 720))).rejects.toThrow(
      'Filter the diagram or switch to 2D',
    );
    expect(ctx.drawImage).not.toHaveBeenCalled();
  } finally {
    scene.dispose();
  }
});
