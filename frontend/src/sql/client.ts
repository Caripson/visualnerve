import type { SqlImportResult } from './parser';

export const SQL_FILE_LIMIT = 50 * 1024 * 1024;
const timeoutMs = 30_000;

function aborted() {
  return new DOMException('SQL import was cancelled.', 'AbortError');
}

/** Each preview owns a worker; cancelling it discards the source and pending result. */
export async function parseSqlAsync(
  text: string,
  name: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SqlImportResult> {
  if (signal?.aborted) throw aborted();
  if (text.length > SQL_FILE_LIMIT || new TextEncoder().encode(text).byteLength > SQL_FILE_LIMIT)
    throw new Error('SQL exceeds the 50 MiB file limit.');
  if (typeof Worker === 'undefined') {
    const { parseSql } = await import('./parser');
    const { arrangeSql } = await import('./layout');
    if (signal?.aborted) throw aborted();
    const result = await arrangeSql(parseSql(text, name));
    if (signal?.aborted) throw aborted();
    return result;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (result?: SqlImportResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => finish(undefined, aborted());
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new Error('SQL analysis took longer than 30 seconds. Use a smaller script.'),
        ),
      timeoutMs,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: SqlImportResult; error?: string }>) => {
      if (event.data.error) finish(undefined, new Error(event.data.error));
      else if (event.data.result) finish(event.data.result);
      else
        finish(undefined, new Error('SQL analysis returned no schema. Preview the script again.'));
    };
    worker.onerror = (event) =>
      finish(undefined, new Error(event.message || 'SQL worker could not run.'));
    try {
      worker.postMessage({ text, name });
    } catch (error) {
      finish(undefined, error as Error);
    }
  });
}
