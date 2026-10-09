// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { PublicWorkspaceRetirement } from '../../scripts/retire-public-workspace.mjs';
import { buildServiceWorker } from '../../scripts/service-worker.mjs';

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-retired-workspace-'));
  temporary.push(directory);
  mkdirSync(join(directory, 'editor'));
  mkdirSync(join(directory, 'app'));
  writeFileSync(join(directory, 'index.html'), 'Current root');
  writeFileSync(join(directory, 'app/index.html'), 'Previous editor shell');
  return directory;
}

it('retires only the generated legacy shell, preserves other files, and rejects a symlink escape', () => {
  const directory = fixture();
  writeFileSync(join(directory, 'editor/app.js'), 'Reviewed application module');
  const retirement = new PublicWorkspaceRetirement(directory);
  expect(() => retirement.audit()).toThrow('retired /app');
  expect(retirement.retire()).toBe(true);
  expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe('Current root');
  expect(readFileSync(join(directory, 'editor/app.js'), 'utf8')).toBe(
    'Reviewed application module',
  );
  expect(retirement.retire()).toBe(true);
  const outside = fixture();
  symlinkSync(join(outside, 'app'), join(directory, 'app'), 'dir');
  expect(() => retirement.retire()).toThrow('symlink');
  expect(readFileSync(join(outside, 'app/index.html'), 'utf8')).toBe('Previous editor shell');
});

function worker(surface: 'site' | 'app', retireAppPaths = true) {
  const directory = fixture();
  const plan = buildServiceWorker(directory, { surface, assets: ['/', '/app/'], retireAppPaths });
  const listeners = new Map<string, (event: any) => void>();
  const cacheMatch = vi.fn(async () => new Response('Old cached editor shell'));
  const cachePut = vi.fn(async () => undefined);
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const fetch = vi.fn(async (_path: RequestInfo | URL) => new Response('Current root'));
  const context = {
    Response,
    URL,
    AbortController,
    DOMException,
    fetch,
    caches: {
      open: async (name: string) => ({
        match: name === 'visual-nerve-cache-control-v1' ? async () => undefined : cacheMatch,
        put: cachePut,
      }),
    },
    self: {
      location: {
        origin: surface === 'app' ? 'https://app.visualnerve.com' : 'https://www.visualnerve.com',
      },
      skipWaiting,
      clients: { claim },
      addEventListener: (name: string, listener: (event: any) => void) =>
        listeners.set(name, listener),
    },
  };
  const source = readFileSync(join(directory, 'sw.js'), 'utf8');
  runInNewContext(source, context);
  return {
    source,
    plan,
    cacheMatch,
    cachePut,
    skipWaiting,
    fetch,
    request(path: string, method = 'GET', origin = context.self.location.origin) {
      let response: Promise<Response> | undefined;
      listeners.get('fetch')!({
        request: { url: origin + path, method },
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
        waitUntil: () => undefined,
      });
      return response;
    },
    install() {
      let response: Promise<unknown> | undefined;
      listeners.get('install')!({
        waitUntil: (value: Promise<unknown>) => {
          response = value;
        },
      });
      return response;
    },
  };
}

it('production website worker redirects every retired alias before any historical cache lookup without leaking a query', async () => {
  const runtime = worker('site');
  expect(runtime.plan.assets).toEqual(['/']);
  for (const path of ['/app', '/app/', '/app/index.html', '/app/nested?private=must-not-travel']) {
    const result = await runtime.request(path);
    expect(result?.status).toBe(308);
    expect(result?.headers.get('location')).toBe('https://app.visualnerve.com/');
  }
  expect(runtime.cacheMatch).not.toHaveBeenCalled();
  expect(runtime.fetch).not.toHaveBeenCalled();
  expect(runtime.request('/app/', 'POST')).toBeUndefined();
  expect(runtime.request('/app/', 'GET', 'https://other.example')).toBeUndefined();
  expect(runtime.request('/application')).toBeUndefined();
  expect(runtime.source).not.toMatch(/indexedDB|deleteDatabase|localStorage|caches\.delete/);
});

it('isolated worker returns an actual 404 for retired aliases even if an old editor cache exists', async () => {
  const runtime = worker('app');
  for (const path of ['/app', '/app/', '/app/index.html', '/app/nested']) {
    const result = await runtime.request(path);
    expect(result?.status).toBe(404);
    expect(result?.headers.get('location')).toBeNull();
    expect(result?.headers.get('cache-control')).toBe('no-store');
    expect(await result?.text()).not.toContain('Old cached editor shell');
  }
  expect(runtime.cacheMatch).not.toHaveBeenCalled();
  expect(runtime.fetch).not.toHaveBeenCalled();
  expect(await (await runtime.request('/'))?.text()).toBe('Old cached editor shell');
});

it('activates retirement only after the new public assets have installed and preserves explicit development routing', async () => {
  const retired = worker('site');
  await retired.install();
  expect(retired.fetch.mock.calls.map(([path]) => path)).toEqual(['/']);
  expect(retired.cachePut).toHaveBeenCalledOnce();
  expect(retired.skipWaiting).toHaveBeenCalledOnce();
  expect(retired.cachePut.mock.invocationCallOrder[0]).toBeLessThan(
    retired.skipWaiting.mock.invocationCallOrder[0],
  );
  const development = worker('site', false);
  expect(development.plan.assets).toContain('/app/');
  expect(await (await development.request('/app/'))?.text()).toBe('Old cached editor shell');
  await development.install();
  expect(development.skipWaiting).not.toHaveBeenCalled();
});

it('CloudFront retirement uses 308 on the public site and 404 on the isolated app, rejects writes and leaves neighboring routes untouched', () => {
  const source = readFileSync(
    new URL('../../deployment/viewer-request.js', import.meta.url),
    'utf8',
  );
  const route = (host: string, uri: string, method = 'GET', requestHost = host) =>
    runInNewContext(source.replace('__CANONICAL_HOST__', host) + '\nhandler(event)', {
      event: {
        request: {
          method,
          uri,
          headers: { host: { value: requestHost } },
          querystring: { secret: { value: 'never-forward' } },
        },
      },
    });
  for (const uri of ['/app', '/app/', '/app/index.html', '/app/nested']) {
    for (const method of ['GET', 'HEAD']) {
      expect(route('www.visualnerve.com', uri, method).statusCode).toBe(308);
      expect(route('www.visualnerve.com', uri, method).headers.location.value).toBe(
        'https://app.visualnerve.com/',
      );
      expect(route('app.visualnerve.com', uri, method).statusCode).toBe(404);
      expect(route('www.visualnerve.com', uri, method, 'visualnerve.com')).toMatchObject({
        statusCode: 308,
        headers: { location: { value: 'https://app.visualnerve.com/' } },
      });
    }
    expect(route('www.visualnerve.com', uri, 'POST').statusCode).toBe(405);
  }
  expect(route('app.visualnerve.com', '/').uri).toBe('/index.html');
  expect(route('www.visualnerve.com', '/application').uri).toBe('/application/index.html');
});
