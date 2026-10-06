import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({
  factory: vi.fn(),
  createSession: vi.fn(),
  run: vi.fn(),
  release: vi.fn(),
  disposals: vi.fn(),
  files: vi.fn(),
  env: { wasm: { numThreads: 0, wasmPaths: '' } },
}));
vi.mock('../src/presentation/speech/model-cache', () => ({ loadVoiceFiles: mocked.files }));
vi.mock('@diffusionstudio/piper-wasm/build/piper_phonemize.js', () => ({
  default: mocked.factory,
}));
vi.mock('onnxruntime-web/wasm', () => ({
  env: mocked.env,
  InferenceSession: { create: mocked.createSession },
  Tensor: class {
    constructor(
      public type: string,
      public data: unknown,
      public dims?: number[],
    ) {}
    dispose() {
      mocked.disposals();
    }
  },
}));
import { PiperEngine, MAX_PHONEMIZER_CALLS } from '../src/presentation/speech/piper-engine';
import { DEFAULT_VOICE_ID } from '../src/presentation/speech/voices';
const config = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'en-gb' },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  speaker_id_map: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
  mocked.files.mockResolvedValue({ model: new ArrayBuffer(8), config });
  mocked.createSession.mockResolvedValue({ run: mocked.run, release: mocked.release });
  mocked.release.mockResolvedValue(undefined);
  mocked.run.mockResolvedValue({
    output: { data: new Float32Array([0.1, 0.2]), dispose: mocked.disposals },
  });
  mocked.factory.mockImplementation(async (options) => ({
    callMain: vi.fn(() => {
      options.print(JSON.stringify({ phoneme_ids: [1, 2, 3] }));
      return 0;
    }),
  }));
});
afterEach(() => vi.unstubAllGlobals());
it('awaits one reusable Emscripten module and ONNX session, disposing all feed/output tensors for every inference', async () => {
  const engine = await PiperEngine.create(
    DEFAULT_VOICE_ID,
    new URL('https://local.test/editor/speech/'),
    vi.fn(),
  );
  expect(mocked.factory).toHaveBeenCalledOnce();
  expect(mocked.createSession).toHaveBeenCalledOnce();
  await engine.prepare('One sentence.', vi.fn());
  await engine.prepare('Another sentence.', vi.fn());
  expect(mocked.factory).toHaveBeenCalledOnce();
  expect(mocked.createSession).toHaveBeenCalledOnce();
  expect(mocked.run).toHaveBeenCalledTimes(2);
  expect(mocked.disposals).toHaveBeenCalledTimes(8);
  const options = mocked.factory.mock.calls[0][0];
  expect(options.noInitialRun).toBe(true);
  expect(options.noExitRuntime).toBe(true);
  expect(options.locateFile('piper_phonemize.data')).toBe(
    'https://local.test/editor/speech/piper_phonemize.data',
  );
  expect(mocked.env.wasm).toEqual({
    numThreads: 1,
    wasmPaths: 'https://local.test/editor/speech/',
  });
  await engine.dispose();
  expect(mocked.release).toHaveBeenCalledOnce();
});
it('rejects phonemizer initialization and releases the already-created ONNX session immediately', async () => {
  mocked.factory.mockRejectedValue(new Error('Pronunciation WASM download failed (404)'));
  await expect(
    PiperEngine.create(DEFAULT_VOICE_ID, new URL('https://local.test/speech/'), vi.fn()),
  ).rejects.toThrow('404');
  expect(mocked.release).toHaveBeenCalledOnce();
  expect(mocked.run).not.toHaveBeenCalled();
});
it('rejects missing phonemizer output rather than waiting forever and cleans feeds after an ONNX rejection', async () => {
  mocked.factory.mockImplementation(async (options) => ({
    callMain: () => {
      options.printErr('Invalid language');
      return 1;
    },
  }));
  let engine = await PiperEngine.create(
    DEFAULT_VOICE_ID,
    new URL('https://local.test/speech/'),
    vi.fn(),
  );
  await expect(engine.prepare('Some narration.', vi.fn())).rejects.toThrow('Invalid language');
  expect(mocked.run).not.toHaveBeenCalled();
  await engine.dispose();
  mocked.factory.mockImplementation(async (options) => ({
    callMain: () => {
      options.print('{"phoneme_ids":[1]}');
      return 0;
    },
  }));
  mocked.run.mockRejectedValue(new Error('ONNX inference failed'));
  engine = await PiperEngine.create(
    DEFAULT_VOICE_ID,
    new URL('https://local.test/speech/'),
    vi.fn(),
  );
  await expect(engine.prepare('Some narration.', vi.fn())).rejects.toThrow('ONNX inference failed');
  expect(mocked.disposals).toHaveBeenCalledTimes(3);
  await engine.dispose();
});

it('bounds retained callMain stack arguments by recycling only the phonemizer, keeping ONNX warm', async () => {
  const engine = await PiperEngine.create(
    DEFAULT_VOICE_ID,
    new URL('https://local.test/speech/'),
    vi.fn(),
  );
  for (let index = 0; index < MAX_PHONEMIZER_CALLS * 2 + 1; index++)
    await engine.prepare('Repeated narration.', vi.fn());
  expect(mocked.factory).toHaveBeenCalledTimes(3);
  expect(mocked.createSession).toHaveBeenCalledOnce();
  expect(mocked.run).toHaveBeenCalledTimes(MAX_PHONEMIZER_CALLS * 2 + 1);
  await engine.dispose();
  expect(mocked.release).toHaveBeenCalledOnce();
});

it('rejects local runtime HTTP errors directly before Emscripten enters its non-rejecting package loader', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('missing', { status: 404 }));
  await expect(
    PiperEngine.create(DEFAULT_VOICE_ID, new URL('https://local.test/speech/'), vi.fn()),
  ).rejects.toThrow('404');
  expect(mocked.factory).not.toHaveBeenCalled();
  expect(mocked.release).toHaveBeenCalledOnce();
});

it('also bounds actual UTF-8/JSON-escaped argv bytes before the call count cap', async () => {
  const engine = await PiperEngine.create(
    DEFAULT_VOICE_ID,
    new URL('https://local.test/speech/'),
    vi.fn(),
  );
  for (let index = 0; index < 16; index++) await engine.prepare('\u0001'.repeat(240), vi.fn());
  expect(mocked.factory.mock.calls.length).toBeGreaterThan(3);
  expect(mocked.createSession).toHaveBeenCalledOnce();
  await engine.dispose();
});
