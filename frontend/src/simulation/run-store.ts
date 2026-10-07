import { database, type WorkspaceDatabase } from '../storage/database';
import { StorageError } from '../model/errors';
import type { SimulationState } from './types';
import type { SimulationRunRecord } from './storage';

export const simulationRetentionLimits = { runsPerDiagram: 30, checkpointsPerRun: 240 };

/** Bounded local run archives. Simulation correctness never depends on archived frames. */
export class SimulationRunStore {
  constructor(public db: WorkspaceDatabase = database) {}
  async put(run: SimulationRunRecord) {
    if (!run.id || !run.diagramId || !Number.isFinite(Date.parse(run.createdAt)))
      throw new StorageError(422, 'A simulation run needs an id, diagram and creation time.');
    return this.db.transaction(
      'rw',
      this.db.diagrams,
      this.db.simulationRuns,
      this.db.simulationCheckpoints,
      async () => {
        if (!(await this.db.diagrams.get(run.diagramId)))
          throw new StorageError(404, 'Simulation document does not exist.');
        const previous = await this.db.simulationRuns.get(run.id);
        if (previous && previous.diagramId !== run.diagramId)
          throw new StorageError(409, 'Simulation run id belongs to another document.');
        await this.db.simulationRuns.put(structuredClone(run));
        const runs = await this.list(run.diagramId);
        for (const old of runs.slice(simulationRetentionLimits.runsPerDiagram))
          await this.delete(old.id);
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
    await this.db.transaction(
      'rw',
      this.db.simulationRuns,
      this.db.simulationCheckpoints,
      async () => {
        await this.db.simulationRuns.delete(id);
        await this.db.simulationCheckpoints.where('runId').equals(id).delete();
      },
    );
  }
  async putCheckpoint(runId: string, timeSeconds: number, state: SimulationState) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || state.timeSeconds !== timeSeconds)
      throw new StorageError(422, 'Checkpoint time must match its simulated state.');
    return this.db.transaction(
      'rw',
      this.db.simulationRuns,
      this.db.simulationCheckpoints,
      async () => {
        const run = await this.get(runId);
        const limit = Math.min(
          run.model.retention?.checkpoints ?? simulationRetentionLimits.checkpointsPerRun,
          simulationRetentionLimits.checkpointsPerRun,
        );
        if (limit === 0) {
          await this.db.simulationCheckpoints.where('runId').equals(runId).delete();
          return;
        }
        const checkpoint = {
          id: `${runId}:${timeSeconds}`,
          runId,
          diagramId: run.diagramId,
          timeSeconds,
          state: structuredClone(state),
        };
        await this.db.simulationCheckpoints.put(checkpoint);
        let checkpoints = await this.checkpoints(runId);
        if (limit === 1) {
          await this.db.simulationCheckpoints.bulkDelete(
            checkpoints.slice(0, -1).map((entry) => entry.id),
          );
          return checkpoint;
        }
        while (checkpoints.length > limit) {
          // Retain endpoints and thin older interior states evenly for useful long-run replay.
          const remove = checkpoints.filter(
            (_, index) => index > 0 && index < checkpoints.length - 1 && index % 2 === 1,
          );
          await this.db.simulationCheckpoints.bulkDelete(remove.map((entry) => entry.id));
          const removed = new Set(remove.map((entry) => entry.id));
          checkpoints = checkpoints.filter((entry) => !removed.has(entry.id));
        }
        return checkpoint;
      },
    );
  }
  async checkpoints(runId: string) {
    const states = await this.db.simulationCheckpoints.where('runId').equals(runId).toArray();
    return states.sort((a, b) => a.timeSeconds - b.timeSeconds);
  }
  async deleteDiagram(diagramId: string) {
    await this.db.transaction(
      'rw',
      this.db.simulationRuns,
      this.db.simulationCheckpoints,
      async () => {
        await this.db.simulationRuns.where('diagramId').equals(diagramId).delete();
        await this.db.simulationCheckpoints.where('diagramId').equals(diagramId).delete();
      },
    );
  }
}
