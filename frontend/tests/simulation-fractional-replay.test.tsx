import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { blankGraph } from '../src/model/types';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import { SimulationService, simulationService } from '../src/simulation/service';
import { SimulationResults } from '../src/simulation/SimulationResults';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';
import type { SimulationModel } from '../src/simulation/types';

/** Real DES timestamps exercise the UI -> shared service -> worker replay path. */
class FractionalWorker {
  onmessage?: (event: MessageEvent<WorkerUpdate>) => void;
  engine?: SimulationEngine;
  terminated = false;
  emit(update: WorkerUpdate) {
    if (!this.terminated)
      this.onmessage?.({ data: structuredClone(update) } as MessageEvent<WorkerUpdate>);
  }
  postMessage(command: WorkerCommand) {
    if (command.kind === 'start') {
      this.engine = new SimulationEngine(command.model, command.options);
      queueMicrotask(() => {
        if (command.options.startPaused)
          this.emit({ kind: 'state', state: { ...this.engine!.state(), status: 'paused' } });
        else {
          this.engine!.advance(command.options.durationSeconds);
          this.emit({ kind: 'state', state: this.engine!.state(), result: this.engine!.result() });
        }
      });
    } else if (command.kind === 'seek') {
      this.engine!.advance(command.timeSeconds, Infinity, true);
      queueMicrotask(() => {
        const state = this.engine!.state();
        if (state.status === 'running' || state.status === 'ready') state.status = 'paused';
        this.emit({ kind: 'state', state });
      });
    }
  }
  terminate() {
    this.terminated = true;
  }
}

let db: WorkspaceDatabase, service: SimulationService, model: SimulationModel, diagramId: string;
beforeEach(async () => {
  vi.stubGlobal('Worker', FractionalWorker);
  db = new WorkspaceDatabase(`fractional-replay-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  const graph = blankGraph('Fractional replay', 'process-simulator');
  diagramId = graph.diagram.id;
  await db.diagrams.put(graph.diagram);
  model = createBasicModel({ particles: 1, processingSeconds: 0.35 });
  model.edges.forEach((edge) => (edge.travelSeconds = 0.125));
  service = new SimulationService(db);
  vi.spyOn(simulationService, 'seek').mockImplementation((id, time, options) =>
    service.seek(id, time, options),
  );
});
afterEach(async () => {
  cleanup();
  service.dispose();
  await db.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function completed(durationSeconds: number) {
  const started = await service.start(diagramId, model, {
    durationSeconds,
    seed: 42,
    animated: false,
  });
  await waitFor(() => expect(service.view(started.id)?.run.status).toBe('completed'));
  return service.get(started.id);
}
const perform = async (action: () => Promise<unknown>) => {
  await action();
};

describe('fractional replay controls', () => {
  it('accepts fractional seconds and reconstructs the exact timestamp through the shared service', async () => {
    const run = await completed(0.675);
    const original = await service.result(run.id);
    const history = await service.list(diagramId);
    render(
      <SimulationResults
        model={model}
        view={{ run, state: original }}
        runs={history}
        busy={false}
        perform={perform}
      />,
    );
    const slider = screen.getByLabelText('Replay simulated time') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.425' } });
    expect(slider.valueAsNumber).toBe(0.425);
    expect(slider.validity.valid).toBe(true);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Inspect this moment' })),
    );
    await waitFor(() => expect(service.view(run.id)?.replayTimeSeconds).toBe(0.425));
    expect(simulationService.seek).toHaveBeenCalledWith(run.id, 0.425);
    const replay = await service.state(run.id);
    expect(replay.timeSeconds).toBe(0.425);
    expect(replay.nodes.work.busy).toBe(1);
    expect(replay.metrics.completed).toBe(0);
    expect(original.metrics.completed).toBe(1);
    expect(await service.result(run.id)).toEqual(original);
  });

  it('uses the visible bounded fractional time when switching from a longer run', async () => {
    const long = await completed(600);
    const short = await completed(0.675);
    const original = await service.result(short.id);
    const history = await service.list(diagramId);
    const props = { model, runs: history, busy: false, perform };
    const rendered = render(
      <SimulationResults {...props} view={{ run: long, state: long.result }} />,
    );
    const slider = screen.getByLabelText('Replay simulated time') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '300' } });
    expect(slider.valueAsNumber).toBe(300);
    rendered.rerender(<SimulationResults {...props} view={{ run: short, state: original }} />);
    expect(slider.valueAsNumber).toBe(0.675);
    expect(slider.validity.valid).toBe(true);
    expect(screen.getByText('0h 0m 0s')).toBeInTheDocument();
    expect(screen.queryByText('0h 5m 0s')).not.toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Inspect this moment' })),
    );
    await waitFor(() => expect(service.view(short.id)?.replayTimeSeconds).toBe(0.675));
    expect(simulationService.seek).toHaveBeenCalledWith(short.id, 0.675);
    expect((await service.state(short.id)).timeSeconds).toBe(0.675);
    expect(await service.result(short.id)).toEqual(original);
    // Invalid programmatic timestamps still return an error; only the UI selection is bounded.
    await expect(service.seek(short.id, 300)).rejects.toMatchObject({ status: 422 });
  });
});
