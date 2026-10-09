import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSimulationGraph, reconcileSimulationGraph } from '../src/simulation/document';
import { remapSimulationModel } from '../src/simulation/copy';
import { removeSimulationEntity } from '../src/simulation/deletion';
import { copySimulationSelection, pasteSimulationSelection } from '../src/simulation/clipboard';
import { simulationTopologyCompatible } from '../src/simulation/topology';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { validateGraph } from '../src/model/validation';
import { validateSimulationModel, resolveScenario } from '../src/simulation/schema';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';
import { SimulationRunStore } from '../src/simulation/run-store';
import { indexSimulationParticleView } from '../src/simulation/particle-view';
import { buildSimulationParticleScene } from '../src/simulation/particle-scene';
import { SimulationPresentationSlots } from '../src/simulation/presentation-slots';
import type { SimulationState } from '../src/simulation/types';
import { parallelModel } from './helpers/parallel-model';

let database: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  database = new WorkspaceDatabase(`parallel-doc-${crypto.randomUUID()}`);
  await database.initialize();
  repo = new Repository(database);
});
afterEach(async () => database.delete());

describe('parallel document persistence, copy and semantic identity', () => {
  it('maps readable fork, join and branch references to native IDs and persists them with one model', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Parallel project', parallelModel()),
    );
    validateGraph(graph);
    const fork = graph.simulation!.nodes.find((node) => node.type === 'fork')!;
    const join = graph.simulation!.nodes.find((node) => node.type === 'join')!;
    expect(fork.type === 'fork' && fork.fork.joinNodeId).toBe(join.id);
    expect(join.type === 'join' && join.join.forkNodeId).toBe(fork.id);
    expect(fork.type === 'fork' && fork.fork.branchEdgeIds).toEqual(
      graph
        .simulation!.edges.filter((edge) => edge.sourceNodeId === fork.id)
        .map((edge) => edge.id),
    );
    database.close();
    await database.open();
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    expect(await repo.request(`/diagrams/${graph.diagram.id}/simulation`)).toEqual(
      graph.simulation,
    );
    expect(
      runSimulation((await repo.getGraph(graph.diagram.id)).simulation!, { untilComplete: true })
        .metrics.completed,
    ).toBe(1);
  });
  it('remaps fork/join references in isolated scenario overrides as well as the base model', () => {
    const model = parallelModel();
    model.scenarios = [
      {
        id: 'a',
        name: 'A',
        overrides: {
          nodes: {
            fork: { fork: { joinNodeId: 'join', branchEdgeIds: ['branch-1', 'branch-0'] } },
            join: { join: { forkNodeId: 'fork' } },
            'work-0': { work: { capacity: 5 } },
          },
        },
      },
    ];
    const nodeIds = new Map(model.nodes.map((node) => [node.id, crypto.randomUUID()]));
    const edgeIds = new Map(model.edges.map((edge) => [edge.id, crypto.randomUUID()]));
    const mapped = remapSimulationModel(model, nodeIds, edgeIds);
    validateSimulationModel(mapped);
    const overridden = resolveScenario(mapped, 'a');
    const fork = overridden.nodes.find((node) => node.id === nodeIds.get('fork'))!;
    const join = overridden.nodes.find((node) => node.id === nodeIds.get('join'))!;
    expect(fork).toMatchObject({
      fork: {
        joinNodeId: join.id,
        branchEdgeIds: [edgeIds.get('branch-1'), edgeIds.get('branch-0')],
      },
    });
    expect(join).toMatchObject({ join: { forkNodeId: fork.id } });
    expect(mapped.nodes.find((node) => node.id === nodeIds.get('work-0'))).toMatchObject({
      work: { capacity: 1 },
    });
    expect(overridden.nodes.find((node) => node.id === nodeIds.get('work-0'))).toMatchObject({
      work: { capacity: 5 },
    });
    expect(simulationTopologyCompatible(mapped, overridden)).toBe(false);
  });
  it('copies an entire parallel process into a second document with correctly paired identities', () => {
    const source = createSimulationGraph('Source', parallelModel());
    const target = createSimulationGraph('Target', parallelModel());
    const clip = copySimulationSelection(source, new Set(source.nodes.map((node) => node.id)))!;
    const nodes = new Map(clip.model.nodes.map((node) => [node.id, crypto.randomUUID()]));
    const edges = new Map(clip.model.edges.map((edge) => [edge.id, crypto.randomUUID()]));
    const copied = pasteSimulationSelection(clip, target, nodes, edges)!;
    validateSimulationModel(copied);
    expect(copied.nodes.filter((node) => node.type === 'fork')).toHaveLength(2);
    expect(runSimulation(copied, { untilComplete: true }).metrics).toMatchObject({
      created: 2,
      completed: 2,
      realizedRevenue: 200,
    });
  });
  it.each(['fork', 'join'])(
    'rejects deleting one %s without corrupting its pair or persisted version',
    async (kind) => {
      const original = await repo.importGraph(
        createSimulationGraph('Protected pair', parallelModel()),
      );
      const node = original.simulation!.nodes.find((candidate) => candidate.type === kind)!;
      expect(() => removeSimulationEntity(original.simulation!, 'nodes', node.id)).toThrow(
        /complete parallel/,
      );
      expect(() =>
        reconcileSimulationGraph(original, {
          ...original,
          nodes: original.nodes.filter((candidate) => candidate.id !== node.id),
          edges: original.edges.filter(
            (edge) => edge.sourceNodeId !== node.id && edge.targetNodeId !== node.id,
          ),
        }),
      ).toThrow(/parallel fork/);
      await expect(
        repo.request(
          `/nodes/${node.id}?version=${original.nodes.find((candidate) => candidate.id === node.id)!.version}`,
          'DELETE',
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(await repo.getGraph(original.diagram.id)).toEqual(original);
    },
  );
  it('rejects removing a mandatory branch edge alone without changing any saved data', async () => {
    const original = await repo.importGraph(
      createSimulationGraph('Protected branch', parallelModel()),
    );
    const fork = original.simulation!.nodes.find((node) => node.type === 'fork')!;
    if (fork.type !== 'fork') throw new Error('Missing fork');
    const branch = original.edges.find((edge) => edge.id === fork.fork.branchEdgeIds[0])!;
    await expect(
      repo.request(`/edges/${branch.id}?version=${branch.version}`, 'DELETE'),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
  });
  it('renders real arrived tokens at the join and actual transit along only valid branch edges', () => {
    const graph = createSimulationGraph(
      'Actual branch canvas',
      parallelModel({ travelSeconds: 1 }),
    );
    const engine = new SimulationEngine(graph.simulation!, { untilComplete: true });
    engine.advance(0.5);
    const slots = new SimulationPresentationSlots();
    const view = indexSimulationParticleView(graph);
    const moving = buildSimulationParticleScene(view, graph.simulation!, engine.state(), slots);
    expect(moving.transit).toHaveLength(2);
    expect(
      moving.transit.every(({ edge }) =>
        graph.simulation!.edges.some((candidate) => candidate.id === edge.id),
      ),
    ).toBe(true);
    engine.advance(8);
    const waiting = buildSimulationParticleScene(view, graph.simulation!, engine.state(), slots);
    expect(waiting.queues).toHaveLength(1);
    expect(waiting.queues[0].particle.status).toBe('waiting');
    expect(waiting.queues[0].particle.parentParticleId).toBeDefined();
    expect(waiting.queues[0].node.id).toBe(
      graph.simulation!.nodes.find((node) => node.type === 'join')!.id,
    );
  });
  it('renders a representative real child stream for 500 cases without materializing every work token', () => {
    const model = parallelModel({ particles: 500, durations: [1, 2, 3], travelSeconds: 1 });
    model.retention = { particles: 5, events: 10 };
    const graph = createSimulationGraph('Large child stream', model);
    const engine = new SimulationEngine(graph.simulation!, { untilComplete: true });
    engine.advance(0.5);
    const state = engine.state();
    const scene = buildSimulationParticleScene(
      indexSimulationParticleView(graph),
      graph.simulation!,
      state,
      new SimulationPresentationSlots(),
    );
    expect(state.metrics.inSystem).toBe(500);
    expect(state.retained.activeParticles).toBe(2000);
    expect(state.particles).toHaveLength(5);
    expect(scene.transit).toHaveLength(5);
    expect(
      scene.transit.every(
        ({ particle, edge }) =>
          particle.parentParticleId !== undefined &&
          graph.simulation!.edges.some((candidate) => candidate.id === edge.id),
      ),
    ).toBe(true);
  });
  it('roundtrips typed archive events and live checkpoints with every fork/join reference remapped', async () => {
    const graph = await repo.importGraph(
      createSimulationGraph('Archived parallel delivery', parallelModel()),
    );
    const options = { untilComplete: true, durationSeconds: 60, seed: 42, runId: 'parallel-run' };
    const engine = new SimulationEngine(graph.simulation!, options);
    engine.advance(6);
    const checkpoint = engine.state();
    engine.advance(60);
    const result = engine.result();
    const store = new SimulationRunStore(database),
      timestamp = new Date().toISOString();
    await store.put({
      id: result.runId,
      diagramId: graph.diagram.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: result.status,
      model: graph.simulation!,
      options,
      result,
    });
    await store.putCheckpoint(result.runId, checkpoint.timeSeconds, checkpoint);
    const backup = JSON.parse(JSON.stringify(await database.backup()));
    const [restored] = await repo.restore(backup, 'merge');
    const [archive] = await store.list(restored.diagram.id);
    const nodeIds = new Set(archive.model.nodes.map((node) => node.id));
    const edgeIds = new Set(archive.model.edges.map((edge) => edge.id));
    const assertReferences = (state: SimulationState) => {
      for (const particle of state.particles) {
        if (particle.forkNodeId) expect(nodeIds.has(particle.forkNodeId)).toBe(true);
        if (particle.joinNodeId) expect(nodeIds.has(particle.joinNodeId)).toBe(true);
        if (particle.branchEdgeId) expect(edgeIds.has(particle.branchEdgeId)).toBe(true);
      }
      for (const event of state.events) {
        if (event.forkNodeId) expect(nodeIds.has(event.forkNodeId)).toBe(true);
        if (event.joinNodeId) expect(nodeIds.has(event.joinNodeId)).toBe(true);
        if (event.branchEdgeId) expect(edgeIds.has(event.branchEdgeId)).toBe(true);
      }
      for (const group of state.parallel?.groups ?? []) {
        expect(nodeIds.has(group.forkNodeId)).toBe(true);
        expect(nodeIds.has(group.joinNodeId)).toBe(true);
        for (const edge of [...group.arrivedBranchEdgeIds, ...group.pendingBranchEdgeIds])
          expect(edgeIds.has(edge)).toBe(true);
      }
    };
    assertReferences(archive.result!);
    const [restoredCheckpoint] = await store.checkpoints(archive.id);
    assertReferences(restoredCheckpoint.state);
    expect(restoredCheckpoint.state.parallel).toMatchObject({ activeGroups: 1, activeBranches: 2 });
    const rerun = runSimulation(archive.model, archive.options);
    expect(rerun.metrics).toEqual(archive.result!.metrics);
    expect(rerun.parallel).toEqual(archive.result!.parallel);
    expect(rerun.events).toEqual(archive.result!.events);
  });
});
