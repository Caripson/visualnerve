import {
  boundedString,
  objectFields,
  RECORD_BYTES_LIMIT,
  safeInteger,
  unbase64url,
} from './vault-codec';
import { VaultCryptoError } from './vault-errors';

export const VAULT_FORMAT_VERSION = 1 as const;
export const PASSWORD_KDF_ITERATIONS = 600_000;
export const MAX_PASSWORD_KDF_ITERATIONS = 2_000_000;
export const MAX_KEY_VERSION = 2_147_483_647;
export const BACKUP_CHUNK_BYTES = 1024 * 1024;
export const MIN_BACKUP_CHUNK_BYTES = 64 * 1024;
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;
export const MAX_BACKUP_CHUNKS = 4096;
export const VAULT_STORES = [
  'diagrams',
  'nodes',
  'edges',
  'owners',
  'settings',
  'templates',
  'datasets',
  'historySnapshots',
  'historyContents',
  'historySources',
  'historyRows',
  'simulationModels',
  'simulationRuns',
  'simulationCheckpoints',
  // Private collaboration records deliberately have no logical workspace/API/export table.
  'collaboration',
] as const;
export type VaultStore = (typeof VAULT_STORES)[number];

export interface PasswordKdf {
  readonly name: 'PBKDF2';
  readonly hash: 'SHA-256';
  readonly version: 1;
  readonly iterations: number;
  readonly salt: string;
}
export interface SealedVaultBytes {
  readonly iv: string;
  readonly ciphertext: string;
}
export interface PasswordEnvelope extends SealedVaultBytes {
  readonly kind: 'password';
  readonly kdf: PasswordKdf;
}
export interface RecoveryEnvelope extends SealedVaultBytes {
  readonly kind: 'recovery';
}
export interface VaultHeader {
  readonly format: 'visualnerve-vault';
  readonly version: 1;
  readonly vaultId: string;
  readonly keyVersion: number;
  readonly password: PasswordEnvelope;
  readonly recovery: RecoveryEnvelope;
  readonly authentication: string;
}
export interface VaultRecordContext {
  readonly store: VaultStore;
  readonly recordId: string;
  readonly recordVersion: number;
}
export interface EncryptedVaultRecord extends VaultRecordContext, SealedVaultBytes {
  readonly format: 'visualnerve-record';
  readonly version: 1;
  readonly vaultId: string;
  readonly keyVersion: number;
}
export interface EncryptedVaultBackup {
  readonly format: 'visualnerve-backup';
  readonly version: 1;
  readonly header: VaultHeader;
  readonly backupId: string;
  readonly chunkSize: number;
  readonly totalBytes: number;
  readonly chunks: readonly SealedVaultBytes[];
  readonly manifest: SealedVaultBytes;
}
export interface VaultBackupManifest {
  readonly format: 'visualnerve-backup-manifest';
  readonly version: 1;
  readonly backupId: string;
  readonly totalBytes: number;
  readonly chunkSize: number;
  readonly chunkHashes: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function vaultIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new VaultCryptoError('INVALID_SCHEMA');
  return value;
}
export function validateIterations(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== 'number' ||
    value < PASSWORD_KDF_ITERATIONS ||
    value > MAX_PASSWORD_KDF_ITERATIONS
  )
    throw new VaultCryptoError('UNSAFE_KDF');
  return value;
}
export function parsePasswordKdf(value: unknown): PasswordKdf {
  const fields = objectFields(value, ['name', 'hash', 'version', 'iterations', 'salt']);
  if (fields.name !== 'PBKDF2' || fields.hash !== 'SHA-256' || fields.version !== 1)
    throw new VaultCryptoError('UNSAFE_KDF');
  unbase64url(fields.salt, 16);
  return Object.freeze({
    name: 'PBKDF2',
    hash: 'SHA-256',
    version: 1,
    iterations: validateIterations(fields.iterations),
    salt: fields.salt as string,
  });
}
export function parseSealedBytes(
  value: unknown,
  minBytes: number,
  maxBytes = minBytes,
): SealedVaultBytes {
  const fields = objectFields(value, ['iv', 'ciphertext']);
  unbase64url(fields.iv, 12);
  unbase64url(fields.ciphertext, minBytes + 16, maxBytes + 16);
  return Object.freeze({ iv: fields.iv as string, ciphertext: fields.ciphertext as string });
}
export function parseVaultHeader(value: unknown): VaultHeader {
  const fields = objectFields(value, [
    'format',
    'version',
    'vaultId',
    'keyVersion',
    'password',
    'recovery',
    'authentication',
  ]);
  if (fields.format !== 'visualnerve-vault' || fields.version !== 1)
    throw new VaultCryptoError('INVALID_SCHEMA');
  const password = objectFields(fields.password, ['kind', 'kdf', 'iv', 'ciphertext']);
  const recovery = objectFields(fields.recovery, ['kind', 'iv', 'ciphertext']);
  if (password.kind !== 'password' || recovery.kind !== 'recovery')
    throw new VaultCryptoError('INVALID_SCHEMA');
  const passwordBytes = parseSealedBytes({ iv: password.iv, ciphertext: password.ciphertext }, 32);
  const recoveryBytes = parseSealedBytes({ iv: recovery.iv, ciphertext: recovery.ciphertext }, 32);
  unbase64url(fields.authentication, 32);
  return Object.freeze({
    format: 'visualnerve-vault',
    version: 1,
    vaultId: vaultIdentifier(fields.vaultId),
    keyVersion: safeInteger(fields.keyVersion, 1, MAX_KEY_VERSION),
    password: Object.freeze({
      kind: 'password',
      kdf: parsePasswordKdf(password.kdf),
      ...passwordBytes,
    }),
    recovery: Object.freeze({ kind: 'recovery', ...recoveryBytes }),
    authentication: fields.authentication as string,
  });
}
export function validateRecordContext(value: unknown): VaultRecordContext {
  const fields = objectFields(value, ['store', 'recordId', 'recordVersion']);
  if (!VAULT_STORES.includes(fields.store as VaultStore))
    throw new VaultCryptoError('INVALID_SCHEMA');
  return Object.freeze({
    store: fields.store as VaultStore,
    recordId: boundedString(fields.recordId),
    recordVersion: safeInteger(fields.recordVersion, 1, Number.MAX_SAFE_INTEGER),
  });
}
export function parseEncryptedVaultRecord(value: unknown): EncryptedVaultRecord {
  const fields = objectFields(value, [
    'format',
    'version',
    'vaultId',
    'keyVersion',
    'store',
    'recordId',
    'recordVersion',
    'iv',
    'ciphertext',
  ]);
  if (fields.format !== 'visualnerve-record' || fields.version !== 1)
    throw new VaultCryptoError('INVALID_SCHEMA');
  return Object.freeze({
    format: 'visualnerve-record',
    version: 1,
    vaultId: vaultIdentifier(fields.vaultId),
    keyVersion: safeInteger(fields.keyVersion, 1, MAX_KEY_VERSION),
    ...validateRecordContext({
      store: fields.store,
      recordId: fields.recordId,
      recordVersion: fields.recordVersion,
    }),
    ...parseSealedBytes({ iv: fields.iv, ciphertext: fields.ciphertext }, 1, RECORD_BYTES_LIMIT),
  });
}
export function parseEncryptedVaultBackup(value: unknown): EncryptedVaultBackup {
  const fields = objectFields(value, [
    'format',
    'version',
    'header',
    'backupId',
    'chunkSize',
    'totalBytes',
    'chunks',
    'manifest',
  ]);
  if (fields.format !== 'visualnerve-backup' || fields.version !== 1)
    throw new VaultCryptoError('INVALID_SCHEMA');
  const chunkSize = safeInteger(fields.chunkSize, MIN_BACKUP_CHUNK_BYTES, BACKUP_CHUNK_BYTES);
  const totalBytes = safeInteger(fields.totalBytes, 0, MAX_BACKUP_BYTES);
  const count = Math.max(1, Math.ceil(totalBytes / chunkSize));
  if (
    !Array.isArray(fields.chunks) ||
    fields.chunks.length !== count ||
    count > MAX_BACKUP_CHUNKS ||
    Object.keys(fields.chunks).length !== count
  )
    throw new VaultCryptoError('INVALID_SCHEMA');
  const chunks = Array.from({ length: count }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(fields.chunks, String(index));
    if (!descriptor || !('value' in descriptor)) throw new VaultCryptoError('INVALID_SCHEMA');
    const bytes = Math.min(chunkSize, Math.max(0, totalBytes - index * chunkSize));
    return parseSealedBytes(descriptor.value, bytes);
  });
  return Object.freeze({
    format: 'visualnerve-backup',
    version: 1,
    header: parseVaultHeader(fields.header),
    backupId: vaultIdentifier(fields.backupId),
    chunkSize,
    totalBytes,
    chunks: Object.freeze(chunks),
    manifest: parseSealedBytes(fields.manifest, 1, RECORD_BYTES_LIMIT),
  });
}
export function parseBackupManifest(value: unknown): VaultBackupManifest {
  const fields = objectFields(value, [
    'format',
    'version',
    'backupId',
    'totalBytes',
    'chunkSize',
    'chunkHashes',
  ]);
  if (
    fields.format !== 'visualnerve-backup-manifest' ||
    fields.version !== 1 ||
    !Array.isArray(fields.chunkHashes) ||
    fields.chunkHashes.length < 1 ||
    fields.chunkHashes.length > MAX_BACKUP_CHUNKS
  )
    throw new VaultCryptoError('INVALID_SCHEMA');
  if (Object.keys(fields.chunkHashes).length !== fields.chunkHashes.length)
    throw new VaultCryptoError('INVALID_SCHEMA');
  const hashes = Array.from({ length: fields.chunkHashes.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(fields.chunkHashes, String(index));
    if (!descriptor || !('value' in descriptor)) throw new VaultCryptoError('INVALID_SCHEMA');
    unbase64url(descriptor.value, 32);
    return descriptor.value as string;
  });
  return Object.freeze({
    format: 'visualnerve-backup-manifest',
    version: 1,
    backupId: vaultIdentifier(fields.backupId),
    totalBytes: safeInteger(fields.totalBytes, 0, MAX_BACKUP_BYTES),
    chunkSize: safeInteger(fields.chunkSize, MIN_BACKUP_CHUNK_BYTES, BACKUP_CHUNK_BYTES),
    chunkHashes: Object.freeze(hashes),
  });
}
