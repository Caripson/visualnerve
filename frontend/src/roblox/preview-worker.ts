import { runRobloxPreview } from './preview';
import type { GameDefinition } from './types';
self.onmessage = (
  event: MessageEvent<{ game: GameDefinition; steps: unknown; history?: boolean }>,
) => {
  try {
    self.postMessage({
      result: runRobloxPreview(event.data.game, event.data.steps, { history: event.data.history }),
    });
  } catch (error) {
    const detail = error as {
      code?: string;
      message?: string;
      diagnostics?: unknown[];
      issues?: unknown[];
    };
    self.postMessage({
      code: detail.code ?? 'ROBLOX_PREVIEW_FAILED',
      message: detail.message ?? 'The rule test failed.',
      issues: detail.diagnostics ?? detail.issues,
    });
  }
};
