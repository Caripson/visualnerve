import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { presentationSteps, type PresentationStep } from './sequence';
import type { PresentationSource } from './storyboard';
import type { PresentationRuntimeState } from './types';
import type { SpeechProgress } from './speech/protocol';
import type { SpeechPriority } from './speech/service';
import { NarrationClipStore } from './speech/clip-store';
type PreparationProgress = (
  value: number,
  message: string,
  stage?: SpeechProgress['stage'],
) => void;

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
  minimizedDefault?(): boolean;
  voice(signal?: AbortSignal): Promise<string>;
  clipStore?(onInvalidated: () => void): NarrationClipStore;
  prepare(
    text: string,
    voice: string,
    signal: AbortSignal,
    progress: PreparationProgress,
    options?: { priority?: SpeechPriority },
  ): Promise<Blob>;
  preloadVoice(voice: string, signal: AbortSignal, progress: PreparationProgress): Promise<void>;
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
  minimized: false,
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
  private fullReady = false;
  private retainAll = false;
  private capacityLimited = false;
  private clipVoice?: string;
  private cleanup: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private deadline = 0;
  private remaining = 0;
  private holdDuration = 0;
  private holdElapsed = 0;
  private holdStartedAt = 0;
  private resumable = false;
  private needsFocus = false;
  private clips: NarrationClipStore;
  private sequence: string[] = [];
  constructor(private deps: PlayerDependencies) {
    this.clips = this.newClipStore();
  }
  private newClipStore() {
    const onInvalidated = () => {
      if (this.clips !== store) return;
      const wasActive = active.has(this.state.status);
      this.cancel();
      this.clearClips();
      this.deps.releaseHighlight?.();
      if (this.state.open)
        this.update({
          status: wasActive ? 'paused' : 'idle',
          buffered: 0,
          progress: 0,
          message: 'Preload cleared. Prepare this tour again.',
        });
    };
    const store = this.deps.clipStore?.(onInvalidated) ?? new NarrationClipStore({ onInvalidated });
    return store;
  }
  private clearClips() {
    const previous = this.clips;
    const cleaning = previous.dispose();
    this.clips = this.newClipStore();
    this.clipVoice = undefined;
    this.fullReady = false;
    this.retainAll = false;
    this.capacityLimited = false;
    this.cleanup = Promise.all([this.cleanup, cleaning]).then(() => undefined);
  }
  /** Lock/transfer/cache boundaries await old encrypted clip puts and deletion. */
  async settled() {
    await this.cleanup;
    await this.clips.settled();
  }
  private preloadMessage() {
    return this.state.preload && !!(this.background || this.fullReady || this.capacityLimited);
  }
  private selectVoice(voice: string, background?: AbortController) {
    if (this.clipVoice !== undefined && this.clipVoice !== voice) {
      if (this.background && this.background !== background) {
        this.background.abort();
        this.background = undefined;
      }
      this.clearClips();
      this.update({ buffered: 0, progress: 0, message: '' });
    }
    this.clipVoice = voice;
  }
  getState = () => this.state;
  /** Caption position follows the same hold clock as playback and freezes on Pause. */
  getPlaybackTime = () => {
    const elapsed =
      this.holdElapsed +
      (this.state.status === 'playing' ? Math.max(0, Date.now() - this.holdStartedAt) : 0);
    return {
      durationMs: this.holdDuration,
      elapsedMs: Math.min(this.holdDuration, elapsed),
    };
  };
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
    this.clearClips();
    this.deps.releaseHighlight?.();
    this.update({ source });
    const steps = this.steps(graph);
    this.sequence = steps.map((step) => step.id);
    this.update({
      open: true,
      minimized: this.deps.minimizedDefault?.() ?? false,
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
    this.clearClips();
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
    this.clearClips();
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
  private cancel(background = true) {
    ++this.epoch;
    this.abort?.abort();
    if (background) {
      this.background?.abort();
      this.background = undefined;
      if (!this.fullReady) this.retainAll = false;
    }
    this.abort = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.deps.narration.stop();
    this.deps.cancelCamera();
    this.resumable = false;
    this.needsFocus = false;
    this.remaining = 0;
    this.holdDuration = 0;
    this.holdElapsed = 0;
    this.holdStartedAt = 0;
  }
  pause(message = '', refocus = false) {
    if (!this.state.open) return this.state;
    if (this.state.status === 'paused') {
      this.needsFocus ||= refocus;
      if (message) this.update({ message });
      return this.state;
    }
    if (this.state.status === 'playing') {
      this.holdElapsed += Math.max(0, Date.now() - this.holdStartedAt);
      this.remaining = Math.max(0, this.deadline - Date.now());
      clearTimeout(this.timer);
      this.timer = undefined;
      this.deps.narration.pause();
      this.resumable = true;
      this.needsFocus = refocus;
      this.deps.cancelCamera();
    } else this.cancel(false);
    this.update({ status: 'paused', ...(message || !this.preloadMessage() ? { message } : {}) });
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
        this.holdStartedAt = Date.now();
        this.schedule(this.remaining);
        this.update({ status: 'playing', ...(this.preloadMessage() ? {} : { message: '' }) });
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
      if (epoch === this.epoch && !this.background)
        this.update({ progress: Math.max(0, Math.min(1, progress)), message });
    };
  }
  private key(voice: string, text: string) {
    return `${voice}\0${text}`;
  }
  private async clip(
    text: string,
    voice: string,
    signal: AbortSignal,
    epoch: number,
    progress: PreparationProgress = this.progress(epoch),
    priority: SpeechPriority = 'foreground',
    current?: () => void,
  ) {
    signal.throwIfAborted();
    current?.();
    this.selectVoice(voice, priority === 'background' ? this.background : undefined);
    const store = this.clips;
    const check = () => {
      signal.throwIfAborted();
      current?.();
      if (store !== this.clips) throw new DOMException('Cancelled', 'AbortError');
    };
    await this.cleanup;
    check();
    const key = this.key(voice, text);
    let blob = await store.get(key, signal);
    check();
    if (!blob) {
      blob = await this.deps.prepare(text, voice, signal, progress, { priority });
      check();
      await store.put(key, blob, signal, this.retainAll);
      check();
    }
    this.update({ buffered: this.clips.size });
    return blob;
  }
  private async step(continuePlaying: boolean) {
    this.cancel(false);
    const epoch = this.epoch;
    const abort = new AbortController();
    this.abort = abort;
    try {
      const graph = this.snapshot();
      const step = this.steps(graph)[this.state.index];
      const existing = new Set(graph.nodes.map((node) => node.id));
      if (!step || step.nodeIds.some((id) => !existing.has(id)))
        throw new StorageError(409, 'This presentation object no longer exists.');
      this.update({
        ...this.fields(step),
        status: 'loading',
        ...(this.preloadMessage() ? {} : { progress: 0, message: '' }),
      });
      let blob: Blob | undefined;
      if (continuePlaying && this.state.audio && step.narration.trim())
        blob = await this.clip(
          step.narration,
          await this.deps.voice(abort.signal),
          abort.signal,
          epoch,
        );
      if (epoch !== this.epoch) return;
      this.update({
        status: 'moving',
        ...(this.preloadMessage() ? {} : { progress: 0, message: '' }),
      });
      await this.focus(step, abort.signal);
      if (epoch !== this.epoch) return;
      if (!continuePlaying) {
        this.update({ status: 'paused' });
        return;
      }
      const seconds = blob ? await this.deps.narration.play(blob, abort.signal) : 0;
      if (epoch !== this.epoch) return;
      this.holdDuration = Math.max(step.seconds, seconds) * 1000;
      this.holdStartedAt = Date.now();
      this.schedule(this.holdDuration);
      this.update({
        status: 'playing',
        ...(this.preloadMessage() ? {} : { progress: 1, message: '' }),
      });
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
        const extra = audioRemaining * 1000 + 25;
        // Keep the final caption while the device finishes; never move cues backwards.
        this.schedule(extra);
        return;
      }
      if (this.state.index + 1 >= this.sequence.length) {
        const duration = this.holdDuration;
        this.cancel();
        this.holdDuration = duration;
        this.holdElapsed = duration;
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
          !['audio', 'subtitles', 'preload', 'minimized'].includes(key) ||
          typeof option !== 'boolean',
      )
    )
      throw new StorageError(
        422,
        'Player options must be audio, subtitles, preload or minimized booleans.',
      );
    const patch = value as Partial<
      Pick<PresentationRuntimeState, 'audio' | 'subtitles' | 'preload' | 'minimized'>
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
    if (patch.preload === false) {
      this.background?.abort();
      this.background = undefined;
      this.fullReady = false;
      this.retainAll = false;
      this.capacityLimited = false;
      this.update({ progress: 0, message: '' });
    }
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
    // A full-tour preparation survives cursor changes; foreground requests can
    // join the same serial inference. It always includes earlier and later steps.
    if (this.background || (!explicit && (this.fullReady || this.capacityLimited))) return;
    const graph = this.snapshot();
    const steps = this.steps(graph);
    const abort = new AbortController();
    this.background = abort;
    this.capacityLimited = false;
    let completed = 0,
      total = steps.length,
      previous = 0;
    const active = () =>
      this.background === abort &&
      !abort.signal.aborted &&
      this.state.open &&
      this.deps.graph() === graph;
    const check = () => {
      if (!active()) throw new DOMException('Cancelled', 'AbortError');
    };
    const report = (detail: string, fraction = 0) => {
      if (!active()) return;
      previous = Math.max(previous, Math.min(0.99, (completed + fraction) / total));
      this.update({
        progress: previous,
        message: `Preload ${Math.floor(previous * 100)}% · ${completed}/${total} steps ready · ${detail}`,
      });
    };
    report('Preparing the entire presentation…');
    void (async () => {
      check();
      await this.cleanup;
      check();
      const voice = await this.deps.voice(abort.signal);
      check();
      this.selectVoice(voice, abort);
      this.retainAll = true;
      this.fullReady = false;
      if (
        steps.some((step) => step.narration.trim()) &&
        !steps.every(
          (step) => !step.narration.trim() || this.clips.has(this.key(voice, step.narration)),
        )
      ) {
        await this.deps.preloadVoice(voice, abort.signal, (_value, message) => report(message));
        check();
        report('Voice engine ready.');
      }
      for (const step of steps) {
        check();
        if (step.narration.trim())
          await this.clip(
            step.narration,
            voice,
            abort.signal,
            this.epoch,
            (value, message, stage) =>
              report(message, stage === 'synthesis' ? Math.min(0.99, value) : 0),
            'background',
            check,
          );
        check();
        completed++;
        report(step.narration.trim() ? 'Narration ready.' : 'No narration needed.');
      }
      if (active()) {
        this.fullReady = true;
        this.update({ progress: 1, message: `Preload 100% · ${total}/${total} steps ready.` });
      }
    })()
      .catch((error) => {
        if (active()) {
          this.fullReady = false;
          this.retainAll = false;
          this.capacityLimited = /limit|storage|quota|space/i.test(error.message);
          this.update({ message: `Preload failed: ${error.message}`, progress: previous });
        }
      })
      .finally(() => {
        if (this.background !== abort) return;
        this.background = undefined;
        if (this.deps.graph() !== graph) {
          this.clearClips();
          this.update({
            progress: 0,
            buffered: 0,
            message: 'Diagram changed. Prepare this tour again.',
          });
        }
      });
  }
}
