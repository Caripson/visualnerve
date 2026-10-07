import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { createSimulationGraph, setSimulationModel } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { applyScenarioDraft } from '../src/simulation/editor/draft';
import { cloneScenario } from '../src/simulation/scenario-patch';
import { resolveScenario, validateSimulationModel } from '../src/simulation/schema';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import type { SimulationModel } from '../src/simulation/types';

let db: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`simulation-roundtrip-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
});
afterEach(async () => db.delete());

function configured() {
  const model = createBasicModel();
  model.economics = { maximumBudget: 1000 };
  model.scenarios = [{ id: 'a', name: 'A', overrides: {} }];
  model.resources.push({
    id: 'staff',
    name: 'Staff',
    unit: 'employee',
    capacity: 1,
    schedule: [{ startSeconds: 0, endSeconds: 500, repeatSeconds: 1000 }],
  });
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type === 'work')
    Object.assign(work.work, {
      queueLimit: 1,
      overflowNodeId: 'outcome',
      resourceRequirements: [{ resourceId: 'staff', units: 1 }],
      scaling: { maxCapacity: 2, queueAbove: 1 },
      schedule: [{ startSeconds: 0, endSeconds: 500, repeatSeconds: 1000 }],
    });
  model.particleTypes[0].patienceSeconds = 300;
  return createSimulationGraph('Serializable clear', model);
}

function clearedModel(model: SimulationModel) {
  const draft = resolveScenario(model, 'a', 1);
  const work = draft.nodes.find((node) => node.type === 'work')!;
  if (work.type === 'work')
    Object.assign(work.work, {
      queueLimit: undefined,
      overflowNodeId: undefined,
      scaling: undefined,
      schedule: undefined,
    });
  draft.resources[0].schedule = undefined;
  draft.particleTypes[0].patienceSeconds = undefined;
  draft.economics = { maximumBudget: undefined };
  return applyScenarioDraft(model, draft, 'a');
}

function expectCleared(model: SimulationModel) {
  validateSimulationModel(model);
  const baseline = model.nodes.find((node) => node.type === 'work')!;
  expect(baseline.type === 'work' && baseline.work.queueLimit).toBe(1);
  const resolved = resolveScenario(model, 'a');
  const work = resolved.nodes.find((node) => node.type === 'work')!;
  expect(work).toMatchObject({ work: { capacity: 1, processingSeconds: 60 } });
  if (work.type === 'work')
    for (const key of ['queueLimit', 'overflowNodeId', 'scaling', 'schedule'])
      expect(work.work).not.toHaveProperty(key);
  expect(resolved.resources[0]).not.toHaveProperty('schedule');
  expect(resolved.particleTypes[0]).not.toHaveProperty('patienceSeconds');
  expect(resolved.economics).not.toHaveProperty('maximumBudget');
}

describe('serializable scenario removal', () => {
  it('records omitted baseline properties as null when the complete JSON editor removes their keys', async () => {
    const graph = configured(),
      draft = resolveScenario(graph.simulation!, 'a', 1);
    const work = draft.nodes.find((node) => node.type === 'work')!;
    if (work.type === 'work') {
      delete work.work.queueLimit;
      delete work.work.overflowNodeId;
      delete work.work.scaling;
      delete work.work.schedule;
    }
    delete draft.resources[0].schedule;
    delete draft.particleTypes[0].patienceSeconds;
    delete draft.economics!.maximumBudget;
    const model = applyScenarioDraft(graph.simulation!, draft, 'a');
    expectCleared(model);
    const imported = await repo.importGraph(
      JSON.parse(JSON.stringify(setSimulationModel(graph, model))),
    );
    expectCleared(imported.simulation!);
  });
  it('persists UI optional-property removals as null and survives native JSON import', async () => {
    const original = configured();
    const model = clearedModel(original.simulation!);
    expectCleared(model);
    const workId = model.nodes.find((node) => node.type === 'work')!.id;
    expect(model.scenarios[0].overrides.nodes![workId]).toMatchObject({
      work: { queueLimit: null, overflowNodeId: null, scaling: null, schedule: null },
    });
    const graph = await repo.importGraph(setSimulationModel(original, model));
    const imported = await repo.importGraph(JSON.parse(JSON.stringify(graph)));
    expectCleared(imported.simulation!);
  });
  it('retains clear semantics in a serialized workspace backup and frozen scenario result', async () => {
    const original = configured();
    const graph = await repo.importGraph(
      setSimulationModel(original, clearedModel(original.simulation!)),
    );
    const before = runSimulation(graph.simulation!, {
      seed: 42,
      scenarioId: 'a',
      durationSeconds: 1200,
    });
    const timestamp = new Date().toISOString(),
      store = new SimulationRunStore(db);
    await store.put({
      id: before.runId,
      diagramId: graph.diagram.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: before.status,
      model: graph.simulation!,
      options: { seed: 42, scenarioId: 'a', durationSeconds: 1200 },
      result: before,
    });
    const [restored] = await repo.restore(JSON.parse(JSON.stringify(await db.backup())), 'merge');
    expectCleared(restored.simulation!);
    const after = runSimulation(restored.simulation!, {
      seed: 42,
      scenarioId: 'a',
      durationSeconds: 1200,
    });
    const [archived] = await store.list(restored.diagram.id);
    expectCleared(archived.model);
    expect(archived.result!.metrics).toEqual(after.metrics);
    expect(archived.result!.modelHash).toBe(after.modelHash);
    expect(after.metrics).toEqual({
      ...before.metrics,
      currentBottleneck: before.metrics.currentBottleneck
        ? restored.simulation!.nodes.find((node) => node.type === 'work')!.id
        : null,
    });
  });
  it('omits undefined members of replaced arrays and rejects clearing required or identity fields', () => {
    const graph = configured(),
      draft = resolveScenario(graph.simulation!, 'a', 1);
    draft.resources[0].schedule![0].repeatSeconds = undefined;
    const model = JSON.parse(
      JSON.stringify(applyScenarioDraft(graph.simulation!, draft, 'a')),
    ) as SimulationModel;
    validateSimulationModel(model);
    expect(resolveScenario(model, 'a').resources[0].schedule![0]).not.toHaveProperty(
      'repeatSeconds',
    );
    const workId = model.nodes.find((node) => node.type === 'work')!.id;
    for (const patch of [{ work: { processingSeconds: null } }, { id: null }]) {
      const invalid = structuredClone(model);
      invalid.scenarios[0].overrides.nodes = { [workId]: patch };
      expect(() => validateSimulationModel(invalid)).toThrow();
    }
  });
  it('clones the selected demand multiplier and detached overrides with the same deterministic result', () => {
    const model = createBasicModel();
    model.scenarios = [
      {
        id: 'a',
        name: 'A',
        demandMultiplier: 1.5,
        overrides: { nodes: { work: { work: { capacity: 2 } } } },
      },
    ];
    model.scenarios.push(cloneScenario(model, 'a', 'B', 'b'));
    expect(model.scenarios[1].demandMultiplier).toBe(1.5);
    expect(runSimulation(model, { scenarioId: 'b' }).metrics).toEqual(
      runSimulation(model, { scenarioId: 'a' }).metrics,
    );
    model.scenarios[1].overrides.nodes!.work = { work: { capacity: 3 } };
    expect(resolveScenario(model, 'a').nodes.find((node) => node.id === 'work')).toMatchObject({
      work: { capacity: 2 },
    });
    expect(model.nodes.find((node) => node.id === 'work')).toMatchObject({ work: { capacity: 1 } });
  });
});
