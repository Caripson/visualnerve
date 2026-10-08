import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64url, unbase64url } from '../src/security/vault-codec';

afterEach(() => vi.restoreAllMocks());
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const expectBytes = (actual: Uint8Array, expected: Uint8Array) => {
  expect(actual.byteLength).toBe(expected.byteLength);
  // Compare all bytes independently without a million-value pretty-printer or realm identity.
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
};

describe('bounded canonical vault base64 conversions', () => {
  it.each(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'])(
    'matches independent RFC-style encoding for %j',
    (text) => {
      const bytes = new TextEncoder().encode(text);
      const expected = Buffer.from(bytes).toString('base64url');
      expect(base64url(bytes)).toBe(expected);
      expectBytes(unbase64url(expected, bytes.length), bytes);
    },
  );

  it('preserves every byte value across fixed conversion blocks and a representative 1 MiB chunk', () => {
    for (const length of [256, 8191, 8192, 8193, 16383, 16384, 16385, 65536, 1024 * 1024]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index++)
        bytes[index] = (index * 131 + (index >>> 3)) % 256;
      const expected = Buffer.from(bytes).toString('base64url');
      expect(base64url(bytes), `encode ${length}`).toBe(expected);
      expectBytes(unbase64url(expected, length), bytes);
    }
  });

  it('retains full canonical re-encoding and rejects every unused-bit alias for single-byte inputs', () => {
    const encode = vi.spyOn(globalThis, 'btoa');
    for (let byte = 0; byte < 256; byte++) {
      const text = Buffer.from([byte]).toString('base64url');
      const final = alphabet.indexOf(text[1]);
      for (let unused = 1; unused < 16; unused++) {
        const alias = text[0] + alphabet[final | unused];
        expect(() => unbase64url(alias, 1)).toThrow(
          expect.objectContaining({ code: 'INVALID_SCHEMA' }),
        );
      }
    }
    // No last-character shortcut replaces the complete bytes-to-canonical-text check.
    expect(encode).toHaveBeenCalledTimes(256 * 15);
  });

  it('rejects all two-byte trailing-bit aliases while retaining URL alphabet values', () => {
    for (let byte = 0; byte < 256; byte++) {
      const bytes = Uint8Array.of(byte, (byte * 17 + 3) % 256);
      const text = Buffer.from(bytes).toString('base64url');
      const final = alphabet.indexOf(text[2]);
      expect(unbase64url(text, 2)).toEqual(bytes);
      for (let unused = 1; unused < 4; unused++) {
        const alias = text.slice(0, 2) + alphabet[final | unused];
        expect(() => unbase64url(alias, 2)).toThrow(
          expect.objectContaining({ code: 'INVALID_SCHEMA' }),
        );
      }
    }
    expect(base64url(Uint8Array.of(251, 255, 255))).toBe('-___');
    expect(unbase64url('-___', 3)).toEqual(Uint8Array.of(251, 255, 255));
  });

  it('rejects wrong types, padding, whitespace, non-URL alphabet and impossible lengths before atob', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    for (const input of [
      null,
      undefined,
      42,
      {},
      [],
      'A',
      'AAAAA',
      'AA=',
      'AA==',
      'AA+',
      'AA/',
      ' AA',
      'AA\n',
      'A A',
      'éé',
      '🙂',
    ])
      expect(() => unbase64url(input, 1, 16)).toThrow(
        expect.objectContaining({ code: 'INVALID_SCHEMA' }),
      );
    expect(decode).not.toHaveBeenCalled();
  });

  it('enforces minimum/exact/maximum byte bounds before allocating a decoded buffer', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(() => unbase64url('AA', 2, 4)).toThrow(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
    expect(() => unbase64url('AAAA', 1, 2)).toThrow(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
    expect(() => unbase64url('AAA', 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
    expect(decode).not.toHaveBeenCalled();
    expect(unbase64url('AA', 1, 2)).toEqual(Uint8Array.of(0));
    expect(unbase64url('AAA', 1, 2)).toEqual(Uint8Array.of(0, 0));
    expect(unbase64url('', 0)).toHaveLength(0);
  });

  it('returns independent owned buffers without changing the encoded input or source bytes', () => {
    const source = Uint8Array.of(0, 127, 128, 255);
    const text = base64url(source);
    const first = unbase64url(text, 4);
    const second = unbase64url(text, 4);
    first.fill(0);
    expect(second).toEqual(source);
    expect(text).toBe(Buffer.from(source).toString('base64url'));
    expect(source).toEqual(Uint8Array.of(0, 127, 128, 255));
  });
});
