import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { WorkspaceDatabase, type WorkspaceBackup } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { workspaceStoreNames, type WorkspaceStorage } from '../src/storage/contracts';
import { migrateWorkspace, verifyPendingMigration } from '../src/storage/migration';
import { WORKSPACE_MIGRATION_SETTING } from '../src/storage/migration-settings';
import { prepareWorkspaceMigration } from '../src/storage/migration-preflight';
import {
  migrationCounts,
  migrationDigest,
  type MigrationRecords,
} from '../src/storage/migration-digest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { base, blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { parseCsv } from '../src/data/csv';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation, SimulationEngine } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';

const password = 'exact migration integration password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let db: EncryptedWorkspaceDatabase, codec: VaultLogicalRecordCodec;
let physical: VaultRecordStorage, session: VaultSession, repo: Repository;
let source: WorkspaceDatabase, sourceRepo: Repository;

beforeAll(async () => {
  vault = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  physical = new VaultRecordStorage(`migration-target-${crypto.randomUUID()}`);
  await physical.create(vault.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  codec = new VaultLogicalRecordCodec(cipher);
  db = new EncryptedWorkspaceDatabase(session, codec);
  repo = new Repository(db);
  await db.open();
  source = new WorkspaceDatabase(`migration-source-${crypto.randomUUID()}`);
  sourceRepo = new Repository(source);
  await source.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  await source.delete();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Migration fixture database remained open.'));
  });
  vi.unstubAllGlobals();
});

function graphFixture(): Graph {
  const graph = blankGraph('Private migration orders', 'flowchart');
  graph.owners = [
    {
      ...base(),
      name: 'Private migration owner',
      kind: 'person',
      color: '#0f766e',
      externalId: 'operator-27',
      metadata: {},
    },
  ];
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: 'Private order assembly',
      externalId: 'assembly',
      ownerIds: [graph.owners[0].id],
    }),
    newNode(graph.diagram.id, {
      title: 'Private order delivery',
      externalId: 'delivery',
      ownerIds: [graph.owners[0].id],
    }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      label: 'Private delivery requirement',
      externalId: 'assembly-delivery',
    }),
  ];
  graph.dataset = {
    ...parseCsv(
      'Customer,Amount\nPrivate migration customer,23\nOther private customer,19',
      'orders.csv',
    ),
    diagramId: graph.diagram.id,
  };
  graph.datasets = [
    {
      ...parseCsv('Depot,Slots\nPrivate migration depot,3', 'depots.csv'),
      diagramId: graph.diagram.id,
    },
  ];
  return graph;
}
async function backupFixture(chunked = false) {
  const input = graphFixture();
  if (chunked)
    input.dataset!.rows = Array.from({ length: 500 }, (_, index) => [
      `Private chunk customer ${index} ${'data'.repeat(50)}`,
      String(index),
    ]);
  const original = await sourceRepo.saveGraph(input, 0);
  await sourceRepo.history.create(original.diagram.id, {
    name: 'Original private baseline',
    baseVersion: original.diagram.version,
  });
  const changed = await sourceRepo.saveGraph(
    {
      ...original,
      nodes: original.nodes.map((node, index) =>
        index === 0 ? { ...node, title: 'Private updated assembly' } : node,
      ),
    },
    original.diagram.version,
  );
  await sourceRepo.history.create(changed.diagram.id, {
    name: 'Second private baseline',
    baseVersion: changed.diagram.version,
  });
  const custom = blankGraph('Private custom workflow', 'flowchart');
  await source.templates.put({
    id: 'custom-private-template',
    name: 'Private reusable template',
    builtin: false,
    graph: custom,
  });
  const model = createBasicModel({ particles: 3, processingSeconds: 10 });
  model.nodes.push({
    id: 'archived-only',
    name: 'Historical optional step',
    type: 'work',
    work: { capacity: 1, processingSeconds: 1 },
  });
  model.edges.forEach((edge) => {
    edge.travelSeconds = 10;
  });
  const sim = await sourceRepo.saveGraph(
    createSimulationGraph('Private simulation archive', model),
    0,
  );
  const options = { durationSeconds: 120, seed: 42, runId: 'exact-private-run' };
  const engine = new SimulationEngine(sim.simulation!, options);
  engine.advance(5, Infinity, true);
  const checkpoint = engine.state();
  const result = runSimulation(sim.simulation!, options);
  const runs = new SimulationRunStore(source);
  await runs.put({
    id: result.runId,
    diagramId: sim.diagram.id,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:02:00.000Z',
    status: result.status,
    model: sim.simulation!,
    options,
    result,
  });
  await runs.putCheckpoint(result.runId, 5, checkpoint);
  await runs.putCheckpoint(result.runId, result.timeSeconds, result);
  const deletedId = sim.nodes.find((node) => node.externalId === 'archived-only')!.id;
  const current = setSimulationModel(sim, {
    ...sim.simulation!,
    nodes: sim.simulation!.nodes.filter((node) => node.id !== deletedId),
  });
  await sourceRepo.saveGraph(current, sim.diagram.version);
  await source.settings.put({ key: 'presentation-voice', value: 'en_GB-alan-medium' });
  const backup = JSON.parse(JSON.stringify(await source.backup())) as WorkspaceBackup;
  expect(backup.history!.rows.every((row) => !!row.datasetRef && !row.rows)).toBe(true);
  return { backup, deletedId, changed };
}
async function fullRecords(storage: WorkspaceStorage) {
  const records = {} as MigrationRecords;
  for (const name of workspaceStoreNames) Reflect.set(records, name, await storage[name].toArray());
  return records;
}
async function rawRecords() {
  const native = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(physical.name);
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
async function leavePending(backup: WorkspaceBackup) {
  const commit = physical.commit.bind(physical);
  let committed = 0;
  const spy = vi.spyOn(physical, 'commit').mockImplementation(async (...args) => {
    if (++committed === 2) throw new Error('Interrupted before verification commit.');
    return commit(...args);
  });
  await expect(migrateWorkspace(db, backup)).rejects.toThrow('Interrupted before verification');
  spy.mockRestore();
  expect((await db.settings.get(WORKSPACE_MIGRATION_SETTING))?.value).toMatchObject({
    state: 'pending-verification',
  });
}

describe('exact encrypted workspace transfer', () => {
  it('preserves every logical identity/version/timestamp, compact history, CSV and archived-only simulator state and leaves source unchanged', async () => {
    const { backup, deletedId, changed } = await backupFixture();
    const sourceBefore = await fullRecords(source.asStorage());
    const expected = await prepareWorkspaceMigration(backup, async () => {});
    await db.settings.bulkPut([
      { key: 'workspace-id', value: 'destination-technical-identity' },
      { key: 'storage-consent', value: true },
      { key: 'import-file-limit-mb', value: 1024 },
      { key: 'project-source-file-limit', value: 1000 },
      { key: 'vault-private-state', value: { locallyConfigured: true } },
      { key: 'last-diagram', value: 'old-origin-selection' },
    ]);
    const summary = await migrateWorkspace(db, backup);
    expect(summary.counts).toEqual(migrationCounts(expected.records));
    const actual = await fullRecords(db);
    for (const name of workspaceStoreNames.filter((name) => name !== 'settings'))
      expect(actual[name] as unknown, name).toEqual(
        expect.arrayContaining<unknown>(expected.records[name]),
      );
    for (const name of workspaceStoreNames)
      if (name !== 'settings')
        expect(actual[name], `${name} count`).toHaveLength(expected.records[name].length);
    expect(await repo.getGraph(changed.diagram.id)).toEqual(changed);
    for (const row of actual.historyRows)
      expect(row).toEqual(sourceBefore.historyRows.find((source) => source.id === row.id));
    for (const snapshot of actual.historySnapshots)
      expect(await repo.history.read(snapshot.diagramId, snapshot.id)).toEqual(
        await sourceRepo.history.read(snapshot.diagramId, snapshot.id),
      );
    expect(actual.nodes.some((node) => node.id === deletedId)).toBe(false);
    expect(actual.simulationRuns[0].model.nodes.some((node) => node.id === deletedId)).toBe(true);
    expect(actual.simulationRuns[0].result!.nodes[deletedId]).toBeDefined();
    expect(actual.simulationCheckpoints[0].state.nodes[deletedId]).toBeDefined();
    expect(await fullRecords(source.asStorage())).toEqual(sourceBefore);
    expect(await db.settings.get('workspace-id')).toEqual({
      key: 'workspace-id',
      value: 'destination-technical-identity',
    });
    expect(await db.settings.get('storage-consent')).toEqual({
      key: 'storage-consent',
      value: true,
    });
    expect(await db.settings.get('vault-private-state')).toEqual({
      key: 'vault-private-state',
      value: { locallyConfigured: true },
    });
    expect(await db.settings.get('last-diagram')).toBeUndefined();
    expect(await db.settings.get('mcp-access')).toEqual({ key: 'mcp-access', value: 'off' });
    expect(await db.settings.get('integration-enabled')).toEqual({
      key: 'integration-enabled',
      value: false,
    });
    expect((await db.settings.get(WORKSPACE_MIGRATION_SETTING))!.value).toMatchObject({
      state: 'verified',
      sourceCounts: summary.counts,
      sourceSchemaVersion: 8,
    });
    const raw = JSON.stringify(await rawRecords());
    for (const secret of [
      changed.diagram.id,
      changed.diagram.name,
      'Private migration customer',
      actual.historyRows[0].id,
      'exact-private-run',
      WORKSPACE_MIGRATION_SETTING,
    ])
      expect(raw).not.toContain(secret);
    db.close();
    await db.open();
    expect(await verifyPendingMigration(db)).toEqual(summary);
    await db.nodes.update(changed.nodes[0].id, { title: 'New work after verified migration' });
    expect(await verifyPendingMigration(db)).toEqual(summary);
    expect(await db.nodes.get(changed.nodes[0].id)).toMatchObject({
      title: 'New work after verified migration',
    });
  });

  it('refuses plaintext destinations and live grants; source technical identity/consent/grants cannot transfer', async () => {
    const { backup } = await backupFixture();
    await expect(
      migrateWorkspace(source as unknown as EncryptedWorkspaceDatabase, backup),
    ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_MIGRATION' });
    await db.settings.put({ key: 'mcp-access', value: 'write' });
    await expect(migrateWorkspace(db, backup)).rejects.toMatchObject({
      code: 'MIGRATION_ACCESS_ACTIVE',
    });
    expect(await db.diagrams.count()).toBe(0);
    await db.settings.put({ key: 'mcp-access', value: 'off' });
    backup.settings.push(
      { key: 'workspace-id', value: 'source-identity' },
      { key: 'storage-consent', value: true },
      { key: 'mcp-access', value: 'write' },
      { key: 'bridge-url', value: 'ws://source.invalid/bridge' },
      { key: 'import-file-limit-mb', value: 1024 },
    );
    await migrateWorkspace(db, backup);
    expect((await db.settings.get('workspace-id'))!.value).not.toBe('source-identity');
    expect(await db.settings.get('storage-consent')).toBeUndefined();
    expect(await db.settings.get('bridge-url')).toBeUndefined();
    expect(await db.settings.get('import-file-limit-mb')).toBeUndefined();
    expect((await db.settings.get('mcp-access'))!.value).toBe('off');
  });

  it('requires explicit replacement and validates before any destination writes', async () => {
    const { backup } = await backupFixture();
    const existing = await repo.saveGraph(graphFixture(), 0);
    await expect(migrateWorkspace(db, backup)).rejects.toMatchObject({
      code: 'MIGRATION_REPLACE_CONFIRMATION_REQUIRED',
    });
    expect(await repo.getGraph(existing.diagram.id)).toEqual(existing);
    const put = vi.spyOn(physical, 'commit');
    const invalid = structuredClone(backup);
    invalid.edges[0].targetNodeId = crypto.randomUUID();
    await expect(migrateWorkspace(db, invalid, { replaceExisting: true })).rejects.toMatchObject({
      status: 422,
    });
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
    await migrateWorkspace(db, backup, { replaceExisting: true });
    expect(await db.diagrams.get(existing.diagram.id)).toBeUndefined();
  });

  it.each([
    'duplicate-id',
    'owner-ref',
    'history-digest',
    'simulation-ref',
    'run-hash',
    'checkpoint-ref',
    'unknown-store',
    'vault-setting',
    'missing-metric',
    'setting-value',
  ] as const)('rejects malformed complete backups (%s) before the native commit', async (kind) => {
    const { backup } = await backupFixture();
    if (kind === 'duplicate-id') backup.nodes.push(structuredClone(backup.nodes[0]));
    if (kind === 'owner-ref') backup.nodes[0].ownerIds = [crypto.randomUUID()];
    if (kind === 'history-digest') backup.history!.contents[0].digest = 'a'.repeat(64);
    if (kind === 'simulation-ref') backup.simulationModels![0].diagramId = crypto.randomUUID();
    if (kind === 'run-hash') backup.simulationRuns![0].result!.modelHash = 'invalid';
    if (kind === 'checkpoint-ref')
      backup.simulationCheckpoints![0].state.particles[0].nodeId = crypto.randomUUID();
    if (kind === 'unknown-store')
      Reflect.set(backup, 'unrecognizedArchive', [{ id: 'must-not-be-dropped' }]);
    if (kind === 'missing-metric')
      delete backup.simulationRuns![0].result!.nodes[backup.simulationRuns![0].model.nodes[0].id];
    if (kind === 'setting-value') Reflect.deleteProperty(backup.settings[0], 'value');
    if (kind === 'vault-setting')
      backup.settings.push({ key: 'vault-migration-state', value: { state: 'verified' } });
    const commit = vi.spyOn(physical, 'commit');
    await expect(migrateWorkspace(db, backup)).rejects.toBeDefined();
    expect(commit).not.toHaveBeenCalled();
    expect(await db.diagrams.count()).toBe(0);
    expect(await db.settings.get(WORKSPACE_MIGRATION_SETTING)).toBeUndefined();
  });

  it('rolls back the entire replacement and publishes nothing on a quota failure', async () => {
    const { backup } = await backupFixture();
    const existing = await repo.saveGraph(graphFixture(), 0);
    const previous = await rawRecords();
    const notifications = vi.fn();
    const unsubscribe = db.subscribe(notifications);
    const quota = new DOMException('Fixture quota exceeded.', 'QuotaExceededError');
    const commit = vi.spyOn(physical, 'commit').mockRejectedValue(quota);
    await expect(migrateWorkspace(db, backup, { replaceExisting: true })).rejects.toBe(quota);
    commit.mockRestore();
    expect(notifications).not.toHaveBeenCalled();
    unsubscribe();
    expect(await rawRecords()).toEqual(previous);
    expect(await repo.getGraph(existing.diagram.id)).toEqual(existing);
    expect(await db.settings.get(WORKSPACE_MIGRATION_SETTING)).toBeUndefined();
  });

  it('keeps an interrupted transfer pending and authenticates full row payloads before recovering readiness', async () => {
    const { backup } = await backupFixture(true);
    await leavePending(backup);
    db.close();
    await db.open();
    const read = vi.spyOn(codec, 'read');
    const result = await verifyPendingMigration(db);
    expect(result?.status).toBe('verified');
    expect(read.mock.calls.some((call) => call[1].store === 'historyRows')).toBe(true);
    expect((await db.historyRows.toArray()).some((row) => row.bytes > 64 * 1024)).toBe(true);
    expect((await db.settings.get(WORKSPACE_MIGRATION_SETTING))?.value).toMatchObject({
      state: 'verified',
    });
  });

  it('detects authenticated but changed durable content and leaves the transfer pending', async () => {
    const { backup } = await backupFixture();
    await leavePending(backup);
    await db.nodes.update(backup.nodes[0].id, { title: 'Tampered after interrupted transfer' });
    await expect(verifyPendingMigration(db)).rejects.toMatchObject({
      code: 'MIGRATION_VERIFICATION_FAILED',
    });
    expect((await db.settings.get(WORKSPACE_MIGRATION_SETTING))?.value).toMatchObject({
      state: 'pending-verification',
    });
    expect((await source.nodes.get(backup.nodes[0].id))!.title).toBe(backup.nodes[0].title);
  });

  it('rejects a corrupted encrypted history chunk without treating authenticated metadata as full verification', async () => {
    const { backup } = await backupFixture(true);
    await leavePending(backup);
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(physical.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = connection.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        const request = store.getAll();
        request.onsuccess = () => {
          const chunk = request.result.find(
            (record) => record.store === 'historyRows' && record.partitions.length === 0,
          );
          expect(chunk).toBeDefined();
          chunk.encrypted.ciphertext =
            (chunk.encrypted.ciphertext[0] === 'A' ? 'B' : 'A') +
            chunk.encrypted.ciphertext.slice(1);
          store.put(chunk);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      connection.close();
    }
    await expect(verifyPendingMigration(db)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
    expect((await db.settings.get(WORKSPACE_MIGRATION_SETTING))?.value).toMatchObject({
      state: 'pending-verification',
    });
    expect(await source.datasets.count()).toBe(2);
  });

  it('does not publish readiness after lock/unlock revokes the originating transfer', async () => {
    const { backup } = await backupFixture();
    const commit = physical.commit.bind(physical);
    let first = true,
      locked: Promise<void> | undefined;
    const spy = vi.spyOn(physical, 'commit').mockImplementation(async (...args) => {
      const result = await commit(...args);
      if (first) {
        first = false;
        locked = session.lock();
      }
      return result;
    });
    await expect(migrateWorkspace(db, backup)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await locked;
    spy.mockRestore();
    await session.unlock(password);
    expect((await db.settings.get(WORKSPACE_MIGRATION_SETTING))?.value).toMatchObject({
      state: 'pending-verification',
    });
    expect((await verifyPendingMigration(db))?.status).toBe('verified');
  });
});

function emptyRecords(): MigrationRecords {
  return Object.fromEntries(
    workspaceStoreNames.map((name) => [name, []]),
  ) as unknown as MigrationRecords;
}
describe('private canonical migration receipt', () => {
  it('ignores record/key ordering and omitted JSON fields but preserves array order, Unicode and every table', async () => {
    const original = emptyRecords();
    original.settings = [
      { key: 'second', value: { text: '😀 \\ quoted " data', nested: [1, 2], ignored: undefined } },
      { key: 'first', value: true },
    ];
    const reordered = emptyRecords();
    reordered.settings = [
      { key: 'first', value: true },
      { value: { nested: [1, 2], text: '😀 \\ quoted " data' }, key: 'second' },
    ];
    expect(await migrationDigest(original)).toBe(await migrationDigest(reordered));
    reordered.settings[1].value = { nested: [2, 1], text: '😀 \\ quoted " data' };
    expect(await migrationDigest(original)).not.toBe(await migrationDigest(reordered));
    const large = emptyRecords();
    large.settings = [{ key: 'large', value: 'a😀"\\'.repeat(180_000) }];
    const digest = await migrationDigest(large);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    large.settings[0].value = `${large.settings[0].value} changed`;
    expect(await migrationDigest(large)).not.toBe(digest);
  });
  it('rejects accessors, sparse arrays, cycles and nonfinite values without invoking private getters', async () => {
    const getter = vi.fn();
    for (const value of [
      Object.defineProperty({}, 'secret', { get: getter, enumerable: true }),
      Array(1),
      { amount: Infinity },
    ]) {
      const records = emptyRecords();
      records.settings = [{ key: 'bad', value }];
      await expect(migrationDigest(records)).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.parent = cyclic;
    const records = emptyRecords();
    records.settings = [{ key: 'cycle', value: cyclic }];
    await expect(migrationDigest(records)).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(getter).not.toHaveBeenCalled();
  });
  it('checks originating revocation between digest chunks', async () => {
    const records = emptyRecords();
    records.settings = [{ key: 'private', value: 'x'.repeat(2_200_000) }];
    let checks = 0;
    await expect(
      migrationDigest(records, async () => {
        if (++checks === 7) throw new Error('Origin revoked.');
      }),
    ).rejects.toThrow('Origin revoked.');
    expect(checks).toBe(7);
  });
});
