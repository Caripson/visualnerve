import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Graph } from '../../src/model/types';
import type { PresentationRuntimeState } from '../../src/presentation/types';
import { acknowledge } from './fixtures';

const app = 'https://public-app.test:4341';
const password = 'Private full-tour browser regression passphrase';
// Route fulfillment must reach the actual Worker network load instead of a
// service-worker cache. Offline/service-worker coverage lives in separate tests.
test.use({ serviceWorkers: 'block' });
type Observation = {
  requests: Array<{ action: string; text?: string }>;
  progress: number[];
  played: Array<{ duration: number; peak: number }>;
};

// Explicit deterministic speech-protocol fixture, not neural Piper acceptance.
// It runs inside a genuine browser Worker; the shipped SpeechService, player,
// clip retention, camera and AudioContext decode/playback are unchanged.
const speechFixture = `
const wait = () => new Promise(resolve => setTimeout(resolve, 40));
self.onmessage = async ({data}) => {
  const progress = loaded => self.postMessage({id:data.id,progress:{
    stage:data.action === 'preload' ? 'loading' : 'synthesis', loaded, total:2,
    message:'Deterministic speech protocol fixture'
  }});
  progress(0); await wait(); progress(1); await wait(); progress(2);
  if(data.action === 'preload') { self.postMessage({id:data.id,ready:true}); return; }
  const rate=22050, count=rate, bytes=new ArrayBuffer(44+count*2), view=new DataView(bytes);
  const tag=(offset,text)=>[...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
  tag(0,'RIFF'); view.setUint32(4,bytes.byteLength-8,true); tag(8,'WAVE'); tag(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); tag(36,'data');
  view.setUint32(40,count*2,true);
  const pitch=220+[...data.text].reduce((sum,char)=>sum+char.charCodeAt(0),0)%220;
  for(let index=0;index<count;index++) view.setInt16(44+index*2,Math.sin(2*Math.PI*pitch*index/rate)*6000,true);
  self.postMessage({id:data.id,ready:true,audio:new Blob([bytes],{type:'audio/wav'})});
};`;

async function csp(page: Page) {
  await page.addInitScript(() => {
    const failures: string[] = [];
    Object.defineProperty(window, '__preloadCsp', { value: failures });
    document.addEventListener('securitypolicyviolation', (event) =>
      failures.push(event.effectiveDirective),
    );
  });
  const response = await page.goto(app);
  expect(response!.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(response!.headers()['content-security-policy']).toContain("worker-src 'self' blob:");
}

async function setup(page: Page, request: APIRequestContext) {
  await csp(page);
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByText('Local connection details', { exact: true }).click();
  await page
    .getByLabel('Local bridge address', { exact: true })
    .fill('wss://127.0.0.1:4329/bridge');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await expect.poll(async () => (await request.get('/api/v1/diagrams')).status()).toBe(200);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

async function api<T>(request: APIRequestContext, path: string, method = 'GET', data?: unknown) {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

test('mocked speech protocol: Preload from the middle covers the whole tour with real browser playback reuse', async ({
  page,
  playwright,
}) => {
  test.setTimeout(150000);
  const assets = resolve('../hugo/static/editor/assets');
  const worker = readdirSync(assets).find(
    (name) =>
      /^worker-[\w-]+\.js$/.test(name) &&
      readFileSync(resolve(assets, name), 'utf8').includes(
        'The voice engine is already preparing audio',
      ),
  );
  expect(worker, 'The real built speech Worker artifact must exist').toBeDefined();
  const workerPath = `/editor/assets/${worker}`;
  await page.route(`**${workerPath}`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: speechFixture }),
  );
  await page.addInitScript(
    ({ workerPath }) => {
      const observed: Observation = { requests: [], progress: [], played: [] };
      Object.defineProperty(window, '__preloadObserved', { value: observed });
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        private tracked: boolean;
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          this.tracked = new URL(String(args[0]), location.href).pathname === workerPath;
        }
        postMessage(
          message: unknown,
          transferOrOptions?: Transferable[] | StructuredSerializeOptions,
        ) {
          const request = message as { action?: string; text?: string };
          if (this.tracked && ['prepare', 'preload'].includes(request.action ?? ''))
            observed.requests.push({ action: request.action!, text: request.text });
          return Array.isArray(transferOrOptions)
            ? super.postMessage(message, transferOrOptions)
            : super.postMessage(message, transferOrOptions);
        }
      };
      const NativeAudioContext = AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        createBufferSource() {
          const source = super.createBufferSource();
          const start = source.start.bind(source);
          source.start = (...args) => {
            const samples = source.buffer?.getChannelData(0) ?? [];
            let peak = 0;
            for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
            observed.played.push({ duration: source.buffer?.duration ?? 0, peak });
            return start(...args);
          };
          return source;
        }
      };
      new MutationObserver(() => {
        const progress = document.querySelector<HTMLProgressElement>(
          '[aria-label="Preload progress"]',
        );
        if (progress && observed.progress.at(-1) !== progress.value)
          observed.progress.push(progress.value);
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    },
    { workerPath },
  );
  const request = await playwright.request.newContext({
    baseURL: 'https://127.0.0.1:4329',
    // Only the synthetic isolated test certificate is untrusted.
    ignoreHTTPSErrors: true,
  });
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'huggingface.co') remote.push(request.url());
  });
  try {
    await setup(page, request);
    const diagram = await api<{ id: string }>(request, '/diagrams', 'POST', {
      name: 'Protected complete tour',
      type: 'process',
    });
    await api(request, `/diagrams/${diagram.id}/bulk`, 'POST', {
      nodes: Array.from({ length: 8 }, (_, index) => ({
        externalId: `step-${index}`,
        title: `Module ${index + 1}`,
        description: `Unique private narration for module ${index + 1}.`,
        x: index * 300,
        y: 100,
        width: 240,
        height: 100,
      })),
      edges: [],
    });
    const graph = await api<Graph>(request, `/diagrams/${diagram.id}`);
    await api(request, `/diagrams/${diagram.id}/presentation`, 'PUT', {
      baseVersion: graph.diagram.version,
      presentation: {
        version: 1,
        nodeIds: graph.nodes.map((node) => node.id),
        secondsPerNode: 30,
        transitionMs: 0,
      },
    });
    await api(request, '/presentation/open', 'POST', { diagramId: diagram.id });
    await api(request, '/presentation/seek', 'POST', { index: 4 });
    const player = page.getByRole('region', { name: 'Diagram player' });
    await expect(player.locator('.presentation-heading')).toContainText('5 / 8');
    await player.getByRole('button', { name: 'Preload presentation', exact: true }).click();
    await expect(player.locator('.presentation-message')).toHaveText(
      'Preload 100% · 8/8 steps ready.',
    );
    await expect(player.getByRole('progressbar', { name: 'Preload progress' })).toHaveJSProperty(
      'value',
      1,
    );
    const prepared = await api<PresentationRuntimeState>(request, '/presentation');
    expect(prepared).toMatchObject({ index: 4, total: 8, buffered: 8, progress: 1 });
    const observed = await page.evaluate(
      () => Reflect.get(window, '__preloadObserved') as Observation,
    );
    expect(
      observed.requests.filter((entry) => entry.action === 'prepare').map((entry) => entry.text),
    ).toEqual(graph.nodes.map((node) => node.description));
    expect(observed.requests.filter((entry) => entry.action === 'preload')).toHaveLength(1);
    expect(observed.progress[0]).toBe(0);
    expect(observed.progress.at(-1)).toBe(1);
    expect(observed.progress.some((value) => value > 0 && value < 1)).toBe(true);
    expect(
      observed.progress.every((value, index) => !index || value >= observed.progress[index - 1]),
    ).toBe(true);
    await player.getByRole('button', { name: 'Presentation audio', exact: true }).click();
    for (let index = 0; index < 8; index++) {
      await api(request, '/presentation/seek', 'POST', { index });
      await player.getByRole('button', { name: 'Play presentation', exact: true }).click();
      await expect(player).toHaveAttribute('data-status', 'playing');
      await player.getByRole('button', { name: 'Pause presentation', exact: true }).click();
    }
    const replayed = await page.evaluate(
      () => Reflect.get(window, '__preloadObserved') as Observation,
    );
    expect(replayed.requests).toEqual(observed.requests);
    expect(replayed.played).toHaveLength(8);
    expect(
      replayed.played.every((entry) => Math.abs(entry.duration - 1) < 0.001 && entry.peak > 0.1),
    ).toBe(true);
    await api(request, '/workspace/lock', 'POST', {});
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    await expect(player).toBeHidden();
    expect((await request.get('/api/v1/presentation')).status()).toBe(423);
    expect(await page.evaluate(() => Reflect.get(window, '__preloadCsp'))).toEqual([]);
    expect(errors).toEqual([]);
    expect(remote).toEqual([]);
  } finally {
    await request.dispose();
  }
});

test('native CacheStorage and WebCrypto retain full-tour overflow only as authenticated disposable ciphertext', async ({
  page,
  playwright,
}) => {
  // This test-only helper bundle is returned by a route fixture, never written
  // into public/public-app or exposed by the shipped app's entry points.
  const compiled = await build({
    stdin: {
      contents: "export {NarrationClipStore} from './src/presentation/speech/clip-store';",
      resolveDir: resolve('.'),
      sourcefile: 'native-narration-probe.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const path = '/editor/assets/__test_native_narration_probe.mjs';
  await page.route(`**${path}`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: compiled.outputFiles[0].text }),
  );
  await csp(page);
  const staticRequest = await playwright.request.newContext({
    // The generated E2E HTTPS certificate/DNS are synthetic; production smoke
    // never uses this exception. API contexts do not inherit Chrome's test flags.
    ignoreHTTPSErrors: true,
  });
  try {
    expect((await staticRequest.get('https://127.0.0.1:4341' + path)).status()).toBe(404);
  } finally {
    await staticRequest.dispose();
  }
  const result = await page.evaluate(async (url) => {
    const { NarrationClipStore } = (await import(
      url
    )) as typeof import('../../src/presentation/speech/clip-store');
    const preserved = await caches.open('unrelated-native-narration-proof');
    await preserved.put('/preserve', new Response('unrelated cache'));
    const original = new NarrationClipStore({ memoryBytes: 0 });
    const fresh = new NarrationClipStore({ memoryBytes: 0 });
    const signal = new AbortController().signal;
    const privateText = 'PRIVATE_BROWSER_NARRATION_WAV_CONTENT';
    const blobs = [
      new Blob([privateText + ' first'], { type: 'audio/wav' }),
      new Blob([privateText + ' later'], { type: 'audio/wav' }),
    ];
    try {
      await original.put('private voice and title one', blobs[0], signal);
      await original.put('private voice and title two', blobs[1], signal);
      const cache = await caches.open(original.cacheName);
      const entries = await cache.keys();
      const encrypted = await cache.match(entries[0]);
      const second = await cache.match(entries[1]);
      const ciphertext = new Uint8Array(await encrypted!.clone().arrayBuffer());
      const opaque = entries.every(
        (entry) =>
          new URL(entry.url).origin === location.origin &&
          !entry.url.includes('private%20voice') &&
          !entry.url.includes('title'),
      );
      const restored = await (await original.get('private voice and title one', signal))!.text();
      await cache.put(entries[0], second!.clone());
      let substitutionRejected = false;
      try {
        await original.get('private voice and title one', signal);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('integrity verification'))
          throw error;
        substitutionRejected = true;
      }
      ciphertext[ciphertext.length - 1] ^= 1;
      await cache.put(entries[0], new Response(ciphertext));
      let tamperRejected = false;
      try {
        await original.get('private voice and title one', signal);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('integrity verification'))
          throw error;
        tamperRejected = true;
      }
      await fresh.put(
        'fresh protected narration',
        new Blob(['fresh WAV'], { type: 'audio/wav' }),
        signal,
      );
      const stats = {
        count: original.size,
        memory: original.memoryBytes,
        spill: original.spillBytes,
      };
      await original.dispose();
      const names = await caches.keys();
      let revoked = false;
      try {
        await original.get('private voice and title two', signal);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
        revoked = true;
      }
      return {
        stats,
        opaque,
        ciphertextBytes: ciphertext.length,
        expectedBytes: blobs[0].size + 28,
        readable: new TextDecoder().decode(ciphertext).includes(privateText),
        restored,
        expected: privateText + ' first',
        substitutionRejected,
        tamperRejected,
        revoked,
        oldRemoved: !names.includes(original.cacheName),
        freshPreserved:
          names.includes(fresh.cacheName) &&
          (await (await fresh.get('fresh protected narration', signal))!.text()) === 'fresh WAV',
        unrelatedPreserved:
          (await (await preserved.match('/preserve'))?.text()) === 'unrelated cache',
      };
    } finally {
      await Promise.all([original.dispose(), fresh.dispose()]);
      await caches.delete('unrelated-native-narration-proof');
    }
  }, app + path);
  expect(result.stats.count).toBe(2);
  expect(result.stats.memory).toBe(0);
  expect(result.stats.spill).toBeGreaterThan(28);
  expect(result.ciphertextBytes).toBe(result.expectedBytes);
  expect(result.restored).toBe(result.expected);
  for (const name of [
    'opaque',
    'substitutionRejected',
    'tamperRejected',
    'revoked',
    'oldRemoved',
    'freshPreserved',
    'unrelatedPreserved',
  ] as const)
    expect(result[name], name).toBe(true);
  expect(result.readable).toBe(false);
  expect(await page.evaluate(() => Reflect.get(window, '__preloadCsp'))).toEqual([]);
});
