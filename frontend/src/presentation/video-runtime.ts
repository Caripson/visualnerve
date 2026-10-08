import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { safeName } from '../export/semantic';
import {
  assertExportActive,
  checkExportActive,
  waitForExport,
  type ExportGuard,
} from '../export/guard';
import { presentationSteps, type PresentationStep } from './sequence';
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_MAX_SECONDS,
  VIDEO_WIDTH,
  videoActive,
  type VideoOptions,
  type VideoState,
} from './video-types';
import { drawVideoCaption, subtitlePages } from './video-subtitles';

export interface VideoScene {
  draw(context: CanvasRenderingContext2D, width: number, height: number): Promise<void> | void;
  prepare?(nodeId: string, nodeIds?: string[]): Promise<void>;
  dispose(): void;
}
export interface VideoEncoder {
  format: 'mp4' | 'webm';
  addFrame(timestamp: number, duration: number): Promise<void>;
  addAudio(blob: Blob, timestamp: number): Promise<number>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}
export interface VideoDependencies {
  graph(): Graph | null;
  voice(): Promise<string>;
  prepare(
    text: string,
    voice: string,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<Blob>;
  scene(signal: AbortSignal): Promise<VideoScene>;
  encoder(canvas: HTMLCanvasElement, audio: boolean, signal: AbortSignal): Promise<VideoEncoder>;
  focus(nodeId: string, transitionMs: number, signal: AbortSignal): Promise<void>;
  prepareStep?(step: PresentationStep, signal: AbortSignal): Promise<void>;
  focusStep?(step: PresentationStep, signal: AbortSignal): Promise<void>;
  stop(): void;
  ready(blob: Blob, name: string): void;
  nextFrame(signal: AbortSignal): Promise<void>;
}
const initial = (): VideoState => ({
  status: 'idle',
  source: 'nodes',
  progress: 0,
  nodeIndex: -1,
  total: 0,
  format: null,
  message: '',
  fileName: null,
});
/** One clip at a time; encoder backpressure bounds frame/audio queues. No graph edits. */
export class VideoExporter {
  private state = initial();
  private listeners = new Set<() => void>();
  private abort?: AbortController;
  private task?: Promise<void>;
  constructor(private deps: VideoDependencies) {}
  getState = () => this.state;
  isBusy = () => videoActive(this.state) || Boolean(this.task);
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(value: Partial<VideoState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  start(options: VideoOptions, guard?: ExportGuard) {
    if (videoActive(this.state) || this.task)
      throw new StorageError(409, 'A video export is already running or being cancelled.');
    assertExportActive(guard);
    const graph = this.deps.graph();
    if (!graph) throw new StorageError(422, 'Open a diagram before exporting video.');
    const source = options.source ?? 'nodes';
    const steps = presentationSteps(graph, source);
    if (!steps.length)
      throw new StorageError(
        422,
        source === 'storyboard'
          ? 'Create storyboard scenes first.'
          : 'Number walkthrough nodes first.',
      );
    if (
      steps.reduce((sum, step) => sum + step.seconds + step.transitionMs / 1000, 0) >
      VIDEO_MAX_SECONDS
    )
      throw new StorageError(
        422,
        'Video export supports up to 30 minutes. Shorten the walkthrough first.',
      );
    this.deps.stop();
    const abort = (this.abort = new AbortController());
    const revoked = () => this.cancel();
    guard?.signal.addEventListener('abort', revoked, { once: true });
    this.set({
      ...initial(),
      status: 'preparing',
      source,
      total: steps.length,
      message: 'Preparing local video export…',
    });
    this.task = this.run(graph, options, abort.signal, guard)
      .catch((error) => {
        if (!abort.signal.aborted) this.set({ status: 'error', message: (error as Error).message });
      })
      .finally(() => {
        guard?.signal.removeEventListener('abort', revoked);
        this.deps.stop();
        this.task = undefined;
        this.abort = undefined;
        this.set({});
      });
    return this.state;
  }
  /** Forget all completed metadata immediately, while retaining the pending cleanup fence. */
  reset() {
    this.cancel();
    this.set(initial());
  }
  cancel(message = 'Video export cancelled.') {
    if (this.abort && !this.abort.signal.aborted) {
      this.abort.abort();
      this.deps.stop();
      this.set({ status: 'cancelled', message });
    }
    return this.state;
  }
  async settled() {
    await this.task;
  }
  private async run(graph: Graph, options: VideoOptions, signal: AbortSignal, guard?: ExportGuard) {
    const check = () => {
      signal.throwIfAborted();
      assertExportActive(guard);
    };
    await checkExportActive(guard);
    check();
    const steps = presentationSteps(graph, options.source ?? 'nodes');
    const nodes = new Set(graph.nodes.map((node) => node.id));
    const canvas = document.createElement('canvas');
    canvas.width = VIDEO_WIDTH;
    canvas.height = VIDEO_HEIGHT;
    const context = canvas.getContext('2d', {
      alpha: false,
      colorSpace: 'srgb',
      willReadFrequently: true,
    });
    if (!context) throw new Error('Video export needs a canvas renderer.');
    let encoder: VideoEncoder | undefined;
    let scene: VideoScene | undefined;
    let finished = false;
    let frame = 0;
    const timestamp = () => frame / VIDEO_FPS;
    try {
      encoder = await this.deps.encoder(canvas, options.audio, signal);
      check();
      this.set({ format: encoder.format });
      scene = await this.deps.scene(signal);
      check();
      const voice = options.audio ? await this.deps.voice() : '';
      const write = async (title: string, number: string, lines: string[], redraw: boolean) => {
        check();
        if (timestamp() + 1 / VIDEO_FPS > VIDEO_MAX_SECONDS)
          throw new Error(
            'The narrated video exceeds 30 minutes. Shorten the descriptions or walkthrough.',
          );
        if (redraw) {
          await scene!.draw(context, VIDEO_WIDTH, VIDEO_HEIGHT);
          check();
          drawVideoCaption(context, VIDEO_WIDTH, VIDEO_HEIGHT, title, number, lines);
        }
        await encoder!.addFrame(timestamp(), 1 / VIDEO_FPS);
        check();
        frame++;
      };
      for (let index = 0; index < steps.length; index++) {
        check();
        const step = steps[index];
        if (step.nodeIds.some((id) => !nodes.has(id)))
          throw new Error('A walkthrough object is missing.');
        const number = `${index + 1} / ${steps.length}`;
        const description = step.narration;
        this.set({
          status: 'preparing',
          nodeIndex: index,
          message: `Preparing ${number}: ${step.name}`,
        });
        const clip =
          options.audio && description.trim()
            ? await this.deps.prepare(description, voice, signal, (message) => {
                if (!signal.aborted) this.set({ message });
              })
            : undefined;
        check();
        await this.deps.prepareStep?.(step, signal);
        check();
        await scene.prepare?.(step.nodeIds[0], step.nodeIds);
        check();
        context.font = '22px system-ui, sans-serif';
        const pages = options.subtitles
          ? subtitlePages(description, (text) => context.measureText(text).width, VIDEO_WIDTH - 80)
          : [];
        this.set({ status: 'exporting', message: `Exporting ${number}: ${step.name}` });
        // Capture the live collision-safe camera flight. Preparation time is never recorded.
        let arrived = false;
        let movementError: unknown;
        const focus = this.deps.focusStep
          ? this.deps.focusStep(step, signal)
          : this.deps.focus(step.nodeIds[0], step.transitionMs, signal);
        const movement = focus.then(
          () => {
            arrived = true;
          },
          (error) => {
            movementError = error;
            arrived = true;
          },
        );
        const started = performance.now();
        const startFrame = frame;
        while (!arrived) {
          await write(step.name, number, [], true);
          const due = startFrame + Math.floor(((performance.now() - started) * VIDEO_FPS) / 1000);
          while (frame < due) await write(step.name, number, [], false);
          await this.deps.nextFrame(signal);
        }
        await movement;
        check();
        if (movementError) throw movementError;
        const duration = clip ? await encoder.addAudio(clip, timestamp()) : 0;
        check();
        const seconds = Math.max(step.seconds, duration, pages.length * 3);
        if (timestamp() + seconds > VIDEO_MAX_SECONDS)
          throw new Error(
            'The narrated video exceeds 30 minutes. Shorten the descriptions or walkthrough.',
          );
        const holdFrames = Math.ceil(seconds * VIDEO_FPS);
        let previousPage = -1;
        for (let hold = 0; hold < holdFrames; hold++) {
          const page = Math.min(pages.length - 1, Math.floor((hold / holdFrames) * pages.length));
          await write(step.name, number, pages[page] ?? [], hold === 0 || page !== previousPage);
          previousPage = page;
          if (hold % 12 === 0) {
            this.set({ progress: (index + hold / holdFrames) / steps.length });
            await this.deps.nextFrame(signal);
          }
        }
      }
      this.set({ message: 'Finishing video file…' });
      const blob = await waitForExport(encoder.finish(), guard);
      check();
      await checkExportActive(guard);
      check();
      const name = `${safeName(graph.diagram.name)}-walkthrough.${encoder.format}`;
      this.deps.ready(blob, name);
      finished = true;
      this.set({
        status: 'complete',
        progress: 1,
        message: 'Video ready. Your browser downloads the file; you can also save it again.',
        fileName: name,
      });
    } finally {
      scene?.dispose();
      if (encoder && !finished) await encoder.cancel().catch(() => undefined);
    }
  }
}
