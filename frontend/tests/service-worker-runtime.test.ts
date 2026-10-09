// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { OfflineAssetPlan } from '../../scripts/offline-asset-plan.mjs';

const origin = 'https://app.visualnerve.com';
const shell = 'visual-nerve-app-shell-012345abcdef';
const lazyPath = '/editor/speech/piper_phonemize.wasm';
const noticePath = '/licenses/example-LICENSE';
type WorkerEvent = {
  request?: Request;
  respondWith?(value: Promise<Response>): void;
  waitUntil(value: Promise<unknown>): void;
  data?: { type: string; begin?: boolean; version?: string };
  source?: { id: string; type: string };
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
function worker(
  fetcher: typeof fetch,
  assets: readonly string[] = [],
  lazyAssets: readonly string[] = [lazyPath],
  retiredAppPaths: false | 'app' | 'site' = 'app',
) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const entries = new Map<string, Map<string, Response>>();
  const put = vi.fn(async (name: string, path: string, response: Response) => {
    const bytes = await response.arrayBuffer();
    entries
      .get(name)!
      .set(path, new Response(bytes, { status: response.status, headers: response.headers }));
  });
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const client = { id: 'workspace-window', type: 'window', url: `${origin}/` };
  const registration = { scope: `${origin}/` };
  const getClient = vi.fn<(id: string) => Promise<typeof client | null>>(async () => client);
  const source = readFileSync(
    new URL('../../scripts/service-worker-runtime.js', import.meta.url),
    'utf8',
  )
    .replace('__CACHE_NAME__', JSON.stringify(shell))
    .replace('__ASSETS__', JSON.stringify(assets))
    .replace('__LAZY_ASSETS__', JSON.stringify(lazyAssets))
    .replace('__RETIRED_APP_PATHS__', JSON.stringify(retiredAppPaths));
  runInNewContext(source, {
    self: {
      location: { origin },
      registration,
      clients: { get: getClient, claim },
      skipWaiting,
      addEventListener: (name: string, callback: (event: WorkerEvent) => void) =>
        listeners.set(name, callback),
    },
    navigator: {},
    caches: {
      keys: async () => [...entries.keys()],
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
    skipWaiting,
    claim,
    client,
    registration,
    getClient,
    retain: (name: string, path: string, value: string) => {
      if (!entries.has(name)) entries.set(name, new Map());
      entries.get(name)!.set(path, new Response(value));
    },
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
    activate: () => {
      let settled!: Promise<unknown>;
      listeners.get('activate')!({
        waitUntil: (value) => {
          settled = value;
        },
      });
      return settled;
    },
    update: (
      data: { type: string; version?: string },
      source: WorkerEvent['source'] = { id: client.id, type: 'window' },
      withPort = true,
    ) => {
      let settled: Promise<unknown> | undefined;
      const acknowledged = vi.fn();
      listeners.get('message')!({
        data,
        source,
        ports: withPort ? [{ postMessage: acknowledged }] : [],
        waitUntil: (value) => {
          settled = value;
        },
      });
      return { settled, acknowledged };
    },
    request: (path = lazyPath) => {
      let response!: Promise<Response>;
      let settled!: Promise<unknown>;
      listeners.get('fetch')!({
        request: new Request(origin + path),
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

it('keeps private app updates waiting after a complete install and lets the browser activate a first install normally', async () => {
  const runtime = worker(async () => new Response('Complete app'), ['/']);
  await runtime.install();
  expect(await runtime.cached('/')?.text()).toBe('Complete app');
  expect(runtime.skipWaiting).not.toHaveBeenCalled();
  // The browser activates an initial registration automatically when there is
  // no previous active worker; app updates do not force that transition.
  await runtime.activate();
  expect(runtime.claim).toHaveBeenCalledOnce();
  expect(runtime.skipWaiting).not.toHaveBeenCalled();
});

it('exposes the exact static release version without fetching or reading private storage', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const runtime = worker(fetcher);
  const message = runtime.update({ type: 'app-update-info' });
  await message.settled;
  expect(message.acknowledged).toHaveBeenCalledWith({ type: 'app-update-info', version: shell });
  expect(runtime.getClient).toHaveBeenCalledWith('workspace-window');
  expect(fetcher).not.toHaveBeenCalled();
  expect(runtime.put).not.toHaveBeenCalled();
  expect(runtime.skipWaiting).not.toHaveBeenCalled();
});

it('activates only the release explicitly approved by the in-scope window', async () => {
  const runtime = worker(async () => new Response('Complete app'), ['/']);
  await runtime.install();
  const stale = runtime.update({ type: 'app-update-activate', version: 'old-notice' });
  await stale.settled;
  expect(stale.acknowledged).toHaveBeenCalledWith({
    type: 'app-update-error',
    error: 'version-mismatch',
    version: shell,
  });
  expect(runtime.skipWaiting).not.toHaveBeenCalled();
  const approved = runtime.update({ type: 'app-update-activate', version: shell });
  await approved.settled;
  expect(runtime.skipWaiting).toHaveBeenCalledOnce();
  expect(approved.acknowledged).toHaveBeenCalledWith({
    type: 'app-update-activated',
    version: shell,
  });
  expect(runtime.skipWaiting.mock.invocationCallOrder[0]).toBeLessThan(
    approved.acknowledged.mock.invocationCallOrder[0],
  );
  expect(await runtime.cached('/')?.text()).toBe('Complete app');
});

it.each(['serviceworker', 'sharedworker', 'dedicatedworker'])(
  'rejects update requests from a %s rather than a window',
  async (type) => {
    const runtime = worker(async () => new Response('unused'));
    const message = runtime.update(
      { type: 'app-update-activate', version: shell },
      { id: 'source', type },
    );
    await message.settled;
    expect(runtime.getClient).not.toHaveBeenCalled();
    expect(runtime.skipWaiting).not.toHaveBeenCalled();
    expect(message.acknowledged).not.toHaveBeenCalled();
  },
);

it('rejects update activation from a closed, foreign or out-of-scope window and messages without a reply channel', async () => {
  const runtime = worker(async () => new Response('unused'));
  runtime.getClient.mockResolvedValueOnce(null);
  const closed = runtime.update({ type: 'app-update-activate', version: shell });
  await closed.settled;
  expect(closed.acknowledged).not.toHaveBeenCalled();
  runtime.getClient.mockResolvedValueOnce({ ...runtime.client, url: 'https://foreign.example/' });
  const foreign = runtime.update({ type: 'app-update-activate', version: shell });
  await foreign.settled;
  expect(foreign.acknowledged).not.toHaveBeenCalled();
  runtime.registration.scope = `${origin}/workspace/`;
  const outOfScope = runtime.update({ type: 'app-update-activate', version: shell });
  await outOfScope.settled;
  expect(outOfScope.acknowledged).not.toHaveBeenCalled();
  const noPort = runtime.update(
    { type: 'app-update-activate', version: shell },
    runtime.client,
    false,
  );
  expect(noPort.settled).toBeUndefined();
  expect(runtime.skipWaiting).not.toHaveBeenCalled();
});

it('never activates an incomplete public retirement shell after an install failure', async () => {
  const runtime = worker(
    async () => new Response('Missing release asset', { status: 404 }),
    ['/'],
    [],
    'site',
  );
  await expect(runtime.install()).rejects.toThrow('Offline asset failed: /');
  expect(runtime.skipWaiting).not.toHaveBeenCalled();
  expect(runtime.cached('/')).toBeUndefined();
});

it('keeps a previous tab’s cached immutable imports usable offline after another tab updates', async () => {
  const oldPath = '/editor/assets/old-player-ABc_12345.js';
  const oldShell = 'visual-nerve-app-shell-previous1234';
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('Offline');
  });
  const runtime = worker(fetcher);
  runtime.retain(oldShell, oldPath, 'Previous lazy module');
  runtime.retain(oldShell, '/', 'Old app entry');
  runtime.retain(oldShell, '/editor/app.js', 'Old app bundle');
  const response = runtime.request(oldPath);
  expect(await (await response.response).text()).toBe('Previous lazy module');
  await response.settled;
  expect(fetcher).not.toHaveBeenCalled();
  expect(runtime.put).not.toHaveBeenCalled();
  expect(runtime.cached(oldPath)).toBeUndefined();
  expect(runtime.request('/').response).toBeUndefined();
  expect(runtime.request('/editor/app.js').response).toBeUndefined();
});

it('does not serve old hashed imports from another surface or a narration/private cache', async () => {
  const oldPath = '/editor/assets/old-player-ABc_12345.js';
  const fetcher = vi.fn<typeof fetch>(async () => new Response('Online module'));
  const runtime = worker(fetcher);
  runtime.retain('visual-nerve-shell-public123456', oldPath, 'Public surface module');
  runtime.retain('visual-nerve-narration-v1-private', oldPath, 'Private narration');
  const response = runtime.request(oldPath);
  expect(await (await response.response).text()).toBe('Online module');
  await response.settled;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(runtime.put).not.toHaveBeenCalled();
});

it.each([lazyPath, noticePath])(
  'caches lazy %s even when its delivered response is consumed immediately',
  async (path) => {
    const runtime = worker(async () => new Response('native static bytes'), [], [path]);
    const request = runtime.request(path);
    expect(await (await request.response).text()).toBe('native static bytes');
    await request.settled;
    expect(runtime.put).toHaveBeenCalledTimes(1);
    expect(await runtime.cached(path)?.text()).toBe('native static bytes');
  },
);

it.each([lazyPath, noticePath])(
  'keeps Clear fenced until an already-started native %s body/cache write has settled',
  async (path) => {
    const release = deferred<void>();
    const runtime = worker(
      async () => {
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
      },
      [],
      [path],
    );
    const request = runtime.request(path);
    const reading = request.response.then((response) => response.text());
    await vi.waitFor(() => expect(runtime.put).toHaveBeenCalledTimes(1));
    const clearing = runtime.clear();
    expect(clearing.acknowledged).not.toHaveBeenCalled();
    release.resolve();
    expect(await reading).toBe('streamed WASM bytes');
    await request.settled;
    await clearing.settled;
    expect(clearing.acknowledged).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
    expect(await runtime.cached(path)?.text()).toBe('streamed WASM bytes');
    // The page can now delete the old cache: no late native put can repopulate it.
  },
);

it.each([lazyPath, noticePath])(
  'does not publish or cache late %s after Clear revokes its generation',
  async (path) => {
    const fetched = deferred<Response>();
    const started = deferred<void>();
    let signal: AbortSignal | null | undefined;
    const runtime = worker(
      async (_request, options) => {
        signal = options?.signal;
        started.resolve();
        return fetched.promise;
      },
      [],
      [path],
    );
    const request = runtime.request(path);
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
    expect(runtime.cached(path)).toBeUndefined();
    expect(clearing.acknowledged).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
  },
);

it('installs the app core before fetching a notice on demand and reuses its native cached response', async () => {
  const plan = new OfflineAssetPlan({
    surface: 'app',
    assets: ['/editor/app.js', '/licenses/inventory.json', noticePath],
    lazyAssets: [lazyPath],
  });
  const fetcher = vi.fn<typeof fetch>(async (request) => {
    const path = new URL(request instanceof Request ? request.url : String(request), origin)
      .pathname;
    return new Response(path === noticePath ? 'License notice' : 'Core file');
  });
  const runtime = worker(fetcher, plan.assets, plan.lazyAssets);
  await runtime.install();
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(plan.assets);
  expect(runtime.cached(noticePath)).toBeUndefined();
  const first = runtime.request(noticePath);
  expect(await (await first.response).text()).toBe('License notice');
  await first.settled;
  const afterFirst = fetcher.mock.calls.length;
  const second = runtime.request(noticePath);
  expect(await (await second.response).text()).toBe('License notice');
  await second.settled;
  expect(fetcher).toHaveBeenCalledTimes(afterFirst);
  expect(runtime.put).toHaveBeenCalledTimes(plan.assets.length + 1);
  expect(runtime.request('/licenses/unknown-LICENSE').response).toBeUndefined();
});

it('returns a failed lazy notice response without caching it', async () => {
  const runtime = worker(
    async () => new Response('Notice unavailable', { status: 404 }),
    [],
    [noticePath],
  );
  const request = runtime.request(noticePath);
  const response = await request.response;
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('Notice unavailable');
  await request.settled;
  expect(runtime.put).not.toHaveBeenCalled();
  expect(runtime.cached(noticePath)).toBeUndefined();
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
