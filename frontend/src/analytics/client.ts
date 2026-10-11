import type {
  AnalysisJobRequest,
  AnalysisJobValue,
  AnalysisContext,
  AnalyticsCode,
  AnalysisIssue,
} from './types';
import { AnalyticsError } from './validation';
import { registerAnalyticsCleanup } from './lifecycle';
import { compactAnalysisModel } from './signal-history';
const clients = new Set<AnalyticsClient>();
registerAnalyticsCleanup(() => {
  for (const client of [...clients]) client.dispose();
});
export class AnalyticsClient {
  private active = new Map<Worker, { reject: (error: Error) => void; dispose: () => void }>();
  private closed = false;
  constructor() {
    clients.add(this);
  }
  run(
    request: AnalysisJobRequest,
    context: Pick<AnalysisContext, 'signal' | 'progress' | 'now' | 'cutoff'> = {},
  ): Promise<AnalysisJobValue> {
    if (this.closed || context.signal?.aborted)
      return Promise.reject(new AnalyticsError('CANCELLED', 'Analysis session was closed.'));
    if (this.active.size >= 2)
      return Promise.reject(
        new AnalyticsError('IMPORT_LIMIT', 'At most two analysis workers may run simultaneously.'),
      );
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const dispose = () => {
        context.signal?.removeEventListener('abort', abort);
        worker.terminate();
        this.active.delete(worker);
      };
      const abort = () => {
        dispose();
        reject(new AnalyticsError('CANCELLED', 'Analysis was cancelled.'));
      };
      this.active.set(worker, { reject, dispose });
      context.signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (
        event: MessageEvent<{
          kind: string;
          value: AnalysisJobValue;
          completed: number;
          total: number;
          code: AnalyticsCode;
          message: string;
          issues?: AnalysisIssue[];
        }>,
      ) => {
        if (context.signal?.aborted || this.closed) {
          abort();
          return;
        }
        if (event.data.kind === 'progress') {
          context.progress?.(event.data.completed, event.data.total);
          return;
        }
        dispose();
        if (event.data.kind === 'result') resolve(event.data.value);
        else
          reject(
            new AnalyticsError(event.data.code, event.data.message, undefined, event.data.issues),
          );
      };
      worker.onerror = () => {
        dispose();
        reject(new AnalyticsError('INVALID_ANALYTICS', 'The local analysis worker failed.'));
      };
      try {
        worker.postMessage({
          request:
            'model' in request &&
            !['validate', 'archive', 'reconcile', 'commit-import'].includes(request.kind)
              ? { ...request, model: compactAnalysisModel(request.model) }
              : request,
          now: context.now?.() ?? new Date().toISOString(),
          cutoff: context.cutoff,
        });
      } catch (error) {
        dispose();
        reject(error);
      }
    });
  }
  dispose() {
    this.closed = true;
    for (const task of this.active.values()) {
      task.dispose();
      task.reject(new AnalyticsError('CANCELLED', 'Analysis session was closed.'));
    }
    this.active.clear();
    clients.delete(this);
  }
}
