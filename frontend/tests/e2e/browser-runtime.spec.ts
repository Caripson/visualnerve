import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Exercise the generated browser worker artifact and the actual local WASM/data,
// with no voice-model download or mocked phonemes. This catches bundler regressions.
test('Piper pronounces English and Swedish in a browser worker without Node shims', async ({
  page,
}) => {
  const assets = readdirSync(new URL('../../../hugo/static/editor/assets/', import.meta.url));
  const runtime = assets.find((name) => /^piper_phonemize-[\w-]+\.js$/.test(name));
  expect(runtime).toBeTruthy();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/app/');
  const phonemes = await page.evaluate(async (file) => {
    const source = `
      // A host may expose a process shim. The browser runtime must still use Web Crypto.
      self.process = { versions: { node: 'fake-host-version' } };
      let phase = 'runtime import';
      const diagnostics = [];
      (async () => {
        const { default: createPhonemizer } = await import(${JSON.stringify(new URL(`/editor/assets/${file}`, location.href).href)});
        phase = 'local runtime files';
        const [wasm, data] = await Promise.all(['wasm', 'data'].map(async extension => {
          const response = await fetch(${JSON.stringify(location.origin)} + '/editor/speech/piper_phonemize.' + extension);
          if (!response.ok) throw new Error('Missing local Piper ' + extension);
          return response.arrayBuffer();
        }));
        const result = [];
        // Verified against the pinned voice configurations and hashes in voices.ts:
        // Alan uses en-gb-x-rp, NST uses sv. Production reinitializes on voice change.
        for (const [language, text] of [['en-gb-x-rp', 'Understand how the project fits together.'], ['sv', 'Förstå hur projektets delar hänger ihop.']]) {
          phase = 'initialize ' + language;
          let output;
          const module = await createPhonemizer({
            thisProgram: 'visualnerve-speech',
            wasmBinary: new Uint8Array(wasm),
            getPreloadedPackage: () => data,
            noInitialRun: true, noExitRuntime: true,
            print: line => { output = JSON.parse(line).phoneme_ids; },
            // Production collects stderr; throwing here changes WASM error handling.
            printErr: line => { diagnostics.push(phase + ': ' + line); },
            locateFile: name => ${JSON.stringify(location.origin)} + '/editor/speech/' + (name.endsWith('.data') ? 'piper_phonemize.data' : 'piper_phonemize.wasm'),
          });
          phase = 'phonemize ' + language;
          const exit = module.callMain(['-l', language, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
          if (exit || !Array.isArray(output)) throw new Error('Phonemization failed (exit=' + exit + ')');
          result.push(output);
        }
        self.postMessage({ kind: 'phonemizer-result', result });
      })().catch(error => self.postMessage({ kind: 'phonemizer-error', error: phase + ': ' + (error instanceof Error ? error.message : String(error)) + '; stderr=' + diagnostics.slice(-10).join(' | ') }));
    `;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise<number[][]>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Piper worker stalled')), 30000);
        worker.onmessage = ({ data }) => {
          if (data?.kind === 'phonemizer-error') {
            clearTimeout(timer);
            reject(new Error(data.error));
          } else if (data?.kind === 'phonemizer-result') {
            clearTimeout(timer);
            if (!Array.isArray(data.result)) reject(new Error('Piper returned no phoneme arrays'));
            else resolve(data.result);
          }
        };
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Piper browser worker failed'));
        };
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, runtime!);
  expect(phonemes).toHaveLength(2);
  for (const result of phonemes) {
    expect(result.length).toBeGreaterThan(20);
    expect(result.every(Number.isInteger)).toBeTruthy();
  }
  expect(phonemes[0]).not.toEqual(phonemes[1]);
  expect(requests.some((url) => url.includes('huggingface.co'))).toBeFalsy();
  expect(requests.some((url) => url.includes('__vite-browser-external'))).toBeFalsy();
});
