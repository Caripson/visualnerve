import {
  workspaceStoreDefinitions,
  type WorkspaceIndexKey,
  type WorkspaceMetadata,
  type WorkspaceQuery,
  type WorkspaceStoreName,
  type WorkspaceTable,
  type WorkspaceWhere,
} from '../storage/contracts';
import { compareWorkspaceIndexKeys, isWorkspaceIndexKey, workspaceRecordId } from './vault-indexes';
import { VaultStorageError } from './vault-storage';

export interface VaultTableEntry {
  id: string;
  key: WorkspaceIndexKey;
}

/**
 * The owner supplies authenticated logical records and index projections. `run`
 * captures one storage scope for the entire operation, including its writes.
 * Bound scopes must enforce lifetime, store membership and readonly access;
 * rejected writes must abort their enclosing logical transaction.
 */
export interface VaultTableAccess<T> {
  get(id: string): Promise<T | undefined>;
  entries(index?: string, equality?: WorkspaceIndexKey): Promise<VaultTableEntry[]>;
  put(record: T, addOnly?: boolean): Promise<string>;
  delete(id: string): Promise<void>;
  run<R>(mode: 'r' | 'rw', work: (access: VaultTableAccess<T>) => Promise<R>): Promise<R>;
}

interface QueryPlan<T> {
  index: string;
  equals?: WorkspaceIndexKey;
  excludes?: WorkspaceIndexKey;
  predicates: readonly ((record: T) => boolean)[];
  limit: number;
  reversed: boolean;
}
interface SelectedEntry<T> extends VaultTableEntry {
  record?: T;
}

function invalid(message: string): never {
  throw new VaultStorageError(422, 'INVALID_WORKSPACE_QUERY', message);
}
function indexKey(value: WorkspaceIndexKey): WorkspaceIndexKey {
  if (!isWorkspaceIndexKey(value)) invalid('Invalid workspace query key.');
  return Array.isArray(value) ? [...value] : value;
}
function validateId(id: string) {
  if (typeof id !== 'string' || !id) invalid('Invalid workspace record identifier.');
}

class VaultWorkspaceQuery<T> implements WorkspaceQuery<T> {
  constructor(
    private readonly store: WorkspaceStoreName,
    private readonly access: VaultTableAccess<T>,
    private readonly plan: QueryPlan<T>,
  ) {}

  private copy(changes: Partial<QueryPlan<T>>) {
    return new VaultWorkspaceQuery(this.store, this.access, { ...this.plan, ...changes });
  }
  filter(predicate: (record: T) => boolean): WorkspaceQuery<T> {
    if (typeof predicate !== 'function') invalid('A workspace filter must be a function.');
    return this.copy({ predicates: [...this.plan.predicates, predicate] });
  }
  limit(count: number): WorkspaceQuery<T> {
    if (!Number.isSafeInteger(count) || count < 0)
      invalid('A workspace query limit must be a nonnegative integer.');
    return this.copy({ limit: Math.min(count, this.plan.limit) });
  }
  reverse(): WorkspaceQuery<T> {
    return this.copy({ reversed: !this.plan.reversed });
  }

  private async select(
    access: VaultTableAccess<T>,
    withRecords = false,
  ): Promise<SelectedEntry<T>[]> {
    const { index, predicates, reversed, limit, equals, excludes } = this.plan;
    if (limit === 0) return [];
    const definition = workspaceStoreDefinitions[this.store].indexes[index];
    // Protected scalar equality partitions are an optimization. Compound and
    // multivalue indexes retain their full index semantics through projections.
    const equality =
      equals !== undefined && !definition?.multiEntry && !Array.isArray(equals)
        ? equals
        : undefined;
    const unique = new Map<string, VaultTableEntry>();
    for (const entry of await access.entries(index, equality)) {
      validateId(entry.id);
      const key = indexKey(entry.key);
      if (equals !== undefined && compareWorkspaceIndexKeys(key, equals) !== 0) continue;
      if (excludes !== undefined && compareWorkspaceIndexKeys(key, excludes) === 0) continue;
      unique.set(JSON.stringify([key, entry.id]), { id: entry.id, key });
    }
    const entries = [...unique.values()].sort(
      (a, b) => compareWorkspaceIndexKeys(a.key, b.key) || compareWorkspaceIndexKeys(a.id, b.id),
    );
    if (reversed) entries.reverse();
    if (!withRecords && !predicates.length) return entries.slice(0, limit);
    const selected: SelectedEntry<T>[] = [];
    const records = new Map<string, T>();
    for (const entry of entries) {
      let record = records.get(entry.id);
      if (record === undefined) {
        record = await access.get(entry.id);
        if (record === undefined)
          throw new VaultStorageError(
            422,
            'INVALID_WORKSPACE_INDEX',
            'A workspace index is inconsistent.',
          );
        records.set(entry.id, record);
      }
      if (predicates.every((predicate) => predicate(record))) {
        selected.push({ ...entry, ...(withRecords ? { record } : {}) });
        if (selected.length >= limit) break;
      }
    }
    return selected;
  }

  toArray(): Promise<T[]> {
    return this.access.run('r', async (access) =>
      (await this.select(access, true)).map((entry) => entry.record!),
    );
  }
  first(): Promise<T | undefined> {
    return this.copy({ limit: Math.min(this.plan.limit, 1) })
      .toArray()
      .then((records) => records[0]);
  }
  count(): Promise<number> {
    return this.access.run('r', async (access) => (await this.select(access)).length);
  }
  keys(): Promise<WorkspaceIndexKey[]> {
    return this.access.run('r', async (access) =>
      (await this.select(access)).map((entry) => entry.key),
    );
  }
  primaryKeys(): Promise<string[]> {
    return this.access.run('r', async (access) =>
      (await this.select(access)).map((entry) => entry.id),
    );
  }
  eachKey(
    callback: (value: WorkspaceIndexKey, cursor: { primaryKey: string }) => void,
  ): Promise<void> {
    if (typeof callback !== 'function') invalid('A workspace key callback must be a function.');
    return this.access.run('r', async (access) => {
      for (const entry of await this.select(access)) callback(entry.key, { primaryKey: entry.id });
    });
  }
  metadata(): Promise<WorkspaceMetadata[]> {
    return this.access.run('r', async (access) =>
      (await this.select(access)).map((entry) => ({ id: entry.id, value: entry.key })),
    );
  }
  delete(): Promise<number> {
    return this.access.run('rw', async (access) => {
      const ids = new Set((await this.select(access)).map((entry) => entry.id));
      for (const id of ids) await access.delete(id);
      return ids.size;
    });
  }
}

/** Table façade with no database, plaintext persistence or cryptographic state of its own. */
export class VaultWorkspaceTable<T> implements WorkspaceTable<T> {
  constructor(
    readonly name: WorkspaceStoreName,
    private readonly access: VaultTableAccess<T>,
  ) {
    if (!Object.hasOwn(workspaceStoreDefinitions, name)) invalid('Unknown workspace store.');
  }

  private index(index: string) {
    const definition = workspaceStoreDefinitions[this.name];
    if (index !== definition.primaryKey && !Object.hasOwn(definition.indexes, index))
      invalid('Unknown workspace query index.');
    return index;
  }
  private query(index: string, conditions: Partial<QueryPlan<T>> = {}): VaultWorkspaceQuery<T> {
    return new VaultWorkspaceQuery(this.name, this.access, {
      index: this.index(index),
      predicates: [],
      limit: Infinity,
      reversed: false,
      ...conditions,
    });
  }
  get(id: string): Promise<T | undefined> {
    validateId(id);
    return this.access.run('r', (access) => access.get(id));
  }
  bulkGet(ids: readonly string[]): Promise<Array<T | undefined>> {
    ids.forEach(validateId);
    return this.access.run('r', async (access) => {
      const records: Array<T | undefined> = [];
      for (const id of ids) records.push(await access.get(id));
      return records;
    });
  }
  toArray(): Promise<T[]> {
    return this.orderBy(workspaceStoreDefinitions[this.name].primaryKey).toArray();
  }
  count(): Promise<number> {
    return this.orderBy(workspaceStoreDefinitions[this.name].primaryKey).count();
  }
  put(record: T): Promise<string> {
    return this.access.run('rw', (access) => access.put(record));
  }
  add(record: T): Promise<string> {
    return this.access.run('rw', (access) => access.put(record, true));
  }
  bulkPut(records: readonly T[]): Promise<string> {
    return this.access.run('rw', async (access) => {
      // Validate every primary key before staging any mutation. The access owner
      // enforces secondary uniqueness against all staged records atomically.
      for (const record of records) workspaceRecordId(this.name, record);
      let last!: string;
      for (const record of records) last = await access.put(record);
      // Like the legacy table, an empty bulkPut resolves to undefined at runtime.
      return last;
    });
  }
  bulkDelete(ids: readonly string[]): Promise<void> {
    ids.forEach(validateId);
    return this.access.run('rw', async (access) => {
      for (const id of new Set(ids)) await access.delete(id);
    });
  }
  update(id: string, changes: Partial<T>): Promise<number> {
    validateId(id);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes))
      invalid('Invalid workspace update.');
    return this.access.run('rw', async (access) => {
      const existing = await access.get(id);
      if (existing === undefined) return 0;
      const next = { ...existing, ...changes };
      if (workspaceRecordId(this.name, next) !== id)
        invalid('A workspace update cannot change its primary key.');
      await access.put(next);
      return 1;
    });
  }
  delete(id: string): Promise<void> {
    validateId(id);
    return this.access.run('rw', (access) => access.delete(id));
  }
  clear(): Promise<void> {
    return this.access.run('rw', async (access) => {
      const entries = await access.entries(workspaceStoreDefinitions[this.name].primaryKey);
      for (const id of new Set(entries.map((entry) => entry.id))) await access.delete(id);
    });
  }
  where(index: string): WorkspaceWhere<T> {
    const checked = this.index(index);
    return {
      equals: (value) => this.query(checked, { equals: indexKey(value) }),
      notEqual: (value) => this.query(checked, { excludes: indexKey(value) }),
    };
  }
  orderBy(index: string): WorkspaceQuery<T> {
    return this.query(index);
  }
  filter(predicate: (record: T) => boolean): WorkspaceQuery<T> {
    return this.orderBy(workspaceStoreDefinitions[this.name].primaryKey).filter(predicate);
  }
  metadata(index: string): Promise<WorkspaceMetadata[]> {
    return this.query(index).metadata();
  }
}
