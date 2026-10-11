import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankAnalytics } from '../src/analytics/validation';
import type { AnalysisJobRequest, AnalysisJobValue } from '../src/analytics/types';
import { AnalyticsApiJobs, analyticsJobLimits } from '../src/storage/analytics-api-jobs';

const registries: AnalyticsApiJobs[] = [];
const value: AnalysisJobValue = {
  kind: 'measurement',
  measurementId: 'change',
  metrics: { absoluteChange: { value: 20 } },
  notes: [],
};
const request: AnalysisJobRequest = {
  kind: 'scenario',
  scenario: {
    id: 'baseline',
    name: 'Baseline',
    version: 1,
    model: 'growth-churn',
    start: '2026-01-01T00:00:00.000Z',
    periods: 1,
    resolution: 'month',
    reviewed: true,
    assumptions: {
      openingCustomers: 1000,
      newCustomers: 30,
      reactivatedCustomers: 0,
      churnRate: 0.02,
      newCustomerGrowth: 0,
      openingMrc: 100000,
      newMrc: 5000,
      expansionMrc: 1000,
      contractionMrc: 2000,
      churnedMrc: 3000,
      currency: 'SEK',
    },
  },
};
function authority() {
  const controller = new AbortController();
  return {
    controller,
    guard: {
      signal: controller.signal,
      assertCurrent: () => controller.signal.throwIfAborted(),
      check: vi.fn(async () => controller.signal.throwIfAborted()),
    },
    dispose: vi.fn(),
  };
}
function deferredRegistry() {
  const pending: {
    resolve: (value: AnalysisJobValue) => void;
    options: {
      signal: AbortSignal;
      progress: (done: number, total: number) => void;
      guard: () => Promise<void>;
    };
  }[] = [];
  const jobs = new AnalyticsApiJobs(
    (_request, options) => new Promise((resolve) => pending.push({ resolve, options })),
    () => '2026-10-11T00:00:00.000Z',
  );
  registries.push(jobs);
  return { jobs, pending };
}
const origin = () => ({ model: blankAnalytics(), modelVersion: 1 });
const authorize = async () => {};
afterEach(() => {
  for (const jobs of registries.splice(0)) jobs.clear();
  vi.useRealTimers();
});

describe('bounded originating-session analytics jobs', () => {
  it('limits active work, reports real progress and returns only completed detached results', async () => {
    const { jobs, pending } = deferredRegistry();
    const a = authority(),
      b = authority(),
      c = authority();
    const first = await jobs.start('diagram-a', request, a, origin());
    const second = await jobs.start('diagram-a', request, b, origin());
    await expect(jobs.start('diagram-a', request, c, origin())).rejects.toMatchObject({
      status: 429,
      code: 'ANALYTICS_JOB_BUSY',
    });
    expect(c.dispose).toHaveBeenCalledOnce();
    pending[0].options.progress(3, 10);
    expect(await jobs.status('diagram-a', first.jobId, authorize)).toMatchObject({
      state: 'running',
      progress: 30,
    });
    await expect(jobs.result('diagram-a', first.jobId, authorize)).rejects.toMatchObject({
      status: 409,
    });
    await expect(jobs.status('diagram-b', first.jobId, authorize)).rejects.toMatchObject({
      status: 404,
    });
    pending[0].resolve(value);
    await expect
      .poll(async () => (await jobs.status('diagram-a', first.jobId, authorize)).state)
      .toBe('succeeded');
    const result = await jobs.result('diagram-a', first.jobId, authorize);
    expect(result.value).toEqual(value);
    expect(result.modelVersion).toBe(1);
    (result.value as typeof value).metrics.absoluteChange.value = 999;
    expect((await jobs.result('diagram-a', first.jobId, authorize)).value).toEqual(value);
    const cancelled = await jobs.cancel('diagram-a', second.jobId, authorize);
    expect(cancelled.state).toBe('cancelled');
    expect(pending[1].options.signal.aborted).toBe(true);
    expect(b.dispose).toHaveBeenCalledOnce();
    pending[1].resolve(value);
    await expect(jobs.result('diagram-a', second.jobId, authorize)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('does not publish a late result after the original grant/session aborts', async () => {
    const { jobs, pending } = deferredRegistry();
    const access = authority();
    const status = await jobs.start('diagram', request, access, origin());
    access.controller.abort();
    expect(pending[0].options.signal.aborted).toBe(true);
    pending[0].resolve(value);
    await expect(jobs.status('diagram', status.jobId, authorize)).rejects.toMatchObject({
      status: 404,
    });
    expect(access.dispose).toHaveBeenCalledOnce();
  });
  it('cancels a deadline-limited calculation rather than publishing its later value', async () => {
    vi.useFakeTimers();
    const { jobs, pending } = deferredRegistry();
    const access = authority();
    const status = await jobs.start('diagram', request, access, origin());
    await vi.advanceTimersByTimeAsync(analyticsJobLimits.deadlineMs);
    expect(pending[0].options.signal.aborted).toBe(true);
    pending[0].resolve(value);
    await vi.advanceTimersByTimeAsync(0);
    expect(await jobs.status('diagram', status.jobId, authorize)).toMatchObject({
      state: 'cancelled',
    });
    await expect(jobs.result('diagram', status.jobId, authorize)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('retains at most four terminal jobs and removes expired private inputs', async () => {
    vi.useFakeTimers();
    const { jobs, pending } = deferredRegistry();
    const completed: string[] = [];
    for (let i = 0; i < 5; i++) {
      const status = await jobs.start('diagram', request, authority(), origin());
      completed.push(status.jobId);
      pending[i].resolve(value);
      await vi.advanceTimersByTimeAsync(0);
    }
    await expect(jobs.status('diagram', completed[0], authorize)).rejects.toMatchObject({
      status: 404,
    });
    expect((await jobs.result('diagram', completed[4], authorize)).value).toEqual(value);
    await vi.advanceTimersByTimeAsync(analyticsJobLimits.retentionMs);
    await expect(jobs.result('diagram', completed[4], authorize)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('rejects oversized retained input/result without making the result available', async () => {
    const { jobs, pending } = deferredRegistry();
    const status = await jobs.start('diagram', request, authority(), origin());
    pending[0].resolve({ ...value, notes: ['x'.repeat(analyticsJobLimits.retainedBytes)] });
    await expect
      .poll(async () => (await jobs.status('diagram', status.jobId, authorize)).state)
      .toBe('failed');
    expect(await jobs.status('diagram', status.jobId, authorize)).toMatchObject({
      error: { code: 'ANALYTICS_RESULT_LIMIT' },
    });
    await expect(jobs.result('diagram', status.jobId, authorize)).rejects.toMatchObject({
      status: 409,
    });
  });
});
