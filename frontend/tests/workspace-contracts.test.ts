import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import {
  WORKSPACE_SCHEMA_VERSION,
  workspaceStoreDefinitions,
  workspaceStoreNames,
  type WorkspaceScope,
  type WorkspaceStorage,
} from '../src/storage/contracts';
import { VAULT_STORES } from '../src/security/vault-schema';
import { Repository } from '../src/storage/repository';
import { blankGraph, newNode } from '../src/model/types';

let db: WorkspaceDatabase;
let storage: WorkspaceStorage;
const peers: WorkspaceDatabase[] = [];
const cleanups: Array<() => void> = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`workspace-contract-${crypto.randomUUID()}`);
  storage = db.asStorage();
  await storage.open();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const peer of peers.splice(0)) peer.close();
  storage.close();
  await db.delete();
});

describe('explicit legacy workspace storage contract', () => {
  it('covers all 14 logical stores and matches the actual legacy keys/index constraints', () => {
    expect(workspaceStoreNames).toEqual(VAULT_STORES);
    expect(Object.keys(workspaceStoreDefinitions).sort()).toEqual([...workspaceStoreNames].sort());
    expect(storage.tables.map((table) => table.name).sort()).toEqual(
      [...workspaceStoreNames].sort(),
    );
    expect(storage.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(storage.verno).toBe(8);
    expect(db.schemaVersion).toBe(8);
    expect(db.asStorage()).toBe(storage);
    for (const name of workspaceStoreNames) {
      const definition = workspaceStoreDefinitions[name],
        native = db.table(name).schema;
      expect(native.primKey.keyPath).toBe(definition.primaryKey);
      expect(native.indexes.map((index) => index.name).sort()).toEqual(
        Object.keys(definition.indexes).sort(),
      );
      for (const index of native.indexes) {
        const specification = definition.indexes[index.name];
        expect(Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath]).toEqual(
          specification.fields,
        );
        expect(index.unique).toBe(Boolean(specification.unique));
        expect(index.multi).toBe(Boolean(specification.multiEntry));
      }
    }
  });

  it('passes explicit nested scopes, preserves read-your-writes, and publishes commit hooks once', async () => {
    const committed = vi.fn();
    await storage.atomic('rw', ['settings', 'templates'], async (scope) => {
      await scope.settings.put({ key: 'first', value: 1 });
      await scope.atomic('rw', ['settings'], async (nested) => {
        expect((await nested.settings.get('first'))?.value).toBe(1);
        await nested.settings.put({ key: 'second', value: 2 });
        nested.afterCommit(committed);
      });
      expect(committed).not.toHaveBeenCalled();
      expect((await scope.settings.get('second'))?.value).toBe(2);
    });
    expect(committed).toHaveBeenCalledOnce();
    expect((await storage.settings.toArray()).map((entry) => entry.key)).toEqual([
      'first',
      'second',
    ]);
  });

  it('rolls back nested writes and commit hooks when the outer scope fails', async () => {
    const committed = vi.fn();
    await expect(
      storage.atomic('rw', ['settings'], async (scope) => {
        await scope.atomic('rw', ['settings'], async (nested) => {
          await nested.settings.put({ key: 'temporary', value: 'must roll back' });
          nested.afterCommit(committed);
        });
        throw new Error('Reject outer operation.');
      }),
    ).rejects.toThrow('Reject outer operation.');
    expect(await storage.settings.get('temporary')).toBeUndefined();
    expect(committed).not.toHaveBeenCalled();
  });

  it('aborts the outer transaction when a failed nested write is caught by its caller', async () => {
    const committed = vi.fn();
    await expect(
      storage.atomic('rw', ['settings'], async (scope) => {
        await scope.settings.put({ key: 'outer', value: 'must roll back' });
        try {
          await scope.atomic('rw', ['settings'], async (nested) => {
            await nested.settings.put({ key: 'nested', value: 'must roll back too' });
            nested.afterCommit(committed);
            throw new Error('Nested operation failed.');
          });
        } catch {
          // Catching an inner failure must not publish partially completed mutations.
        }
      }),
    ).rejects.toThrow();
    expect(await storage.settings.toArray()).toEqual([]);
    expect(committed).not.toHaveBeenCalled();
  });

  it('enforces readonly/subset restrictions and expires escaped table/query handles', async () => {
    await storage.settings.put({ key: 'existing', value: 1 });
    let escaped!: WorkspaceScope;
    let query!: ReturnType<WorkspaceStorage['settings']['orderBy']>;
    await storage.atomic('r', ['settings'], async (scope) => {
      escaped = scope;
      query = scope.settings.orderBy('key');
      expect(() => scope.settings.put({ key: 'denied', value: true })).toThrow('read-only');
      await expect(scope.atomic('rw', ['settings'], async () => undefined)).rejects.toMatchObject({
        status: 403,
      });
      expect(() => scope.owners).toThrow('outside');
      await expect(scope.atomic('r', ['owners'], async () => undefined)).rejects.toMatchObject({
        status: 422,
      });
      expect((await query.first())?.key).toBe('existing');
    });
    expect(() => escaped.settings).toThrow('ended');
    expect(() => query.toArray()).toThrow('ended');
    expect(await storage.settings.get('denied')).toBeUndefined();
    expect(() => storage.settings.where('undeclared')).toThrow('Unknown workspace query index');
  });

  it('attaches hooks to the enclosing native Dexie transaction too', async () => {
    const committed = vi.fn();
    await expect(
      db.transaction('rw', db.settings, async () => {
        await db.atomic('rw', ['settings'], async (scope) => {
          await scope.settings.put({ key: 'nested', value: 'rollback' });
          scope.afterCommit(committed);
        });
        expect(committed).not.toHaveBeenCalled();
        throw new Error('Legacy parent failed.');
      }),
    ).rejects.toThrow('Legacy parent failed.');
    expect(committed).not.toHaveBeenCalled();
    expect(await db.settings.get('nested')).toBeUndefined();
  });

  it('projects history byte metadata without materializing row bodies', async () => {
    await db.historyRows.bulkPut([
      {
        id: 'large',
        diagramId: 'diagram',
        digest: 'a'.repeat(64),
        bytes: 500,
        rows: [['private row']],
      },
      {
        id: 'small',
        diagramId: 'diagram',
        digest: 'b'.repeat(64),
        bytes: 100,
        rows: [['another row']],
      },
    ]);
    const reading = vi.fn((value) => value);
    db.historyRows.hook('reading', reading);
    const metadata = await storage.atomic('r', ['historyRows'], (scope) =>
      scope.historyRows.metadata('bytes'),
    );
    expect(metadata).toEqual([
      { id: 'small', value: 100 },
      { id: 'large', value: 500 },
    ]);
    expect(reading).not.toHaveBeenCalled();
    expect(await storage.historyRows.where('diagramId').equals('diagram').count()).toBe(2);
  });

  it('notifies only committed changed-store names, including peer writes, with no record contents', async () => {
    const listener = vi.fn();
    cleanups.push(storage.subscribe(listener));
    await storage.atomic('rw', ['settings', 'owners'], async (scope) => {
      await scope.owners.toArray();
      await scope.settings.put({ key: 'private-setting', value: 'private content' });
    });
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(listener.mock.calls.every(([change]) => Object.keys(change).join() === 'stores')).toBe(
      true,
    );
    expect(listener.mock.calls.flatMap(([change]) => change.stores)).toEqual(['settings']);
    listener.mockClear();
    await expect(
      storage.atomic('rw', ['settings'], async (scope) => {
        await scope.settings.put({ key: 'rolled-back', value: 'private failed write' });
        throw new Error('Abort.');
      }),
    ).rejects.toThrow('Abort.');
    expect(listener).not.toHaveBeenCalled();
    const peer = new WorkspaceDatabase(db.name);
    peers.push(peer);
    await peer.settings.put({ key: 'peer', value: 'private peer content' });
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(listener).toHaveBeenCalledWith({ stores: ['settings'] });
    expect(JSON.stringify(listener.mock.calls)).not.toContain('private');
  });

  it('preserves native transaction compatibility, graph assembly, initialization and backup version 8', async () => {
    await storage.initialize();
    const graph = blankGraph('Legacy graph');
    graph.nodes = [newNode(graph.diagram.id, { title: 'Node' })];
    const saved = await new Repository(db).importGraph(graph);
    await storage.atomic(
      'r',
      ['diagrams', 'nodes', 'edges', 'owners', 'datasets', 'simulationModels'],
      async (scope) => {
        expect(await scope.graph(saved.diagram.id)).toEqual(saved);
      },
    );
    const backup = await storage.backup();
    expect(backup.schemaVersion).toBe(8);
    expect(backup.diagrams).toEqual([saved.diagram]);
    expect(await db.transaction('r', db.nodes, () => db.nodes.count())).toBe(1);
  });
});
