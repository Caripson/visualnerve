import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import type { WorkspaceStorage } from '../src/storage/contracts';

const password = 'test-only repository password phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let repo: Repository, name: string, codec: VaultLogicalRecordCodec;

beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  name = `encrypted-repository-${crypto.randomUUID()}`;
  physical = new VaultRecordStorage(name);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  codec = new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto);
  db = new EncryptedWorkspaceDatabase(session, codec);
  repo = new Repository(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

async function rawRecords() {
  const native = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = native.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    native.close();
  }
}

describe('Repository over the real encrypted workspace backend', () => {
  it('keeps 100,000 unchanged CSV rows cached without decrypting or encrypting them on drawing edits', async () => {
    const dataset = parseCsv('Customer,Revenue\nVault-only customer,100\n', 'Large private.csv');
    dataset.rows = Array.from({ length: 100_000 }, (_, index) => [
      String(index % 2_000),
      String(index),
    ]);
    const saved = await repo.importGraph(
      csvGraph(dataset, { ...defaultAnalysis(dataset), levels: [] }),
    );
    db.forgetDatasets();
    const reopened = await repo.getGraph(saved.diagram.id);
    expect(reopened.dataset!.rows[99_999]).toEqual(['1999', '99999']);
    const encrypt = vi.spyOn(codec, 'encode');
    const decrypt = vi.spyOn(codec, 'read');
    const { dataset: _source, ...drawing } = reopened;
    const first = await repo.saveGraph(
      { ...drawing, nodes: drawing.nodes.map((node) => ({ ...node, x: node.x + 40 })) },
      reopened.diagram.version,
    );
    const second = await repo.saveGraph(first, first.diagram.version);
    expect(second.dataset === reopened.dataset).toBe(true);
    expect(encrypt.mock.calls.filter((call) => call[1] === 'datasets')).toEqual([]);
    expect(decrypt.mock.calls.filter((call) => call[1].store === 'datasets')).toEqual([]);
    expect((await repo.getGraph(saved.diagram.id)).dataset!.rows[99_999]).toEqual([
      '1999',
      '99999',
    ]);
  }, 20_000);

  it('round trips CSV, owners, history and simulation archives through one encrypted model', async () => {
    const dataset = parseCsv('Customer,Revenue\nVault-only customer,100\n', 'Private.csv');
    const analysis = defaultAnalysis(dataset);
    const original = await repo.importGraph(csvGraph(dataset, analysis));
    const owner = await repo.owner({ name: 'Vault-only operations team', externalId: 'owner' });
    const assigned = await repo.saveGraph(
      {
        ...original,
        owners: [owner],
        nodes: original.nodes.map((node) => ({ ...node, ownerIds: [owner.id] })),
      },
      original.diagram.version,
    );
    const snapshot = await repo.history.create(assigned.diagram.id, {
      name: 'Vault-only baseline',
      baseVersion: assigned.diagram.version,
    });
    const edited = await repo.request<Graph['nodes'][number]>(
      `/nodes/${assigned.nodes[0].id}`,
      'PATCH',
      { version: assigned.nodes[0].version, title: 'Changed private node' },
    );
    expect(edited.title).toBe('Changed private node');
    const current = await repo.getGraph(assigned.diagram.id);
    const restored = await repo.history.restore(assigned.diagram.id, snapshot.id, {
      baseVersion: current.diagram.version,
    });
    expect(restored.graph.nodes[0].title).toBe(assigned.nodes[0].title);
    expect(restored.graph.dataset?.rows).toEqual([['Vault-only customer', '100']]);
    expect(restored.graph.owners).toEqual([owner]);

    const simulation = await repo.importGraph(
      createSimulationGraph('Vault-only simulator', createBasicModel()),
    );
    const result = runSimulation(simulation.simulation!, {
      runId: 'private-run',
      seed: 42,
      durationSeconds: 600,
    });
    const runStore = new SimulationRunStore(db);
    const timestamp = new Date().toISOString();
    await runStore.put({
      id: result.runId,
      diagramId: simulation.diagram.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: result.status,
      model: simulation.simulation!,
      options: { durationSeconds: 600, seed: 42 },
      result,
    });
    await runStore.putCheckpoint(result.runId, result.timeSeconds, result);
    const backup = await db.backup();
    expect(backup.history?.snapshots).toHaveLength(2);
    expect(backup.simulationRuns?.[0].result).toEqual(result);
    await repo.restore(backup, 'replace');
    expect((await repo.getGraph(simulation.diagram.id)).simulation).toEqual(simulation.simulation);
    const restoredRun = (await new SimulationRunStore(db).list(simulation.diagram.id))[0];
    expect(restoredRun.id).not.toBe(result.runId);
    expect(restoredRun.result).toEqual({ ...result, runId: restoredRun.id });
    const restoredSnapshot = (await repo.history.list(assigned.diagram.id)).find(
      (entry) => entry.name === snapshot.name,
    )!;
    expect(restoredSnapshot.id).not.toBe(snapshot.id);
    expect(
      (await repo.history.read(assigned.diagram.id, restoredSnapshot.id)).graph.dataset?.rows,
    ).toEqual(assigned.dataset?.rows);
    const raw = JSON.stringify(await rawRecords());
    for (const canary of [
      'Vault-only customer',
      'Vault-only operations team',
      'Vault-only baseline',
      'Vault-only simulator',
      assigned.diagram.id,
      assigned.dataset!.id,
      result.runId,
    ])
      expect(raw).not.toContain(canary);
    await repo.removeDiagram(simulation.diagram.id);
    expect(await db.simulationRuns.count()).toBe(0);
    expect(await db.simulationCheckpoints.count()).toBe(0);
    expect(await db.simulationModels.count()).toBe(0);
  }, 20_000);

  it('keeps only static discovery available when locked and reopens encrypted documents', async () => {
    const input = blankGraph('Vault-only graph', 'mindmap');
    input.nodes = [newNode(input.diagram.id, { title: 'Vault-only node' })];
    const saved = await repo.importGraph(input);
    await session.lock();
    expect(await repo.request('/workspace/security')).toMatchObject({
      mode: 'encrypted',
      state: 'locked',
      vaultSchemaVersion: 1,
      programmaticUnlock: false,
    });
    for (const path of [
      '/health',
      '/simulation/capabilities',
      '/code/capabilities',
      '/code/languages',
    ])
      expect(await repo.request(path)).toBeDefined();
    for (const path of ['/diagrams', `/nodes/${saved.nodes[0].id}`, '/workspace/export'])
      await expect(repo.request(path)).rejects.toMatchObject({
        status: 423,
        code: 'WORKSPACE_LOCKED',
      });
    await session.unlock(password);
    expect(await repo.request('/workspace/security')).toMatchObject({
      mode: 'encrypted',
      state: 'unlocked',
    });
    expect((await repo.getGraph(saved.diagram.id)).nodes[0].title).toBe('Vault-only node');
  });

  it('does not resume a queued private request or publish its result into a later unlock', async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = repo.request(
      '/settings/appearance',
      'PUT',
      { value: 'dark' },
      {
        beforeRequest: async () => {
          entered();
          await gate;
        },
        beforeWrite: async (scope: WorkspaceStorage) => {
          expect(scope === repo.db).toBe(false);
          await scope.settings.get('mcp-access');
        },
      },
    );
    const outcome = pending.then(
      () => ({ success: true }),
      (error: unknown) => error,
    );
    await started;
    await session.lock();
    await session.unlock(password);
    release();
    expect(await outcome).toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    expect(await db.settings.get('appearance')).toBeUndefined();
  });
});
