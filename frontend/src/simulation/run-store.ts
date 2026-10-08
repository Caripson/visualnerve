import type { WorkspaceDatabase } from '../storage/database';
import { asWorkspaceStorage } from '../storage/adapter';
import { workspaceStorage } from '../storage/runtime';
import type { WorkspaceStorage } from '../storage/contracts';
import { StorageError } from '../model/errors';
import type { SimulationState } from './types';
import type { SimulationRunRecord } from './storage';

export const simulationRetentionLimits = { runsPerDiagram: 30, checkpointsPerRun: 240 };

/** Bounded local run archives. Simulation correctness never depends on archived frames. */
export class SimulationRunStore {
  public db: WorkspaceStorage;
  constructor(input: WorkspaceStorage | WorkspaceDatabase = workspaceStorage) {
    this.db = asWorkspaceStorage(input);
  }
  async put(run: SimulationRunRecord, beforeWrite?: (scope: WorkspaceStorage) => Promise<void>) {
    if (!run.id || !run.diagramId || !Number.isFinite(Date.parse(run.createdAt)))
      throw new StorageError(422, 'A simulation run needs an id, diagram and creation time.');
    return this.db.atomic(
      'rw',
      [
        'diagrams',
        'simulationRuns',
        'simulationCheckpoints',
        ...(beforeWrite ? ['settings' as const] : []),
      ],
      async (scope) => {
        const store = new SimulationRunStore(scope);
        if (!(await scope.diagrams.get(run.diagramId)))
          throw new StorageError(404, 'Simulation document does not exist.');
        const previous = await scope.simulationRuns.get(run.id);
        if (previous && previous.diagramId !== run.diagramId)
          throw new StorageError(409, 'Simulation run id belongs to another document.');
        await beforeWrite?.(scope);
        await scope.simulationRuns.put(structuredClone(run));
        const runs = await store.list(run.diagramId);
        for (const old of runs.slice(simulationRetentionLimits.runsPerDiagram))
          await store.delete(old.id);
        return run;
      },
    );
  }
  async get(id: string) {
    const run = await this.db.simulationRuns.get(id);
    if (!run) throw new StorageError(404, 'Simulation run does not exist.');
    return run;
  }
  async list(diagramId: string) {
    const runs = await this.db.simulationRuns.where('diagramId').equals(diagramId).toArray();
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  async delete(id: string) {
    await this.db.atomic('rw', ['simulationRuns', 'simulationCheckpoints'], async (scope) => {
      await scope.simulationRuns.delete(id);
      await scope.simulationCheckpoints.where('runId').equals(id).delete();
    });
  }
  async putCheckpoint(runId: string, timeSeconds: number, state: SimulationState) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || state.timeSeconds !== timeSeconds)
      throw new StorageError(422, 'Checkpoint time must match its simulated state.');
    return this.db.atomic('rw', ['simulationRuns', 'simulationCheckpoints'], async (scope) => {
      const store = new SimulationRunStore(scope);
      const run = await store.get(runId);
      const limit = Math.min(
        run.model.retention?.checkpoints ?? simulationRetentionLimits.checkpointsPerRun,
        simulationRetentionLimits.checkpointsPerRun,
      );
      if (limit === 0) {
        await scope.simulationCheckpoints.where('runId').equals(runId).delete();
        return;
      }
      const checkpoint = {
        id: `${runId}:${timeSeconds}`,
        runId,
        diagramId: run.diagramId,
        timeSeconds,
        state: structuredClone(state),
      };
      await scope.simulationCheckpoints.put(checkpoint);
      let checkpoints = await store.checkpoints(runId);
      if (limit === 1) {
        await scope.simulationCheckpoints.bulkDelete(
          checkpoints.slice(0, -1).map((entry) => entry.id),
        );
        return checkpoint;
      }
      while (checkpoints.length > limit) {
        // Retain endpoints and thin older interior states evenly for useful long-run replay.
        const remove = checkpoints.filter(
          (_, index) => index > 0 && index < checkpoints.length - 1 && index % 2 === 1,
        );
        await scope.simulationCheckpoints.bulkDelete(remove.map((entry) => entry.id));
        const removed = new Set(remove.map((entry) => entry.id));
        checkpoints = checkpoints.filter((entry) => !removed.has(entry.id));
      }
      return checkpoint;
    });
  }
  async checkpoints(runId: string) {
    const states = await this.db.simulationCheckpoints.where('runId').equals(runId).toArray();
    return states.sort((a, b) => a.timeSeconds - b.timeSeconds);
  }
  async deleteDiagram(diagramId: string) {
    await this.db.atomic('rw', ['simulationRuns', 'simulationCheckpoints'], async (scope) => {
      await scope.simulationRuns.where('diagramId').equals(diagramId).delete();
      await scope.simulationCheckpoints.where('diagramId').equals(diagramId).delete();
    });
  }
}
