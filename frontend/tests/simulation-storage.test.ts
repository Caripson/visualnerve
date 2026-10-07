import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { blankGraph } from '../src/model/types';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import { validateGraph } from '../src/model/validation';
import { markdown, parseImport } from '../src/export/semantic';

let db: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`sim-test-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
});
afterEach(async () => {
  await db.delete();
});

describe('local Process Simulator persistence', () => {
  it.each([0, 1, 3])(
    'honors frozen configured checkpoint retention %i while preserving useful endpoints',
    async (limit) => {
      const model = createBasicModel();
      model.retention = { ...model.retention, checkpoints: limit };
      const graph = await repo.importGraph(createSimulationGraph('Checkpoint retention', model));
      const result = runSimulation(graph.simulation!, {
        durationSeconds: 600,
        seed: 42,
        runId: 'retention-run',
      });
      const store = new SimulationRunStore(db),
        timestamp = new Date().toISOString();
      await store.put({
        id: result.runId,
        diagramId: graph.diagram.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: result.status,
        model: graph.simulation!,
        options: { durationSeconds: 600, seed: 42 },
        result,
      });
      for (let timeSeconds = 0; timeSeconds <= 6; timeSeconds++)
        await store.putCheckpoint(result.runId, timeSeconds, { ...result, timeSeconds });
      const checkpoints = await store.checkpoints(result.runId);
      expect(checkpoints.length).toBeLessThanOrEqual(limit);
      if (limit === 0) expect(checkpoints).toEqual([]);
      else {
        expect(checkpoints.at(-1)?.timeSeconds).toBe(6);
        if (limit > 1) expect(checkpoints[0].timeSeconds).toBe(0);
      }
    },
  );
  it('adds v8 stores without changing existing v7 document types or graph identities', async () => {
    const name = `sim-upgrade-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(7).stores({
      diagrams: 'id,name,type,updatedAt,folder,*tags',
      nodes: 'id,diagramId,&[diagramId+externalId],updatedAt,nodeType,status,parentId,*ownerIds',
      edges: 'id,diagramId,&[diagramId+externalId],sourceNodeId,targetNodeId,updatedAt',
      owners: 'id,&externalId,name,kind,team,updatedAt',
      settings: 'key',
      templates: 'id,name',
      datasets: 'id,diagramId,updatedAt',
      historySnapshots: 'id,diagramId,createdAt,contentId,*sourceIds',
      historyContents: 'id,diagramId,bytes',
      historySources: 'id,diagramId,&[diagramId+datasetId+datasetVersion],rowId,bytes',
      historyRows: 'id,diagramId,bytes',
    });
    const documents = ['flowchart', 'mindmap', 'timeline', 'process'].map((type) =>
      blankGraph(`Old ${type}`, type as 'flowchart'),
    );
    await old.table('diagrams').bulkPut(documents.map((graph) => graph.diagram));
    old.close();
    const upgraded = new WorkspaceDatabase(name);
    try {
      await upgraded.initialize();
      expect(upgraded.verno).toBe(8);
      expect(await upgraded.simulationModels.count()).toBe(0);
      for (const graph of documents) {
        const reopened = await upgraded.graph(graph.diagram.id);
        expect(reopened?.diagram.type).toBe(graph.diagram.type);
        expect(reopened?.simulation).toBeUndefined();
      }
    } finally {
      await upgraded.delete();
    }
  });
  it('saves the complete typed model with its graph and reconstructs it after reopen', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Kiosk'));
    expect((await db.simulationModels.get(graph.diagram.id))?.diagramVersion).toBe(
      graph.diagram.version,
    );
    db.close();
    await db.open();
    expect((await repo.getGraph(graph.diagram.id)).simulation).toEqual(graph.simulation);
    validateGraph(await repo.getGraph(graph.diagram.id));
  });
  it('rolls back stale writers and invalid configurations atomically', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Basic', createBasicModel()));
    const model = structuredClone(graph.simulation!);
    const work = model.nodes.find((node) => node.type === 'work')!;
    if (work.type === 'work') work.work.capacity = 3;
    const changed = await repo.saveGraph(setSimulationModel(graph, model), graph.diagram.version);
    await expect(repo.saveGraph(graph, graph.diagram.version)).rejects.toMatchObject({
      status: 409,
    });
    const invalid = structuredClone(changed);
    const invalidWork = invalid.simulation!.nodes.find((node) => node.type === 'work')!;
    if (invalidWork.type === 'work') invalidWork.work.capacity = -1;
    await expect(repo.saveGraph(invalid, changed.diagram.version)).rejects.toMatchObject({
      status: 422,
    });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(changed);
    expect((await db.simulationModels.get(graph.diagram.id))?.model).toEqual(changed.simulation);
  });
  it('cannot turn an ordinary project into a simulator without its semantic model', async () => {
    const graph = await repo.importGraph(blankGraph('Flow', 'flowchart'));
    await expect(
      repo.request(`/diagrams/${graph.diagram.id}`, 'PATCH', {
        version: graph.diagram.version,
        type: 'process-simulator',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect((await repo.getGraph(graph.diagram.id)).diagram.type).toBe('flowchart');
  });
  it('roundtrips native JSON and remaps colliding model, resource-binding and scenario references', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Kiosk'));
    const exported = await repo.request(`/export`, 'POST', {
      diagramId: graph.diagram.id,
      format: 'json',
    });
    const copied = await repo.importGraph(parseImport('json', JSON.stringify(exported)));
    expect(copied.diagram.id).not.toBe(graph.diagram.id);
    expect(copied.nodes[0].id).not.toBe(graph.nodes[0].id);
    expect(copied.simulation!.nodes.map((node) => node.id)).toEqual(
      copied.nodes.map((node) => node.id),
    );
    const stressKeys = Object.keys(
      copied.simulation!.scenarios.find((scenario) => scenario.id === 'package-stress')!.overrides
        .nodes!,
    );
    expect(stressKeys).toEqual([copied.simulation!.nodes[1].id]);
    expect(copied.simulation!.resources).toEqual(graph.simulation!.resources);
    expect(markdown(copied)).toContain('Process Simulator model');
    validateGraph(copied);
  });
  it('history snapshots and restores contain assumptions in addition to visible nodes', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Basic', createBasicModel()));
    const snapshot = await repo.history.create(graph.diagram.id, {
      name: 'Baseline',
      baseVersion: graph.diagram.version,
    });
    const model = structuredClone(graph.simulation!);
    const work = model.nodes.find((node) => node.type === 'work')!;
    if (work.type === 'work') work.work.capacity = 8;
    const changed = await repo.saveGraph(setSimulationModel(graph, model), graph.diagram.version);
    const comparison = await repo.history.compare(graph.diagram.id, snapshot.id);
    expect(
      comparison.changes.some((change) =>
        change.fields.some((field) => field.startsWith('simulation.')),
      ),
    ).toBe(true);
    const restored = await repo.history.restore(graph.diagram.id, snapshot.id, {
      baseVersion: changed.diagram.version,
    });
    expect(restored.graph.simulation).toEqual(graph.simulation);
  });
  it('backs up and merges frozen results/checkpoints alongside their model with canonical remapped IDs', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Basic', createBasicModel()));
    const result = runSimulation(graph.simulation!, {
      durationSeconds: 600,
      seed: 42,
      runId: 'baseline-run',
    });
    const store = new SimulationRunStore(db);
    const now = new Date().toISOString();
    await store.put({
      id: result.runId,
      diagramId: graph.diagram.id,
      createdAt: now,
      updatedAt: now,
      status: result.status,
      model: graph.simulation!,
      options: { durationSeconds: 600, seed: 42 },
      result,
    });
    await store.putCheckpoint(result.runId, result.timeSeconds, result);
    const backup = await db.backup();
    expect(backup.simulationModels).toHaveLength(1);
    expect(backup.simulationRuns).toHaveLength(1);
    const [merged] = await repo.restore(backup, 'merge');
    const [archived] = await store.list(merged.diagram.id);
    const expectedMetrics = {
      ...result.metrics,
      currentBottleneck: merged.simulation!.nodes.find((node) => node.type === 'work')!.id,
    };
    expect(archived.result!.metrics).toEqual(expectedMetrics);
    expect(archived.model).toEqual(merged.simulation);
    expect(Object.keys(archived.result!.nodes)).toEqual(
      merged.simulation!.nodes.map((node) => node.id),
    );
    expect(archived.id).not.toBe(result.runId);
    expect((await store.checkpoints(archived.id))[0].state.metrics).toEqual(expectedMetrics);
    const replayed = runSimulation(archived.model, archived.options);
    expect(replayed.metrics).toEqual(archived.result!.metrics);
    expect(replayed.modelHash).toBe(archived.result!.modelHash);
  });
  it('keeps saved run assumptions immutable across subsequent model edits and cleans up document deletion', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Basic', createBasicModel()));
    const store = new SimulationRunStore(db),
      now = new Date().toISOString();
    const result = runSimulation(graph.simulation!, {
      durationSeconds: 600,
      seed: 42,
      runId: 'run',
    });
    await store.put({
      id: 'run',
      diagramId: graph.diagram.id,
      createdAt: now,
      updatedAt: now,
      status: result.status,
      model: graph.simulation!,
      options: { durationSeconds: 600, seed: 42 },
      result,
    });
    await store.putCheckpoint('run', result.timeSeconds, result);
    const model = structuredClone(graph.simulation!);
    model.particleTypes[0].revenue = 777;
    await repo.saveGraph(setSimulationModel(graph, model), graph.diagram.version);
    expect((await store.get('run')).model.particleTypes[0].revenue).toBe(100);
    await repo.removeDiagram(graph.diagram.id);
    expect(await db.simulationModels.count()).toBe(0);
    expect(await db.simulationRuns.count()).toBe(0);
    expect(await db.simulationCheckpoints.count()).toBe(0);
  });
});
