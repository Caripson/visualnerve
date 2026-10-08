import { workspacePayloadFields } from './vault-workspace-fields';
import {
  workspaceStoreDefinitions,
  workspaceStoreNames,
  type WorkspaceIndexKey,
  type WorkspaceRecordMap,
  type WorkspaceStoreName,
  type WorkspaceTable,
} from '../storage/contracts';
import { VaultJournal, type VaultJournalScope, type VaultTransactionMode } from './vault-journal';
import {
  compareWorkspaceIndexKeys,
  encodeWorkspaceIndexKey,
  parseWorkspaceIndexProjection,
  projectWorkspaceIndexes,
  workspaceEqualityPartitions,
  workspaceRecordId,
  workspaceRecordIndexKeys,
  type VaultIndexProjection,
} from './vault-indexes';
import { VaultLogicalRecordCodec, type VaultLogicalProjection } from './vault-logical-record';
import { VaultStorageError, type VaultPhysicalRecord } from './vault-storage';
import { VaultWorkspaceTable, type VaultTableAccess, type VaultTableEntry } from './vault-table';
import type { VaultSession, VaultSessionOperation } from './vault-session';

interface Entry {
  id: string;
  store: WorkspaceStoreName;
  base?: VaultPhysicalRecord;
  authenticated?: VaultLogicalProjection<VaultIndexProjection>;
  projection?: VaultIndexProjection;
  value?: unknown;
  loaded: boolean;
  exists: boolean;
  dirty: boolean;
}
interface RecordJournal {
  physical: VaultJournalScope;
  codec: VaultLogicalRecordCodec;
  entries: Map<WorkspaceStoreName, Map<string, Entry>>;
  status: 'open' | 'preparing' | 'closed';
  inFlight: number;
  failed: boolean;
}
const invalid = (message: string): never => {
  throw new VaultStorageError(422, 'INVALID_WORKSPACE_TRANSACTION', message);
};
const integrity = (): never => {
  throw new VaultStorageError(
    422,
    'VAULT_INTEGRITY_FAILED',
    'Encrypted workspace record integrity check failed.',
  );
};

/** Private, explicit unit of work. No ambient async transaction state is used. */
export class VaultWorkspaceRecordScope {
  private finished = false;
  get storeNames(): readonly WorkspaceStoreName[] {
    this.check();
    return [...this.stores];
  }
  constructor(
    readonly mode: VaultTransactionMode,
    private stores: ReadonlySet<WorkspaceStoreName>,
    private journal: RecordJournal,
  ) {}

  private check(store?: WorkspaceStoreName, write = false) {
    if (this.finished || this.journal.status !== 'open' || this.journal.failed)
      invalid('This workspace transaction has finished or a nested operation failed.');
    if (this.journal.physical.context.signal.aborted)
      throw new VaultStorageError(
        423,
        'WORKSPACE_LOCKED',
        'Unlock the workspace in the browser to continue.',
      );
    if (store && !this.stores.has(store))
      invalid('The table is outside this workspace transaction.');
    if (write && this.mode !== 'rw') invalid('This workspace transaction is read-only.');
  }
  private async operation<T>(
    store: WorkspaceStoreName,
    write: boolean,
    work: () => Promise<T>,
  ): Promise<T> {
    this.check(store, write);
    this.journal.inFlight++;
    try {
      const result = await work();
      this.check(store, write);
      return result;
    } finally {
      this.journal.inFlight--;
    }
  }
  private cache(store: WorkspaceStoreName) {
    let cache = this.journal.entries.get(store);
    if (!cache) {
      cache = new Map();
      this.journal.entries.set(store, cache);
    }
    return cache;
  }
  private async entry(store: WorkspaceStoreName, id: string): Promise<Entry> {
    const cache = this.cache(store);
    const cached = cache.get(id);
    if (cached) return cached;
    const { physical, codec } = this.journal;
    const token = await codec.id(physical.context.keys, store, id);
    const root = await physical.get(store, token);
    this.check(store);
    if (root) return this.adopt(store, root, id);
    const entry: Entry = { id, store, loaded: false, exists: false, dirty: false };
    // Another concurrent lookup may have populated/staged this key while crypto
    // was awaiting. Never overwrite its read-your-writes state.
    if (!cache.has(id)) cache.set(id, entry);
    return cache.get(id)!;
  }
  private async adopt(
    store: WorkspaceStoreName,
    root: VaultPhysicalRecord,
    id?: string,
  ): Promise<Entry> {
    const { physical, codec } = this.journal;
    const authenticated = await codec.project<VaultIndexProjection>(
      physical.context.keys,
      root,
      id,
    );
    this.check(store);
    const projection = parseWorkspaceIndexProjection(
      store,
      authenticated.projection,
      authenticated.logicalId,
    );
    const cache = this.cache(store);
    const current = cache.get(authenticated.logicalId);
    if (current) return current;
    const entry: Entry = {
      id: authenticated.logicalId,
      store,
      base: root,
      authenticated,
      projection,
      loaded: false,
      exists: true,
      dirty: false,
    };
    cache.set(entry.id, entry);
    return entry;
  }
  private async value(entry: Entry): Promise<unknown> {
    if (!entry.exists) return undefined;
    if (entry.loaded) return entry.value;
    const { physical, codec } = this.journal;
    const originalProjection = entry.authenticated!.projection;
    const decoded = await codec.read(
      physical.context.keys,
      entry.base!,
      (ids) => Promise.all(ids.map((id) => physical.get(entry.store, id))),
      entry.id,
    );
    this.check(entry.store);
    const projection = projectWorkspaceIndexes(entry.store, decoded.value);
    if (JSON.stringify(projection) !== JSON.stringify(originalProjection)) integrity();
    // A simultaneous put owns the new value. A late decrypt must not restore the
    // old payload over its staged edit or deletion.
    if (!entry.loaded && !entry.dirty) {
      entry.value = decoded.value;
      entry.loaded = true;
      entry.authenticated = { ...decoded, projection };
    }
    return entry.exists ? entry.value : undefined;
  }
  private async candidates(
    store: WorkspaceStoreName,
    index: string,
    equality?: WorkspaceIndexKey,
  ): Promise<Entry[]> {
    const { physical, codec } = this.journal;
    const spec = workspaceStoreDefinitions[store].indexes[index];
    const encoded = equality === undefined ? undefined : encodeWorkspaceIndexKey(equality);
    const canSelectEquality =
      encoded !== undefined &&
      spec &&
      !spec.multiEntry &&
      new TextEncoder().encode(encoded).byteLength <= 4096;
    const partition = canSelectEquality
      ? await codec.partition(physical.context.keys, store, { index, value: encoded! })
      : await codec.rootPartition(physical.context.keys, store);
    const roots = await physical.select({ store, partition });
    for (const root of roots) await this.adopt(store, root);
    this.check(store);
    // The cache also contains staged inserts and records whose indexed value was
    // changed. Filtering uses their current projection, not the old ciphertext.
    return [...this.cache(store).values()].filter((entry) => entry.exists);
  }

  private async get(store: WorkspaceStoreName, id: string) {
    return this.operation(store, false, async () => {
      const value = await this.value(await this.entry(store, id));
      // Match native IDB read isolation: editing a returned record without put()
      // cannot mutate an authenticated/staged value inside this transaction.
      return value === undefined ? undefined : structuredClone(value);
    });
  }
  private async entries(
    store: WorkspaceStoreName,
    index?: string,
    equality?: WorkspaceIndexKey,
  ): Promise<VaultTableEntry[]> {
    return this.operation(store, false, async () => {
      const definition = workspaceStoreDefinitions[store];
      const selectedIndex = index ?? definition.primaryKey;
      const spec = definition.indexes[selectedIndex];
      if (selectedIndex !== definition.primaryKey && !spec) invalid('Unknown workspace index.');
      const result: VaultTableEntry[] = [];
      for (const entry of await this.candidates(store, selectedIndex, equality)) {
        const keys = spec?.multiEntry
          ? workspaceRecordIndexKeys(store, selectedIndex, await this.value(entry))
          : entry.projection!.keys[selectedIndex];
        for (const key of keys)
          if (equality === undefined || compareWorkspaceIndexKeys(key, equality) === 0)
            result.push({ id: entry.id, key: structuredClone(key) });
      }
      return result;
    });
  }
  private async put(store: WorkspaceStoreName, input: unknown, addOnly = false): Promise<string> {
    return this.operation(store, true, async () => {
      // Native IDB snapshots at put(). Preserve that expectation while encryption
      // later yields, without retaining a mutable editor graph as the write input.
      const value = structuredClone(input);
      const id = workspaceRecordId(store, value);
      const projection = projectWorkspaceIndexes(store, value);
      const current = await this.entry(store, id);
      if (addOnly && current.exists)
        throw new VaultStorageError(
          409,
          'WORKSPACE_DUPLICATE_KEY',
          'This workspace record already exists.',
        );
      for (const [index, spec] of Object.entries(workspaceStoreDefinitions[store].indexes)) {
        if (!spec.unique) continue;
        for (const key of projection.keys[index]) {
          const conflicts = await this.entries(store, index, key);
          if (conflicts.some((entry) => entry.id !== id))
            throw new VaultStorageError(
              409,
              'WORKSPACE_DUPLICATE_INDEX',
              'This workspace identifier is already in use.',
            );
        }
      }
      this.check(store, true);
      if (addOnly && current.exists)
        throw new VaultStorageError(
          409,
          'WORKSPACE_DUPLICATE_KEY',
          'This workspace record already exists.',
        );
      Object.assign(current, { value, projection, loaded: true, exists: true, dirty: true });
      return id;
    });
  }
  private async delete(store: WorkspaceStoreName, id: string) {
    await this.operation(store, true, async () => {
      const entry = await this.entry(store, id);
      entry.exists = false;
      entry.value = undefined;
      entry.loaded = false;
      entry.dirty = true;
    });
  }
  access<K extends WorkspaceStoreName>(store: K): VaultTableAccess<WorkspaceRecordMap[K]> {
    this.check(store);
    return {
      get: (id) => this.get(store, id) as Promise<WorkspaceRecordMap[K] | undefined>,
      entries: (index, equality) => this.entries(store, index, equality),
      put: (record, addOnly) => this.put(store, record, addOnly),
      delete: (id) => this.delete(store, id),
      run: (mode, work) => this.atomic(mode, [store], (child) => work(child.access(store))),
    };
  }
  table<K extends WorkspaceStoreName>(store: K): WorkspaceTable<WorkspaceRecordMap[K]> {
    this.check(store);
    return new VaultWorkspaceTable(store, this.access(store));
  }
  afterCommit(action: () => void) {
    this.check();
    this.journal.physical.afterCommit(action);
  }
  async atomic<T>(
    mode: VaultTransactionMode,
    stores: readonly WorkspaceStoreName[],
    work: (scope: VaultWorkspaceRecordScope) => Promise<T>,
  ): Promise<T> {
    this.check(undefined, mode === 'rw');
    if (!['r', 'rw'].includes(mode) || stores.some((store) => !this.stores.has(store)))
      invalid('A nested workspace transaction cannot widen its permissions.');
    const child = new VaultWorkspaceRecordScope(mode, new Set(stores), this.journal);
    this.journal.inFlight++;
    try {
      const result = await work(child);
      this.check();
      return result;
    } catch (error) {
      this.journal.failed = true;
      throw error;
    } finally {
      child.finished = true;
      this.journal.inFlight--;
    }
  }
}

/** Typed table storage for every logical store; editor integration is separate. */
export class VaultWorkspaceRecords {
  private journal: VaultJournal;
  constructor(
    session: VaultSession,
    private codec: VaultLogicalRecordCodec,
  ) {
    this.journal = new VaultJournal(session);
  }
  table<K extends WorkspaceStoreName>(store: K): WorkspaceTable<WorkspaceRecordMap[K]> {
    const inaccessible = (): never =>
      invalid('Use the table inside an explicit workspace transaction.');
    return new VaultWorkspaceTable(store, {
      get: inaccessible,
      entries: inaccessible,
      put: inaccessible,
      delete: inaccessible,
      run: (mode, work) => this.atomic(mode, [store], (scope) => work(scope.access(store))),
    });
  }
  async atomic<T>(
    mode: VaultTransactionMode,
    stores: readonly WorkspaceStoreName[],
    work: (scope: VaultWorkspaceRecordScope) => Promise<T>,
    operation?: VaultSessionOperation,
  ): Promise<T> {
    if (stores.some((store) => !workspaceStoreNames.includes(store)))
      invalid('Unknown workspace table.');
    return this.journal.atomic(
      mode,
      stores,
      async (physical) => {
        const journal: RecordJournal = {
          physical,
          codec: this.codec,
          entries: new Map(),
          status: 'open',
          inFlight: 0,
          failed: false,
        };
        const scope = new VaultWorkspaceRecordScope(mode, new Set(stores), journal);
        const clear = () => {
          journal.entries.clear();
        };
        physical.context.signal.addEventListener('abort', clear, { once: true });
        try {
          const result = await work(scope);
          if (journal.failed || journal.inFlight)
            invalid('A nested operation failed or was not awaited. Nothing can be committed.');
          // Parallel puts can both inspect a unique key before either stages its
          // new value. Recheck the final logical state, including all staged puts,
          // before preparing any durable ciphertext.
          for (const [store, entries] of journal.entries)
            for (const entry of entries.values()) {
              if (!entry.dirty || !entry.exists) continue;
              for (const [index, spec] of Object.entries(
                workspaceStoreDefinitions[store].indexes,
              )) {
                if (!spec.unique) continue;
                for (const key of entry.projection!.keys[index]) {
                  const matches = await scope.table(store).where(index).equals(key).primaryKeys();
                  if (matches.some((id) => id !== entry.id))
                    throw new VaultStorageError(
                      409,
                      'WORKSPACE_DUPLICATE_INDEX',
                      'This workspace identifier is already in use.',
                    );
                }
              }
            }
          journal.status = 'preparing';
          for (const [store, entries] of journal.entries)
            for (const entry of entries.values()) {
              if (!entry.dirty) continue;
              if (!entry.exists) {
                if (entry.base) {
                  await physical.delete(store, entry.base.id);
                  for (const id of entry.authenticated!.chunkIds) await physical.delete(store, id);
                }
                continue;
              }
              const id = await this.codec.id(physical.context.keys, store, entry.id);
              const revision = await physical.nextRevision(store, id);
              const bundle = await this.codec.encode(
                physical.context.keys,
                store,
                entry.id,
                entry.value,
                revision,
                workspaceEqualityPartitions(store, entry.projection!),
                {
                  projection: entry.projection,
                  previous: entry.authenticated?.snapshot,
                  payloadFields: workspacePayloadFields[store],
                },
              );
              for (const record of bundle.records) await physical.put(record);
              for (const id of bundle.obsoleteIds) await physical.delete(store, id);
            }
          return result;
        } finally {
          journal.status = 'closed';
          clear();
          physical.context.signal.removeEventListener('abort', clear);
        }
      },
      operation,
    );
  }
}
