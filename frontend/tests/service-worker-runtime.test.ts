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
function worker(fetcher: typeof fetch, assets: readonly string[] = []) {
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
    .replace('__ASSETS__', JSON.stringify(assets))
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
    install: () => {
      let settled!: Promise<unknown>;
      listeners.get('install')!({
        waitUntil: (value) => {
          settled = value;
        },
      });
      return settled;
    },
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

it('bounds the full install body/cache pipeline to six workers and retains every static asset', async () => {
  const assets = Array.from({ length: 19 }, (_, index) => `/editor/assets/static-${index}.js`);
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  let openBodies = 0;
  let maximumBodies = 0;
  const fetcher = vi.fn<typeof fetch>(async (request) => {
    const path = String(request);
    openBodies++;
    maximumBodies = Math.max(maximumBodies, openBodies);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(path, controller);
        },
      }),
    );
  });
  const runtime = worker(fetcher, assets);
  let complete = false;
  const installing = runtime.install().then(() => {
    complete = true;
  });
  await vi.waitFor(() => expect(runtime.put).toHaveBeenCalledTimes(6));
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(complete).toBe(false);
  const release = (path: string) => {
    const stream = streams.get(path)!;
    streams.delete(path);
    openBodies--;
    stream.enqueue(new TextEncoder().encode(`asset contents: ${path}`));
    stream.close();
  };
  release(assets[0]);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(7));
  expect(streams.size).toBe(6);
  while (!complete) {
    for (const path of [...streams.keys()]) release(path);
    await vi.waitFor(() => expect(complete || streams.size > 0).toBe(true));
  }
  await installing;
  expect(maximumBodies).toBe(6);
  expect(openBodies).toBe(0);
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(assets);
  expect(runtime.put).toHaveBeenCalledTimes(assets.length);
  for (const path of assets)
    expect(await runtime.cached(path)?.text()).toBe(`asset contents: ${path}`);
});

it('aborts active install fetches and never starts queued paths after Clear', async () => {
  const assets = Array.from({ length: 18 }, (_, index) => `/editor/assets/cancel-${index}.js`);
  const responses: ReturnType<typeof deferred<Response>>[] = [];
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_request, options) => {
    signals.push(options!.signal!);
    const response = deferred<Response>();
    responses.push(response);
    // Deliberately ignore abort, as a delayed network completion may do.
    return response.promise;
  });
  const runtime = worker(fetcher, assets);
  const installing = runtime.install().catch((error: unknown) => error);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
  const clearing = runtime.clear();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(clearing.acknowledged).not.toHaveBeenCalled();
  for (const response of responses) response.resolve(new Response('late response'));
  expect(await installing).toMatchObject({ name: 'AbortError' });
  await clearing.settled;
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(runtime.put).not.toHaveBeenCalled();
  expect(clearing.acknowledged).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
});

it('waits for every unabortable started install cache write before acknowledging Clear', async () => {
  const assets = Array.from({ length: 18 }, (_, index) => `/editor/assets/writing-${index}.js`);
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
          },
        }),
      ),
  );
  const runtime = worker(fetcher, assets);
  const installing = runtime.install().catch((error: unknown) => error);
  await vi.waitFor(() => expect(runtime.put).toHaveBeenCalledTimes(6));
  const clearing = runtime.clear();
  expect(clearing.acknowledged).not.toHaveBeenCalled();
  for (const stream of streams.slice(0, -1)) {
    stream.enqueue(new TextEncoder().encode('completed cache write'));
    stream.close();
  }
  await vi.waitFor(() => expect(runtime.cached(assets[4])).toBeDefined());
  expect(clearing.acknowledged).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(6);
  const last = streams.at(-1)!;
  last.enqueue(new TextEncoder().encode('last unabortable cache write'));
  last.close();
  expect(await installing).toMatchObject({ name: 'AbortError' });
  await clearing.settled;
  expect(await runtime.cached(assets[5])?.text()).toBe('last unabortable cache write');
  expect(runtime.put).toHaveBeenCalledTimes(6);
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(clearing.acknowledged).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
});

it('stops queued assets on HTTP failure and settles other started workers before rejecting install', async () => {
  const assets = Array.from({ length: 12 }, (_, index) => `/editor/assets/failing-${index}.js`);
  const responses: ReturnType<typeof deferred<Response>>[] = [];
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_request, options) => {
    signals.push(options!.signal!);
    const response = deferred<Response>();
    responses.push(response);
    return response.promise;
  });
  const runtime = worker(fetcher, assets);
  let finished = false;
  const installing = runtime.install().catch((error: unknown) => {
    finished = true;
    return error;
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
  responses[2].resolve(new Response('not found', { status: 404 }));
  await vi.waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
  expect(finished).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(6);
  for (const [index, response] of responses.entries())
    if (index !== 2) response.resolve(new Response('late response'));
  expect(await installing).toMatchObject({ message: `Offline asset failed: ${assets[2]}` });
  expect(runtime.put).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(6);
});
