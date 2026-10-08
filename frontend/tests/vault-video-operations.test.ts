import { webcrypto } from 'node:crypto';
import { waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import type { WorkspaceOperation } from '../src/storage/contracts';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { autoNumber, getPresentation, setPresentation } from '../src/presentation/definition';
import {
  disposeVideoExport,
  saveVideo,
  startVideo,
  videoExport,
} from '../src/presentation/video-service';
import type { VideoEncoder } from '../src/presentation/video-runtime';

const fixture = vi.hoisted(() => ({
  repo: undefined as unknown as Repository,
  workspace: undefined as unknown as Workspace,
  encoder: undefined as unknown as VideoEncoder,
  download: vi.fn(),
  prepare: vi.fn(),
  createEncoder: vi.fn(),
  createScene: vi.fn(),
  draw: vi.fn(),
  disposeScene: vi.fn(),
}));
vi.mock('../src/storage/repository', async (original) => {
  const actual = await original<typeof import('../src/storage/repository')>();
  return {
    ...actual,
    get repository() {
      return fixture.repo;
    },
  };
});
vi.mock('../src/storage/workspace', async (original) => {
  const actual = await original<typeof import('../src/storage/workspace')>();
  return {
    ...actual,
    get workspace() {
      return fixture.workspace;
    },
  };
});
vi.mock('../src/export/semantic', async (original) => {
  const actual = await original<typeof import('../src/export/semantic')>();
  return { ...actual, download: fixture.download };
});
vi.mock('../src/presentation/service', () => ({
  focusPresentationCamera: vi.fn(async () => undefined),
  focusPresentationStepCamera: vi.fn(async () => undefined),
  revealPresentationStep: vi.fn(async () => undefined),
  releasePresentationHighlight: vi.fn(),
  presentation: {
    getState: () => ({ open: true, source: 'nodes', audio: false, subtitles: false }),
    open: vi.fn(),
    pause: vi.fn(),
  },
}));
vi.mock('../src/presentation/speech/service', () => ({
  speechService: { prepare: fixture.prepare, cancel: vi.fn() },
}));
vi.mock('../src/presentation/video-scene', () => ({ createVideoScene: fixture.createScene }));
vi.mock('../src/presentation/video-encoder', () => ({ createVideoEncoder: fixture.createEncoder }));

const password = 'test-only originating video session password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let graph: Graph;
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function unlockAgain() {
  await session.lock();
  await session.unlock(password);
  useEditor.getState().setGraph(graph);
  useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write' });
}
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  fixture.encoder = {
    format: 'mp4',
    addFrame: vi.fn(async () => undefined),
    addAudio: vi.fn(async () => 0),
    finish: vi.fn(async () => new Blob(['Private old-session movie'], { type: 'video/mp4' })),
    cancel: vi.fn(async () => undefined),
  };
  fixture.createEncoder.mockImplementation(async () => fixture.encoder);
  fixture.createScene.mockResolvedValue({
    draw: fixture.draw,
    dispose: fixture.disposeScene,
    prepare: async () => undefined,
  });
  fixture.prepare.mockResolvedValue(new Blob(['Private narration']));
  physical = new VaultRecordStorage(`vault-video-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  fixture.repo = new Repository(db);
  fixture.workspace = new Workspace(fixture.repo);
  await db.settings.put({ key: 'storage-consent', value: true });
  await db.settings.put({ key: 'mcp-access', value: 'write' });
  graph = blankGraph('Private movie');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Private step', description: 'Private speech' }),
  ];
  graph = autoNumber(graph);
  graph = setPresentation(graph, { ...getPresentation(graph), secondsPerNode: 2, transitionMs: 0 });
  useEditor.getState().setGraph(graph);
  useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write' });
  session.onLock(disposeVideoExport);
});
afterEach(async () => {
  await disposeVideoExport();
  fixture.workspace.stop();
  useEditor.getState().setGraph(null);
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Video fixture retained an open database.'));
  });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('movies retain only an explicitly live originating session', () => {
  it('downloads a normal completed movie, allows saving it again, and forgets it on disposal', async () => {
    expect(startVideo({ audio: true, subtitles: true }).status).toBe('preparing');
    await videoExport.settled();
    expect(videoExport.getState()).toMatchObject({
      status: 'complete',
      fileName: 'Private-movie-walkthrough.mp4',
    });
    expect(fixture.download).toHaveBeenCalledOnce();
    await saveVideo();
    expect(fixture.download).toHaveBeenCalledTimes(2);
    await disposeVideoExport();
    expect(videoExport.getState()).toMatchObject({
      status: 'idle',
      fileName: null,
      message: '',
      total: 0,
    });
    await saveVideo();
    expect(fixture.download).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('cannot offer a completed old movie after lock and unlock of the same diagram', async () => {
    startVideo({ audio: false, subtitles: false });
    await videoExport.settled();
    expect(fixture.download).toHaveBeenCalledOnce();
    await unlockAgain();
    expect(videoExport.getState()).toMatchObject({ status: 'idle', fileName: null });
    await saveVideo();
    expect(fixture.download).toHaveBeenCalledOnce();
    startVideo({ audio: false, subtitles: false });
    await videoExport.settled();
    expect(fixture.download).toHaveBeenCalledTimes(2);
  });

  it('disposal drops private metadata immediately and waits for cancelled encoder cleanup', async () => {
    const finishing = gate<Blob>(),
      cancelling = gate<void>();
    vi.mocked(fixture.encoder.finish).mockReturnValue(finishing.promise);
    vi.mocked(fixture.encoder.cancel).mockReturnValue(cancelling.promise);
    startVideo({ audio: false, subtitles: false });
    await waitFor(() => expect(fixture.encoder.finish).toHaveBeenCalledOnce());
    let settled = false;
    const clearing = disposeVideoExport().then(() => {
      settled = true;
    });
    expect(videoExport.getState()).toMatchObject({ status: 'idle', fileName: null, total: 0 });
    await waitFor(() => expect(fixture.encoder.cancel).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(videoExport.isBusy()).toBe(true);
    expect(() => startVideo({})).toThrow(/already running/);
    finishing.resolve(new Blob(['Late readable movie']));
    cancelling.resolve();
    await clearing;
    expect(videoExport.isBusy()).toBe(false);
    expect(videoExport.getState().status).toBe('idle');
    expect(fixture.disposeScene).toHaveBeenCalledOnce();
    expect(fixture.download).not.toHaveBeenCalled();
    await saveVideo();
    expect(fixture.download).not.toHaveBeenCalled();
  });

  it('never publishes a native encoder result that finishes after lock and unlock', async () => {
    const finishing = gate<Blob>();
    vi.mocked(fixture.encoder.finish).mockReturnValue(finishing.promise);
    startVideo({ audio: false, subtitles: false });
    await waitFor(() => expect(fixture.encoder.finish).toHaveBeenCalledOnce());
    await unlockAgain();
    finishing.resolve(new Blob(['Readable movie from the revoked session']));
    await videoExport.settled();
    expect(videoExport.getState()).toMatchObject({ status: 'idle', fileName: null });
    expect(fixture.encoder.cancel).toHaveBeenCalledOnce();
    expect(fixture.download).not.toHaveBeenCalled();
    await saveVideo();
    expect(fixture.download).not.toHaveBeenCalled();
  });

  it('captures before asynchronous acquisition and does not begin rendering in a later session', async () => {
    const waiting = gate<WorkspaceOperation>();
    const originalCapture = db.captureOperation.bind(db);
    const original = await originalCapture();
    vi.spyOn(db, 'captureOperation').mockReturnValueOnce(waiting.promise);
    startVideo({ audio: false, subtitles: false });
    expect(db.captureOperation).toHaveBeenCalledOnce();
    const locked = session.lock();
    waiting.resolve(original);
    await locked;
    await session.unlock(password);
    useEditor.getState().setGraph(graph);
    useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write' });
    await videoExport.settled();
    expect(fixture.createEncoder).not.toHaveBeenCalled();
    expect(fixture.download).not.toHaveBeenCalled();
    expect(videoExport.getState().status).toBe('idle');
  });

  it('requires a fresh persisted write grant before publishing an externally started movie', async () => {
    const finishing = gate<Blob>();
    vi.mocked(fixture.encoder.finish).mockReturnValue(finishing.promise);
    startVideo({ audio: false, subtitles: false }, true);
    await waitFor(() => expect(fixture.encoder.finish).toHaveBeenCalledOnce());
    // Simulate a sibling tab grant change before this tab receives its RAM notification.
    await db.settings.put({ key: 'mcp-access', value: 'read' });
    expect(useEditor.getState().mcpAccess).toBe('write');
    finishing.resolve(new Blob(['Movie blocked by the fresh read-only grant']));
    await videoExport.settled();
    expect(videoExport.getState()).toMatchObject({
      status: 'error',
      message: 'MCP write access revoked.',
    });
    expect(fixture.download).not.toHaveBeenCalled();
    await saveVideo();
    expect(fixture.download).not.toHaveBeenCalled();
  });

  it('reauthorizes saving a finished external movie after a sibling revokes its grant', async () => {
    startVideo({ audio: false, subtitles: false }, true);
    await videoExport.settled();
    expect(fixture.download).toHaveBeenCalledOnce();
    await db.settings.put({ key: 'mcp-access', value: 'off' });
    await saveVideo();
    expect(fixture.download).toHaveBeenCalledOnce();
    expect(videoExport.getState()).toMatchObject({ status: 'idle', fileName: null });
  });

  it('a pending repeat-save cannot download or reset a new session movie after disposal', async () => {
    const waiting = gate<void>();
    const originalCapture = db.captureOperation.bind(db);
    let pause = false,
      paused = false;
    vi.spyOn(db, 'captureOperation').mockImplementation(async () => {
      const originating = await originalCapture();
      return {
        ...originating,
        check: async () => {
          if (pause) {
            pause = false;
            paused = true;
            await waiting.promise;
          }
          await originating.check();
        },
      };
    });
    startVideo({ audio: false, subtitles: false });
    await videoExport.settled();
    pause = true;
    const saving = saveVideo();
    await waitFor(() => expect(paused).toBe(true));
    await unlockAgain();
    startVideo({ audio: false, subtitles: false });
    await videoExport.settled();
    expect(fixture.download).toHaveBeenCalledTimes(2);
    const latest = videoExport.getState();
    waiting.resolve();
    await saving;
    expect(fixture.download).toHaveBeenCalledTimes(2);
    expect(videoExport.getState()).toEqual(latest);
    await saveVideo();
    expect(fixture.download).toHaveBeenCalledTimes(3);
  });

  it('keeps ordinary cancellation visible until explicit disposal, without saving a partial movie', async () => {
    const preparing = gate<Blob>();
    fixture.prepare.mockReturnValue(preparing.promise);
    startVideo({ audio: true, subtitles: true });
    await waitFor(() => expect(fixture.prepare).toHaveBeenCalledOnce());
    videoExport.cancel('Cancelled by the user.');
    preparing.resolve(new Blob(['Late narration']));
    await videoExport.settled();
    expect(videoExport.getState()).toMatchObject({
      status: 'cancelled',
      message: 'Cancelled by the user.',
    });
    expect(fixture.download).not.toHaveBeenCalled();
    await disposeVideoExport();
    expect(videoExport.getState().status).toBe('idle');
  });
});
