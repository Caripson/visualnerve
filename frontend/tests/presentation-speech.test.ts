import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechService, type SpeechWorker } from '../src/presentation/speech/service';
import { DEFAULT_VOICE_ID, normalizeVoiceId, VOICES } from '../src/presentation/speech/voices';
import type { SpeechRequest } from '../src/presentation/speech/protocol';

class FakeWorker {
  listeners = new Map<string, Set<EventListener>>();
  postMessage = vi.fn((_value: SpeechRequest) => undefined);
  terminate = vi.fn();
  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }
  receive(value: unknown) {
    this.listeners.get('message')?.forEach((listener) => listener({ data: value } as MessageEvent));
  }
  fail() {
    this.listeners.get('error')?.forEach((listener) => listener(new Event('error')));
  }
  get request() {
    return this.postMessage.mock.calls.at(-1)![0];
  }
}
function setup() {
  const workers: FakeWorker[] = [];
  const service = new SpeechService(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as SpeechWorker;
  });
  return { service, workers };
}
const wav = () => new Blob([new Uint8Array(100)], { type: 'audio/x-wav' });
afterEach(() => vi.useRealTimers());

describe('local neural presentation speech', () => {
  it('defaults to English and validates voice/text before creating a worker', async () => {
    const { service, workers } = setup();
    expect(normalizeVoiceId(undefined)).toBe(DEFAULT_VOICE_ID);
    expect(normalizeVoiceId('not-a-model')).toBe(DEFAULT_VOICE_ID);
    expect(VOICES.some((voice) => voice.language === 'sv-SE')).toBe(true);
    await expect(service.prepare(' ')).rejects.toThrow('description');
    await expect(service.prepare('x'.repeat(12001))).rejects.toThrow('12,000');
    expect(() => service.prepare('valid', 'custom' as typeof DEFAULT_VOICE_ID)).toThrow(
      'supported',
    );
    expect(workers).toHaveLength(0);
  });
  it('returns local WAV and serializes lookahead rather than overlapping neural inference', async () => {
    const { service, workers } = setup();
    const first = service.prepare('Private description');
    const second = service.prepare('Next description');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.request).toMatchObject({
      voiceId: DEFAULT_VOICE_ID,
      text: 'Private description',
      action: 'prepare',
    });
    expect(worker.request.assetBase).toMatch(/speech\/$/);
    const blob = wav();
    worker.receive({ id: worker.request.id, audio: blob, ready: true });
    await expect(first).resolves.toBe(blob);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    worker.receive({ id: worker.request.id, audio: blob, ready: true });
    await expect(second).resolves.toBe(blob);
    service.dispose();
  });
  it('terminates synthesis on abort and ignores late results without cancelling later queued work', async () => {
    const { service, workers } = setup();
    const controller = new AbortController();
    const first = service.prepare('First', DEFAULT_VOICE_ID, controller.signal);
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = service.prepare('Second');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0],
      oldId = worker.request.id;
    controller.abort();
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.receive({ id: oldId, ready: true, audio: wav() });
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1].receive({ id: workers[1].request.id, ready: true, audio: wav() });
    await expect(second).resolves.toBeInstanceOf(Blob);
    service.dispose();
  });
  it('invalidates every stale lookahead task on cancel and can start a fresh generation', async () => {
    const { service, workers } = setup();
    const first = service.prepare('First'),
      second = service.prepare('Next');
    const failures = [
      expect(first).rejects.toMatchObject({ name: 'AbortError' }),
      expect(second).rejects.toMatchObject({ name: 'AbortError' }),
    ];
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    service.cancel();
    await Promise.all(failures);
    expect(workers).toHaveLength(1);
    const fresh = service.preload('sv_SE-nst-medium');
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[1].request).toMatchObject({ action: 'preload', voiceId: 'sv_SE-nst-medium' });
    workers[1].receive({ id: workers[1].request.id, ready: true });
    await expect(fresh).resolves.toBeUndefined();
    service.dispose();
  });
  it('resets the neural session on a voice change and forwards matching progress only', async () => {
    const { service, workers } = setup();
    const first = service.preload();
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0].receive({ id: workers[0].request.id, ready: true });
    await first;
    const progress = vi.fn();
    const next = service.prepare('Hej', 'sv_SE-nst-medium', undefined, progress);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const value = { stage: 'download', loaded: 100, total: 1000, message: 'Downloading' };
    workers[1].receive({ id: -1, progress: value });
    expect(progress).not.toHaveBeenCalled();
    workers[1].receive({ id: workers[1].request.id, progress: value });
    expect(progress).toHaveBeenCalledWith(value);
    workers[1].receive({ id: workers[1].request.id, ready: true, audio: wav() });
    await next;
    service.dispose();
  });
  it('cleans up failures and rejects empty audio instead of claiming narration succeeded', async () => {
    const { service, workers } = setup();
    const first = service.prepare('First');
    const failure = expect(first).rejects.toThrow('could not start');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0].fail();
    await failure;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const next = service.prepare('Next');
    const empty = expect(next).rejects.toThrow('no audio');
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1].receive({ id: workers[1].request.id, ready: true, audio: new Blob() });
    await empty;
    service.dispose();
  });
  it('times out a stopped engine and discards late audio', async () => {
    vi.useFakeTimers();
    const { service, workers } = setup();
    const task = service.prepare('First'),
      failure = expect(task).rejects.toThrow('stopped responding');
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(120000);
    await failure;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    workers[0].receive({ id: workers[0].request.id, ready: true, audio: wav() });
    service.dispose();
  });
});
it('retains the warm idle worker across cancel and reuses it for preload/play', async () => {
  const { service, workers } = setup();
  const preload = service.preload();
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  workers[0].receive({ id: workers[0].request.id, ready: true });
  await preload;
  service.cancel();
  expect(workers[0].terminate).not.toHaveBeenCalled();
  const clip = service.prepare('Narration');
  await vi.waitFor(() => expect(workers[0].postMessage).toHaveBeenCalledTimes(2));
  workers[0].receive({ id: workers[0].request.id, ready: true, audio: wav() });
  await clip;
  expect(workers).toHaveLength(1);
  service.dispose();
});
it('does not abort a foreground consumer when its deduplicated background consumer cancels', async () => {
  const { service, workers } = setup();
  const background = new AbortController(),
    foreground = new AbortController();
  const first = service.prepare(
    'Shared narration',
    DEFAULT_VOICE_ID,
    background.signal,
    undefined,
    { priority: 'background' },
  );
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const progress = vi.fn();
  const next = service.prepare('Shared narration', DEFAULT_VOICE_ID, foreground.signal, progress);
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  background.abort();
  await cancelled;
  expect(workers[0].terminate).not.toHaveBeenCalled();
  expect(workers[0].postMessage).toHaveBeenCalledOnce();
  workers[0].receive({
    id: workers[0].request.id,
    progress: { stage: 'synthesis', loaded: 0, total: 1, message: 'Working' },
  });
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: 'synthesis', loaded: 0, total: 1 }),
  );
  workers[0].receive({ id: workers[0].request.id, ready: true, audio: wav() });
  await next;
  service.dispose();
});
it('removes cancelled queued work immediately and prioritizes foreground over bounded lookahead', async () => {
  const { service, workers } = setup();
  const active = service.prepare('Active');
  const abort = new AbortController();
  const unwanted = service.prepare('Cancel queued', DEFAULT_VOICE_ID, abort.signal);
  const rejection = expect(unwanted).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await rejection;
  const lookahead = service.prepare('Lookahead', DEFAULT_VOICE_ID, undefined, undefined, {
    priority: 'background',
  });
  const foreground = service.prepare('Next click');
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  workers[0].receive({ id: workers[0].request.id, ready: true, audio: wav() });
  await active;
  await vi.waitFor(() => expect(workers[0].request.text).toBe('Next click'));
  workers[0].receive({ id: workers[0].request.id, ready: true, audio: wav() });
  await foreground;
  await vi.waitFor(() => expect(workers[0].request.text).toBe('Lookahead'));
  workers[0].receive({ id: workers[0].request.id, ready: true, audio: wav() });
  await lookahead;
  service.dispose();
});
it('does not let elapsed-only heartbeats conceal a truly stalled initialization', async () => {
  vi.useFakeTimers();
  const { service, workers } = setup();
  const task = service.preload();
  const failure = expect(task).rejects.toThrow('initialization stopped responding');
  await vi.advanceTimersByTimeAsync(1);
  const id = workers[0].request.id;
  workers[0].receive({
    id,
    progress: {
      stage: 'loading',
      operation: 'session',
      loaded: 0,
      total: 0,
      message: 'Initializing',
      elapsedMs: 0,
    },
  });
  for (let step = 1; step <= 11; step++) {
    await vi.advanceTimersByTimeAsync(10000);
    workers[0].receive({
      id,
      progress: {
        stage: 'loading',
        operation: 'session',
        loaded: 0,
        total: 0,
        message: 'Initializing',
        elapsedMs: step * 10000,
      },
    });
  }
  await vi.advanceTimersByTimeAsync(10000);
  await failure;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  service.dispose();
});
