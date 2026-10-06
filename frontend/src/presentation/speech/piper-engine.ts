import { loadVoiceFiles } from './model-cache';
import type { SpeechProgress } from './protocol';
import { voiceInfo, type VoiceId } from './voices';

// Piper feed/chunk/WAV adapter adapted from Mintplex Piper TTS Web 1.0.5 (MIT).
// The upstream MIT notice is distributed in third_party/licenses/piper-tts-web.
type Progress = (value: SpeechProgress) => void;
export type PiperConfig = {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map?: Record<string, number>;
};
export interface PiperBackend {
  phonemize(text: string, progress?: Progress): number[] | Promise<number[]>;
  infer(phonemes: number[]): Promise<Float32Array>;
  dispose(): Promise<void>;
}
export interface PiperDependencies {
  files: typeof loadVoiceFiles;
  backend(
    model: ArrayBuffer,
    config: PiperConfig,
    base: URL,
    progress: Progress,
  ): Promise<PiperBackend>;
}
export const MAX_CHUNK_CHARACTERS = 240;
export const MAX_PHONEMIZER_CALLS = 32;
export const MAX_PHONEMIZER_ARG_BYTES = 8 * 1024;
const PIPER_PROGRAM = 'visualnerve-speech';
export function phonemizerArgumentBytes(args: string[]) {
  const encoded = new TextEncoder();
  const aligned = (bytes: number) => (bytes + 15) & ~15;
  return (
    aligned((args.length + 2) * 4) +
    [PIPER_PROGRAM, ...args].reduce((sum, arg) => sum + aligned(encoded.encode(arg).length + 1), 0)
  );
}
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

/** Sentence/word boundaries where possible; long tokens are also bounded. Nothing is truncated. */
export function splitNarration(text: string, bound = MAX_CHUNK_CHARACTERS): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > bound) {
    const window = remaining.slice(0, bound + 1);
    const sentence = [...window.matchAll(/[.!?…]\s|\n/g)].at(-1);
    const whitespace = window.lastIndexOf(' ');
    const end =
      sentence && sentence.index! >= bound / 3
        ? sentence.index! + 1
        : whitespace >= bound / 3
          ? whitespace
          : bound;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
function configValue(value: unknown): PiperConfig {
  const config = value as PiperConfig;
  if (
    !config ||
    !Number.isInteger(config.audio?.sample_rate) ||
    config.audio.sample_rate < 8000 ||
    config.audio.sample_rate > 48000 ||
    !config.espeak?.voice ||
    ![
      config.inference?.noise_scale,
      config.inference?.length_scale,
      config.inference?.noise_w,
    ].every(Number.isFinite)
  )
    throw new Error('The voice configuration is invalid. Clear downloaded voices and retry.');
  return config;
}
export function encodeWav(pcms: Float32Array[], sampleRate: number): Blob {
  const samples = pcms.reduce((sum, pcm) => sum + pcm.length, 0);
  if (!samples) throw new Error('The voice engine returned no audio.');
  if (samples * 2 + 44 > MAX_AUDIO_BYTES)
    throw new Error('Narration audio exceeds the 32 MiB limit. Split it into shorter steps.');
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) =>
    [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const pcm of pcms)
    for (const sample of pcm) {
      const bounded = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, bounded < 0 ? bounded * 32768 : bounded * 32767, true);
      offset += 2;
    }
  return new Blob([buffer], { type: 'audio/x-wav' });
}
export async function loadPiperRuntimeFile(
  base: URL,
  path: string,
  limit: number,
  progress?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(new URL(path, base));
  if (!response.ok)
    throw new Error(
      `A local voice runtime file could not load (${response.status}). Reload or check the website deployment.`,
    );
  const declared = !response.headers.has('Content-Encoding')
    ? Number(response.headers.get('Content-Length')) || 0
    : 0;
  if (declared > limit) throw new Error('A local voice runtime file exceeds its size limit.');
  progress?.(0, declared);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot load the local voice runtime.');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > limit) throw new Error('A local voice runtime file exceeds its size limit.');
      parts.push(value);
      progress?.(loaded, declared);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (!loaded) throw new Error('A local voice runtime file is empty.');
  progress?.(loaded, declared || loaded);
  return new Blob(parts).arrayBuffer();
}
async function localBackend(
  model: ArrayBuffer,
  config: PiperConfig,
  base: URL,
  progress: Progress,
): Promise<PiperBackend> {
  progress({
    stage: 'loading',
    loaded: 0,
    total: 0,
    operation: 'session',
    message: 'Initializing the local voice session…',
  });
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = base.href;
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  try {
    progress({
      stage: 'loading',
      loaded: 0,
      total: 0,
      operation: 'phonemizer',
      message: 'Initializing the local pronunciation engine…',
    });
    const { default: createPhonemizer } =
      await import('@diffusionstudio/piper-wasm/build/piper_phonemize.js');
    // Emscripten's XHR package error only logs and never rejects initialization.
    // Await bounded local files ourselves so failed downloads reach the player immediately.
    const loaded = [0, 0],
      totals = [0, 0];
    const runtimeProgress = (index: number) => (bytes: number, total: number) => {
      loaded[index] = Math.max(loaded[index], bytes);
      totals[index] = total;
      progress({
        stage: 'download',
        operation: 'runtime',
        loaded: loaded[0] + loaded[1],
        total: totals.every((value) => value > 0) ? totals[0] + totals[1] : 0,
        message: 'Downloading the local pronunciation runtime…',
      });
    };
    const [wasm, data] = await Promise.all([
      loadPiperRuntimeFile(base, 'piper_phonemize.wasm', 1024 * 1024, runtimeProgress(0)),
      loadPiperRuntimeFile(base, 'piper_phonemize.data', 20 * 1024 * 1024, runtimeProgress(1)),
    ]);
    let output: number[] | undefined;
    let problem: string | undefined;
    type Phonemizer = Awaited<ReturnType<typeof createPhonemizer>>;
    let module: Phonemizer | undefined;
    let calls = 0,
      argumentBytes = 0;
    const initialize = async (notify: Progress) => {
      notify({
        stage: 'loading',
        operation: 'phonemizer',
        loaded: 0,
        total: 0,
        message: 'Initializing the local pronunciation engine…',
      });
      module = undefined;
      calls = 0;
      argumentBytes = 0;
      module = await createPhonemizer({
        thisProgram: PIPER_PROGRAM,
        wasmBinary: new Uint8Array(wasm),
        getPreloadedPackage: () => data,
        noInitialRun: true,
        noExitRuntime: true,
        print: (line) => {
          try {
            const value = JSON.parse(line).phoneme_ids;
            if (
              !Array.isArray(value) ||
              !value.length ||
              !value.every((item: unknown) => Number.isInteger(item))
            )
              problem = 'The pronunciation engine returned invalid phonemes.';
            else output = value;
          } catch {
            problem = 'The pronunciation engine returned invalid output.';
          }
        },
        printErr: (line) => {
          problem = line;
        },
        locateFile: (name) =>
          new URL(name.endsWith('.data') ? 'piper_phonemize.data' : 'piper_phonemize.wasm', base)
            .href,
      });
    };
    await initialize(progress);
    return {
      phonemize: async (text, notify = progress) => {
        // Pinned Piper WASM exposes no stackSave/stackRestore; callMain retains argv.
        // Bound that stack growth without restarting the expensive ONNX session.
        const args = [
          '-l',
          config.espeak.voice,
          '--input',
          JSON.stringify([{ text }]),
          '--espeak_data',
          '/espeak-ng-data',
        ];
        const bytes = phonemizerArgumentBytes(args);
        if (
          !module ||
          calls >= MAX_PHONEMIZER_CALLS ||
          argumentBytes + bytes > MAX_PHONEMIZER_ARG_BYTES
        )
          await initialize(notify);
        calls++;
        argumentBytes += bytes;
        output = undefined;
        problem = undefined;
        const result = module!.callMain(args);
        if (result || !output)
          throw new Error(problem || 'The pronunciation engine produced no phonemes.');
        const value = output;
        output = undefined;
        problem = undefined;
        return value;
      },
      infer: async (phonemes) => {
        const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
          input: new ort.Tensor('int64', phonemes, [1, phonemes.length]),
          input_lengths: new ort.Tensor('int64', [phonemes.length]),
          scales: new ort.Tensor('float32', [
            config.inference.noise_scale,
            config.inference.length_scale,
            config.inference.noise_w,
          ]),
        };
        if (Object.keys(config.speaker_id_map ?? {}).length)
          feeds.sid = new ort.Tensor('int64', [0]);
        let outputs: Record<string, InstanceType<typeof ort.Tensor>> | undefined;
        try {
          outputs = await session.run(feeds);
          const pcm = outputs.output?.data;
          if (!(pcm instanceof Float32Array) || !pcm.length || !pcm.every(Number.isFinite))
            throw new Error('The voice engine returned invalid audio.');
          return pcm.slice();
        } finally {
          Object.values(feeds).forEach((tensor) => tensor.dispose());
          Object.values(outputs ?? {}).forEach((tensor) => tensor.dispose());
        }
      },
      dispose: () => {
        module = undefined;
        output = undefined;
        problem = undefined;
        return session.release();
      },
    };
  } catch (error) {
    await session.release();
    throw error;
  }
}
const dependencies: PiperDependencies = { files: loadVoiceFiles, backend: localBackend };
export class PiperEngine {
  private constructor(
    private backend: PiperBackend,
    private sampleRate: number,
  ) {}
  static async create(voiceId: VoiceId, base: URL, progress: Progress, deps = dependencies) {
    const files = await deps.files(voiceInfo(voiceId), progress);
    const config = configValue(files.config);
    const backend = await deps.backend(files.model, config, base, progress);
    return new PiperEngine(backend, config.audio.sample_rate);
  }
  async prepare(text: string, progress: Progress): Promise<Blob> {
    const chunks = splitNarration(text);
    if (!chunks.length) throw new Error('Add narration before preparing audio.');
    const pcms: Float32Array[] = [];
    let samples = 0;
    for (const [index, chunk] of chunks.entries()) {
      progress({
        stage: 'synthesis',
        loaded: index,
        total: chunks.length,
        message: `Preparing narration chunk ${index + 1} of ${chunks.length}…`,
      });
      const phonemes = await this.backend.phonemize(chunk, progress);
      progress({
        stage: 'synthesis',
        loaded: index,
        total: chunks.length,
        message: `Preparing narration chunk ${index + 1} of ${chunks.length}…`,
      });
      const pcm = await this.backend.infer(phonemes);
      samples += pcm.length;
      if (samples * 4 > MAX_AUDIO_BYTES)
        throw new Error('Narration audio exceeds the 32 MiB limit. Split it into shorter steps.');
      pcms.push(pcm);
      progress({
        stage: 'synthesis',
        loaded: index + 1,
        total: chunks.length,
        message: `Prepared ${index + 1} of ${chunks.length} narration chunks.`,
      });
    }
    return encodeWav(pcms, this.sampleRate);
  }
  dispose() {
    return this.backend.dispose();
  }
}
