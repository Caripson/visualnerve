import { act, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { autoNumber, getPresentation, setPresentation } from '../src/presentation/definition';
import { VideoCleanupCoordinator } from '../src/presentation/video-lifecycle';
import type { WorkspaceOperation, WorkspaceStorage } from '../src/storage/contracts';
import type { VideoEncoder } from '../src/presentation/video-runtime';
import {
  disposeVideoExport,
  isVideoExporting,
  startVideo,
  useVideoExport,
  videoExport,
} from '../src/presentation/video-service';

const fixture = vi.hoisted(() => ({
  operation: undefined as unknown as WorkspaceOperation,
  encoder: undefined as unknown as VideoEncoder,
  download: vi.fn(),
  release: vi.fn(),
  sceneDisposed: vi.fn(),
}));
vi.mock('../src/storage/repository', () => ({
  repository: { db: { captureOperation: async () => fixture.operation } },
}));
vi.mock('../src/export/semantic', async (original) => ({
  ...(await original<typeof import('../src/export/semantic')>()),
  download: fixture.download,
}));
vi.mock('../src/presentation/service', () => ({
  focusPresentationCamera: vi.fn(async () => undefined),
  focusPresentationStepCamera: vi.fn(async () => undefined),
  revealPresentationStep: vi.fn(async () => undefined),
  releasePresentationHighlight: fixture.release,
  presentation: {
    getState: () => ({ open: true, source: 'nodes', audio: false, subtitles: false }),
    open: vi.fn(),
    pause: vi.fn(),
  },
}));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { prepare: vi.fn(), cancel: vi.fn() },
}));
vi.mock('../src/presentation/video-scene', () => ({
  createVideoScene: async () => ({ draw: vi.fn(), dispose: fixture.sceneDisposed }),
}));
vi.mock('../src/presentation/video-encoder', () => ({
  createVideoEncoder: async () => fixture.encoder,
}));

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function Playback() {
  const state = useVideoExport();
  return (
    <button disabled={isVideoExporting()} data-status={state.status}>
      Play presentation
    </button>
  );
}

beforeEach(() => {
  const controller = new AbortController();
  const scope = {
    settings: {
      get: async (key: string) => ({ key, value: key === 'storage-consent' ? true : 'write' }),
    },
  } as unknown as WorkspaceStorage;
  fixture.operation = {
    signal: controller.signal,
    check: async () => controller.signal.throwIfAborted(),
    dispose: vi.fn(),
    storage: {
      atomic: async (
        _mode: unknown,
        _stores: unknown,
        work: (value: WorkspaceStorage) => unknown,
      ) => work(scope),
    } as unknown as WorkspaceStorage,
  };
  fixture.encoder = {
    format: 'mp4',
    addFrame: vi.fn(async () => undefined),
    addAudio: vi.fn(async () => 0),
    finish: vi.fn(async () => new Blob(['movie'])),
    cancel: vi.fn(async () => undefined),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as unknown as CanvasRenderingContext2D);
  let graph = blankGraph('Cleanup regression');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Step' })];
  graph = autoNumber(graph);
  graph = setPresentation(graph, { ...getPresentation(graph), secondsPerNode: 2, transitionMs: 0 });
  useEditor.getState().setGraph(graph);
  useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write' });
});
afterEach(async () => {
  await disposeVideoExport();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('observable video cleanup', () => {
  it('re-renders playback after the final runtime event precedes cancellation cleanup', async () => {
    const frame = gate(),
      cancel = gate();
    vi.mocked(fixture.encoder.addFrame).mockReturnValue(frame.promise);
    vi.mocked(fixture.encoder.cancel).mockReturnValue(cancel.promise);
    // Commit each runtime event immediately, reproducing the real UI reading
    // cleanup as still pending at VideoExporter\'s final state notification.
    const subscribe = videoExport.subscribe;
    vi.spyOn(videoExport, 'subscribe').mockImplementation((listener) =>
      subscribe(() => flushSync(listener)),
    );
    render(<Playback />);
    const play = screen.getByRole('button', { name: 'Play presentation' });
    expect(play).toBeEnabled();
    act(() => startVideo({ audio: false, subtitles: false }));
    await waitFor(() => expect(fixture.encoder.addFrame).toHaveBeenCalled());
    act(() => videoExport.cancel());
    frame.resolve();
    await waitFor(() => expect(fixture.encoder.cancel).toHaveBeenCalledOnce());
    expect(play).toHaveAttribute('data-status', 'cancelled');
    expect(play).toBeDisabled();
    expect(isVideoExporting()).toBe(true);
    expect(() => startVideo({})).toThrow(/already running/);
    cancel.resolve();
    await videoExport.settled();
    await waitFor(() => expect(isVideoExporting()).toBe(false));
    await waitFor(() => expect(play).toBeEnabled());
    expect(fixture.sceneDisposed).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.download).not.toHaveBeenCalled();
    expect(fixture.operation.dispose).toHaveBeenCalledOnce();
  });

  it('keeps a newer cleanup busy when an older request finishes and waits for both', async () => {
    const cleanup = new VideoCleanupCoordinator();
    const first = gate(),
      second = gate();
    const snapshots: boolean[] = [];
    const unsubscribe = cleanup.subscribe(() => snapshots.push(cleanup.isBusy()));
    const oldTask = cleanup.track(first.promise);
    const newTask = cleanup.track(second.promise);
    let settled = false;
    const waiting = cleanup.settled().then(() => {
      settled = true;
    });
    expect(snapshots).toEqual([true]);
    first.resolve();
    await oldTask;
    expect(cleanup.isBusy()).toBe(true);
    expect(snapshots).toEqual([true]);
    expect(settled).toBe(false);
    second.resolve();
    await newTask;
    await waiting;
    expect(cleanup.isBusy()).toBe(false);
    expect(settled).toBe(true);
    expect(snapshots).toEqual([true, false]);
    unsubscribe();
  });

  it('keeps reset playback blocked and disposal pending until encoder resources are released', async () => {
    const frame = gate(),
      cancel = gate();
    vi.mocked(fixture.encoder.addFrame).mockReturnValue(frame.promise);
    vi.mocked(fixture.encoder.cancel).mockReturnValue(cancel.promise);
    render(<Playback />);
    const play = screen.getByRole('button', { name: 'Play presentation' });
    act(() => startVideo({ audio: false, subtitles: false }));
    await waitFor(() => expect(fixture.encoder.addFrame).toHaveBeenCalled());
    let finished = false;
    let disposing!: Promise<void>;
    act(() => {
      disposing = disposeVideoExport().then(() => {
        finished = true;
      });
    });
    frame.resolve();
    await waitFor(() => expect(fixture.encoder.cancel).toHaveBeenCalledOnce());
    expect(play).toHaveAttribute('data-status', 'idle');
    expect(play).toBeDisabled();
    expect(isVideoExporting()).toBe(true);
    expect(finished).toBe(false);
    expect(() => startVideo({})).toThrow(/already running/);
    await act(async () => {
      cancel.resolve();
      await disposing;
    });
    expect(play).toBeEnabled();
    expect(finished).toBe(true);
    expect(isVideoExporting()).toBe(false);
    expect(fixture.download).not.toHaveBeenCalled();
    expect(fixture.sceneDisposed).toHaveBeenCalledOnce();
    expect(fixture.operation.dispose).toHaveBeenCalledOnce();
  });

  it('drains every resource before rejecting failed cleanup without retaining a busy snapshot', async () => {
    const cleanup = new VideoCleanupCoordinator();
    const held = gate();
    const failed = cleanup.track(Promise.reject(new Error('Cleanup failed.')));
    const other = cleanup.track(held.promise);
    void failed.catch(() => undefined);
    const result = cleanup.settled().catch((error: unknown) => error);
    await failed.catch(() => undefined);
    expect(cleanup.isBusy()).toBe(true);
    held.resolve();
    await other;
    expect(await result).toEqual(new Error('Cleanup failed.'));
    expect(cleanup.isBusy()).toBe(false);
  });
});
