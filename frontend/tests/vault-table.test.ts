import { describe, expect, it, vi } from 'vitest';
import {
  workspaceStoreDefinitions,
  type WorkspaceIndexKey,
  type WorkspaceStoreName,
} from '../src/storage/contracts';
import {
  compareWorkspaceIndexKeys,
  projectWorkspaceIndexes,
  workspaceRecordId,
  workspaceRecordIndexKeys,
} from '../src/security/vault-indexes';
import {
  VaultWorkspaceTable,
  type VaultTableAccess,
  type VaultTableEntry,
} from '../src/security/vault-table';
import { VaultStorageError } from '../src/security/vault-storage';
import { WorkspaceDatabase } from '../src/storage/database';

type RecordValue = Record<string, unknown>;

/** Memory-only semantic fixture; production atomicity/crypto have separate integration tests. */
function memory(store: WorkspaceStoreName, initial: RecordValue[]) {
  const records = new Map(initial.map((record) => [workspaceRecordId(store, record), record]));
  const modes: Array<'r' | 'rw'> = [];
  const reads = vi.fn();
  const scans = vi.fn();
  const writes = vi.fn();
  let duplicateEntry = false;
  function bound(
    values: Map<string, RecordValue>,
    mode: 'r' | 'rw',
  ): VaultTableAccess<RecordValue> {
    let active = true;
    const check = (write = false) => {
      if (!active) throw new Error('Scope ended.');
      if (write && mode !== 'rw') throw new Error('Scope is readonly.');
    };
    const scope: VaultTableAccess<RecordValue> = {
      async get(id) {
        check();
        reads(id);
        const value = values.get(id);
        return value === undefined ? undefined : structuredClone(value);
      },
      async entries(index = workspaceStoreDefinitions[store].primaryKey, equality) {
        check();
        scans(index, equality);
        const entries: VaultTableEntry[] = [];
        for (const value of values.values()) {
          const projection = projectWorkspaceIndexes(store, value);
          for (const key of workspaceRecordIndexKeys(store, index, value))
            if (equality === undefined || compareWorkspaceIndexKeys(key, equality) === 0)
              entries.push({ id: projection.id, key });
        }
        if (duplicateEntry && entries.length) entries.push(entries[0]);
        return entries.reverse(); // Consumers cannot rely on backend enumeration order.
      },
      async put(record, addOnly) {
        check(true);
        const projection = projectWorkspaceIndexes(store, record);
        if (addOnly && values.has(projection.id))
          throw new VaultStorageError(409, 'CONSTRAINT', 'Primary key already exists.');
        for (const [index, specification] of Object.entries(
          workspaceStoreDefinitions[store].indexes,
        )) {
          if (!specification.unique) continue;
          for (const value of values.values()) {
            const other = projectWorkspaceIndexes(store, value);
            if (
              other.id !== projection.id &&
              projection.keys[index].some((key) =>
                other.keys[index].some(
                  (candidate) => compareWorkspaceIndexKeys(key, candidate) === 0,
                ),
              )
            )
              throw new VaultStorageError(409, 'CONSTRAINT', 'Unique index already exists.');
          }
        }
        writes(projection.id, addOnly);
        values.set(projection.id, structuredClone(record));
        return projection.id;
      },
      async delete(id) {
        check(true);
        writes(id, 'delete');
        values.delete(id);
      },
      async run<R>(
        requested: 'r' | 'rw',
        work: (access: VaultTableAccess<RecordValue>) => Promise<R>,
      ) {
        check(requested === 'rw');
        return work(scope);
      },
    };
    return Object.assign(scope, {
      expire: () => {
        active = false;
      },
    });
  }
  const outside = () => {
    throw new Error('An explicit logical scope is required.');
  };
  const access: VaultTableAccess<RecordValue> = {
    get: outside,
    entries: outside,
    put: outside,
    delete: outside,
    async run<R>(mode: 'r' | 'rw', work: (access: VaultTableAccess<RecordValue>) => Promise<R>) {
      modes.push(mode);
      const staged = new Map([...records].map(([id, value]) => [id, structuredClone(value)]));
      const scope = bound(staged, mode) as VaultTableAccess<RecordValue> & { expire(): void };
      try {
        const result = await work(scope);
        if (mode === 'rw') {
          records.clear();
          for (const [id, value] of staged) records.set(id, value);
        }
        return result;
      } finally {
        scope.expire();
      }
    },
  };
  return {
    table: new VaultWorkspaceTable(store, access),
    access,
    records,
    modes,
    reads,
    scans,
    writes,
    duplicateEntries: () => {
      duplicateEntry = true;
    },
  };
}

describe('encrypted workspace table façade', () => {
  it('orders numeric/string index keys and ties with primary keys using IDB order', async () => {
    const fixture = memory('historyRows', [
      { id: 'z', bytes: 2 },
      { id: 'B', bytes: 2 },
      { id: 'a', bytes: 10 },
      { id: 'numeric-before-string', bytes: 1 },
      { id: 'string', bytes: '1' },
      { id: 'not-indexed' },
    ]);
    expect(await fixture.table.orderBy('bytes').primaryKeys()).toEqual([
      'numeric-before-string',
      'B',
      'z',
      'a',
      'string',
    ]);
    expect(await fixture.table.orderBy('bytes').reverse().primaryKeys()).toEqual([
      'string',
      'a',
      'z',
      'B',
      'numeric-before-string',
    ]);
    expect(await fixture.table.count()).toBe(6);
    expect(await fixture.table.orderBy('bytes').count()).toBe(5);
    expect(fixture.reads).not.toHaveBeenCalled();
  });

  it('projects keys, counts and byte metadata without reading archived payloads', async () => {
    const fixture = memory('historyRows', [
      { id: 'large', bytes: 500, rows: [['private large content']] },
      { id: 'small', bytes: 100, rows: [['private small content']] },
    ]);
    fixture.duplicateEntries();
    expect(await fixture.table.orderBy('bytes').keys()).toEqual([100, 500]);
    expect(await fixture.table.orderBy('bytes').primaryKeys()).toEqual(['small', 'large']);
    expect(await fixture.table.orderBy('bytes').count()).toBe(2);
    expect(await fixture.table.metadata('bytes')).toEqual([
      { id: 'small', value: 100 },
      { id: 'large', value: 500 },
    ]);
    const callback = vi.fn();
    await fixture.table.orderBy('bytes').eachKey(callback);
    expect(callback.mock.calls).toEqual([
      [100, { primaryKey: 'small' }],
      [500, { primaryKey: 'large' }],
    ]);
    expect(fixture.reads).not.toHaveBeenCalled();
    expect(fixture.modes).toEqual(['r', 'r', 'r', 'r', 'r']);
  });

  it('preserves distinct multientry keys but removes duplicate key/id enumeration rows', async () => {
    const fixture = memory('diagrams', [
      { id: 'both', tags: ['b', 'a', 'a'] },
      { id: 'only-a', tags: ['a'] },
      { id: 'untagged', tags: [] },
    ]);
    fixture.duplicateEntries();
    expect(await fixture.table.orderBy('tags').keys()).toEqual(['a', 'a', 'b']);
    expect(await fixture.table.orderBy('tags').primaryKeys()).toEqual(['both', 'only-a', 'both']);
    expect((await fixture.table.orderBy('tags').toArray()).map((record) => record.id)).toEqual([
      'both',
      'only-a',
      'both',
    ]);
    expect(await fixture.table.where('tags').notEqual('a').primaryKeys()).toEqual(['both']);
    expect(await fixture.table.where('tags').equals('a').count()).toBe(2);
    expect(fixture.scans).toHaveBeenLastCalledWith('tags', undefined);
    fixture.reads.mockClear();
    expect(await fixture.table.orderBy('tags').delete()).toBe(2);
    expect([...fixture.records.keys()]).toEqual(['untagged']);
    expect(fixture.reads).not.toHaveBeenCalled();
    expect(fixture.writes.mock.calls).toEqual([
      ['both', 'delete'],
      ['only-a', 'delete'],
    ]);
  });

  it('uses exact scalar equality optimization and scans compound indexes', async () => {
    const fixture = memory('nodes', [
      { id: 'a', diagramId: 'd', externalId: 'a' },
      { id: 'b', diagramId: 'd', externalId: 'b' },
      { id: 'elsewhere', diagramId: 'other', externalId: 'a' },
      { id: 'missing', diagramId: 'd' },
    ]);
    expect(await fixture.table.where('diagramId').equals('d').primaryKeys()).toEqual([
      'a',
      'b',
      'missing',
    ]);
    expect(fixture.scans).toHaveBeenLastCalledWith('diagramId', 'd');
    const key: (string | number)[] = ['d', 'a'];
    const query = fixture.table.where('[diagramId+externalId]').equals(key);
    key[1] = 'b';
    expect(await query.primaryKeys()).toEqual(['a']);
    expect(fixture.scans).toHaveBeenLastCalledWith('[diagramId+externalId]', undefined);
    expect(await fixture.table.orderBy('[diagramId+externalId]').keys()).toEqual([
      ['d', 'a'],
      ['d', 'b'],
      ['other', 'a'],
    ]);
    expect(await fixture.table.where('diagramId').notEqual('d').primaryKeys()).toEqual([
      'elsewhere',
    ]);
  });

  it('applies all filters before limits, with independent immutable queries', async () => {
    const fixture = memory('historyRows', [
      { id: 'a', bytes: 1, keep: false },
      { id: 'b', bytes: 2, keep: true },
      { id: 'c', bytes: 3, keep: true },
      { id: 'd', bytes: 4, keep: true },
    ]);
    const base = fixture.table.orderBy('bytes');
    expect((await base.first())?.id).toBe('a');
    expect(await base.count()).toBe(4);
    const filtered = base
      .limit(2)
      .filter((record) => record.keep === true)
      .filter((record) => record.bytes !== 3);
    expect(await filtered.primaryKeys()).toEqual(['b', 'd']);
    expect(await filtered.reverse().primaryKeys()).toEqual(['d', 'b']);
    expect(await base.reverse().reverse().primaryKeys()).toEqual(['a', 'b', 'c', 'd']);
    expect(await base.limit(3).limit(1).count()).toBe(1);
    fixture.reads.mockClear();
    fixture.scans.mockClear();
    expect(await base.limit(0).toArray()).toEqual([]);
    expect(fixture.reads).not.toHaveBeenCalled();
    expect(fixture.scans).not.toHaveBeenCalled();
    expect(await base.count()).toBe(4);
  });

  it('reads only the required payloads for first/limit and reuses multientry payloads', async () => {
    const fixture = memory('diagrams', [
      { id: 'a', tags: ['a', 'b'] },
      { id: 'b', tags: ['b', 'c'] },
      { id: 'c', tags: ['c'] },
    ]);
    expect(
      (await fixture.table.orderBy('tags').limit(2).toArray()).map((record) => record.id),
    ).toEqual(['a', 'a']);
    expect(fixture.reads.mock.calls).toEqual([['a']]);
    fixture.reads.mockClear();
    expect((await fixture.table.orderBy('tags').first())?.id).toBe('a');
    expect(fixture.reads.mock.calls).toEqual([['a']]);
  });

  it('runs each whole bulk operation atomically and preserves ordered bulk reads', async () => {
    const fixture = memory('settings', [{ key: 'initial', value: 1 }]);
    expect(
      await fixture.table.bulkPut([
        { key: 'a', value: 'first' },
        { key: 'b', value: 'second' },
        { key: 'a', value: 'last' },
      ]),
    ).toBe('a');
    expect(fixture.modes).toEqual(['rw']);
    expect(await fixture.table.bulkGet(['b', 'missing', 'a', 'b'])).toEqual([
      { key: 'b', value: 'second' },
      undefined,
      { key: 'a', value: 'last' },
      { key: 'b', value: 'second' },
    ]);
    expect(fixture.modes).toEqual(['rw', 'r']);
    expect(await fixture.table.bulkPut([])).toBeUndefined();
    expect(await fixture.table.bulkDelete(['a', 'a', 'missing'])).toBeUndefined();
    expect([...fixture.records.keys()]).toEqual(['initial', 'b']);
    expect(fixture.writes.mock.calls.filter(([, kind]) => kind === 'delete')).toEqual([
      ['a', 'delete'],
      ['missing', 'delete'],
    ]);
  });

  it('delegates add-only and staged uniqueness, rolling back an entire failed bulk', async () => {
    const fixture = memory('owners', [{ id: 'existing', externalId: 'external' }]);
    await expect(fixture.table.add({ id: 'existing', externalId: 'new' })).rejects.toMatchObject({
      status: 409,
    });
    expect(fixture.records.get('existing')).toEqual({ id: 'existing', externalId: 'external' });
    await expect(
      fixture.table.bulkPut([
        { id: 'first', externalId: 'duplicate' },
        { id: 'second', externalId: 'duplicate' },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect([...fixture.records.keys()]).toEqual(['existing']);
    fixture.writes.mockClear();
    await expect(
      fixture.table.bulkPut([{ id: 'valid' }, { name: 'missing id' }]),
    ).rejects.toMatchObject({ status: 422 });
    expect(fixture.writes).not.toHaveBeenCalled();
    expect(await fixture.table.add({ id: 'added', externalId: 'new' })).toBe('added');
    expect(fixture.writes).toHaveBeenLastCalledWith('added', true);
  });

  it('updates within one write scope, respects alternative primary fields and refuses ID replacement', async () => {
    const fixture = memory('settings', [{ key: 'theme', value: 'light' }]);
    expect(await fixture.table.update('missing', { value: true })).toBe(0);
    expect(await fixture.table.update('theme', { value: 'dark' })).toBe(1);
    expect(fixture.records.get('theme')).toEqual({ key: 'theme', value: 'dark' });
    expect(fixture.modes).toEqual(['rw', 'rw']);
    await expect(fixture.table.update('theme', { key: 'changed' })).rejects.toMatchObject({
      status: 422,
    });
    expect(fixture.records.get('theme')).toEqual({ key: 'theme', value: 'dark' });
    const models = memory('simulationModels', [{ diagramId: 'diagram', diagramVersion: 1 }]);
    expect(await models.table.update('diagram', { diagramVersion: 2 })).toBe(1);
    expect(models.records.get('diagram')?.diagramVersion).toBe(2);
  });

  it('uses one write scope for filtered deletion and clears through metadata without payload reads', async () => {
    const fixture = memory('historyRows', [
      { id: 'a', bytes: 1 },
      { id: 'b', bytes: 2 },
      { id: 'c', bytes: 3 },
    ]);
    expect(
      await fixture.table
        .orderBy('bytes')
        .filter((record) => Number(record.bytes) >= 2)
        .limit(1)
        .delete(),
    ).toBe(1);
    expect(fixture.modes).toEqual(['rw']);
    expect([...fixture.records.keys()]).toEqual(['a', 'c']);
    fixture.reads.mockClear();
    fixture.duplicateEntries();
    await fixture.table.clear();
    expect(fixture.records.size).toBe(0);
    expect(fixture.modes).toEqual(['rw', 'rw']);
    expect(fixture.reads).not.toHaveBeenCalled();
  });

  it('rejects invalid queries and propagates failures from reads, predicates and key callbacks', async () => {
    const fixture = memory('settings', [{ key: 'a', value: 1 }]);
    for (const index of ['unknown', '__proto__', 'constructor'])
      expect(() => fixture.table.orderBy(index)).toThrow('Unknown workspace query index');
    expect(() => new VaultWorkspaceTable('unknown' as WorkspaceStoreName, fixture.access)).toThrow(
      'Unknown workspace store',
    );
    for (const key of [NaN, Infinity, {}, [NaN]])
      expect(() => fixture.table.where('key').equals(key as WorkspaceIndexKey)).toThrow(
        'Invalid workspace query key',
      );
    for (const limit of [-1, 1.5, Infinity, NaN])
      expect(() => fixture.table.orderBy('key').limit(limit)).toThrow('nonnegative integer');
    expect(() => fixture.table.get('')).toThrow('Invalid workspace record identifier');
    await expect(
      fixture.table
        .filter(() => {
          throw new Error('Predicate failed.');
        })
        .count(),
    ).rejects.toThrow('Predicate failed.');
    await expect(
      fixture.table.orderBy('key').eachKey(() => {
        throw new Error('Key callback failed.');
      }),
    ).rejects.toThrow('Key callback failed.');
    const broken = new VaultWorkspaceTable('settings', {
      ...fixture.access,
      run: <R>(mode: 'r' | 'rw', work: (access: VaultTableAccess<RecordValue>) => Promise<R>) =>
        fixture.access.run(mode, (scope) => work({ ...scope, get: async () => undefined })),
    });
    await expect(broken.toArray()).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_INDEX' });
  });

  it('enters the authoritative scope for empty operations and zero-length queries too', async () => {
    const fixture = memory('settings', [{ key: 'a', value: 1 }]);
    const locked = new VaultWorkspaceTable('settings', {
      ...fixture.access,
      run: async () => {
        throw new VaultStorageError(423, 'WORKSPACE_LOCKED', 'Unlock the workspace.');
      },
    });
    for (const operation of [
      () => locked.bulkGet([]),
      () => locked.bulkPut([]),
      () => locked.bulkDelete([]),
      () => locked.orderBy('key').limit(0).toArray(),
      () => locked.orderBy('key').limit(0).count(),
      () => locked.orderBy('key').limit(0).delete(),
      () => locked.metadata('key'),
    ])
      await expect(operation()).rejects.toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    expect(fixture.reads).not.toHaveBeenCalled();
    expect(fixture.scans).not.toHaveBeenCalled();
    expect(fixture.writes).not.toHaveBeenCalled();
  });

  it('matches native Dexie multientry, compound, limit and filtered-key semantics', async () => {
    const db = new WorkspaceDatabase(`vault-table-semantics-${crypto.randomUUID()}`);
    try {
      await db.open();
      const initial = [
        { id: 'a', tags: ['green', 'blue', 'green'], name: 'Keep A' },
        { id: 'b', tags: ['blue', 'red'], name: 'Skip' },
        { id: 'c', tags: [], name: 'Keep C' },
        { id: 'd', tags: ['red'], name: 'Keep D' },
      ];
      await db.table('diagrams').bulkPut(initial);
      const fixture = memory('diagrams', initial);
      const native = db.asStorage().diagrams;
      const nativeFilter = (record: unknown) => (record as RecordValue).name !== 'Skip';
      expect(await fixture.table.orderBy('tags').primaryKeys()).toEqual(
        await native.orderBy('tags').primaryKeys(),
      );
      expect(await fixture.table.where('tags').notEqual('green').keys()).toEqual(
        await native.where('tags').notEqual('green').keys(),
      );
      expect(await fixture.table.orderBy('tags').reverse().limit(3).keys()).toEqual(
        await native.orderBy('tags').reverse().limit(3).keys(),
      );
      expect(
        await fixture.table.orderBy('tags').limit(3).filter(nativeFilter).primaryKeys(),
      ).toEqual(await native.orderBy('tags').limit(3).filter(nativeFilter).primaryKeys());
      expect(await fixture.table.where('tags').equals('red').delete()).toBe(
        await native.where('tags').equals('red').delete(),
      );
      expect(await fixture.table.toArray()).toEqual(await native.toArray());
    } finally {
      db.close();
      await db.delete();
    }
  });
});
