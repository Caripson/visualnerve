import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { autoNumber, getPresentation, setPresentation } from '../src/presentation/definition';
import {
  VideoExporter,
  type VideoDependencies,
  type VideoEncoder,
} from '../src/presentation/video-runtime';
import { videoOptions } from '../src/presentation/video-types';
import { subtitlePages } from '../src/presentation/video-subtitles';

function fixture(count = 2) {
  let graph = blankGraph('My diagram');
  graph.nodes = Array.from({ length: count }, (_, index) =>
    newNode(graph.diagram.id, { title: `Step ${index}`, description: `Description ${index}` }),
  );
  graph = autoNumber(graph);
  graph = setPresentation(graph, { ...getPresentation(graph), secondsPerNode: 2, transitionMs: 0 });
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const encoder: VideoEncoder = {
    format: 'mp4',
    addFrame: vi.fn(async () => undefined),
    addAudio: vi.fn(async () => 5),
    finish: vi.fn(async () => new Blob(['movie'], { type: 'video/mp4' })),
    cancel: vi.fn(async () => undefined),
  };
  const scene = { draw: vi.fn(), prepare: vi.fn(async () => undefined), dispose: vi.fn() };
  const deps: VideoDependencies = {
    graph: () => graph,
    voice: vi.fn(async () => 'en_US-ljspeech-high'),
    prepare: vi.fn(async () => new Blob(['wav'])),
    encoder: vi.fn(async () => encoder),
    scene: vi.fn(async () => scene),
    focus: vi.fn(async () => undefined),
    stop: vi.fn(),
    ready: vi.fn(),
    nextFrame: vi.fn(async (signal) => {
      signal.throwIfAborted();
    }),
  };
  return { exporter: new VideoExporter(deps), deps, encoder, scene, graph, context };
}
afterEach(() => vi.restoreAllMocks());
describe('local walkthrough movie export', () => {
  it('exports the whole numbered sequence with contiguous timestamps and audio after arrival', async () => {
    const { exporter, deps, encoder, graph } = fixture();
    const original = JSON.stringify(graph);
    expect(exporter.start({ audio: true, subtitles: true }).status).toBe('preparing');
    await exporter.settled();
    expect(exporter.getState()).toMatchObject({
      status: 'complete',
      progress: 1,
      nodeIndex: 1,
      total: 2,
      format: 'mp4',
      fileName: 'My-diagram-walkthrough.mp4',
    });
    expect(deps.focus).toHaveBeenNthCalledWith(1, graph.nodes[0].id, 0, expect.any(AbortSignal));
    expect(deps.focus).toHaveBeenNthCalledWith(2, graph.nodes[1].id, 0, expect.any(AbortSignal));
    const frames = vi.mocked(encoder.addFrame).mock.calls;
    frames.forEach(([timestamp, duration], index) => {
      expect(timestamp).toBe(index / 30);
      expect(duration).toBe(1 / 30);
    });
    const audio = vi.mocked(encoder.addAudio).mock.calls;
    expect(audio[0][1]).toBeGreaterThanOrEqual(0);
    expect(audio[1][1] - audio[0][1]).toBeGreaterThanOrEqual(5);
    expect(frames.length / 30).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(graph)).toBe(original);
    expect(deps.ready).toHaveBeenCalledOnce();
    expect(encoder.cancel).not.toHaveBeenCalled();
  });
  it('never downloads or synthesizes a voice for silent video', async () => {
    const { exporter, deps, encoder } = fixture(1);
    exporter.start({ audio: false, subtitles: false });
    await exporter.settled();
    expect(deps.voice).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(encoder.addAudio).not.toHaveBeenCalled();
    expect(exporter.getState().status).toBe('complete');
  });
  it('cancels preparation without encoding or downloading a partial file and blocks concurrent exports', async () => {
    const { exporter, deps, scene, encoder } = fixture();
    let ready!: () => void;
    deps.prepare = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          ready = () => resolve(new Blob(['wav']));
        }),
    );
    exporter.start({ audio: true, subtitles: true });
    expect(() => exporter.start({ audio: false, subtitles: false })).toThrow(/already running/);
    for (let index = 0; index < 12; index++) await Promise.resolve();
    exporter.cancel();
    ready();
    await exporter.settled();
    expect(exporter.getState().status).toBe('cancelled');
    expect(encoder.cancel).toHaveBeenCalledOnce();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(deps.ready).not.toHaveBeenCalled();
    expect(encoder.addFrame).not.toHaveBeenCalled();
  });
  it('reports unsupported encoders and refuses oversized timelines before starting', async () => {
    const { exporter, deps, graph } = fixture();
    deps.encoder = vi.fn(async () => {
      throw new Error('No supported video encoder.');
    });
    exporter.start({ audio: false, subtitles: true });
    await exporter.settled();
    expect(exporter.getState()).toMatchObject({
      status: 'error',
      message: 'No supported video encoder.',
    });
    const long = fixture(4);
    long.graph.diagram.settings.presentation = {
      ...getPresentation(graph),
      nodeIds: long.graph.nodes.map((node) => node.id),
      secondsPerNode: 600,
    };
    expect(() => long.exporter.start({ audio: false, subtitles: false })).toThrow(/30 minutes/);
    expect(long.deps.encoder).not.toHaveBeenCalled();
  });
  it('keeps playback locked until cancelled encoder resources finish cleaning up', async () => {
    const { exporter, deps, encoder } = fixture(1);
    let release!: () => void;
    encoder.cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    deps.nextFrame = vi.fn(async (signal) => {
      exporter.cancel();
      signal.throwIfAborted();
    });
    exporter.start({ audio: false, subtitles: false });
    for (let index = 0; index < 30; index++) await Promise.resolve();
    expect(exporter.getState().status).toBe('cancelled');
    expect(exporter.isBusy()).toBe(true);
    expect(() => exporter.start({ audio: false, subtitles: false })).toThrow(/cancelled/);
    release();
    await exporter.settled();
    expect(exporter.isBusy()).toBe(false);
  });
  it('rejects narration that takes the final movie over the duration limit without saving a partial movie', async () => {
    const { exporter, encoder, deps } = fixture(1);
    encoder.addAudio = vi.fn(async () => 1801);
    exporter.start({ audio: true, subtitles: true });
    await exporter.settled();
    expect(exporter.getState()).toMatchObject({
      status: 'error',
      message: expect.stringContaining('30 minutes'),
    });
    expect(deps.ready).not.toHaveBeenCalled();
    expect(encoder.cancel).toHaveBeenCalledOnce();
  });
  it('keeps all subtitle words in bounded pages and validates exact option types', () => {
    const text = Array.from({ length: 250 }, (_, index) => `word${index}`).join(' ');
    const pages = subtitlePages(text, (value) => value.length * 10, 150);
    expect(pages.flat().join(' ')).toBe(text);
    expect(pages.every((page) => page.length <= 3)).toBe(true);
    expect(videoOptions({}, { audio: true, subtitles: false })).toEqual({
      audio: true,
      subtitles: false,
    });
    expect(videoOptions({ audio: false }, { audio: true, subtitles: true })).toEqual({
      audio: false,
      subtitles: true,
    });
    for (const value of [null, [], { audio: 'yes' }, { resolution: 1080 }])
      expect(() => videoOptions(value, { audio: false, subtitles: true })).toThrow();
  });
});

it('exports authored storyboard scenes with independent narration, durations and multiple selected objects', async () => {
  const { exporter, deps, encoder, graph, context, scene } = fixture();
  const { setStoryboard, getStoryboard } = await import('../src/presentation/storyboard');
  const sceneId = crypto.randomUUID();
  const updated = setStoryboard(graph, {
    version: 1,
    scenes: [
      {
        id: sceneId,
        name: 'Assembly overview',
        nodeIds: graph.nodes.map((n) => n.id),
        edgeIds: [],
        narration: 'Narration authored for the whole scene',
        seconds: 6,
        transitionMs: 500,
        view: { mode: '2d', viewport: { x: 20, y: 40, zoom: 0.7 } },
      },
    ],
  });
  deps.graph = () => updated;
  deps.focusStep = vi.fn(async () => undefined);
  deps.prepareStep = vi.fn(async () => undefined);
  const before = JSON.stringify(updated);
  exporter.start({ source: 'storyboard', audio: true, subtitles: true });
  await exporter.settled();
  expect(exporter.getState()).toMatchObject({
    source: 'storyboard',
    status: 'complete',
    total: 1,
    nodeIndex: 0,
  });
  expect(deps.prepare).toHaveBeenCalledWith(
    'Narration authored for the whole scene',
    'en_US-ljspeech-high',
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(deps.prepareStep).toHaveBeenCalledBefore(scene.prepare);
  expect(deps.focusStep).toHaveBeenCalledWith(
    getStoryboard(updated).scenes[0],
    expect.any(AbortSignal),
  );
  expect(deps.focus).not.toHaveBeenCalled();
  expect(scene.prepare).toHaveBeenCalledWith(
    graph.nodes[0].id,
    graph.nodes.map((n) => n.id),
  );
  expect(context.fillText).toHaveBeenCalledWith('1 / 1 · Assembly overview', 24, 27, 1232);
  expect(vi.mocked(encoder.addFrame).mock.calls.length / 30).toBeGreaterThanOrEqual(6);
  expect(JSON.stringify(updated)).toBe(before);
});
