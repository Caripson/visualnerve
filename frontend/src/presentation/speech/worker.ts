import { TtsSession } from '@mintplex-labs/piper-tts-web';
import { loadVoiceFile } from './model-cache';
import {
  MAX_NARRATION_CHARACTERS,
  type SpeechRequest,
  type SpeechResponse,
  type SpeechProgress,
} from './protocol';
import { voiceInfo, type VoiceId } from './voices';

const scope = self as unknown as {
  onmessage: (event: MessageEvent<SpeechRequest>) => void;
  postMessage: (response: SpeechResponse) => void;
};
const networkFetch = globalThis.fetch.bind(globalThis);
let session: TtsSession | undefined;
let activeVoice: VoiceId | undefined;
let notify: ((progress: SpeechProgress) => void) | undefined;
let busy = false;

// The upstream adapter's unversioned OPFS filenames could retain old weights.
// Our versioned, integrity-checked CacheStorage is the sole voice cache instead.
if (navigator.storage)
  Object.defineProperty(navigator.storage, 'getDirectory', {
    value: async () => ({
      getDirectoryHandle: async () => ({
        getFileHandle: async () => ({
          getFile: async () => {
            throw new DOMException('No unversioned voice file.', 'NotFoundError');
          },
          // The library writes after fetch; loadVoiceFile already owns validated caching.
          createWritable: async () => ({
            write: async () => undefined,
            close: async () => undefined,
          }),
        }),
      }),
    }),
  });
// S3 hosting does not require cross-origin isolation: one WASM thread stays in this worker.
Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1 });
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (
    activeVoice &&
    url.startsWith('https://huggingface.co/diffusionstudio/piper-voices/resolve/main/')
  ) {
    const voice = voiceInfo(activeVoice);
    const expected = `https://huggingface.co/diffusionstudio/piper-voices/resolve/main/${voice.path}`;
    if (url !== expected && url !== `${expected}.json`)
      throw new Error('Unsupported voice download.');
    return loadVoiceFile(voice, url.endsWith('.json'), notify);
  }
  const parsed = new URL(url, location.href);
  // loadVoiceFile calls fetch through this same adapter, with a pinned catalog URL.
  const voice = activeVoice ? voiceInfo(activeVoice) : undefined;
  if (
    voice &&
    parsed.origin === 'https://huggingface.co' &&
    (url.endsWith(`/${voice.path}`) || url.endsWith(`/${voice.path}.json`))
  )
    return networkFetch(input, init);
  if (parsed.origin !== location.origin)
    throw new Error('The voice engine only loads its local runtime and fixed voice model.');
  return networkFetch(input, init);
};

scope.onmessage = async ({ data }) => {
  if (busy) {
    scope.postMessage({ id: data.id, error: 'The voice engine is already preparing audio.' });
    return;
  }
  busy = true;
  notify = (progress) => scope.postMessage({ id: data.id, progress });
  try {
    voiceInfo(data.voiceId);
    const base = new URL(data.assetBase);
    if (base.origin !== location.origin) throw new Error('Invalid local voice runtime path.');
    if (
      data.action === 'prepare' &&
      (!data.text?.trim() || data.text.length > MAX_NARRATION_CHARACTERS)
    )
      throw new Error('Narration must contain 1 to 12,000 characters.');
    if (activeVoice !== data.voiceId) {
      session = undefined;
      TtsSession._instance = null;
    }
    activeVoice = data.voiceId;
    notify({ stage: 'loading', loaded: 0, total: 0, message: 'Loading the local neural voice…' });
    session ??= await TtsSession.create({
      voiceId: data.voiceId,
      progress: ({ url, loaded, total }) => {
        if (url === 'tts://inference-progress')
          notify?.({ stage: 'synthesis', loaded, total, message: 'Preparing narration…' });
      },
      wasmPaths: {
        onnxWasm: base.href,
        piperData: new URL('piper_phonemize.data', base).href,
        piperWasm: new URL('piper_phonemize.wasm', base).href,
      },
    });
    if (data.action === 'preload') {
      scope.postMessage({ id: data.id, ready: true });
      return;
    }
    notify({ stage: 'synthesis', loaded: 0, total: 0, message: 'Preparing narration…' });
    const audio = await session.predict(data.text!);
    scope.postMessage({ id: data.id, ready: true, audio });
  } catch (error) {
    session = undefined;
    TtsSession._instance = null;
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'Could not prepare narration.',
    });
  } finally {
    busy = false;
    notify = undefined;
  }
};
