import { clearSvgJobsIfLoaded } from '../export/svg-job-lifecycle';
import { SPEECH_MODEL_CACHE } from '../presentation/speech/protocol';
import { isNarrationClipCache } from '../presentation/speech/clip-cache-protocol';

export const APP_ASSET_LOCK = 'visual-nerve-app-assets-v1';
export const APP_CACHE_CLEAR_LOCK = 'visual-nerve-cache-clear-v1';
export const APP_CACHE_CONTROL_CACHE = 'visual-nerve-cache-control-v1';
export const APP_CACHE_CONTROL_URL = 'https://visualnerve.invalid/cache-control-v1';
export const APP_CACHE_CHANNEL = 'visual-nerve-app-cache-v1';
const CLEAR_TIMEOUT_MS = 10_000;
const CONTROL_EXPIRY_MS = 30_000;

export interface AppCacheClearResult {
  available: boolean;
  deletedCaches: string[];
}
export class AppCacheError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
interface CacheControl {
  generation: string;
  clearing: boolean;
  expiresAt: number;
}
export interface AppAssetLease {
  signal: AbortSignal;
  check(): Promise<void>;
  put(cache: Cache, request: RequestInfo | URL, response: Response): Promise<void>;
}
const cancelled = () => new DOMException('App asset download cancelled.', 'AbortError');
export function isOwnedAppAssetCache(name: string) {
  return (
    /^visual-nerve-(?:app-)?shell-[a-f0-9]{12}$/.test(name) ||
    name === SPEECH_MODEL_CACHE ||
    isNarrationClipCache(name)
  );
}
async function control(): Promise<CacheControl> {
  const response = await (await caches.open(APP_CACHE_CONTROL_CACHE)).match(APP_CACHE_CONTROL_URL);
  if (!response) return { generation: 'initial', clearing: false, expiresAt: 0 };
  let value: CacheControl;
  try {
    value = (await response.json()) as CacheControl;
  } catch {
    throw new AppCacheError('CACHE_CONTROL_INVALID', 'App cache coordination metadata is invalid.');
  }
  if (
    !value ||
    typeof value.generation !== 'string' ||
    !value.generation ||
    typeof value.clearing !== 'boolean' ||
    !Number.isFinite(value.expiresAt)
  )
    throw new AppCacheError('CACHE_CONTROL_INVALID', 'App cache coordination metadata is invalid.');
  return value;
}
const isClearing = (state: CacheControl) => state.clearing && state.expiresAt > Date.now();
async function writeControl(value: CacheControl) {
  await (
    await caches.open(APP_CACHE_CONTROL_CACHE)
  ).put(
    APP_CACHE_CONTROL_URL,
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }),
  );
}

/** Coordinates app cache jobs, including encrypted temporary narration. No workspace credentials. */
export class AppCacheManager {
  private downloads = new Set<AbortController>();
  private channel?: BroadcastChannel;
  private revision = 0;
  private clearing = false;
  private listen() {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(APP_CACHE_CHANNEL);
    this.channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'clear-app-assets') this.abortDownloads();
    };
  }
  private abortDownloads() {
    this.revision++;
    for (const controller of this.downloads) controller.abort(cancelled());
  }
  ownsSignal(signal?: AbortSignal | null) {
    return !!signal && [...this.downloads].some((controller) => controller.signal === signal);
  }
  async download<T>(operation: (lease: AppAssetLease) => Promise<T>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.clearing) throw cancelled();
    this.listen();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason ?? cancelled());
    signal?.addEventListener('abort', abort, { once: true });
    this.downloads.add(controller);
    const revision = this.revision;
    const run = async () => {
      controller.signal.throwIfAborted();
      let initial: CacheControl | undefined;
      try {
        if (typeof caches !== 'undefined') initial = await control();
      } catch (error) {
        if (error instanceof AppCacheError) throw error;
        // Optional caching can be unavailable in private browsing or at quota.
      }
      if (initial && isClearing(initial)) throw cancelled();
      const check = async () => {
        controller.signal.throwIfAborted();
        if (revision !== this.revision) throw cancelled();
        if (initial) {
          const current = await control();
          if (current.generation !== initial.generation || isClearing(current)) throw cancelled();
        }
        controller.signal.throwIfAborted();
      };
      const lease: AppAssetLease = {
        signal: controller.signal,
        check,
        put: async (cache, request, response) => {
          await check();
          await cache.put(request, response);
          await check();
        },
      };
      const result = await operation(lease);
      await check();
      return result;
    };
    try {
      return await (typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(
            APP_ASSET_LOCK,
            { mode: 'shared', signal: controller.signal },
            run,
          )
        : run());
    } finally {
      signal?.removeEventListener('abort', abort);
      this.downloads.delete(controller);
    }
  }
  async clear(kind: 'app' | 'voices' = 'app'): Promise<AppCacheClearResult> {
    if (typeof caches === 'undefined') {
      this.abortDownloads();
      return { available: false, deletedCaches: [] };
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.locks ||
      typeof BroadcastChannel === 'undefined'
    )
      throw new AppCacheError(
        'CACHE_COORDINATION_UNAVAILABLE',
        'This browser cannot safely coordinate app cache clearing. No caches were cleared.',
      );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new AppCacheError(
          'CACHE_CLEAR_TIMEOUT',
          'App downloads did not stop in time. Close other app tabs and retry cache clearing.',
        );
        controller.abort(error);
        reject(error);
      }, CLEAR_TIMEOUT_MS);
    });
    const operation = navigator.locks.request(
      APP_CACHE_CLEAR_LOCK,
      { signal: controller.signal },
      async () => {
        this.listen();
        this.clearing = true;
        if (kind === 'app') clearSvgJobsIfLoaded();
        const state: CacheControl = {
          generation: crypto.randomUUID(),
          clearing: true,
          expiresAt: Date.now() + CONTROL_EXPIRY_MS,
        };
        const workers: ServiceWorker[] = [];
        try {
          await writeControl(state);
          controller.signal.throwIfAborted();
          this.abortDownloads();
          this.channel!.postMessage({ type: 'clear-app-assets', generation: state.generation });
          workers.push(...(await ownedServiceWorkers()));
          await Promise.all(workers.map((worker) => quiesceWorker(worker, true)));
          return await navigator.locks.request(
            APP_ASSET_LOCK,
            { signal: controller.signal },
            async () => {
              const deletedCaches: string[] = [];
              for (const name of (await caches.keys()).filter((name) =>
                kind === 'voices' ? name === SPEECH_MODEL_CACHE : isOwnedAppAssetCache(name),
              )) {
                controller.signal.throwIfAborted();
                if (await caches.delete(name)) deletedCaches.push(name);
                else if ((await caches.keys()).includes(name))
                  throw new AppCacheError(
                    'CACHE_DELETE_FAILED',
                    `The app cache ${name} could not be removed. Retry cache clearing.`,
                  );
              }
              controller.signal.throwIfAborted();
              return { available: true, deletedCaches };
            },
          );
        } finally {
          this.clearing = false;
          await writeControl({ ...state, clearing: false, expiresAt: 0 });
          await Promise.all(workers.map((worker) => quiesceWorker(worker, false)));
        }
      },
    );
    try {
      return await Promise.race([operation, deadline]);
    } finally {
      clearTimeout(timer!);
    }
  }
  dispose() {
    this.abortDownloads();
    this.channel?.close();
    this.channel = undefined;
  }
}
async function ownedServiceWorkers(): Promise<ServiceWorker[]> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return [];
  const registrations = await navigator.serviceWorker.getRegistrations();
  return [
    ...new Set(registrations.flatMap((entry) => [entry.active, entry.waiting, entry.installing])),
  ].filter((worker): worker is ServiceWorker => {
    if (!worker) return false;
    const url = new URL(worker.scriptURL);
    return url.origin === location.origin && url.pathname === '/sw.js';
  });
}
async function quiesceWorker(worker: ServiceWorker, begin: boolean) {
  const channel = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new AppCacheError(
          'CACHE_WORKER_UNAVAILABLE',
          'The app worker could not confirm cache clearing. Reload the app and retry.',
        ),
      );
    }, 2500);
    const cleanup = () => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
    };
    channel.port1.onmessage = (event) => {
      cleanup();
      if (event.data?.type === 'app-cache-ready' && event.data.begin === begin) resolve();
      else
        reject(
          new AppCacheError(
            'CACHE_WORKER_UNAVAILABLE',
            'The app worker could not safely stop asset downloads.',
          ),
        );
    };
    try {
      worker.postMessage({ type: 'app-cache-clear', begin }, [channel.port2]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
export const appCacheManager = new AppCacheManager();
export const clearAppCache = () => appCacheManager.clear();
export const clearVoiceAssetCache = () => appCacheManager.clear('voices');
export const withAppAssetDownload = <T>(
  operation: (lease: AppAssetLease) => Promise<T>,
  signal?: AbortSignal,
) => appCacheManager.download(operation, signal);

/** Keep the asset lease until its body is consumed, not merely until headers arrive. */
export async function fetchAppAsset(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const sourceSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  if (appCacheManager.ownsSignal(sourceSignal)) return fetcher(input, init);
  let deliver!: (response: Response) => void;
  let reject!: (error: unknown) => void;
  const response = new Promise<Response>((resolve, fail) => {
    deliver = resolve;
    reject = fail;
  });
  void withAppAssetDownload(async (lease) => {
    const original = await fetcher(input, { ...init, signal: lease.signal });
    await lease.check();
    const reader = original.body?.getReader();
    if (!reader) {
      deliver(original);
      return;
    }
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const consumed = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    let target: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => {
      void reader.cancel().catch(() => undefined);
      try {
        target.error(lease.signal.reason ?? cancelled());
      } catch {
        /* Already closed. */
      }
      fail(lease.signal.reason ?? cancelled());
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        target = controller;
      },
      async pull(controller) {
        try {
          lease.signal.throwIfAborted();
          const part = await reader.read();
          lease.signal.throwIfAborted();
          if (part.done) {
            await lease.check();
            controller.close();
            finish();
          } else controller.enqueue(part.value);
        } catch (error) {
          try {
            controller.error(error);
          } catch {
            /* Already cancelled. */
          }
          fail(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    });
    lease.signal.addEventListener('abort', abort, { once: true });
    deliver(
      new Response(body, {
        status: original.status,
        statusText: original.statusText,
        headers: original.headers,
      }),
    );
    try {
      if (lease.signal.aborted) abort();
      await consumed;
    } finally {
      lease.signal.removeEventListener('abort', abort);
    }
  }, sourceSignal ?? undefined).catch(reject);
  return response;
}
