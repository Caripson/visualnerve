import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel, createKioskModel } from '../src/simulation/examples';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { setSimulationModel } from '../src/simulation/document';
import { StorageError } from '../src/model/errors';

let db: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`simulation-adversarial-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
});
afterEach(async () => {
  await db.delete();
});

async function archivedBackup() {
  const graph = await repo.importGraph(createSimulationGraph('Archive', createKioskModel()));
  const result = runSimulation(graph.simulation!, {
    durationSeconds: 600,
    seed: 42,
    runId: 'archive-run',
  });
  const now = new Date().toISOString();
  await new SimulationRunStore(db).put({
    id: result.runId,
    diagramId: graph.diagram.id,
    createdAt: now,
    updatedAt: now,
    status: result.status,
    model: graph.simulation!,
    options: { durationSeconds: 600, seed: 42 },
    result,
  });
  return { graph, backup: await db.backup() };
}

describe('simulation archive and generic-command integrity', () => {
  it('returns structured 422 for malformed semantic object shapes without changing the authoritative model', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Invalid API shapes', createBasicModel()),
    );
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    for (const patch of [
      { work: null },
      { work: { resourceRequirements: {} } },
      { work: { schedule: {} } },
      { work: { scaling: [] } },
    ]) {
      await expect(
        repo.request(`/diagrams/${graph.diagram.id}/simulation/nodes/${work.id}`, 'PATCH', {
          baseVersion: graph.diagram.version,
          value: patch,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'SIMULATION_INVALID_MODEL',
        issues: [{ path: 'model' }],
      });
      expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    }
  });
  it('rechecks write consent before persistence and leaves the graph unchanged on revocation', async () => {
    const graph = await repo.importGraph(createSimulationGraph('Consent', createBasicModel()));
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    await expect(
      repo.request(
        `/diagrams/${graph.diagram.id}/simulation/nodes/${work.id}`,
        'PATCH',
        { baseVersion: graph.diagram.version, value: { work: { capacity: 8 } } },
        {
          beforeHistoryWrite: async () => {
            throw new StorageError(403, 'Write grant revoked.');
          },
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  });
  it.each(['resource-waiters', 'particle-history', 'final-capacities'])(
    'rejects malformed nested archived %s with 422 and rolls back the entire merge',
    async (invalid) => {
      const { graph, backup } = await archivedBackup();
      const result = backup.simulationRuns![0].result!;
      if (invalid === 'resource-waiters')
        Object.values(result.resources)[0].waitingNodeIds = null as never;
      if (invalid === 'particle-history') result.particles[0].history = null as never;
      if (invalid === 'final-capacities') result.finalCapacities = null as never;
      const original = await repo.getGraph(graph.diagram.id);
      await expect(repo.restore(backup, 'merge')).rejects.toMatchObject({ status: 422 });
      expect(await db.diagrams.count()).toBe(1);
      expect(await db.simulationRuns.count()).toBe(1);
      expect(await repo.getGraph(graph.diagram.id)).toEqual(original);
    },
  );
  it('keeps source/work/outcome semantics synchronized through ordinary node and edge deletion', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Generic commands', createBasicModel()),
    );
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    await repo.request(`/nodes/${work.id}`, 'DELETE');
    const saved = await repo.getGraph(graph.diagram.id);
    expect(saved.nodes.some((node) => node.id === work.id)).toBe(false);
    expect(saved.simulation!.nodes.some((node) => node.id === work.id)).toBe(false);
    expect(saved.simulation!.edges).toEqual([]);
  });
  it('rejects generic deletion of shared resource displays without removing live constraints', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Shared resource', createKioskModel()),
    );
    const display = graph.simulation!.nodes.find((node) => node.type === 'resource')!;
    await expect(repo.request(`/nodes/${display.id}`, 'DELETE')).rejects.toMatchObject({
      status: 422,
    });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
  });
  it('does not duplicate an investment in the same shared resource when copying a Work node', () => {
    const model = createKioskModel();
    model.improvements.push({
      id: 'training',
      name: 'Shared staff training',
      resourceId: 'store-staff',
      enabled: true,
      investmentCost: 1000,
      processingTimeMultiplier: 0.9,
    });
    const graph = createSimulationGraph('Original', model);
    const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
    const pasted = pasteSelection(copySelection(graph, [work.id]), graph);
    expect(pasted.simulation!.improvements).toEqual(graph.simulation!.improvements);
    expect(pasted.simulation!.resources).toEqual(graph.simulation!.resources);
  });
  it('drops out-of-selection node bindings on an improvement copied with its resource to another document', () => {
    const model = createKioskModel();
    model.improvements.push({
      id: 'training',
      name: 'Training',
      resourceId: 'store-staff',
      nodeId: 'core-sales',
      enabled: true,
      investmentCost: 1000,
    });
    const graph = createSimulationGraph('Original', model);
    const resource = graph.simulation!.nodes.find((node) => node.type === 'resource')!;
    const target = createSimulationGraph('Target', createBasicModel());
    const pasted = pasteSelection(copySelection(graph, [resource.id]), target);
    const feature = pasted.simulation!.improvements[0];
    expect(feature.nodeId).toBeUndefined();
    expect(pasted.simulation!.resources.some((item) => item.id === feature.resourceId)).toBe(true);
    expect(() =>
      setSimulationModel(
        { ...target, nodes: [...target.nodes, ...pasted.nodes] },
        pasted.simulation!,
      ),
    ).not.toThrow();
  });
});
