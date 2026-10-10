import { Blob as NativeBlob } from 'node:buffer';
import {
  CompressionStream as NativeCompressionStream,
  DecompressionStream as NativeDecompressionStream,
  ReadableStream as NativeReadableStream,
  WritableStream as NativeWritableStream,
} from 'node:stream/web';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { compressPayload, decompressPayload } from '../src/collaboration/session/payload-codec';

beforeEach(() => {
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('CompressionStream', NativeCompressionStream);
  vi.stubGlobal('DecompressionStream', NativeDecompressionStream);
});
afterEach(() => vi.unstubAllGlobals());
describe('bounded collaboration compression streams', () => {
  it('round-trips real gzip bytes without mutating the callers source', async () => {
    const source = Uint8Array.from(
      { length: 512 * 1024 },
      (_, i) => (i * 7 + Math.floor(i / 19)) % 251,
    );
    const expected = source.slice(),
      controller = new AbortController();
    const compressed = await compressPayload(source, controller.signal);
    expect(compressed.length).toBeLessThan(source.length);
    expect(await decompressPayload(compressed, controller.signal)).toEqual(expected);
    expect(source).toEqual(expected);
  });
  it('rejects a malformed gzip and compressed/plaintext input outside the documented bounds', async () => {
    const signal = new AbortController().signal;
    await expect(decompressPayload(Uint8Array.of(1, 2, 3), signal)).rejects.toThrow();
    await expect(decompressPayload(new Uint8Array(3 * 1024 * 1024 + 1), signal)).rejects.toThrow(
      /size limit/,
    );
    await expect(compressPayload(new Uint8Array(64 * 1024 * 1024 + 1), signal)).rejects.toThrow(
      /payload limit/,
    );
  });
  it('stops a real highly compressible decompression bomb at the plaintext budget', async () => {
    const source = new NativeBlob([new Uint8Array(64 * 1024 * 1024 + 1)]);
    const packed = new Uint8Array(
      await new Response(
        source.stream().pipeThrough(new NativeCompressionStream('gzip')) as ReadableStream,
      ).arrayBuffer(),
    );
    expect(packed.length).toBeLessThan(3 * 1024 * 1024);
    await expect(decompressPayload(packed, new AbortController().signal)).rejects.toThrow(
      /size limit/,
    );
  });
  it('rejects an already revoked session rather than returning partial data', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(compressPayload(Uint8Array.of(1, 2, 3), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('does not publish a partial stream when cancellation resolves a pending read as done', async () => {
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    // Only the slow transform is a fixture; native reader.cancel/read completion
    // semantics expose the abort race without replacing the collection code.
    class WaitingCompressionStream {
      readable = new NativeReadableStream<Uint8Array>({
        pull() {
          started();
        },
      });
      writable = new NativeWritableStream<Uint8Array>();
    }
    vi.stubGlobal('CompressionStream', WaitingCompressionStream);
    const controller = new AbortController();
    const result = compressPayload(Uint8Array.of(1, 2, 3), controller.signal);
    await reading;
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
