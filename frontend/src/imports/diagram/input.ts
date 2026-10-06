import { StorageError } from '../../model/validation';
import type { DiagramFileInput } from './types';
import {
  assertImportBytes,
  checkedImportLimitBytes,
  DEFAULT_IMPORT_LIMIT_BYTES,
  utf8Bytes,
} from '../limits';

export function diagramFileInput(
  value: unknown,
  importing = false,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
): DiagramFileInput & { pageId?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StorageError(422, 'Provide a diagram file input object.');
  const input = value as Record<string, unknown>;
  const allowed = importing ? ['format', 'data', 'name', 'pageId'] : ['format', 'data', 'name'];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (input.format !== 'drawio' && input.format !== 'vsdx') ||
    typeof input.data !== 'string' ||
    !input.data.trim() ||
    (input.name !== undefined &&
      (typeof input.name !== 'string' || !input.name.trim() || [...input.name].length > 500)) ||
    (input.pageId !== undefined &&
      (typeof input.pageId !== 'string' || !input.pageId.trim() || [...input.pageId].length > 500))
  )
    throw new StorageError(
      422,
      'Provide drawio XML or base64 vsdx data and an optional name/pageId.',
    );
  if (input.format === 'drawio')
    assertImportBytes(utf8Bytes(input.data), byteLimit, 'Diagram file');
  if (input.format === 'vsdx') validateVsdxData(input.data, byteLimit);
  return input as unknown as DiagramFileInput & { pageId?: string };
}

export function decodeVsdx(data: string, byteLimit = DEFAULT_IMPORT_LIMIT_BYTES): Uint8Array {
  validateVsdxData(data, byteLimit);
  let decoded: string;
  try {
    decoded = atob(data);
  } catch {
    throw new StorageError(422, 'Visio data is not valid base64.');
  }
  assertImportBytes(decoded.length, byteLimit, 'Visio file');
  if (btoa(decoded) !== data || !decoded.startsWith('PK\u0003\u0004'))
    throw new StorageError(422, 'Visio data must encode a .vsdx ZIP package.');
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
function validateVsdxData(data: string, byteLimit: number) {
  const limit = checkedImportLimitBytes(byteLimit);
  if (
    data.length < 8 ||
    data.length % 4 ||
    data.length > Math.ceil(limit / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new StorageError(
      422,
      'Visio data must be standard base64 ZIP bytes within the configured import size limit.',
    );
  try {
    if (
      !atob(data.slice(0, 8)).startsWith('PK\u0003\u0004') ||
      btoa(atob(data.slice(-4))) !== data.slice(-4)
    )
      throw new Error('Invalid package');
  } catch {
    throw new StorageError(422, 'Visio data must encode a .vsdx ZIP package.');
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  assertImportBytes((data.length / 4) * 3 - padding, limit, 'Visio file');
}

export function decodeXmlBytes(bytes: Uint8Array): string {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Diagram XML has an invalid text encoding.');
  }
}
