import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { createGameGraph, gameProjection } from '../src/roblox/document';
import { createRobloxAdventureGame } from '../src/roblox/starter';
import { validateGameDefinition } from '../src/roblox/validate';
import { validateGraph } from '../src/model/validation';
import { newNode } from '../src/model/types';

const password = 'test-only Roblox encrypted persistence password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(created.keys));
describe.each(['indexeddb', 'encrypted'] as const)(
  'native Roblox documents with %s persistence',
  (backend) => {
    let database: WorkspaceDatabase | EncryptedWorkspaceDatabase,
      repo: Repository,
      name: string,
      session: VaultSession | undefined;
    beforeEach(async () => {
      name = `roblox-persistence-${backend}-${crypto.randomUUID()}`;
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
    });
    afterEach(async () => {
      if (database instanceof EncryptedWorkspaceDatabase) {
        database.dispose();
        await session!.dispose();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } else await database.delete();
    });
    async function reopen() {
      if (database instanceof EncryptedWorkspaceDatabase) {
        await session!.lock();
        database.dispose();
        await session!.dispose();
        session = new VaultSession(new VaultRecordStorage(name), cipher);
        await session.initialize();
        await session.unlock(password);
        database = new EncryptedWorkspaceDatabase(
          session,
          new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
        );
      } else {
        database.close();
        database = new WorkspaceDatabase(name);
        await database.open();
      }
      repo = new Repository(database);
    }
    it('retains advanced worlds and diagram annotations across edits, close/reopen and encrypted physical records', async () => {
      const input = createGameGraph('My confidential island', createRobloxAdventureGame());
      input.nodes.push(
        newNode(input.diagram.id, {
          title: 'Private design notes',
          description: 'Secret quest story',
        }),
      );
      const saved = await repo.saveGraph(input, 0),
        before = structuredClone(saved.diagram.game);
      const next = structuredClone(saved),
        projection = next.nodes.find((node) => gameProjection(node)?.kind === 'entities')!;
      projection.title = 'Secret island stage';
      projection.backgroundColor = '#123456';
      projection.x += 555;
      const modified = await repo.saveGraph(next, saved.diagram.version),
        entityId = gameProjection(projection)!.id;
      expect(
        modified.diagram.game!.entities.find((entity) => entity.id === entityId),
      ).toMatchObject({
        name: projection.title,
        color: '#123456',
        transform: before!.entities.find((entity) => entity.id === entityId)!.transform,
      });
      validateGraph(modified);
      await reopen();
      expect(await repo.getGraph(modified.diagram.id)).toEqual(modified);
      if (backend === 'encrypted') {
        const connection = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const raw = await new Promise<unknown[]>((resolve, reject) => {
            const request = connection.transaction('records').objectStore('records').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const text = JSON.stringify(raw);
          for (const value of [
            'My confidential island',
            'Secret island stage',
            'Secret quest story',
            modified.diagram.game!.id,
            entityId,
          ])
            expect(text).not.toContain(value);
        } finally {
          connection.close();
        }
      }
    });
    it('duplicates and backup-merges with fresh native, semantic and prefab-local identities and valid references', async () => {
      const original = await repo.saveGraph(
        createGameGraph('Island', createRobloxAdventureGame()),
        0,
      );
      const duplicate = await repo.importGraph(original);
      expect(duplicate.diagram.id).not.toBe(original.diagram.id);
      expect(duplicate.diagram.game!.id).not.toBe(original.diagram.game!.id);
      expect(duplicate.diagram.game!.prefabs[0].entities[0].id).not.toBe(
        original.diagram.game!.prefabs[0].entities[0].id,
      );
      expect(
        duplicate.nodes.every((node) => !original.nodes.some((old) => old.id === node.id)),
      ).toBe(true);
      expect(
        duplicate.edges.every((edge) => !original.edges.some((old) => old.id === edge.id)),
      ).toBe(true);
      expect(validateGameDefinition(duplicate.diagram.game!).diagnostics).toEqual([]);
      validateGraph(duplicate);
      const backup = JSON.parse(JSON.stringify(await database.backup()));
      const restored = await repo.restore(backup, 'merge');
      expect(restored).toHaveLength(2);
      for (const graph of restored) {
        validateGraph(graph);
        expect(validateGameDefinition(graph.diagram.game!).valid).toBe(true);
        expect([original.diagram.game!.id, duplicate.diagram.game!.id]).not.toContain(
          graph.diagram.game!.id,
        );
        for (const node of graph.nodes) {
          const ref = gameProjection(node);
          if (ref)
            expect(graph.diagram.game![ref.kind].some((entity) => entity.id === ref.id)).toBe(true);
        }
      }
      expect(await repo.getGraph(original.diagram.id)).toEqual(original);
      await reopen();
      for (const graph of restored) expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    });
  },
);
