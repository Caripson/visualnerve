// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compilePiperBrowser, piperBrowserRuntime, vendorChunk } from '../build/browser-runtime';

it('compiles the actual pinned Piper browser/worker paths without Node builtins', async () => {
  const path = 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js';
  const source = readFileSync(path, 'utf8');
  expect(source).toContain('require("fs")');
  const result = await compilePiperBrowser(source, path);
  expect(result.code).not.toMatch(/require\(["'](?:fs|path|crypto)["']\)/);
  expect(result.code).toContain('crypto.getRandomValues');
  expect(result.code).toContain('WebAssembly');
  expect(result.code).toContain('getPreloadedPackage');
  expect(result.code).toContain('callMain');
  expect(result.code).toContain('export default createPiperPhonemize');
  expect(result.code).not.toContain('module.exports');
});
it('fails an unreviewed Piper platform upgrade rather than silently stripping unknown code', async () => {
  await expect(compilePiperBrowser('export default () => {};', 'piper.js')).rejects.toThrow(
    'platform detection changed',
  );
});
it('only specializes Piper rather than overriding Node detection globally', async () => {
  const plugin = piperBrowserRuntime();
  const transform = plugin.transform as (source: string, id: string) => unknown;
  expect(transform('require("fs")', '/node_modules/other-package/runtime.js')).toBeUndefined();
});
it('keeps optional application modules out of vendor chunks and separates Three core/rendering', () => {
  expect(vendorChunk('/x/node_modules/react-dom/client.js')).toBe('react-runtime');
  expect(vendorChunk('/x/node_modules/@xyflow/react/dist/index.js')).toBe('canvas-runtime');
  expect(vendorChunk('/x/node_modules/dexie/dist/dexie.mjs')).toBe('local-storage');
  expect(vendorChunk('/x/node_modules/three/build/three.core.js')).toBe('spatial-core');
  expect(vendorChunk('/x/node_modules/three/build/three.module.js')).toBe('spatial-renderer');
  expect(vendorChunk('/x/node_modules/three/examples/jsm/controls/OrbitControls.js')).toBe(
    'spatial-renderer',
  );
  expect(vendorChunk('/x/src/code/analyzer.ts')).toBeUndefined();
  expect(vendorChunk('/x/src/presentation/service.ts')).toBeUndefined();
  expect(vendorChunk('/x/node_modules/jspdf/dist/jspdf.es.min.js')).toBeUndefined();
});
