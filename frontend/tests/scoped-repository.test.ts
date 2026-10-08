import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import {
  workspaceStoreNames,
  type WorkspaceScope,
  type WorkspaceStorage,
} from '../src/storage/contracts';
import { blankGraph, newNode, type Graph, type Owner } from '../src/model/types';
import { StorageError } from '../src/model/errors';

let db: WorkspaceDatabase;
beforeEach(async () => {
  db = new WorkspaceDatabase(`scoped-repository-${crypto.randomUUID()}`);
  await db.initialize();
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

/** Rejects ambient root access while a callback should use its explicit scope. */
function isolatedRoot(storage: WorkspaceStorage): WorkspaceStorage {
  let activeCallbacks = 0;
  const privateMethods = new Set([
    'graph',
    'backup',
    'initialize',
    'forgetDatasets',
    'rememberDataset',
  ]);
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'captureOperation')
        return async () => {
          const operation = await target.captureOperation();
          return { ...operation, storage: isolatedRoot(operation.storage) };
        };
      if (property === 'atomic')
        return (
          mode: 'r' | 'rw',
          stores: readonly (typeof workspaceStoreNames)[number][],
          work: (scope: WorkspaceScope) => Promise<unknown>,
        ) =>
          target.atomic(mode, stores, async (scope) => {
            activeCallbacks++;
            try {
              return await work(scope);
            } finally {
              activeCallbacks--;
            }
          });
      if (
        activeCallbacks &&
        (workspaceStoreNames.includes(property as never) || privateMethods.has(String(property)))
      )
        throw new Error(`Ambient root storage access: ${String(property)}`);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function graph() {
  const source = blankGraph('Scoped process', 'mindmap');
  source.nodes = [newNode(source.diagram.id, { title: 'Original root', externalId: 'root' })];
  return source;
}

describe('explicit repository storage scopes', () => {
  it('binds nested import, bulk owners, entity creation and edits to callback scopes', async () => {
    const repo = new Repository(isolatedRoot(db.asStorage()));
    const imported = await repo.importGraph(graph());
    const expanded = await repo.bulk(imported.diagram.id, {
      baseVersion: imported.diagram.version,
      owners: [{ name: 'Assembly team', kind: 'team', externalId: 'team' }],
      nodes: [
        {
          title: 'Assembly',
          externalId: 'assembly',
          ownerExternalId: 'team',
          parentExternalId: 'root',
        },
      ],
      edges: [{ sourceExternalId: 'root', targetExternalId: 'assembly', externalId: 'route' }],
    });
    expect(expanded.nodes[1].ownerIds).toEqual([expanded.owners[0].id]);
    expect(expanded.nodes[1].parentId).toBe(expanded.nodes[0].id);
    const owner = await repo.request<Owner>(`/owners/${expanded.owners[0].id}`, 'PATCH', {
      version: expanded.owners[0].version,
      name: 'Updated team',
    });
    expect(owner.name).toBe('Updated team');
    const node = await repo.request<Graph['nodes'][number]>(
      `/nodes/${expanded.nodes[1].id}`,
      'PATCH',
      {
        version: expanded.nodes[1].version,
        description: 'Updated evidence',
      },
    );
    expect(node.description).toBe('Updated evidence');
    const child = await repo.request<Graph['nodes'][number]>(`/nodes/${node.id}/children`, 'POST', {
      title: 'Child operation',
    });
    expect(child.parentId).toBe(node.id);
    await repo.request(`/nodes/${child.id}`, 'DELETE');
    expect(
      (await repo.getGraph(imported.diagram.id)).nodes.some((item) => item.id === child.id),
    ).toBe(false);
    await repo.request(`/owners/${owner.id}`, 'DELETE');
    expect((await repo.getGraph(imported.diagram.id)).owners).toEqual([]);
    expect(await repo.search('Updated evidence')).toHaveLength(1);
  });

  it('keeps the guard on the same snapshot for every write route', async () => {
    const repo = new Repository(isolatedRoot(db.asStorage()));
    await db.settings.put({ key: 'mcp-access', value: 'write' });
    const guard = vi.fn(async (scope: WorkspaceStorage) => {
      expect(scope === repo.db).toBe(false);
      expect((await scope.settings.get('mcp-access'))?.value).toBe('write');
      throw new StorageError(403, 'Write grant revoked.');
    });
    const original = await repo.importGraph(graph());
    const backup = await repo.db.backup();
    const operations = [
      () => repo.request('/settings/appearance', 'PUT', { value: 'dark' }, { beforeWrite: guard }),
      () =>
        repo.request(
          '/spatial-diagrams',
          'POST',
          { name: 'Rejected spatial' },
          { beforeWrite: guard },
        ),
      () => repo.request('/workspace/import', 'POST', backup, { beforeWrite: guard }),
      () =>
        repo.request(
          `/nodes/${original.nodes[0].id}`,
          'PATCH',
          { version: 1, title: 'Rejected edit' },
          { beforeWrite: guard },
        ),
      () => repo.removeDiagram(original.diagram.id, guard),
    ];
    for (const [index, operation] of operations.entries())
      await expect(operation(), `Write route ${index}`).rejects.toMatchObject({ status: 403 });
    expect(guard).toHaveBeenCalledTimes(operations.length);
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Original root');
    expect(await db.diagrams.count()).toBe(1);
    expect(await db.settings.get('appearance')).toBeUndefined();
  });

  it('restores history through the saver scope and deletes the complete diagram lifecycle', async () => {
    const repo = new Repository(isolatedRoot(db.asStorage()));
    const original = await repo.importGraph(graph());
    const snapshot = await repo.history.create(original.diagram.id, {
      baseVersion: original.diagram.version,
      name: 'Original process',
    });
    const edited = await repo.saveGraph(
      {
        ...original,
        nodes: original.nodes.map((node) => ({ ...node, title: 'Edited title' })),
      },
      original.diagram.version,
    );
    const restored = await repo.history.restore(original.diagram.id, snapshot.id, {
      baseVersion: edited.diagram.version,
    });
    expect(restored.graph.nodes[0].title).toBe('Original root');
    await repo.removeDiagram(original.diagram.id);
    for (const name of [
      'nodes',
      'edges',
      'datasets',
      'historySnapshots',
      'historyContents',
      'historySources',
      'historyRows',
      'simulationModels',
      'simulationRuns',
      'simulationCheckpoints',
    ] as const)
      expect(await db.table(name).count()).toBe(0);
    await expect(repo.getGraph(original.diagram.id)).rejects.toMatchObject({ status: 404 });
  });

  it('rolls back failed replacement and nested imported graphs without publishing datasets', async () => {
    const repo = new Repository(isolatedRoot(db.asStorage()));
    const original = await repo.importGraph(graph());
    const backup = await repo.db.backup();
    const before = await db.backup();
    const remember = vi.spyOn(db, 'rememberDataset');
    const forget = vi.spyOn(db, 'forgetDatasets');
    const corrupt = structuredClone(backup);
    corrupt.templates[0].graph.edges = [{ sourceNodeId: 'missing' } as never];
    await expect(repo.restore(corrupt, 'replace')).rejects.toThrow();
    const after = await db.backup();
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    expect(remember).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Original root');
  });
});
