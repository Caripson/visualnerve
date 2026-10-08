import { VaultCryptoError } from './vault-errors';

export const logicalJsonLimits = Object.freeze({
  bytes: 1024 * 1024 * 1024,
  values: 64_000_000,
  depth: 64,
  chunkBytes: 1024 * 1024,
  minimumChunkBytes: 64 * 1024,
  chunks: 16_384,
  inlineBytes: 64 * 1024,
  projectionBytes: 256 * 1024,
});

export interface LogicalJsonBudget {
  bytes: number;
  values: number;
}
interface JsonOptions {
  chunkBytes: number;
  budget: LogicalJsonBudget;
  bytesLimit?: number;
  valuesLimit?: number;
  depthLimit?: number;
  initialDepth?: number;
}

const encoder = new TextEncoder();
const invalid = (): never => {
  throw new VaultCryptoError('INVALID_SCHEMA');
};
const limit = (): never => {
  throw new VaultCryptoError('LIMIT_EXCEEDED');
};

/** Emits bounded UTF-8 pieces without allocating the entire logical JSON string. */
export function* logicalJsonChunks(value: unknown, options: JsonOptions): Generator<Uint8Array> {
  const {
    chunkBytes,
    budget,
    bytesLimit = logicalJsonLimits.bytes,
    valuesLimit = logicalJsonLimits.values,
    depthLimit = logicalJsonLimits.depth,
    initialDepth = 0,
  } = options;
  if (
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 1 ||
    chunkBytes > logicalJsonLimits.chunkBytes
  )
    invalid();
  const ancestors = new Set<object>();
  function* quoted(text: string): Generator<string> {
    if (text.length <= 32_768) {
      yield JSON.stringify(text);
      return;
    }
    yield '"';
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 32_768, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      yield JSON.stringify(text.slice(start, end)).slice(1, -1);
      start = end;
    }
    yield '"';
  }
  function* pieces(entry: unknown, depth: number): Generator<string> {
    if (++budget.values > valuesLimit || depth > depthLimit) limit();
    if (entry === null || typeof entry === 'boolean') {
      yield String(entry);
      return;
    }
    if (typeof entry === 'string') {
      // Bound before JSON.stringify can allocate an escaped copy of a huge cell.
      if (entry.length > bytesLimit - budget.bytes) limit();
      yield* quoted(entry);
      return;
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      yield JSON.stringify(entry);
      return;
    }
    if (typeof entry !== 'object' || ancestors.has(entry)) return invalid();
    const array = Array.isArray(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      invalid();
    ancestors.add(entry);
    try {
      const keys = Reflect.ownKeys(entry);
      if (array) {
        if (entry.length > valuesLimit - budget.values) limit();
        if (keys.length !== entry.length + 1) invalid();
        yield '[';
        for (let index = 0; index < entry.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
          if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
          if (index) yield ',';
          yield* pieces(descriptor.value, depth + 1);
        }
        yield ']';
      } else {
        yield '{';
        let first = true;
        for (const key of keys) {
          if (typeof key !== 'string') return invalid();
          const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
          if (!descriptor.enumerable || !('value' in descriptor)) invalid();
          if (descriptor.value === undefined) continue;
          if (!first) yield ',';
          first = false;
          if (key.length > bytesLimit - budget.bytes) limit();
          yield* quoted(key);
          yield ':';
          yield* pieces(descriptor.value, depth + 1);
        }
        yield '}';
      }
    } finally {
      ancestors.delete(entry);
    }
  }

  let output = new Uint8Array(chunkBytes);
  let offset = 0;
  let fragments: string[] = [];
  let fragmentCharacters = 0;
  function* flush(): Generator<Uint8Array> {
    const text = fragments.join('');
    fragments = [];
    fragmentCharacters = 0;
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 32_768, text.length);
      // A UTF-16 surrogate pair must be encoded together even at a batching boundary.
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(text.slice(start, end));
      try {
        budget.bytes += bytes.byteLength;
        if (budget.bytes > bytesLimit) limit();
        for (let position = 0; position < bytes.length; ) {
          const count = Math.min(output.length - offset, bytes.length - position);
          output.set(bytes.subarray(position, position + count), offset);
          offset += count;
          position += count;
          if (offset === output.length) {
            yield output;
            output = new Uint8Array(chunkBytes);
            offset = 0;
          }
        }
      } finally {
        bytes.fill(0);
      }
      start = end;
    }
  }
  try {
    for (const piece of pieces(value, initialDepth)) {
      fragments.push(piece);
      fragmentCharacters += piece.length;
      if (fragmentCharacters >= 32_768) yield* flush();
    }
    yield* flush();
    if (offset) yield output.slice(0, offset);
  } finally {
    output.fill(0);
    fragments.length = 0;
  }
}

/** Symmetric bounds apply after parsing authenticated logical JSON too. */
export function validateLogicalJson(
  value: unknown,
  budget: LogicalJsonBudget,
  initialDepth = 0,
): void {
  function visit(entry: unknown, depth: number): void {
    if (++budget.values > logicalJsonLimits.values || depth > logicalJsonLimits.depth) limit();
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number' && Number.isFinite(entry)) return;
    if (!entry || typeof entry !== 'object') invalid();
    // JSON.parse supplies dense arrays and plain, data-only objects; do not accept
    // prototypes/getters if this validator is used independently in future.
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype) invalid();
      for (const item of entry) visit(item, depth + 1);
    } else {
      if (
        Object.getPrototypeOf(entry) !== Object.prototype &&
        Object.getPrototypeOf(entry) !== null
      )
        invalid();
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(entry))) {
        if (!descriptor.enumerable || !('value' in descriptor)) invalid();
        visit(descriptor.value, depth + 1);
      }
    }
  }
  visit(value, initialDepth);
}

export function parseLogicalJson(
  text: string,
  budget: LogicalJsonBudget,
  initialDepth = 0,
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid();
  }
  validateLogicalJson(value, budget, initialDepth);
  return value;
}
