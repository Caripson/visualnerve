// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { SITE_ICON_FILES, validateSiteIcons } from '../../scripts/site-icons.mjs';

const staticDirectory = new URL('../../hugo/static/', import.meta.url);
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-icons-'));
  temporary.push(directory);
  for (const path of ['site/mark.svg', ...SITE_ICON_FILES]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(new URL(path, staticDirectory), join(directory, path));
  }
  return directory;
}

/** Decode the committed image independently, rather than testing generator rendering calls. */
function pixels(bytes: Buffer) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  expect([bytes[24], bytes[25]]).toEqual([8, 6]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks)),
    stride = width * 4,
    rgba = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      da = Math.abs(p - a),
      db = Math.abs(p - b),
      dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let row = 0; row < height; row++) {
    const filter = encoded[row * (stride + 1)];
    expect(filter).toBeLessThanOrEqual(4);
    for (let column = 0; column < stride; column++) {
      const index = row * stride + column,
        a = column >= 4 ? rgba[index - 4] : 0,
        b = row ? rgba[index - stride] : 0,
        c = row && column >= 4 ? rgba[index - stride - 4] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      rgba[index] = encoded[row * (stride + 1) + column + 1] + predictor;
    }
  }
  let markPixels = 0;
  for (let index = 0; index < rgba.length; index += 4)
    if (
      Math.abs(rgba[index] - 208) < 3 &&
      Math.abs(rgba[index + 1] - 136) < 3 &&
      Math.abs(rgba[index + 2] - 80) < 3 &&
      rgba[index + 3] > 200
    )
      markPixels++;
  return { width, height, rgba, markPixels };
}

it('publishes real multi-size ICO images and square PNGs derived from the current mark', () => {
  const result = validateSiteIcons(new URL('.', staticDirectory).pathname);
  expect(result.frames).toEqual([16, 32, 48, 256]);
  expect(result.source).toBe(
    createHash('sha256')
      .update(readFileSync(new URL('site/mark.svg', staticDirectory)))
      .digest('hex'),
  );
  const ico = readFileSync(new URL('favicon.ico', staticDirectory));
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(4);
  for (const [index, size] of [16, 32, 48, 256].entries()) {
    const record = 6 + index * 16,
      length = ico.readUInt32LE(record + 8),
      offset = ico.readUInt32LE(record + 12);
    const decoded = pixels(ico.subarray(offset, offset + length));
    expect([decoded.width, decoded.height]).toEqual([size, size]);
    expect(decoded.rgba[3]).toBe(0);
    expect(decoded.markPixels).toBeGreaterThan(size / 2);
  }
  const favicon = pixels(readFileSync(new URL('favicon-96x96.png', staticDirectory)));
  expect([favicon.width, favicon.height]).toEqual([96, 96]);
  expect(favicon.rgba[3]).toBe(0);
  expect(favicon.markPixels).toBeGreaterThan(200);
  const apple = pixels(readFileSync(new URL('apple-touch-icon.png', staticDirectory)));
  expect([apple.width, apple.height]).toEqual([180, 180]);
  expect([...apple.rgba.subarray(0, 4)]).toEqual([32, 37, 34, 255]);
  expect(
    Array.from(apple.rgba)
      .filter((_, index) => index % 4 === 3)
      .every((value) => value === 255),
  ).toBe(true);
  expect(apple.markPixels).toBeGreaterThan(500);
});

it('rejects stale source marks, missing artifacts and corrupted icon bytes', () => {
  const directory = fixture(),
    original = readFileSync(join(directory, 'favicon.ico'));
  writeFileSync(join(directory, 'site/mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  expect(() => validateSiteIcons(directory)).toThrow('does not match its source mark');
  copyFileSync(new URL('site/mark.svg', staticDirectory), join(directory, 'site/mark.svg'));
  const corrupted = Buffer.from(original);
  corrupted[corrupted.length - 16] ^= 1;
  writeFileSync(join(directory, 'favicon.ico'), corrupted);
  expect(() => validateSiteIcons(directory)).toThrow(/checksum/);
  writeFileSync(join(directory, 'favicon.ico'), original.subarray(0, original.length - 1));
  expect(() => validateSiteIcons(directory)).toThrow('Invalid favicon ICO image entry');
  writeFileSync(join(directory, 'favicon.ico'), original);
  rmSync(join(directory, 'apple-touch-icon.png'));
  expect(() => validateSiteIcons(directory)).toThrow(/ENOENT/);
});
