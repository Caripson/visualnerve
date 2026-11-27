import { expect, it } from 'vitest';
import { createBehaviorDemo } from '../src/behaviors/demo';
import { getBehaviorLibrary } from '../src/behaviors/document';
import { captureSimulationBehaviors } from '../src/simulation/behaviors';
import { runSimulation } from '../src/simulation/engine';
import { SimulationRunStore } from '../src/simulation/run-store';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

it('shares identities for removed model entities across merged history, Behavior runs and checkpoints', async () => {
  const db = new WorkspaceDatabase(`behavior-history-identity-${crypto.randomUUID()}`);
  try {
    await db.initialize();
    const repo = new Repository(db);
    const runs = new SimulationRunStore(db);
    const graph = await repo.saveGraph(createBehaviorDemo('behaviors-cashier'));
    const model = graph.simulation!;
    const originalWork = model.nodes.find(({ type }) => type === 'work')!;
    const snapshot = await repo.history.create(graph.diagram.id, {
      name: 'Before deleting the cashier',
      baseVersion: graph.diagram.version,
    });
    const options = { runId: 'original-cashier', behaviors: captureSimulationBehaviors(graph)! };
    const result = runSimulation(model, options);
    const timestamp = new Date().toISOString();
    await runs.put({
      id: result.runId,
      diagramId: graph.diagram.id,
      model,
      options,
      result,
      status: result.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await runs.putCheckpoint(result.runId, result.timeSeconds, result);
    await repo.request(`/api/v1/nodes/${originalWork.id}`, 'DELETE');
    const current = await repo.getGraph(graph.diagram.id);
    expect(current.nodes.some(({ id }) => id === originalWork.id)).toBe(false);
    expect(current.edges).toEqual([]);

    const [merged] = await repo.restore(JSON.parse(JSON.stringify(await db.backup())), 'merge');
    expect(merged.diagram.id).not.toBe(graph.diagram.id);
    expect(merged.nodes).toHaveLength(current.nodes.length);
    const [mergedSnapshot] = await repo.history.list(merged.diagram.id);
    const savedGraph = (await repo.history.read(merged.diagram.id, mergedSnapshot.id)).graph;
    const [archived] = await runs.list(merged.diagram.id);
    const [checkpoint] = await runs.checkpoints(archived.id);
    expect(mergedSnapshot.id).not.toBe(snapshot.id);
    const mergedWork = savedGraph.simulation!.nodes.find(({ type }) => type === 'work')!;
    expect(mergedWork.id).not.toBe(originalWork.id);
    expect(savedGraph.simulation).toEqual(archived.model);
    expect(savedGraph.simulation!.edges.map(({ id }) => id)).not.toEqual(
      model.edges.map(({ id }) => id),
    );
    expect(savedGraph.simulation!.resources).toEqual(model.resources);
    expect(getBehaviorLibrary(savedGraph).bindings[0]).toMatchObject({
      nodeId: mergedWork.id,
      parameters: { receiver: mergedWork.id },
    });
    expect(archived.options.behaviors?.bindings[0]).toMatchObject({
      nodeId: mergedWork.id,
      parameters: { receiver: mergedWork.id },
    });
    expect(archived.options.behaviors?.bindings[1]).toMatchObject({
      nodeId: mergedWork.id,
      parameters: { staffing: 'staff' },
    });
    const replay = runSimulation(archived.model, archived.options);
    expect(archived.result?.behaviorTrace).toEqual(replay.behaviorTrace);
    expect(checkpoint.state.behaviorTrace).toEqual(replay.behaviorTrace);
    expect(replay.behaviorTrace).toContainEqual(
      expect.objectContaining({
        kind: 'reserve',
        nodeId: mergedWork.id,
        resourceId: 'staff',
        decision: 'opened-and-allocated',
      }),
    );
    expect(replay.behaviorTrace).toContainEqual(
      expect.objectContaining({
        kind: 'send',
        nodeId: mergedWork.id,
        targetNodeId: mergedWork.id,
      }),
    );

    const restored = await repo.history.restore(merged.diagram.id, mergedSnapshot.id, {
      baseVersion: merged.diagram.version,
    });
    expect(restored.graph.simulation).toEqual(archived.model);
    expect((await runs.get(result.runId))?.model).toEqual(model);
  } finally {
    await db.delete();
  }
});
