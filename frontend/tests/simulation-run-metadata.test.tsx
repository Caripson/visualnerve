import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceDatabase } from '../src/storage/database';
import { blankGraph } from '../src/model/types';
import { SimulationService, simulationService } from '../src/simulation/service';
import { SimulationResults } from '../src/simulation/SimulationResults';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';
import type { SimulationModel } from '../src/simulation/types';

class MetadataWorker {
  static instances: MetadataWorker[] = [];
  onmessage?: (event: MessageEvent<WorkerUpdate>) => void;
  engine?: SimulationEngine;
  terminated = false;
  constructor() {
    MetadataWorker.instances.push(this);
  }
  postMessage(command: WorkerCommand) {
    if (command.kind === 'start')
      this.engine = new SimulationEngine(command.model, command.options);
  }
  finish() {
    this.engine!.advance(this.engine!.options.durationSeconds);
    this.onmessage?.({
      data: structuredClone({
        kind: 'state',
        state: this.engine!.state(),
        result: this.engine!.result(),
      }),
    } as MessageEvent<WorkerUpdate>);
  }
  terminate() {
    this.terminated = true;
  }
}

let db: WorkspaceDatabase, service: SimulationService, model: SimulationModel, diagramId: string;
beforeEach(async () => {
  MetadataWorker.instances = [];
  vi.stubGlobal('Worker', MetadataWorker);
  db = new WorkspaceDatabase(`simulation-metadata-${crypto.randomUUID()}`);
  await db.open();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  const graph = blankGraph('Immutable run metadata', 'process-simulator');
  await db.diagrams.put(graph.diagram);
  diagramId = graph.diagram.id;
  model = createBasicModel({ particles: 1 });
  model.scenarios = [{ id: 'a', name: 'Original scenario', overrides: {} }];
  service = new SimulationService(db);
});
afterEach(async () => {
  service.dispose();
  await db.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function complete(scenarioId?: string) {
  const run = await service.start(diagramId, model, { scenarioId, animated: false });
  MetadataWorker.instances.at(-1)!.finish();
  await service.result(run.id);
  return run;
}

const perform = async (action: () => Promise<unknown>) => {
  await action();
};

describe('captured simulation run labels and economics', () => {
  it.each(['live', 'reopened'] as const)(
    'keeps %s run metadata and compact labels after the current scenario/currency change',
    async (source) => {
      const run = await complete('a');
      model.scenarios = [];
      model.currency = 'EUR';
      if (source === 'reopened') {
        service.dispose();
        service = new SimulationService(db);
      }
      const runs = await service.list(diagramId);
      expect(runs[0]).toMatchObject({
        id: run.id,
        scenarioName: 'Original scenario',
        currency: 'SEK',
        metrics: { realizedRevenue: 100 },
      });
      render(
        <SimulationResults model={model} runs={runs} busy={false} perform={perform} compact />,
      );
      expect(screen.getByRole('option', { name: /Original scenario/ })).toBeInTheDocument();
      expect(screen.getByText('Original scenario')).toBeInTheDocument();
      expect(screen.getAllByText('100.00 SEK')).toHaveLength(2);
      expect(screen.queryByText(/EUR/)).not.toBeInTheDocument();
    },
  );

  it('rejects mixing captured currencies with a structured error and preserves both results', async () => {
    const baseline = await complete();
    model.currency = 'EUR';
    const alternative = await complete('a');
    const before = await service.result(baseline.id);
    await expect(service.compare([baseline.id, alternative.id])).rejects.toMatchObject({
      status: 422,
      code: 'SIMULATION_CURRENCY_MISMATCH',
      issues: [{ path: 'runIds', code: 'SIMULATION_CURRENCY_MISMATCH' }],
    });
    expect(await service.result(baseline.id)).toEqual(before);
    expect((await service.result(alternative.id)).metrics.realizedRevenue).toBe(100);
  });

  it('labels desktop history and comparison with the captured currency after document edits', async () => {
    const baseline = await complete();
    const alternative = await complete('a');
    model.currency = 'EUR';
    model.scenarios[0].name = 'Renamed scenario';
    const runs = await service.list(diagramId);
    const result = await service.compare([baseline.id, alternative.id]);
    expect(result.currency).toBe('SEK');
    expect(result.comparisons[0].delta.contribution).toBe(0);
    const compare = vi.spyOn(simulationService, 'compare').mockResolvedValue(result);
    render(<SimulationResults model={model} runs={runs} busy={false} perform={perform} />);
    expect(screen.getByRole('cell', { name: /Original scenario.*SEK/ })).toBeInTheDocument();
    expect(screen.queryByText(/Renamed scenario/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(`Compare run ${baseline.id}`));
    fireEvent.click(screen.getByLabelText(`Compare run ${alternative.id}`));
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected runs' }));
    expect(await screen.findByText(/contribution change 0.00 SEK/)).toBeInTheDocument();
    expect(compare).toHaveBeenCalledWith([baseline.id, alternative.id]);
    expect(screen.queryByText(/EUR/)).not.toBeInTheDocument();
  });
});
