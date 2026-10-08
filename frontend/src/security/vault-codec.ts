import { VaultCryptoError } from './vault-errors';

export const RECORD_BYTES_LIMIT = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_VALUES = 2_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value);
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  // A bounded array-like call avoids spreading every byte through an iterator.
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += Reflect.apply(String.fromCharCode, undefined, bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Bound before allocating; reject noncanonical encodings and trailing unused bits. */
export function unbase64url(
  value: unknown,
  minBytes: number,
  maxBytes = minBytes,
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length < Math.ceil((minBytes * 4) / 3) ||
    value.length > Math.ceil((maxBytes * 4) / 3) ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]*$/.test(value)
  )
    throw new VaultCryptoError('INVALID_SCHEMA');
  let binary: string;
  try {
    binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    throw new VaultCryptoError('INVALID_SCHEMA');
  }
  // Allocate the final buffer directly rather than collecting a string iterator first.
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.length < minBytes || bytes.length > maxBytes || base64url(bytes) !== value)
    throw new VaultCryptoError('INVALID_SCHEMA');
  return bytes;
}

export function boundedString(value: unknown, maxBytes = 1024): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxBytes ||
    !wellFormedUnicode(value) ||
    utf8(value).length > maxBytes
  )
    throw new VaultCryptoError('INVALID_SCHEMA');
  return value;
}

export function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function safeInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new VaultCryptoError('INVALID_SCHEMA');
  return value;
}

export function objectFields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new VaultCryptoError('INVALID_SCHEMA');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new VaultCryptoError('INVALID_SCHEMA');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== names.length ||
    keys.some((key) => typeof key !== 'string' || !names.includes(key)) ||
    names.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]))
  )
    throw new VaultCryptoError('INVALID_SCHEMA');
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

function validateJsonValue(value: unknown, limit: number): void {
  const ancestors = new Set<object>();
  let values = 0;
  let minimumBytes = 0;
  const reserve = (bytes: number) => {
    minimumBytes += bytes;
    if (minimumBytes > limit) throw new VaultCryptoError('LIMIT_EXCEEDED');
  };
  const visit = (entry: unknown, depth: number) => {
    if (++values > MAX_JSON_VALUES || depth > MAX_JSON_DEPTH)
      throw new VaultCryptoError('LIMIT_EXCEEDED');
    if (entry === null || typeof entry === 'boolean') {
      reserve(entry === null || entry === true ? 4 : 5);
      return;
    }
    if (typeof entry === 'string') {
      reserve(entry.length + 2);
      return;
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      reserve(1);
      return;
    }
    if (typeof entry !== 'object' || ancestors.has(entry))
      throw new VaultCryptoError('INVALID_SCHEMA');
    const prototype = Object.getPrototypeOf(entry);
    if (
      Array.isArray(entry)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new VaultCryptoError('INVALID_SCHEMA');
    ancestors.add(entry);
    const keys = Reflect.ownKeys(entry);
    reserve(2 + Math.max(0, keys.length - (Array.isArray(entry) ? 2 : 1)));
    for (const key of keys) {
      if (Array.isArray(entry) && key === 'length') continue;
      if (typeof key !== 'string') throw new VaultCryptoError('INVALID_SCHEMA');
      if (!Array.isArray(entry)) reserve(key.length + 3);
      const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
      if (!descriptor.enumerable || !('value' in descriptor))
        throw new VaultCryptoError('INVALID_SCHEMA');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(entry)) {
      // JSON must not silently turn holes or custom array properties into different data.
      if (Object.keys(entry).length !== entry.length) throw new VaultCryptoError('INVALID_SCHEMA');
      for (let index = 0; index < entry.length; index++)
        if (!Object.hasOwn(entry, index)) throw new VaultCryptoError('INVALID_SCHEMA');
    }
    ancestors.delete(entry);
  };
  visit(value, 0);
}

export function jsonBytes(value: unknown, limit = RECORD_BYTES_LIMIT): Uint8Array<ArrayBuffer> {
  validateJsonValue(value, limit);
  const json = JSON.stringify(value);
  if (json.length > limit) throw new VaultCryptoError('LIMIT_EXCEEDED');
  const bytes = utf8(json);
  if (bytes.length > limit) throw new VaultCryptoError('LIMIT_EXCEEDED');
  return bytes;
}

export function parseJson(bytes: Uint8Array): unknown {
  // Decode is a trust boundary too: a valid GCM tag does not establish that its
  // author used our encoder or obeyed the JSON value/resource contract.
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    throw new VaultCryptoError('INVALID_SCHEMA');
  if (bytes.byteLength > RECORD_BYTES_LIMIT) throw new VaultCryptoError('LIMIT_EXCEEDED');
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new VaultCryptoError('INVALID_SCHEMA');
  }
  validateJsonValue(value, RECORD_BYTES_LIMIT);
  return value;
}
