import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newEdge, newNode, type Diagram, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { WorkspaceDatabase } from '../src/storage/database';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { runSimulation } from '../src/simulation/engine';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationRunStore } from '../src/simulation/run-store';
import { validateSimulationModel } from '../src/simulation/schema';
import type { SimulationModel } from '../src/simulation/types';
import { getSpatialView, setSpatialView } from '../src/spatial/types';

const password = 'test-only spatial creation password phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
afterAll(() => cipher.destroyKeys(created.keys));

describe.each(['indexeddb', 'encrypted'] as const)(
  'native 3D diagram creation with %s persistence',
  (backend) => {
    let database: WorkspaceDatabase | EncryptedWorkspaceDatabase;
    let repo: Repository, name: string;
    let session: VaultSession | undefined;

    beforeEach(async () => {
      name = `spatial-creation-${backend}-${crypto.randomUUID()}`;
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
        session = undefined;
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

    it('creates an empty first-class simulator, preserving its model and 3D view after reopen', async () => {
      const graph = await repo.request<Graph>('/api/v1/spatial-diagrams', 'POST', {
        name: 'New capacity model',
        type: 'process-simulator',
      });
      expect(graph.diagram).toMatchObject({
        name: 'New capacity model',
        type: 'process-simulator',
      });
      expect(getSpatialView(graph)).toEqual({ version: 1, mode: '3d' });
      expect(graph.simulation).toMatchObject({
        type: 'process-simulator',
        schemaVersion: 1,
        nodes: [],
        edges: [],
        particleTypes: [],
        resources: [],
        scenarios: [],
      });
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
      validateGraph(graph);
      validateSimulationModel(graph.simulation);
      expect(await repo.request(`/diagrams/${graph.diagram.id}/simulation`)).toEqual(
        graph.simulation,
      );
      expect((await repo.db.simulationModels.get(graph.diagram.id))?.model).toEqual(
        graph.simulation,
      );

      await reopen();
      expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
      const toggled = await repo.saveGraph(
        setSpatialView(graph, { mode: '2d' }),
        graph.diagram.version,
      );
      expect(getSpatialView(toggled).mode).toBe('2d');
      expect(toggled.simulation).toEqual(graph.simulation);
      expect(toggled.diagram.type).toBe('process-simulator');
    });

    it('configures the created simulator through its semantic API and runs real work headlessly', async () => {
      const empty = await repo.request<Graph>('/spatial-diagrams', 'POST', {
        name: 'Programmatic capacity model',
        type: 'process-simulator',
      });
      const path = `/diagrams/${empty.diagram.id}/simulation`;
      const configured = await repo.request<Graph>(path, 'PUT', {
        baseVersion: empty.diagram.version,
        model: createBasicModel({
          particles: 10,
          processingSeconds: 60,
          capacity: 1,
          revenue: 100,
        }),
      });
      const model = await repo.request<SimulationModel>(path);
      expect(configured.diagram.type).toBe('process-simulator');
      expect(getSpatialView(configured).mode).toBe('3d');
      expect(model).toEqual(configured.simulation);
      expect(model.nodes.map((node) => node.id)).toEqual(configured.nodes.map((node) => node.id));
      expect(model.edges.map((edge) => edge.id)).toEqual(configured.edges.map((edge) => edge.id));

      const options = { durationSeconds: 600, seed: 42, untilComplete: true, runId: 'spatial-run' };
      const result = runSimulation(model, options);
      expect(result.status).toBe('completed');
      expect(result.timeSeconds).toBe(600);
      expect(result.metrics).toMatchObject({
        created: 10,
        completed: 10,
        abandoned: 0,
        realizedRevenue: 1000,
      });
      const timestamp = new Date().toISOString();
      await new SimulationRunStore(database).put({
        id: result.runId,
        diagramId: configured.diagram.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: result.status,
        model,
        options,
        result,
      });
      await reopen();
      expect(await repo.getGraph(configured.diagram.id)).toEqual(configured);
      const restored = await new SimulationRunStore(database).get(result.runId);
      expect(restored?.result).toEqual(result);
      expect(
        runSimulation((await repo.getGraph(configured.diagram.id)).simulation!, options),
      ).toEqual(result);
    });

    it('retains the default and explicit mindmap behavior without creating simulation state', async () => {
      for (const type of [undefined, 'mindmap'] as const) {
        const blank = await repo.request<Graph>('/spatial-diagrams', 'POST', {
          name: 'Ordinary mindmap',
          ...(type ? { type } : {}),
        });
        expect(blank.diagram.type).toBe('mindmap');
        expect(blank.simulation).toBeUndefined();
        expect(blank.nodes).toEqual([]);
        expect(getSpatialView(blank).mode).toBe('3d');
        const nodes = ['Parent', 'Child'].map((title) => newNode(blank.diagram.id, { title }));
        const saved = await repo.saveGraph(
          { ...blank, nodes, edges: [newEdge(blank.diagram.id, nodes[0].id, nodes[1].id)] },
          blank.diagram.version,
        );
        validateGraph(saved);
        expect(await repo.db.simulationModels.get(saved.diagram.id)).toBeUndefined();
        await reopen();
        expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
        expect(getSpatialView(saved).mode).toBe('3d');
      }
    });

    it('preserves the kiosk default for ordinary 2D simulator creation', async () => {
      const diagram = await repo.request<Diagram>('/diagrams', 'POST', {
        name: 'Existing default',
        type: 'process-simulator',
      });
      const graph = await repo.getGraph(diagram.id);
      expect(getSpatialView(graph).mode).toBe('2d');
      expect(graph.nodes.some((node) => node.externalId === 'core-source')).toBe(true);
      expect(graph.nodes.some((node) => node.externalId === 'package-source')).toBe(true);
      expect(graph.simulation!.particleTypes).toHaveLength(2);
      validateGraph(graph);
    });

    it('reports the current semantic API version consistently without impersonating bridge health', async () => {
      const health = await repo.request<Record<string, unknown>>('/health');
      const capabilities = await repo.request<Record<string, unknown>>('/simulation/capabilities');
      expect(health).toMatchObject({ status: 'ok', storage: 'indexeddb', version: '0.6.0' });
      expect(capabilities.apiVersion).toBe(health.version);
      expect(health).not.toHaveProperty('bridge');
      expect(health).not.toHaveProperty('tools');
      expect(health).not.toHaveProperty('capabilities');
    });
  },
);
