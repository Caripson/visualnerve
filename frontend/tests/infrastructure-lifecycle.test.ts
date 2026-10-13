import { afterEach, describe, expect, it } from 'vitest';
import { createBasicModel } from '../src/simulation/examples';
import {
  createSimulationGraph,
  reconcileSimulationGraph,
  setSimulationModel,
} from '../src/simulation/document';
import { remapSimulationModel } from '../src/simulation/copy';
import { copySimulationSelection, pasteSimulationSelection } from '../src/simulation/clipboard';
import { removeSimulationEntity } from '../src/simulation/deletion';
import { remapInfrastructureWork } from '../src/simulation/infrastructure/references';
import { validateSimulationModel } from '../src/simulation/schema';
import { runSimulation, SimulationEngine } from '../src/simulation/engine';
import { DatacenterCapacityExample } from '../src/simulation/datacenter-example';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { SimulationRunStore } from '../src/simulation/run-store';
import { assertArchivedState } from '../src/simulation/archive-validation';
import { sharedGraph, defaultCollaborationShareScope } from '../src/collaboration/document/scope';
import { validateGraph } from '../src/model/validation';

function fixture() {
  const model = createBasicModel({ particles: 2, capacity: 2, processingSeconds: 0 });
  model.schemaVersion = 2;
  model.infrastructure = { schemaVersion: 1 };
  model.resources = [
    {
      id: 'cpu',
      name: 'CPU',
      capacity: 1,
      unit: 'cores',
      infrastructure: { kind: 'cpu', unit: 'cores' },
    },
    {
      id: 'ram',
      name: 'RAM',
      capacity: 128,
      unit: 'MiB',
      infrastructure: { kind: 'memory', unit: 'MiB' },
    },
    {
      id: 'wan',
      name: 'WAN',
      capacity: 8,
      unit: 'Mbps',
      infrastructure: { kind: 'bandwidth', unit: 'Mbps' },
    },
  ];
  const work = model.nodes.find((node) => node.type === 'work')!;
  if (work.type !== 'work') throw new Error('Fixture is missing work');
  work.work.infrastructure = {
    cpu: { resourceId: 'cpu', coreSeconds: 2, cores: 1 },
    memory: [{ resourceId: 'ram', amountMiB: 64, scope: 'case' }],
  };
  model.edges[0].infrastructure = { transfer: { resourceId: 'wan', bytes: 125000 } };
  model.nodes.push(
    ...model.resources.map((resource) => ({
      id: `${resource.id}-display`,
      name: resource.name,
      type: 'resource' as const,
      resourceId: resource.id,
    })),
  );
  model.scenarios = [
    {
      id: 'more-cpu',
      name: 'More CPU',
      overrides: {
        resources: { cpu: { capacity: 2 } },
        nodes: { work: { work: { infrastructure: { cpu: { coreSeconds: 1 } } } } },
      },
    },
  ];
  return model;
}
const databases: WorkspaceDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe('infrastructure document and archive boundaries', () => {
  it('remaps typed resource and scenario references without losing null patch markers', () => {
    const model = fixture();
    const mapped = remapSimulationModel(
      model,
      new Map(),
      new Map(),
      new Map(),
      new Map([
        ['cpu', 'cpu-new'],
        ['ram', 'ram-new'],
        ['wan', 'wan-new'],
      ]),
    );
    validateSimulationModel(mapped);
    expect(mapped.resources.map((resource) => resource.id)).toEqual([
      'cpu-new',
      'ram-new',
      'wan-new',
    ]);
    expect(mapped.edges[0].infrastructure?.transfer.resourceId).toBe('wan-new');
    const work = mapped.nodes.find((node) => node.type === 'work')!;
    expect(work.type === 'work' && work.work.infrastructure).toMatchObject({
      cpu: { resourceId: 'cpu-new' },
      memory: [{ resourceId: 'ram-new', amountMiB: 64, scope: 'case' }],
    });
    expect(mapped.scenarios[0].overrides.resources).toEqual({ 'cpu-new': { capacity: 2 } });
    expect(
      remapInfrastructureWork(
        { cpu: null, memory: null, releaseMemoryResourceIds: ['ram'] },
        (id) => `${id}-new`,
      ),
    ).toEqual({ cpu: null, memory: null, releaseMemoryResourceIds: ['ram-new'] });
    expect(model.resources[0].id).toBe('cpu');
  });
  it('copies all typed dependencies and promotes a legacy target without retaining foreign IDs', () => {
    const source = createSimulationGraph('Source', fixture());
    const clip = copySimulationSelection(
      source,
      new Set(
        source.simulation!.nodes.filter((node) => node.type !== 'resource').map((node) => node.id),
      ),
    )!;
    expect(clip.model.resources.map((resource) => resource.id)).toEqual(['cpu', 'ram', 'wan']);
    const target = createSimulationGraph('Legacy', createBasicModel());
    const nodes = new Map(clip.model.nodes.map((node) => [node.id, crypto.randomUUID()]));
    const edges = new Map(clip.model.edges.map((edge) => [edge.id, crypto.randomUUID()]));
    const pasted = pasteSimulationSelection(clip, target, nodes, edges)!;
    validateSimulationModel(pasted);
    expect(pasted.schemaVersion).toBe(2);
    const typedIds = new Set(
      pasted.resources.filter((resource) => resource.infrastructure).map((resource) => resource.id),
    );
    expect(typedIds.size).toBe(3);
    expect(typedIds.has('cpu')).toBe(false);
    for (const edge of pasted.edges)
      if (edge.infrastructure)
        expect(typedIds.has(edge.infrastructure.transfer.resourceId)).toBe(true);
    const same = pasteSimulationSelection(clip, source, nodes, edges)!;
    expect(same.resources).toHaveLength(3);
    expect(source.simulation!.schemaVersion).toBe(2);
  });
  it('derives typed dependency labels and rejects independent removal or resource deletion', () => {
    const graph = createSimulationGraph('Typed dependencies', fixture());
    validateGraph(graph);
    expect(
      graph.edges
        .filter((edge) => edge.edgeType === 'simulation-resource')
        .map((edge) => edge.label),
    ).toEqual(['1 cores · 2 core-s', '64 MiB · case']);
    const binding = graph.edges.find((edge) => edge.edgeType === 'simulation-resource')!;
    expect(() =>
      reconcileSimulationGraph(graph, {
        ...graph,
        edges: graph.edges.filter((edge) => edge.id !== binding.id),
      }),
    ).toThrow('Assumptions');
    for (const resource of graph.simulation!.resources)
      expect(() => removeSimulationEntity(graph.simulation!, 'resources', resource.id)).toThrow(
        'infrastructure',
      );
    const moved = reconcileSimulationGraph(graph, {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, x: node.x + 20 })),
    });
    expect(moved.simulation).toBe(graph.simulation);
  });
  it('keeps infrastructure models out of live rooms without blocking ordinary process models', () => {
    expect(() =>
      sharedGraph(
        createSimulationGraph('Infrastructure', fixture()),
        defaultCollaborationShareScope,
      ),
    ).toThrow('infrastructure capacity');
    expect(() =>
      sharedGraph(
        createSimulationGraph('Legacy', createBasicModel()),
        defaultCollaborationShareScope,
      ),
    ).not.toThrow();
  });
  it('retains typed models, metrics and replay through save/duplicate/native and full backup collision remapping', async () => {
    const db = new WorkspaceDatabase(`infrastructure-lifecycle-${crypto.randomUUID()}`);
    databases.push(db);
    await db.initialize();
    const repo = new Repository(db);
    const graph = await repo.importGraph(createSimulationGraph('Typed persisted', fixture()));
    const duplicate = await repo.importGraph({
      ...graph,
      diagram: { ...graph.diagram, name: 'Duplicated capacity model' },
    });
    validateGraph(duplicate);
    expect(duplicate.simulation!.resources).toEqual(graph.simulation!.resources);
    expect(duplicate.simulation!.nodes[0].id).not.toBe(graph.simulation!.nodes[0].id);
    const native = await repo.importGraph(
      JSON.parse(
        JSON.stringify({
          ...graph,
          diagram: { ...graph.diagram, name: 'Native JSON capacity model' },
        }),
      ),
    );
    expect(native.simulation!.schemaVersion).toBe(2);
    const options = { durationSeconds: 10, seed: 42, runId: 'typed-archive' };
    const result = runSimulation(graph.simulation!, options);
    const engine = new SimulationEngine(graph.simulation!, options);
    engine.advance(0.3);
    const store = new SimulationRunStore(db);
    const now = new Date().toISOString();
    await store.put({
      id: result.runId,
      diagramId: graph.diagram.id,
      createdAt: now,
      updatedAt: now,
      status: result.status,
      model: graph.simulation!,
      options,
      result,
    });
    await store.putCheckpoint(result.runId, 0.3, engine.state());
    const backup = JSON.parse(JSON.stringify(await db.backup()));
    const restoredGraphs = await repo.restore(backup, 'merge');
    const restored = restoredGraphs.find((value) => value.diagram.name === graph.diagram.name)!;
    const [archive] = await store.list(restored.diagram.id);
    expect(archive.result!.infrastructure).toEqual(result.infrastructure);
    expect(runSimulation(archive.model, archive.options).infrastructure).toEqual(
      result.infrastructure,
    );
    expect((await store.checkpoints(archive.id))[0].state.infrastructure?.memory.ram).toEqual(
      engine.state().infrastructure?.memory.ram,
    );
    const corrupt = structuredClone(result);
    corrupt.infrastructure!.memory.ram.usedMiB = -1;
    expect(() => assertArchivedState(corrupt)).toThrow('Invalid archived');
    const missing = JSON.parse(JSON.stringify(backup));
    delete missing.simulationRuns[0].result.infrastructure;
    await expect(repo.restore(missing, 'merge')).rejects.toThrow('Invalid archived');
    expect((await repo.getGraph(graph.diagram.id)).simulation).toEqual(graph.simulation);
  });
  it('combines all four domains through actual flows and isolated intervention scenarios', () => {
    const model = new DatacenterCapacityExample().model();
    validateSimulationModel(model);
    const baseline = runSimulation(model, { durationSeconds: 120, seed: 42 });
    const upgraded = runSimulation(model, {
      durationSeconds: 120,
      seed: 42,
      scenarioId: 'balanced-upgrade',
    });
    expect(baseline.status).toBe('completed');
    expect(baseline.metrics.completed).toBeGreaterThan(0);
    expect(baseline.infrastructure!.bandwidth.wan.transferredBytes).toBeGreaterThan(0);
    expect(baseline.infrastructure!.cpu.cpu.completedWorkCoreSeconds).toBeGreaterThan(0);
    expect(baseline.infrastructure!.memory.ram.peakUsedMiB).toBeGreaterThan(0);
    expect(baseline.infrastructure!.energy.power.deliveredKWh).toBeGreaterThan(0);
    expect(upgraded.metrics.completed).toBeGreaterThan(baseline.metrics.completed);
    expect(upgraded.metrics.resourceCost).toBeGreaterThan(baseline.metrics.resourceCost);
    expect(model.resources.find((resource) => resource.id === 'cpu')!.capacity).toBe(2);
    validateGraph(new DatacenterCapacityExample().graph());
  });
});
