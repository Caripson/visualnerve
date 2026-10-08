import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import type { SimulationState } from '../src/simulation/types';

let db: WorkspaceDatabase, repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`simulation-backup-identities-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
});
afterEach(async () => {
  await db.delete();
});

describe('archived simulation identity round trips', () => {
  it('remaps edge-based route metrics, transit and history without changing captured results', async () => {
    const model = createBasicModel({ particles: 3, processingSeconds: 10 });
    model.edges.forEach((edge) => (edge.travelSeconds = 10));
    const graph = await repo.importGraph(createSimulationGraph('Route identity regression', model));
    const options = { durationSeconds: 120, seed: 42, runId: 'captured-run' };
    const result = runSimulation(graph.simulation!, options);
    const engine = new SimulationEngine(graph.simulation!, options);
    engine.advance(5);
    const transit = engine.state();
    expect(transit.particles).toHaveLength(3);
    expect(transit.particles.every((particle) => particle.status === 'transit')).toBe(true);
    expect(Object.values(result.routeMetrics)[0].count).toBe(3);

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
    await store.putCheckpoint(result.runId, transit.timeSeconds, transit);
    await store.putCheckpoint(result.runId, result.timeSeconds, result);
    const backup = JSON.parse(JSON.stringify(await db.backup()));
    const [restored] = await repo.restore(backup, 'merge');
    const [archived] = await store.list(restored.diagram.id);
    const restoredResult = archived.result!;
    const restoredNodeIds = new Set(archived.model.nodes.map((node) => node.id));
    const restoredEdgeIds = new Set(archived.model.edges.map((edge) => edge.id));
    const originalEdgeIds = new Set(graph.simulation!.edges.map((edge) => edge.id));
    const assertReferences = (state: SimulationState) => {
      for (const particle of state.particles) {
        expect(restoredNodeIds.has(particle.nodeId)).toBe(true);
        if (particle.edgeId) expect(restoredEdgeIds.has(particle.edgeId)).toBe(true);
        for (const visit of particle.history) expect(restoredNodeIds.has(visit.nodeId)).toBe(true);
      }
      for (const event of state.events) {
        if (event.nodeId) expect(restoredNodeIds.has(event.nodeId)).toBe(true);
        if (event.edgeId) expect(restoredEdgeIds.has(event.edgeId)).toBe(true);
      }
    };
    assertReferences(restoredResult);
    const checkpoints = await store.checkpoints(archived.id);
    expect(checkpoints.map((checkpoint) => checkpoint.timeSeconds)).toEqual([5, 120]);
    checkpoints.forEach((checkpoint) => assertReferences(checkpoint.state));
    expect(checkpoints[0].state.particles.map((particle) => particle.status)).toEqual(
      transit.particles.map((particle) => particle.status),
    );

    for (const route of Object.keys(restoredResult.routeMetrics))
      for (const edgeId of route.split(' → ')) {
        expect(restoredEdgeIds.has(edgeId)).toBe(true);
        expect(originalEdgeIds.has(edgeId)).toBe(false);
      }
    const replayed = runSimulation(archived.model, archived.options);
    expect(restoredResult.routeMetrics).toEqual(replayed.routeMetrics);
    expect(Object.values(restoredResult.routeMetrics)).toEqual(Object.values(result.routeMetrics));
    expect(restoredResult.cashTimeline).toEqual(result.cashTimeline);
    expect(restoredResult.particleTypes).toEqual(result.particleTypes);
    expect(restoredResult.metrics).toEqual({
      ...result.metrics,
      currentBottleneck: archived.model.nodes.find((node) => node.type === 'work')!.id,
    });
    expect((await store.get(result.runId)).result).toEqual(result);
  });
});
