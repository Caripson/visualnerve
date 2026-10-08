import { useSyncExternalStore } from 'react';
import { matchesCompactLayout } from '../hooks/useCompactLayout';
import { useEditor } from '../state/editor';
import { repository } from '../storage/repository';
import { Narrator } from './narrator';
import { PresentationPlayer } from './runtime';
import { speechService } from './speech/service';
import { VOICE_SETTING, normalizeVoiceId, VOICES, DEFAULT_VOICE_ID } from './speech/voices';
import type { SpeechProgress } from './speech/protocol';
import {
  PRESENTATION_RELEASE,
  PRESENTATION_REVEAL,
  type PresentationRevealRequest,
} from './camera';
import type { PresentationStep } from './sequence';
import { assertStoryboardViewCompatible } from './view-compatibility';

let requestId = 0;
let selectionBefore: { diagramId: string; nodes: string[]; edges: string[] } | undefined;
export function releasePresentationHighlight() {
  const state = useEditor.getState();
  if (selectionBefore && state.graph?.diagram.id === selectionBefore.diagramId) {
    const nodes = new Set(state.graph.nodes.map((node) => node.id)),
      edges = new Set(state.graph.edges.map((edge) => edge.id));
    useEditor.setState({
      selectedNodes: selectionBefore.nodes.filter((id) => nodes.has(id)),
      selectedEdges: selectionBefore.edges.filter((id) => edges.has(id)),
    });
  }
  selectionBefore = undefined;
  window.dispatchEvent(new Event(PRESENTATION_RELEASE));
}
function rememberSelection() {
  const state = useEditor.getState();
  if (state.graph && (!selectionBefore || selectionBefore.diagramId !== state.graph.diagram.id))
    selectionBefore = {
      diagramId: state.graph.diagram.id,
      nodes: [...state.selectedNodes],
      edges: [...state.selectedEdges],
    };
}
function moveCamera(
  target: {
    nodeId: string;
    nodeIds?: string[];
    edgeIds?: string[];
    view?: PresentationStep['view'];
  },
  transitionMs: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  rememberSelection();
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
        detail: { ...target, transitionMs, requestId: id },
      }),
    );
  });
}
export function focusPresentationCamera(nodeId: string, transitionMs: number, signal: AbortSignal) {
  return moveCamera({ nodeId }, transitionMs, signal);
}
function stepTarget(step: PresentationStep) {
  const graph = useEditor.getState().graph;
  const edges = graph?.edges.filter((edge) => step.edgeIds.includes(edge.id)) ?? [];
  const ids = [
    ...new Set([
      ...step.nodeIds,
      ...edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
    ]),
  ];
  return {
    nodeId: ids[0],
    nodeIds: ids,
    edgeIds: step.edgeIds,
    ...(step.view ? { view: step.view } : {}),
  };
}
export function revealPresentationStep(step: PresentationStep, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const graph = useEditor.getState().graph;
  if (graph) assertStoryboardViewCompatible(graph, step.view);
  rememberSelection();
  const target = stepTarget(step);
  useEditor.setState({ selectedNodes: target.nodeIds, selectedEdges: target.edgeIds });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      error ? reject(new Error(error)) : resolve();
    };
    const stop = () => finish('Storyboard preparation cancelled.');
    const timer = setTimeout(
      () => finish('The diagram view did not prepare the storyboard objects.'),
      8000,
    );
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) {
      stop();
      return;
    }
    window.dispatchEvent(
      new CustomEvent<PresentationRevealRequest>(PRESENTATION_REVEAL, {
        detail: {
          nodeIds: target.nodeIds,
          edgeIds: target.edgeIds,
          signal,
          respond: () => finish(),
          error: finish,
        },
      }),
    );
  });
}
export async function focusPresentationStepCamera(step: PresentationStep, signal: AbortSignal) {
  await revealPresentationStep(step, signal);
  signal.throwIfAborted();
  return moveCamera(stepTarget(step), step.transitionMs, signal);
}
const progressAdapter =
  (progress: (value: number, message: string, stage?: SpeechProgress['stage']) => void) =>
  (value: SpeechProgress) => {
    const fraction = value.total ? value.loaded / value.total : 0;
    const percent = value.total ? ` ${Math.floor(fraction * 100)}%` : '';
    const elapsed =
      value.elapsedMs && value.elapsedMs >= 1000 ? ` (${Math.floor(value.elapsedMs / 1000)}s)` : '';
    progress(fraction, `${value.message}${percent}${elapsed}`, value.stage);
  };
export const presentation = new PresentationPlayer({
  graph: () => useEditor.getState().graph,
  minimizedDefault: matchesCompactLayout,
  voice: async () => normalizeVoiceId((await repository.db.settings.get(VOICE_SETTING))?.value),
  prepare: (text, voice, signal, progress, options) =>
    speechService.prepare(
      text,
      normalizeVoiceId(voice),
      signal,
      progressAdapter(progress),
      options,
    ),
  preloadVoice: (voice, signal, progress) =>
    speechService.preload(normalizeVoiceId(voice), signal, progressAdapter(progress)),
  focus: focusPresentationCamera,
  focusStep: focusPresentationStepCamera,
  releaseHighlight: releasePresentationHighlight,
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
