import { collaborationLimits, rasterDimensions, validateAvatarDataUrl } from '../../model';

/** Decode a local raster and store a small, static image rather than its original file. */
export async function normalizeProfileAvatar(file: File): Promise<string> {
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Invalid avatar image.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  const format =
    bytes[0] === 137 && ascii(1, 3) === 'PNG'
      ? 'png'
      : bytes[0] === 255 && bytes[1] === 216
        ? 'jpeg'
        : ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
          ? 'webp'
          : undefined;
  if (!format) throw new Error('Invalid avatar image.');
  const [width, height] = rasterDimensions(bytes, format);
  if (
    ![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 16384) ||
    width * height > 32_000_000
  )
    throw new Error('Avatar source image exceeds the size limit.');
  const sourceScale = Math.min(1, collaborationLimits.avatarDimension / Math.max(width, height));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }), {
    imageOrientation: 'from-image',
    resizeWidth: Math.max(1, Math.round(width * sourceScale)),
    resizeHeight: Math.max(1, Math.round(height * sourceScale)),
    resizeQuality: 'high',
  });
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Invalid avatar image.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    for (const maximum of [collaborationLimits.avatarDimension, 192, 128, 96]) {
      const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const image of [
        canvas.toDataURL('image/png'),
        canvas.toDataURL('image/webp', 0.8),
        canvas.toDataURL('image/webp', 0.6),
      ]) {
        try {
          validateAvatarDataUrl(image);
          return image;
        } catch {
          /* Try a smaller canonical raster. */
        }
      }
    }
    throw new Error('Avatar image exceeds the size limit.');
  } finally {
    bitmap.close();
  }
}
