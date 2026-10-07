import type { Page } from '@playwright/test';

// Retain early, middle and final input frames without reading their pixels during encoding. This
// keeps the diagnostic from changing the GPU/CPU path that it is verifying.
export async function installVideoColorProbe(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as {
      __videoColorProbe: { frames: VideoFrame[]; restore(): void };
    };
    const frames: VideoFrame[] = [];
    const original = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (frame, options) {
      if (
        frames.length < 3 &&
        (!frames.length || frame.timestamp - frames[frames.length - 1].timestamp >= 1_000_000)
      )
        frames.push(frame.clone());
      else if (frames.length === 3) frames.push(frame.clone());
      else if (frames.length === 4) {
        frames[3].close();
        frames[3] = frame.clone();
      }
      return original.call(this, frame, options);
    };
    state.__videoColorProbe = {
      frames,
      restore() {
        VideoEncoder.prototype.encode = original;
        for (const frame of frames) frame.close();
      },
    };
  });
}

export async function decodedMovieColors(page: Page, bytes: number[]) {
  return page.evaluate(async (bytes) => {
    const state = window as unknown as {
      __videoColorProbe: { frames: VideoFrame[]; restore(): void };
    };
    const video = document.createElement('video');
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    video.muted = true;
    video.src = url;
    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Video ${event} timeout`)), 10000);
        video.addEventListener(
          event,
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        video.addEventListener(
          'error',
          () => {
            clearTimeout(timer);
            reject(new Error('Video decode failed'));
          },
          { once: true },
        );
      });
    const source = document.createElement('canvas');
    const decoded = document.createElement('canvas');
    source.width = decoded.width = 1280;
    source.height = decoded.height = 720;
    const options = { alpha: false, colorSpace: 'srgb', willReadFrequently: true } as const;
    const sourceContext = source.getContext('2d', options) as CanvasRenderingContext2D;
    const decodedContext = decoded.getContext('2d', options) as CanvasRenderingContext2D;
    try {
      await wait('loadedmetadata');
      const samples = [];
      for (const frame of state.__videoColorProbe.frames) {
        // Seek inside this frame, avoiding a decoder selecting its predecessor.
        video.currentTime = frame.timestamp / 1_000_000 + 0.001;
        await wait('seeked');
        sourceContext.drawImage(frame, 0, 0);
        decodedContext.drawImage(video, 0, 0);
        const original = sourceContext.getImageData(0, 0, 1280, 720).data;
        const result = decodedContext.getImageData(0, 0, 1280, 720).data;
        let error = 0;
        let neutralError = 0;
        let neutralCount = 0;
        let pinkCount = 0;
        let nativeGreenCount = 0;
        let nativeGreenError = 0;
        let count = 0;
        const colors = new Set<string>();
        for (let y = 24; y < 640; y += 2) {
          for (let x = 24; x < 1256; x += 2) {
            const i = (y * 1280 + x) * 4;
            const r = original[i];
            const g = original[i + 1];
            const b = original[i + 2];
            const delta =
              (Math.abs(r - result[i]) +
                Math.abs(g - result[i + 1]) +
                Math.abs(b - result[i + 2])) /
              3;
            count++;
            error += delta;
            colors.add(`${result[i] >> 4},${result[i + 1] >> 4},${result[i + 2] >> 4}`);
            if (r > 80 && Math.max(r, g, b) - Math.min(r, g, b) < 8) {
              neutralCount++;
              neutralError += delta;
              if (result[i] > result[i + 1] + 30 && result[i + 2] > result[i + 1] + 30) pinkCount++;
            }
            // The native first card has a #d8efdf fill. Do not count green text
            // from subtitles or player chrome, which is outside this sample.
            if (
              r >= 200 &&
              r <= 225 &&
              g >= 225 &&
              g <= 250 &&
              b >= 210 &&
              b <= 235 &&
              g - r >= 12 &&
              g - b >= 8
            ) {
              nativeGreenCount++;
              nativeGreenError += delta;
            }
          }
        }
        samples.push({
          timestamp: frame.timestamp,
          format: frame.format,
          colors: colors.size,
          meanError: error / count,
          neutralCount,
          neutralError: neutralError / Math.max(1, neutralCount),
          pinkRatio: pinkCount / Math.max(1, neutralCount),
          nativeGreenCount,
          nativeGreenError: nativeGreenError / Math.max(1, nativeGreenCount),
        });
      }
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        samples,
      };
    } finally {
      state.__videoColorProbe.restore();
      video.src = '';
      URL.revokeObjectURL(url);
    }
  }, bytes);
}

export async function encodedColorSwatches(page: Page) {
  return page.evaluate(async () => {
    const entry = performance
      .getEntriesByType('resource')
      .find((resource) => /\/video-encoder-[^/]+\.js(?:\?|$)/.test(resource.name));
    if (!entry) throw new Error('The production movie encoder was not loaded.');
    const { createVideoEncoder } = await import(entry.name);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })!;
    const expected = [
      [255, 255, 255],
      [128, 128, 128],
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [216, 239, 223],
      [12, 24, 20],
    ];
    expected.forEach((rgb, i) => {
      context.fillStyle = `rgb(${rgb.join(',')})`;
      context.fillRect(0, i * 90, 1280, 90);
    });
    const encoder = await createVideoEncoder(
      { width: 1280, height: 720, fps: 30, audio: false },
      canvas,
    );
    for (let frame = 0; frame < 30; frame++) await encoder.addFrame(frame / 30, 1 / 30);
    const movie = await encoder.finish();
    const video = document.createElement('video');
    video.muted = true;
    const url = URL.createObjectURL(movie);
    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Swatch video ${event} timeout`)), 10000);
        video.addEventListener(
          event,
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        video.addEventListener('error', () => reject(new Error('Swatch video decode failed')), {
          once: true,
        });
      });
    video.src = url;
    try {
      await wait('loadedmetadata');
      video.currentTime = 0.5;
      await wait('seeked');
      context.drawImage(video, 0, 0);
      return expected.map((rgb, i) => ({
        expected: rgb,
        decoded: Array.from(context.getImageData(640, i * 90 + 45, 1, 1).data).slice(0, 3),
      }));
    } finally {
      video.src = '';
      URL.revokeObjectURL(url);
    }
  });
}
