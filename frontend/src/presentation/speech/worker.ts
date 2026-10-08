import { PiperEngine } from './piper-engine';
import {
  MAX_NARRATION_CHARACTERS,
  type SpeechRequest,
  type SpeechResponse,
  type SpeechProgress,
} from './protocol';
import { voiceInfo, modelUrl, type VoiceId } from './voices';
import { fetchAppAsset } from '../../security/app-cache';

const scope = self as unknown as {
  onmessage: (event: MessageEvent<SpeechRequest>) => void;
  postMessage: (response: SpeechResponse) => void;
};
const networkFetch = globalThis.fetch.bind(globalThis);
let engine: PiperEngine | undefined;
let activeVoice: VoiceId | undefined;
let busy = false;

// Executable/WASM assets stay on this origin. The only remote requests are pinned voice binaries.
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  const voice = activeVoice ? voiceInfo(activeVoice) : undefined;
  const local = url.origin === location.origin;
  if (!local && (!voice || ![modelUrl(voice), modelUrl(voice, true)].includes(url.href)))
    throw new Error('The voice engine only loads its local runtime and fixed voice model.');
  const response = await fetchAppAsset(networkFetch, input, init);
  if (local && !response.ok)
    throw new Error(
      `A local voice runtime file could not load (${response.status}). Reload or check the website deployment.`,
    );
  return response;
};
scope.onmessage = async ({ data }) => {
  if (busy) {
    scope.postMessage({ id: data.id, error: 'The voice engine is already preparing audio.' });
    return;
  }
  busy = true;
  let current: SpeechProgress | undefined;
  let phaseStarted = Date.now();
  const notify = (progress: SpeechProgress) => {
    if (
      !current ||
      current.stage !== progress.stage ||
      current.operation !== progress.operation ||
      current.loaded !== progress.loaded
    )
      phaseStarted = Date.now();
    current = progress;
    scope.postMessage({
      id: data.id,
      progress: { ...progress, elapsedMs: Date.now() - phaseStarted },
    });
  };
  const heartbeat = setInterval(() => {
    if (current)
      scope.postMessage({
        id: data.id,
        progress: { ...current, elapsedMs: Date.now() - phaseStarted },
      });
  }, 1000);
  try {
    voiceInfo(data.voiceId);
    const base = new URL(data.assetBase);
    if (base.origin !== location.origin) throw new Error('Invalid local voice runtime path.');
    if (
      !['preload', 'prepare'].includes(data.action) ||
      (data.action === 'prepare' &&
        (!data.text?.trim() || data.text.length > MAX_NARRATION_CHARACTERS))
    )
      throw new Error('Narration must contain 1 to 12,000 characters.');
    if (activeVoice !== data.voiceId) {
      await engine?.dispose();
      engine = undefined;
    }
    activeVoice = data.voiceId;
    if (!engine) engine = await PiperEngine.create(data.voiceId, base, notify);
    if (data.action === 'preload') scope.postMessage({ id: data.id, ready: true });
    else {
      const audio = await engine.prepare(data.text!, notify);
      scope.postMessage({ id: data.id, ready: true, audio });
    }
  } catch (error) {
    await engine?.dispose().catch(() => undefined);
    engine = undefined;
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'Could not prepare narration.',
    });
  } finally {
    clearInterval(heartbeat);
    current = undefined;
    busy = false;
  }
};
