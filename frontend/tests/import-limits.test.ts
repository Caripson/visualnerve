import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertImportBytes,
  assertImportLimitMb,
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
  importLimitMb,
  MAX_IMPORT_LIMIT_BYTES,
  utf8Bytes,
} from '../src/imports/limits';
import { currentImportLimitBytes } from '../src/imports/preference';
import { StorageError } from '../src/model/errors';
import { StorageError as ValidationStorageError } from '../src/model/validation';
import { useEditor } from '../src/state/editor';

afterEach(() => {
  vi.unstubAllGlobals();
  useEditor.setState({ importFileLimitMb: 50 });
});

describe('import size policy', () => {
  it('normalizes only integer stored limits between the supported default and maximum', () => {
    expect(DEFAULT_IMPORT_LIMIT_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_IMPORT_LIMIT_BYTES).toBe(1024 * 1024 * 1024);
    for (const value of [50, 100, 1024]) expect(importLimitMb(value)).toBe(value);
    for (const value of [undefined, null, '100', 0, 49, 1025, 50.5, NaN, Infinity, {}]) {
      expect(importLimitMb(value)).toBe(50);
      expect(() => assertImportLimitMb(value)).toThrow(StorageError);
      try {
        assertImportLimitMb(value);
      } catch (error) {
        expect((error as StorageError).status).toBe(422);
      }
    }
    expect(() => assertImportLimitMb(1024)).not.toThrow();
    expect(ValidationStorageError).toBe(StorageError);
  });

  it('accepts explicit small byte budgets while rejecting invalid or excessive budgets', () => {
    expect(checkedImportLimitBytes()).toBe(DEFAULT_IMPORT_LIMIT_BYTES);
    expect(checkedImportLimitBytes(1)).toBe(1);
    expect(checkedImportLimitBytes(MAX_IMPORT_LIMIT_BYTES)).toBe(MAX_IMPORT_LIMIT_BYTES);
    for (const value of [0, -1, 1.5, NaN, Infinity, MAX_IMPORT_LIMIT_BYTES + 1])
      expect(() => checkedImportLimitBytes(value)).toThrow(StorageError);
  });

  it('honors the exact configured boundary and explains how to increase it', () => {
    expect(() => assertImportBytes(0)).not.toThrow();
    expect(() => assertImportBytes(DEFAULT_IMPORT_LIMIT_BYTES)).not.toThrow();
    expect(() => assertImportBytes(DEFAULT_IMPORT_LIMIT_BYTES + 1, undefined, 'CSV file')).toThrow(
      /CSV file exceeds the configured 50 MB import limit.*Settings/,
    );
    const limit = 128 * 1024 * 1024;
    expect(() => assertImportBytes(limit, limit)).not.toThrow();
    expect(() => assertImportBytes(limit + 1, limit)).toThrow(/configured 128 MB/);
    expect(() => assertImportBytes(11, 10)).toThrow(StorageError);
    for (const value of [-1, 1.5, NaN, Infinity])
      expect(() => assertImportBytes(value)).toThrow(/invalid file size/);
  });

  it('counts UTF-8 bytes without allocating an encoded copy', () => {
    const examples = [
      '',
      'plain ASCII',
      'åäö',
      '漢字',
      '🚀',
      '\ud800',
      '\udc00',
      '\ud800A\udc00',
      'a🚀å漢',
    ];
    const expected = examples.map((text) => new TextEncoder().encode(text).byteLength);
    vi.stubGlobal(
      'TextEncoder',
      class {
        constructor() {
          throw new Error('Unexpected encoding allocation');
        }
      },
    );
    examples.forEach((text, index) => expect(utf8Bytes(text)).toBe(expected[index]));
    expect(utf8Bytes('🚀'.repeat(10000))).toBe(40000);
  });

  it('reads the latest active local preference independently from parser policy', () => {
    useEditor.setState({ importFileLimitMb: 50 });
    expect(currentImportLimitBytes()).toBe(DEFAULT_IMPORT_LIMIT_BYTES);
    useEditor.setState({ importFileLimitMb: 1024 });
    expect(currentImportLimitBytes()).toBe(MAX_IMPORT_LIMIT_BYTES);
    useEditor.setState({ importFileLimitMb: 1 });
    expect(currentImportLimitBytes()).toBe(DEFAULT_IMPORT_LIMIT_BYTES);
  });
});
