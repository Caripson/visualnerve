import { VaultCrypto, type VaultKeys } from './vault-crypto';
import { parseEncryptedVaultRecord, type VaultStore } from './vault-schema';
import { VaultStorageError, type VaultPhysicalRecord } from './vault-storage';

interface PrivateRecord<T> {
  format: 'visualnerve-private-record';
  version: 1;
  logicalId: string;
  partitions: string[];
  value: T;
}
export interface VaultPartition {
  index: string;
  value: string;
}

/** Canonical omission of optional object fields; arrays and non-JSON data are strict. */
export function normalizeVaultValue(value: unknown, depth = 0): unknown {
  if (depth > 64)
    throw new VaultStorageError(
      422,
      'INVALID_VAULT_RECORD',
      'Workspace data is nested too deeply.',
    );
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeVaultValue(item, depth + 1));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(value))
      if (item !== undefined) normalized[key] = normalizeVaultValue(item, depth + 1);
    return normalized;
  }
  throw new VaultStorageError(
    422,
    'INVALID_VAULT_RECORD',
    'Workspace records must contain JSON data.',
  );
}

/**
 * Protects logical primary keys, equality partitions and history fingerprints.
 * Partition metadata is repeated inside the ciphertext and checked after decode,
 * so changing an index token cannot quietly change the meaning of a record.
 */
export class VaultRecordCodec {
  constructor(private crypto: VaultCrypto) {}

  id(keys: VaultKeys, store: VaultStore, logicalId: string) {
    if (
      typeof logicalId !== 'string' ||
      !logicalId ||
      new TextEncoder().encode(logicalId).byteLength > 1024
    )
      throw new VaultStorageError(
        422,
        'INVALID_VAULT_RECORD',
        'Invalid workspace record identifier.',
      );
    return this.crypto.indexToken(keys, `primary:${store}`, logicalId);
  }

  partition(keys: VaultKeys, store: VaultStore, partition: VaultPartition) {
    if (
      !partition ||
      typeof partition.index !== 'string' ||
      !partition.index ||
      partition.index.length > 128 ||
      typeof partition.value !== 'string' ||
      new TextEncoder().encode(partition.value).byteLength > 4096
    )
      throw new VaultStorageError(
        422,
        'INVALID_VAULT_RECORD',
        'Invalid workspace query partition.',
      );
    return this.crypto.indexToken(keys, `partition:${store}:${partition.index}`, partition.value);
  }

  async encode<T>(
    keys: VaultKeys,
    store: VaultStore,
    logicalId: string,
    value: T,
    revision: number,
    partitions: VaultPartition[] = [],
  ): Promise<VaultPhysicalRecord> {
    const id = await this.id(keys, store, logicalId);
    const tokens = [
      ...new Set(
        await Promise.all(partitions.map((partition) => this.partition(keys, store, partition))),
      ),
    ].sort();
    const payload: PrivateRecord<unknown> = {
      format: 'visualnerve-private-record',
      version: 1,
      logicalId,
      partitions: tokens,
      value: normalizeVaultValue(value),
    };
    const encrypted = await this.crypto.encryptRecord(
      keys,
      { store, recordId: id, recordVersion: revision },
      payload,
    );
    return { id, store, partitions: tokens, revision, encrypted };
  }

  async decode<T>(
    keys: VaultKeys,
    record: VaultPhysicalRecord,
    expectedLogicalId?: string,
  ): Promise<T> {
    const encrypted = parseEncryptedVaultRecord(record.encrypted);
    const value = await this.crypto.decryptRecord<PrivateRecord<T>>(
      keys,
      { store: record.store, recordId: record.id, recordVersion: record.revision },
      encrypted,
    );
    if (
      !value ||
      typeof value !== 'object' ||
      value.format !== 'visualnerve-private-record' ||
      value.version !== 1 ||
      typeof value.logicalId !== 'string' ||
      !Array.isArray(value.partitions) ||
      JSON.stringify(value.partitions) !== JSON.stringify(record.partitions) ||
      (expectedLogicalId !== undefined && value.logicalId !== expectedLogicalId) ||
      (await this.id(keys, record.store, value.logicalId)) !== record.id
    )
      throw new VaultStorageError(
        422,
        'VAULT_INTEGRITY_FAILED',
        'Encrypted workspace record integrity check failed.',
      );
    return value.value;
  }
}
