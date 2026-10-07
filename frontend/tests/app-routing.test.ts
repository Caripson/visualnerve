// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

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
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    const source = readFileSync(join(directory, 'public/sw.js'), 'utf8');
    const handlers = new Map<string, (event: any) => void>();
    const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn(), put: vi.fn() };
    const open = vi.fn().mockResolvedValue(cache);
    const fetch = vi.fn().mockResolvedValue(new Response('network asset'));
    const claim = vi.fn().mockResolvedValue(undefined);
    const context: any = {
      URL,
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
      });
      return response;
    }
    return { source, manifest: context.manifest, handlers, cache, open, fetch, claim, request };
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
    expect(runtime.cache.addAll).toHaveBeenCalledWith(runtime.manifest.assets);
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
});
