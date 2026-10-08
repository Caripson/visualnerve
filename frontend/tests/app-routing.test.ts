// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { deferred } from './app-cache-fixture';

const generator = readFileSync(
  new URL('../../scripts/service-worker.mjs', import.meta.url),
  'utf8',
);
const origin = 'https://visualnerve.example.com';

function worker(editor = 'editor workspace') {
  const directory = mkdtempSync(join(tmpdir(), 'visual-nerve-app-route-'));
  try {
    const fixture: Record<string, string> = {
      'index.html': 'public product home',
      'app/index.html': editor,
      'appearance.js': 'appearance',
      'error.html': 'error page',
      'privacy/index.html': 'privacy',
      'license/index.html': 'license',
      'features/index.html': 'features',
      'mcp/index.html': 'public MCP setup page',
      'api/docs/index.html': 'API reference',
      'help/index.html': 'help',
      'help/index.json': '{"version":1,"guides":[]}',
      'help/images/mcp-settings.webp': 'static help image',
      'site/site.css': 'public styles',
      'site/vendor/klaro.js': 'local consent library',
      'editor/app.js': 'native editor',
      'editor/app.css': 'editor styles',
      'editor/speech/voice.onnx': 'large optional voice',
    };
    for (const [path, content] of Object.entries(fixture)) {
      const target = join(directory, 'public', path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const script = join(directory, 'scripts/service-worker.mjs');
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, generator);
    copyFileSync(
      new URL('../../scripts/service-worker-runtime.js', import.meta.url),
      join(dirname(script), 'service-worker-runtime.js'),
    );
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    const source = readFileSync(join(directory, 'public/sw.js'), 'utf8');
    const handlers = new Map<string, (event: any) => void>();
    const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn(), put: vi.fn() };
    const open = vi.fn(async (name: string) =>
      name === 'visual-nerve-cache-control-v1' ? { match: async () => undefined } : cache,
    );
    const fetch = vi.fn().mockResolvedValue(new Response('network asset'));
    const claim = vi.fn().mockResolvedValue(undefined);
    const pending: Promise<unknown>[] = [];
    const context: any = {
      URL,
      AbortController,
      DOMException,
      fetch,
      caches: { open },
      self: {
        location: { origin },
        clients: { claim },
        addEventListener: (name: string, listener: (event: any) => void) =>
          handlers.set(name, listener),
      },
    };
    runInNewContext(`${source}\nglobalThis.manifest = {cacheName, assets, lazyAssets};`, context);
    function request(path: string, method = 'GET', host = origin) {
      let response: Promise<unknown> | undefined;
      handlers.get('fetch')!({
        request: { url: new URL(path, host).href, method },
        respondWith: (value: Promise<unknown>) => {
          response = value;
        },
        waitUntil: (value: Promise<unknown>) => {
          pending.push(value);
        },
      });
      return response;
    }
    return {
      source,
      manifest: context.manifest,
      handlers,
      cache,
      open,
      fetch,
      claim,
      request,
      pending,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('public home and editor offline routing', () => {
  it('caches both page shells and local public assets after installation, keeping voice models lazy', async () => {
    const runtime = worker();
    let installed: Promise<unknown> | undefined;
    runtime.handlers.get('install')!({
      waitUntil: (value: Promise<unknown>) => {
        installed = value;
      },
    });
    await installed;
    expect(runtime.fetch.mock.calls.map(([path]) => path)).toEqual(runtime.manifest.assets);
    expect(runtime.cache.put.mock.calls.map(([path]) => path)).toEqual(runtime.manifest.assets);
    expect(runtime.manifest.assets).toEqual(
      expect.arrayContaining([
        '/',
        '/app/',
        '/features/',
        '/mcp/',
        '/site/site.css',
        '/site/vendor/klaro.js',
        '/help/images/mcp-settings.webp',
        '/help/index.json',
        '/editor/app.js',
      ]),
    );
    expect(runtime.manifest.assets).not.toContain('/api/docs/');
    expect(runtime.manifest.assets).not.toContain('/editor/speech/voice.onnx');
    expect(runtime.manifest.lazyAssets).toEqual(['/editor/speech/voice.onnx']);
  });

  it('serves editor aliases from the same cached editor shell while home aliases stay public', async () => {
    const runtime = worker();
    runtime.cache.match.mockImplementation(async (path: string) =>
      path === '/app/' ? 'editor workspace' : path === '/' ? 'public product home' : undefined,
    );
    for (const path of ['/app', '/app/', '/app/index.html', '/app/?demo=kiosk'])
      expect(await runtime.request(path)).toBe('editor workspace');
    for (const path of ['/', '/index.html', '/?utm_source=example'])
      expect(await runtime.request(path)).toBe('public product home');
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('never intercepts live commands, uploads or other origins; static MCP marketing is a distinct GET page', async () => {
    const runtime = worker();
    for (const path of [
      '/api/v1/health',
      '/api/v1/diagrams',
      '/api/docs/',
      '/mcp',
      '/bridge',
      '/diagrams',
    ])
      expect(runtime.request(path)).toBeUndefined();
    for (const path of ['/', '/app/', '/mcp', '/mcp/'])
      expect(runtime.request(path, 'POST')).toBeUndefined();
    expect(runtime.request('/app/', 'GET', 'https://external.example')).toBeUndefined();
    expect(runtime.open).not.toHaveBeenCalled();
    runtime.cache.match.mockResolvedValue('public MCP setup page');
    expect(await runtime.request('/mcp/')).toBe('public MCP setup page');
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('changes its cache revision when the editor shell changes and preserves storage outside the static cache', () => {
    const before = worker('before editor'),
      after = worker('after editor');
    expect(before.manifest.cacheName).not.toBe(after.manifest.cacheName);
    expect(after.source).not.toMatch(/indexedDB|deleteDatabase|localStorage|caches\.delete/);
  });

  it('aborts lazy asset downloads and acknowledges only when all work has stopped', async () => {
    const runtime = worker();
    runtime.fetch.mockImplementation(
      (_request, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason));
        }),
    );
    const response = runtime.request('/editor/speech/voice.onnx')!.catch((error) => error);
    await vi.waitFor(() => expect(runtime.fetch).toHaveBeenCalledOnce());
    const ready = vi.fn();
    let stopping!: Promise<unknown>;
    runtime.handlers.get('message')!({
      data: { type: 'app-cache-clear', begin: true },
      ports: [{ postMessage: ready }],
      waitUntil: (value: Promise<unknown>) => {
        stopping = value;
      },
    });
    await stopping;
    expect(await response).toMatchObject({ name: 'AbortError' });
    expect(runtime.cache.put).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
    runtime.cache.match.mockResolvedValue('cached editor');
    const paused = await runtime.request('/app/')!.catch((error) => error);
    expect(paused).toMatchObject({ name: 'AbortError' });
    runtime.handlers.get('message')!({
      data: { type: 'app-cache-clear', begin: false },
      ports: [{ postMessage: ready }],
      waitUntil: (value: Promise<unknown>) => {
        stopping = value;
      },
    });
    await stopping;
    expect(await runtime.request('/app/')).toBe('cached editor');
  });

  it('waits for already-started cache writes before reporting a clear barrier ready', async () => {
    const runtime = worker(),
      writing = deferred(),
      release = deferred();
    runtime.cache.put.mockImplementation(async () => {
      writing.resolve();
      await release.promise;
    });
    const response = runtime.request('/editor/speech/voice.onnx');
    await response;
    await writing.promise;
    const ready = vi.fn();
    let stopping!: Promise<unknown>;
    runtime.handlers.get('message')!({
      data: { type: 'app-cache-clear', begin: true },
      ports: [{ postMessage: ready }],
      waitUntil: (value: Promise<unknown>) => {
        stopping = value;
      },
    });
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    release.resolve();
    await stopping;
    expect(ready).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
    await Promise.allSettled(runtime.pending);
  });

  it('keeps an uncached shell download abortable after its headers have arrived', async () => {
    const runtime = worker();
    let signal!: AbortSignal;
    runtime.fetch.mockImplementation(async (_request, options) => {
      signal = options.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
        }),
      );
    });
    const response = (await runtime.request('/app/')) as Response;
    const ready = vi.fn();
    let stopping!: Promise<unknown>;
    runtime.handlers.get('message')!({
      data: { type: 'app-cache-clear', begin: true },
      ports: [{ postMessage: ready }],
      waitUntil: (value: Promise<unknown>) => {
        stopping = value;
      },
    });
    await stopping;
    expect(signal.aborted).toBe(true);
    expect(ready).toHaveBeenCalledWith({ type: 'app-cache-ready', begin: true });
    await expect(response.arrayBuffer()).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtime.cache.put).not.toHaveBeenCalled();
    await Promise.allSettled(runtime.pending);
  });
});
