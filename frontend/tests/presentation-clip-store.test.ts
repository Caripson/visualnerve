import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NarrationClipStore } from '../src/presentation/speech/clip-store';
import {
  isNarrationClipCache,
  NARRATION_CLIP_CACHE_PREFIX,
} from '../src/presentation/speech/clip-cache-protocol';
import {
  narrationBlob,
  narrationCacheFixture,
  narrationCrypto,
  narrationGate,
  narrationLease,
} from './narration-clip-fixture';

beforeEach(() => vi.stubGlobal('Blob', NativeBlob));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(memoryBytes = 0, spillBytes = 1024 * 1024) {
  const cache = narrationCacheFixture();
  const store = new NarrationClipStore({
    crypto: narrationCrypto,
    cacheStorage: cache.storage,
    memoryBytes,
    spillBytes,
    withLease: narrationLease,
  });
  const signal = new AbortController().signal;
  return { store, cache, signal };
}
describe('private temporary full-tour audio', () => {
  it('retains bounded RAM and encrypts overflow with opaque same-origin keys and a nonextractable AES-256 key', async () => {
    const { store, cache, signal } = fixture(8);
    const generate = vi.spyOn(narrationCrypto.subtle, 'generateKey');
    await store.put('voice\0private title one', narrationBlob('12345678'), signal);
    const text = 'PRIVATE narration that must not enter cache as plaintext';
    await store.put('voice\0private title two', narrationBlob(text), signal);
    expect(store.size).toBe(2);
    expect(store.memoryBytes).toBe(8);
    expect(isNarrationClipCache(store.cacheName)).toBe(true);
    expect(store.cacheName.startsWith(NARRATION_CLIP_CACHE_PREFIX)).toBe(true);
    const encrypted = [...cache.cache(store.cacheName).entries];
    expect(encrypted).toHaveLength(1);
    expect(new URL(encrypted[0][0]).origin).toBe(location.origin);
    expect(encrypted[0][0]).not.toContain('private title');
    expect(encrypted[0][0]).not.toContain('voice%');
    expect(await encrypted[0][1].clone().text()).not.toContain(text);
    expect(encrypted[0][1].headers.get('Content-Type')).toBe('application/octet-stream');
    expect(generate).toHaveBeenCalledWith({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const key = await generate.mock.results[0].value;
    expect(key.extractable).toBe(false);
    expect(await (await store.get('voice\0private title two', signal))?.text()).toBe(text);
    expect(store.memoryBytes).toBe(8);
    await store.dispose();
    expect(await cache.storage.keys()).toEqual([]);
    expect(store.size).toBe(0);
    expect(store.memoryBytes).toBe(0);
  });
  it('authenticates the entire clip and rejects changed or substituted ciphertext', async () => {
    const { store, cache, signal } = fixture();
    await store.put('first', narrationBlob('first private WAV'), signal);
    await store.put('second', narrationBlob('second private WAV'), signal);
    const entries = cache.cache(store.cacheName).entries;
    const urls = [...entries.keys()];
    const second = entries.get(urls[1])!.clone();
    entries.set(urls[0], second);
    await expect(store.get('first', signal)).rejects.toBeDefined();
    expect(await (await store.get('second', signal))?.text()).toBe('second private WAV');
    const damaged = new Uint8Array(await entries.get(urls[1])!.clone().arrayBuffer());
    damaged[damaged.length - 1] ^= 1;
    entries.set(urls[1], new Response(damaged));
    await expect(store.get('second', signal)).rejects.toBeDefined();
    await store.dispose();
  });
  it('rejects missing and oversized cached bodies before decrypting any plaintext', async () => {
    const { store, cache, signal } = fixture();
    await store.put('first', narrationBlob('12345'), signal);
    const entries = cache.cache(store.cacheName).entries;
    const url = [...entries.keys()][0];
    const decrypt = vi.spyOn(narrationCrypto.subtle, 'decrypt');
    entries.set(url, new Response(new Uint8Array(34)));
    await expect(store.get('first', signal)).rejects.toThrow('integrity');
    entries.delete(url);
    await expect(store.get('first', signal)).rejects.toThrow('missing');
    expect(decrypt).not.toHaveBeenCalled();
    await store.dispose();
  });
  it('enforces the aggregate encrypted spill ceiling and never marks failed writes ready', async () => {
    const { store, cache, signal } = fixture(3, 40);
    await store.put('RAM', narrationBlob('123'), signal);
    await store.put('disk', narrationBlob('1234567890'), signal);
    await expect(store.put('overflow', narrationBlob('1234567890'), signal)).rejects.toThrow(
      '1 GiB',
    );
    expect(store.spillBytes).toBe(38);
    expect(store.has('overflow')).toBe(false);
    expect(store.size).toBe(2);
    const larger = fixture(0, 500);
    larger.cache
      .cache(larger.store.cacheName)
      .put.mockRejectedValueOnce(new DOMException('Quota exceeded.', 'QuotaExceededError'));
    await expect(larger.store.put('quota', narrationBlob(), signal)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(larger.store.has('quota')).toBe(false);
    expect(larger.store.spillBytes).toBe(0);
    await Promise.all([store.dispose(), larger.store.dispose()]);
  });
  it('waits for late native puts before deleting only the disposed generation', async () => {
    const { store, cache, signal } = fixture();
    const entered = narrationGate(),
      release = narrationGate();
    const target = cache.cache(store.cacheName);
    target.put.mockImplementationOnce(async (request, response) => {
      const copy = response.clone();
      entered.resolve();
      await release.promise;
      target.entries.set(String(request), copy);
    });
    const pending = store.put('old private text', narrationBlob(), signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    let done = false;
    const disposed = store.dispose().then(() => {
      done = true;
    });
    const next = new NarrationClipStore({
      crypto: narrationCrypto,
      cacheStorage: cache.storage,
      memoryBytes: 0,
      withLease: narrationLease,
    });
    await next.put('fresh private text', narrationBlob('new private WAV'), signal);
    expect(done).toBe(false);
    release.resolve();
    await rejected;
    await disposed;
    expect(await cache.storage.keys()).toEqual([next.cacheName]);
    expect(await (await next.get('fresh private text', signal))?.text()).toBe('new private WAV');
    await next.dispose();
  });
  it('rejects late native decryptions after original cancellation and clears encrypted cleanup safely', async () => {
    const { store, cache } = fixture();
    const original = new AbortController();
    await store.put('private', narrationBlob(), original.signal);
    const entered = narrationGate(),
      release = narrationGate();
    const decrypt = narrationCrypto.subtle.decrypt.bind(narrationCrypto.subtle);
    vi.spyOn(narrationCrypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
      const value = await decrypt(...args);
      entered.resolve();
      await release.promise;
      return value;
    });
    const pending = store.get('private', original.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    original.abort();
    const disposed = store.dispose();
    release.resolve();
    await rejected;
    await disposed;
    expect(await cache.storage.keys()).toEqual([]);
    expect(store.has('private')).toBe(false);
  });
  it('keeps quiescence successful even if deletion fails after RAM-only key revocation', async () => {
    const { store, cache, signal } = fixture();
    await store.put('private', narrationBlob(), signal);
    vi.mocked(cache.storage.delete).mockResolvedValue(false);
    await expect(store.dispose()).resolves.toBeUndefined();
    expect(store.getCleanupError()).toContain('inaccessible remainder');
    expect(store.has('private')).toBe(false);
    expect(() => store.get('private', signal)).toThrow('cancelled');
  });
});
