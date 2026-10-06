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
type WorkerFactory = () => SpeechWorker;
type Progress = (value: SpeechProgress) => void;
function cancelled() {
  return new DOMException('Speech preparation cancelled.', 'AbortError');
}

/** Serial neural inference with no persistent narration and a worker that can be interrupted. */
export class SpeechService {
  private worker?: SpeechWorker;
  private voice?: VoiceId;
  private sequence = 0;
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private rejectActive?: (error: Error) => void;
  constructor(
    private createWorker: WorkerFactory = () =>
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  prepare(
    text: string,
    voiceId: string = DEFAULT_VOICE_ID,
    signal?: AbortSignal,
    progress?: Progress,
  ): Promise<Blob> {
    assertVoiceId(voiceId);
    if (!text.trim()) return Promise.reject(new Error('Add a description to narrate this object.'));
    if (text.length > MAX_NARRATION_CHARACTERS)
      return Promise.reject(new Error('Narration is limited to 12,000 characters per object.'));
    return this.enqueue('prepare', voiceId, text, signal, progress).then((audio) => {
      if (!(audio instanceof Blob) || audio.size <= 44)
        throw new Error('The voice engine returned no audio.');
      return audio;
    });
  }
  preload(
    voiceId: string = DEFAULT_VOICE_ID,
    signal?: AbortSignal,
    progress?: Progress,
  ): Promise<void> {
    assertVoiceId(voiceId);
    return this.enqueue('preload', voiceId, undefined, signal, progress).then(() => undefined);
  }
  private enqueue(
    action: SpeechRequest['action'],
    voiceId: VoiceId,
    text?: string,
    signal?: AbortSignal,
    progress?: Progress,
  ): Promise<Blob | undefined> {
    const generation = this.generation;
    const task = this.tail
      .catch(() => undefined)
      .then(() => {
        if (signal?.aborted || generation !== this.generation) throw cancelled();
        return this.run(action, voiceId, text, signal, progress);
      });
    this.tail = task;
    return task;
  }
  private run(
    action: SpeechRequest['action'],
    voiceId: VoiceId,
    text?: string,
    signal?: AbortSignal,
    progress?: Progress,
  ): Promise<Blob | undefined> {
    if (this.voice !== voiceId) this.stopWorker();
    const worker = (this.worker ??= this.createWorker());
    this.voice = voiceId;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const clean = () => {
        clearTimeout(timeout);
        worker.removeEventListener('message', message as EventListener);
        worker.removeEventListener('error', failure as EventListener);
        signal?.removeEventListener('abort', abort);
        this.rejectActive = undefined;
      };
      const fail = (error: Error) => {
        clean();
        this.stopWorker();
        reject(error);
      };
      const armTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(
          () =>
            fail(
              new Error(
                'The voice engine stopped responding. Try a shorter description or reload.',
              ),
            ),
          120000,
        );
      };
      const message = (event: MessageEvent<SpeechResponse>) => {
        const value = event.data;
        if (value.id !== id) return;
        if ('progress' in value) {
          armTimeout();
          progress?.(value.progress);
        } else if ('error' in value) fail(new Error(value.error));
        else if (value.ready === true) {
          clean();
          resolve(value.audio);
        } else fail(new Error('The voice engine returned an invalid response.'));
      };
      const failure = () =>
        fail(
          new Error('The local voice engine could not start. Please reload or try another voice.'),
        );
      const abort = () => fail(cancelled());
      this.rejectActive = fail;
      worker.addEventListener('message', message as EventListener);
      worker.addEventListener('error', failure as EventListener);
      signal?.addEventListener('abort', abort, { once: true });
      armTimeout();
      const assetBase = new URL(`${import.meta.env.BASE_URL}speech/`, location.origin).href;
      try {
        worker.postMessage({ id, action, voiceId, text, assetBase } satisfies SpeechRequest);
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
    this.generation++;
    this.rejectActive?.(cancelled());
    this.stopWorker();
  }
  dispose() {
    this.cancel();
  }
  cachedVoices() {
    return cachedVoices();
  }
  async clearCache() {
    this.cancel();
    await clearVoiceCache();
  }
}

export const speechService = new SpeechService();
