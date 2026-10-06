import type { RefreshRequest } from './refreshClient';
import { parseCsv } from './csv';
import { refreshCsvSource } from './refresh';
import { refreshSqlSchema } from '../sql/refresh';
import { parseSql } from '../sql/parser';
import { arrangeSql } from '../sql/layout';

export async function runRefresh(request: RefreshRequest) {
  if (request.operation === 'parse') return parseCsv(await request.file.text(), request.file.name);
  if (request.operation === 'csv')
    return refreshCsvSource(request.graph, request.incoming, request.options);
  return refreshSqlSchema(
    request.graph,
    await arrangeSql(parseSql(request.text, request.graph.diagram.name)),
    request.removedPolicy,
  );
}
// Importing the fallback in a test/window must not install a window message listener.
if (typeof document === 'undefined' && typeof self !== 'undefined') {
  const context = self as unknown as {
    onmessage: (event: MessageEvent<RefreshRequest>) => void;
    postMessage: (value: unknown) => void;
  };
  context.onmessage = async ({ data }) => {
    try {
      context.postMessage({ result: await runRefresh(data) });
    } catch (error) {
      context.postMessage({ error: (error as Error).message });
    }
  };
}
