import type { Graph } from '../model/types';
import { StorageError, validateGraph } from '../model/validation';
import { parseSqlAsync, SQL_FILE_LIMIT } from '../sql/client';
import type { CodeInput } from '../code/types';
import { codeLanguageIds, codeLimits } from '../code/types';

export interface AnalysisCommandOptions {
  signal?: AbortSignal;
  /** Recheck external grants after analysis and before its first write. */
  beforeAnalysisSave?: () => Promise<void>;
}
const payloadObject = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StorageError(422, 'Provide an analysis input object.');
  return value as Record<string, unknown>;
};
const nonempty = (value: unknown, limit: number) =>
  typeof value === 'string' && !!value.trim() && value.length <= limit;

function codeInput(payload: unknown): CodeInput {
  const data = payloadObject(payload);
  if (
    Object.keys(data).some((key) => !['name', 'files', 'mode', 'focus'].includes(key)) ||
    (data.name !== undefined && !nonempty(data.name, 500)) ||
    (data.focus !== undefined && !nonempty(data.focus, 500)) ||
    (data.mode !== undefined &&
      (typeof data.mode !== 'string' || !['files', 'symbols'].includes(data.mode))) ||
    !Array.isArray(data.files) ||
    !data.files.length ||
    data.files.length > codeLimits.files
  )
    throw new StorageError(422, 'Provide code files, an optional name, mode and nonempty focus.');
  for (const value of data.files) {
    const file = payloadObject(value);
    if (
      Object.keys(file).some((key) => !['path', 'content', 'language'].includes(key)) ||
      !nonempty(file.path, 500) ||
      typeof file.content !== 'string' ||
      (file.language !== undefined &&
        !codeLanguageIds.includes(file.language as (typeof codeLanguageIds)[number]))
    )
      throw new StorageError(
        422,
        'Each code file needs a relative path, content and optional supported language id.',
      );
  }
  return data as unknown as CodeInput;
}

/** Import routes stay separate from general entity CRUD and share one guarded save boundary. */
export async function analysisCommand(
  endpoint: string,
  method: string,
  payload: unknown,
  options: AnalysisCommandOptions,
  save: (graph: Graph) => Promise<Graph>,
): Promise<unknown> {
  if (endpoint === '/code/languages') {
    if (method !== 'GET') throw new StorageError(405, 'Language discovery requires GET.');
    const { codeLanguages } = await import('../code/catalog');
    return structuredClone(codeLanguages);
  }
  if (!['/sql/preview', '/sql/diagrams', '/code/preview', '/code/diagrams'].includes(endpoint))
    throw new StorageError(404, 'Unknown analysis endpoint.');
  if (method !== 'POST') throw new StorageError(405, 'Analysis requires POST.');
  const result = endpoint.startsWith('/sql/')
    ? await (async () => {
        const data = payloadObject(payload);
        if (
          Object.keys(data).some((key) => !['sql', 'name'].includes(key)) ||
          typeof data.sql !== 'string' ||
          !data.sql.trim() ||
          (data.name !== undefined && !nonempty(data.name, 500))
        )
          throw new StorageError(422, 'Provide a SQL script and an optional nonempty name.');
        if (
          data.sql.length > SQL_FILE_LIMIT ||
          new TextEncoder().encode(data.sql).byteLength > SQL_FILE_LIMIT
        )
          throw new StorageError(422, 'SQL exceeds the 50 MiB file limit.');
        return parseSqlAsync(data.sql, String(data.name ?? 'Imported SQL'), {
          signal: options.signal,
        });
      })()
    : await (async () => {
        const input = codeInput(payload);
        const { parseCodeAsync } = await import('../code/client');
        return parseCodeAsync(input, { signal: options.signal });
      })();
  validateGraph(result.graph);
  if (endpoint.endsWith('/preview')) return result;
  await options.beforeAnalysisSave?.();
  if (options.signal?.aborted) throw new DOMException('Analysis was cancelled.', 'AbortError');
  return save(result.graph);
}
