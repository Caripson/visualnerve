import { VaultStorageError } from './vault-storage';

const queues = new Map<string, Promise<void>>();
const revoked = () =>
  new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );

/**
 * Journals do crypto outside native IDB transactions. Coordinate their complete
 * read/prepare/commit span so official clients cannot create mixed snapshots or
 * spuriously conflict on unrelated records. Native revision fences remain the
 * authority for revocation and writers that do not participate in this lock.
 * Only a technical database name is shared; no key or content enters Web Locks.
 */
export async function withVaultTransaction<T>(
  name: string,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw revoked();
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(
      `visualnerve-vault-transaction:${name}`,
      { mode: 'exclusive', signal },
      async () => {
        if (signal.aborted) throw revoked();
        return work();
      },
    );
  }
  // Browsers without Web Locks still serialize same-realm callers. The native
  // optimistic fence safely rejects concurrent writers from other realms.
  const previous = queues.get(name) ?? Promise.resolve();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => finished);
  queues.set(name, tail);
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(revoked());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    await Promise.race([previous, cancelled]);
    if (signal.aborted) throw revoked();
    return await work();
  } finally {
    signal.removeEventListener('abort', abort);
    release();
    void tail.then(() => {
      if (queues.get(name) === tail) queues.delete(name);
    });
  }
}
