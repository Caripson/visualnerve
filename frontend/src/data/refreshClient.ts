import type { Graph } from '../model/types';
import type { CsvDataset } from './types';
import type { CsvRefreshOptions, RemovedSourcePolicy, SourceRefreshResult } from './refresh';
import { graphDatasets } from './model';
import { assertImportBytes, checkedImportLimitBytes, utf8Bytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';

export type RefreshRequest =
  | { operation: 'parse'; file: File; byteLimit?: number }
  | { operation: 'csv'; graph: Graph; incoming: CsvDataset; options: CsvRefreshOptions }
  | {
      operation: 'sql';
      graph: Graph;
      text: string;
      removedPolicy: RemovedSourcePolicy;
      byteLimit?: number;
    };

function aborted() {
  return new DOMException('Source refresh was cancelled.', 'AbortError');
}
async function request<T>(payload: RefreshRequest, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw aborted();
  if (typeof Worker === 'undefined') {
    const { runRefresh } = await import('./refreshWorker');
    const result = await runRefresh(payload);
    if (signal?.aborted) throw aborted();
    return result as T;
  }
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('./refreshWorker.ts', import.meta.url), { type: 'module' });
    let done = false;
    const finish = (value?: T, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const cancel = () => finish(undefined, aborted());
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new Error(
            'Source refresh took longer than 30 seconds. Use a smaller source or simpler cleanup rules.',
          ),
        ),
      30_000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) =>
      event.data.error
        ? finish(undefined, new Error(event.data.error))
        : event.data.result
          ? finish(event.data.result)
          : finish(undefined, new Error('Source refresh returned no result.'));
    worker.onerror = (event) =>
      finish(undefined, new Error(event.message || 'Source refresh worker could not load.'));
    try {
      worker.postMessage(payload);
    } catch (error) {
      finish(undefined, error as Error);
    }
  });
}
function restoreUnchangedSources(graph: Graph, result: SourceRefreshResult): SourceRefreshResult {
  const original = new Map(graphDatasets(graph).map((source) => [source.id, source]));
  const restore = (source: CsvDataset) => {
    const old = original.get(source.id);
    return old && old.version === source.version && old.updatedAt === source.updatedAt
      ? old
      : source;
  };
  return {
    ...result,
    graph: {
      ...result.graph,
      dataset: result.graph.dataset && restore(result.graph.dataset),
      datasets: result.graph.datasets?.map(restore),
    },
  };
}
export async function loadRefreshCsv(
  file: File,
  {
    signal,
    byteLimit = currentImportLimitBytes(),
  }: { signal?: AbortSignal; byteLimit?: number } = {},
) {
  const limit = checkedImportLimitBytes(byteLimit);
  assertImportBytes(file.size, limit, 'CSV');
  return request<CsvDataset>({ operation: 'parse', file, byteLimit: limit }, signal);
}
export async function previewCsvRefresh(
  graph: Graph,
  incoming: CsvDataset,
  options: CsvRefreshOptions,
  { signal }: { signal?: AbortSignal } = {},
) {
  return restoreUnchangedSources(
    graph,
    await request<SourceRefreshResult>({ operation: 'csv', graph, incoming, options }, signal),
  );
}
export async function previewSqlRefresh(
  graph: Graph,
  text: string,
  removedPolicy: RemovedSourcePolicy,
  {
    signal,
    byteLimit = currentImportLimitBytes(),
  }: { signal?: AbortSignal; byteLimit?: number } = {},
) {
  const limit = checkedImportLimitBytes(byteLimit);
  assertImportBytes(text.length, limit, 'SQL');
  assertImportBytes(utf8Bytes(text), limit, 'SQL');
  return restoreUnchangedSources(
    graph,
    await request<SourceRefreshResult>(
      { operation: 'sql', graph, text, removedPolicy, byteLimit: limit },
      signal,
    ),
  );
}
