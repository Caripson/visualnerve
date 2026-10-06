/// <reference lib="webworker" />
import type { CsvDataset } from './types';
import type { DataModelWorkerRequest } from './modelClient';
import {
  previewCsvRelationship,
  reanalyzeDataModel,
  setAnalysisForDataset,
  modelDatasetForAnalysis,
} from './model';
import { previewCsvRowsSync } from './csv';
const sources = new Map<string, CsvDataset>();
self.onmessage = (event: MessageEvent<DataModelWorkerRequest>) => {
  const { id, operation, graph, relationship } = event.data;
  try {
    const datasets = event.data.sources.map((source) => {
      if (source.dataset) sources.set(source.key, source.dataset);
      const dataset = sources.get(source.key);
      if (!dataset) throw new Error('Source cache expired. Reopen the data sources dialog.');
      return dataset;
    });
    const retained = new Set(event.data.sources.map((source) => source.key));
    for (const key of sources.keys()) if (!retained.has(key)) sources.delete(key);
    const complete = { ...graph, dataset: datasets[0], datasets: datasets.slice(1) };
    const result =
      operation === 'rows'
        ? previewCsvRowsSync(
            modelDatasetForAnalysis(
              setAnalysisForDataset(complete, event.data.datasetId!, event.data.analysis!),
              event.data.datasetId!,
            ),
            event.data.analysis!,
            event.data.path,
            event.data.limit,
          )
        : operation === 'preview'
          ? previewCsvRelationship(complete, relationship!)
          : reanalyzeDataModel(complete);
    if (operation === 'analyze') {
      const { dataset: _primary, datasets: _additional, ...light } = result as typeof complete;
      self.postMessage({ id, result: light });
    } else self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
