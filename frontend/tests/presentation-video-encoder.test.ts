import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BoundedVideoTarget,
  createVideoEncoder,
  MAX_VIDEO_BYTES,
  videoEncoderCapabilities,
} from '../src/presentation/video-encoder';

const mocks = vi.hoisted(() => ({
  videoCapability: vi.fn(),
  audioCapability: vi.fn(),
  videoAdd: vi.fn(),
  audioAdd: vi.fn(),
  outputs: [] as any[],
  videos: [] as any[],
  audios: [] as any[],
  samples: [] as any[],
  frames: [] as any[],
}));
vi.mock('mediabunny', () => ({
  Quality: class {
    constructor(public options: unknown) {}
  },
  canEncodeVideo: mocks.videoCapability,
  canEncodeAudio: mocks.audioCapability,
  Mp4OutputFormat: class {
    constructor(public options: unknown) {}
  },
  WebMOutputFormat: class {},
  StreamTarget: class {
    constructor(public writable: WritableStream) {}
  },
  Output: class {
    cancel = vi.fn(async () => undefined);
    start = vi.fn(async () => undefined);
    finalize = vi.fn(async () => {
      const writer = this.options.target.writable.getWriter();
      try {
        await writer.write({ type: 'write', position: 0, data: new Uint8Array([1, 2, 3, 4]) });
      } finally {
        writer.releaseLock();
      }
    });
    constructor(public options: any) {
      mocks.outputs.push(this);
    }
    addVideoTrack = vi.fn();
    addAudioTrack = vi.fn();
  },
  VideoSampleSource: class {
    close = vi.fn();
    constructor(public config: any) {
      mocks.videos.push(this);
    }
    add(frame: any) {
      return mocks.videoAdd(frame.init.timestamp, frame.init.duration, this.config, frame);
    }
  },
  VideoSample: class {
    close = vi.fn();
    constructor(
      public data: Uint8ClampedArray,
      public init: any,
    ) {
      mocks.frames.push(this);
    }
  },
  AudioSampleSource: class {
    close = vi.fn();
    constructor(public config: any) {
      mocks.audios.push(this);
    }
    add(sample: any) {
      return mocks.audioAdd(sample, this.config);
    }
  },
  AudioSample: class {
    close = vi.fn();
    constructor(public init: any) {
      mocks.samples.push(this);
    }
  },
}));
const options = { width: 1280, height: 720, fps: 30, audio: true };
const canvas = () => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
  const data = new Uint8ClampedArray(1280 * 720 * 4);
  data.set([216, 239, 223, 255, 255, 0, 0, 255]);
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    getImageData: vi.fn(() => ({ data, width: 1280, height: 720, colorSpace: 'srgb' })),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
};
const wav = () => new Blob([new Uint8Array(100)], { type: 'audio/x-wav' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.outputs.length = mocks.videos.length = mocks.audios.length = mocks.samples.length = 0;
  mocks.frames.length = 0;
  mocks.videoCapability.mockResolvedValue(true);
  mocks.audioCapability.mockResolvedValue(true);
  mocks.videoAdd.mockResolvedValue(undefined);
  mocks.audioAdd.mockResolvedValue(undefined);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = vi.fn(async () => ({
        sampleRate: 48000,
        numberOfChannels: 1,
        duration: 0.5,
        getChannelData: () => new Float32Array(24000).fill(0.25),
      }));
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it('prefers MP4 AVC/AAC and falls back to WebM VP9/Opus only when the requested pair is unavailable', async () => {
  expect(await videoEncoderCapabilities(options)).toEqual({
    mp4: true,
    webm: true,
    preferred: 'mp4',
  });
  mocks.audioCapability.mockImplementation(async (codec) => codec === 'opus');
  expect(await videoEncoderCapabilities(options)).toEqual({
    mp4: false,
    webm: true,
    preferred: 'webm',
  });
  const encoder = await createVideoEncoder(options, canvas());
  expect(encoder.format).toBe('webm');
  expect(mocks.videos[0].config.codec).toBe('vp9');
  expect(mocks.audios[0].config.codec).toBe('opus');
  await encoder.cancel();
});
it('can export silent MP4 even if AAC is unavailable without creating an audio source', async () => {
  mocks.audioCapability.mockResolvedValue(false);
  const encoder = await createVideoEncoder({ ...options, audio: false }, canvas());
  expect(encoder.format).toBe('mp4');
  expect(mocks.audios).toHaveLength(0);
  expect(mocks.audioCapability).not.toHaveBeenCalled();
  await expect(encoder.addAudio(wav(), 0)).rejects.toThrow('disabled');
  await encoder.cancel();
});
it('reports unsupported codecs before starting encoders or consuming canvas frames', async () => {
  mocks.videoCapability.mockResolvedValue(false);
  await expect(createVideoEncoder(options, canvas())).rejects.toThrow('WebCodecs');
  expect(mocks.outputs).toHaveLength(0);
});
it('rejects invalid dimensions and canvas mismatch before capability checks', async () => {
  await expect(createVideoEncoder({ ...options, width: 1279 }, canvas())).rejects.toThrow(
    'even dimensions',
  );
  await expect(createVideoEncoder({ ...options, width: 1920 }, canvas())).rejects.toThrow(
    'canvas dimensions',
  );
  expect(mocks.videoCapability).not.toHaveBeenCalled();
});
it('respects video encoder backpressure and rejects overlapping/nonfinite frame timestamps', async () => {
  const encoder = await createVideoEncoder({ ...options, audio: false }, canvas());
  let release!: () => void;
  mocks.videoAdd.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const pending = encoder.addFrame(0, 1 / 30);
  let done = false;
  void pending.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  release();
  await pending;
  expect(done).toBe(true);
  for (const [timestamp, duration] of [
    [0, 1 / 30],
    [NaN, 1],
    [1, 0],
    [3600, 1],
  ])
    await expect(encoder.addFrame(timestamp, duration)).rejects.toThrow();
  await encoder.cancel();
});
it('snapshots explicit sRGB RGBA pixels instead of passing a GPU canvas to the encoder', async () => {
  const source = canvas();
  const encoder = await createVideoEncoder({ ...options, audio: false }, source);
  await encoder.addFrame(0.5, 1 / 30);
  expect(source.getContext).toHaveBeenCalledWith('2d', {
    alpha: false,
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  expect(source.getContext('2d')!.getImageData).toHaveBeenCalledWith(0, 0, 1280, 720, {
    colorSpace: 'srgb',
  });
  expect(Array.from(mocks.frames[0].data.subarray(0, 8))).toEqual([
    216, 239, 223, 255, 255, 0, 0, 255,
  ]);
  expect(mocks.frames[0].init).toEqual({
    format: 'RGBA',
    codedWidth: 1280,
    codedHeight: 720,
    timestamp: 0.5,
    duration: 1 / 30,
    colorSpace: {
      primaries: 'bt709',
      transfer: 'iec61966-2-1',
      matrix: 'rgb',
      fullRange: true,
    },
  });
  expect(mocks.frames[0].close).toHaveBeenCalledOnce();
  await encoder.cancel();
});
it('closes normalized video samples after failures and aborts during backpressure', async () => {
  const abort = new AbortController();
  const encoder = await createVideoEncoder(
    { ...options, audio: false, signal: abort.signal },
    canvas(),
  );
  mocks.videoAdd.mockRejectedValueOnce(new Error('Video encode failed'));
  await expect(encoder.addFrame(0, 1 / 30)).rejects.toThrow('Video encode failed');
  expect(mocks.frames[0].close).toHaveBeenCalledOnce();
  mocks.videoAdd.mockImplementationOnce(async () => abort.abort());
  await expect(encoder.addFrame(0, 1 / 30)).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.frames[1].close).toHaveBeenCalledOnce();
  expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
});
it('awaits the same unfinished cleanup when AbortSignal and the exporter both cancel', async () => {
  const abort = new AbortController();
  const encoder = await createVideoEncoder(
    { ...options, audio: false, signal: abort.signal },
    canvas(),
  );
  let release!: () => void;
  mocks.outputs[0].cancel.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  abort.abort();
  const first = encoder.cancel();
  const second = encoder.cancel();
  expect(second).toBe(first);
  let finished = false;
  void second.then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
  expect(finished).toBe(false);
  release();
  await second;
  expect(finished).toBe(true);
  expect(encoder.cancel()).toBe(first);
  expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
});
it('cancels native output on AbortSignal and discards late encoder results', async () => {
  const controller = new AbortController();
  const encoder = await createVideoEncoder({ ...options, signal: controller.signal }, canvas());
  controller.abort();
  await expect(encoder.addFrame(0, 1 / 30)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(encoder.finish()).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.outputs[0].cancel).toHaveBeenCalledOnce();
});
it('fills leading, internal and trailing audio gaps with bounded samples rather than one giant silent buffer', async () => {
  const encoder = await createVideoEncoder(options, canvas());
  expect(await encoder.addAudio(wav(), 2)).toBe(0.5);
  expect(await encoder.addAudio(wav(), 3)).toBe(0.5);
  await encoder.addFrame(0, 4);
  const result = await encoder.finish();
  expect(result.type).toBe('video/mp4');
  expect(result.size).toBe(4);
  const samples = mocks.samples.map((sample) => sample.init);
  expect(samples[0].timestamp).toBe(0);
  expect(Math.max(...samples.map((sample) => sample.numberOfFrames))).toBeLessThanOrEqual(4096);
  expect(samples.reduce((sum, sample) => sum + sample.numberOfFrames, 0)).toBe(4 * 48000);
  let frame = 0;
  for (const sample of samples) {
    expect(sample.timestamp).toBe(frame / 48000);
    frame += sample.numberOfFrames;
  }
  expect(
    samples
      .filter((sample) => sample.data.some((value: number) => value !== 0))
      .reduce((sum, sample) => sum + sample.numberOfFrames, 0),
  ).toBe(48000);
  expect(mocks.samples.every((sample) => sample.close.mock.calls.length === 1)).toBe(true);
  expect(mocks.videos[0].close).toHaveBeenCalledOnce();
  expect(mocks.audios[0].close).toHaveBeenCalledOnce();
});
it('rejects narration overlap and a video ending before its full narration', async () => {
  const encoder = await createVideoEncoder(options, canvas());
  await encoder.addAudio(wav(), 0);
  await expect(encoder.addAudio(wav(), 0.25)).rejects.toThrow('overlap');
  await encoder.addFrame(0, 1 / 30);
  await expect(encoder.finish()).rejects.toThrow('ends before');
  await encoder.cancel();
});
it('closes samples even when native audio encoding fails', async () => {
  const encoder = await createVideoEncoder(options, canvas());
  mocks.audioAdd.mockRejectedValueOnce(new Error('Audio encoder failed'));
  await expect(encoder.addAudio(wav(), 0)).rejects.toThrow('Audio encoder failed');
  expect(mocks.samples[0].close).toHaveBeenCalledOnce();
  await encoder.cancel();
});
it('stops at the compressed payload ceiling before accumulating an oversized file', async () => {
  const encoder = await createVideoEncoder({ ...options, audio: false }, canvas());
  mocks.videoAdd.mockImplementationOnce(async (_timestamp, _duration, config) =>
    config.onEncodedPacket({ data: { byteLength: MAX_VIDEO_BYTES + 1 } }),
  );
  await expect(encoder.addFrame(0, 1 / 30)).rejects.toThrow('256 MB');
  await encoder.cancel();
});
it('does not finalize an empty video or permit writes after finalization', async () => {
  const encoder = await createVideoEncoder({ ...options, audio: false }, canvas());
  await expect(encoder.finish()).rejects.toThrow('Add diagram');
  await encoder.addFrame(0, 1);
  await encoder.finish();
  await expect(encoder.addFrame(1, 1)).rejects.toThrow('finalized');
  await expect(encoder.finish()).rejects.toThrow('finalized');
});
it('keeps random-access header backpatches, zero-fills gaps and rejects a file extent beyond its bound', async () => {
  const target = new BoundedVideoTarget(20);
  target.write({ type: 'write', position: 0, data: new Uint8Array([1, 2, 3, 4]) });
  target.write({ type: 'write', position: 8, data: new Uint8Array([8, 9]) });
  target.write({ type: 'write', position: 1, data: new Uint8Array([6, 7]) });
  expect(Array.from(new Uint8Array(await target.blob('video/mp4').arrayBuffer()))).toEqual([
    1, 6, 7, 4, 0, 0, 0, 0, 8, 9,
  ]);
  expect(() => target.write({ type: 'write', position: 19, data: new Uint8Array(2) })).toThrow(
    '256 MB',
  );
  expect(target.size).toBe(10);
  target.clear();
  expect(target.size).toBe(0);
});
