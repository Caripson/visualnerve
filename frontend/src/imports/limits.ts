import { StorageError } from '../model/errors';

export const DEFAULT_IMPORT_LIMIT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_LIMIT_BYTES = 1024 * 1024 * 1024;
export const IMPORT_LIMIT_SETTING = 'import-file-limit-mb';
export const LARGE_IMPORT_WARNING =
  'Only imports up to 50 MB are supported and guaranteed. Larger imports are experimental and may be slow or fail because of browser memory or format limits.';

function validImportLimitMb(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 50 && value <= 1024;
}

/** Invalid or legacy stored preferences keep the supported default. */
export function importLimitMb(value: unknown): number {
  return validImportLimitMb(value) ? value : 50;
}

export function assertImportLimitMb(value: unknown): asserts value is number {
  if (!validImportLimitMb(value))
    throw new StorageError(
      422,
      'Import file size limit must be a whole number from 50 MB to 1024 MB (1 GB).',
    );
}

/** Explicit byte budgets also support small internal limits used by parsers and tests. */
export function checkedImportLimitBytes(value: number = DEFAULT_IMPORT_LIMIT_BYTES): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_IMPORT_LIMIT_BYTES)
    throw new StorageError(
      422,
      'Import byte limit must be a positive whole number no greater than 1 GB.',
    );
  return value;
}

export function assertImportBytes(
  bytes: number,
  limit: number = DEFAULT_IMPORT_LIMIT_BYTES,
  kind = 'File',
): void {
  const budget = checkedImportLimitBytes(limit);
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new StorageError(422, `${kind} has an invalid file size.`);
  if (bytes > budget) {
    const megabytes = Number((budget / (1024 * 1024)).toPrecision(6));
    throw new StorageError(
      422,
      `${kind} exceeds the configured ${megabytes} MB import limit. Increase the import file size limit in Settings or choose a smaller file.`,
    );
  }
}

/** Count the UTF-8 bytes, including replacement characters for unpaired surrogates. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}
