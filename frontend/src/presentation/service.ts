import { useSyncExternalStore } from 'react';
import { useEditor } from '../state/editor';
import { repository } from '../storage/repository';
import { StorageError } from '../model/errors';
import { Narrator } from './narrator';
import { PresentationPlayer } from './runtime';
import { speechService } from './speech/service';
import { VOICE_SETTING, normalizeVoiceId, VOICES, DEFAULT_VOICE_ID } from './speech/voices';
import type { SpeechProgress } from './speech/protocol';

let requestId = 0;
export function focusPresentationCamera(nodeId: string, transitionMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = ++requestId;
    const finish = (error?: string) => {
      clearTimeout(timeout);
      window.removeEventListener('visualnerve:presentation-arrived', arrived);
      signal.removeEventListener('abort', aborted);
      if (error) reject(new Error(error));
      else resolve();
    };
    const arrived = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.requestId === id) finish(detail.error);
    };
    const aborted = () => finish('Camera movement cancelled.');
    const timeout = setTimeout(
      () => finish('The diagram renderer did not respond. Open the diagram view and try again.'),
      transitionMs + 10000,
    );
    window.addEventListener('visualnerve:presentation-arrived', arrived);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    window.dispatchEvent(
      new CustomEvent('visualnerve:presentation-focus', {
        detail: { nodeId, transitionMs, requestId: id },
      }),
    );
  });
}
const progressAdapter =
  (progress: (value: number, message: string) => void) => (value: SpeechProgress) =>
    progress(value.total ? value.loaded / value.total : 0, value.message);
export const presentation = new PresentationPlayer({
  graph: () => useEditor.getState().graph,
  voice: async () => normalizeVoiceId((await repository.db.settings.get(VOICE_SETTING))?.value),
  prepare: (text, voice, signal, progress) =>
    speechService.prepare(text, normalizeVoiceId(voice), signal, progressAdapter(progress)),
  preloadVoice: (voice, signal, progress) =>
    speechService.preload(normalizeVoiceId(voice), signal, progressAdapter(progress)),
  focus: focusPresentationCamera,
  cancelCamera: () => window.dispatchEvent(new Event('visualnerve:presentation-camera-cancel')),
  narration: new Narrator(),
  release: () => speechService.cancel(),
});
export function usePresentation() {
  return useSyncExternalStore(presentation.subscribe, presentation.getState, presentation.getState);
}
export function voiceCatalog() {
  return {
    defaultVoiceId: DEFAULT_VOICE_ID,
    voices: VOICES.map((voice) => ({
      id: voice.id,
      label: voice.label,
      language: voice.language.startsWith('sv') ? 'sv' : 'en',
      sampleRate: voice.sampleRate,
      modelBytes: voice.modelBytes,
      license: voice.license,
      source: voice.source,
    })),
  };
}
export async function presentationRequest(
  path: string,
  method: string,
  value?: unknown,
  authorize?: () => Promise<void>,
) {
  const video = await import('./video-service');
  await authorize?.();
  if (path === '/presentation/video') {
    if (method === 'GET') return video.videoExport.getState();
    if (method === 'POST') return video.startVideo(value, true);
    if (method === 'DELETE') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
        throw new StorageError(422, 'Cancel video export requires an empty object.');
      return video.videoExport.cancel();
    }
    throw new StorageError(404, 'Unknown video endpoint.');
  }
  if (path === '/presentation/voices' && method === 'GET') return voiceCatalog();
  if (path === '/presentation' && method === 'GET') return presentation.getState();
  if (path === '/presentation' && method === 'PATCH') {
    if (video.isVideoExporting())
      throw new StorageError(409, 'Cancel or finish video export before controlling the player.');
    return presentation.options(value);
  }
  const action = path.slice('/presentation/'.length);
  if (
    method !== 'POST' ||
    !['open', 'play', 'pause', 'rewind', 'forward', 'close', 'preload'].includes(action)
  )
    throw new StorageError(404, 'Unknown presentation endpoint.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
    throw new StorageError(422, 'This player command requires an empty object.');
  if (video.isVideoExporting()) {
    if (action === 'close') video.videoExport.cancel();
    else
      throw new StorageError(409, 'Cancel or finish video export before controlling the player.');
  }
  switch (action) {
    case 'open':
      return presentation.open();
    case 'play':
      return presentation.play();
    case 'pause':
      return presentation.pause();
    case 'rewind':
      return presentation.skip(-1);
    case 'forward':
      return presentation.skip(1);
    case 'close':
      return presentation.close();
    default:
      return presentation.preload();
  }
}
