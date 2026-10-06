import type { Graph } from '../model/types';
import {
  graphDatasets,
  previewCsvRelationship,
  reanalyzeDataModel,
  modelDatasetForAnalysis,
  setAnalysisForDataset,
  type CsvRelationshipPreview,
  type CsvSourceRelationship,
} from './model';
import type { CsvDataset, CsvAnalysis, CsvPathEntry } from './types';
import { previewCsvRowsSync } from './csv';
export interface DataModelWorkerRequest {
  id: number;
  operation: 'analyze' | 'preview' | 'rows';
  graph: Graph;
  sources: { key: string; dataset?: CsvDataset }[];
  relationship?: CsvSourceRelationship;
  datasetId?: string;
  analysis?: CsvAnalysis;
  path?: CsvPathEntry[];
  limit?: number;
}
let worker: Worker | undefined;
let serial = 0;
const keys = new WeakMap<CsvDataset, string>();
const cached = new Set<string>();
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    cleanup: () => void;
  }
>();
function stop(error: Error) {
  worker?.terminate();
  worker = undefined;
  cached.clear();
  for (const task of pending.values()) {
    clearTimeout(task.timer);
    task.cleanup();
    task.reject(error);
  }
  pending.clear();
}
function activeWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./modelWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const task = pending.get(event.data.id);
    if (!task) return;
    pending.delete(event.data.id);
    clearTimeout(task.timer);
    task.cleanup();
    if (event.data.error) task.reject(new Error(event.data.error));
    else task.resolve(event.data.result);
  };
  worker.onerror = (event) =>
    stop(new Error(event.message || 'Data source processing could not run.'));
  return worker;
}
async function request<T>(
  graph: Graph,
  operation: DataModelWorkerRequest['operation'],
  relationship?: CsvSourceRelationship,
  signal?: AbortSignal,
  details: Pick<DataModelWorkerRequest, 'datasetId' | 'analysis' | 'path' | 'limit'> = {},
): Promise<T> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const id = ++serial,
    active = activeWorker();
  const sources = graphDatasets(graph).map((dataset) => {
    let key = keys.get(dataset);
    if (!key) {
      key = `${dataset.id}:${dataset.version}:${++serial}`;
      keys.set(dataset, key);
    }
    const result = { key, ...(!cached.has(key) ? { dataset } : {}) };
    cached.add(key);
    return result;
  });
  const keep = new Set(sources.map((source) => source.key));
  for (const key of cached) if (!keep.has(key)) cached.delete(key);
  const { dataset: _primary, datasets: _additional, ...light } = graph;
  const queryGraph: Graph =
    operation === 'analyze'
      ? light
      : {
          ...light,
          nodes: [],
          edges: [],
          owners: [],
          diagram: {
            ...light.diagram,
            metadata: {},
            settings: {
              csvAnalysis: light.diagram.settings.csvAnalysis,
              csvSourceAnalyses: light.diagram.settings.csvSourceAnalyses,
              csvRelationships: light.diagram.settings.csvRelationships,
              csvEntityFocus: light.diagram.settings.csvEntityFocus,
              csvDatasetOrder: light.diagram.settings.csvDatasetOrder,
            },
          },
        };
  return new Promise<T>((resolve, reject) => {
    const abort = () => stop(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(
      () =>
        stop(
          new Error(
            'Data source processing exceeded 20 seconds. Narrow the filters or simplify cleaning rules.',
          ),
        ),
      20000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
      cleanup: () => signal?.removeEventListener('abort', abort),
    });
    try {
      active.postMessage({
        id,
        operation,
        graph: queryGraph,
        sources,
        relationship,
        ...details,
      } satisfies DataModelWorkerRequest);
    } catch (error) {
      stop(error as Error);
    }
  });
}
export async function reanalyzeDataModelAsync(
  graph: Graph,
  options: { signal?: AbortSignal } = {},
): Promise<Graph> {
  if (typeof Worker === 'undefined') {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return reanalyzeDataModel(graph);
  }
  const result = await request<Graph>(graph, 'analyze', undefined, options.signal);
  return { ...result, dataset: graph.dataset, datasets: graph.datasets };
}
export async function previewCsvRelationshipAsync(
  graph: Graph,
  relationship: CsvSourceRelationship,
  options: { signal?: AbortSignal } = {},
): Promise<CsvRelationshipPreview> {
  if (typeof Worker === 'undefined') {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return previewCsvRelationship(graph, relationship);
  }
  return request(graph, 'preview', relationship, options.signal);
}
export async function previewDataModelRowsAsync(
  graph: Graph,
  datasetId: string,
  analysis: CsvAnalysis,
  path: CsvPathEntry[] = [],
  limit = 100,
  options: { signal?: AbortSignal } = {},
): Promise<{ rows: string[][]; originalRows: string[][]; total: number }> {
  if (typeof Worker === 'undefined') {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const next = setAnalysisForDataset(graph, datasetId, analysis);
    return previewCsvRowsSync(modelDatasetForAnalysis(next, datasetId), analysis, path, limit);
  }
  return request(graph, 'rows', undefined, options.signal, { datasetId, analysis, path, limit });
}
