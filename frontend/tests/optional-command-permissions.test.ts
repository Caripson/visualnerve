import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { WorkspaceDatabase } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { useEditor } from '../src/state/editor';
import { blankGraph, newNode } from '../src/model/types';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';

const delayed = vi.hoisted(() => ({
  wait: undefined as Promise<void> | undefined,
  entered: undefined as (() => void) | undefined,
  calls: [] as string[],
}));
vi.mock('../src/storage/optional-command', async (original) => {
  const actual = await original<typeof import('../src/storage/optional-command')>();
  return {
    loadOptionalCommand: async (
      kind: 'analysis' | 'diagram-file' | 'simulation' | 'understanding',
    ) => {
      delayed.calls.push(kind);
      delayed.entered?.();
      await delayed.wait;
      // Only delay module loading; execute the real production command afterward.
      switch (kind) {
        case 'analysis':
          return actual.loadOptionalCommand('analysis');
        case 'diagram-file':
          return actual.loadOptionalCommand('diagram-file');
        case 'simulation':
          return actual.loadOptionalCommand('simulation');
        case 'understanding':
          return actual.loadOptionalCommand('understanding');
      }
    },
  };
});

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const password = 'delayed command original-session password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => {
  vault = await cipher.createVault(password);
});
afterEach(async () => {
  delayed.wait = undefined;
  delayed.entered = undefined;
  delayed.calls.length = 0;
  for (const close of cleanups.splice(0)) await close();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
});
afterAll(() => cipher.destroyKeys(vault.keys));

function pauseModule() {
  let release!: () => void, entered!: () => void;
  delayed.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  delayed.entered = entered;
  return { release, started };
}
async function legacyWorkspace() {
  useEditor.getState().setGraph(null);
  const db = new WorkspaceDatabase(`optional-command-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  const repo = new Repository(db);
  const workspace = new Workspace(repo);
  cleanups.push(async () => {
    workspace.stop();
    await db.delete();
  });
  await workspace.start();
  const graph = blankGraph('Optional command private graph');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Private process' })];
  await workspace.create(graph);
  await workspace.settled();
  return { db, repo, workspace, graph: useEditor.getState().graph! };
}
async function encryptedRepository() {
  const physical = new VaultRecordStorage(`optional-encrypted-${crypto.randomUUID()}`);
  await physical.create(vault.header);
  const session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  const db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  const repo = new Repository(db);
  cleanups.push(async () => {
    db.dispose();
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(physical.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  const graph = blankGraph('Encrypted optional command private graph');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Encrypted private process' })];
  return { db, repo, session, graph: await repo.importGraph(graph) };
}

describe('original authorization across optional command module loading', () => {
  it('revokes a waiting real Workspace command before it creates any history', async () => {
    const { workspace, repo, graph } = await legacyWorkspace();
    const histories = await repo.history.list(graph.diagram.id);
    const gate = pauseModule();
    const pending = workspace.external(`/diagrams/${graph.diagram.id}/history`, 'POST', {
      baseVersion: graph.diagram.version,
      name: 'Must never be published',
    });
    const outcome = pending.then(
      () => ({ status: 'unexpected completion' }),
      (error: unknown) => error,
    );
    await gate.started;
    await workspace.setPreference('mcp-access', 'off');
    gate.release();
    expect(await outcome).toMatchObject({ status: 403 });
    expect(await repo.history.list(graph.diagram.id)).toEqual(histories);
    expect((await repo.getGraph(graph.diagram.id)).diagram.version).toBe(graph.diagram.version);
  });

  it('preserves successful real command behavior after the module wait', async () => {
    const { workspace, repo, graph } = await legacyWorkspace();
    const before = await repo.history.list(graph.diagram.id);
    const gate = pauseModule();
    const pending = workspace.external(`/diagrams/${graph.diagram.id}/history`, 'POST', {
      baseVersion: graph.diagram.version,
      name: 'Verified command snapshot',
    });
    await gate.started;
    expect(await repo.history.list(graph.diagram.id)).toEqual(before);
    gate.release();
    expect(await pending).toMatchObject({ name: 'Verified command snapshot' });
    expect(await repo.history.list(graph.diagram.id)).toHaveLength(before.length + 1);
  });

  it('does not borrow a replacement encrypted unlock when a delayed command finally imports', async () => {
    const { session, repo, graph } = await encryptedRepository();
    const histories = await repo.history.list(graph.diagram.id);
    const gate = pauseModule();
    const pending = repo.request(`/diagrams/${graph.diagram.id}/history`, 'POST', {
      baseVersion: graph.diagram.version,
      name: 'Stale original session snapshot',
    });
    const outcome = pending.then(
      () => ({ status: 'unexpected completion' }),
      (error: unknown) => error,
    );
    await gate.started;
    await session.lock();
    await session.unlock(password);
    const current = await repo.saveGraph(
      { ...graph, diagram: { ...graph.diagram, name: 'Current unlocked session' } },
      graph.diagram.version,
    );
    const freshHistories = await repo.history.list(graph.diagram.id);
    gate.release();
    expect(await outcome).toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    expect((await repo.getGraph(graph.diagram.id)).diagram).toEqual(current.diagram);
    expect(await repo.history.list(graph.diagram.id)).toEqual(freshHistories);
    expect(freshHistories).toEqual(histories);
  });

  it('keeps locked capability discovery independent of every optional command module', async () => {
    const { session, repo } = await encryptedRepository();
    await session.lock();
    for (const path of [
      '/health',
      '/simulation/capabilities',
      '/code/capabilities',
      '/code/languages',
    ])
      expect(await repo.request(path)).toBeDefined();
    expect(delayed.calls).toEqual([]);
    for (const path of ['/code/languages/', '/code/capabilities?unexpected=1'])
      await expect(repo.request(path)).rejects.toMatchObject({ status: 423 });
  });
});
