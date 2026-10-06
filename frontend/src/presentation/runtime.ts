import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { presentationSteps, type PresentationStep } from './sequence';
import type { PresentationSource } from './storyboard';
import type { PresentationRuntimeState } from './types';

export interface Narration {
  unlock(): Promise<void>;
  play(blob: Blob, signal: AbortSignal): Promise<number>;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
  remaining?(): number;
}
export interface PlayerDependencies {
  graph(): Graph | null;
  voice(): Promise<string>;
  prepare(
    text: string,
    voice: string,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
  ): Promise<Blob>;
  preloadVoice(
    voice: string,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
  ): Promise<void>;
  focus(nodeId: string, transitionMs: number, signal: AbortSignal): Promise<void>;
  focusStep?(step: PresentationStep, signal: AbortSignal): Promise<void>;
  releaseHighlight?(): void;
  cancelCamera(): void;
  release?(): void;
  narration: Narration;
}
const initial: PresentationRuntimeState = {
  open: false,
  diagramId: null,
  status: 'idle',
  index: -1,
  total: 0,
  nodeId: null,
  source: 'nodes',
  sceneId: null,
  nodeIds: [],
  edgeIds: [],
  title: '',
  narration: '',
  audio: false,
  subtitles: true,
  preload: false,
  buffered: 0,
  progress: 0,
  message: '',
};
const active = new Set(['loading', 'moving', 'playing']);
/** Transient player state. Numbering lives in the graph; cameras/audio never do. */
export class PresentationPlayer {
  private state = { ...initial };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private abort?: AbortController;
  private background?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline = 0;
  private remaining = 0;
  private resumable = false;
  private needsFocus = false;
  private clips = new Map<string, Blob>();
  private sequence: string[] = [];
  constructor(private deps: PlayerDependencies) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<PresentationRuntimeState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private snapshot() {
    const graph = this.deps.graph();
    if (!graph || graph.diagram.id !== this.state.diagramId)
      throw new StorageError(409, 'Open the presentation diagram first.');
    return graph;
  }
  private fields(step?: PresentationStep) {
    return {
      nodeId: step?.nodeIds[0] ?? null,
      sceneId: this.state.source === 'storyboard' ? (step?.id ?? null) : null,
      nodeIds: step?.nodeIds ?? [],
      edgeIds: step?.edgeIds ?? [],
      title: step?.name ?? '',
      narration: step?.narration ?? '',
    };
  }
  private steps(graph = this.snapshot()) {
    return presentationSteps(graph, this.state.source);
  }
  private focus(step: PresentationStep, signal: AbortSignal) {
    return this.deps.focusStep
      ? this.deps.focusStep(step, signal)
      : this.deps.focus(step.nodeIds[0], step.transitionMs, signal);
  }
  open(source: PresentationSource = 'nodes') {
    const graph = this.deps.graph();
    if (!graph) throw new StorageError(409, 'Open a diagram first.');
    this.cancel();
    this.clips.clear();
    this.deps.releaseHighlight?.();
    this.update({ source });
    const steps = this.steps(graph);
    this.sequence = steps.map((step) => step.id);
    this.update({
      open: true,
      diagramId: graph.diagram.id,
      status: 'idle',
      index: this.sequence.length ? 0 : -1,
      total: this.sequence.length,
      ...this.fields(steps[0]),
      buffered: 0,
      progress: 0,
      message: '',
    });
    return this.state;
  }
  close() {
    this.cancel();
    this.clips.clear();
    this.deps.narration.dispose();
    this.deps.release?.();
    this.deps.releaseHighlight?.();
    this.update({
      ...initial,
      audio: this.state.audio,
      subtitles: this.state.subtitles,
      preload: this.state.preload,
      source: this.state.source,
    });
    return this.state;
  }
  /** Called on edits/navigation: stop stale descriptions/routes, retain the current step if possible. */
  changed() {
    if (!this.state.open) return;
    const graph = this.deps.graph();
    if (!graph || graph.diagram.id !== this.state.diagramId) {
      this.close();
      return;
    }
    const wasActive = active.has(this.state.status);
    const previous = this.state.sceneId ?? this.state.nodeId;
    this.cancel();
    this.clips.clear();
    this.deps.releaseHighlight?.();
    const steps = this.steps(graph);
    this.sequence = steps.map((step) => step.id);
    const index = Math.max(0, this.sequence.indexOf(previous ?? ''));
    this.update({
      total: this.sequence.length,
      index: this.sequence.length ? index : -1,
      ...this.fields(steps[index]),
      status: wasActive ? 'paused' : 'idle',
      buffered: 0,
      progress: 0,
      message: wasActive ? 'Diagram changed. Press Play to continue with the updated diagram.' : '',
    });
  }
  private cancel() {
    ++this.epoch;
    this.abort?.abort();
    this.background?.abort();
    this.abort = this.background = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.deps.narration.stop();
    this.deps.cancelCamera();
    this.resumable = false;
    this.needsFocus = false;
    this.remaining = 0;
  }
  pause(message = '', refocus = false) {
    if (!this.state.open) return this.state;
    if (this.state.status === 'paused') {
      this.needsFocus ||= refocus;
      if (message) this.update({ message });
      return this.state;
    }
    if (this.state.status === 'playing') {
      this.remaining = Math.max(0, this.deadline - Date.now());
      clearTimeout(this.timer);
      this.timer = undefined;
      this.deps.narration.pause();
      this.resumable = true;
      this.needsFocus = refocus;
      this.background?.abort();
      this.deps.cancelCamera();
    } else this.cancel();
    this.update({ status: 'paused', message });
    return this.state;
  }
  async play() {
    if (!this.state.open) this.open();
    if (active.has(this.state.status)) return this.state;
    if (!this.sequence.length)
      throw new StorageError(
        422,
        this.state.source === 'storyboard'
          ? 'Create a storyboard scene before playing.'
          : 'Number some nodes before playing the diagram.',
      );
    // Invoked synchronously from the user's click, before downloads or camera awaits.
    const epoch = this.epoch;
    const unlocked = this.state.audio ? this.deps.narration.unlock() : Promise.resolve();
    try {
      await unlocked;
    } catch (error) {
      if (epoch === this.epoch && this.state.open) this.fail(error);
      return this.state;
    }
    if (!this.state.open || epoch !== this.epoch) return this.state;
    if (this.resumable && this.state.status === 'paused') {
      try {
        const step = this.steps()[this.state.index];
        if (this.needsFocus && step) {
          this.abort?.abort();
          this.abort = new AbortController();
          this.update({ status: 'moving', message: '' });
          await this.focus(step, this.abort.signal);
          if (epoch !== this.epoch) return this.state;
          this.needsFocus = false;
        }
        if (this.state.audio) this.deps.narration.resume();
        this.update({ status: 'playing', message: '' });
        this.schedule(this.remaining);
        this.prefetch();
      } catch (error) {
        if (epoch === this.epoch) this.fail(error);
      }
      return this.state;
    }
    if (this.state.status === 'ended') this.update({ index: 0, ...this.fields(this.steps()[0]) });
    void this.step(true);
    return this.state;
  }
  private fail(error: unknown) {
    this.cancel();
    this.deps.releaseHighlight?.();
    this.update({
      status: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  private progress(epoch: number) {
    return (progress: number, message: string) => {
      if (epoch === this.epoch)
        this.update({ progress: Math.max(0, Math.min(1, progress)), message });
    };
  }
  private key(voice: string, text: string) {
    return `${voice}\0${text}`;
  }
  private async clip(text: string, voice: string, signal: AbortSignal, epoch: number) {
    const key = this.key(voice, text);
    let blob = this.clips.get(key);
    if (!blob) {
      blob = await this.deps.prepare(text, voice, signal, this.progress(epoch));
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      // Three clips/32 MiB bound narration memory, independent of node count.
      while (
        this.clips.size >= 3 ||
        [...this.clips.values()].reduce((sum, value) => sum + value.size, 0) + blob.size >
          32 * 1024 * 1024
      ) {
        const first = this.clips.keys().next().value;
        if (first === undefined) break;
        this.clips.delete(first);
      }
      if (blob.size <= 32 * 1024 * 1024) this.clips.set(key, blob);
    }
    this.update({ buffered: this.clips.size });
    return blob;
  }
  private async step(continuePlaying: boolean) {
    this.cancel();
    const epoch = this.epoch;
    const abort = new AbortController();
    this.abort = abort;
    try {
      const graph = this.snapshot();
      const step = this.steps(graph)[this.state.index];
      const existing = new Set(graph.nodes.map((node) => node.id));
      if (!step || step.nodeIds.some((id) => !existing.has(id)))
        throw new StorageError(409, 'This presentation object no longer exists.');
      this.update({ ...this.fields(step), status: 'loading', progress: 0, message: '' });
      let blob: Blob | undefined;
      if (continuePlaying && this.state.audio && step.narration.trim())
        blob = await this.clip(step.narration, await this.deps.voice(), abort.signal, epoch);
      if (epoch !== this.epoch) return;
      this.update({ status: 'moving', progress: 0, message: '' });
      await this.focus(step, abort.signal);
      if (epoch !== this.epoch) return;
      if (!continuePlaying) {
        this.update({ status: 'paused' });
        return;
      }
      const seconds = blob ? await this.deps.narration.play(blob, abort.signal) : 0;
      if (epoch !== this.epoch) return;
      this.update({ status: 'playing', progress: 1, message: '' });
      this.schedule(Math.max(step.seconds, seconds) * 1000);
      this.prefetch();
    } catch (error) {
      if (epoch !== this.epoch || abort.signal.aborted) return;
      this.fail(error);
    }
  }
  private schedule(ms: number) {
    this.deadline = Date.now() + ms;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // A fresh audio device or suspended context may lag behind the wall clock.
      // Wait for real WAV completion before moving to the next module.
      const audioRemaining = this.state.audio ? (this.deps.narration.remaining?.() ?? 0) : 0;
      if (audioRemaining > 0) {
        this.schedule(audioRemaining * 1000 + 25);
        return;
      }
      if (this.state.index + 1 >= this.sequence.length) {
        this.cancel();
        this.update({ status: 'ended', message: '' });
      } else {
        this.update({ index: this.state.index + 1 });
        void this.step(true);
      }
    }, ms);
  }
  skip(direction: -1 | 1) {
    if (!this.state.open) this.open();
    if (!this.sequence.length)
      throw new StorageError(422, 'Add a walkthrough node or storyboard scene first.');
    const running = active.has(this.state.status);
    this.update({
      index: Math.max(0, Math.min(this.sequence.length - 1, this.state.index + direction)),
    });
    void this.step(running);
    return this.state;
  }
  seek(index: number) {
    if (!this.state.open) this.open();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.sequence.length)
      throw new StorageError(422, 'Seek index must identify an existing walkthrough step.');
    this.update({ index });
    void this.step(false);
    return this.state;
  }
  options(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new StorageError(422, 'Expected player options.');
    const entries = Object.entries(value);
    if (
      !entries.length ||
      entries.some(
        ([key, option]) =>
          !['audio', 'subtitles', 'preload'].includes(key) || typeof option !== 'boolean',
      )
    )
      throw new StorageError(422, 'Player options must be audio, subtitles or preload booleans.');
    const patch = value as Partial<
      Pick<PresentationRuntimeState, 'audio' | 'subtitles' | 'preload'>
    >;
    if (
      patch.audio !== undefined &&
      patch.audio !== this.state.audio &&
      active.has(this.state.status)
    )
      this.pause('Audio changed. Press Play to continue.');
    if (patch.audio !== undefined && patch.audio !== this.state.audio) {
      this.deps.narration.stop();
      this.resumable = false;
    }
    if (patch.preload === false) this.background?.abort();
    this.update(patch);
    return this.state;
  }
  async preload() {
    if (!this.state.open) this.open();
    if (!this.sequence.length)
      throw new StorageError(422, 'Add walkthrough steps before preloading.');
    this.update({ preload: true });
    this.prefetch(true);
    return this.state;
  }
  private prefetch(explicit = false) {
    if (!this.state.preload || (!this.state.audio && !explicit)) return;
    if (this.state.status === 'loading' || this.state.status === 'moving') return;
    this.background?.abort();
    const abort = new AbortController();
    this.background = abort;
    const epoch = this.epoch;
    void (async () => {
      const graph = this.snapshot();
      const voice = await this.deps.voice();
      await this.deps.preloadVoice(voice, abort.signal, this.progress(epoch));
      for (const step of this.steps(graph).slice(this.state.index, this.state.index + 3)) {
        if (abort.signal.aborted) return;
        const text = step.narration;
        if (text?.trim()) await this.clip(text, voice, abort.signal, epoch);
      }
      if (epoch === this.epoch && !abort.signal.aborted)
        this.update({ progress: 1, message: 'Next steps preloaded.' });
    })().catch((error) => {
      if (epoch === this.epoch && !abort.signal.aborted)
        this.update({ message: `Preload failed: ${error.message}`, progress: 0 });
    });
  }
}
