import { VaultCrypto, type CreatedVault } from './vault-crypto';
import { VaultLogicalRecordCodec } from './vault-logical-record';
import { withVaultTransaction } from './vault-coordination';
import { VaultStorageError } from './vault-storage';
import type { VaultSession, VaultSessionContext } from './vault-session';
import { rewriteVaultRecords } from './vault-key-rotation-data';

export interface VaultKeyRotationOptions {
  /** The human UI always requires the current password before preparing an incident rotation. */
  currentPassword?: string;
  signal?: AbortSignal;
}
export interface PreparedVaultKeyRotation {
  readonly recoveryKey: string;
  activate(): Promise<void>;
  dispose(): void;
}
const locked = (): never => {
  throw new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );
};
const conflict = (): never => {
  throw new VaultStorageError(
    409,
    'VAULT_CONFLICT',
    'The encrypted workspace changed. Prepare a fresh content-key rotation.',
  );
};

/** Browser-only preparation; no password/key can be passed through the local API or MCP. */
export function prepareVaultKeyRotation(
  session: VaultSession,
  newPassword: string,
  options: VaultKeyRotationOptions = {},
): Promise<PreparedVaultKeyRotation> {
  return session.prepareContentKeyRotation(newPassword, options);
}

/** @internal Session supplies the exact crypto instance that owns its opaque keys. */
export async function createPreparedVaultKeyRotation(
  session: VaultSession,
  cipher: VaultCrypto,
  newPassword: string,
  options: VaultKeyRotationOptions,
): Promise<PreparedVaultKeyRotation> {
  const operation = await session.captureOperation(options.signal);
  let rotated: CreatedVault | undefined, context: VaultSessionContext | undefined;
  let expectedRevision = 0,
    disposed = false,
    activating = false;
  let recovery = '';
  let currentPassword = options.currentPassword;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    recovery = '';
    if (rotated) cipher.destroyKeys(rotated.keys);
    rotated = undefined;
    context = undefined;
    operation.signal.removeEventListener('abort', dispose);
    operation.dispose();
  };
  operation.signal.addEventListener('abort', dispose, { once: true });
  try {
    await operation.run(async (captured) =>
      withVaultTransaction(session.storage.name, operation.signal, async () => {
        await operation.check();
        const control = await session.storage.check(captured.lease);
        if (currentPassword !== undefined) {
          const authenticated = await cipher.unlockWithPassword(control.header, currentPassword);
          cipher.destroyKeys(authenticated);
          await operation.check();
        }
        if (currentPassword === newPassword)
          throw new VaultStorageError(
            422,
            'PASSWORD_REUSE',
            'Choose a different new password for an incident content-key rotation.',
          );
        if (currentPassword === undefined) {
          let reused = false;
          try {
            const existing = await cipher.unlockWithPassword(control.header, newPassword);
            cipher.destroyKeys(existing);
            reused = true;
          } catch (error) {
            if (
              !(error instanceof Error && 'code' in error && error.code === 'AUTHENTICATION_FAILED')
            )
              throw error;
          }
          await operation.check();
          if (reused)
            throw new VaultStorageError(
              422,
              'PASSWORD_REUSE',
              'Choose a different new password for an incident content-key rotation.',
            );
        }
        const created = await cipher.rotateContentKey(control.header, captured.keys, newPassword);
        if (disposed) {
          cipher.destroyKeys(created.keys);
          return locked();
        }
        rotated = created;
        await operation.check();
        expectedRevision = control.revision;
        recovery = created.recoveryKey;
        context = captured;
      }),
    );
    await operation.check();
    operation.assertActive();
    newPassword = '';
    currentPassword = undefined;
    const prepared = {
      activate: async () => {
        if (disposed || activating || !rotated || !context) return locked();
        activating = true;
        const candidate = rotated,
          original = context;
        try {
          await withVaultTransaction(session.storage.name, operation.signal, async () => {
            await operation.check();
            const control = await session.storage.check(original.lease);
            if (control.revision !== expectedRevision) return conflict();
            const records = await rewriteVaultRecords(
              session.storage,
              new VaultLogicalRecordCodec(cipher),
              original.keys,
              candidate.keys,
              original.lease,
              () => operation.check(),
            );
            await operation.check();
            operation.assertActive();
            const updated = await session.storage.activateContentKey(
              original.lease,
              candidate.header,
              records,
              expectedRevision,
              operation.signal,
              () => operation.assertActive(),
            );
            // Intentional canonical revocation: the old operation cannot pass check() afterward.
            await session.completeContentKeyRotation(updated);
          });
        } catch (error) {
          if (operation.signal.aborted) return locked();
          throw error;
        } finally {
          dispose();
        }
      },
      dispose,
    };
    // Recovery material is explicit/one-time, and omitted from accidental JSON serialization.
    return Object.freeze(
      Object.defineProperty(prepared, 'recoveryKey', {
        get: () => {
          if (disposed) return locked();
          operation.assertActive();
          return recovery;
        },
      }),
    ) as PreparedVaultKeyRotation;
  } catch (error) {
    newPassword = '';
    currentPassword = undefined;
    dispose();
    throw error;
  }
}
