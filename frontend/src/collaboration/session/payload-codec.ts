export const collaborationPayloadLimits = Object.freeze({
  compressedPayloadBytes: 3 * 1024 * 1024,
  plaintextPayloadBytes: 64 * 1024 * 1024,
});
const { compressedPayloadBytes: compressedLimit, plaintextPayloadBytes: plaintextLimit } =
  collaborationPayloadLimits;
async function collect(stream: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal) {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Collaboration closed.', 'AbortError');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException('Collaboration closed.', 'AbortError');
      if (done) break;
      length += value.length;
      if (length > maximum) throw new Error('The collaboration payload exceeds its size limit.');
      parts.push(value);
    }
    if (signal.aborted) throw new DOMException('Collaboration closed.', 'AbortError');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
      part.fill(0);
    }
    return bytes;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    for (const part of parts) part.fill(0);
  }
}
/** Bounded decompression prevents a valid encrypted participant from allocating a zip bomb. */
export async function compressPayload(bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  if (signal.aborted) throw new DOMException('Collaboration closed.', 'AbortError');
  if (bytes.length > plaintextLimit)
    throw new Error('This diagram exceeds the collaboration payload limit.');
  return collect(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')),
    compressedLimit,
    signal,
  );
}
export async function decompressPayload(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (signal.aborted) throw new DOMException('Collaboration closed.', 'AbortError');
  if (bytes.length > compressedLimit)
    throw new Error('The collaboration payload exceeds its size limit.');
  return collect(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
    plaintextLimit,
    signal,
  );
}
