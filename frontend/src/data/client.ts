import type { Graph } from '../model/types';
import type { CsvAnalysis, CsvDataset, CsvPathEntry } from './types';
import { csvGraph, parseCsv, previewCsvRowsSync, profileCsv, type CsvColumnProfile } from './csv';
import { previewDataModelRowsAsync } from './modelClient';

export interface CsvWorkerRequest {
  id: number;
  operation: 'parse' | 'analyze' | 'profile' | 'preview';
  dataset?: CsvDataset;
  key?: string;
  file?: File;
  analysis?: CsvAnalysis;
  previous?: Graph;
  separator?: '.' | ',';
  path?: CsvPathEntry[];
  limit?: number;
}

interface Pending {
  operation: CsvWorkerRequest['operation'];
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | undefined;
let cachedKey: string | undefined;
let serial = 0;
let analysisRevision = 0;
const pending = new Map<number, Pending>();
const datasetKey = (dataset: CsvDataset) => `${dataset.id}:${dataset.version}`;

function stopWorker(error: Error) {
  worker?.terminate();
  worker = undefined;
  cachedKey = undefined;
  for (const task of pending.values()) {
    clearTimeout(task.timer);
    task.reject(error);
  }
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      result?: unknown;
      error?: { name: string; message: string };
    }>,
  ) => {
    const task = pending.get(event.data.id);
    if (!task) return;
    pending.delete(event.data.id);
    clearTimeout(task.timer);
    if (event.data.error) {
      const error = new Error(event.data.error.message);
      error.name = event.data.error.name;
      task.reject(error);
    } else task.resolve(event.data.result);
  };
  worker.onerror = (event) => stopWorker(new Error(event.message || 'CSV worker could not run.'));
  return worker;
}

function request<T>(message: Omit<CsvWorkerRequest, 'id'>): Promise<T> {
  const active = getWorker();
  const id = ++serial;
  const source = message.dataset;
  const key = source ? datasetKey(source) : undefined;
  const payload = {
    ...message,
    id,
    key,
    ...(key && key === cachedKey ? { dataset: undefined } : {}),
  };
  if (key) cachedKey = key;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        stopWorker(
          new Error(
            'CSV processing took longer than 10 seconds. Simplify cleaning patterns or use a smaller file.',
          ),
        ),
      10000,
    );
    pending.set(id, {
      operation: message.operation,
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    try {
      active.postMessage(payload);
    } catch (error) {
      stopWorker(error as Error);
    }
  });
}

async function sourceRequest<T>(
  message: Omit<CsvWorkerRequest, 'id'>,
  current?: () => boolean,
): Promise<T> {
  try {
    return await request<T>(message);
  } catch (error) {
    // File.text() can finish after another dataset's analysis. The worker checks
    // source identity before doing any work; refresh the source on that race.
    if ((error as Error).message !== 'CSV source cache expired. Reopen the dataset.') throw error;
    if (current && !current()) {
      const stale = new Error('A newer CSV analysis replaced this request.');
      stale.name = 'AbortError';
      throw stale;
    }
    cachedKey = undefined;
    return request<T>(message);
  }
}

export async function openCsvFile(file: File): Promise<CsvDataset> {
  if (file.size > 50 * 1024 * 1024) throw new Error('CSV exceeds the 50 MiB file limit.');
  if (typeof Worker === 'undefined') return parseCsv(await file.text(), file.name);
  const dataset = await request<CsvDataset>({ operation: 'parse', file });
  cachedKey = datasetKey(dataset);
  return dataset;
}

export async function analyzeCsv(
  dataset: CsvDataset,
  analysis: CsvAnalysis,
  previous?: Graph,
): Promise<Graph> {
  const revision = ++analysisRevision;
  if (typeof Worker === 'undefined') return csvGraph(dataset, analysis, previous);
  for (const [id, task] of pending)
    if (task.operation === 'analyze') {
      clearTimeout(task.timer);
      const error = new Error('A newer CSV analysis replaced this request.');
      error.name = 'AbortError';
      task.reject(error);
      pending.delete(id);
    }
  const smallPrevious = previous ? { ...previous, dataset: undefined } : undefined;
  const result = await sourceRequest<Graph>(
    {
      operation: 'analyze',
      dataset,
      analysis,
      previous: smallPrevious,
    },
    () => revision === analysisRevision,
  );
  return { ...result, dataset };
}

export async function profileCsvAsync(
  dataset: CsvDataset,
  separator: '.' | ',',
  analysis?: CsvAnalysis,
): Promise<CsvColumnProfile[]> {
  if (typeof Worker === 'undefined') return profileCsv(dataset, separator, analysis);
  return sourceRequest({ operation: 'profile', dataset, separator, analysis });
}

export async function previewCsvRows(
  dataset: CsvDataset,
  analysis: CsvAnalysis,
  path: CsvPathEntry[] = [],
  limit = 100,
  model?: Graph,
): Promise<{ rows: string[][]; originalRows: string[][]; total: number }> {
  if (model) return previewDataModelRowsAsync(model, dataset.id, analysis, path, limit);
  if (typeof Worker === 'undefined') return previewCsvRowsSync(dataset, analysis, path, limit);
  return sourceRequest({ operation: 'preview', dataset, analysis, path, limit });
}
