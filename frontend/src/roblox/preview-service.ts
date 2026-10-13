import { assertExportActive, checkExportActive, type ExportGuard } from '../export/guard';
import { RobloxError } from './errors';
import { registerRobloxCleanup } from './lifecycle';
import {
  robloxPreviewLimits,
  runRobloxPreview,
  type RobloxPreviewResult,
  type RobloxPreviewStep,
} from './preview';
import type { GameDefinition } from './types';
export interface RobloxPreviewOptions {
  guard?: ExportGuard;
  signal?: AbortSignal;
  history?: boolean;
}
interface PreviewTask {
  controller: AbortController;
  worker?: Worker;
  reject: (error: unknown) => void;
}

/** Transient private results stay bound to the originating vault/grant and are never retained. */
export class RobloxPreviewService {
  private tasks = new Set<PreviewTask>();
  private generation = 0;
  constructor() {
    registerRobloxCleanup(() => this.dispose());
  }
  async execute(
    game: GameDefinition,
    steps: readonly RobloxPreviewStep[],
    options: RobloxPreviewOptions = {},
  ): Promise<RobloxPreviewResult> {
    const generation = this.generation;
    await checkExportActive(options.guard);
    options.signal?.throwIfAborted();
    if (this.tasks.size >= robloxPreviewLimits.active)
      throw new RobloxError(
        429,
        'Two rule tests are already running. Wait or cancel one.',
        'ROBLOX_PREVIEW_BUSY',
      );
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      ...(options.signal ? [options.signal] : []),
      ...(options.guard ? [options.guard.signal] : []),
    ]);
    let task: PreviewTask | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    let clear: (() => void) | undefined;
    try {
      const result = await new Promise<RobloxPreviewResult>((resolve, reject) => {
        task = { controller, reject };
        this.tasks.add(task);
        const abort = () => {
          clear?.();
          reject(
            new RobloxError(
              409,
              'The rule test was cancelled or its workspace changed.',
              'ROBLOX_PREVIEW_CANCELLED',
            ),
          );
        };
        clear = () => {
          signal.removeEventListener('abort', abort);
          task?.worker?.terminate();
        };
        signal.addEventListener('abort', abort, { once: true });
        deadline = setTimeout(() => controller.abort(), robloxPreviewLimits.deadlineMs);
        if (signal.aborted || generation !== this.generation) {
          abort();
          return;
        }
        if (typeof Worker === 'undefined') {
          void Promise.resolve()
            .then(async () => {
              await checkExportActive(options.guard);
              signal.throwIfAborted();
              const value = runRobloxPreview(game, steps, { history: options.history });
              await checkExportActive(options.guard);
              signal.throwIfAborted();
              clear?.();
              resolve(value);
            })
            .catch((error) => {
              clear?.();
              reject(error);
            });
          return;
        }
        try {
          const worker = new Worker(new URL('./preview-worker.ts', import.meta.url), {
            type: 'module',
          });
          task.worker = worker;
          worker.onmessage = (
            event: MessageEvent<{
              result?: RobloxPreviewResult;
              message?: string;
              code?: string;
              issues?: unknown[];
            }>,
          ) => {
            if (signal.aborted || generation !== this.generation) {
              abort();
              return;
            }
            clear?.();
            if (event.data.result) resolve(event.data.result);
            else
              reject(
                new RobloxError(
                  422,
                  event.data.message ?? 'The rule test failed.',
                  event.data.code ?? 'ROBLOX_PREVIEW_FAILED',
                  event.data.issues,
                ),
              );
          };
          worker.onerror = () => {
            clear?.();
            reject(
              new RobloxError(
                422,
                'The rule-test worker could not finish.',
                'ROBLOX_PREVIEW_FAILED',
              ),
            );
          };
          assertExportActive(options.guard);
          signal.throwIfAborted();
          worker.postMessage({ game, steps, history: options.history });
        } catch (error) {
          clear?.();
          reject(error);
        }
      });
      await checkExportActive(options.guard);
      signal.throwIfAborted();
      if (generation !== this.generation)
        throw new RobloxError(
          409,
          'The workspace changed during the rule test.',
          'ROBLOX_PREVIEW_CANCELLED',
        );
      return result;
    } finally {
      clear?.();
      if (deadline) clearTimeout(deadline);
      task?.worker?.terminate();
      if (task) this.tasks.delete(task);
    }
  }
  dispose() {
    this.generation++;
    for (const task of this.tasks) {
      task.controller.abort();
      task.worker?.terminate();
      task.reject(
        new RobloxError(
          409,
          'The workspace closed. Test again after unlocking.',
          'ROBLOX_PREVIEW_CANCELLED',
        ),
      );
    }
    this.tasks.clear();
  }
}
export const robloxPreviewService = new RobloxPreviewService();
export const executeRobloxPreview = (
  game: GameDefinition,
  steps: readonly RobloxPreviewStep[],
  options?: RobloxPreviewOptions,
) => robloxPreviewService.execute(game, steps, options);
