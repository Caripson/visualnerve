import type { CodeImportResult, CodeInput } from './types';
import { normalizeCodeInput } from './input';
import { checkedImportLimitBytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';
const aborted = () => new DOMException('Code analysis was cancelled.', 'AbortError');

/** A dedicated worker owns each source buffer and is terminated after preview or cancellation. */
export async function parseCodeAsync(
  input: CodeInput,
  {
    signal,
    byteLimit = currentImportLimitBytes(),
  }: { signal?: AbortSignal; byteLimit?: number } = {},
): Promise<CodeImportResult> {
  if (signal?.aborted) throw aborted();
  const limit = checkedImportLimitBytes(byteLimit);
  normalizeCodeInput(input, limit);
  if (typeof Worker === 'undefined') {
    const { parseCode } = await import('./analyzer');
    const { arrangeCode } = await import('./layout');
    if (signal?.aborted) throw aborted();
    const result = await arrangeCode(parseCode(input, limit));
    if (signal?.aborted) throw aborted();
    return result;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (result?: CodeImportResult, error?: Error) => {
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
          new Error('Code analysis exceeded 30 seconds. Import fewer files or use file overview.'),
        ),
      30_000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: CodeImportResult; error?: string }>) => {
      if (event.data.error) finish(undefined, new Error(event.data.error));
      else if (event.data.result) finish(event.data.result);
      else finish(undefined, new Error('Code worker returned no diagram. Preview again.'));
    };
    worker.onerror = (event) =>
      finish(undefined, new Error(event.message || 'Code worker could not run.'));
    try {
      worker.postMessage({ input, byteLimit: limit });
    } catch (error) {
      finish(undefined, error as Error);
    }
  });
}
