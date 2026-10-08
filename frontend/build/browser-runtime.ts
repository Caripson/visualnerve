import { transformWithEsbuild, type Plugin } from 'vite';

const runtimePath = '/node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js';
const exportFooter = `if (typeof exports === 'object' && typeof module === 'object')
  module.exports = createPiperPhonemize;
else if (typeof define === 'function' && define['amd'])
  define([], () => createPiperPhonemize);`;
const nodeDetection =
  'var ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string";';

/** Compile the pinned Emscripten runtime for the browser, before resolving CommonJS requires. */
export async function compilePiperBrowser(source: string, filename: string) {
  // Piper 1.0.0 supports both Node and browsers in one generated file. Its Node-only
  // file/package/random branches cannot run in our browser worker. Specialize those
  // guards rather than installing filesystem/crypto shims or suppressing warnings.
  if (source.split(nodeDetection).length !== 2 || source.split(exportFooter).length !== 2)
    throw new Error(
      'Piper platform detection changed. Review its browser adapter before upgrading.',
    );
  const browser = source
    .replace(nodeDetection, '')
    .replace(/\bENVIRONMENT_IS_NODE\b/g, 'false')
    // Native ESM also works in Vite development, where excluded dependencies are
    // not passed through Rollup's production-only CommonJS conversion.
    .replace(exportFooter, 'export default createPiperPhonemize;');
  const result = await transformWithEsbuild(browser, filename, {
    loader: 'js',
    minifySyntax: true,
    define: { process: 'undefined', __dirname: 'undefined', __filename: 'undefined' },
  });
  if (/require\(["'](?:fs|path|crypto)["']\)/.test(result.code))
    throw new Error('Piper still contains Node imports. Its browser adapter needs review.');
  return result;
}

export function piperBrowserRuntime(): Plugin {
  return {
    name: 'visualnerve-piper-browser-runtime',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith(runtimePath)) return;
      return compilePiperBrowser(source, id).then((result) => ({
        code: result.code,
        map: JSON.stringify(result.map),
      }));
    },
  };
}

/** Cache independent runtime libraries; optional feature code retains its real lazy boundaries. */
export function vendorChunk(id: string) {
  const path = id.replaceAll('\\', '/');
  if (!path.includes('/node_modules/')) return;
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react-runtime';
  if (/\/node_modules\/(?:@xyflow\/[^/]+|d3-[^/]+)\//.test(path)) return 'canvas-runtime';
  if (path.includes('/node_modules/dexie/')) return 'local-storage';
  if (path.includes('/node_modules/three/build/three.core.js')) return 'spatial-core';
  if (path.includes('/node_modules/three/')) return 'spatial-renderer';
}
