// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { APP_PRECACHE_LICENSE_PATHS, OfflineAssetPlan } from '../../scripts/offline-asset-plan.mjs';
import { buildServiceWorker } from '../../scripts/service-worker.mjs';

const speech = [
  '/editor/speech/ort-wasm-simd.wasm',
  '/editor/speech/ort-wasm.wasm',
  '/editor/speech/piper_phonemize.data',
  '/editor/speech/piper_phonemize.wasm',
];
const core = [
  '/',
  '/workspace-navigation.js',
  '/editor/app.js',
  '/editor/assets/private-workspace.js',
  '/help/',
  '/help/help.js',
  '/help/images/editor.webp',
  '/api/docs/',
  '/swagger/swagger-ui-bundle.js',
  '/license/',
  ...APP_PRECACHE_LICENSE_PATHS,
];
const notices = ['/licenses/dependency-LICENSE', '/licenses/dependency-NOTICE'];
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-offline-plan-'));
  temporary.push(directory);
  const assets = [...core, ...notices, ...speech];
  const put = (path: string, contents: string) => {
    const file = join(directory, path.endsWith('/') ? path + 'index.html' : path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  for (const path of assets) put(path, `Public file: ${path}`);
  return { directory, assets, put };
}

it('partitions the app inventory completely and disjointly, preserving core notices and speech laziness', () => {
  const inventory = [...core, ...notices, ...speech];
  const plan = new OfflineAssetPlan({
    surface: 'app',
    assets: [...inventory, notices[0], core[0]],
    lazyAssets: [...speech, speech[0], ...APP_PRECACHE_LICENSE_PATHS],
  });
  expect(plan.assets).toEqual(core);
  expect(plan.lazyAssets).toEqual([...speech, ...notices]);
  expect(new Set(plan.inventory)).toEqual(new Set(inventory));
  expect(plan.inventory).toHaveLength(inventory.length);
  expect(plan.assets.filter((path) => plan.lazyAssets.includes(path))).toEqual([]);
  expect(APP_PRECACHE_LICENSE_PATHS).toHaveLength(9);
  expect(plan.assets).toContain('/licenses/inventory.json');
  expect(plan.assets).toContain('/licenses/visualnerve-LICENSE');
  expect(plan.assets).toContain('/licenses/visualnerve-NOTICE');
  expect(plan.assets).toContain('/licenses/espeak-ng-NOTICE');
  expect(plan.assets).toContain('/licenses/piper-phonemize-NOTICE');
});

it('does not add hundreds of dependency notice requests to app installation', () => {
  const dependencyNotices = Array.from(
    { length: 347 },
    (_, index) => `/licenses/dependency-${index}-LICENSE`,
  );
  const plan = new OfflineAssetPlan({
    surface: 'app',
    assets: [...core, ...dependencyNotices],
    lazyAssets: speech,
  });
  expect(plan.assets).toEqual(core);
  expect(plan.lazyAssets).toEqual([...speech, ...dependencyNotices]);
  expect(plan.inventory).toHaveLength(core.length + dependencyNotices.length + speech.length);
});

it('keeps explicitly managed site notices precached and existing speech assets lazy', () => {
  const plan = new OfflineAssetPlan({
    surface: 'site',
    assets: [...core, '/app/', ...notices, ...speech],
    lazyAssets: speech,
  });
  expect(plan.assets).toEqual([...core, '/app/', ...notices]);
  expect(plan.lazyAssets).toEqual(speech);
});

it.each([
  'https://other.test/license',
  '//other.test/license',
  '/licenses/../private',
  '/file?x=1',
  '/file#x',
  '/file\\private',
])('rejects nonlocal or ambiguous managed path %s', (path) => {
  expect(() => new OfflineAssetPlan({ assets: [path] })).toThrow('exact local paths');
  expect(() => new OfflineAssetPlan({ assets: core, lazyAssets: [path] })).toThrow(
    'exact local paths',
  );
});

it('generates a complete worker plan while preserving every bundled notice on disk', () => {
  const { directory, assets } = fixture();
  const plan = buildServiceWorker(directory, { surface: 'app', assets });
  expect(plan.assets).toEqual(core);
  expect(new Set(plan.lazyAssets)).toEqual(new Set([...notices, ...speech]));
  const source = readFileSync(join(directory, 'sw.js'), 'utf8');
  const installed = JSON.parse(source.match(/^const assets = (.*);$/m)![1]);
  const lazy = JSON.parse(source.match(/^const lazyAssets = (.*);$/m)![1]);
  expect(installed).toEqual(core);
  expect(new Set([...installed, ...lazy])).toEqual(new Set(assets));
  for (const path of notices)
    expect(readFileSync(join(directory, path), 'utf8')).toBe(`Public file: ${path}`);
});

it('changes the cache revision when an unopened dependency notice or lazy speech asset changes', () => {
  const { directory, assets, put } = fixture();
  const first = buildServiceWorker(directory, { surface: 'app', assets });
  put(notices[0], 'Updated unopened license notice');
  const second = buildServiceWorker(directory, { surface: 'app', assets });
  expect(second.cacheName).not.toBe(first.cacheName);
  expect(second.assets).toEqual(first.assets);
  expect(second.lazyAssets).toEqual(first.lazyAssets);
  put(speech[0], 'Updated optional speech runtime');
  const third = buildServiceWorker(directory, { surface: 'app', assets });
  expect(third.cacheName).not.toBe(second.cacheName);
  rmSync(join(directory, notices[1]));
  expect(() => buildServiceWorker(directory, { surface: 'app', assets })).toThrow(/ENOENT/);
});
