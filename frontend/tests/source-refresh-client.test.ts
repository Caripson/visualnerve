import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRefreshCsv, previewCsvRefresh } from '../src/data/refreshClient';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { emptyRefreshSummary, defaultColumnMap } from '../src/data/refresh';

class RefreshWorker {
  static workers: RefreshWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    RefreshWorker.workers.push(this);
  }
  complete(result: unknown) {
    this.onmessage?.({ data: { result } } as MessageEvent);
  }
}
beforeEach(() => {
  RefreshWorker.workers = [];
  vi.stubGlobal('Worker', RefreshWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('terminates the parsing worker on cancellation and rejects oversized files before creating one', async () => {
  const controller = new AbortController();
  const pending = loadRefreshCsv(new File(['ID\n1'], 'source.csv'), { signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejection;
  expect(RefreshWorker.workers[0].terminate).toHaveBeenCalledOnce();
  const oversized = new File(['x'], 'large.csv');
  Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
  await expect(loadRefreshCsv(oversized)).rejects.toThrow(/50 MB/);
  expect(RefreshWorker.workers).toHaveLength(1);
});

it('reattaches unchanged source references after structured cloning but keeps the replacement source', async () => {
  const old = parseCsv('ID,Name\n1,Ada', 'customers.csv');
  const graph = csvGraph(old, defaultAnalysis(old));
  const extra = { ...parseCsv('ID,Amount\n1,20', 'orders.csv'), diagramId: graph.diagram.id };
  graph.datasets = [extra];
  const incoming = parseCsv('ID,Name\n1,Adelaide', 'next.csv');
  const pending = previewCsvRefresh(graph, incoming, {
    datasetId: old.id,
    keyColumnIds: ['c0'],
    columnMap: defaultColumnMap(old, incoming),
    removedPolicy: 'retain',
  });
  const replacement = { ...old, version: old.version + 1, rows: incoming.rows };
  const result = {
    graph: { ...graph, dataset: replacement, datasets: [JSON.parse(JSON.stringify(extra))] },
    sourceId: old.id,
    summary: emptyRefreshSummary(),
  };
  RefreshWorker.workers[0].complete(result);
  const completed = await pending;
  expect(completed.graph.datasets?.[0]).toBe(extra);
  expect(completed.graph.dataset).toBe(replacement);
  expect(RefreshWorker.workers[0].terminate).toHaveBeenCalledOnce();
});

it('rejects and terminates a worker that fails to load or exceeds its watchdog', async () => {
  const failure = loadRefreshCsv(new File(['ID\n1'], 'source.csv'));
  RefreshWorker.workers[0].onerror?.({ message: 'Worker chunk unavailable' } as ErrorEvent);
  await expect(failure).rejects.toThrow('Worker chunk unavailable');
  vi.useFakeTimers();
  const pending = loadRefreshCsv(new File(['ID\n1'], 'source.csv'));
  const rejection = expect(pending).rejects.toThrow(/30 seconds/);
  await vi.advanceTimersByTimeAsync(30000);
  await rejection;
  expect(RefreshWorker.workers[1].terminate).toHaveBeenCalledOnce();
});
