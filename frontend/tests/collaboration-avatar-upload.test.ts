import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeProfileAvatar } from '../src/collaboration/ui/document/avatar-upload';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
function source(width: number, height: number): File {
  const bytes = Uint8Array.from(atob(png), (value) => value.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer } as File;
}

afterEach(() => vi.unstubAllGlobals());

describe('avatar source allocation bounds', () => {
  it.each([
    [16385, 1],
    [1, 16385],
    [8000, 4001],
    [0, 1],
  ])('rejects %s × %s source dimensions before pixel decoding', async (width, height) => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(normalizeProfileAvatar(source(width, height))).rejects.toThrow(/size limit/);
    expect(decode).not.toHaveBeenCalled();
  });

  it('requests a bounded native resize for an accepted phone-sized source', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('Decoder reached'));
    vi.stubGlobal('createImageBitmap', decode);
    await expect(normalizeProfileAvatar(source(6000, 4000))).rejects.toThrow('Decoder reached');
    expect(decode).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 256, resizeHeight: 171, resizeQuality: 'high' }),
    );
  });

  it('rejects excessive compressed data and unsupported content without calling a decoder', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const read = vi.fn();
    await expect(
      normalizeProfileAvatar({ size: 8 * 1024 * 1024 + 1, arrayBuffer: read } as unknown as File),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(
      normalizeProfileAvatar({
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer,
      } as File),
    ).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
});
