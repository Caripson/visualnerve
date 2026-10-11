import { executeAnalysis } from './engine';
import type { AnalysisJobRequest } from './types';
import { AnalyticsError } from './validation';
self.onmessage = (
  event: MessageEvent<{ request: AnalysisJobRequest; now: string; cutoff?: string }>,
) => {
  try {
    const value = executeAnalysis(event.data.request, {
      now: () => event.data.now,
      cutoff: event.data.cutoff,
      progress: (completed, total) => self.postMessage({ kind: 'progress', completed, total }),
    });
    self.postMessage({ kind: 'result', value });
  } catch (error) {
    self.postMessage({
      kind: 'error',
      code: error instanceof AnalyticsError ? error.code : 'INVALID_ANALYTICS',
      message: error instanceof Error ? error.message : 'Analysis failed.',
      issues: error instanceof AnalyticsError ? error.issues : undefined,
    });
  }
};
