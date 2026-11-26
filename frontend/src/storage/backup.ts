import { workspace } from './workspace';
import { download } from '../export/semantic';
import { vaultCrypto, vaultSession } from './runtime';
import { logicalJsonChunks, logicalJsonLimits } from '../security/vault-logical-json';
export async function exportAllData(cancellation?: AbortSignal) {
  cancellation?.throwIfAborted();
  const operation = await workspace.repo.db.captureOperation();
  try {
    const signal = cancellation
      ? AbortSignal.any([operation.signal, cancellation])
      : operation.signal;
    signal.throwIfAborted();
    const backup = await workspace.backup(operation);
    signal.throwIfAborted();
    let output: unknown = backup;
    if (vaultSession && vaultCrypto) {
      const session = vaultSession,
        cipher = vaultCrypto;
      const pieces = [
        ...logicalJsonChunks(backup, {
          chunkBytes: logicalJsonLimits.chunkBytes,
          budget: { bytes: 0, values: 0 },
        }),
      ];
      const bytes = new Uint8Array(pieces.reduce((total, part) => total + part.byteLength, 0));
      let offset = 0;
      for (const piece of pieces) {
        bytes.set(piece, offset);
        offset += piece.byteLength;
        piece.fill(0);
      }
      let capability: Awaited<ReturnType<typeof session.captureOperation>> | undefined;
      try {
        capability = await session.captureOperation(signal);
        output = await capability.run(async ({ keys, lease }) => {
          const { header } = await session.storage.check(lease);
          return cipher.encryptBackup(header, keys, bytes, { signal });
        });
      } finally {
        bytes.fill(0);
        capability?.dispose();
      }
    }
    await operation.check();
    signal.throwIfAborted();
    const date = backup.exportedAt!.slice(0, 10);
    download(`visual-nerve-backup-${date}.json`, JSON.stringify(output));
    await workspace.setPreference('last-export', backup.exportedAt, operation);
  } finally {
    operation.dispose();
  }
}
