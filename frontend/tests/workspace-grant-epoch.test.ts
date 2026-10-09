import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { WorkspaceDatabase } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';

const password = 'test-only grant generation password phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(created.keys));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.each(['indexeddb', 'encrypted'] as const)(
  'originating MCP grant with %s storage',
  (backend) => {
    let db: WorkspaceDatabase | EncryptedWorkspaceDatabase, repo: Repository, workspace: Workspace;
    let session: VaultSession | undefined, name: string;

    beforeEach(async () => {
      useEditor.getState().setGraph(null);
      useEditor.setState({ status: 'saved', message: '' });
      name = `workspace-grant-${backend}-${crypto.randomUUID()}`;
      if (backend === 'encrypted') {
        const physical = new VaultRecordStorage(name);
        await physical.create(created.header);
        session = new VaultSession(physical, cipher);
        await session.initialize();
        await session.unlock(password);
        db = new EncryptedWorkspaceDatabase(
          session,
          new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
        );
      } else db = new WorkspaceDatabase(name);
      await db.settings.bulkPut([
        { key: 'storage-consent', value: true },
        { key: 'mcp-access', value: 'write' },
      ]);
      repo = new Repository(db);
      workspace = new Workspace(repo);
      await workspace.start();
      const graph = blankGraph('Private grant fixture', 'mindmap');
      graph.nodes = [
        newNode(graph.diagram.id, {
          title: 'Original private node',
          description: 'Keep private source evidence',
        }),
      ];
      await workspace.create(graph);
      // Keep the real editor, storage and authorization active; avoid observer reads
      // racing the deliberately controlled request barrier.
      vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
      await workspace.setPreference('mcp-access', 'write');
    });

    afterEach(async () => {
      workspace.stop();
      useEditor.getState().setGraph(null);
      vi.restoreAllMocks();
      if (db instanceof EncryptedWorkspaceDatabase) {
        db.dispose();
        await session!.dispose();
        session = undefined;
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } else await db.delete();
    });

    it.each(['settled', 'dispatch', 'write-guard'] as const)(
      'does not revive an old request paused at %s after Off → Write without relocking',
      async (stage) => {
        const original = await repo.getGraph(useEditor.getState().graph!.diagram.id);
        const node = original.nodes[0];
        const entered = deferred(),
          release = deferred();
        const nativeRequest = Repository.prototype.request;
        const saved = vi.spyOn(Repository.prototype, 'saveGraph');
        if (stage === 'settled') {
          const settled = workspace.settled.bind(workspace);
          vi.spyOn(workspace, 'settled').mockImplementationOnce(async () => {
            await settled();
            entered.resolve();
            await release.promise;
          });
        } else {
          vi.spyOn(Repository.prototype, 'request').mockImplementationOnce(async function (
            this: Repository,
            ...args
          ) {
            const options = args[3]!;
            // This request has already passed the real UI and persisted permissions.
            await options.beforeRequest!();
            if (stage === 'write-guard') await options.beforeWrite!(this.db);
            entered.resolve();
            await release.promise;
            if (stage === 'write-guard') await options.beforeWrite!(this.db);
            return nativeRequest.apply(this, args);
          });
        }
        const origin = await repo.db.captureOperation();
        try {
          const pending = workspace.external(
            `/nodes/${node.id}`,
            'PATCH',
            { version: node.version, title: 'Stale agent must not commit' },
            origin,
          );
          const rejected = expect(pending).rejects.toMatchObject({
            status: 403,
            message: expect.stringContaining('originating MCP grant was revoked'),
          });
          await entered.promise;
          await workspace.setPreference('mcp-access', 'off');
          await workspace.setPreference('mcp-access', 'write');
          expect(useEditor.getState().mcpAccess).toBe('write');
          expect((await db.settings.get('mcp-access'))?.value).toBe('write');
          // The vault capability is still valid. Rejection must come from the old
          // grant generation, not a lock, reload, expired session or changed document.
          await origin.check();
          expect(origin.signal.aborted).toBe(false);
          if (session) expect(session.getSnapshot().status).toBe('unlocked');
          release.resolve();
          await rejected;
          expect(saved).not.toHaveBeenCalled();
          expect(await repo.getGraph(original.diagram.id)).toEqual(original);
          expect(useEditor.getState().graph!.nodes[0].title).toBe(node.title);
          await workspace.external(`/nodes/${node.id}`, 'PATCH', {
            version: node.version,
            title: 'Fresh authorized request',
          });
          expect(saved).toHaveBeenCalledOnce();
          expect((await repo.getGraph(original.diagram.id)).nodes[0]).toMatchObject({
            title: 'Fresh authorized request',
            version: node.version + 1,
            description: node.description,
          });
        } finally {
          release.resolve();
          origin.dispose();
        }
      },
    );
  },
);
