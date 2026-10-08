import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import {
  VaultLogicalRecordCodec,
  type VaultLogicalRead,
} from '../src/security/vault-logical-record';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordStorage } from '../src/security/vault-storage';
import {
  VaultWorkspaceRecords,
  type VaultWorkspaceRecordScope,
} from '../src/security/vault-workspace-records';
import { workspaceStoreDefinitions, workspaceStoreNames } from '../src/storage/contracts';
import { base, newNode } from '../src/model/types';
import type { HistoryRows } from '../src/history/types';

const password = 'test-only record store password phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let storage: VaultRecordStorage,
  session: VaultSession,
  records: VaultWorkspaceRecords,
  name: string;
let logical: VaultLogicalRecordCodec;

beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  name = `vault-workspace-records-${crypto.randomUUID()}`;
  storage = new VaultRecordStorage(name);
  await storage.create(created.header);
  session = new VaultSession(storage, cipher);
  await session.initialize();
  await session.unlock(password);
  logical = new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto);
  records = new VaultWorkspaceRecords(session, logical);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

async function rawRecords() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
const node = (id: string, externalId?: string) => ({
  ...newNode('private-diagram', { nodeType: 'process' }),
  id,
  title: 'Private customer process',
  description: 'Private SQL evidence',
  ...(externalId ? { externalId } : {}),
});
function archivedRows(): HistoryRows {
  return {
    id: 'private-content-fingerprint',
    diagramId: 'private-diagram',
    digest: 'private-unsalted-digest',
    bytes: 1_000_000,
    rows: Array.from({ length: 100_000 }, (_, index) => [`Client ${index}`, String(index)]),
  };
}

describe('one encrypted typed store for the complete workspace', () => {
  it('round trips all fourteen logical stores without readable values, IDs or content digests', async () => {
    await records.atomic('rw', workspaceStoreNames, async (scope) => {
      for (const store of workspaceStoreNames) {
        const primary = workspaceStoreDefinitions[store].primaryKey;
        const record = {
          [primary]: `private-${store}`,
          name: 'Private enterprise project',
          evidence: "WHERE secret = 'customer-canary'",
          digest: 'unsalted-private-fingerprint',
          rows: [['Private cell', 87219]],
        };
        // This exercises storage for each type; domain validation belongs to the
        // shared repository, which will supply the complete real model fields.
        await scope.table(store).put(record as never);
      }
    });
    const raw = JSON.stringify(await rawRecords());
    for (const canary of [
      'Private enterprise project',
      'customer-canary',
      'Private cell',
      'unsalted-private-fingerprint',
      ...workspaceStoreNames.map((store) => `private-${store}`),
    ])
      expect(raw).not.toContain(canary);
    for (const store of workspaceStoreNames) {
      const value = await records.table(store).get(`private-${store}`);
      expect(value).toMatchObject({
        name: 'Private enterprise project',
        rows: [['Private cell', 87219]],
      });
    }
  });

  it('supports scoped read-your-writes across stores and rolls back the whole operation', async () => {
    await expect(
      records.atomic('rw', ['nodes', 'settings'], async (scope) => {
        await scope.table('nodes').put(node('n'));
        await scope.table('settings').put({ key: 'mcp-access', value: 'write' });
        expect(
          await scope.table('nodes').where('diagramId').equals('private-diagram').count(),
        ).toBe(1);
        expect(await scope.table('settings').get('mcp-access')).toEqual({
          key: 'mcp-access',
          value: 'write',
        });
        throw new Error('Later domain validation failed.');
      }),
    ).rejects.toThrow('domain validation');
    expect(await records.table('nodes').count()).toBe(0);
    expect(await records.table('settings').get('mcp-access')).toBeUndefined();
  });

  it('does not resurrect a rejected nested write when its caller catches the error', async () => {
    await expect(
      records.atomic('rw', ['nodes'], async (scope) => {
        await scope
          .atomic('rw', ['nodes'], async (child) => {
            await child.table('nodes').put(node('rejected'));
            throw new Error('Rejected nested operation.');
          })
          .catch(() => undefined);
      }),
    ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_TRANSACTION' });
    expect(await records.table('nodes').count()).toBe(0);
  });

  it('does not publish a cache while an unawaited nested callback is still running', async () => {
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const published = vi.fn();
    let childWork!: Promise<unknown>;
    await expect(
      records.atomic('rw', ['nodes'], async (scope) => {
        childWork = scope.atomic('rw', ['nodes'], async (child) => {
          child.afterCommit(published);
          await waiting;
        });
        void childWork.catch(() => undefined);
      }),
    ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_TRANSACTION' });
    expect(published).not.toHaveBeenCalled();
    resume();
    await expect(childWork).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_TRANSACTION' });
    expect(await records.table('nodes').count()).toBe(0);
  });

  it('keeps returned values isolated from the staged journal and expires completed child scopes', async () => {
    await records.table('nodes').put(node('n'));
    await records.atomic('rw', ['nodes'], async (scope) => {
      const value = (await scope.table('nodes').get('n'))!;
      value.title = 'unpersisted mutation';
      value.ownerIds.push('unpersisted owner');
      expect((await scope.table('nodes').get('n'))?.title).toBe('Private customer process');
      expect(await scope.table('nodes').where('ownerIds').equals('unpersisted owner').count()).toBe(
        0,
      );
      let retained!: VaultWorkspaceRecordScope;
      await scope.atomic('r', ['nodes'], async (child) => {
        retained = child;
      });
      expect(() => retained.table('nodes')).toThrow('transaction has finished');
      expect(await scope.table('nodes').count()).toBe(1);
    });
    expect((await records.table('nodes').get('n'))?.title).toBe('Private customer process');
  });

  it('enforces unique external identifiers within the same logical diagram', async () => {
    await records.table('nodes').put(node('n1', 'external-private'));
    await expect(records.table('nodes').put(node('n2', 'external-private'))).rejects.toMatchObject({
      status: 409,
      code: 'WORKSPACE_DUPLICATE_INDEX',
    });
    await records
      .table('nodes')
      .put({ ...node('n3', 'external-private'), diagramId: 'other-diagram' });
    expect(await records.table('nodes').count()).toBe(2);
    expect(
      await records
        .table('nodes')
        .where('[diagramId+externalId]')
        .equals(['private-diagram', 'external-private'])
        .primaryKeys(),
    ).toEqual(['n1']);
  });

  it('detects unique-key collisions in concurrently staged puts before publishing either', async () => {
    await expect(
      records.atomic('rw', ['nodes'], async (scope) => {
        await Promise.all([
          scope.table('nodes').put(node('a', 'shared-unique-key')),
          scope.table('nodes').put(node('b', 'shared-unique-key')),
        ]);
      }),
    ).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_DUPLICATE_INDEX' });
    expect(await records.table('nodes').count()).toBe(0);
  });

  it('rejects concurrently added duplicate primary keys before either becomes durable', async () => {
    await expect(
      records.atomic('rw', ['nodes'], async (scope) => {
        await Promise.all([
          scope.table('nodes').add(node('same-id', 'first-external')),
          scope.table('nodes').add(node('same-id', 'second-external')),
        ]);
      }),
    ).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_DUPLICATE_KEY' });
    expect(await records.table('nodes').count()).toBe(0);
  });

  it('does not mistake an old in-flight decryption for corruption after a staged index edit', async () => {
    await records.table('nodes').put(node('race', 'old-external'));
    let begun!: () => void, resume!: () => void;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = logical.read.bind(logical);
    vi.spyOn(logical, 'read').mockImplementation(async function <T>(
      ...args: Parameters<typeof logical.read>
    ): Promise<VaultLogicalRead<T>> {
      const result = await original<T>(...args);
      begun();
      await wait;
      return result;
    });
    await records.atomic('rw', ['nodes'], async (scope) => {
      const reading = scope.table('nodes').get('race');
      await started;
      await scope.table('nodes').put(node('race', 'new-external'));
      resume();
      expect((await reading)?.externalId).toBe('new-external');
    });
    expect((await records.table('nodes').get('race'))?.externalId).toBe('new-external');
  });

  it('totals encrypted history metadata without fetching or decrypting archived row chunks', async () => {
    await records.table('historyRows').put(archivedRows());
    const read = vi.spyOn(storage, 'read');
    expect(await records.table('historyRows').metadata('bytes')).toEqual([
      { id: 'private-content-fingerprint', value: 1_000_000 },
    ]);
    expect(await records.table('historyRows').orderBy('bytes').keys()).toEqual([1_000_000]);
    expect(read).not.toHaveBeenCalled();
    expect(await records.table('historyRows').get('private-content-fingerprint')).toEqual(
      archivedRows(),
    );
    expect(read).toHaveBeenCalled();
  }, 20_000);

  it('coalesces many logical updates into one root revision and reuses unchanged row chunks', async () => {
    const rows = archivedRows();
    await records.table('historyRows').put(rows);
    const commit = vi.spyOn(storage, 'commit');
    await records.atomic('rw', ['historyRows'], async (scope) => {
      await scope.table('historyRows').put({ ...rows, bytes: 2_000_000 });
      await scope.table('historyRows').update(rows.id, { bytes: 3_000_000 });
    });
    const mutationBatch = commit.mock.calls.find(([, mutations]) => mutations.length)?.[1];
    expect(mutationBatch).toHaveLength(1);
    expect(mutationBatch![0]).toMatchObject({ kind: 'put', record: { revision: 2 } });
    expect(await records.table('historyRows').metadata('bytes')).toEqual([
      { id: rows.id, value: 3_000_000 },
    ]);
    expect((await records.table('historyRows').get(rows.id))?.rows).toEqual(rows.rows);
  }, 20_000);

  it('deletes a logical record and every authenticated chunk atomically', async () => {
    await records.table('historyRows').put(archivedRows());
    expect((await rawRecords()).length).toBeGreaterThan(1);
    await records.table('historyRows').clear();
    expect(await rawRecords()).toEqual([]);
    expect(await records.table('historyRows').count()).toBe(0);
  }, 20_000);

  it('does not add a sixty-four-owner limit to an existing node', async () => {
    const owners = Array.from({ length: 8_000 }, (_, index) => `private-owner-${index}`);
    await records.table('nodes').put({ ...node('many-owners'), ownerIds: owners });
    expect(
      await records.table('nodes').where('ownerIds').equals('private-owner-7999').primaryKeys(),
    ).toEqual(['many-owners']);
    expect((await records.table('nodes').get('many-owners'))?.ownerIds).toEqual(owners);
    expect(JSON.stringify(await rawRecords())).not.toContain('private-owner-7999');
  });

  it('prevents writes through a read-only child and forbids access to unlisted stores', async () => {
    await records.atomic('rw', ['nodes'], async (scope) => {
      await scope.atomic('r', ['nodes'], async (child) => {
        await expect(child.table('nodes').put(node('forbidden'))).rejects.toMatchObject({
          code: 'INVALID_WORKSPACE_TRANSACTION',
        });
      });
      expect(() => scope.table('settings')).toThrow('outside this workspace transaction');
    });
    expect(await records.table('nodes').count()).toBe(0);
  });

  it('returns WORKSPACE_LOCKED for retained tables instead of restarting stale work after unlock', async () => {
    const nodes = records.table('nodes');
    await nodes.put(node('committed'));
    let continueWork!: () => void;
    const waiting = new Promise<void>((resolve) => {
      continueWork = resolve;
    });
    let begun!: () => void;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const operation = records.atomic('rw', ['nodes'], async (scope) => {
      await scope.table('nodes').put(node('stale'));
      begun();
      await waiting;
    });
    const rejected = expect(operation).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await started;
    await session.lock();
    await expect(nodes.get('committed')).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await session.unlock(password);
    continueWork();
    await rejected;
    expect(await nodes.orderBy('id').primaryKeys()).toEqual(['committed']);
  });

  it('preserves the last durable value and suppresses cache publication when storage runs out of quota', async () => {
    const value = { ...base(), name: 'Private diagram', type: 'flowchart', settings: {} };
    await records.table('diagrams').put(value as never);
    const published = vi.fn();
    const commit = vi
      .spyOn(storage, 'commit')
      .mockRejectedValueOnce(new DOMException('Quota exceeded.', 'QuotaExceededError'));
    await expect(
      records.atomic('rw', ['diagrams'], async (scope) => {
        await scope.table('diagrams').update(value.id, { name: 'Unsaved edit' });
        scope.afterCommit(published);
      }),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(commit).toHaveBeenCalledOnce();
    expect(published).not.toHaveBeenCalled();
    expect((await records.table('diagrams').get(value.id))?.name).toBe('Private diagram');
  });
});
