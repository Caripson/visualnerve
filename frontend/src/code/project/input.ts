import {
  assertImportBytes,
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
} from '../../imports/limits';
import type { ProjectArchiveInput } from './types';

export function validateProjectArchiveInput(
  input: ProjectArchiveInput,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): number {
  const limit = checkedImportLimitBytes(byteLimit);
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['name', 'data'].includes(key)) ||
    typeof input.data !== 'string'
  )
    throw new Error('Project archive input needs base64 ZIP data and an optional name.');
  if (
    input.name !== undefined &&
    (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 500)
  )
    throw new Error('Project name must be text of at most 500 characters.');
  // Check the encoded size before attempting any decoding or allocating a byte buffer.
  if (!input.data.length || input.data.length % 4 !== 0)
    throw new Error('Project ZIP data must be strict base64 without a data URL.');
  const padding = input.data.endsWith('==') ? 2 : input.data.endsWith('=') ? 1 : 0;
  const bytes = (input.data.length / 4) * 3 - padding;
  assertImportBytes(bytes, limit, 'Project ZIP');
  return bytes;
}

/** Bounded chunks avoid one additional full-size decoded binary string. */
export function decodeProjectArchive(
  input: ProjectArchiveInput,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): Uint8Array {
  const length = validateProjectArchiveInput(input, byteLimit);
  const bytes = new Uint8Array(length);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = input.data.endsWith('==') ? 2 : input.data.endsWith('=') ? 1 : 0;
  if (
    (padding === 2 &&
      (alphabet.indexOf(input.data.at(-3)!) < 0 ||
        (alphabet.indexOf(input.data.at(-3)!) & 15) !== 0)) ||
    (padding === 1 &&
      (alphabet.indexOf(input.data.at(-2)!) < 0 ||
        (alphabet.indexOf(input.data.at(-2)!) & 3) !== 0))
  )
    throw new Error('Project ZIP data must be strict base64 without a data URL.');
  let offset = 0;
  for (let start = 0; start < input.data.length; start += 16_384) {
    const chunk = input.data.slice(start, start + 16_384);
    const last = start + 16_384 >= input.data.length;
    if (!(last ? /^[A-Za-z0-9+/]+={0,2}$/ : /^[A-Za-z0-9+/]+$/).test(chunk))
      throw new Error('Project ZIP data must be strict base64 without a data URL.');
    let binary: string;
    try {
      binary = atob(chunk);
    } catch {
      throw new Error('Project ZIP data must be strict base64 without a data URL.');
    }
    for (let index = 0; index < binary.length; index++) bytes[offset++] = binary.charCodeAt(index);
  }
  if (offset !== length) throw new Error('Project ZIP base64 size does not match.');
  return bytes;
}
