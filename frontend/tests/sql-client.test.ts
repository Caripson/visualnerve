import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseSqlAsync } from '../src/sql/client';
import { blankGraph } from '../src/model/types';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}
beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const result = () => ({
  graph: blankGraph('Schema'),
  warnings: [],
  tableCount: 1,
  columnCount: 1,
  relationshipCount: 0,
  ignoredStatementCount: 0,
});

it('isolates each preview and releases its worker after a complete schema result', async () => {
  const first = parseSqlAsync('CREATE TABLE first (id INT);', 'First');
  const second = parseSqlAsync('CREATE TABLE second (id INT);', 'Second');
  const [a, b] = TestWorker.instances;
  expect(a.postMessage).toHaveBeenCalledWith({
    text: 'CREATE TABLE first (id INT);',
    name: 'First',
  });
  expect(b.postMessage).toHaveBeenCalledWith({
    text: 'CREATE TABLE second (id INT);',
    name: 'Second',
  });
  const expected = result();
  a.onmessage!({ data: { result: expected } } as MessageEvent);
  await expect(first).resolves.toEqual(expected);
  expect(a.terminate).toHaveBeenCalledTimes(1);
  expect(b.terminate).not.toHaveBeenCalled();
  b.onmessage!({ data: { result: expected } } as MessageEvent);
  await second;
  expect(b.terminate).toHaveBeenCalledTimes(1);
});

it('cancels a pending worker and ignores results delivered after cancellation', async () => {
  const controller = new AbortController();
  const pending = parseSqlAsync('CREATE TABLE cancelled (id INT);', 'Cancelled', {
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const worker = TestWorker.instances[0];
  controller.abort();
  await rejection;
  worker.onmessage!({ data: { result: result() } } as MessageEvent);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  await expect(
    parseSqlAsync('unused', 'Unused', { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.instances).toHaveLength(1);
});

it('reports parser errors and worker failures without leaking a running worker', async () => {
  const parser = parseSqlAsync('CREATE TABLE broken (', 'Broken');
  TestWorker.instances[0].onmessage!({
    data: { error: 'Unclosed table definition.' },
  } as MessageEvent);
  await expect(parser).rejects.toThrow('Unclosed table definition.');
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  const workerError = parseSqlAsync('CREATE TABLE test (id INT);', 'Test');
  TestWorker.instances[1].onerror!({ message: 'Worker unavailable' } as ErrorEvent);
  await expect(workerError).rejects.toThrow('Worker unavailable');
  expect(TestWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
});

it('terminates timed-out analysis and rejects an empty worker response', async () => {
  vi.useFakeTimers();
  const pending = parseSqlAsync('CREATE TABLE slow (id INT);', 'Slow');
  const rejected = expect(pending).rejects.toThrow('longer than 30 seconds');
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  const empty = parseSqlAsync('CREATE TABLE empty (id INT);', 'Empty');
  TestWorker.instances[1].onmessage!({ data: {} } as MessageEvent);
  await expect(empty).rejects.toThrow('returned no schema');
  expect(TestWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
});
