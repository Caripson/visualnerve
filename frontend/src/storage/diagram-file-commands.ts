import type { Graph } from '../model/types';
import { StorageError } from '../model/validation';
import type { AnalysisCommandOptions } from './analysis-commands';
import { diagramFileInput } from '../imports/diagram/input';

export async function diagramFileCommand(
  payload: unknown,
  importing: boolean,
  options: AnalysisCommandOptions,
  save: (graph: Graph) => Promise<Graph>,
): Promise<unknown> {
  const input = diagramFileInput(payload, importing);
  const { parseDiagramAsync } = await import('../imports/diagram/client');
  let result;
  try {
    result = await parseDiagramAsync(
      { format: input.format, data: input.data, name: input.name },
      { signal: options.signal },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw error instanceof StorageError ? error : new StorageError(422, (error as Error).message);
  }
  if (!importing) return result;
  const page =
    input.pageId === undefined && result.pages.length === 1
      ? result.pages[0]
      : result.pages.find((page) => page.id === input.pageId);
  if (!page)
    throw new StorageError(
      422,
      input.pageId === undefined
        ? 'This file has multiple pages. Preview it with /diagram-files/preview and import a pageId.'
        : 'Unknown diagram pageId. Preview the file to choose a page.',
    );
  await options.beforeAnalysisSave?.();
  if (options.signal?.aborted)
    throw new DOMException('Diagram import was cancelled.', 'AbortError');
  return save(page.graph);
}
