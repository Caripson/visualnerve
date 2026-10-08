/** An explicit originating-session capability supplied by the UI or API export boundary. */
export interface ExportGuard {
  readonly signal: AbortSignal;
  check(): Promise<void>;
  assertCurrent(): void;
}
const cancelled = () => new DOMException('Diagram export cancelled.', 'AbortError');
export function assertExportActive(guard?: ExportGuard) {
  if (guard?.signal.aborted) throw cancelled();
  guard?.assertCurrent();
}
export async function checkExportActive(guard?: ExportGuard) {
  assertExportActive(guard);
  await guard?.check();
  assertExportActive(guard);
}
/** Stop waiting immediately on revocation. The underlying task cannot publish its late result. */
export function waitForExport<T>(promise: PromiseLike<T>, guard?: ExportGuard): Promise<T> {
  if (!guard) return Promise.resolve(promise);
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      cleanup();
      reject(cancelled());
    };
    const cleanup = () => guard.signal.removeEventListener('abort', stop);
    guard.signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        try {
          assertExportActive(guard);
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (guard.signal.aborted) stop();
  });
}
