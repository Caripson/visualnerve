import type { WorkspaceStoreName } from '../storage/contracts';

/** Shared field boundaries allow ordinary edits to reuse large immutable payload chunks. */
export const workspacePayloadFields: Partial<Record<WorkspaceStoreName, readonly string[]>> = {
  datasets: ['rows'],
  historyRows: ['rows'],
  historyContents: ['graph'],
  simulationModels: ['model'],
  simulationRuns: ['model', 'result'],
  simulationCheckpoints: ['state'],
  templates: ['graph'],
};
