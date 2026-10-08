import type { VaultKeys } from './vault-crypto';
import type { VaultStore } from './vault-schema';
import { VaultSession, type VaultSessionOperation } from './vault-session';
import { withVaultTransaction } from './vault-coordination';
import {
  VaultStorageError,
  type VaultLease,
  type VaultMutation,
  type VaultPhysicalRecord,
  type VaultRecordStorage,
} from './vault-storage';

export type VaultTransactionMode = 'r' | 'rw';
type SessionContext = { keys: VaultKeys; lease: VaultLease; signal: AbortSignal };
type Selector = { store: VaultStore; partition?: string };
type JournalState = {
  original: Map<string, VaultPhysicalRecord | undefined>;
  changes: Map<string, VaultPhysicalRecord | null>;
  callbacks: Array<() => void>;
  status: 'open' | 'sealed' | 'closed';
  inFlight: number;
  failed: boolean;
};

const invalid = (message: string): never => {
  throw new VaultStorageError(422, 'INVALID_VAULT_TRANSACTION', message);
};
const locked = (): never => {
  throw new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );
};

/**
 * A short-lived ciphertext journal. Callers may await validation and Web Crypto
 * here: no native IndexedDB transaction is kept open during their callback.
 * All durable changes are committed together against one captured revision.
 */
export class VaultJournalScope {
  private finished = false;
  constructor(
    readonly mode: VaultTransactionMode,
    readonly stores: ReadonlySet<VaultStore>,
    readonly context: SessionContext,
    private storage: VaultRecordStorage,
    private revision: number,
    private state: JournalState = {
      original: new Map(),
      changes: new Map(),
      callbacks: [],
      status: 'open',
      inFlight: 0,
      failed: false,
    },
  ) {}

  private assertOpen(write = false, store?: VaultStore) {
    if (this.finished) invalid('This workspace transaction has finished.');
    if (this.state.failed)
      invalid('A nested workspace operation failed. Nothing can be committed.');
    if (this.state.status !== 'open') invalid('This workspace transaction has finished.');
    if (this.context.signal.aborted) locked();
    if (write && this.mode !== 'rw') invalid('This workspace transaction is read-only.');
    if (store && !this.stores.has(store))
      invalid('The record is outside this workspace transaction.');
  }

  private async reading<T>(work: () => Promise<T>): Promise<T> {
    this.state.inFlight++;
    try {
      const result = await work();
      this.assertOpen();
      return result;
    } finally {
      this.state.inFlight--;
    }
  }

  async get(store: VaultStore, id: string): Promise<VaultPhysicalRecord | undefined> {
    this.assertOpen(false, store);
    if (this.state.changes.has(id)) {
      const current = this.state.changes.get(id) ?? undefined;
      if (current && current.store !== store) invalid('Encrypted record store mismatch.');
      return current ? structuredClone(current) : undefined;
    }
    if (!this.state.original.has(id)) {
      const [record] = await this.reading(() => this.storage.read(this.context.lease, [id]));
      if (record && record.store !== store) invalid('Encrypted record store mismatch.');
      // Concurrent reads of one key share its first observed version. A revision
      // change anywhere in the workspace is rejected at the final atomic fence.
      if (!this.state.original.has(id)) this.state.original.set(id, record);
    }
    const record = this.state.original.get(id);
    if (record && record.store !== store) invalid('Encrypted record store mismatch.');
    return record ? structuredClone(record) : undefined;
  }

  async select(selector: Selector): Promise<VaultPhysicalRecord[]> {
    this.assertOpen(false, selector.store);
    const records = await this.reading(() =>
      this.storage.select(
        this.context.lease,
        selector.partition === undefined
          ? { store: selector.store }
          : { partition: selector.partition },
      ),
    );
    const matches = (record: VaultPhysicalRecord) =>
      record.store === selector.store &&
      (selector.partition === undefined || record.partitions.includes(selector.partition));
    const selected = new Map<string, VaultPhysicalRecord>();
    for (const record of records) {
      if (!matches(record)) invalid('Encrypted query returned a record from another store.');
      if (this.state.original.has(record.id)) {
        if (this.state.original.get(record.id)?.revision !== record.revision)
          throw new VaultStorageError(
            409,
            'VAULT_CONFLICT',
            'The encrypted workspace changed. Reload it before saving.',
          );
      } else this.state.original.set(record.id, record);
      selected.set(record.id, this.state.original.get(record.id)!);
    }
    for (const [id, record] of this.state.changes) {
      if (record && matches(record)) selected.set(id, record);
      else selected.delete(id);
    }
    return [...selected.values()].map((record) => structuredClone(record));
  }

  /** Repeated staged puts use the same next durable revision, not extra commits. */
  async nextRevision(store: VaultStore, id: string): Promise<number> {
    this.assertOpen(true, store);
    await this.get(store, id);
    this.assertOpen(true, store);
    return (this.state.original.get(id)?.revision ?? 0) + 1;
  }

  async put(record: VaultPhysicalRecord) {
    this.assertOpen(true, record.store);
    const expected = await this.nextRevision(record.store, record.id);
    this.assertOpen(true, record.store);
    if (record.revision !== expected)
      invalid('Prepared ciphertext must use the next durable record revision.');
    if (
      record.encrypted.vaultId !== this.context.lease.vaultId ||
      record.encrypted.keyVersion !== this.context.lease.keyVersion
    )
      invalid('Prepared ciphertext belongs to a different workspace key.');
    this.state.changes.set(record.id, structuredClone(record));
  }

  async delete(store: VaultStore, id: string) {
    this.assertOpen(true, store);
    await this.get(store, id);
    this.assertOpen(true, store);
    this.state.changes.set(id, null);
  }

  afterCommit(callback: () => void) {
    this.assertOpen();
    this.state.callbacks.push(callback);
  }

  /** Nested operations share the journal and cannot widen its permissions. */
  async atomic<T>(
    mode: VaultTransactionMode,
    stores: readonly VaultStore[],
    work: (scope: VaultJournalScope) => Promise<T>,
  ): Promise<T> {
    this.assertOpen(mode === 'rw');
    if (stores.some((store) => !this.stores.has(store)))
      invalid('A nested workspace transaction cannot add stores.');
    if (!['r', 'rw'].includes(mode)) invalid('Invalid workspace transaction mode.');
    const child = new VaultJournalScope(
      mode,
      new Set(stores),
      this.context,
      this.storage,
      this.revision,
      this.state,
    );
    this.state.inFlight++;
    try {
      const result = await work(child);
      this.assertOpen();
      return result;
    } catch (error) {
      // Nested transactions are not savepoints. Catching their rejection must
      // never turn an already rejected domain operation into a durable write.
      this.state.failed = true;
      throw error;
    } finally {
      child.finished = true;
      this.state.inFlight--;
    }
  }

  seal(): VaultMutation[] {
    this.assertOpen();
    if (this.state.inFlight)
      invalid('Await every workspace read before finishing the transaction.');
    this.state.status = 'sealed';
    const mutations: VaultMutation[] = [];
    for (const [id, record] of this.state.changes) {
      const expectedRevision = this.state.original.get(id)?.revision ?? 0;
      if (record) mutations.push({ kind: 'put', record, expectedRevision });
      else if (expectedRevision) mutations.push({ kind: 'delete', id, expectedRevision });
    }
    return mutations;
  }

  async commit(mutations: VaultMutation[]) {
    if (this.context.signal.aborted) locked();
    if (this.state.status !== 'sealed') invalid('Workspace transaction has not been sealed.');
    // An empty batch also verifies the revision, preventing mixed-version reads
    // and granting a write after its independently read access setting changed.
    return this.storage.commit(this.context.lease, mutations, this.revision);
  }

  publish() {
    if (this.context.signal.aborted) locked();
    if (this.state.status !== 'sealed') invalid('Workspace transaction has not been sealed.');
    for (const callback of this.state.callbacks) {
      if (this.context.signal.aborted) locked();
      callback();
    }
  }

  close() {
    this.state.status = 'closed';
    this.state.original.clear();
    this.state.changes.clear();
    this.state.callbacks.length = 0;
  }
}

export class VaultJournal {
  constructor(readonly session: VaultSession) {}

  async atomic<T>(
    mode: VaultTransactionMode,
    stores: readonly VaultStore[],
    work: (scope: VaultJournalScope) => Promise<T>,
    operation?: VaultSessionOperation,
  ): Promise<T> {
    if (!['r', 'rw'].includes(mode)) invalid('Invalid workspace transaction mode.');
    // Capture before waiting: a queued callback must never inherit later keys
    // after lock/unlock. Callbacks are executed once, rather than blindly retried.
    const captured = operation ?? (await this.session.captureOperation());
    try {
      return await captured.run((context) =>
        withVaultTransaction(this.session.storage.name, context.signal, async () => {
          await captured.check();
          const control = await this.session.storage.check(context.lease);
          const scope = new VaultJournalScope(
            mode,
            new Set(stores),
            context,
            this.session.storage,
            control.revision,
          );
          try {
            const result = await work(scope);
            const mutations = scope.seal();
            await scope.commit(mutations);
            await this.session.verify();
            scope.publish();
            return result;
          } finally {
            scope.close();
          }
        }),
      );
    } finally {
      if (!operation) captured.dispose();
    }
  }
}
