import type { QualityRequest } from './qualityClient';
import { explainMeasure, qualityEvidence, qualityReport, inspectionDataset } from './quality';
import type { CsvDataset } from './types';
import type { ReferenceCheck } from './quality';
const sources = new Map<string, CsvDataset>();
type Message = Omit<QualityRequest, 'dataset' | 'options'> & {
  id: number;
  key: string;
  sources: CsvDataset[];
  modelSourceKeys?: string[];
  options: {
    keyColumns?: string[];
    references?: (Omit<ReferenceCheck, 'target'> & { targetKey: string })[];
  };
};
const context = self as unknown as {
  onmessage(event: MessageEvent<Message>): void;
  postMessage(value: unknown): void;
};
context.onmessage = ({ data }) => {
  try {
    data.sources.forEach((source) => sources.set(`${source.id}:${source.version}`, source));
    const source = sources.get(data.key);
    if (!source)
      throw new Error('The inspected source is no longer available. Reopen data inspection.');
    const references = data.options.references?.map(({ targetKey, ...entry }) => {
      const target = sources.get(targetKey);
      if (!target) throw new Error('A reference source is unavailable. Reopen data inspection.');
      return { ...entry, target };
    });
    const modelSources = data.modelSourceKeys?.map((key) => sources.get(key)!);
    const model =
      data.model && modelSources
        ? { ...data.model, dataset: modelSources[0], datasets: modelSources.slice(1) }
        : undefined;
    const dataset = model ? inspectionDataset(model, source) : source;
    const options = { ...data.options, references };
    const result =
      data.operation === 'report'
        ? qualityReport(dataset, data.analysis, options)
        : data.operation === 'evidence'
          ? qualityEvidence(dataset, data.analysis, options, data.issueId!, data.offset)
          : explainMeasure(
              dataset,
              data.analysis,
              data.path ?? [],
              data.metricId!,
              data.offset,
              data.disposition,
            );
    context.postMessage({ id: data.id, result });
  } catch (error) {
    context.postMessage({ id: data.id, error: (error as Error).message });
  }
};
