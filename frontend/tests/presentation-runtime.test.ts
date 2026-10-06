import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { autoNumber, setPresentation, getPresentation } from '../src/presentation/definition';
import { PresentationPlayer, type PlayerDependencies } from '../src/presentation/runtime';

function fixture(count = 3) {
  let graph = blankGraph('Walkthrough');
  graph.nodes = Array.from({ length: count }, (_, index) =>
    newNode(graph.diagram.id, { title: `Step ${index}`, description: `Description ${index}` }),
  );
  graph = autoNumber(graph);
  graph = setPresentation(graph, {
    ...getPresentation(graph),
    secondsPerNode: 2,
    transitionMs: 100,
  });
  const deps: PlayerDependencies = {
    graph: () => graph,
    voice: async () => 'en_US-ljspeech-high',
    prepare: vi.fn(async () => new Blob(['wav'])),
    preloadVoice: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    cancelCamera: vi.fn(),
    narration: {
      unlock: vi.fn(async () => undefined),
      play: vi.fn(async () => 5),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    },
  };
  const player = new PresentationPlayer(deps);
  player.open();
  return {
    player,
    deps,
    graph,
    change: (value: typeof graph) => {
      graph = value;
    },
  };
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());
describe('diagram walkthrough runtime', () => {
  it('keeps repeated Pause idempotent and resumes the same audio position', async () => {
    vi.useFakeTimers();
    const { player, deps } = fixture();
    player.options({ audio: true });
    await player.play();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    player.pause();
    const stops = vi.mocked(deps.narration.stop).mock.calls.length;
    player.pause();
    expect(deps.narration.stop).toHaveBeenCalledTimes(stops);
    await player.play();
    expect(deps.narration.resume).toHaveBeenCalledOnce();
    expect(deps.narration.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3999);
    expect(player.getState().index).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.getState().index).toBe(1);
    player.close();
  });
  it('waits for the audio clock when the output device starts later than the wall clock', async () => {
    vi.useFakeTimers();
    const { player, deps } = fixture();
    deps.narration.remaining = vi.fn(() => 0.25);
    player.options({ audio: true });
    await player.play();
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(player.getState().index).toBe(0);
    deps.narration.remaining = () => 0;
    await vi.advanceTimersByTimeAsync(275);
    expect(player.getState().index).toBe(1);
    player.close();
  });
  it('ignores a rejected audio permission request after close and refocuses after manual camera takeover', async () => {
    const { player, deps } = fixture();
    let reject!: (error: Error) => void;
    deps.narration.unlock = () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      });
    player.options({ audio: true });
    const pending = player.play();
    player.close();
    reject(new Error('Autoplay blocked.'));
    await pending;
    expect(player.getState()).toMatchObject({ open: false, status: 'idle' });
    deps.narration.unlock = async () => undefined;
    player.open();
    await player.play();
    await settle();
    player.pause('Manual camera', true);
    await player.play();
    await settle();
    expect(deps.focus).toHaveBeenCalledTimes(2);
    expect(deps.narration.resume).toHaveBeenCalledOnce();
    player.close();
  });
  it('starts with English-capable silent defaults and requires numbering', async () => {
    const { player, deps } = fixture(0);
    expect(player.getState()).toMatchObject({
      audio: false,
      subtitles: true,
      preload: false,
      index: -1,
      total: 0,
    });
    await expect(player.play()).rejects.toThrow('Number some nodes');
    expect(deps.prepare).not.toHaveBeenCalled();
    player.close();
  });
  it('waits for real camera arrival before narration, with audio duration before advance', async () => {
    vi.useFakeTimers();
    const { player, deps, graph } = fixture();
    let arrive!: () => void;
    deps.focus = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          arrive = resolve;
        }),
    );
    player.options({ audio: true });
    await player.play();
    await settle();
    expect(player.getState().status).toBe('moving');
    expect(deps.narration.play).not.toHaveBeenCalled();
    arrive();
    await settle();
    expect(player.getState()).toMatchObject({ status: 'playing', nodeId: graph.nodes[0].id });
    await vi.advanceTimersByTimeAsync(4999);
    expect(player.getState().index).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.getState().index).toBe(1);
    player.close();
  });
  it('pauses and resumes the remaining time and audio instead of restarting the step', async () => {
    vi.useFakeTimers();
    const { player, deps } = fixture();
    player.options({ audio: true });
    await player.play();
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    player.pause();
    await vi.advanceTimersByTimeAsync(20000);
    expect(player.getState().index).toBe(0);
    await player.play();
    expect(deps.narration.resume).toHaveBeenCalledOnce();
    expect(deps.narration.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3499);
    expect(player.getState().index).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(player.getState().index).toBe(1);
    player.close();
  });
  it('ignores stale camera arrival after skip or pause and freezes after a paused skip', async () => {
    vi.useFakeTimers();
    const { player, deps, graph } = fixture();
    const arrivals: (() => void)[] = [];
    deps.focus = vi.fn(() => new Promise<void>((resolve) => arrivals.push(resolve)));
    await player.play();
    await settle();
    player.pause();
    player.skip(1);
    await settle();
    arrivals[0]();
    await settle();
    expect(player.getState().status).toBe('moving');
    arrivals[1]();
    await settle();
    expect(player.getState()).toMatchObject({ status: 'paused', nodeId: graph.nodes[1].id });
    await vi.advanceTimersByTimeAsync(20000);
    expect(player.getState().index).toBe(1);
    player.close();
  });
  it('honors pause while browser audio permission is still pending', async () => {
    const { player, deps } = fixture();
    let unlock!: () => void;
    deps.narration.unlock = () =>
      new Promise<void>((resolve) => {
        unlock = resolve;
      });
    player.options({ audio: true });
    const pending = player.play();
    player.pause();
    unlock();
    await pending;
    await settle();
    expect(player.getState().status).toBe('paused');
    expect(deps.focus).not.toHaveBeenCalled();
    player.close();
  });
  it('preloads a bounded three-step window for a thousand-node diagram', async () => {
    const { player, deps } = fixture(1000);
    await player.preload();
    await settle();
    expect(deps.preloadVoice).toHaveBeenCalledOnce();
    expect(deps.prepare).toHaveBeenCalledTimes(3);
    expect(player.getState().buffered).toBe(3);
    expect(deps.narration.play).not.toHaveBeenCalled();
    player.close();
    expect(player.getState().buffered).toBe(0);
  });
  it('fails a blocked camera route without starting audio or advancing', async () => {
    vi.useFakeTimers();
    const { player, deps } = fixture();
    deps.focus = async () => {
      throw new Error('No collision-free route.');
    };
    player.options({ audio: true });
    await player.play();
    await settle();
    expect(player.getState()).toMatchObject({
      status: 'error',
      message: 'No collision-free route.',
    });
    expect(deps.narration.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20000);
    expect(player.getState().index).toBe(0);
    player.close();
  });
  it('stops stale playback on diagram edits and closes on navigation', async () => {
    vi.useFakeTimers();
    const { player, deps, graph, change } = fixture();
    await player.play();
    await settle();
    change({ ...graph, nodes: graph.nodes.slice(1) });
    player.changed();
    expect(player.getState()).toMatchObject({ status: 'paused' });
    expect(deps.narration.stop).toHaveBeenCalled();
    change(blankGraph('Other'));
    player.changed();
    expect(player.getState().open).toBe(false);
  });
  it('ends on the last step and replay starts at the first', async () => {
    vi.useFakeTimers();
    const { player } = fixture(1);
    await player.play();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.getState().status).toBe('ended');
    await player.play();
    await settle();
    expect(player.getState()).toMatchObject({ status: 'playing', index: 0 });
    player.close();
  });
  it('strictly validates option payloads without modifying player state', () => {
    const { player } = fixture();
    const before = player.getState();
    for (const value of [{}, { audio: 'true' }, { surprise: true }, null, []])
      expect(() => player.options(value)).toThrow();
    expect(player.getState()).toBe(before);
    player.close();
  });
});
it('keeps preload work through Pause and Forward and cancels it explicitly on close', async () => {
  const { player, deps } = fixture();
  let finish!: () => void;
  let signal!: AbortSignal;
  deps.preloadVoice = vi.fn((_voice, value) => {
    signal = value;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await player.preload();
  await settle();
  expect(signal.aborted).toBe(false);
  await player.play();
  await settle();
  player.pause();
  expect(signal.aborted).toBe(false);
  player.skip(1);
  await settle();
  expect(signal.aborted).toBe(false);
  expect(deps.preloadVoice).toHaveBeenCalledOnce();
  player.close();
  expect(signal.aborted).toBe(true);
  finish();
  await settle();
  expect(player.getState()).toMatchObject({ open: false, progress: 0, buffered: 0 });
});
it('reports a monotonic overall preload percentage separate from download and completed chunk fractions', async () => {
  const { player, deps } = fixture(2);
  let initialized!: () => void;
  const synths: Array<{
    finish: (blob: Blob) => void;
    progress: Parameters<PlayerDependencies['prepare']>[3];
  }> = [];
  deps.preloadVoice = vi.fn((_voice, _signal, progress) => {
    progress(0.8, 'Voice download 80%', 'download');
    return new Promise<void>((resolve) => {
      initialized = resolve;
    });
  });
  deps.prepare = vi.fn(
    (_text, _voice, _signal, progress) =>
      new Promise<Blob>((finish) => synths.push({ finish, progress })),
  );
  await player.preload();
  await settle();
  expect(player.getState().progress).toBe(0);
  expect(player.getState().message).toContain('download 80%');
  initialized();
  await settle();
  expect(player.getState().progress).toBeCloseTo(1 / 3);
  synths[0].progress(0.5, 'Narration chunks 50%', 'synthesis');
  expect(player.getState().progress).toBe(0.5);
  synths[0].progress(0, 'Beginning another phase', 'loading');
  expect(player.getState().progress).toBe(0.5);
  synths[0].finish(new Blob(['wav']));
  await settle();
  expect(player.getState().progress).toBeCloseTo(2 / 3);
  synths[1].progress(1, 'Chunks done', 'synthesis');
  expect(player.getState().progress).toBeLessThan(1);
  synths[1].finish(new Blob(['wav']));
  await settle();
  expect(player.getState()).toMatchObject({
    progress: 1,
    message: 'Preload 100% · Voice and next steps ready.',
    buffered: 2,
  });
  player.close();
});
it('cancels background preparation immediately when preload is switched off and ignores stale progress', async () => {
  const { player, deps } = fixture();
  let signal!: AbortSignal;
  let progress!: Parameters<PlayerDependencies['preloadVoice']>[2];
  deps.preloadVoice = vi.fn((_voice, value, notify) => {
    signal = value;
    progress = notify;
    return new Promise<void>(() => undefined);
  });
  await player.preload();
  await settle();
  player.options({ preload: false });
  expect(signal.aborted).toBe(true);
  const state = player.getState();
  progress(0.75, 'Stale download', 'download');
  expect(player.getState()).toBe(state);
  player.close();
});
