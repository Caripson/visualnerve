import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { createSimulationGraph } from '../src/simulation/document';
import { SimulationEngine } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import type { SimulationModel } from '../src/simulation/types';
import { parallelModel } from './helpers/parallel-model';

const password = 'test-only encrypted parallel workspace password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let session: VaultSession, database: EncryptedWorkspaceDatabase, repo: Repository, name: string;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(created.keys));
beforeEach(async () => {
  name = `parallel-encrypted-${crypto.randomUUID()}`;
  const physical = new VaultRecordStorage(name);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  database = new EncryptedWorkspaceDatabase(
    session,
    new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
  );
  repo = new Repository(database);
});
afterEach(async () => {
  database.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
async function freshUnlock() {
  await session.lock();
  database.dispose();
  await session.dispose();
  session = new VaultSession(new VaultRecordStorage(name), cipher);
  await session.initialize();
  await session.unlock(password);
  database = new EncryptedWorkspaceDatabase(
    session,
    new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
  );
  repo = new Repository(database);
}

describe('parallel execution over authenticated encrypted IndexedDB', () => {
  it('retains the paired model, real waiting checkpoint and business result after a fresh lock/unlock', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Encrypted parallel delivery', parallelModel({ resourceCapacity: 1 })),
    );
    const model = await repo.request<SimulationModel>(`/diagrams/${graph.diagram.id}/simulation`);
    const options = {
      durationSeconds: 60,
      seed: 42,
      untilComplete: true,
      runId: 'encrypted-parallel',
    };
    const engine = new SimulationEngine(model, options);
    engine.advance(6);
    const waiting = engine.state();
    expect(waiting.parallel?.activeGroups).toBe(1);
    engine.advance(60);
    const result = engine.result(),
      timestamp = new Date().toISOString();
    const store = new SimulationRunStore(database);
    await store.put({
      id: result.runId,
      diagramId: graph.diagram.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: result.status,
      model,
      options,
      result,
    });
    await store.putCheckpoint(result.runId, waiting.timeSeconds, waiting);
    await freshUnlock();
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    const reopened = new SimulationRunStore(database);
    expect((await reopened.get(result.runId)).result).toEqual(result);
    expect((await reopened.checkpoints(result.runId))[0].state).toEqual(waiting);
    const read = await repo.request<SimulationModel>(`/diagrams/${graph.diagram.id}/simulation`);
    const replay = new SimulationEngine(read, options);
    replay.advance(60);
    expect(replay.result()).toEqual(result);
  });
  it('rejects invalid API changes to a parallel pair atomically, preserving model and version', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Protected encrypted fork', parallelModel()),
    );
    const fork = graph.simulation!.nodes.find((node) => node.type === 'fork')!;
    await expect(
      repo.request(`/diagrams/${graph.diagram.id}/simulation/nodes/${fork.id}`, 'PATCH', {
        baseVersion: graph.diagram.version,
        value: { fork: { branchEdgeIds: ['not-an-edge'] } },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'SIMULATION_INVALID_MODEL' });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    await freshUnlock();
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  });
});
