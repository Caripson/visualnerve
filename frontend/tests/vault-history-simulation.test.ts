import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import type { WorkspaceStorage } from '../src/storage/contracts';
import { blankGraph, newNode } from '../src/model/types';
import { parseCsv } from '../src/data/csv';
import { HistoryStore } from '../src/history/store';
import * as historyCodec from '../src/history/codec';
import { SimulationService } from '../src/simulation/service';
import { SimulationRunStore } from '../src/simulation/run-store';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';

const password = 'test-only history and simulation vault password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let codec: VaultLogicalRecordCodec, repo: Repository, service: SimulationService;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

class HeldWorker {
  static instances: HeldWorker[] = [];
  onmessage?: (event: MessageEvent<WorkerUpdate>) => void;
  onerror?: (event: ErrorEvent) => void;
  engine?: SimulationEngine;
  commands: WorkerCommand[] = [];
  terminated = false;
  constructor() {
    HeldWorker.instances.push(this);
  }
  postMessage(command: WorkerCommand) {
    this.commands.push(structuredClone(command));
    if (command.kind === 'start')
      this.engine = new SimulationEngine(command.model, command.options);
  }
  emit(update: WorkerUpdate) {
    if (!this.terminated)
      this.onmessage?.({ data: structuredClone(update) } as MessageEvent<WorkerUpdate>);
  }
  finish() {
    this.engine!.advance(this.engine!.options.durationSeconds);
    this.emit({ kind: 'state', state: this.engine!.state(), result: this.engine!.result() });
  }
  terminate() {
    this.terminated = true;
  }
}
const latest = () => HeldWorker.instances.at(-1)!;

beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Worker', HeldWorker);
  HeldWorker.instances = [];
  physical = new VaultRecordStorage(`vault-history-simulation-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  codec = new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto);
  db = new EncryptedWorkspaceDatabase(session, codec);
  repo = new Repository(db);
  service = new SimulationService(db);
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
});
afterEach(async () => {
  service.dispose();
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Encrypted history fixture remained open.'));
  });
  vi.unstubAllGlobals();
});
afterAll(() => cipher.destroyKeys(created.keys));

async function diagram(withSource = false) {
  const graph = blankGraph('Confidential workflow');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Private original step' })];
  if (withSource)
    graph.dataset = {
      ...parseCsv('Customer,Amount\nPrivate customer,17\n', 'Private source.csv'),
      diagramId: graph.diagram.id,
    };
  return repo.saveGraph(graph, 0);
}
async function simulator() {
  const graph = await repo.saveGraph(
    createSimulationGraph('Private simulation', createBasicModel({ particles: 1 })),
    0,
  );
  return { diagramId: graph.diagram.id, model: graph.simulation! };
}

describe('history and simulation retain their originating encrypted scope', () => {
  it('rolls back the safety snapshot and graph together when the scoped restore saver fails', async () => {
    const original = await diagram();
    const snapshot = await repo.history.create(original.diagram.id, {
      name: 'Baseline',
      baseVersion: original.diagram.version,
    });
    const current = await repo.saveGraph(
      { ...original, nodes: [{ ...original.nodes[0], title: 'Keep current draft' }] },
      original.diagram.version,
    );
    let guardedScope: WorkspaceStorage | undefined;
    const failing = new HistoryStore(db, async (graph, version, scope) => {
      expect(scope === guardedScope).toBe(true);
      expect(scope === db).toBe(false);
      expect(scope.inTransaction).toBe(true);
      await new Repository(scope).saveGraph(graph, version);
      throw new Error('Fail after staging the restored graph');
    });
    await expect(
      failing.restore(original.diagram.id, snapshot.id, {
        baseVersion: current.diagram.version,
        beforeWrite: async (scope) => {
          guardedScope = scope;
          expect((await scope.settings.get('mcp-access'))?.value).toBe('write');
        },
      }),
    ).rejects.toThrow('Fail after staging the restored graph');
    expect(await repo.getGraph(original.diagram.id)).toEqual(current);
    expect((await repo.history.list(original.diagram.id)).map((item) => item.id)).toEqual([
      snapshot.id,
    ]);
    expect(await db.historyContents.count()).toBe(1);
  });

  it('uses metadata for history capacity and unchanged archived rows across source renames', async () => {
    const original = await diagram(true);
    await repo.history.create(original.diagram.id, {
      name: 'Original source',
      baseVersion: original.diagram.version,
    });
    const renamed = await repo.saveGraph(
      { ...original, dataset: { ...original.dataset!, name: 'Renamed source.csv' } },
      original.diagram.version,
    );
    const read = vi.spyOn(codec, 'read');
    await repo.history.create(renamed.diagram.id, {
      name: 'Renamed source',
      baseVersion: renamed.diagram.version,
    });
    expect(read.mock.calls.filter((call) => call[1].store === 'historyRows')).toEqual([]);
    read.mockClear();
    const backup = await db.backup();
    expect(backup.history!.rows).toHaveLength(1);
    expect(backup.history!.rows[0].datasetRef).toEqual({
      id: renamed.dataset!.id,
      version: renamed.dataset!.version,
    });
    expect(backup.history!.rows[0].rows).toBeUndefined();
    expect(read.mock.calls.filter((call) => call[1].store === 'historyRows')).toEqual([]);
  });

  it('rejects a snapshot hash that finishes after lock and a later unlock without adding history', async () => {
    const original = await diagram();
    const paused = gate(),
      entered = gate();
    const digest = historyCodec.historyDigest;
    vi.spyOn(historyCodec, 'historyDigest').mockImplementationOnce(async (value) => {
      entered.release();
      await paused.promise;
      return digest(value);
    });
    const pending = expect(
      repo.history.create(original.diagram.id, {
        name: 'Old session',
        baseVersion: original.diagram.version,
      }),
    ).rejects.toMatchObject({ status: 423 });
    await entered.promise;
    try {
      await session.lock();
      await session.unlock(password);
    } finally {
      paused.release();
    }
    await pending;
    expect(await db.historySnapshots.count()).toBe(0);
    expect(await db.historyContents.count()).toBe(0);
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
  });

  it('guards archive writes in their actual scope and excludes callbacks from worker and stored options', async () => {
    const { diagramId, model } = await simulator();
    const beforeWrite = vi.fn(async (scope: WorkspaceStorage) => {
      expect(scope.inTransaction).toBe(true);
      expect((await scope.settings.get('mcp-access'))?.value).toBe('write');
    });
    const run = await service.start(diagramId, model, { origin: 'api', beforeWrite });
    expect(beforeWrite).toHaveBeenCalledOnce();
    expect(run.options).not.toHaveProperty('beforeWrite');
    expect(run.options).not.toHaveProperty('origin');
    expect((await db.simulationRuns.get(run.id))!.options).toEqual(run.options);
    expect(latest().commands[0]).toMatchObject({ kind: 'start', options: run.options });
    const deny = vi.fn(async (scope: WorkspaceStorage) => {
      expect(scope.inTransaction).toBe(true);
      throw new Error('Grant revoked in actual scope');
    });
    const commandCount = latest().commands.length;
    await expect(service.setSpeed(run.id, 10, deny)).rejects.toThrow(
      'Grant revoked in actual scope',
    );
    expect(latest().commands).toHaveLength(commandCount);
    expect((await service.get(run.id)).options.speed).toBe(1);
  });

  it('does not start a worker or persist a run when a paused scoped grant outlives its session', async () => {
    const { diagramId, model } = await simulator();
    const paused = gate(),
      entered = gate();
    const pending = expect(
      service.start(diagramId, model, {
        beforeWrite: async (scope) => {
          entered.release();
          await paused.promise;
          await scope.settings.get('mcp-access');
        },
      }),
    ).rejects.toMatchObject({ status: 423 });
    await entered.promise;
    try {
      await session.lock();
      service.dispose();
      await session.unlock(password);
    } finally {
      paused.release();
    }
    await pending;
    expect(await db.simulationRuns.count()).toBe(0);
    expect(HeldWorker.instances).toEqual([]);
  });

  it('rolls back the final run and checkpoint together if checkpoint persistence fails', async () => {
    const { diagramId, model } = await simulator();
    const run = await service.start(diagramId, model);
    vi.spyOn(SimulationRunStore.prototype, 'putCheckpoint').mockRejectedValueOnce(
      new Error('Checkpoint write rejected'),
    );
    latest().finish();
    await expect(service.result(run.id)).rejects.toMatchObject({ status: 500 });
    expect((await db.simulationRuns.get(run.id))!.status).toBe('running');
    expect((await db.simulationRuns.get(run.id))!.result).toBeUndefined();
    expect(await db.simulationCheckpoints.count()).toBe(0);
  });

  it('rejects old queued results after lock/unlock and can restart the same service cleanly', async () => {
    const { diagramId, model } = await simulator();
    const run = await service.start(diagramId, model);
    const oldWorker = latest();
    const paused = gate(),
      entered = gate();
    const put = SimulationRunStore.prototype.put;
    vi.spyOn(SimulationRunStore.prototype, 'put').mockImplementationOnce(async function (
      this: SimulationRunStore,
      value,
      beforeWrite,
    ) {
      entered.release();
      await paused.promise;
      return put.call(this, value, beforeWrite);
    });
    oldWorker.finish();
    const pendingResult = expect(service.result(run.id)).rejects.toMatchObject({ status: 423 });
    await entered.promise;
    try {
      await session.lock();
      service.dispose();
      expect(service.current(diagramId)).toBeUndefined();
      expect(service.view(run.id)).toBeUndefined();
      expect(oldWorker.terminated).toBe(true);
      await session.unlock(password);
    } finally {
      paused.release();
    }
    await pendingResult;
    expect((await db.simulationRuns.get(run.id))!.status).toBe('running');
    expect((await db.simulationRuns.get(run.id))!.result).toBeUndefined();
    expect(await db.simulationCheckpoints.count()).toBe(0);
    const restarted = await service.start(diagramId, model);
    expect(restarted.id).not.toBe(run.id);
    latest().finish();
    expect((await service.result(restarted.id)).status).toBe('completed');
    expect((await db.simulationRuns.get(restarted.id))!.status).toBe('completed');
    expect(await db.simulationCheckpoints.count()).toBe(1);
  });

  it('cancels a held replay and ignores late worker states when the vault locks', async () => {
    const { diagramId, model } = await simulator();
    const run = await service.start(diagramId, model);
    latest().finish();
    await service.result(run.id);
    const count = HeldWorker.instances.length;
    const replay = expect(service.seek(run.id, 1)).rejects.toMatchObject({ status: 423 });
    await expect.poll(() => HeldWorker.instances.length).toBe(count + 1);
    const worker = latest();
    const lateHandler = worker.onmessage;
    await session.lock();
    await replay;
    expect(worker.terminated).toBe(true);
    expect(service.view(run.id)).toBeUndefined();
    await session.unlock(password);
    lateHandler?.({
      data: { kind: 'state', state: worker.engine!.state() },
    } as MessageEvent<WorkerUpdate>);
    expect(service.view(run.id)).toBeUndefined();
    expect(await db.simulationCheckpoints.count()).toBe(1);
  });
});
