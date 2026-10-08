import { useSyncExternalStore } from 'react';
import { useEditor } from '../state/editor';
import { repository } from '../storage/repository';
import { download } from '../export/semantic';
import { assertExportActive, checkExportActive, type ExportGuard } from '../export/guard';
import type { WorkspaceOperation } from '../storage/contracts';
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
import { VideoCleanupCoordinator } from './video-lifecycle';
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, videoOptions } from './video-types';
import { videoGraphFingerprint } from './video-graph';
import { presentationSteps } from './sequence';
import { assertStoryboardViewCompatible } from './view-compatibility';

interface VideoJob {
  guard: ExportGuard;
  storage(): Promise<WorkspaceOperation>;
  dispose(): void;
}
let job: VideoJob | undefined;
let file: { blob: Blob; name: string; job: VideoJob } | undefined;
const cleanup = new VideoCleanupCoordinator();

/** Capture before the first await, including when a live API call starts the movie. */
function captureVideoJob(external: boolean): VideoJob {
  const pending = repository.db.captureOperation();
  const controller = new AbortController();
  let operation: WorkspaceOperation | undefined;
  let disposed = false;
  const revoked = () => controller.abort();
  const captured = pending.then(
    (value) => {
      operation = value;
      if (disposed) value.dispose();
      else {
        value.signal.addEventListener('abort', revoked, { once: true });
        if (value.signal.aborted) revoked();
      }
      return value;
    },
    (error) => {
      revoked();
      throw error;
    },
  );
  // A synchronous preflight can reject before the runtime starts awaiting the capture.
  void captured.catch(() => undefined);
  const assertCurrent = () => {
    if (disposed || controller.signal.aborted || operation?.signal.aborted)
      throw new DOMException('Video export cancelled.', 'AbortError');
    const state = useEditor.getState();
    if (!state.privacyAcknowledged)
      throw new StorageError(403, 'Local storage permission revoked.');
    if (external && state.mcpAccess !== 'write')
      throw new StorageError(403, 'MCP write access revoked.');
  };
  return {
    storage: () => captured,
    guard: {
      signal: controller.signal,
      assertCurrent,
      check: async () => {
        const originating = await captured;
        assertCurrent();
        await originating.check();
        await originating.storage.atomic('r', ['settings'], async (scope) => {
          if ((await scope.settings.get('storage-consent'))?.value !== true)
            throw new StorageError(403, 'Local storage permission revoked.');
          if (external && (await scope.settings.get('mcp-access'))?.value !== 'write')
            throw new StorageError(403, 'MCP write access revoked.');
        });
        await originating.check();
        assertCurrent();
      },
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      operation?.signal.removeEventListener('abort', revoked);
      revoked();
      operation?.dispose();
    },
  };
}
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
  voice: async () => {
    const originating = job;
    if (!originating) throw new DOMException('Video export cancelled.', 'AbortError');
    const operation = await originating.storage();
    const voice = await operation.storage.settings.get(VOICE_SETTING);
    assertExportActive(originating.guard);
    return normalizeVoiceId(voice?.value);
  },
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
    const originating = job;
    if (!originating) throw new DOMException('Video export cancelled.', 'AbortError');
    assertExportActive(originating.guard);
    file = { blob, name, job: originating };
    download(name, blob);
  },
});
export const isVideoExporting = () => videoExport.isBusy() || cleanup.isBusy();
export function useVideoExport() {
  const state = useSyncExternalStore(
    videoExport.subscribe,
    videoExport.getState,
    videoExport.getState,
  );
  useSyncExternalStore(cleanup.subscribe, cleanup.isBusy, cleanup.isBusy);
  return state;
}
export async function saveVideo() {
  const saved = file;
  if (!saved) return;
  try {
    await checkExportActive(saved.job.guard);
    if (file !== saved) return;
    assertExportActive(saved.job.guard);
    download(saved.name, saved.blob);
  } catch {
    if (file === saved) {
      file = undefined;
      saved.job.dispose();
      if (job === saved.job) job = undefined;
      videoExport.reset();
    }
  }
}
/** Lock/maintenance waits for old camera/encoder cleanup before allowing another session. */
export async function disposeVideoExport() {
  file = undefined;
  job?.dispose();
  job = undefined;
  videoExport.reset();
  await videoExport.settled();
  await cleanup.settled();
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
  const originating = captureVideoJob(external);
  job?.dispose();
  file = undefined;
  job = originating;
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
  const cleanupListeners = () => {
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
    const state = videoExport.start(options, originating.guard);
    const completing = cleanup.track(videoExport.settled(), () => {
      cleanupListeners();
      if (file?.job !== originating) {
        originating.dispose();
        if (job === originating) job = undefined;
      }
    });
    void completing.catch(() => undefined);
    return state;
  } catch (error) {
    cleanupListeners();
    originating.dispose();
    if (job === originating) job = undefined;
    throw error;
  }
}
