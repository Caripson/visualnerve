import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cachedVoices,
  clearVoiceCache,
  loadVoiceFile,
} from '../src/presentation/speech/model-cache';
import { SPEECH_MODEL_CACHE } from '../src/presentation/speech/protocol';
import { modelUrl, VOICES, type PresentationVoice } from '../src/presentation/speech/voices';
import { appCacheManager } from '../src/security/app-cache';
import { CacheTestLocks, CacheTestChannel, cacheStorageFixture } from './app-cache-fixture';

const bytes = new TextEncoder().encode('tiny neural test model');
const voice = {
  ...VOICES[0],
  modelBytes: bytes.length,
  modelSha256: createHash('sha256').update(bytes).digest('hex'),
} as unknown as PresentationVoice;
let stored: Map<string, Response>;
let put: ReturnType<typeof vi.fn<(request: RequestInfo | URL, value: Response) => Promise<void>>>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const fixture = cacheStorageFixture();
  fixture.cache(SPEECH_MODEL_CACHE);
  stored = fixture.stores.get(SPEECH_MODEL_CACHE)!;
  put = vi.fn(async (request: RequestInfo | URL, value: Response) => {
    const key =
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    stored.set(key, value);
  });
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('crypto', webcrypto);
  fixture.caches.open.mockImplementation(async (name) =>
    name === SPEECH_MODEL_CACHE
      ? {
          match: vi.fn(async (request: RequestInfo | URL) =>
            stored
              .get(
                typeof request === 'string'
                  ? request
                  : request instanceof URL
                    ? request.href
                    : request.url,
              )
              ?.clone(),
          ),
          put,
        }
      : fixture.cache(name),
  );
  vi.stubGlobal('caches', fixture.caches);
  vi.stubGlobal('navigator', { locks: new CacheTestLocks() });
  vi.stubGlobal('BroadcastChannel', CacheTestChannel);
  fetcher = vi.fn(
    async () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } }),
  );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  appCacheManager.dispose();
  vi.unstubAllGlobals();
});

it('downloads only the pinned static model, verifies bytes and persists no description or audio', async () => {
  const progress = vi.fn();
  const result = await loadVoiceFile(voice, false, progress);
  expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(bytes));
  expect(fetcher).toHaveBeenCalledWith(modelUrl(voice), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: expect.any(AbortSignal),
  });
  expect(put).toHaveBeenCalledOnce();
  expect([...stored.keys()]).toEqual([modelUrl(voice)]);
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({ loaded: bytes.length, total: bytes.length, stage: 'download' }),
  );
  await loadVoiceFile(voice, false);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('discards corrupt model bytes before caching or inference', async () => {
  fetcher.mockResolvedValue(new Response(new Uint8Array(bytes.length).fill(1)));
  await expect(loadVoiceFile(voice, false)).rejects.toThrow('integrity verification');
  expect(put).not.toHaveBeenCalled();
});
it('bounds streamed and declared download size and rejects incomplete responses', async () => {
  for (const response of [
    new Response(new Uint8Array(bytes.length + 1)),
    new Response(new Uint8Array(bytes.length - 1)),
    new Response(bytes, { headers: { 'Content-Length': '999' } }),
  ]) {
    fetcher.mockResolvedValue(response);
    await expect(loadVoiceFile(voice, false)).rejects.toThrow(/size|incomplete/);
  }
  expect(put).not.toHaveBeenCalled();
});
it('reports a failed download without caching an error response', async () => {
  fetcher.mockResolvedValue(new Response('not found', { status: 404 }));
  await expect(loadVoiceFile(voice, false)).rejects.toThrow('failed (404)');
  expect(put).not.toHaveBeenCalled();
});
it('continues in memory when private-mode storage or quota prevents caching', async () => {
  vi.mocked(caches.open).mockRejectedValueOnce(new Error('Disabled'));
  await expect(loadVoiceFile(voice, false)).resolves.toBeInstanceOf(Response);
  put.mockRejectedValueOnce(new Error('Quota'));
  await expect(loadVoiceFile(voice, false)).resolves.toBeInstanceOf(Response);
});
it('lists complete model/config pairs and removes only the dedicated model cache', async () => {
  stored.set(modelUrl(VOICES[0]), new Response(bytes));
  expect(await cachedVoices()).toEqual([]);
  stored.set(modelUrl(VOICES[0], true), new Response('{}'));
  expect(await cachedVoices()).toEqual([VOICES[0].id]);
  await clearVoiceCache();
  expect(caches.delete).toHaveBeenCalledWith(SPEECH_MODEL_CACHE);
  expect(await cachedVoices()).toEqual([]);
});
it('accepts compressed transport length while verifying decoded config bytes and SHA', async () => {
  fetcher.mockResolvedValue(
    new Response(bytes, { headers: { 'Content-Length': '12', 'Content-Encoding': 'gzip' } }),
  );
  await expect(loadVoiceFile(voice, false)).resolves.toBeInstanceOf(Response);
  expect(put).toHaveBeenCalledOnce();
});
it('forwards abort to static-file fetch and discards cancelled body reads', async () => {
  const controller = new AbortController();
  fetcher.mockImplementation(async () => {
    controller.abort();
    return new Response(bytes);
  });
  await expect(loadVoiceFile(voice, false, undefined, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetcher).toHaveBeenCalledWith(
    modelUrl(voice),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(put).not.toHaveBeenCalled();
});
it('aggregates model and config byte progress monotonically including cached model hits', async () => {
  const { loadVoiceFiles } = await import('../src/presentation/speech/model-cache');
  const config = new TextEncoder().encode('{"voice":"test"}');
  const combined = {
    ...voice,
    configBytes: config.length,
    configSha256: createHash('sha256').update(config).digest('hex'),
  } as unknown as PresentationVoice;
  stored.set(
    modelUrl(voice),
    new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } }),
  );
  fetcher.mockResolvedValue(
    new Response(config, { headers: { 'Content-Length': String(config.length) } }),
  );
  const progress = vi.fn();
  const files = await loadVoiceFiles(combined, progress);
  const values = progress.mock.calls.map(([value]) => value.loaded);
  expect(values).toEqual([...values].sort((a, b) => a - b));
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({
      loaded: bytes.length + config.length,
      total: bytes.length + config.length,
    }),
  );
  expect(files.config).toEqual({ voice: 'test' });
  expect(fetcher).toHaveBeenCalledOnce();
});
