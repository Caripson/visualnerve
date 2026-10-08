import { jsonBytes, parseJson, safeInteger } from './vault-codec';
import { VaultCryptoError } from './vault-errors';
import {
  BACKUP_CHUNK_BYTES,
  MAX_BACKUP_BYTES,
  MAX_BACKUP_CHUNKS,
  MIN_BACKUP_CHUNK_BYTES,
  parseBackupManifest,
  parseEncryptedVaultBackup,
  type EncryptedVaultBackup,
  type SealedVaultBytes,
  type VaultHeader,
} from './vault-schema';

interface BackupCryptography {
  randomId(): string;
  check(): void;
  hash(bytes: Uint8Array): Promise<string>;
  seal(context: readonly unknown[], bytes: Uint8Array): Promise<SealedVaultBytes>;
  open(context: readonly unknown[], sealed: SealedVaultBytes): Promise<Uint8Array<ArrayBuffer>>;
}
const manifestContext = (
  backup: Pick<EncryptedVaultBackup, 'backupId' | 'chunkSize' | 'totalBytes' | 'chunks'>,
  headerHash: string,
) =>
  [
    'visualnerve-backup-manifest',
    1,
    backup.backupId,
    headerHash,
    backup.chunkSize,
    backup.totalBytes,
    backup.chunks.length,
  ] as const;
const chunkContext = (
  backup: Pick<EncryptedVaultBackup, 'backupId' | 'chunkSize' | 'totalBytes' | 'chunks'>,
  headerHash: string,
  index: number,
) =>
  [
    'visualnerve-backup-chunk',
    1,
    backup.backupId,
    headerHash,
    backup.chunkSize,
    backup.totalBytes,
    backup.chunks.length,
    index,
  ] as const;
const hashChunk = (crypto: BackupCryptography, chunk: SealedVaultBytes) =>
  crypto.hash(jsonBytes([chunk.iv, chunk.ciphertext]));

/** No callbacks expose plaintext before the entire container has authenticated. */
export async function encryptBackupContainer(
  crypto: BackupCryptography,
  header: VaultHeader,
  bytes: Uint8Array,
  options: { chunkSize?: number } = {},
): Promise<EncryptedVaultBackup> {
  const chunkSize = safeInteger(
    options.chunkSize ?? BACKUP_CHUNK_BYTES,
    MIN_BACKUP_CHUNK_BYTES,
    BACKUP_CHUNK_BYTES,
  );
  if (
    !ArrayBuffer.isView(bytes) ||
    Object.prototype.toString.call(bytes) !== '[object Uint8Array]' ||
    bytes.byteLength > MAX_BACKUP_BYTES
  )
    throw new VaultCryptoError('LIMIT_EXCEEDED');
  const count = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
  if (count > MAX_BACKUP_CHUNKS) throw new VaultCryptoError('LIMIT_EXCEEDED');
  crypto.check();
  // Own the input so a concurrent mutation cannot produce a mixed-revision backup.
  const source = new Uint8Array(bytes);
  const chunks: SealedVaultBytes[] = [];
  const backup = {
    backupId: crypto.randomId(),
    totalBytes: source.byteLength,
    chunkSize,
    chunks: Array<SealedVaultBytes>(count),
  };
  const hashes: string[] = [];
  try {
    const headerHash = await crypto.hash(jsonBytes(header));
    for (let index = 0; index < count; index++) {
      crypto.check();
      const chunk = await crypto.seal(
        chunkContext(backup, headerHash, index),
        source.subarray(index * chunkSize, (index + 1) * chunkSize),
      );
      chunks.push(chunk);
      hashes.push(await hashChunk(crypto, chunk));
    }
    const manifest = await crypto.seal(
      manifestContext(backup, headerHash),
      jsonBytes({
        format: 'visualnerve-backup-manifest',
        version: 1,
        backupId: backup.backupId,
        totalBytes: backup.totalBytes,
        chunkSize,
        chunkHashes: hashes,
      }),
    );
    crypto.check();
    return Object.freeze({
      format: 'visualnerve-backup',
      version: 1,
      header,
      backupId: backup.backupId,
      totalBytes: backup.totalBytes,
      chunkSize,
      chunks: Object.freeze(chunks),
      manifest,
    });
  } finally {
    source.fill(0);
  }
}

export async function decryptBackupContainer(
  crypto: BackupCryptography,
  input: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  const backup = parseEncryptedVaultBackup(input);
  crypto.check();
  const headerHash = await crypto.hash(jsonBytes(backup.header));
  const manifestBytes = await crypto.open(manifestContext(backup, headerHash), backup.manifest);
  let manifest;
  try {
    manifest = parseBackupManifest(parseJson(manifestBytes));
  } finally {
    manifestBytes.fill(0);
  }
  if (
    manifest.backupId !== backup.backupId ||
    manifest.totalBytes !== backup.totalBytes ||
    manifest.chunkSize !== backup.chunkSize ||
    manifest.chunkHashes.length !== backup.chunks.length
  )
    throw new VaultCryptoError('AUTHENTICATION_FAILED');
  // Verify the complete ordered ciphertext manifest before allocating output or decrypting data.
  for (let index = 0; index < backup.chunks.length; index++)
    if ((await hashChunk(crypto, backup.chunks[index])) !== manifest.chunkHashes[index])
      throw new VaultCryptoError('AUTHENTICATION_FAILED');
  crypto.check();
  const output = new Uint8Array(backup.totalBytes);
  try {
    for (let index = 0; index < backup.chunks.length; index++) {
      const chunk = await crypto.open(
        chunkContext(backup, headerHash, index),
        backup.chunks[index],
      );
      try {
        const expected = Math.min(
          backup.chunkSize,
          Math.max(0, backup.totalBytes - index * backup.chunkSize),
        );
        if (chunk.byteLength !== expected) throw new VaultCryptoError('AUTHENTICATION_FAILED');
        output.set(chunk, index * backup.chunkSize);
      } finally {
        chunk.fill(0);
      }
    }
    crypto.check();
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  }
}
