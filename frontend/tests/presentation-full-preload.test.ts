import { Blob as NativeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { autoNumber, getPresentation, setPresentation } from '../src/presentation/definition';
import { PresentationPlayer, type PlayerDependencies } from '../src/presentation/runtime';
import { NarrationClipStore } from '../src/presentation/speech/clip-store';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { APP_CACHE_CHANNEL } from '../src/security/app-cache';
import { CacheTestChannel } from './app-cache-fixture';
import {
  narrationBlob,
  narrationCacheFixture,
  narrationCrypto,
  narrationGate,
  narrationLease,
} from './narration-clip-fixture';

function fixture(descriptions = Array.from({ length: 8 }, (_, index) => `Narration ${index}`)) {
  let graph = blankGraph('Entire presentation');
  graph.nodes = descriptions.map((description, index) =>
    newNode(graph.diagram.id, { title: `Step ${index}`, description }),
  );
  graph = autoNumber(graph);
  graph = setPresentation(graph, {
    ...getPresentation(graph),
    secondsPerNode: 2,
    transitionMs: 0,
  });
  let voice = 'en_GB-alan-medium';
  const cache = narrationCacheFixture();
  const stores: NarrationClipStore[] = [];
  let spillBytes = 1024 * 1024;
  const deps: PlayerDependencies = {
    graph: () => graph,
    voice: vi.fn(async () => voice),
    clipStore: (onInvalidated) => {
      const store = new NarrationClipStore({
        crypto: narrationCrypto,
        cacheStorage: cache.storage,
        memoryBytes: 20,
        spillBytes,
        withLease: narrationLease,
        onInvalidated,
      });
      stores.push(store);
      return store;
    },
    prepare: vi.fn(async (text) => narrationBlob(`WAV ${text}`)),
    preloadVoice: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    releaseHighlight: vi.fn(),
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
    cache,
    stores,
    get graph() {
      return graph;
    },
    setGraph: (value: typeof graph) => (graph = value),
    setVoice: (value: string) => (voice = value),
    setSpillBytes: (value: number) => (spillBytes = value),
  };
}
async function ready(player: PresentationPlayer, total: number) {
  await vi.waitFor(() => {
    expect(player.getState()).toMatchObject({
      total,
      progress: 1,
      message: `Preload 100% · ${total}/${total} steps ready.`,
    });
  });
}
async function close(player: PresentationPlayer) {
  player.close();
  await player.settled();
}
beforeEach(() => vi.stubGlobal('Blob', NativeBlob));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('full presentation preload readiness and reuse', () => {
  it('prepares from the first step after seeking forward and reuses every encrypted clip through navigation, end and replay', async () => {
    const { player, deps, stores, cache } = fixture();
    player.seek(5);
    await vi.waitFor(() => expect(player.getState().status).toBe('paused'));
    await player.preload();
    await ready(player, 8);
    expect(vi.mocked(deps.prepare).mock.calls.map(([text]) => text)).toEqual(
      Array.from({ length: 8 }, (_, index) => `Narration ${index}`),
    );
    expect(player.getState()).toMatchObject({ index: 5, buffered: 8 });
    const store = stores.at(-1)!;
    expect(store.memoryBytes).toBeLessThanOrEqual(20);
    expect(store.spillBytes).toBeGreaterThan(0);
    expect(cache.cache(store.cacheName).entries.size).toBe(7);
    player.options({ audio: true });
    for (const index of [5, 0, 7, 3]) {
      player.seek(index);
      await vi.waitFor(() => expect(player.getState().status).toBe('paused'));
      await player.play();
      await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
      expect(await vi.mocked(deps.narration.play).mock.calls.at(-1)![0].text()).toBe(
        `WAV Narration ${index}`,
      );
      player.pause();
      expect(player.getState().progress).toBe(1);
    }
    player.skip(-1);
    await vi.waitFor(() => expect(player.getState().status).toBe('paused'));
    expect(player.getState().index).toBe(2);
    await player.play();
    await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
    player.skip(1);
    await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
    expect(player.getState().index).toBe(3);
    player.pause();
    player.seek(7);
    await vi.waitFor(() => expect(player.getState().status).toBe('paused'));
    vi.useFakeTimers();
    await player.play();
    await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(player.getState().status).toBe('ended');
    await player.play();
    await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
    expect(player.getState().index).toBe(0);
    expect(deps.prepare).toHaveBeenCalledTimes(8);
    expect(deps.preloadVoice).toHaveBeenCalledOnce();
    expect(player.getState().buffered).toBe(8);
    await close(player);
    expect(await cache.storage.keys()).toEqual([]);
  });

  it('counts blank and duplicate narration as ready steps without duplicate synthesis or unneeded voice download', async () => {
    const { player, deps } = fixture(['same', '', 'same', 'other', '  ', 'same']);
    await player.preload();
    await ready(player, 6);
    expect(vi.mocked(deps.prepare).mock.calls.map(([text]) => text)).toEqual(['same', 'other']);
    expect(player.getState().buffered).toBe(2);
    await close(player);
    const blank = fixture(['', '  ', '']);
    await blank.player.preload();
    await ready(blank.player, 3);
    expect(blank.deps.preloadVoice).not.toHaveBeenCalled();
    expect(blank.deps.prepare).not.toHaveBeenCalled();
    expect(blank.player.getState().buffered).toBe(0);
    await close(blank.player);
  });

  it('reports an explicit aggregate spill failure below 100% rather than pretending the remaining steps are ready', async () => {
    const { player, deps, setSpillBytes, stores } = fixture(['one', 'two', 'three', 'four']);
    // Two 7-byte clips fit in RAM; the third needs 9 + 28 encrypted bytes.
    setSpillBytes(37);
    player.open();
    await player.preload();
    await vi.waitFor(() => expect(player.getState().message).toContain('Preload failed:'));
    expect(player.getState().message).toContain('1 GiB');
    expect(player.getState().progress).toBe(0.75);
    expect(player.getState().buffered).toBe(3);
    expect(stores.at(-1)!.has('en_GB-alan-medium\0four')).toBe(false);
    expect(player.getState().message).not.toContain('100%');
    expect(deps.prepare).toHaveBeenCalledTimes(4);
    await close(player);
  });

  it('ignores a delayed old voice lookup after close and a new tour using the same diagram ID', async () => {
    const { player, deps, graph, setGraph } = fixture(['old first', 'old second']);
    const voice = narrationGate<string>();
    const entered = narrationGate();
    vi.mocked(deps.voice).mockImplementationOnce(async () => {
      entered.resolve();
      return voice.promise;
    });
    await player.preload();
    await entered.promise;
    await close(player);
    setGraph({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, description: 'fresh' })) });
    player.open();
    await player.preload();
    await ready(player, 2);
    const fresh = player.getState();
    voice.resolve('old stale voice');
    await voice.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(player.getState()).toBe(fresh);
    expect(vi.mocked(deps.prepare).mock.calls.map(([text, selected]) => [text, selected])).toEqual([
      ['fresh', 'en_GB-alan-medium'],
    ]);
    await close(player);
  });

  it('invalidates all prepared ciphertext when the committed voice selection changes', async () => {
    const { player, deps, setVoice, stores, cache } = fixture(['first', 'second', 'third']);
    await player.preload();
    await ready(player, 3);
    const old = stores.at(-1)!.cacheName;
    expect(cache.cache(old).entries.size).toBeGreaterThan(0);
    setVoice('en_US-joe-medium');
    player.changed();
    await player.settled();
    expect(await cache.storage.keys()).not.toContain(old);
    expect(player.getState()).toMatchObject({ buffered: 0, progress: 0 });
    await player.preload();
    await ready(player, 3);
    expect(vi.mocked(deps.prepare).mock.calls.map(([, voice]) => voice)).toEqual([
      ...Array(3).fill('en_GB-alan-medium'),
      ...Array(3).fill('en_US-joe-medium'),
    ]);
    expect(stores.at(-1)!.cacheName).not.toBe(old);
    await close(player);
  });

  it('does not publish a delayed preparation after graph mutation, even before the edit notification', async () => {
    const { player, deps, graph, setGraph } = fixture(['old first', 'old second']);
    const clip = narrationGate<Blob>();
    const entered = narrationGate();
    vi.mocked(deps.prepare).mockImplementationOnce(async () => {
      entered.resolve();
      return clip.promise;
    });
    await player.preload();
    await entered.promise;
    setGraph({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, description: 'fresh' })) });
    clip.resolve(narrationBlob('old private WAV'));
    await vi.waitFor(() =>
      expect(player.getState()).toMatchObject({
        buffered: 0,
        progress: 0,
        message: 'Diagram changed. Prepare this tour again.',
      }),
    );
    expect(deps.prepare).toHaveBeenCalledOnce();
    player.changed();
    await player.preload();
    await ready(player, 2);
    expect(player.getState().buffered).toBe(1);
    await close(player);
  });

  it("pauses active playback on another tab's cache-clear broadcast and can prepare and play again", async () => {
    vi.stubGlobal('BroadcastChannel', CacheTestChannel);
    const { player, deps, stores, cache } = fixture(['first', 'second', 'third']);
    const otherTab = new CacheTestChannel(APP_CACHE_CHANNEL);
    try {
      await player.preload();
      await ready(player, 3);
      const old = stores.at(-1)!.cacheName;
      player.options({ audio: true });
      await player.play();
      await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
      otherTab.postMessage({ type: 'clear-app-assets' });
      await vi.waitFor(() =>
        expect(player.getState()).toMatchObject({
          open: true,
          status: 'paused',
          buffered: 0,
          progress: 0,
          message: 'Preload cleared. Prepare this tour again.',
        }),
      );
      await player.settled();
      expect(await cache.storage.keys()).not.toContain(old);
      expect(deps.releaseHighlight).toHaveBeenCalled();
      await player.preload();
      await ready(player, 3);
      await player.play();
      await vi.waitFor(() => expect(player.getState().status).toBe('playing'));
      expect(deps.prepare).toHaveBeenCalledTimes(6);
      expect(deps.narration.play).toHaveBeenCalledTimes(2);
      expect(player.getState().buffered).toBe(3);
    } finally {
      otherTab.close();
      await close(player);
    }
  });
});

const password = 'test-only full presentation vault password';
const cipher = new VaultCrypto(narrationCrypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
beforeAll(async () => {
  vault = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(vault.keys));

it('waits for a late native encrypted put before real vault unlock and cannot reuse old audio after unlock of the same graph', async () => {
  const storage = new VaultRecordStorage(`vault-full-preload-${crypto.randomUUID()}`);
  await storage.create(vault.header);
  const session = new VaultSession(storage, cipher);
  await session.initialize();
  await session.unlock(password);
  const { player, deps, graph, setGraph, stores, cache } = fixture(['old first', 'old second']);
  const entered = narrationGate(),
    release = narrationGate();
  const oldStore = stores.at(-1)!;
  const target = cache.cache(oldStore.cacheName);
  target.put.mockImplementationOnce(async (request, response) => {
    const copy = response.clone();
    entered.resolve();
    await release.promise;
    target.entries.set(String(request), copy);
  });
  session.onLock(async () => {
    player.close();
    await player.settled();
  });
  const originating = await session.captureOperation();
  try {
    await player.preload();
    await entered.promise;
    const locking = session.lock();
    let unlocked = false;
    const unlocking = session.unlock(password).then(() => {
      unlocked = true;
    });
    await vi.waitFor(() => expect(player.getState().open).toBe(false));
    expect(originating.signal.aborted).toBe(true);
    expect(unlocked).toBe(false);
    expect(oldStore.size).toBe(0);
    release.resolve();
    await locking;
    await unlocking;
    expect(unlocked).toBe(true);
    expect(await cache.storage.keys()).not.toContain(oldStore.cacheName);
    setGraph({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, description: 'fresh' })) });
    player.open();
    await player.preload();
    await ready(player, 2);
    expect(vi.mocked(deps.prepare).mock.calls.map(([text]) => text)).toEqual([
      'old first',
      'old second',
      'fresh',
    ]);
    expect(player.getState().buffered).toBe(1);
    expect(session.getSnapshot().status).toBe('unlocked');
  } finally {
    release.resolve();
    originating.dispose();
    await close(player);
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(storage.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Preload fixture retained an open database.'));
    });
  }
});
