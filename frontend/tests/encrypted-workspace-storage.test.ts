import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { WorkspaceDatabase } from '../src/storage/database';
import { asWorkspaceStorage } from '../src/storage/adapter';
import { Repository } from '../src/storage/repository';
import {
  workspaceStoreNames,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceChange,
  type WorkspaceScope,
} from '../src/storage/contracts';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { base, blankGraph, newEdge, newNode, type Graph, type Owner } from '../src/model/types';
import { parseCsv } from '../src/data/csv';
import { instantiate } from '../src/templates/templates';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';

const password = 'encrypted workspace integration password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let db: EncryptedWorkspaceDatabase, codec: VaultLogicalRecordCodec;
let physical: VaultRecordStorage, session: VaultSession, repo: Repository;
const legacyDatabases: WorkspaceDatabase[] = [];

beforeAll(async () => {
  vault = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  physical = new VaultRecordStorage(`encrypted-backend-${crypto.randomUUID()}`);
  await physical.create(vault.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  codec = new VaultLogicalRecordCodec(cipher);
  db = new EncryptedWorkspaceDatabase(session, codec);
  repo = new Repository(db);
  await db.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  for (const legacy of legacyDatabases.splice(0)) await legacy.delete();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Encrypted fixture connection was not closed.'));
  });
  vi.unstubAllGlobals();
});

function fixture(): Graph {
  const graph = blankGraph('Confidential lifecycle model', 'flowchart');
  const owner: Owner = {
    ...base(),
    name: 'Private operator Miranda',
    email: 'private.operator@example.invalid',
    kind: 'person',
    color: '#0f766e',
    metadata: { privateDepartment: 'Secret department Delta' },
  };
  graph.owners = [owner];
  graph.nodes = [
    newNode(graph.diagram.id, {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      title: 'Private assembly step',
      description: 'Private description Omega',
      ownerIds: [owner.id],
    }),
    newNode(graph.diagram.id, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Private delivery step',
      ownerIds: [owner.id],
    }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      label: 'Private transfer condition',
    }),
    newEdge(graph.diagram.id, graph.nodes[1].id, graph.nodes[0].id, {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      label: 'Private rework loop',
    }),
  ];
  graph.dataset = {
    ...parseCsv(
      'Customer,Amount\nPrivate customer Sigma,19\nPrivate customer Tau,23',
      'orders.csv',
    ),
    diagramId: graph.diagram.id,
  };
  graph.datasets = [
    {
      ...parseCsv('Depot,Slots\nPrivate depot Gamma,3', 'depots.csv'),
      diagramId: graph.diagram.id,
    },
  ];
  return graph;
}

function legacy() {
  const native = new WorkspaceDatabase(`legacy-oracle-${crypto.randomUUID()}`);
  legacyDatabases.push(native);
  return native;
}

async function rawRecords() {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(physical.name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = connection.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    connection.close();
  }
}

function withoutExportTime<T extends { exportedAt?: string }>(backup: T) {
  const { exportedAt: _time, ...model } = backup;
  return model;
}

describe('authoritative encrypted workspace storage', () => {
  it('retains graph/entity/source ordering and owner aliases across close/reopen', async () => {
    const saved = await repo.saveGraph(fixture(), 0);
    expect(saved.nodes[0].id > saved.nodes[1].id).toBe(true);
    const loaded = await repo.getGraph(saved.diagram.id);
    expect(loaded).toEqual(saved);
    expect(loaded.nodes.map((node) => node.ownerId)).toEqual([
      saved.owners[0].id,
      saved.owners[0].id,
    ]);
    db.close();
    await db.open();
    expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
    expect(db.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(db.verno).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(db.tables.map((table) => table.name)).toEqual([...workspaceStoreNames]);
  });

  it('persists no plaintext names, descriptions, owner details, rows or logical IDs in physical records', async () => {
    const saved = await repo.saveGraph(fixture(), 0);
    await db.settings.put({ key: 'presentation-voice', value: 'Private preference Lambda' });
    const raw = await rawRecords();
    expect(raw.length).toBeGreaterThan(0);
    const text = JSON.stringify(raw);
    for (const privateValue of [
      saved.diagram.name,
      saved.diagram.id,
      ...saved.nodes.map((node) => node.id),
      'Private description Omega',
      'Private operator Miranda',
      'private.operator@example.invalid',
      'Secret department Delta',
      'Private customer Sigma',
      'Private depot Gamma',
      'Private preference Lambda',
    ])
      expect(text).not.toContain(privateValue);
    for (const value of raw) {
      const record = value as {
        id: string;
        encrypted: { format: string; version: number; iv: string; ciphertext: string };
      };
      expect(record.encrypted.format).toBe('visualnerve-record');
      expect(record.encrypted.version).toBe(1);
      expect(record.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(record.encrypted.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(typeof record.encrypted.ciphertext).toBe('string');
    }
  });

  it('upgrades built-in labels and initializes once while preserving private custom templates', async () => {
    const kiosk = instantiate('process-simulator', 'Existing kiosk');
    kiosk.simulation!.particleTypes[0].revenue = 765;
    const custom = instantiate('mind-map', 'Private custom topic');
    await db.templates.bulkPut([
      { id: 'process-simulator', name: 'Process Simulator', builtin: true, graph: kiosk },
      { id: 'mind-map', name: 'Private custom template', builtin: false, graph: custom },
    ]);
    await db.initialize();
    expect(await db.templates.get('process-simulator')).toEqual({
      id: 'process-simulator',
      name: 'Kiosk + package pickup',
      builtin: true,
      graph: kiosk,
    });
    expect(await db.templates.get('mind-map')).toEqual({
      id: 'mind-map',
      name: 'Private custom template',
      builtin: false,
      graph: custom,
    });
    const before = await db.templates.toArray();
    const id = await db.settings.get('workspace-id');
    await db.initialize();
    expect(await db.templates.toArray()).toEqual(before);
    expect(await db.settings.get('workspace-id')).toEqual(id);
    expect(await db.templates.get('process-simulator-blank')).toMatchObject({
      name: 'Process Simulator',
      graph: { diagram: { type: 'process-simulator' }, simulation: { nodes: [], edges: [] } },
    });
  });

  it('exports complete history, CSV and simulation semantics with the same filtering as the legacy backend', async () => {
    const graph = await repo.saveGraph(fixture(), 0);
    const snapshot = await repo.history.create(graph.diagram.id, {
      name: 'Private source baseline',
      baseVersion: graph.diagram.version,
    });
    const simulation = await repo.saveGraph(
      createSimulationGraph('Private simulation', createBasicModel({ particles: 3 })),
      0,
    );
    const result = runSimulation(simulation.simulation!, {
      durationSeconds: 600,
      seed: 42,
      runId: 'private-run',
    });
    const runs = new SimulationRunStore(db);
    const createdAt = '2026-10-08T12:00:00.000Z';
    await runs.put({
      id: result.runId,
      diagramId: simulation.diagram.id,
      createdAt,
      updatedAt: createdAt,
      status: result.status,
      model: simulation.simulation!,
      options: { durationSeconds: 600, seed: 42 },
      result,
    });
    await runs.putCheckpoint(result.runId, result.timeSeconds, result);
    await db.settings.bulkPut([
      { key: 'workspace-id', value: 'private-local-identity' },
      { key: 'mcp-access', value: 'write' },
      { key: 'bridge-url', value: 'ws://127.0.0.1:4317/bridge' },
      { key: 'storage-consent', value: true },
      { key: 'import-file-limit-mb', value: 1024 },
      { key: 'project-source-file-limit', value: 1000 },
      { key: 'presentation-voice', value: 'en_GB-alan-medium' },
    ]);
    const plain = legacy();
    await plain.open();
    for (const name of workspaceStoreNames)
      await plain.table(name).bulkPut(await db[name].toArray());
    const encryptedBackup = await db.backup();
    expect(withoutExportTime(encryptedBackup)).toEqual(withoutExportTime(await plain.backup()));
    expect(encryptedBackup.history!.snapshots.map((entry) => entry.id)).toContain(snapshot.id);
    expect(encryptedBackup.history!.rows.every((entry) => !entry.rows && !!entry.datasetRef)).toBe(
      true,
    );
    expect(encryptedBackup.settings).toEqual([
      { key: 'presentation-voice', value: 'en_GB-alan-medium' },
    ]);
    expect(encryptedBackup.simulationRuns?.[0].result?.metrics.completed).toBe(3);
    expect(encryptedBackup.simulationCheckpoints?.[0].state).toEqual(result);
    expect((await repo.history.read(graph.diagram.id, snapshot.id)).graph).toEqual(graph);
  });

  it('reads authenticated metadata/count/index keys without decrypting large row bodies', async () => {
    const input = fixture();
    input.dataset!.rows = Array.from({ length: 800 }, (_, index) => [
      `Private chunked customer ${index} ${'Confidential'.repeat(16)}`,
      String(index),
    ]);
    const graph = await repo.saveGraph(input, 0);
    await repo.history.create(graph.diagram.id, {
      name: 'Rows',
      baseVersion: graph.diagram.version,
    });
    const read = vi.spyOn(codec, 'read');
    const physicalRead = vi.spyOn(physical, 'read');
    const metadata = await db.historyRows.metadata('bytes');
    expect(metadata).toHaveLength(2);
    expect(metadata.every((entry) => Number(entry.value) > 0)).toBe(true);
    expect(metadata.some((entry) => Number(entry.value) > 64 * 1024)).toBe(true);
    expect(await db.historyRows.count()).toBe(2);
    expect(await db.historyRows.where('diagramId').equals(graph.diagram.id).primaryKeys()).toEqual(
      metadata.map((entry) => entry.id).sort(),
    );
    expect(read).not.toHaveBeenCalled();
    expect(physicalRead).not.toHaveBeenCalled();
    const body = (await db.historyRows.get(metadata[0].id))!.rows;
    expect([graph.dataset!.rows, graph.datasets![0].rows]).toContainEqual(body);
    expect(read).toHaveBeenCalledOnce();
  });

  it('preserves cached immutable dataset identity and versions through drawing-only saves', async () => {
    const first = await repo.saveGraph(fixture(), 0);
    const loaded = await repo.getGraph(first.diagram.id);
    expect(loaded.dataset).toBe(first.dataset);
    expect(loaded.dataset!.rows).toBe(first.dataset!.rows);
    expect(Object.isFrozen(loaded.dataset!.rows[0])).toBe(true);
    const read = vi.spyOn(codec, 'read');
    const second = await repo.saveGraph(
      {
        ...loaded,
        diagram: {
          ...loaded.diagram,
          settings: {
            ...loaded.diagram.settings,
            drawing: {
              version: 1,
              visible: true,
              strokes: [
                {
                  id: crypto.randomUUID(),
                  color: '#f97316',
                  width: 3,
                  points: [
                    [1, 2],
                    [3, 4],
                  ],
                },
              ],
            },
          },
        },
      },
      loaded.diagram.version,
    );
    expect(second.dataset).toBe(first.dataset);
    expect(second.dataset!.version).toBe(first.dataset!.version);
    expect((await repo.getGraph(first.diagram.id)).dataset).toBe(first.dataset);
    expect(read.mock.calls.some(([, record]) => record.store === 'datasets')).toBe(false);
  });

  it('applies scoped dataset cache mutations only after a successful commit', async () => {
    const saved = await repo.saveGraph(fixture(), 0);
    const replacement = { ...saved.dataset!, rows: [['Private staged replacement', '99']] };
    await expect(
      db.atomic('rw', ['diagrams', 'datasets'], async (scope) => {
        scope.forgetDatasets();
        await scope.datasets.put(replacement);
        scope.rememberDataset(saved.diagram, replacement, saved.datasets);
        expect(Object.isFrozen(replacement)).toBe(false);
        throw new Error('Rollback staged cache');
      }),
    ).rejects.toThrow('Rollback staged cache');
    expect((await db.graph(saved.diagram.id))?.dataset).toBe(saved.dataset);
    expect((await db.datasets.get(saved.dataset!.id))?.rows).toEqual(saved.dataset!.rows);
    expect(Object.isFrozen(replacement)).toBe(false);
    await db.atomic('rw', ['diagrams', 'datasets'], async (scope) => {
      await scope.datasets.put(replacement);
      scope.rememberDataset(saved.diagram, replacement, saved.datasets);
      expect(Object.isFrozen(replacement)).toBe(false);
    });
    expect(Object.isFrozen(replacement)).toBe(true);
    expect((await db.graph(saved.diagram.id))?.dataset).toBe(replacement);
  });

  it('publishes subscriptions only after durable commit and isolates throwing observers', async () => {
    const changed = vi.fn<(change: WorkspaceChange) => void>();
    const remove = db.subscribe(changed);
    const removeThrowing = db.subscribe(() => {
      throw new Error('Observer failed');
    });
    await db.atomic('rw', ['settings'], async (scope) => {
      await scope.settings.put({ key: 'private-preference', value: 7 });
      expect(changed).not.toHaveBeenCalled();
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ stores: ['settings'] });
    expect(await db.settings.get('private-preference')).toEqual({
      key: 'private-preference',
      value: 7,
    });
    await expect(
      db.atomic('rw', ['settings'], async (scope) => {
        await scope.settings.put({ key: 'private-preference', value: 9 });
        throw new Error('Domain validation failed');
      }),
    ).rejects.toThrow('Domain validation failed');
    expect(changed).toHaveBeenCalledOnce();
    expect((await db.settings.get('private-preference'))?.value).toBe(7);
    remove();
    removeThrowing();
    await db.settings.put({ key: 'private-preference', value: 8 });
    expect(changed).toHaveBeenCalledOnce();
  });

  it('keeps transaction table inspection within declared stores like the legacy adapter', async () => {
    const plain = asWorkspaceStorage(legacy());
    await plain.open();
    const expected = await plain.atomic('r', ['settings'], async (scope) =>
      scope.tables.map((table) => table.name),
    );
    expect(
      await db.atomic('r', ['settings'], async (scope) => scope.tables.map((table) => table.name)),
    ).toEqual(expected);
  });

  it('revokes captured private work across lock/unlock and does not revive old signals', async () => {
    const saved = await repo.saveGraph(fixture(), 0);
    const parent = await db.captureOperation();
    const child = await parent.storage.captureOperation();
    expect((await child.storage.graph(saved.diagram.id))?.diagram.name).toBe(saved.diagram.name);
    await session.lock();
    expect(parent.signal.aborted).toBe(true);
    expect(child.signal.aborted).toBe(true);
    await session.unlock(password);
    await expect(parent.check()).rejects.toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    await expect(
      child.storage.settings.put({ key: 'stale-write', value: 'Must not persist' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await expect(parent.storage.captureOperation()).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    expect(await db.settings.get('stale-write')).toBeUndefined();
    expect((await db.graph(saved.diagram.id))?.diagram.name).toBe(saved.diagram.name);
    parent.dispose();
    child.dispose();
  });

  it('disposal revokes nested captures without locking a fresh root operation', async () => {
    const parent = await db.captureOperation();
    const child = await parent.storage.captureOperation();
    parent.dispose();
    expect(parent.signal.aborted).toBe(true);
    expect(child.signal.aborted).toBe(true);
    await expect(child.check()).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await expect(child.storage.settings.toArray()).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    const current = await db.captureOperation();
    expect(current.signal.aborted).toBe(false);
    await current.storage.settings.put({ key: 'new-operation', value: 1 });
    current.dispose();
    await expect(current.storage.settings.get('new-operation')).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    expect((await db.settings.get('new-operation'))?.value).toBe(1);
    child.dispose();
  });

  it('does not publish staged settings when their captured operation is disposed before commit', async () => {
    const operation = await db.captureOperation();
    const changed = vi.fn();
    const remove = db.subscribe(changed);
    await expect(
      operation.storage.atomic('rw', ['settings'], async (scope) => {
        await scope.settings.put({ key: 'cancelled-operation', value: 'Must not persist' });
        operation.dispose();
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(changed).not.toHaveBeenCalled();
    expect(await db.settings.get('cancelled-operation')).toBeUndefined();
    remove();
  });

  it('does not let a revoked operation reintroduce old plaintext into the new session dataset cache', async () => {
    const saved = await repo.saveGraph(fixture(), 0);
    const operation = await db.captureOperation();
    const stale = { ...saved.dataset!, rows: [['Stale private data', '999']] };
    await session.lock();
    await session.unlock(password);
    let failure: unknown;
    try {
      operation.storage.rememberDataset(saved.diagram, stale, saved.datasets);
    } catch (error) {
      failure = error;
    }
    expect((await db.graph(saved.diagram.id))?.dataset?.rows).toEqual(saved.dataset!.rows);
    expect(failure).toMatchObject({ code: 'WORKSPACE_LOCKED' });
    operation.dispose();
  });

  it('revokes captures on close/reopen like the legacy backend while allowing fresh operations', async () => {
    const plain = asWorkspaceStorage(legacy());
    await plain.open();
    for (const storage of [plain, db]) {
      await storage.settings.put({ key: 'reopen-preference', value: 'Keep committed data' });
      const old = await storage.captureOperation();
      const child = await old.storage.captureOperation();
      storage.close();
      expect(old.signal.aborted).toBe(true);
      expect(child.signal.aborted).toBe(true);
      await storage.open();
      await expect(old.check()).rejects.toMatchObject({ status: 423 });
      await expect(child.check()).rejects.toMatchObject({ status: 423 });
      await expect(
        Promise.resolve().then(() => old.storage.settings.get('reopen-preference')),
      ).rejects.toMatchObject({
        status: 423,
      });
      expect((await storage.settings.get('reopen-preference'))?.value).toBe('Keep committed data');
      const current = await storage.captureOperation();
      expect(current.signal.aborted).toBe(false);
      expect((await current.storage.settings.get('reopen-preference'))?.value).toBe(
        'Keep committed data',
      );
      current.dispose();
      child.dispose();
      old.dispose();
    }
  });

  it('expires retained transaction scopes and rejects private operations while locked', async () => {
    let retained!: WorkspaceScope;
    await db.atomic('r', ['settings'], async (scope) => {
      retained = scope;
    });
    expect(() => retained.settings).toThrow('This workspace transaction has finished');
    await session.lock();
    await expect(db.open()).rejects.toMatchObject({ status: 423 });
    await expect(db.backup()).rejects.toMatchObject({ status: 423 });
    await expect(db.settings.get('private-preference')).rejects.toMatchObject({ status: 423 });
  });
});
