import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { VOICES, voiceSample } from '../../src/presentation/speech/voices';

// Run every pinned configuration against the shipped pronunciation runtime.
// Config compatibility is independent of the ONNX weights, which are not downloaded here.
test('all catalog voices have compatible local browser pronunciation', async ({ page }) => {
  const assets = readdirSync(new URL('../../../hugo/static/editor/assets/', import.meta.url));
  const runtime = assets.find((name) => /^piper_phonemize-[\w-]+\.js$/.test(name));
  expect(runtime).toBeTruthy();
  const candidates = VOICES.map((voice) => {
    const config = JSON.parse(
      readFileSync(resolve('tests/fixtures/piper-voices', `${voice.id}.config`), 'utf8'),
    ) as {
      espeak: { voice: string };
      num_symbols: number;
      phoneme_id_map: Record<string, number[]>;
    };
    return {
      id: voice.id,
      language: config.espeak.voice,
      text: voiceSample(voice.id),
      symbols: config.num_symbols,
      allowed: [...new Set(Object.values(config.phoneme_id_map).flat())],
    };
  });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/app/');
  const result = await page.evaluate(
    async ({ runtime, candidates }) => {
      const base = new URL('/editor/speech/', location.href).href;
      const runtimeUrl = new URL(`/editor/assets/${runtime}`, location.href).href;
      const [wasm, data] = await Promise.all(
        ['wasm', 'data'].map(async (extension) => {
          const response = await fetch(`${base}piper_phonemize.${extension}`);
          if (!response.ok) throw new Error(`Missing local Piper ${extension}`);
          return response.arrayBuffer();
        }),
      );
      const source = `
        self.process = { versions: { node: 'fake-host-version' } };
        self.onmessage = async ({ data: input }) => {
          const diagnostics = [];
          let phase = 'runtime import';
          try {
            const { default: createPhonemizer } = await import(input.runtimeUrl);
            phase = 'initialize ' + input.language;
            let output;
            const module = await createPhonemizer({
              thisProgram: 'visualnerve-speech',
              wasmBinary: new Uint8Array(input.wasm),
              getPreloadedPackage: () => input.data,
              noInitialRun: true, noExitRuntime: true,
              print: line => { output = JSON.parse(line).phoneme_ids; },
              printErr: line => { diagnostics.push(line); },
              locateFile: name => input.base + (name.endsWith('.data') ? 'piper_phonemize.data' : 'piper_phonemize.wasm'),
            });
            phase = 'pronounce ' + input.language;
            const exit = module.callMain(['-l', input.language, '--input', JSON.stringify([{ text: input.text }]), '--espeak_data', '/espeak-ng-data']);
            if (exit || !Array.isArray(output) || !output.length) throw new Error('No valid phoneme output (exit=' + exit + ')');
            self.postMessage({ kind: 'voice-result', result: output });
          } catch (error) {
            self.postMessage({ kind: 'voice-error', error: phase + ': ' + String(error) + '; stderr=' + diagnostics.slice(-10).join(' | ') });
          }
        };
      `;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const results: { id: string; phonemes: number[] }[] = [];
      try {
        // Reinitialize as production does when changing voice. Terminate each worker
        // before the next configuration so this probe does not retain 20 WASM heaps.
        for (const candidate of candidates) {
          const worker = new Worker(url, { type: 'module' });
          try {
            const phonemes = await new Promise<number[]>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`${candidate.id}: pronunciation worker stalled`)),
                30_000,
              );
              worker.onmessage = ({ data }) => {
                // Emscripten can send intermediate package-loading messages.
                if (data?.kind === 'voice-result') {
                  clearTimeout(timer);
                  resolve(data.result);
                } else if (data?.kind === 'voice-error') {
                  clearTimeout(timer);
                  reject(new Error(`${candidate.id}: ${data.error}`));
                }
              };
              worker.onerror = () => {
                clearTimeout(timer);
                reject(new Error(`${candidate.id}: pronunciation worker failed`));
              };
              worker.postMessage({ ...candidate, wasm, data, base, runtimeUrl });
            });
            results.push({ id: candidate.id, phonemes });
          } finally {
            worker.terminate();
          }
        }
      } finally {
        URL.revokeObjectURL(url);
      }
      return results;
    },
    { runtime: runtime!, candidates },
  );
  expect(result.map((entry) => entry.id)).toEqual(VOICES.map((voice) => voice.id));
  for (const [index, entry] of result.entries()) {
    const candidate = candidates[index];
    expect(entry.phonemes.length, entry.id).toBeGreaterThan(20);
    expect(
      entry.phonemes.every(
        (id) =>
          Number.isInteger(id) &&
          id >= 0 &&
          id < candidate.symbols &&
          candidate.allowed.includes(id),
      ),
      `${entry.id}: phonemes belong to the pinned model alphabet`,
    ).toBe(true);
  }
  expect(requests.some((url) => url.includes('huggingface.co'))).toBe(false);
  expect(requests.some((url) => url.includes('__vite-browser-external'))).toBe(false);
});
