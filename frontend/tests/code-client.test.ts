import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCodeAsync } from '../src/code/client';
import { parseCode } from '../src/code/analyzer';
import type { CodeImportResult } from '../src/code/types';

const input = { files: [{ path: 'app.py', content: 'def run():\n pass' }] };
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent<{ result?: CodeImportResult; error?: string }>) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  result(data: { result?: CodeImportResult; error?: string }) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe('Cancellable isolated code workers', () => {
  beforeEach(() => {
    TestWorker.instances = [];
    vi.stubGlobal('Worker', TestWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('terminates each successful preview worker and ignores later messages', async () => {
    const promise = parseCodeAsync(input);
    const worker = TestWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ input });
    const result = parseCode(input);
    worker.result({ result });
    expect(await promise).toEqual(result);
    worker.result({ error: 'late' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects an already aborted preview before allocating a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(parseCodeAsync(input, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(TestWorker.instances).toHaveLength(0);
  });
  it('cancels work and discards a stale graph', async () => {
    const controller = new AbortController();
    const promise = parseCodeAsync(input, { signal: controller.signal });
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    const worker = TestWorker.instances[0];
    controller.abort();
    worker.result({ result: parseCode(input) });
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('bounds preview duration and releases the worker', async () => {
    vi.useFakeTimers();
    const promise = parseCodeAsync(input);
    const rejection = expect(promise).rejects.toThrow(/30 seconds/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('reports worker errors and empty responses without leaving pending promises', async () => {
    const error = parseCodeAsync(input);
    TestWorker.instances[0].result({ error: 'Malformed source' });
    await expect(error).rejects.toThrow('Malformed source');
    const empty = parseCodeAsync(input);
    TestWorker.instances[1].result({});
    await expect(empty).rejects.toThrow(/no diagram/);
    expect(TestWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(
      true,
    );
  });
});
