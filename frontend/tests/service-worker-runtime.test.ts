// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const origin = 'https://app.visualnerve.com';
const shell = 'visual-nerve-app-shell-012345abcdef';
const lazyPath = '/editor/speech/piper_phonemize.wasm';
type WorkerEvent = {
  request?: Request;
  respondWith?(value: Promise<Response>): void;
  waitUntil(value: Promise<unknown>): void;
  data?: { type: string; begin: boolean };
  ports?: { postMessage(value: unknown): void }[];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Execute the generated worker's actual runtime using native Request/Response streams. */
function worker(fetcher: typeof fetch) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const entries = new Map<string, Map<string, Response>>();
  const put = vi.fn(async (name: string, path: string, response: Response) => {
    const bytes = await response.arrayBuffer();
    entries
      .get(name)!
      .set(path, new Response(bytes, { status: response.status, headers: response.headers }));
  });
  const source = readFileSync(
    new URL('../../scripts/service-worker-runtime.js', import.meta.url),
    'utf8',
  )
    .replace('__CACHE_NAME__', JSON.stringify(shell))
    .replace('__ASSETS__', '[]')
    .replace('__LAZY_ASSETS__', JSON.stringify([lazyPath]));
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (name: string, callback: (event: WorkerEvent) => void) =>
        listeners.set(name, callback),
    },
    navigator: {},
    caches: {
      open: async (name: string) => {
        if (!entries.has(name)) entries.set(name, new Map());
        return {
          match: async (path: string) => entries.get(name)!.get(path)?.clone(),
          put: (path: string, value: Response) => put(name, path, value),
        };
      },
    },
    fetch: fetcher,
    URL,
    Request,
    Response,
    Date,
    Set,
    Promise,
    AbortController,
    DOMException,
  });
  return {
    put,
    cached: (path: string) => entries.get(shell)?.get(path)?.clone(),
    request: () => {
      let response!: Promise<Response>;
      let settled!: Promise<unknown>;
      listeners.get('fetch')!({
        request: new Request(origin + lazyPath),
        respondWith: (value) => {
          response = value;
        },
        waitUntil: (value) => {
          settled = value;
        },
      });
      return { response, settled };
    },
    clear: () => {
      let settled!: Promise<unknown>;
      const acknowledged = vi.fn();
      listeners.get('message')!({
        data: { type: 'app-cache-clear', begin: true },
        ports: [{ postMessage: acknowledged }],
        waitUntil: (value) => {
          settled = value;
        },
      });
      return { settled, acknowledged };
    },
  };
}

it('caches a lazy runtime asset even when its delivered response is consumed immediately', async () => {
  const runtime = worker(async () => new Response('native WASM bytes'));
  const request = runtime.request();
  expect(await (await request.response).text()).toBe('native WASM bytes');
  await request.settled;
  expect(runtime.put).toHaveBeenCalledTimes(1);
  expect(await runtime.cached(lazyPath)?.text()).toBe('native WASM bytes');
});

it('keeps cache clearing fenced until an already-started native body/cache write has settled', async () => {
  const release = deferred<void>();
  const runtime = worker(async () => {
    const bytes = new TextEncoder().encode('streamed WASM bytes');
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await release.promise;
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    );
  });
  const request = runtime.request();
  const reading = request.response.then((response) => response.text());
  await vi.waitFor(() => expect(runtime.put).toHaveBeenCalledTimes(1));
  const clearing = runtime.clear();
  expect(clearing.acknowledged).not.toHaveBeenCalled();
  release.resolve();
  expect(await reading).toBe('streamed WASM bytes');
  await request.settled;
  await clearing.settled;
  expect(clearing.acknowledged).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
  expect(await runtime.cached(lazyPath)?.text()).toBe('streamed WASM bytes');
  // The page can now delete the old cache: no late native put can repopulate it.
});

it('does not publish or cache a late network response after cache clearing revokes its generation', async () => {
  const fetched = deferred<Response>();
  const started = deferred<void>();
  let signal: AbortSignal | null | undefined;
  const runtime = worker(async (_request, options) => {
    signal = options?.signal;
    started.resolve();
    return fetched.promise;
  });
  const request = runtime.request();
  const response = request.response.catch((error: unknown) => error);
  await started.promise;
  const clearing = runtime.clear();
  expect(signal?.aborted).toBe(true);
  expect(clearing.acknowledged).not.toHaveBeenCalled();
  fetched.resolve(new Response('stale WASM bytes'));
  expect(await response).toMatchObject({ name: 'AbortError' });
  await request.settled;
  await clearing.settled;
  expect(runtime.put).not.toHaveBeenCalled();
  expect(runtime.cached(lazyPath)).toBeUndefined();
  expect(clearing.acknowledged).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
});
