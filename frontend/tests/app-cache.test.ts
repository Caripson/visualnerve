import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { webcrypto } from 'node:crypto';
import {
  AppCacheManager,
  APP_CACHE_CONTROL_CACHE,
  APP_CACHE_CONTROL_URL,
  isOwnedAppAssetCache,
  fetchAppAsset,
  appCacheManager,
} from '../src/security/app-cache';
import { SPEECH_MODEL_CACHE } from '../src/presentation/speech/protocol';
import { NARRATION_CLIP_CACHE_PREFIX } from '../src/presentation/speech/clip-cache-protocol';
import {
  CacheTestLocks,
  CacheTestChannel,
  cacheStorageFixture,
  deferred,
} from './app-cache-fixture';

let fixture: ReturnType<typeof cacheStorageFixture>;
let managers: AppCacheManager[];
const manager = () => {
  const value = new AppCacheManager();
  managers.push(value);
  return value;
};
beforeEach(() => {
  fixture = cacheStorageFixture();
  managers = [];
  CacheTestChannel.suspended = false;
  vi.stubGlobal('caches', fixture.caches);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('BroadcastChannel', CacheTestChannel);
  vi.stubGlobal('MessageChannel', MessageChannel);
  vi.stubGlobal('navigator', { locks: new CacheTestLocks() });
});
afterEach(() => {
  for (const value of managers) value.dispose();
  appCacheManager.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('removes only exact app asset namespaces and preserves workspace stores, preferences and unrelated caches', async () => {
  const names = [
    'visual-nerve-shell-012345abcdef',
    'visual-nerve-app-shell-abcdef012345',
    SPEECH_MODEL_CACHE,
    'visual-nerve-shell-private-vault',
    'visual-nerve-shell-012345abcdef-backup',
    'visualnerve-piper-models-v99',
    'unrelated-cache',
  ];
  for (const name of names) fixture.cache(name);
  localStorage.setItem('cache-test-preference', 'retained');
  sessionStorage.setItem('cache-test-key', 'retained');
  const deleteDatabase = vi.spyOn(indexedDB, 'deleteDatabase');
  const result = await manager().clear();
  expect(result).toEqual({ available: true, deletedCaches: names.slice(0, 3) });
  expect([...fixture.stores.keys()]).toEqual([...names.slice(3), APP_CACHE_CONTROL_CACHE]);
  expect(deleteDatabase).not.toHaveBeenCalled();
  expect(localStorage.getItem('cache-test-preference')).toBe('retained');
  expect(sessionStorage.getItem('cache-test-key')).toBe('retained');
  deleteDatabase.mockRestore();
  localStorage.removeItem('cache-test-preference');
  sessionStorage.removeItem('cache-test-key');
});
it('preserves offline shells when clearing voices alone', async () => {
  fixture.cache('visual-nerve-app-shell-abcdef012345');
  fixture.cache(SPEECH_MODEL_CACHE);
  expect((await manager().clear('voices')).deletedCaches).toEqual([SPEECH_MODEL_CACHE]);
  expect(fixture.stores.has('visual-nerve-app-shell-abcdef012345')).toBe(true);
});
it('clears only valid temporary narration namespaces with app assets and preserves them for voice-only clearing', async () => {
  const owned = NARRATION_CLIP_CACHE_PREFIX + crypto.randomUUID();
  const unrelated = NARRATION_CLIP_CACHE_PREFIX + 'other-application';
  const suffixed = owned + '-backup';
  for (const name of [owned, unrelated, suffixed]) fixture.cache(name);
  expect(isOwnedAppAssetCache(owned)).toBe(true);
  expect(isOwnedAppAssetCache(unrelated)).toBe(false);
  expect(isOwnedAppAssetCache(suffixed)).toBe(false);
  await manager().clear('voices');
  expect(fixture.stores.has(owned)).toBe(true);
  expect((await manager().clear()).deletedCaches).toEqual([owned]);
  expect(fixture.stores.has(unrelated)).toBe(true);
  expect(fixture.stores.has(suffixed)).toBe(true);
});
it('aborts active downloads before deletion and prevents their late results from being cached', async () => {
  const owner = manager(),
    ready = deferred(),
    stopped = deferred();
  const cache = fixture.cache(SPEECH_MODEL_CACHE);
  let aborted = false;
  const task = owner
    .download(async (lease) => {
      lease.signal.addEventListener('abort', () => {
        aborted = true;
        stopped.resolve();
      });
      ready.resolve();
      await stopped.promise;
      await lease.put(cache as unknown as Cache, '/model', new Response('model'));
    })
    .catch((error) => error);
  await ready.promise;
  await owner.clear();
  expect(aborted).toBe(true);
  expect(await task).toMatchObject({ name: 'AbortError' });
  expect(cache.put).not.toHaveBeenCalled();
  expect(fixture.stores.has(SPEECH_MODEL_CACHE)).toBe(false);
});
it('fences a suspended context that misses broadcasts before it writes a stale download', async () => {
  const clearing = manager(),
    otherTab = manager(),
    ready = deferred(),
    release = deferred();
  const cache = fixture.cache(SPEECH_MODEL_CACHE);
  const task = otherTab
    .download(async (lease) => {
      ready.resolve();
      await release.promise;
      expect(lease.signal.aborted).toBe(false);
      await lease.put(cache as unknown as Cache, '/late-model', new Response('model'));
    })
    .catch((error) => error);
  await ready.promise;
  CacheTestChannel.suspended = true;
  const clearingTask = clearing.clear();
  await vi.waitFor(async () =>
    expect(
      await (await fixture.cache(APP_CACHE_CONTROL_CACHE).match(APP_CACHE_CONTROL_URL))!.json(),
    ).toMatchObject({ clearing: true }),
  );
  expect(fixture.caches.delete).not.toHaveBeenCalled();
  release.resolve();
  await clearingTask;
  expect(await task).toMatchObject({ name: 'AbortError' });
  expect(cache.put).not.toHaveBeenCalled();
  expect(fixture.stores.has(SPEECH_MODEL_CACHE)).toBe(false);
});
it('returns an explicit bounded failure when a download ignores cancellation, then allows a safe retry', async () => {
  vi.useFakeTimers();
  const owner = manager(),
    ready = deferred(),
    release = deferred();
  fixture.cache(SPEECH_MODEL_CACHE);
  const task = owner
    .download(async () => {
      ready.resolve();
      await release.promise;
    })
    .catch((error) => error);
  await ready.promise;
  const result = owner.clear().catch((error) => error);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await result).toMatchObject({ code: 'CACHE_CLEAR_TIMEOUT' });
  expect(fixture.caches.delete).not.toHaveBeenCalled();
  release.resolve();
  expect(await task).toMatchObject({ name: 'AbortError' });
  expect((await owner.clear()).deletedCaches).toEqual([SPEECH_MODEL_CACHE]);
});
it('rejects incomplete deletion, resets the barrier and permits repeated clearing and future downloads', async () => {
  const owner = manager();
  fixture.cache(SPEECH_MODEL_CACHE);
  fixture.caches.delete.mockResolvedValueOnce(false);
  await expect(owner.clear()).rejects.toMatchObject({ code: 'CACHE_DELETE_FAILED' });
  expect((await owner.clear()).deletedCaches).toEqual([SPEECH_MODEL_CACHE]);
  expect((await owner.clear()).deletedCaches).toEqual([]);
  await expect(owner.download(async () => 'fresh request')).resolves.toBe('fresh request');
  const state = await (await fixture
    .cache(APP_CACHE_CONTROL_CACHE)
    .match(APP_CACHE_CONTROL_URL))!.json();
  expect(state).toMatchObject({ clearing: false, expiresAt: 0 });
});
it('rejects an unacknowledged/unsupported service worker before deleting any cache', async () => {
  const worker = {
    scriptURL: new URL('/sw.js', location.href).href,
    postMessage: vi.fn(
      (message: { begin: boolean }, ports: { postMessage(value: unknown): void }[]) =>
        ports[0].postMessage({ type: 'app-cache-ready', begin: false }),
    ),
  };
  vi.stubGlobal('navigator', {
    locks: new CacheTestLocks(),
    serviceWorker: { getRegistrations: async () => [{ active: worker }] },
  });
  fixture.cache(SPEECH_MODEL_CACHE);
  await expect(manager().clear()).rejects.toMatchObject({ code: 'CACHE_WORKER_UNAVAILABLE' });
  expect(fixture.caches.delete).not.toHaveBeenCalled();
});
it('gracefully reports no Cache API but rejects unsupported cross-context coordination', async () => {
  vi.stubGlobal('caches', undefined);
  expect(await manager().clear()).toEqual({ available: false, deletedCaches: [] });
  vi.stubGlobal('caches', fixture.caches);
  vi.stubGlobal('navigator', {});
  await expect(manager().clear()).rejects.toMatchObject({ code: 'CACHE_COORDINATION_UNAVAILABLE' });
  expect(fixture.caches.delete).not.toHaveBeenCalled();
});
it('recovers an expired interrupted-clear marker without accepting malformed coordination metadata', async () => {
  const cache = fixture.cache(APP_CACHE_CONTROL_CACHE);
  await cache.put(
    APP_CACHE_CONTROL_URL,
    new Response(
      JSON.stringify({ generation: 'previous', clearing: true, expiresAt: Date.now() - 1 }),
    ),
  );
  await expect(manager().download(async () => 'recovered')).resolves.toBe('recovered');
  await cache.put(APP_CACHE_CONTROL_URL, new Response('{"clearing":false}'));
  await expect(manager().download(async () => 'unsafe')).rejects.toMatchObject({
    code: 'CACHE_CONTROL_INVALID',
  });
});
it('tracks a fetched response through body consumption and cancels a stalled stream during clearing', async () => {
  const cancel = vi.fn();
  const response = await fetchAppAsset(
    vi.fn(async () => new Response(new ReadableStream({ cancel }))),
    'https://example.test/runtime',
  );
  const body = response.arrayBuffer().catch((error) => error);
  await appCacheManager.clear();
  expect(cancel).toHaveBeenCalledOnce();
  expect(await body).toMatchObject({ name: 'AbortError' });
});
it('does not classify similar or malformed names as owned asset caches', () => {
  for (const name of [
    'visual-nerve-shell-ab',
    'visual-nerve-shell-ABCDEF012345',
    'visual-nerve-app-shell-012345abcdef-more',
    APP_CACHE_CONTROL_CACHE,
  ])
    expect(isOwnedAppAssetCache(name)).toBe(false);
});
