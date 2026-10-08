import type { WorkspaceStorage } from '../storage/contracts';
import { EncryptedWorkspaceDatabase } from '../storage/encrypted-database';
import type { verifyPendingMigration } from '../storage/migration';

type MigrationModule = { verifyPendingMigration: typeof verifyPendingMigration };

/** Open and verify under the session that requested this UI, even across module loading. */
export async function openWorkspaceSurface(
  storage: WorkspaceStorage,
  loadMigration: () => Promise<MigrationModule> = () => import('../storage/migration'),
) {
  const operation = await storage.captureOperation();
  try {
    await operation.storage.open();
    if (operation.storage instanceof EncryptedWorkspaceDatabase) {
      const migration = await loadMigration();
      await operation.check();
      operation.signal.throwIfAborted();
      // The bound storage prevents a late verification from borrowing a fresh
      // unlock and publishing the previous session's pending migration marker.
      await migration.verifyPendingMigration(operation.storage);
    }
    await operation.check();
    operation.signal.throwIfAborted();
  } finally {
    operation.dispose();
  }
}
