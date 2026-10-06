import type { CsvAnalysis, CsvDataset, CsvPathEntry } from './types';
import type { Graph } from '../model/types';
import { graphDatasets } from './model';
import {
  explainMeasure,
  qualityEvidence,
  qualityReport,
  inspectionDataset,
  type EvidencePage,
  type MeasureExplanation,
  type QualityOptions,
  type QualityReport,
} from './quality';

export interface QualityRequest {
  operation: 'report' | 'evidence' | 'measure';
  dataset: CsvDataset;
  model?: Graph;
  analysis: CsvAnalysis;
  options?: QualityOptions;
  path?: CsvPathEntry[];
  metricId?: string;
  issueId?: string;
  offset?: number;
  disposition?: 'all' | 'included' | 'excluded';
}
export function runQuality(
  request: QualityRequest,
): QualityReport | EvidencePage | MeasureExplanation {
  const dataset = request.model
    ? inspectionDataset(request.model, request.dataset)
    : request.dataset;
  if (request.operation === 'report')
    return qualityReport(dataset, request.analysis, request.options);
  if (request.operation === 'evidence')
    return qualityEvidence(
      dataset,
      request.analysis,
      request.options ?? {},
      request.issueId!,
      request.offset,
    );
  return explainMeasure(
    dataset,
    request.analysis,
    request.path ?? [],
    request.metricId!,
    request.offset,
    request.disposition,
  );
}

/** A dialog owns its worker. Cancellation also stops pathological cleanup regexes. */
export class QualityClient {
  private worker?: Worker;
  private serial = 0;
  private sent = new Set<string>();
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  dispose(error: Error = new DOMException('Data inspection was cancelled.', 'AbortError')) {
    this.worker?.terminate();
    this.worker = undefined;
    this.sent.clear();
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.pending.clear();
  }
  async request<T extends QualityReport | EvidencePage | MeasureExplanation>(
    request: QualityRequest,
  ): Promise<T> {
    if (typeof Worker === 'undefined') return runQuality(request) as T;
    if (!this.worker) {
      this.worker = new Worker(new URL('./qualityWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({
        data,
      }: MessageEvent<{ id: number; result?: T; error?: string }>) => {
        const task = this.pending.get(data.id);
        if (!task) return;
        this.pending.delete(data.id);
        clearTimeout(task.timer);
        if (data.error) task.reject(new Error(data.error));
        else task.resolve(data.result);
      };
      this.worker.onerror = (event) =>
        this.dispose(new Error(event.message || 'Data inspection worker failed.'));
    }
    const sources = [
      request.dataset,
      ...(request.model ? graphDatasets(request.model) : []),
      ...(request.options?.references?.map((entry) => entry.target) ?? []),
    ];
    const newSources = [
      ...new Map(sources.map((source) => [`${source.id}:${source.version}`, source])).values(),
    ].filter((source) => !this.sent.has(`${source.id}:${source.version}`));
    const id = ++this.serial;
    const references = request.options?.references?.map(({ target, ...entry }) => ({
      ...entry,
      targetKey: `${target.id}:${target.version}`,
    }));
    const payload = {
      ...request,
      id,
      dataset: undefined,
      model: request.model
        ? {
            ...request.model,
            dataset: undefined,
            datasets: undefined,
            nodes: [],
            edges: [],
            owners: [],
          }
        : undefined,
      modelSourceKeys: request.model
        ? graphDatasets(request.model).map((source) => `${source.id}:${source.version}`)
        : undefined,
      key: `${request.dataset.id}:${request.dataset.version}`,
      sources: newSources,
      options: { ...request.options, references },
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.dispose(
            new Error(
              'Data inspection exceeded 30 seconds. Simplify cleanup rules or reduce the source.',
            ),
          ),
        30000,
      );
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        this.worker!.postMessage(payload);
        for (const source of newSources) this.sent.add(`${source.id}:${source.version}`);
      } catch (error) {
        this.dispose(error as Error);
      }
    });
  }
}
