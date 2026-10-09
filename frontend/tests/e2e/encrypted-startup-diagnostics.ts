import type { Page } from '@playwright/test';

/** Test-only timing observer. Never records request arguments, results or document text. */
export function installEncryptedStartupDiagnostics() {
  const property = '__encryptedStartupTiming';
  if (Reflect.has(window, property)) return;

  class NativeStartupTiming {
    private sequence = 0;
    private entries: Record<string, unknown>[] = [];
    private pending = new Map<number, Record<string, unknown>>();
    private stage = '';
    private stages: Record<string, unknown>[] = [];
    private counts: Record<string, number> = {};
    private durations: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
    private discarded = 0;
    private discardedPending = 0;

    record(kind: string, detail: Record<string, unknown> = {}) {
      this.counts[kind] = (this.counts[kind] ?? 0) + 1;
      if (typeof detail.durationMs === 'number') {
        const durations = (this.durations[kind] ??= { count: 0, totalMs: 0, maxMs: 0 });
        durations.count++;
        durations.totalMs += detail.durationMs;
        durations.maxMs = Math.max(durations.maxMs, detail.durationMs);
      }
      if (this.entries.length >= 2048) {
        this.entries.shift();
        this.discarded++;
      }
      this.entries.push({ timeMs: performance.now(), kind, ...detail });
    }
    begin(kind: string, detail: Record<string, unknown> = {}) {
      const id = ++this.sequence;
      const operation = { id, startedMs: performance.now(), kind, ...detail };
      if (this.pending.size >= 256) {
        this.pending.delete(this.pending.keys().next().value!);
        this.discardedPending++;
      }
      this.pending.set(id, operation);
      this.record(`${kind}:begin`, { id, ...detail });
      return id;
    }
    finish(id: number, phase: string, detail: Record<string, unknown> = {}) {
      const operation = this.pending.get(id);
      if (!operation) return;
      this.pending.delete(id);
      this.record(`${operation.kind}:${phase}`, {
        id,
        durationMs: performance.now() - (operation.startedMs as number),
        ...detail,
      });
    }
    uiStage() {
      const root = document.getElementById('visual-nerve');
      const stage = root?.querySelector('.storage-gate')
        ? 'app-awaiting-stored-consent'
        : root?.querySelector('.canvas-shell')
          ? 'diagram-canvas-mounted'
          : root?.querySelector('.main-workspace .welcome .muted')
            ? 'app-opening-local-workspace'
            : root?.querySelector('.application')
              ? 'app-mounted'
              : root?.querySelector('[role="status"]')
                ? 'workspace-loader-status'
                : document.querySelector('[role="dialog"]')
                  ? 'dialog-visible'
                  : 'workspace-surface-not-mounted';
      if (stage !== this.stage) {
        this.stage = stage;
        if (this.stages.length >= 64) this.stages.shift();
        this.stages.push({ timeMs: performance.now(), stage });
        this.record('ui-stage', { stage });
      }
    }
    snapshot(label: string) {
      this.uiStage();
      return {
        label,
        documentElapsedMs: performance.now(),
        visibility: document.visibilityState,
        stage: this.stage,
        stages: this.stages,
        counts: this.counts,
        durations: this.durations,
        discardedEntries: this.discarded,
        discardedPending: this.discardedPending,
        entries: this.entries,
        pending: [...this.pending.values()],
      };
    }
  }
  const timing = new NativeStartupTiming();
  Reflect.set(window, property, timing);
  const safe = (action: () => void) => {
    try {
      action();
    } catch {
      // Diagnostic collection must never change an application's operation.
    }
  };
  const observeRequest = (request: IDBRequest, operation: string, store?: string) => {
    const id = timing.begin('idb-request', { operation, ...(store ? { store } : {}) });
    request.addEventListener('success', () => safe(() => timing.finish(id, 'success')));
    request.addEventListener('error', () =>
      safe(() => timing.finish(id, 'error', { errorName: request.error?.name })),
    );
    if (request instanceof IDBOpenDBRequest) {
      request.addEventListener('blocked', () =>
        safe(() => timing.record('idb-open:blocked', { id })),
      );
      request.addEventListener('upgradeneeded', () =>
        safe(() => timing.record('idb-open:upgrade', { id })),
      );
    }
    return request;
  };
  const wrapRequests = (prototype: object, names: readonly string[]) => {
    for (const operation of names) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, operation);
      if (typeof descriptor?.value !== 'function') continue;
      const original = descriptor.value;
      Object.defineProperty(prototype, operation, {
        ...descriptor,
        value: function (this: IDBObjectStore | IDBIndex, ...args: unknown[]) {
          const result = Reflect.apply(original, this, args) as IDBRequest;
          safe(() =>
            observeRequest(
              result,
              operation,
              this instanceof IDBIndex ? this.objectStore.name : this.name,
            ),
          );
          return result;
        },
      });
    }
  };
  wrapRequests(IDBObjectStore.prototype, [
    'add',
    'put',
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'delete',
    'clear',
    'count',
    'openCursor',
    'openKeyCursor',
  ]);
  wrapRequests(IDBIndex.prototype, [
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'count',
    'openCursor',
    'openKeyCursor',
  ]);
  for (const operation of ['open', 'deleteDatabase'] as const) {
    const original = IDBFactory.prototype[operation];
    Object.defineProperty(IDBFactory.prototype, operation, {
      ...Object.getOwnPropertyDescriptor(IDBFactory.prototype, operation),
      value: function (this: IDBFactory, ...args: unknown[]) {
        const request = Reflect.apply(original, this, args) as IDBOpenDBRequest;
        safe(() => observeRequest(request, operation));
        return request;
      },
    });
  }
  const transaction = IDBDatabase.prototype.transaction;
  Object.defineProperty(IDBDatabase.prototype, 'transaction', {
    ...Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'transaction'),
    value: function (this: IDBDatabase, ...args: unknown[]) {
      const native = Reflect.apply(transaction, this, args) as IDBTransaction;
      safe(() => {
        const id = timing.begin('idb-transaction', {
          mode: native.mode,
          stores: [...native.objectStoreNames],
        });
        native.addEventListener('complete', () => safe(() => timing.finish(id, 'complete')));
        native.addEventListener('abort', () =>
          safe(() => timing.finish(id, 'abort', { errorName: native.error?.name })),
        );
        native.addEventListener('error', () =>
          safe(() => timing.record('idb-transaction:error', { id, errorName: native.error?.name })),
        );
      });
      return native;
    },
  });
  if (navigator.locks) {
    const request = navigator.locks.request;
    navigator.locks.request = function (this: LockManager, ...args: unknown[]) {
      const callbackIndex = typeof args[1] === 'function' ? 1 : 2;
      const callback = args[callbackIndex] as (...values: unknown[]) => unknown;
      const name = String(args[0]);
      const lockClass = name.startsWith('visualnerve-vault-transaction:')
        ? 'vault-transaction'
        : name === 'visual-nerve-app-assets-v1'
          ? 'static-app-assets'
          : 'other';
      const options = callbackIndex === 2 ? (args[1] as LockOptions) : undefined;
      const id = timing.begin('web-lock', { lockClass, mode: options?.mode ?? 'exclusive' });
      args[callbackIndex] = (...values: unknown[]) => {
        safe(() => timing.record('web-lock:acquired', { id }));
        let result;
        try {
          result = Reflect.apply(callback, undefined, values);
        } catch (error) {
          safe(() => timing.finish(id, 'callback-error'));
          throw error;
        }
        // Return the application's original value/promise unchanged. This
        // observer neither retries nor changes native lock-release ordering.
        void Promise.resolve(result).then(
          () => safe(() => timing.record('web-lock:callback-settled', { id })),
          () => safe(() => timing.record('web-lock:callback-rejected', { id })),
        );
        return result;
      };
      let result;
      try {
        result = Reflect.apply(request, this, args) as Promise<unknown>;
      } catch (error) {
        safe(() => timing.finish(id, 'request-error'));
        throw error;
      }
      void result.then(
        () => safe(() => timing.finish(id, 'released')),
        () => safe(() => timing.finish(id, 'rejected')),
      );
      return result;
    } as LockManager['request'];
  }
  for (const operation of [
    'decrypt',
    'encrypt',
    'sign',
    'verify',
    'digest',
    'deriveKey',
    'deriveBits',
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(SubtleCrypto.prototype, operation);
    if (typeof descriptor?.value !== 'function') continue;
    const original = descriptor.value;
    Object.defineProperty(SubtleCrypto.prototype, operation, {
      ...descriptor,
      value: function (this: SubtleCrypto, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args) as Promise<unknown>;
        const id = timing.begin('crypto', { operation });
        void result.then(
          () => safe(() => timing.finish(id, 'complete')),
          () => safe(() => timing.finish(id, 'rejected')),
        );
        return result;
      },
    });
  }
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        safe(() =>
          timing.record('long-task', { startedMs: entry.startTime, durationMs: entry.duration }),
        );
    }).observe({ type: 'longtask', buffered: true });
  }
  new MutationObserver(() => safe(() => timing.uiStage())).observe(document, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('visibilitychange', () =>
    safe(() => timing.record('visibility', { visibility: document.visibilityState })),
  );
  window.addEventListener('focus', () => safe(() => timing.record('focus')));
  timing.record('document-start');
}

export async function readEncryptedStartupDiagnostics(page: Page, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(
        (value) => Reflect.get(window, '__encryptedStartupTiming')?.snapshot(value),
        label,
      ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ label, unavailable: 'Renderer diagnostic snapshot exceeded 3 seconds.' }),
          3000,
        );
      }),
    ]);
  } catch (error) {
    return {
      label,
      unavailable: 'The renderer could not provide its diagnostic snapshot.',
      errorName: error instanceof Error ? error.name : 'unknown',
    };
  } finally {
    clearTimeout(timer);
  }
}
