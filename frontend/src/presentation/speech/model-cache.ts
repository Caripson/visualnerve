import { SPEECH_MODEL_CACHE, type SpeechProgress } from './protocol';
import { modelUrl, VOICES, type PresentationVoice } from './voices';

type Progress = (value: SpeechProgress) => void;

/** Only fixed, versioned voice binaries enter this cache. Narration text never does. */
export async function loadVoiceFile(
  voice: PresentationVoice,
  config: boolean,
  progress?: Progress,
  signal?: AbortSignal,
): Promise<Response> {
  signal?.throwIfAborted();
  const url = modelUrl(voice, config);
  const size = config ? voice.configBytes : voice.modelBytes;
  const digest = config ? voice.configSha256 : voice.modelSha256;
  let cache: Cache | undefined;
  try {
    cache = await caches.open(SPEECH_MODEL_CACHE);
    const stored = await cache.match(url);
    if (stored && Number(stored.headers.get('Content-Length')) === size) {
      signal?.throwIfAborted();
      progress?.({
        stage: 'download',
        loaded: size,
        total: size,
        message: `Cached ${voice.label}`,
      });
      return stored;
    }
  } catch {
    // Private browsing/quota can disable caching; synthesis still works in memory.
  }
  progress?.({ stage: 'download', loaded: 0, total: size, message: `Downloading ${voice.label}` });
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    throw new Error(`The voice download failed (${response.status}). Try again when online.`);
  if (
    !response.headers.has('Content-Encoding') &&
    response.headers.has('Content-Length') &&
    Number(response.headers.get('Content-Length')) !== size
  )
    throw new Error('The voice download has an unexpected size.');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot stream voice downloads.');
  let loaded = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > size) throw new Error('The voice download exceeds its expected size.');
      parts.push(value);
      progress?.({ stage: 'download', loaded, total: size, message: `Downloading ${voice.label}` });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  signal?.throwIfAborted();
  if (loaded !== size) throw new Error('The voice download was incomplete. Try again.');
  const blob = new Blob(parts, { type: config ? 'application/json' : 'application/octet-stream' });
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== digest)
    throw new Error('Voice integrity verification failed. The download was discarded.');
  signal?.throwIfAborted();
  const result = new Response(blob, {
    headers: { 'Content-Type': blob.type, 'Content-Length': String(size) },
  });
  try {
    await cache?.put(url, result.clone());
  } catch {
    /* Optional cache, never a synthesis failure. */
  }
  return result;
}

export async function cachedVoices(): Promise<string[]> {
  try {
    const cache = await caches.open(SPEECH_MODEL_CACHE);
    const cached = await Promise.all(
      VOICES.map(async (voice) => {
        const model = await cache.match(modelUrl(voice));
        const config = await cache.match(modelUrl(voice, true));
        return model && config ? voice.id : undefined;
      }),
    );
    return cached.filter((id): id is NonNullable<typeof id> => Boolean(id));
  } catch {
    return [];
  }
}
export async function clearVoiceCache() {
  if (typeof caches !== 'undefined') await caches.delete(SPEECH_MODEL_CACHE);
}

/** Aggregate decoded model and config bytes, including cache hits, without phase resets. */
export async function loadVoiceFiles(
  voice: PresentationVoice,
  progress?: Progress,
  signal?: AbortSignal,
) {
  const loaded = [0, 0];
  const total = voice.modelBytes + voice.configBytes;
  const files = await Promise.all(
    [false, true].map((config, index) =>
      loadVoiceFile(
        voice,
        config,
        (value) => {
          loaded[index] = Math.max(loaded[index], value.loaded);
          progress?.({ ...value, loaded: loaded[0] + loaded[1], total });
        },
        signal,
      ),
    ),
  );
  return { model: await files[0].arrayBuffer(), config: (await files[1].json()) as unknown };
}
