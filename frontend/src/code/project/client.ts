import { assertImportBytes, checkedImportLimitBytes } from '../../imports/limits';
import { currentImportLimitBytes } from '../../imports/preference';
import { validateProjectArchiveInput } from './input';
import {
  projectArchiveLimits,
  type ProjectArchiveInput,
  type ProjectArchiveOptions,
  type ProjectArchiveProgress,
  type ProjectArchiveResult,
} from './types';

const aborted = () => new DOMException('Project loading was cancelled.', 'AbortError');
type ArchiveRequest = { bytes: Uint8Array; name: string } | { input: ProjectArchiveInput };

export async function parseProjectArchiveAsync(
  input: ProjectArchiveInput,
  options: ProjectArchiveOptions = {},
): Promise<ProjectArchiveResult> {
  if (options.signal?.aborted) throw aborted();
  const byteLimit = checkedImportLimitBytes(options.byteLimit ?? currentImportLimitBytes());
  validateProjectArchiveInput(input, byteLimit);
  return runArchiveWorker({ input }, { ...options, byteLimit });
}

export async function readProjectArchive(
  file: File,
  options: ProjectArchiveOptions = {},
): Promise<ProjectArchiveResult> {
  if (options.signal?.aborted) throw aborted();
  const byteLimit = checkedImportLimitBytes(options.byteLimit ?? currentImportLimitBytes());
  if (!/\.zip$/i.test(file.name)) throw new Error('Choose a .zip source or Markdown project.');
  assertImportBytes(file.size, byteLimit, 'Project ZIP');
  const bytes = new Uint8Array(await readFile(file, options.signal));
  assertImportBytes(bytes.length, byteLimit, 'Project ZIP');
  if (options.signal?.aborted) throw aborted();
  return runArchiveWorker(
    { bytes, name: file.name.replace(/\.zip$/i, '') || 'Imported project' },
    { ...options, byteLimit },
  );
}

function readFile(file: File, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: ArrayBuffer, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(value!);
    };
    const cancel = () => finish(undefined, aborted());
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) return cancel();
    try {
      void file.arrayBuffer().then(
        (value) => finish(value),
        (error) => finish(undefined, error),
      );
    } catch (error) {
      finish(undefined, error);
    }
  });
}

async function runArchiveWorker(
  request: ArchiveRequest,
  options: ProjectArchiveOptions,
): Promise<ProjectArchiveResult> {
  const { signal, byteLimit, onProgress } = options;
  if (signal?.aborted) throw aborted();
  if (typeof Worker === 'undefined') {
    const { loadProjectArchive } = await import('./archive');
    const { decodeProjectArchive } = await import('./input');
    if (signal?.aborted) throw aborted();
    const bytes =
      'bytes' in request ? request.bytes : decodeProjectArchive(request.input, byteLimit);
    return loadProjectArchive(
      bytes,
      'bytes' in request ? request.name : request.input.name?.trim() || 'Imported project',
      options,
    );
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const finish = (result?: ProjectArchiveResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      error ? reject(error) : resolve(result!);
    };
    const cancel = () => finish(undefined, aborted());
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new Error('Project loading exceeded two minutes. Choose a smaller archive.'),
        ),
      projectArchiveLimits.timeoutMs,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (
      event: MessageEvent<{
        result?: ProjectArchiveResult;
        error?: string;
        progress?: ProjectArchiveProgress;
      }>,
    ) => {
      if (settled) return;
      if (event.data.progress) {
        try {
          onProgress?.(event.data.progress);
        } catch (error) {
          finish(
            undefined,
            error instanceof Error ? error : new Error('Project progress handler failed.'),
          );
        }
      } else if (event.data.error) finish(undefined, new Error(event.data.error));
      else if (event.data.result) finish(event.data.result);
      else finish(undefined, new Error('Project archive worker returned no files.'));
    };
    worker.onerror = (event) =>
      finish(undefined, new Error(event.message || 'Project archive worker could not run.'));
    if (signal?.aborted) return cancel();
    try {
      worker.postMessage(
        { ...request, byteLimit },
        'bytes' in request ? [request.bytes.buffer] : [],
      );
    } catch (error) {
      finish(undefined, error as Error);
    }
  });
}
