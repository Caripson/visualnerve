import { StorageError } from '../model/errors';
import type { ExportGuard } from '../export/guard';
import type { AnalysisJobValue, AnalyticsExtension } from '../analytics/types';
import type { PublicAnalysisJobRequest } from './analytics-api-input';
import { registerAnalyticsCleanup } from '../analytics/lifecycle';
import { compactAnalysisModel } from '../analytics/signal-history';

export interface AnalyticsJobAuthority {
  guard: ExportGuard;
  dispose(): void;
}
export interface AnalyticsJobState {
  jobId: string;
  diagramId: string;
  kind: PublicAnalysisJobRequest['kind'];
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  error?: { code: string; message: string };
}
interface Entry {
  status: AnalyticsJobState;
  request?: PublicAnalysisJobRequest;
  model?: AnalyticsExtension;
  modelVersion: number;
  bytes: number;
  value?: AnalysisJobValue;
  authority: AnalyticsJobAuthority;
  controller: AbortController;
  abort: () => void;
  expiry: ReturnType<typeof setTimeout>;
}
export const analyticsJobLimits = {
  active: 2,
  retained: 4,
  retainedBytes: 32 * 1024 * 1024,
  retentionMs: 15 * 60 * 1000,
  deadlineMs: 120000,
  resultPage: 1000,
} as const;

/** Transient jobs retain their original vault/grant authority beyond the POST response. */
export class AnalyticsApiJobs {
  private entries = new Map<string, Entry>();
  constructor(
    private execute: (
      request: PublicAnalysisJobRequest,
      options: {
        signal: AbortSignal;
        progress: (completed: number, total: number) => void;
        guard: () => Promise<void>;
      },
    ) => Promise<AnalysisJobValue> = async (request, options) => {
      const { analyticsService } = await import('../analytics/service');
      return analyticsService.run(request, options);
    },
    private now = () => new Date().toISOString(),
  ) {}
  async start(
    diagramId: string,
    request: PublicAnalysisJobRequest,
    authority: AnalyticsJobAuthority,
    origin: { model: AnalyticsExtension; modelVersion: number },
  ) {
    await authority.guard.check();
    if (
      [...this.entries.values()].filter((entry) => entry.status.state === 'running').length >=
      analyticsJobLimits.active
    ) {
      authority.dispose();
      throw Object.assign(new StorageError(429, 'Two analytics jobs are already running.'), {
        code: 'ANALYTICS_JOB_BUSY',
      });
    }
    const controller = new AbortController();
    const jobId = crypto.randomUUID();
    const status: AnalyticsJobState = {
      jobId,
      diagramId,
      kind: request.kind,
      state: 'running',
      progress: 0,
      createdAt: this.now(),
    };
    const abort = () => this.erase(jobId);
    const cloned = structuredClone(request);
    const numeric =
      'model' in cloned ? cloned.model : structuredClone(compactAnalysisModel(origin.model));
    const linked = new Set(origin.model.scenarios.map((scenario) => scenario.sourceSignalId));
    const original = {
      ...numeric,
      scenarios: structuredClone(origin.model.scenarios),
      signals: structuredClone(origin.model.signals.filter((signal) => linked.has(signal.id))),
    };
    const entry: Entry = {
      status,
      request: cloned,
      model: original,
      modelVersion: origin.modelVersion,
      bytes: 0,
      authority,
      controller,
      abort,
      expiry: setTimeout(abort, analyticsJobLimits.retentionMs),
    };
    this.entries.set(jobId, entry);
    authority.guard.signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => controller.abort(), analyticsJobLimits.deadlineMs);
    const guard = async () => {
      controller.signal.throwIfAborted();
      await authority.guard.check();
      controller.signal.throwIfAborted();
    };
    void (async () => {
      try {
        const value = await this.execute(entry.request!, {
          signal: controller.signal,
          progress: (completed, total) => {
            if (total > 0 && Number.isFinite(completed / total))
              entry.status.progress = Math.min(
                99,
                Math.max(0, Math.floor((completed / total) * 100)),
              );
          },
          guard,
        });
        await guard();
        if (!this.entries.has(jobId)) return;
        const { model: duplicateModel, ...configuration } = entry.request! as {
          model?: AnalyticsExtension;
          [key: string]: unknown;
        };
        entry.bytes = new TextEncoder().encode(
          JSON.stringify({ request: configuration, model: entry.model, value }),
        ).length;
        if (entry.bytes > analyticsJobLimits.retainedBytes)
          throw Object.assign(
            new StorageError(
              413,
              'The completed analytics job exceeds its 32 MiB retained-input/result budget. Reduce the interval or rule batch.',
            ),
            { code: 'ANALYTICS_RESULT_LIMIT' },
          );
        entry.value = value;
        entry.status.state = 'succeeded';
        entry.status.progress = 100;
        this.trim();
      } catch (error) {
        if (!this.entries.has(jobId)) return;
        entry.request = undefined;
        entry.model = undefined;
        entry.value = undefined;
        entry.bytes = 0;
        if (controller.signal.aborted) entry.status.state = 'cancelled';
        else {
          entry.status.state = 'failed';
          const details = error as { code?: string; message?: string };
          entry.status.error = {
            code: details.code ?? 'ANALYTICS_FAILED',
            message: details.message ?? 'Analytics failed.',
          };
        }
        this.trim();
      } finally {
        clearTimeout(deadline);
      }
    })();
    return structuredClone(status);
  }
  private async owned(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    await authorize();
    const entry = this.entries.get(jobId);
    if (!entry || entry.status.diagramId !== diagramId)
      throw Object.assign(new StorageError(404, 'This analytics job is unavailable or expired.'), {
        code: 'ANALYTICS_JOB_NOT_FOUND',
      });
    await entry.authority.guard.check();
    await authorize();
    return entry;
  }
  async status(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    return structuredClone((await this.owned(diagramId, jobId, authorize)).status);
  }
  async result(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    const entry = await this.owned(diagramId, jobId, authorize);
    if (entry.status.state !== 'succeeded' || !entry.value)
      throw new StorageError(409, 'The analytics job has no completed result.');
    return structuredClone({
      request: entry.request!,
      value: entry.value,
      model: entry.model!,
      modelVersion: entry.modelVersion,
    });
  }
  async cancel(diagramId: string, jobId: string, authorize: () => Promise<void>) {
    const entry = await this.owned(diagramId, jobId, authorize);
    const status = { ...entry.status, state: 'cancelled' as const };
    this.erase(jobId);
    return status;
  }
  clear() {
    for (const id of [...this.entries.keys()]) this.erase(id);
  }
  private erase(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    clearTimeout(entry.expiry);
    entry.authority.guard.signal.removeEventListener('abort', entry.abort);
    entry.controller.abort();
    entry.request = undefined;
    entry.model = undefined;
    entry.value = undefined;
    entry.authority.dispose();
  }
  private trim() {
    const completed = [...this.entries.values()].filter(
      (entry) => entry.status.state !== 'running',
    );
    const size = () => completed.reduce((total, entry) => total + entry.bytes, 0);
    while (
      completed.length > analyticsJobLimits.retained ||
      size() > analyticsJobLimits.retainedBytes
    ) {
      const entry = completed.shift();
      if (!entry) break;
      this.erase(entry.status.jobId);
    }
  }
}
export const analyticsApiJobs = new AnalyticsApiJobs();
registerAnalyticsCleanup(() => analyticsApiJobs.clear());
