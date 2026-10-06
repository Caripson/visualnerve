import { cachedVoices, clearVoiceCache } from './model-cache';
import {
  MAX_NARRATION_CHARACTERS,
  type SpeechProgress,
  type SpeechRequest,
  type SpeechResponse,
} from './protocol';
import { assertVoiceId, DEFAULT_VOICE_ID, type VoiceId } from './voices';
export type { SpeechProgress } from './protocol';

export type SpeechWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'
>;
type Progress = (value: SpeechProgress) => void;
type WorkerFactory = () => SpeechWorker;
export type SpeechPriority = 'foreground' | 'background';
type Subscriber = {
  resolve(value: Blob | undefined): void;
  reject(error: Error): void;
  progress?: Progress;
  signal?: AbortSignal;
  abort(): void;
};
type Job = {
  key: string;
  action: SpeechRequest['action'];
  voiceId: VoiceId;
  text?: string;
  priority: SpeechPriority;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  progress?: SpeechProgress;
};
const cancelled = () => new DOMException('Speech preparation cancelled.', 'AbortError');

/** One warm voice/session, one inference and separately cancellable subscribers. */
export class SpeechService {
  private worker?: SpeechWorker;
  private voice?: VoiceId;
  private sequence = 0;
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  private running?: Job;
  constructor(
    private createWorker: WorkerFactory = () =>
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  prepare(
    text: string,
    voiceId: string = DEFAULT_VOICE_ID,
    signal?: AbortSignal,
    progress?: Progress,
    options?: { priority?: SpeechPriority },
  ): Promise<Blob> {
    assertVoiceId(voiceId);
    if (!text.trim()) return Promise.reject(new Error('Add a description to narrate this object.'));
    if (text.length > MAX_NARRATION_CHARACTERS)
      return Promise.reject(new Error('Narration is limited to 12,000 characters per object.'));
    return this.enqueue(
      'prepare',
      voiceId,
      text,
      signal,
      progress,
      options?.priority ?? 'foreground',
    ).then((audio) => audio as Blob);
  }
  preload(
    voiceId: string = DEFAULT_VOICE_ID,
    signal?: AbortSignal,
    progress?: Progress,
  ): Promise<void> {
    assertVoiceId(voiceId);
    return this.enqueue('preload', voiceId, undefined, signal, progress, 'background').then(
      () => undefined,
    );
  }
  private enqueue(
    action: SpeechRequest['action'],
    voiceId: VoiceId,
    text: string | undefined,
    signal: AbortSignal | undefined,
    progress: Progress | undefined,
    priority: SpeechPriority,
  ): Promise<Blob | undefined> {
    if (signal?.aborted) return Promise.reject(cancelled());
    const key = JSON.stringify([voiceId, action, text]);
    let job = this.jobs.get(key);
    if (!job) {
      job = {
        key,
        action,
        voiceId,
        text,
        priority,
        controller: new AbortController(),
        subscribers: new Set(),
      };
      this.jobs.set(key, job);
      this.queue.push(job);
    } else if (priority === 'foreground') job.priority = priority;
    const target = job;
    const task = new Promise<Blob | undefined>((resolve, reject) => {
      const subscriber: Subscriber = {
        resolve,
        reject,
        progress,
        signal,
        abort: () => {
          if (!target.subscribers.delete(subscriber)) return;
          signal?.removeEventListener('abort', subscriber.abort);
          reject(cancelled());
          if (!target.subscribers.size) {
            this.jobs.delete(target.key);
            this.queue = this.queue.filter((value) => value !== target);
            target.controller.abort();
          }
        },
      };
      target.subscribers.add(subscriber);
      signal?.addEventListener('abort', subscriber.abort, { once: true });
      if (target.progress) progress?.(target.progress);
      else if (this.running)
        progress?.({
          stage: 'loading',
          loaded: 0,
          total: 0,
          message: 'Waiting for the current narration…',
        });
      if (signal?.aborted) subscriber.abort();
    });
    this.pump();
    return task;
  }
  private pump() {
    if (this.running) return;
    const index = this.queue.findIndex((job) => job.priority === 'foreground');
    const job = this.queue.splice(index < 0 ? 0 : index, 1)[0];
    if (!job) return;
    if (!job.subscribers.size || job.controller.signal.aborted) {
      this.pump();
      return;
    }
    this.running = job;
    void Promise.resolve()
      .then(() => this.run(job))
      .then(
        (audio) => this.finish(job, undefined, audio),
        (error) => this.finish(job, error instanceof Error ? error : new Error(String(error))),
      );
  }
  private finish(job: Job, error?: Error, audio?: Blob) {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const subscriber of job.subscribers) {
      subscriber.signal?.removeEventListener('abort', subscriber.abort);
      error ? subscriber.reject(error) : subscriber.resolve(audio);
    }
    job.subscribers.clear();
    job.text = undefined;
    if (this.running === job) this.running = undefined;
    this.pump();
  }
  private run(job: Job): Promise<Blob | undefined> {
    if (job.controller.signal.aborted) return Promise.reject(cancelled());
    if (this.voice !== job.voiceId) this.stopWorker();
    const worker = (this.worker ??= this.createWorker());
    this.voice = job.voiceId;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      let settled = false;
      let previous: SpeechProgress | undefined;
      const clean = () => {
        clearTimeout(timeout);
        worker.removeEventListener('message', message as EventListener);
        worker.removeEventListener('error', failure as EventListener);
        job.controller.signal.removeEventListener('abort', abort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clean();
        this.stopWorker();
        reject(error);
      };
      const armTimeout = (stage?: SpeechProgress['stage']) => {
        clearTimeout(timeout);
        timeout = setTimeout(
          () =>
            fail(
              new Error(
                stage === 'download'
                  ? 'The voice download stopped receiving data. Check the connection and retry.'
                  : stage === 'loading'
                    ? 'The local voice initialization stopped responding. Reload and retry.'
                    : stage === 'synthesis'
                      ? 'The narration chunk stopped responding. Try a shorter description or reload.'
                      : 'The local voice worker stopped responding. Reload and retry.',
              ),
            ),
          120000,
        );
      };
      const message = (event: MessageEvent<SpeechResponse>) => {
        const value = event.data;
        if (settled || value.id !== id) return;
        if ('progress' in value) {
          const next = value.progress;
          // Elapsed-time status is not evidence of completed work.
          if (
            !previous ||
            next.stage !== previous.stage ||
            next.operation !== previous.operation ||
            next.loaded > previous.loaded
          )
            armTimeout(next.stage);
          previous = next;
          job.progress = next;
          for (const subscriber of job.subscribers) subscriber.progress?.(next);
        } else if ('error' in value) fail(new Error(value.error));
        else if (value.ready === true) {
          if (
            job.action === 'prepare' &&
            (!(value.audio instanceof Blob) || value.audio.size <= 44)
          ) {
            fail(new Error('The voice engine returned no audio.'));
            return;
          }
          settled = true;
          clean();
          resolve(value.audio);
        } else fail(new Error('The voice engine returned an invalid response.'));
      };
      const failure = () =>
        fail(
          new Error('The local voice engine could not start. Please reload or try another voice.'),
        );
      const abort = () => fail(cancelled());
      worker.addEventListener('message', message as EventListener);
      worker.addEventListener('error', failure as EventListener);
      job.controller.signal.addEventListener('abort', abort, { once: true });
      armTimeout();
      if (job.controller.signal.aborted) {
        abort();
        return;
      }
      const assetBase = new URL(import.meta.env.BASE_URL + 'speech/', location.origin).href;
      try {
        worker.postMessage({
          id,
          action: job.action,
          voiceId: job.voiceId,
          text: job.text,
          assetBase,
        } satisfies SpeechRequest);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Could not start the voice engine.'));
      }
    });
  }
  private stopWorker() {
    this.worker?.terminate();
    this.worker = undefined;
    this.voice = undefined;
  }
  cancel() {
    for (const job of this.queue.splice(0)) this.finishCancelled(job);
    if (this.running) {
      this.finishCancelled(this.running);
      this.running.controller.abort();
    }
    // Keep the local runtime/model warm; the player bounds its generated clip cache.
  }
  private finishCancelled(job: Job) {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const subscriber of job.subscribers) {
      subscriber.signal?.removeEventListener('abort', subscriber.abort);
      subscriber.reject(cancelled());
    }
    job.subscribers.clear();
    job.text = undefined;
  }
  dispose() {
    this.cancel();
    this.stopWorker();
  }
  cachedVoices() {
    return cachedVoices();
  }
  async clearCache() {
    this.dispose();
    await clearVoiceCache();
  }
}
export const speechService = new SpeechService();
