import { compileRobloxGame } from './compiler';
import type { GameDefinition } from './types';

self.onmessage = (event: MessageEvent<{ game: GameDefinition }>) => {
  try {
    self.postMessage({ kind: 'progress', progress: 10 });
    const result = compileRobloxGame(event.data.game);
    self.postMessage({ kind: 'result', result });
  } catch (error) {
    const detail = error as { code?: string; message?: string; diagnostics?: unknown[] };
    self.postMessage({
      kind: 'error',
      code: detail.code ?? 'ROBLOX_BUILD_FAILED',
      message: detail.message ?? 'The Roblox build failed.',
      issues: detail.diagnostics,
    });
  }
};
