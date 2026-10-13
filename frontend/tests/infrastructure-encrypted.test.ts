import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { ApiComputeCapacityExample } from '../src/simulation/infrastructure/examples';
import { SimulationRunStore } from '../src/simulation/run-store';
import { runSimulation } from '../src/simulation/engine';
import type { Graph } from '../src/model/types';
import type { SimulationModel } from '../src/simulation/types';

describe('infrastructure in the existing encrypted workspace', () => {
  it('shares semantic API edits, rejects stale/invalid writes and retains ciphertext archives across lock/unlock', async () => {
    const cryptoService = new VaultCrypto(webcrypto as unknown as Crypto);
    const password = 'synthetic infrastructure test password';
    const name = `infrastructure-encrypted-${crypto.randomUUID()}`;
    const created = await cryptoService.createVault(password);
    const physical = new VaultRecordStorage(name);
    await physical.create(created.header);
    let session = new VaultSession(physical, cryptoService);
    await session.initialize();
    await session.unlock(password);
    let db = new EncryptedWorkspaceDatabase(
      session,
      new VaultLogicalRecordCodec(cryptoService, webcrypto as unknown as Crypto),
    );
    try {
      let repo = new Repository(db);
      const source = new ApiComputeCapacityExample().graph('CONFIDENTIAL_INFRA_FIXTURE');
      const arrivals = source.simulation!.nodes.find((node) => node.type === 'source')!;
      if (arrivals.type === 'source')
        arrivals.source = { particleTypeId: 'request', burst: 2, maxCount: 2 };
      const graph = await repo.importGraph(source);
      const saved = await repo.request<Graph>(
        `/diagrams/${graph.diagram.id}/simulation/resources/cpu`,
        'PATCH',
        { baseVersion: graph.diagram.version, value: { capacity: 4 } },
      );
      const model = await repo.request<SimulationModel>(`/diagrams/${graph.diagram.id}/simulation`);
      expect(model.resources.find((resource) => resource.id === 'cpu')!.capacity).toBe(4);
      expect(model.nodes).toEqual(saved.simulation!.nodes);
      await expect(
        repo.request(`/diagrams/${graph.diagram.id}/simulation/resources/cpu`, 'PATCH', {
          baseVersion: graph.diagram.version,
          value: { capacity: 8 },
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        repo.request(`/diagrams/${graph.diagram.id}/simulation/resources/cpu`, 'PATCH', {
          baseVersion: saved.diagram.version,
          value: { unit: 'Mbps' },
        }),
      ).rejects.toMatchObject({ status: 422, code: 'SIMULATION_INFRASTRUCTURE_INVALID' });
      expect(await repo.getGraph(graph.diagram.id)).toEqual(saved);
      const options = { durationSeconds: 10, seed: 42, runId: 'CONFIDENTIAL_INFRA_RUN' };
      const result = runSimulation(model, options);
      const timestamp = new Date().toISOString();
      await new SimulationRunStore(db).put({
        id: result.runId,
        diagramId: saved.diagram.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: result.status,
        model,
        options,
        result,
      });
      const ciphertext = await session.withUnlocked(async ({ lease }) =>
        JSON.stringify(
          await Promise.all(
            ['simulationModels', 'simulationRuns'].map((store) =>
              physical.select(lease, { store: store as 'simulationModels' | 'simulationRuns' }),
            ),
          ),
        ),
      );
      expect(ciphertext).not.toContain('CONFIDENTIAL_INFRA');
      expect(ciphertext).not.toContain('amountMiB');
      expect(ciphertext).not.toContain('coreSeconds');
      await session.lock();
      await expect(repo.getGraph(saved.diagram.id)).rejects.toMatchObject({ status: 423 });
      db.dispose();
      await session.dispose();
      session = new VaultSession(new VaultRecordStorage(name), cryptoService);
      await session.initialize();
      await session.unlock(password);
      db = new EncryptedWorkspaceDatabase(
        session,
        new VaultLogicalRecordCodec(cryptoService, webcrypto as unknown as Crypto),
      );
      repo = new Repository(db);
      expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
      const archive = await new SimulationRunStore(db).get(result.runId);
      expect(archive.result).toEqual(result);
      expect(runSimulation(archive.model, archive.options).infrastructure).toEqual(
        result.infrastructure,
      );
    } finally {
      db.dispose();
      await session.dispose();
      cryptoService.destroyKeys(created.keys);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  });
});
