import { decodeVsdx, diagramFileInput } from './input';
import {
  diagramImportLimits,
  type DiagramFileFormat,
  type DiagramFileInput,
  type DiagramImportResult,
} from './types';
const aborted = () => new DOMException('Diagram import was cancelled.', 'AbortError');
interface ImportOptions {
  signal?: AbortSignal;
}

export async function parseDiagramAsync(
  input: DiagramFileInput,
  options: ImportOptions = {},
): Promise<DiagramImportResult> {
  if (options.signal?.aborted) throw aborted();
  diagramFileInput(input);
  const bytes =
    input.format === 'vsdx' ? decodeVsdx(input.data) : new TextEncoder().encode(input.data);
  return parseBytesAsync(
    input.format,
    bytes,
    input.name ?? `Imported ${input.format === 'vsdx' ? 'Visio' : 'draw.io'}`,
    options,
  );
}

export async function parseDiagramFile(
  file: File,
  options: ImportOptions = {},
): Promise<DiagramImportResult> {
  if (options.signal?.aborted) throw aborted();
  if (file.size > diagramImportLimits.fileBytes)
    throw new Error('Diagram file exceeds the 32 MiB limit.');
  const format = /\.vsdx$/i.test(file.name)
    ? 'vsdx'
    : /\.drawio$/i.test(file.name)
      ? 'drawio'
      : undefined;
  if (!format) throw new Error('Choose a .vsdx or .drawio diagram file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseBytesAsync(format, bytes, file.name, options);
}

async function parseBytesAsync(
  format: DiagramFileFormat,
  bytes: Uint8Array,
  name: string,
  { signal }: ImportOptions,
): Promise<DiagramImportResult> {
  if (signal?.aborted) throw aborted();
  if (typeof Worker === 'undefined') {
    const { parseDiagramBytes } = await import('./parser');
    if (signal?.aborted) throw aborted();
    const result = parseDiagramBytes(format, bytes, name);
    if (signal?.aborted) throw aborted();
    return result;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (result?: DiagramImportResult, error?: Error) => {
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
        finish(undefined, new Error('Diagram import exceeded 30 seconds. Choose a smaller file.')),
      30_000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: DiagramImportResult; error?: string }>) => {
      if (event.data.error) finish(undefined, new Error(event.data.error));
      else if (event.data.result) finish(event.data.result);
      else finish(undefined, new Error('Diagram worker returned no preview.'));
    };
    worker.onerror = (event) =>
      finish(undefined, new Error(event.message || 'Diagram worker could not run.'));
    try {
      worker.postMessage({ format, bytes, name }, [bytes.buffer]);
    } catch (error) {
      finish(undefined, error as Error);
    }
  });
}
