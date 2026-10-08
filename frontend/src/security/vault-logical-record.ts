import { base64url, objectFields, safeInteger, unbase64url, utf8 } from './vault-codec';
import { VaultCrypto, type VaultKeys } from './vault-crypto';
import { VaultCryptoError } from './vault-errors';
import {
  logicalJsonChunks,
  logicalJsonLimits,
  parseLogicalJson,
  type LogicalJsonBudget,
} from './vault-logical-json';
import { VaultRecordCodec, type VaultPartition } from './vault-record-codec';
import { type VaultStore } from './vault-schema';
import { VaultStorageError, type VaultPhysicalRecord } from './vault-storage';

export { logicalJsonLimits } from './vault-logical-json';
const snapshotBrand = Symbol('authenticated logical record');
export interface VaultLogicalSnapshot {
  readonly rootId: string;
  readonly revision: number;
  readonly chunkIds: readonly string[];
  readonly [snapshotBrand]: true;
}
export interface VaultLogicalProjection<T = unknown> {
  logicalId: string;
  projection: T;
  chunkIds: readonly string[];
  snapshot: VaultLogicalSnapshot;
}
export interface VaultLogicalRead<T = unknown> extends VaultLogicalProjection {
  value: T;
}
export interface VaultLogicalBundle {
  root: VaultPhysicalRecord;
  /** Root plus new chunks only; reused immutable chunks must not be rewritten. */
  records: readonly VaultPhysicalRecord[];
  /** Delete these previous chunk IDs in the same atomic commit as records. */
  obsoleteIds: readonly string[];
  snapshot: VaultLogicalSnapshot;
}
export interface VaultLogicalEncodeOptions {
  projection?: unknown;
  previous?: VaultLogicalSnapshot;
  /** Separate large object fields so changing metadata can reuse their chunks. */
  payloadFields?: readonly string[];
  chunkBytes?: number;
}
export type VaultPhysicalRead = (
  ids: readonly string[],
) => Promise<readonly (VaultPhysicalRecord | undefined)[]>;

interface ChunkReference {
  id: string;
  tag: string;
  index: number;
  bytes: number;
  contentHash: string;
  ciphertextHash: string;
}
interface Payload {
  field: string | null;
  bytes: number;
  values: number;
  inline: string | null;
  chunks: ChunkReference[];
}
interface Manifest {
  format: 'visualnerve-logical-record';
  version: 1;
  logicalId: string;
  mode: 'whole' | 'fields';
  projection: unknown;
  bytes: number;
  values: number;
  chunkBytes: number;
  payloads: Payload[];
}
interface SnapshotMaterial {
  manifest: Manifest;
  store: VaultStore;
  vaultId: string;
  keyVersion: number;
}
const integrity = (): never => {
  throw new VaultStorageError(
    422,
    'VAULT_INTEGRITY_FAILED',
    'Encrypted workspace record integrity check failed.',
  );
};
const invalid = (): never => {
  throw new VaultCryptoError('INVALID_SCHEMA');
};
const limit = (): never => {
  throw new VaultCryptoError('LIMIT_EXCEEDED');
};
const token = (value: unknown) => base64url(unbase64url(value, 32));
const fieldName = (value: unknown): string => {
  if (typeof value !== 'string' || !value || utf8(value).length > 1024) return invalid();
  return value;
};
const idsOf = (manifest: Manifest) =>
  manifest.payloads.flatMap((payload) => payload.chunks.map((c) => c.id));

/**
 * Logical JSON can exceed a physical record's 16 MiB / 2M-value crypto bounds.
 * Only encrypted manifests have query partitions. Chunks are immutable and
 * contextual, and no decoded value is published until every chunk authenticates.
 */
export class VaultLogicalRecordCodec {
  private records: VaultRecordCodec;
  private snapshots = new WeakMap<VaultLogicalSnapshot, SnapshotMaterial>();

  constructor(
    private crypto: VaultCrypto,
    private random: Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
  ) {
    this.records = new VaultRecordCodec(crypto);
  }

  id(keys: VaultKeys, store: VaultStore, logicalId: string) {
    return this.records.id(keys, store, logicalId);
  }
  partition(keys: VaultKeys, store: VaultStore, partition: VaultPartition) {
    return this.records.partition(keys, store, partition);
  }
  rootPartition(keys: VaultKeys, store: VaultStore) {
    return this.crypto.indexToken(keys, `logical-root:${store}`, 'root');
  }
  private chunkId(
    keys: VaultKeys,
    store: VaultStore,
    logicalId: string,
    field: string | null,
    chunk: Pick<ChunkReference, 'index' | 'tag'>,
  ) {
    return this.crypto.indexToken(
      keys,
      `logical-chunk:${store}`,
      JSON.stringify([logicalId, field, chunk.index, chunk.tag]),
    );
  }
  private contentHash(keys: VaultKeys, store: VaultStore, bytes: Uint8Array) {
    return this.crypto.indexToken(keys, `logical-content:${store}`, bytes);
  }
  private ciphertextHash(keys: VaultKeys, record: VaultPhysicalRecord) {
    return this.crypto.indexToken(
      keys,
      `logical-ciphertext:${record.store}`,
      JSON.stringify([record.encrypted.iv, record.encrypted.ciphertext]),
    );
  }
  private snapshot(root: VaultPhysicalRecord, manifest: Manifest): VaultLogicalSnapshot {
    const snapshot: VaultLogicalSnapshot = Object.freeze({
      rootId: root.id,
      revision: root.revision,
      chunkIds: Object.freeze(idsOf(manifest)),
      [snapshotBrand]: true as const,
    });
    this.snapshots.set(snapshot, {
      manifest,
      store: root.store,
      vaultId: root.encrypted.vaultId,
      keyVersion: root.encrypted.keyVersion,
    });
    return snapshot;
  }
  private projection(value: unknown): unknown {
    const budget = { bytes: 0, values: 0 };
    const parts: Uint8Array[] = [];
    try {
      for (const bytes of logicalJsonChunks(value, {
        chunkBytes: logicalJsonLimits.projectionBytes,
        budget,
        bytesLimit: logicalJsonLimits.projectionBytes,
        valuesLimit: 100_000,
        depthLimit: 32,
      })) {
        try {
          parts.push(bytes.slice());
        } finally {
          bytes.fill(0);
        }
      }
      // A projection is deliberately bounded and copied before any async work.
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(parts[0])) as unknown;
    } finally {
      for (const bytes of parts) bytes.fill(0);
    }
  }

  async encode<T>(
    keys: VaultKeys,
    store: VaultStore,
    logicalId: string,
    value: T,
    revision: number,
    partitions: VaultPartition[] = [],
    options: VaultLogicalEncodeOptions = {},
  ): Promise<VaultLogicalBundle> {
    safeInteger(revision, 1, Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(partitions) || partitions.length > 63) return limit();
    const chunkBytes = options.chunkBytes ?? logicalJsonLimits.chunkBytes;
    safeInteger(chunkBytes, logicalJsonLimits.minimumChunkBytes, logicalJsonLimits.chunkBytes);
    const fields = options.payloadFields ? [...options.payloadFields] : [];
    if (fields.length > 16 || new Set(fields).size !== fields.length) return invalid();
    fields.forEach(fieldName);
    const projection = this.projection(options.projection ?? null);
    const previous = options.previous ? this.snapshots.get(options.previous) : undefined;
    const id = await this.id(keys, store, logicalId);
    const rootToken = await this.rootPartition(keys, store);
    const tokens = [
      ...new Set([
        rootToken,
        ...(await Promise.all(
          partitions.map((partition) => this.partition(keys, store, partition)),
        )),
      ]),
    ].sort();
    if (
      options.previous &&
      (!previous ||
        previous.store !== store ||
        previous.vaultId !== keys.vaultId ||
        previous.keyVersion !== keys.keyVersion ||
        previous.manifest.logicalId !== logicalId ||
        options.previous.rootId !== id ||
        options.previous.revision !== revision - 1)
    )
      return integrity();
    const budget: LogicalJsonBudget = { bytes: 0, values: 0 };
    const writes: VaultPhysicalRecord[] = [];
    const payloads: Payload[] = [];
    let chunkCount = 0;
    const encodePayload = async (field: string | null, entry: unknown) => {
      const startBytes = budget.bytes,
        startValues = budget.values;
      const old =
        previous?.manifest.chunkBytes === chunkBytes
          ? previous.manifest.payloads.find((p) => p.field === field)
          : undefined;
      const chunks: ChunkReference[] = [];
      let inline: string | null = null;
      let index = 0;
      for (const bytes of logicalJsonChunks(entry, {
        chunkBytes,
        budget,
        initialDepth: fields.length && field !== null ? 1 : 0,
      })) {
        try {
          // A single small JSON stream stays in the encrypted root. It is encoded
          // as bytes so deep but valid values do not consume manifest nesting.
          if (index === 0 && bytes.length < logicalJsonLimits.inlineBytes) {
            inline = base64url(bytes);
            index++;
            continue;
          }
          if (++chunkCount > logicalJsonLimits.chunks) return limit();
          const contentHash = await this.contentHash(keys, store, bytes);
          const retained = old?.chunks[index];
          if (retained && retained.bytes === bytes.length && retained.contentHash === contentHash) {
            chunks.push(retained);
          } else {
            const tag = base64url(this.random.getRandomValues(new Uint8Array(16)));
            const recordId = await this.chunkId(keys, store, logicalId, field, { index, tag });
            const encrypted = await this.crypto.encryptRecord(
              keys,
              { store, recordId, recordVersion: 1 },
              {
                format: 'visualnerve-logical-chunk',
                version: 1,
                logicalId,
                field,
                index,
                tag,
                data: base64url(bytes),
              },
            );
            const record: VaultPhysicalRecord = Object.freeze({
              id: recordId,
              store,
              partitions: Object.freeze([]) as unknown as string[],
              revision: 1,
              encrypted,
            });
            chunks.push({
              id: recordId,
              tag,
              index,
              bytes: bytes.length,
              contentHash,
              ciphertextHash: await this.ciphertextHash(keys, record),
            });
            writes.push(record);
          }
          index++;
        } finally {
          bytes.fill(0);
        }
      }
      // Only the final short stream can be inline; a stream yielding a full chunk
      // is always chunked, including its final short piece.
      if (inline !== null && chunks.length) return invalid();
      payloads.push({
        field,
        bytes: budget.bytes - startBytes,
        values: budget.values - startValues,
        inline,
        chunks,
      });
    };
    if (fields.length) {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      )
        return invalid();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const header: [string, unknown][] = [];
      for (const name of Reflect.ownKeys(value)) {
        if (typeof name !== 'string') return invalid();
        const descriptor = descriptors[name];
        if (!descriptor.enumerable || !('value' in descriptor)) return invalid();
        if (!fields.includes(name) && descriptor.value !== undefined)
          header.push([name, descriptor.value]);
      }
      await encodePayload(null, Object.fromEntries(header));
      for (const field of fields) {
        const descriptor = descriptors[field];
        if (descriptor && descriptor.value !== undefined)
          await encodePayload(field, descriptor.value);
      }
    } else await encodePayload(null, value);
    const manifest: Manifest = {
      format: 'visualnerve-logical-record',
      version: 1,
      logicalId,
      mode: fields.length ? 'fields' : 'whole',
      projection,
      bytes: budget.bytes,
      values: budget.values,
      chunkBytes,
      payloads,
    };
    // A reserved root partition cannot collide with caller-controlled index names.
    // Encrypt the reserved partition together with ordinary tokens; the base
    // codec's private wrapper authenticates the complete physical token list.
    const encrypted = await this.crypto.encryptRecord(
      keys,
      { store, recordId: id, recordVersion: revision },
      {
        format: 'visualnerve-private-record',
        version: 1,
        logicalId,
        partitions: tokens,
        value: manifest,
      },
    );
    const root: VaultPhysicalRecord = Object.freeze({
      id,
      store,
      revision,
      partitions: Object.freeze(tokens) as unknown as string[],
      encrypted,
    });
    const retainedIds = new Set(idsOf(manifest));
    return {
      root,
      records: Object.freeze([root, ...writes]),
      obsoleteIds: Object.freeze(
        previous ? idsOf(previous.manifest).filter((oldId) => !retainedIds.has(oldId)) : [],
      ),
      snapshot: this.snapshot(root, manifest),
    };
  }

  private async manifest(
    keys: VaultKeys,
    root: VaultPhysicalRecord,
    expectedLogicalId?: string,
  ): Promise<Manifest> {
    const input = await this.records.decode<unknown>(keys, root, expectedLogicalId);
    const raw = objectFields(input, [
      'format',
      'version',
      'logicalId',
      'mode',
      'projection',
      'bytes',
      'values',
      'chunkBytes',
      'payloads',
    ]);
    if (
      raw.format !== 'visualnerve-logical-record' ||
      raw.version !== 1 ||
      (raw.mode !== 'whole' && raw.mode !== 'fields') ||
      typeof raw.logicalId !== 'string' ||
      (await this.id(keys, root.store, raw.logicalId)) !== root.id ||
      !Array.isArray(raw.payloads) ||
      !raw.payloads.length ||
      raw.payloads.length > 17 ||
      !root.partitions.includes(await this.rootPartition(keys, root.store)) ||
      root.partitions.length > 64 ||
      new Set(root.partitions).size !== root.partitions.length
    )
      return integrity();
    const bytes = safeInteger(raw.bytes, 1, logicalJsonLimits.bytes);
    const values = safeInteger(raw.values, 1, logicalJsonLimits.values);
    const chunkBytes = safeInteger(
      raw.chunkBytes,
      logicalJsonLimits.minimumChunkBytes,
      logicalJsonLimits.chunkBytes,
    );
    let totalBytes = 0,
      totalValues = 0,
      chunkCount = 0;
    const seenIds = new Set<string>(),
      seenFields = new Set<string | null>();
    const payloads = raw.payloads.map((inputPayload, payloadIndex): Payload => {
      const payload = objectFields(inputPayload, ['field', 'bytes', 'values', 'inline', 'chunks']);
      const field = payload.field === null ? null : fieldName(payload.field);
      if (
        (payloadIndex === 0 ? field !== null : field === null) ||
        seenFields.has(field) ||
        !Array.isArray(payload.chunks)
      )
        return integrity();
      seenFields.add(field);
      const payloadChunks = payload.chunks;
      const payloadBytes = safeInteger(payload.bytes, 1, bytes);
      const payloadValues = safeInteger(payload.values, 1, values);
      totalBytes += payloadBytes;
      totalValues += payloadValues;
      let inline: string | null = null;
      if (payload.inline !== null) {
        const decoded = unbase64url(payload.inline, 1, logicalJsonLimits.inlineBytes);
        try {
          if (decoded.length !== payloadBytes || payloadChunks.length) return integrity();
          inline = payload.inline as string;
        } finally {
          decoded.fill(0);
        }
      } else if (!payloadChunks.length) return integrity();
      let chunkTotal = 0;
      const chunks = payloadChunks.map((inputChunk, index): ChunkReference => {
        if (++chunkCount > logicalJsonLimits.chunks) return limit();
        const chunk = objectFields(inputChunk, [
          'id',
          'tag',
          'index',
          'bytes',
          'contentHash',
          'ciphertextHash',
        ]);
        const id = token(chunk.id),
          tag = base64url(unbase64url(chunk.tag, 16));
        if (chunk.index !== index || seenIds.has(id)) return integrity();
        seenIds.add(id);
        const size = safeInteger(chunk.bytes, 1, chunkBytes);
        if (index < payloadChunks.length - 1 && size !== chunkBytes) return integrity();
        chunkTotal += size;
        return {
          id,
          tag,
          index,
          bytes: size,
          contentHash: token(chunk.contentHash),
          ciphertextHash: token(chunk.ciphertextHash),
        };
      });
      if (inline === null && chunkTotal !== payloadBytes) return integrity();
      return { field, bytes: payloadBytes, values: payloadValues, inline, chunks };
    });
    if (
      totalBytes !== bytes ||
      totalValues !== values ||
      (raw.mode === 'whole' && payloads.length !== 1)
    )
      return integrity();
    for (const payload of payloads)
      for (const chunk of payload.chunks)
        if (
          (await this.chunkId(keys, root.store, raw.logicalId, payload.field, chunk)) !==
            chunk.id ||
          chunk.id === root.id
        )
          return integrity();
    return {
      format: 'visualnerve-logical-record',
      version: 1,
      logicalId: raw.logicalId,
      mode: raw.mode,
      projection: this.projection(raw.projection),
      bytes,
      values,
      chunkBytes,
      payloads,
    };
  }

  async project<T = unknown>(
    keys: VaultKeys,
    root: VaultPhysicalRecord,
    expectedLogicalId?: string,
  ): Promise<VaultLogicalProjection<T>> {
    const manifest = await this.manifest(keys, root, expectedLogicalId);
    // Metadata copying may take time; recheck the key capability before publish.
    await this.rootPartition(keys, root.store);
    const snapshot = this.snapshot(root, manifest);
    return {
      logicalId: manifest.logicalId,
      projection: manifest.projection as T,
      chunkIds: snapshot.chunkIds,
      snapshot,
    };
  }

  async read<T = unknown>(
    keys: VaultKeys,
    root: VaultPhysicalRecord,
    read: VaultPhysicalRead,
    expectedLogicalId?: string,
  ): Promise<VaultLogicalRead<T>> {
    const manifest = await this.manifest(keys, root, expectedLogicalId);
    const budget: LogicalJsonBudget = { bytes: 0, values: 0 };
    const values: unknown[] = [];
    for (const payload of manifest.payloads) {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const text: string[] = [];
      let payloadBytes = 0;
      const append = (bytes: Uint8Array) => {
        try {
          payloadBytes += bytes.length;
          try {
            text.push(decoder.decode(bytes, { stream: true }));
          } catch {
            return invalid();
          }
        } finally {
          bytes.fill(0);
        }
      };
      if (payload.inline !== null)
        append(unbase64url(payload.inline, 1, logicalJsonLimits.inlineBytes));
      else
        for (let start = 0; start < payload.chunks.length; start += 16) {
          const batch = payload.chunks.slice(start, start + 16);
          const records = await read(batch.map((chunk) => chunk.id));
          if (!Array.isArray(records) || records.length !== batch.length) return integrity();
          for (let offset = 0; offset < batch.length; offset++) {
            const chunk = batch[offset],
              record = records[offset];
            if (
              !record ||
              record.id !== chunk.id ||
              record.store !== root.store ||
              record.revision !== 1 ||
              !Array.isArray(record.partitions) ||
              record.partitions.length ||
              (await this.ciphertextHash(keys, record)) !== chunk.ciphertextHash
            )
              return integrity();
            const input = await this.crypto.decryptRecord<unknown>(
              keys,
              { store: root.store, recordId: chunk.id, recordVersion: 1 },
              record.encrypted,
            );
            const decoded = objectFields(input, [
              'format',
              'version',
              'logicalId',
              'field',
              'index',
              'tag',
              'data',
            ]);
            if (
              decoded.format !== 'visualnerve-logical-chunk' ||
              decoded.version !== 1 ||
              decoded.logicalId !== manifest.logicalId ||
              decoded.field !== payload.field ||
              decoded.index !== chunk.index ||
              decoded.tag !== chunk.tag
            )
              return integrity();
            const bytes = unbase64url(decoded.data, chunk.bytes);
            try {
              if ((await this.contentHash(keys, root.store, bytes)) !== chunk.contentHash)
                return integrity();
              append(bytes);
            } finally {
              bytes.fill(0);
            }
          }
        }
      try {
        text.push(decoder.decode());
      } catch {
        return invalid();
      }
      if (payloadBytes !== payload.bytes) return integrity();
      const previousValues = budget.values;
      let json: string;
      try {
        json = text.join('');
      } catch {
        return limit();
      }
      text.length = 0;
      const value = parseLogicalJson(
        json,
        budget,
        manifest.mode === 'fields' && payload.field !== null ? 1 : 0,
      );
      if (budget.values - previousValues !== payload.values) return integrity();
      budget.bytes += payloadBytes;
      values.push(value);
    }
    if (budget.bytes !== manifest.bytes || budget.values !== manifest.values) return integrity();
    let value = values[0];
    if (manifest.mode === 'fields') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return integrity();
      for (let index = 1; index < manifest.payloads.length; index++) {
        const field = manifest.payloads[index].field!;
        if (Object.hasOwn(value, field)) return integrity();
        Object.defineProperty(value, field, {
          value: values[index],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
    await this.rootPartition(keys, root.store);
    const snapshot = this.snapshot(root, manifest);
    return {
      value: value as T,
      logicalId: manifest.logicalId,
      projection: manifest.projection,
      chunkIds: snapshot.chunkIds,
      snapshot,
    };
  }
  async decode<T = unknown>(
    keys: VaultKeys,
    root: VaultPhysicalRecord,
    read: VaultPhysicalRead,
    expectedLogicalId?: string,
  ): Promise<T> {
    return (await this.read<T>(keys, root, read, expectedLogicalId)).value;
  }
}
