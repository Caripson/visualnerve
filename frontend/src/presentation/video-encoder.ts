import {
  AudioSample,
  AudioSampleSource,
  VideoSample,
  VideoSampleSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type StreamTargetChunk,
} from 'mediabunny';

export const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 3600;
const PAGE_BYTES = 64 * 1024;
const SAMPLE_RATE = 48000;
const AUDIO_CHUNK_FRAMES = 4096;
const MAX_WAV_BYTES = 64 * 1024 * 1024;
const videoQuality = () => new Quality({ bitrate: 5_000_000 });
const audioQuality = () => new Quality({ bitrate: 192_000 });
export type VideoFormat = 'mp4' | 'webm';
export type VideoEncoderOptions = {
  width: number;
  height: number;
  fps: number;
  audio: boolean;
  signal?: AbortSignal;
};
export interface DiagramVideoEncoder {
  format: VideoFormat;
  /** Timestamp and duration are seconds on the offline movie timeline. */
  addFrame(timestamp: number, duration: number): Promise<void>;
  /** Encode local WAV narration at its timeline timestamp; return its full duration. */
  addAudio(blobWav: Blob, timestamp: number): Promise<number>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

function abortError() {
  return new DOMException('Video export cancelled.', 'AbortError');
}
function capacityError() {
  return new Error(
    'The video exceeds the 256 MB export limit. Shorten the walkthrough and try again.',
  );
}
function dimensions(options: Omit<VideoEncoderOptions, 'signal'>) {
  if (
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width < 16 ||
    options.height < 16 ||
    options.width > 3840 ||
    options.height > 2160 ||
    options.width % 2 ||
    options.height % 2 ||
    !Number.isFinite(options.fps) ||
    options.fps < 1 ||
    options.fps > 60 ||
    typeof options.audio !== 'boolean'
  )
    throw new Error(
      'Video export needs even dimensions up to 3840 × 2160 and a frame rate from 1 to 60.',
    );
}
function time(value: number, label: string, positive = false) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (positive && value === 0) ||
    value > MAX_VIDEO_SECONDS
  )
    throw new Error(
      `${label} must be ${positive ? 'positive' : 'nonnegative'} and within the one-hour video limit.`,
    );
}

export async function videoEncoderCapabilities(
  options: Omit<VideoEncoderOptions, 'signal'> = {
    width: 1280,
    height: 720,
    fps: 30,
    audio: true,
  },
): Promise<{ mp4: boolean; webm: boolean; preferred: VideoFormat | null }> {
  dimensions(options);
  const videoOptions = {
    width: options.width,
    height: options.height,
    frameRate: options.fps,
    quality: videoQuality(),
  };
  const audioOptions = { numberOfChannels: 1, sampleRate: SAMPLE_RATE, quality: audioQuality() };
  const safe = (check: Promise<boolean>) => check.catch(() => false);
  const [avc, aac, vp9, opus] = await Promise.all([
    safe(canEncodeVideo('avc', videoOptions)),
    options.audio ? safe(canEncodeAudio('aac', audioOptions)) : true,
    safe(canEncodeVideo('vp9', videoOptions)),
    options.audio ? safe(canEncodeAudio('opus', audioOptions)) : true,
  ]);
  const mp4 = avc && aac,
    webm = vp9 && opus;
  return { mp4, webm, preferred: mp4 ? 'mp4' : webm ? 'webm' : null };
}

/** Random-access bounded pages allow MP4 metadata backpatches without a huge BufferTarget reallocation. */
export class BoundedVideoTarget {
  private pages: Uint8Array<ArrayBuffer>[] = [];
  private length = 0;
  constructor(private limit = MAX_VIDEO_BYTES) {}
  write({ data, position }: StreamTargetChunk) {
    const end = position + data.byteLength;
    if (
      !Number.isSafeInteger(position) ||
      position < 0 ||
      !Number.isSafeInteger(end) ||
      end > this.limit
    )
      throw capacityError();
    for (let offset = 0; offset < data.byteLength; ) {
      const absolute = position + offset;
      const index = Math.floor(absolute / PAGE_BYTES);
      while (this.pages.length <= index)
        this.pages.push(
          new Uint8Array(Math.min(PAGE_BYTES, this.limit - this.pages.length * PAGE_BYTES)),
        );
      const pageOffset = absolute % PAGE_BYTES;
      const count = Math.min(data.byteLength - offset, this.pages[index].byteLength - pageOffset);
      this.pages[index].set(data.subarray(offset, offset + count), pageOffset);
      offset += count;
    }
    this.length = Math.max(this.length, end);
  }
  blob(mime: string) {
    const parts = this.pages.map((page, index) =>
      page.subarray(0, Math.min(page.byteLength, this.length - index * PAGE_BYTES)),
    );
    return new Blob(parts, { type: mime });
  }
  clear() {
    this.pages = [];
    this.length = 0;
  }
  get size() {
    return this.length;
  }
}

export async function createVideoEncoder(
  options: VideoEncoderOptions,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<DiagramVideoEncoder> {
  dimensions(options);
  if (options.signal?.aborted) throw abortError();
  if (canvas.width !== options.width || canvas.height !== options.height)
    throw new Error('The export canvas dimensions must match the video dimensions.');
  const context = canvas.getContext('2d', {
    alpha: false,
    colorSpace: 'srgb',
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('The video export canvas needs a 2D pixel reader.');
  const capabilities = await videoEncoderCapabilities(options);
  if (options.signal?.aborted) throw abortError();
  const format = capabilities.preferred;
  if (!format)
    throw new Error(
      'This browser cannot encode the requested video. Use a browser with WebCodecs AVC/AAC or VP9/Opus encoding.',
    );
  const pages = new BoundedVideoTarget();
  let encodedBytes = 0;
  let failure: Error | undefined;
  let cancelled = false;
  let finishing = false;
  let finished = false;
  let frames = 0;
  let videoEnd = 0;
  let audioEndFrame = 0;
  let decode: OfflineAudioContext | undefined;
  const check = () => {
    if (cancelled || options.signal?.aborted) throw abortError();
    if (failure) throw failure;
  };
  const encoded = (packet: { data: Uint8Array }) => {
    encodedBytes += packet.data.byteLength;
    if (encodedBytes > MAX_VIDEO_BYTES) {
      failure = capacityError();
      throw failure;
    }
  };
  const target = new StreamTarget(
    new WritableStream<StreamTargetChunk>({
      write(chunk) {
        check();
        try {
          pages.write(chunk);
        } catch (error) {
          failure = error as Error;
          throw error;
        }
      },
    }),
    { chunked: true, chunkSize: PAGE_BYTES },
  );
  const output = new Output({
    format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
    target,
  });
  const video = new VideoSampleSource({
    codec: format === 'mp4' ? 'avc' : 'vp9',
    quality: videoQuality(),
    latencyMode: 'quality',
    keyFrameInterval: 2,
    onEncodedPacket: encoded,
  });
  output.addVideoTrack(video, { frameRate: options.fps });
  const audio = options.audio
    ? new AudioSampleSource({
        codec: format === 'mp4' ? 'aac' : 'opus',
        quality: audioQuality(),
        onEncodedPacket: encoded,
      })
    : undefined;
  if (audio) output.addAudioTrack(audio);

  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    if (cancellation) return cancellation;
    if (finished) return Promise.resolve();
    cancelled = true;
    options.signal?.removeEventListener('abort', abort);
    // The abort listener starts cleanup without awaiting it. Every later
    // caller must await that same work before another export can take over.
    cancellation = Promise.resolve().then(async () => {
      try {
        await output.cancel();
      } finally {
        pages.clear();
        decode = undefined;
      }
    });
    return cancellation;
  };
  const abort = () => {
    void cancel().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await output.start();
    check();
  } catch (error) {
    await cancel().catch(() => undefined);
    throw error;
  }

  async function sample(values: Float32Array<ArrayBuffer>, startFrame: number) {
    check();
    const sample = new AudioSample({
      data: values,
      format: 'f32-planar',
      numberOfChannels: 1,
      sampleRate: SAMPLE_RATE,
      numberOfFrames: values.length,
      timestamp: startFrame / SAMPLE_RATE,
    });
    try {
      await audio!.add(sample);
      check();
    } finally {
      sample.close();
    }
  }
  async function silenceUntil(frame: number) {
    // Mediabunny otherwise fills a timestamp gap with one large allocation.
    // Feed bounded chunks, including leading/trailing silence, to keep its timeline contiguous.
    const silence = new Float32Array(AUDIO_CHUNK_FRAMES);
    while (audioEndFrame < frame) {
      const count = Math.min(AUDIO_CHUNK_FRAMES, frame - audioEndFrame);
      await sample(silence.subarray(0, count), audioEndFrame);
      audioEndFrame += count;
    }
  }
  const accepting = () => {
    check();
    if (finishing || finished) throw new Error('The video encoder has already been finalized.');
  };
  return {
    format,
    async addFrame(timestamp, duration) {
      accepting();
      time(timestamp, 'Frame timestamp');
      time(duration, 'Frame duration', true);
      time(timestamp + duration, 'Frame end');
      if (timestamp + 0.000001 < videoEnd)
        throw new Error('Video frames must be added in increasing, nonoverlapping timeline order.');
      // Canvas-backed VideoFrames can take Chromium's accelerated RGB-to-YUV
      // readback path. Snapshot explicit sRGB bytes instead so opaque diagrams
      // use the same color input on software and hardware graphics devices.
      const pixels = context.getImageData(0, 0, options.width, options.height, {
        colorSpace: 'srgb',
      });
      const frame = new VideoSample(pixels.data, {
        format: 'RGBA',
        codedWidth: options.width,
        codedHeight: options.height,
        timestamp,
        duration,
        colorSpace: {
          primaries: 'bt709',
          transfer: 'iec61966-2-1',
          matrix: 'rgb',
          fullRange: true,
        },
      });
      try {
        await video.add(frame);
        check();
      } finally {
        frame.close();
      }
      videoEnd = timestamp + duration;
      frames++;
    },
    async addAudio(blobWav, timestamp) {
      accepting();
      time(timestamp, 'Narration timestamp');
      if (!audio) throw new Error('Audio was disabled for this video export.');
      if (blobWav.size <= 44 || blobWav.size > MAX_WAV_BYTES)
        throw new Error('Narration WAV must contain audio and be no larger than 64 MB.');
      decode ??= new OfflineAudioContext(1, 1, SAMPLE_RATE);
      const buffer = await decode.decodeAudioData(await blobWav.arrayBuffer());
      check();
      if (
        buffer.numberOfChannels !== 1 ||
        buffer.sampleRate !== SAMPLE_RATE ||
        !Number.isFinite(buffer.duration) ||
        buffer.duration <= 0
      )
        throw new Error('Narration must decode to valid mono audio.');
      time(timestamp + buffer.duration, 'Narration end');
      let startFrame = Math.round(timestamp * SAMPLE_RATE);
      if (startFrame + 1 < audioEndFrame)
        throw new Error('Narration clips must not overlap and must be added in timeline order.');
      startFrame = Math.max(startFrame, audioEndFrame);
      await silenceUntil(startFrame);
      const values = buffer.getChannelData(0);
      for (let offset = 0; offset < values.length; offset += AUDIO_CHUNK_FRAMES) {
        const count = Math.min(AUDIO_CHUNK_FRAMES, values.length - offset);
        await sample(values.subarray(offset, offset + count), startFrame + offset);
        audioEndFrame = startFrame + offset + count;
      }
      return buffer.duration;
    },
    async finish() {
      accepting();
      if (!frames) throw new Error('Add diagram video frames before finishing the export.');
      if (audioEndFrame / SAMPLE_RATE > videoEnd + 1 / options.fps)
        throw new Error(
          'The video timeline ends before its narration. Render enough frames for the complete audio.',
        );
      finishing = true;
      try {
        if (audio) await silenceUntil(Math.ceil(videoEnd * SAMPLE_RATE));
        video.close();
        audio?.close();
        await output.finalize();
        check();
        if (!pages.size) throw new Error('The video encoder returned an empty file.');
        const result = pages.blob(format === 'mp4' ? 'video/mp4' : 'video/webm');
        if (result.size > MAX_VIDEO_BYTES) throw capacityError();
        finished = true;
        options.signal?.removeEventListener('abort', abort);
        pages.clear();
        decode = undefined;
        return result;
      } catch (error) {
        await cancel().catch(() => undefined);
        throw options.signal?.aborted ? abortError() : error;
      }
    },
    cancel,
  };
}
