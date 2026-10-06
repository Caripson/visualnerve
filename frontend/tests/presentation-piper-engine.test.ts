import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import {
  PiperEngine,
  loadPiperRuntimeFile,
  splitNarration,
  type PiperBackend,
  type PiperDependencies,
} from '../src/presentation/speech/piper-engine';
import { DEFAULT_VOICE_ID } from '../src/presentation/speech/voices';
const base = new URL('https://example.test/speech/');
const config = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'en-gb' },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
};
function fixture() {
  vi.stubGlobal('Blob', NodeBlob);
  const backend: PiperBackend = {
    phonemize: vi.fn(() => [1, 2, 3]),
    infer: vi.fn(async () => new Float32Array([0.5, -0.5, 0])),
    dispose: vi.fn(async () => undefined),
  };
  const deps: PiperDependencies = {
    files: vi.fn(async () => ({ model: new ArrayBuffer(1), config })),
    backend: vi.fn(async () => backend),
  };
  return { backend, deps };
}
afterEach(() => vi.unstubAllGlobals());
it('preloads the model, ONNX and pronunciation backend once and reuses them for repeated narration', async () => {
  const { backend, deps } = fixture();
  const progress = vi.fn();
  const engine = await PiperEngine.create(DEFAULT_VOICE_ID, base, progress, deps);
  const first = await engine.prepare('Private first narration.', progress);
  await engine.prepare('Next narration.', progress);
  expect(deps.files).toHaveBeenCalledOnce();
  expect(deps.backend).toHaveBeenCalledOnce();
  expect(backend.phonemize).toHaveBeenCalledTimes(2);
  expect(backend.infer).toHaveBeenCalledTimes(2);
  const wav = new DataView(await first.arrayBuffer());
  expect(wav.getUint32(24, true)).toBe(22050);
  expect(wav.getUint32(40, true)).toBe(6);
  expect(wav.getInt16(44, true)).toBe(16383);
  expect(wav.getInt16(46, true)).toBe(-16384);
  await engine.dispose();
  expect(backend.dispose).toHaveBeenCalledOnce();
});
it('rejects initialization errors directly rather than leaving an unresolved phonemizer Promise', async () => {
  const { deps } = fixture();
  vi.mocked(deps.backend).mockRejectedValue(new Error('WASM runtime missing (404)'));
  await expect(PiperEngine.create(DEFAULT_VOICE_ID, base, vi.fn(), deps)).rejects.toThrow('404');
  vi.mocked(deps.files).mockRejectedValue(new Error('SHA mismatch'));
  await expect(PiperEngine.create(DEFAULT_VOICE_ID, base, vi.fn(), deps)).rejects.toThrow('SHA');
});
it('preserves every word and bounds long unbroken tokens rather than truncating descriptions', () => {
  const text = ('alpha beta gamma. ' + 'x'.repeat(1000) + '\nFinal explanation!').repeat(4);
  const chunks = splitNarration(text);
  expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true);
  expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
});
it('reports true completed chunks for single and long narration and merges every PCM in order', async () => {
  const { deps, backend } = fixture();
  const engine = await PiperEngine.create(DEFAULT_VOICE_ID, base, vi.fn(), deps);
  const progress = vi.fn();
  await engine.prepare('One short sentence.', progress);
  expect(progress.mock.calls.map(([value]) => [value.loaded, value.total])).toEqual([
    [0, 1],
    [0, 1],
    [1, 1],
  ]);
  const text = 'A sentence of useful information. '.repeat(50);
  progress.mockClear();
  const chunks = splitNarration(text);
  const wav = await engine.prepare(text, progress);
  expect(wav.size).toBe(44 + chunks.length * 6);
  expect(
    vi
      .mocked(backend.phonemize)
      .mock.calls.slice(1)
      .map(([text]) => text),
  ).toEqual(chunks);
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: 'synthesis', loaded: chunks.length, total: chunks.length }),
  );
});
it('propagates phonemizer and inference failures without claiming ready or continuing later chunks', async () => {
  const { deps, backend } = fixture();
  const engine = await PiperEngine.create(DEFAULT_VOICE_ID, base, vi.fn(), deps);
  vi.mocked(backend.phonemize).mockImplementation(() => {
    throw new Error('No phonemes');
  });
  await expect(engine.prepare('Text', vi.fn())).rejects.toThrow('No phonemes');
  expect(backend.infer).not.toHaveBeenCalled();
  vi.mocked(backend.phonemize).mockReturnValue([1]);
  vi.mocked(backend.infer).mockRejectedValue(new Error('ONNX failed'));
  await expect(engine.prepare('Sentence. '.repeat(50), vi.fn())).rejects.toThrow('ONNX failed');
  expect(backend.infer).toHaveBeenCalledOnce();
});

it('reports real decoded runtime byte movement without inventing percentages for compressed or unknown lengths', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(4));
              controller.enqueue(new Uint8Array(3));
              controller.close();
            },
          }),
          { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '2' } },
        ),
    ),
  );
  const progress = vi.fn();
  await loadPiperRuntimeFile(base, 'piper_phonemize.data', 10, progress);
  expect(progress.mock.calls).toEqual([
    [0, 0],
    [4, 0],
    [7, 0],
    [7, 7],
  ]);
  vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array(11)));
  await expect(loadPiperRuntimeFile(base, 'piper_phonemize.data', 10, vi.fn())).rejects.toThrow(
    'size limit',
  );
});
