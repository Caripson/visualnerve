import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { StorageError } from '../src/model/errors';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';

const password = 'test-only bulk identity password phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(created.keys));

const collections = ['nodes', 'edges', 'owners'] as const;
type Collection = (typeof collections)[number];
const stores = ['diagrams', 'nodes', 'edges', 'owners', 'datasets', 'simulationModels'] as const;

describe.each(['indexeddb', 'encrypted'] as const)(
  'bulk identity safety with %s storage',
  (backend) => {
    let repo: Repository, database: WorkspaceDatabase | EncryptedWorkspaceDatabase;
    let session: VaultSession | undefined, name: string;
    let original: Graph;

    beforeEach(async () => {
      name = `bulk-identities-${backend}-${crypto.randomUUID()}`;
      if (backend === 'encrypted') {
        const physical = new VaultRecordStorage(name);
        await physical.create(created.header);
        session = new VaultSession(physical, cipher);
        await session.initialize();
        await session.unlock(password);
        database = new EncryptedWorkspaceDatabase(
          session,
          new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
        );
      } else {
        database = new WorkspaceDatabase(name);
        await database.initialize();
      }
      repo = new Repository(database);
      original = await seed(false);
    });

    afterEach(async () => {
      if (database instanceof EncryptedWorkspaceDatabase) {
        database.dispose();
        await session!.dispose();
        session = undefined;
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } else await database.delete();
    });

    async function seed(simulation: boolean) {
      const owners = await Promise.all([
        repo.owner({
          name: 'Operations',
          externalId: `team:operations:${crypto.randomUUID()}`,
          metadata: { retain: true },
        }),
        repo.owner({ name: 'Delivery', externalId: `team:delivery:${crypto.randomUUID()}` }),
      ]);
      const graph = simulation
        ? createSimulationGraph(
            'Existing simulator',
            createBasicModel({ capacity: 2, processingSeconds: 120 }),
          )
        : blankGraph('Existing code diagram', 'mindmap');
      if (!simulation) {
        graph.nodes = ['Import', 'Transform', 'Output'].map((title) =>
          newNode(graph.diagram.id, { title }),
        );
        graph.edges = [
          newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id),
          newEdge(graph.diagram.id, graph.nodes[1].id, graph.nodes[2].id),
        ];
      }
      graph.owners = owners;
      graph.nodes = graph.nodes.map((node, index) => ({
        ...node,
        externalId: `node:${index}`,
        x: 100 + index * 300,
        y: 50,
        width: 280,
        description: 'Description to preserve',
        notes: 'Private source evidence to preserve',
        ownerIds: [owners[index === 2 ? 1 : 0].id],
        metadata: { ...node.metadata, retain: { evidence: true } },
      }));
      graph.edges = graph.edges.map((edge, index) => ({
        ...edge,
        externalId: `route:${index}`,
        label: `Existing route ${index}`,
        style: 'dashed',
        metadata: { ...edge.metadata, retain: true },
      }));
      const saved = await repo.importGraph(graph);
      return repo.getGraph(saved.diagram.id);
    }

    async function snapshot() {
      return repo.db.atomic('r', stores, async (scope) =>
        Object.fromEntries(
          await Promise.all(stores.map(async (store) => [store, await scope[store].toArray()])),
        ),
      );
    }
    function selected<T extends Collection>(collection: T): Graph[T][number] {
      return original[collection][collection === 'nodes' ? 1 : 0] as Graph[T][number];
    }
    function creation(collection: Collection, id: string = crypto.randomUUID()) {
      if (collection === 'nodes') return { id, title: 'New node' };
      if (collection === 'owners') return { id, name: 'New owner' };
      return {
        id,
        sourceNodeId: original.nodes[0].id,
        targetNodeId: original.nodes[1].id,
        label: 'New route',
      };
    }
    async function rejected(data: Record<string, unknown>, status: number, message?: RegExp) {
      const before = await snapshot();
      const operation = repo.request(`/diagrams/${original.diagram.id}/bulk`, 'POST', {
        baseVersion: original.diagram.version,
        ...data,
      });
      await expect(operation).rejects.toMatchObject({ status });
      if (message) await expect(operation).rejects.toThrow(message);
      expect(await snapshot()).toEqual(before);
      expect(await repo.getGraph(original.diagram.id)).toEqual(original);
    }

    it.each(collections)(
      'rejects a canonical-only existing %s ID without changing content or versions',
      async (collection) => {
        await rejected(
          {
            upsert: true,
            owners: [{ name: 'Must not be written', externalId: 'batch-owner' }],
            nodes: [{ title: 'Must not be written', externalId: 'batch-node' }],
            [collection]: [creation(collection), { id: selected(collection).id, x: 999 }],
          },
          409,
          /versioned PATCH.*externalId/,
        );
      },
    );

    it.each(['nodes', 'edges'] as const)(
      'rejects a canonical-only simulator %s ID before projection can collapse duplicates',
      async (collection) => {
        original = await seed(true);
        await rejected(
          { upsert: true, [collection]: [{ id: selected(collection).id, x: 999 }] },
          409,
        );
        expect((await repo.getGraph(original.diagram.id)).simulation).toEqual(original.simulation);
      },
    );

    it.each(collections)(
      'rejects duplicate new canonical %s IDs atomically',
      async (collection) => {
        const id = crypto.randomUUID();
        await rejected(
          { upsert: true, [collection]: [creation(collection, id), creation(collection, id)] },
          422,
          /Duplicate .* id in bulk/,
        );
      },
    );

    it.each(collections)(
      'rejects duplicate external %s identities even with upsert enabled',
      async (collection) => {
        await rejected(
          {
            upsert: true,
            [collection]: [
              { ...creation(collection), externalId: 'batch:duplicate' },
              { ...creation(collection), externalId: 'batch:duplicate' },
            ],
          },
          422,
          /Duplicate external .* id in bulk/,
        );
      },
    );

    it.each(collections)(
      'rejects disagreeing canonical/external %s identifiers',
      async (collection) => {
        const current = selected(collection);
        const other = original[collection].find((entity) => entity.id !== current.id)!;
        for (const id of [other.id, crypto.randomUUID()])
          await rejected(
            { upsert: true, [collection]: [{ id, externalId: current.externalId }] },
            422,
            /id and externalId identify different/,
          );
      },
    );

    it.each(collections)(
      'honors optional expected versions on external %s upserts',
      async (collection) => {
        const current = selected(collection);
        await rejected(
          {
            upsert: true,
            [collection]: [{ externalId: current.externalId, version: current.version - 1 }],
          },
          409,
        );
      },
    );

    it.each([false, true])(
      'preserves partial external-ID updates, matching canonical ID supplied: %s',
      async (includeCanonicalId) => {
        const node = selected('nodes'),
          edge = selected('edges'),
          owner = selected('owners');
        const identity = (entity: typeof node | typeof edge | typeof owner) => ({
          externalId: entity.externalId,
          version: entity.version,
          ...(includeCanonicalId ? { id: entity.id } : {}),
        });
        const saved = await repo.request<Graph>(`/diagrams/${original.diagram.id}/bulk`, 'POST', {
          baseVersion: original.diagram.version,
          upsert: true,
          nodes: [{ ...identity(node), x: node.x + 75 }],
          edges: [{ ...identity(edge), label: 'Updated route' }],
          owners: [{ ...identity(owner), name: 'Updated operations' }],
        });
        expect(saved.nodes).toHaveLength(original.nodes.length);
        expect(saved.edges).toHaveLength(original.edges.length);
        expect(saved.nodes.find((entry) => entry.id === node.id)).toEqual({
          ...node,
          x: node.x + 75,
          version: node.version + 1,
          updatedAt: expect.any(String),
        });
        expect(saved.edges.find((entry) => entry.id === edge.id)).toEqual({
          ...edge,
          label: 'Updated route',
          version: edge.version + 1,
          updatedAt: expect.any(String),
        });
        expect(saved.owners.find((entry) => entry.id === owner.id)).toEqual({
          ...owner,
          name: 'Updated operations',
          version: owner.version + 1,
          updatedAt: expect.any(String),
        });
        expect(saved.diagram.version).toBeGreaterThan(original.diagram.version);
      },
    );

    it('still creates connected nodes, edges and owners with unused explicit UUIDs', async () => {
      const ownerId = crypto.randomUUID(),
        nodeId = crypto.randomUUID(),
        edgeId = crypto.randomUUID();
      const saved = await repo.bulk(original.diagram.id, {
        baseVersion: original.diagram.version,
        owners: [{ id: ownerId, name: 'Explicit new owner' }],
        nodes: [{ id: nodeId, title: 'Explicit new node', ownerIds: [ownerId] }],
        edges: [{ id: edgeId, sourceNodeId: original.nodes[0].id, targetNodeId: nodeId }],
      });
      expect(saved.nodes.find((node) => node.id === nodeId)).toMatchObject({
        title: 'Explicit new node',
        ownerIds: [ownerId],
        version: 1,
      });
      expect(saved.edges.find((edge) => edge.id === edgeId)).toMatchObject({
        targetNodeId: nodeId,
        version: 1,
      });
      expect(saved.owners.find((owner) => owner.id === ownerId)).toMatchObject({
        name: 'Explicit new owner',
        version: 1,
      });
      expect(saved.nodes.slice(0, original.nodes.length)).toEqual(original.nodes);
      expect(saved.edges.slice(0, original.edges.length)).toEqual(original.edges);
    });

    it.each(['nodes', 'edges'] as const)(
      'rejects canonical %s IDs belonging to another diagram',
      async (collection) => {
        const other = await repo.importGraph(blankGraph('Other project'));
        const otherSaved = await repo.bulk(other.diagram.id, {
          nodes: [
            { externalId: 'elsewhere:first', title: 'Other node' },
            { externalId: 'elsewhere:last', title: 'Other target' },
          ],
          edges: [
            {
              externalId: 'elsewhere:route',
              sourceExternalId: 'elsewhere:first',
              targetExternalId: 'elsewhere:last',
            },
          ],
        });
        await rejected(
          { [collection]: [creation(collection, otherSaved[collection][0].id)] },
          409,
          /versioned PATCH/,
        );
        expect(await repo.getGraph(otherSaved.diagram.id)).toEqual(otherSaved);
      },
    );

    it('rolls back earlier owner updates and creations when later routing fails', async () => {
      const owner = selected('owners');
      await rejected(
        {
          upsert: true,
          owners: [
            { externalId: owner.externalId, version: owner.version, name: 'Must be rolled back' },
            { name: 'Temporary owner', externalId: 'temporary:owner' },
          ],
          nodes: [
            {
              title: 'Temporary node',
              externalId: 'temporary:node',
              ownerExternalId: 'temporary:owner',
            },
          ],
          edges: [{ sourceExternalId: 'temporary:node', targetExternalId: 'missing:node' }],
        },
        422,
      );
    });

    it('rolls back staged owner writes if access is revoked before graph persistence', async () => {
      const before = await snapshot();
      let guardedWrites = 0;
      await expect(
        repo.bulk(
          original.diagram.id,
          {
            owners: [{ name: 'Temporary owner', externalId: 'temporary:owner' }],
            nodes: [{ title: 'Temporary node', ownerExternalId: 'temporary:owner' }],
          },
          async () => {
            if (++guardedWrites === 2) throw new StorageError(403, 'Write access revoked.');
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(guardedWrites).toBe(2);
      expect(await snapshot()).toEqual(before);
    });
  },
);
