import { csvGraph, parseCsv, previewCsvRowsSync, profileCsv } from './csv';
import type { CsvDataset } from './types';
import type { CsvWorkerRequest } from './client';
import { assertImportBytes } from '../imports/limits';

let cached: CsvDataset | undefined;
const context = self as unknown as {
  onmessage: (event: MessageEvent<CsvWorkerRequest>) => void;
  postMessage: (value: unknown) => void;
};

context.onmessage = async ({ data }) => {
  try {
    if (data.operation === 'parse') {
      assertImportBytes(data.file!.size, data.byteLimit, 'CSV');
      cached = parseCsv(await data.file!.text(), data.file!.name, data.byteLimit);
      context.postMessage({ id: data.id, result: cached });
      return;
    }
    if (data.dataset) cached = data.dataset;
    if (!cached || `${cached.id}:${cached.version}` !== data.key)
      throw new Error('CSV source cache expired. Reopen the dataset.');
    let result: unknown;
    if (data.operation === 'analyze') {
      const graph = csvGraph(cached, data.analysis!, data.previous);
      result = { ...graph, dataset: undefined };
    } else if (data.operation === 'profile')
      result = profileCsv(cached, data.separator, data.analysis);
    else result = previewCsvRowsSync(cached, data.analysis!, data.path, data.limit);
    context.postMessage({ id: data.id, result });
  } catch (error) {
    context.postMessage({
      id: data.id,
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
};
