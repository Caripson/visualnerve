import type { AnalysisJobRequest, AnalysisJobValue, AnalysisContext } from './types';
import { AnalyticsClient } from './client';
import { AnalyticsError } from './validation';
import { registerAnalyticsCleanup } from './lifecycle';
export interface AnalysisRunOptions extends AnalysisContext {
  guard?: () => Promise<void>;
}
/** Worker scheduling never persists content or bypasses its caller's session/grant guard. */
export class AnalyticsService {
  private active = 0;
  private generation = 0;
  private clients = new Set<AnalyticsClient>();
  private waiting: {
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    abort: () => void;
  }[] = [];
  constructor() {
    registerAnalyticsCleanup(() => this.dispose());
  }
  private async acquire(signal?: AbortSignal) {
    if (signal?.aborted) throw new AnalyticsError('CANCELLED', 'Analysis was cancelled.');
    if (this.active < 2) {
      this.active++;
      return;
    }
    if (this.waiting.length >= 8)
      throw new AnalyticsError('IMPORT_LIMIT', 'The local analysis queue is full.');
    await new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.waiting = this.waiting.filter((item) => item !== entry);
          reject(new AnalyticsError('CANCELLED', 'Queued analysis was cancelled.'));
        },
      };
      this.waiting.push(entry);
      signal?.addEventListener('abort', entry.abort, { once: true });
    });
  }
  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiting.shift();
    if (next) {
      next.signal?.removeEventListener('abort', next.abort);
      this.active++;
      next.resolve();
    }
  }
  async run(
    request: AnalysisJobRequest,
    options: AnalysisRunOptions = {},
  ): Promise<AnalysisJobValue> {
    const generation = this.generation;
    await options.guard?.();
    await this.acquire(options.signal);
    let client: AnalyticsClient | undefined;
    try {
      if (generation !== this.generation || options.signal?.aborted)
        throw new AnalyticsError('CANCELLED', 'Analysis session changed while waiting.');
      // Let busy/progress controls paint before cloning a bounded private worker request.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (generation !== this.generation || options.signal?.aborted)
        throw new AnalyticsError(
          'CANCELLED',
          'Analysis session changed before worker preparation.',
        );
      await options.guard?.();
      let result: AnalysisJobValue;
      if (typeof Worker === 'undefined') {
        // DOM-free runners use the same engine; browser execution retains workers.
        const { executeAnalysis } = await import('./engine');
        await options.guard?.();
        if (generation !== this.generation || options.signal?.aborted)
          throw new AnalyticsError('CANCELLED', 'Analysis session changed before calculation.');
        result = executeAnalysis(request, options);
      } else {
        client = new AnalyticsClient();
        this.clients.add(client);
        result = await client.run(request, options);
      }
      await options.guard?.();
      if (generation !== this.generation || options.signal?.aborted)
        throw new AnalyticsError('CANCELLED', 'Analysis session changed before publication.');
      return result;
    } finally {
      client?.dispose();
      if (client) this.clients.delete(client);
      this.release();
    }
  }
  dispose() {
    this.generation++;
    for (const client of this.clients) client.dispose();
    this.clients.clear();
    for (const entry of this.waiting) {
      entry.signal?.removeEventListener('abort', entry.abort);
      entry.reject(new AnalyticsError('CANCELLED', 'Analysis session was closed.'));
    }
    this.waiting = [];
  }
}
export const analyticsService = new AnalyticsService();
