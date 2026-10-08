import {
  workspaceStoreNames,
  workspaceStoreDefinitions,
  type WorkspaceRecordMap,
  type WorkspaceStoreName,
} from './contracts';
import { logicalJsonLimits, type LogicalJsonBudget } from '../security/vault-logical-json';
import { VaultCryptoError } from '../security/vault-errors';

export type MigrationRecords = { [K in WorkspaceStoreName]: WorkspaceRecordMap[K][] };
export type MigrationCounts = { [K in WorkspaceStoreName]: number };
const encoder = new TextEncoder();
const invalid = (): never => {
  throw new VaultCryptoError('INVALID_SCHEMA');
};
const limit = (): never => {
  throw new VaultCryptoError('LIMIT_EXCEEDED');
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Canonical UTF-8 is streamed; large row arrays are not copied or stringified together. */
function* canonicalChunks(value: unknown, budget: LogicalJsonBudget): Generator<Uint8Array> {
  const ancestors = new Set<object>();
  function* quoted(text: string): Generator<string> {
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
  function* visit(entry: unknown, depth: number): Generator<string> {
    if (++budget.values > logicalJsonLimits.values || depth > logicalJsonLimits.depth) limit();
    if (entry === null || typeof entry === 'boolean') {
      yield String(entry);
      return;
    }
    if (typeof entry === 'string') {
      yield* quoted(entry);
      return;
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      yield JSON.stringify(entry);
      return;
    }
    if (!entry || typeof entry !== 'object' || ancestors.has(entry)) return invalid();
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
        if (
          keys.length !== entry.length + 1 ||
          entry.length > logicalJsonLimits.values - budget.values
        )
          invalid();
        yield '[';
        for (let i = 0; i < entry.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(entry, String(i));
          if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
          if (i) yield ',';
          yield* visit(descriptor.value, depth + 1);
        }
        yield ']';
      } else {
        if (keys.some((key) => typeof key !== 'string')) invalid();
        yield '{';
        let first = true;
        for (const key of (keys as string[]).sort(compare)) {
          const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
          if (!descriptor.enumerable || !('value' in descriptor)) invalid();
          if (descriptor.value === undefined) continue;
          if (!first) yield ',';
          first = false;
          yield* quoted(key);
          yield ':';
          yield* visit(descriptor.value, depth + 1);
        }
        yield '}';
      }
    } finally {
      ancestors.delete(entry);
    }
  }
  let output = new Uint8Array(logicalJsonLimits.chunkBytes),
    offset = 0;
  let fragments: string[] = [],
    characters = 0;
  function* flush(): Generator<Uint8Array> {
    const text = fragments.join('');
    fragments = [];
    characters = 0;
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 32_768, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(text.slice(start, end));
      try {
        budget.bytes += bytes.byteLength;
        if (budget.bytes > logicalJsonLimits.bytes) limit();
        for (let pos = 0; pos < bytes.length; ) {
          const count = Math.min(output.length - offset, bytes.length - pos);
          output.set(bytes.subarray(pos, pos + count), offset);
          offset += count;
          pos += count;
          if (offset === output.length) {
            yield output;
            output = new Uint8Array(logicalJsonLimits.chunkBytes);
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
    for (const piece of visit(value, 0)) {
      fragments.push(piece);
      characters += piece.length;
      if (characters >= 32_768) yield* flush();
    }
    yield* flush();
    if (offset) yield output.slice(0, offset);
  } finally {
    output.fill(0);
    fragments.length = 0;
  }
}

async function hash(bytes: Uint8Array<ArrayBuffer>) {
  if (!crypto.subtle) throw new VaultCryptoError('UNSUPPORTED_CRYPTO');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
async function combine(previous: Uint8Array, bytes: Uint8Array) {
  const input = new Uint8Array(previous.length + bytes.length);
  input.set(previous);
  input.set(bytes, previous.length);
  try {
    return await hash(input);
  } finally {
    input.fill(0);
  }
}
async function recordDigest(value: unknown, budget: LogicalJsonBudget, check: () => Promise<void>) {
  let digest = await hash(encoder.encode('visualnerve-migration-record-v1'));
  let size = 0,
    chunks = 0;
  for (const bytes of canonicalChunks(value, budget)) {
    try {
      await check();
      digest = await combine(digest, bytes);
      size += bytes.length;
      chunks++;
    } finally {
      bytes.fill(0);
    }
  }
  return combine(digest, encoder.encode(JSON.stringify(['end', size, chunks])));
}
/** Shared private in-memory equality proof; temporary canonical chunks are overwritten. */
export async function logicalRecordDigest(
  value: unknown,
  check: () => Promise<void> = async () => {},
  budget: LogicalJsonBudget = { bytes: 0, values: 0 },
): Promise<string> {
  const digest = await recordDigest(value, budget, check);
  await check();
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function migrationCounts(records: MigrationRecords): MigrationCounts {
  return Object.fromEntries(
    workspaceStoreNames.map((store) => [store, records[store].length]),
  ) as MigrationCounts;
}
/** A private verification receipt, never a public lookup/content index. */
export async function migrationDigest(
  records: MigrationRecords,
  check: () => Promise<void> = async () => {},
) {
  let digest = await hash(encoder.encode('visualnerve-exact-workspace-migration-v1'));
  const budget = { bytes: 0, values: 0 };
  for (const store of workspaceStoreNames) {
    await check();
    const primary = workspaceStoreDefinitions[store].primaryKey;
    const values = [...records[store]].sort((a, b) =>
      compare(Reflect.get(a, primary), Reflect.get(b, primary)),
    );
    digest = await combine(digest, encoder.encode(JSON.stringify([store, values.length])));
    for (const record of values)
      digest = await combine(digest, await recordDigest(record, budget, check));
  }
  await check();
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
