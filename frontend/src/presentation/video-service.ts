import { useSyncExternalStore } from 'react';
import { useEditor } from '../state/editor';
import { repository } from '../storage/repository';
import { download } from '../export/semantic';
import { StorageError } from '../model/errors';
import {
  focusPresentationCamera,
  focusPresentationStepCamera,
  revealPresentationStep,
  releasePresentationHighlight,
  presentation,
} from './service';
import { speechService } from './speech/service';
import { normalizeVoiceId, VOICE_SETTING } from './speech/voices';
import { VideoExporter } from './video-runtime';
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, videoOptions } from './video-types';
import { videoGraphFingerprint } from './video-graph';
import { presentationSteps } from './sequence';
import { assertStoryboardViewCompatible } from './view-compatibility';

let file: { blob: Blob; name: string } | undefined;
function nextFrame(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', stop);
      reject(signal.reason);
    };
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}
export const videoExport = new VideoExporter({
  graph: () => useEditor.getState().graph,
  voice: async () => normalizeVoiceId((await repository.db.settings.get(VOICE_SETTING))?.value),
  prepare: (text, voice, signal, progress) =>
    speechService.prepare(text, normalizeVoiceId(voice), signal, (value) =>
      progress(value.message),
    ),
  scene: async (signal) => (await import('./video-scene')).createVideoScene(signal),
  encoder: async (canvas, audio, signal) =>
    (await import('./video-encoder')).createVideoEncoder(
      { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, fps: VIDEO_FPS, audio, signal },
      canvas,
    ),
  focus: focusPresentationCamera,
  prepareStep: revealPresentationStep,
  focusStep: focusPresentationStepCamera,
  stop: () => {
    presentation.pause('', true);
    window.dispatchEvent(new Event('visualnerve:presentation-camera-cancel'));
    speechService.cancel();
  },
  nextFrame,
  ready: (blob, name) => {
    file = { blob, name };
    download(name, blob);
  },
});
export const isVideoExporting = () => videoExport.isBusy();
export function useVideoExport() {
  return useSyncExternalStore(videoExport.subscribe, videoExport.getState, videoExport.getState);
}
export function saveVideo() {
  if (file) download(file.name, file.blob);
}
export function startVideo(value: unknown, external = false) {
  const options = videoOptions(value, presentation.getState());
  const before = useEditor.getState();
  if (!before.privacyAcknowledged)
    throw new StorageError(403, 'Accept local storage before exporting video.');
  if (external && before.mcpAccess !== 'write')
    throw new StorageError(403, 'Video export requires MCP write access.');
  if (document.hidden) throw new StorageError(409, 'Keep the diagram tab visible to export video.');
  if (isVideoExporting()) throw new StorageError(409, 'A video export is already running.');
  if (before.graph)
    for (const step of presentationSteps(before.graph, options.source ?? 'nodes'))
      assertStoryboardViewCompatible(before.graph, step.view);
  before.finishEditing();
  window.dispatchEvent(new Event('visualnerve:spatial-camera-flush'));
  const editor = useEditor.getState();
  const id = editor.graph?.diagram.id;
  const fingerprint = videoGraphFingerprint(editor.graph, editor.owners);
  const filters = JSON.stringify(editor.filters);
  const theme = editor.theme;
  let previousGraph = editor.graph;
  let previousOwners = editor.owners;
  const unsubscribe = useEditor.subscribe((state) => {
    if (!state.privacyAcknowledged) videoExport.cancel('Local storage permission revoked.');
    else if (external && state.mcpAccess !== 'write')
      videoExport.cancel('MCP write access revoked.');
    else if (
      state.graph?.diagram.id !== id ||
      state.theme !== theme ||
      JSON.stringify(state.filters) !== filters
    )
      videoExport.cancel('The diagram changed. Start a new export to include your changes.');
    else if (state.graph !== previousGraph || state.owners !== previousOwners) {
      previousGraph = state.graph;
      previousOwners = state.owners;
      if (videoGraphFingerprint(state.graph, state.owners) !== fingerprint)
        videoExport.cancel('The diagram changed. Start a new export to include your changes.');
    }
  });
  const interrupted = () => videoExport.cancel('Camera taken over. Start a new export when ready.');
  const hidden = () => {
    if (document.hidden) videoExport.cancel('Video export cancelled while the tab was hidden.');
  };
  const close = () => videoExport.cancel();
  window.addEventListener('visualnerve:presentation-interrupted', interrupted);
  const surface = document.querySelector('.canvas-shell');
  surface?.addEventListener('pointerdown', interrupted, true);
  surface?.addEventListener('wheel', interrupted, true);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', close);
  const cleanup = () => {
    releasePresentationHighlight();
    unsubscribe();
    window.removeEventListener('visualnerve:presentation-interrupted', interrupted);
    surface?.removeEventListener('pointerdown', interrupted, true);
    surface?.removeEventListener('wheel', interrupted, true);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', close);
  };
  try {
    if (
      !presentation.getState().open ||
      presentation.getState().source !== (options.source ?? 'nodes')
    )
      presentation.open(options.source ?? 'nodes');
    const state = videoExport.start(options);
    file = undefined;
    void videoExport.settled().finally(cleanup);
    return state;
  } catch (error) {
    cleanup();
    throw error;
  }
}
