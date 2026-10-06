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

const bytes = new TextEncoder().encode('tiny neural test model');
const voice = {
  ...VOICES[0],
  modelBytes: bytes.length,
  modelSha256: createHash('sha256').update(bytes).digest('hex'),
} as unknown as PresentationVoice;
let stored: Map<string, Response>;
let put: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stored = new Map();
  put = vi.fn(async (url: string, value: Response) => {
    stored.set(url, value);
  });
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('caches', {
    open: vi.fn(async () => ({ match: async (url: string) => stored.get(url)?.clone(), put })),
    delete: vi.fn(async () => {
      stored.clear();
      return true;
    }),
  });
  fetcher = vi.fn(
    async () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } }),
  );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it('downloads only the pinned static model, verifies bytes and persists no description or audio', async () => {
  const progress = vi.fn();
  const result = await loadVoiceFile(voice, false, progress);
  expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(bytes));
  expect(fetcher).toHaveBeenCalledWith(modelUrl(voice), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
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
