import type { RunOptions, SimulationModel, SimulationResult, SimulationState } from './types';

export interface SimulationModelRecord {
  diagramId: string;
  diagramVersion: number;
  model: SimulationModel;
}
/** A run retains its immutable assumptions even after its source document is edited. */
export interface SimulationRunRecord {
  id: string;
  diagramId: string;
  createdAt: string;
  updatedAt: string;
  status: SimulationState['status'];
  model: SimulationModel;
  options: RunOptions;
  result?: SimulationResult;
  error?: string;
}
export interface SimulationCheckpointRecord {
  id: string;
  runId: string;
  diagramId: string;
  timeSeconds: number;
  state: SimulationState;
}
