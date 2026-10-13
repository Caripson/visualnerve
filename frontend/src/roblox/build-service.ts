import type { GameDefinition, RobloxBuild } from './types';
import type { ExportGuard } from '../export/guard';
import { checkExportActive, assertExportActive } from '../export/guard';
import { RobloxError } from './errors';
import { registerRobloxCleanup } from './lifecycle';

export interface RobloxBuildOptions {
  guard?: ExportGuard;
  signal?: AbortSignal;
  progress?: (value: number) => void;
}
interface Task {
  controller: AbortController;
  worker?: Worker;
  reject: (error: unknown) => void;
}
export const robloxBuildLimits = {
  active: 2,
  retained: 4,
  bytes: 32 * 1024 * 1024,
  deadlineMs: 120000,
  retentionMs: 15 * 60 * 1000,
  chunkBytes: 65536,
} as const;

/** UI and REST/MCP build the same canonical compiler in bounded, revocable workers. */
export class RobloxBuildService {
  private tasks = new Set<Task>();
  private generation = 0;
  constructor() {
    registerRobloxCleanup(() => this.dispose());
  }
  async build(game: GameDefinition, options: RobloxBuildOptions = {}): Promise<RobloxBuild> {
    const generation = this.generation;
    await checkExportActive(options.guard);
    options.signal?.throwIfAborted();
    if (this.tasks.size >= robloxBuildLimits.active)
      throw new RobloxError(
        429,
        'Two Roblox builds are already running. Wait or cancel one.',
        'ROBLOX_BUILD_BUSY',
      );
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      ...(options.guard ? [options.guard.signal] : []),
      ...(options.signal ? [options.signal] : []),
    ]);
    let task: Task | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let clear: (() => void) | undefined;
    try {
      const result = await new Promise<RobloxBuild>((resolve, reject) => {
        task = { controller, reject };
        this.tasks.add(task);
        const abort = () => {
          clear?.();
          reject(
            new RobloxError(
              409,
              'The Roblox build was cancelled or its workspace changed.',
              'ROBLOX_BUILD_CANCELLED',
            ),
          );
        };
        clear = () => {
          signal.removeEventListener('abort', abort);
          task?.worker?.terminate();
        };
        signal.addEventListener('abort', abort, { once: true });
        deadline = setTimeout(() => controller.abort(), robloxBuildLimits.deadlineMs);
        if (signal.aborted || generation !== this.generation) {
          abort();
          return;
        }
        options.progress?.(0);
        if (typeof Worker === 'undefined') {
          void import('./compiler')
            .then(async ({ compileRobloxGame }) => {
              await checkExportActive(options.guard);
              signal.throwIfAborted();
              const value = compileRobloxGame(game);
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
          const worker = new Worker(new URL('./build-worker.ts', import.meta.url), {
            type: 'module',
          });
          task.worker = worker;
          worker.onmessage = (
            event: MessageEvent<{
              kind: string;
              progress?: number;
              result?: RobloxBuild;
              code?: string;
              message?: string;
              issues?: unknown[];
            }>,
          ) => {
            if (signal.aborted || generation !== this.generation) {
              abort();
              return;
            }
            if (event.data.kind === 'progress') options.progress?.(event.data.progress ?? 0);
            else {
              clear?.();
              if (event.data.kind === 'result' && event.data.result) resolve(event.data.result);
              else
                reject(
                  new RobloxError(
                    422,
                    event.data.message ?? 'The build failed.',
                    event.data.code ?? 'ROBLOX_BUILD_FAILED',
                    event.data.issues,
                  ),
                );
            }
          };
          worker.onerror = () => {
            clear?.();
            reject(
              new RobloxError(
                422,
                'The Roblox build worker could not finish. Try rebuilding after checking the plan.',
                'ROBLOX_BUILD_FAILED',
              ),
            );
          };
          assertExportActive(options.guard);
          signal.throwIfAborted();
          worker.postMessage({ game });
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
          'The game workspace changed while building.',
          'ROBLOX_BUILD_CANCELLED',
        );
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > robloxBuildLimits.bytes)
        throw new RobloxError(
          413,
          'The generated Roblox files exceed the 32 MiB result budget. Reduce object or rule size.',
          'ROBLOX_BUILD_LIMIT',
        );
      options.progress?.(100);
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
          'The workspace closed. Build again after unlocking.',
          'ROBLOX_BUILD_CANCELLED',
        ),
      );
    }
    this.tasks.clear();
  }
}
export const robloxBuildService = new RobloxBuildService();
