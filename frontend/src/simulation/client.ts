import type { ExecutionOptions, WorkerCommand, WorkerUpdate } from './protocol';
import type { SimulationModel } from './types';

export class SimulationClient {
  private worker: Worker;
  constructor(
    model: SimulationModel,
    options: ExecutionOptions,
    update: (value: WorkerUpdate) => void,
  ) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerUpdate>) => update(event.data);
    this.worker.onerror = (event) =>
      update({ kind: 'error', message: event.message || 'Simulation worker failed.' });
    try {
      this.send({ kind: 'start', model, options });
    } catch (error) {
      this.worker.terminate();
      throw error;
    }
  }
  send(command: WorkerCommand) {
    this.worker.postMessage(command);
  }
  dispose() {
    this.worker.terminate();
  }
}
