import { StorageError } from '../../model/errors';
import { collaborationLimits } from './types';

function fail(): never {
  throw new StorageError(
    422,
    'Avatar must be a PNG, JPEG or WebP data image up to 64 KiB and 256 × 256 pixels.',
  );
}
const be32 = (bytes: Uint8Array, at: number) =>
  bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
const le24 = (bytes: Uint8Array, at: number) =>
  bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16);
const le32 = (bytes: Uint8Array, at: number) => le24(bytes, at) + bytes[at + 3] * 0x1000000;
const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** Reads raster container/header dimensions without decoding the pixel buffer. */
export function rasterDimensions(
  bytes: Uint8Array,
  format: 'png' | 'jpeg' | 'webp',
): [number, number] {
  if (format === 'png') {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
      be32(bytes, 8) !== 13 ||
      ascii(bytes, 12, 4) !== 'IHDR'
    )
      fail();
    let at = 8;
    let pixels = false;
    while (at + 12 <= bytes.length) {
      const length = be32(bytes, at);
      const chunk = ascii(bytes, at + 4, 4);
      if (!/^[A-Za-z]{4}$/.test(chunk) || length > bytes.length - at - 12 || chunk === 'acTL')
        fail();
      if (chunk === 'IHDR' && at !== 8) fail();
      if (chunk === 'IDAT' && length > 0) pixels = true;
      if (chunk === 'IEND') {
        if (length !== 0 || at + 12 !== bytes.length || !pixels) fail();
        return [be32(bytes, 16), be32(bytes, 20)];
      }
      at += length + 12;
    }
    return fail();
  }
  if (format === 'jpeg') {
    if (
      bytes.length < 4 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes.at(-2) !== 0xff ||
      bytes.at(-1) !== 0xd9
    )
      fail();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) fail();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = (bytes[offset] << 8) + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) fail();
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) fail();
        return [
          (bytes[offset + 5] << 8) + bytes[offset + 6],
          (bytes[offset + 3] << 8) + bytes[offset + 4],
        ];
      }
      offset += length;
    }
    return fail();
  }
  if (
    bytes.length < 25 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP' ||
    le32(bytes, 4) !== bytes.length - 8
  )
    fail();
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    if ((bytes[20] & 0x02) !== 0) fail();
    return [le24(bytes, 24) + 1, le24(bytes, 27) + 1];
  }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  )
    return [(bytes[26] + (bytes[27] << 8)) & 0x3fff, (bytes[28] + (bytes[29] << 8)) & 0x3fff];
  if (chunk === 'VP8L' && bytes[20] === 0x2f)
    return [
      1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    ];
  return fail();
}

/** Only call after validateAvatarDataUrl has checked canonical base64 encoding. */
export function avatarPayloadBytes(value: string): number {
  const payload = value.slice(value.indexOf(',') + 1);
  return (payload.length * 3) / 4 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
}

/** Header/size validation at the document boundary. UI decode/re-encode performs canonicalization. */
export function validateAvatarDataUrl(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(collaborationLimits.avatarBytes / 3) * 4 + 32
  )
    fail();
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) fail();
  let decoded: string;
  try {
    decoded = atob(match[2]);
    if (btoa(decoded) !== match[2]) fail();
  } catch {
    return fail();
  }
  if (!decoded.length || decoded.length > collaborationLimits.avatarBytes) fail();
  const bytes = Uint8Array.from(decoded, (value) => value.charCodeAt(0));
  const [width, height] = rasterDimensions(bytes, match[1] as 'png' | 'jpeg' | 'webp');
  if (
    ![width, height].every(
      (value) =>
        Number.isInteger(value) && value > 0 && value <= collaborationLimits.avatarDimension,
    )
  )
    fail();
}
