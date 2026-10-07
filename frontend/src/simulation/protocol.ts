import type { RunOptions, SimulationModel, SimulationResult, SimulationState } from './types';

export type SimulationSpeed = 1 | 10 | 100 | 'max';
export type ExecutionOptions = RunOptions & {
  durationSeconds: number;
  seed: number;
  speed?: SimulationSpeed;
  animated?: boolean;
  startPaused?: boolean;
};
export type WorkerCommand =
  | { kind: 'start'; model: SimulationModel; options: ExecutionOptions }
  | { kind: 'pause' | 'resume' | 'stop' }
  | { kind: 'speed'; speed: SimulationSpeed }
  | { kind: 'seek'; timeSeconds: number };
export type WorkerUpdate =
  | { kind: 'state'; state: SimulationState; result?: SimulationResult }
  | { kind: 'error'; message: string };
