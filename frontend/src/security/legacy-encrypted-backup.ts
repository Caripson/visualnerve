import { download } from '../export/semantic';
import type { WorkspaceStorage } from '../storage/contracts';
import { logicalJsonChunks, logicalJsonLimits } from './vault-logical-json';
import { VaultCrypto, type CreatedVault, type VaultKeys } from './vault-crypto';
import type { EncryptedVaultBackup } from './vault-schema';
import { StorageError } from '../model/errors';

export interface LegacyBackupSource {
  repo: { db: WorkspaceStorage };
  settled(): Promise<void>;
}
export interface LegacyEncryptedTransfer {
  readonly filename: string;
  /** One-time browser display only; omitted from JSON serialization. */
  readonly recoveryKey: string;
  download(): Promise<void>;
  dispose(): void;
}
const cancelled = () => new DOMException('Encrypted transfer export cancelled.', 'AbortError');

/** Creates a portable encrypted copy. It never migrates, writes or deletes the source workspace. */
export async function prepareLegacyEncryptedBackup(
  source: LegacyBackupSource,
  password: string,
  {
    signal,
    cipher = new VaultCrypto(),
    onInvalidated,
  }: { signal?: AbortSignal; cipher?: VaultCrypto; onInvalidated?: () => void } = {},
): Promise<LegacyEncryptedTransfer> {
  if ('session' in source.repo.db)
    throw new StorageError(422, 'Use the encrypted workspace backup action for this workspace.');
  // Invoke before the first await so this job cannot adopt a later workspace generation.
  const operation = await source.repo.db.captureOperation();
  let keys: VaultKeys | undefined;
  let created: CreatedVault | undefined;
  let bytes: Uint8Array | undefined;
  const pieces: Uint8Array[] = [];
  let container: EncryptedVaultBackup | undefined;
  let recoveryKey = '';
  let disposed = false;
  let completed = false;
  const scrub = () => {
    bytes?.fill(0);
    for (const piece of pieces) piece.fill(0);
    if (keys) cipher.destroyKeys(keys);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    operation.signal.removeEventListener('abort', invalidate);
    scrub();
    container = undefined;
    recoveryKey = '';
    operation.dispose();
  };
  const invalidate = () => {
    dispose();
    onInvalidated?.();
  };
  const assertCurrent = () => {
    if (disposed || signal?.aborted || operation.signal.aborted) throw cancelled();
  };
  const check = async () => {
    assertCurrent();
    await operation.check();
    assertCurrent();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  operation.signal.addEventListener('abort', invalidate, { once: true });
  try {
    await check();
    await source.settled();
    await check();
    let filename: string;
    {
      const backup = await operation.storage.backup();
      await check();
      filename = `visual-nerve-encrypted-transfer-${backup.exportedAt!.slice(0, 10)}.json`;
      for (const piece of logicalJsonChunks(backup, {
        chunkBytes: logicalJsonLimits.chunkBytes,
        budget: { bytes: 0, values: 0 },
      }))
        pieces.push(piece);
    }
    bytes = new Uint8Array(pieces.reduce((total, piece) => total + piece.byteLength, 0));
    let offset = 0;
    for (const piece of pieces) {
      bytes.set(piece, offset);
      offset += piece.byteLength;
      piece.fill(0);
    }
    pieces.length = 0;
    const creating = cipher.createVault(password);
    password = '';
    created = await creating;
    keys = created.keys;
    await check();
    container = await cipher.encryptBackup(created.header, keys, bytes);
    await check();
    assertCurrent();
    recoveryKey = created.recoveryKey;
    scrub();
    keys = undefined;
    created = undefined;
    bytes = undefined;
    const artifact = {
      filename,
      download: async () => {
        try {
          await check();
          const output = JSON.stringify(container);
          await check();
          // A queued abort can run after check resolves but before this continuation.
          assertCurrent();
          download(filename, output);
        } finally {
          dispose();
        }
      },
      dispose,
    };
    assertCurrent();
    completed = true;
    return Object.freeze(
      Object.defineProperty(artifact, 'recoveryKey', {
        get: () => recoveryKey,
      }),
    ) as LegacyEncryptedTransfer;
  } finally {
    password = '';
    scrub();
    created = undefined;
    if (!completed) dispose();
  }
}
