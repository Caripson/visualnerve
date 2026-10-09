import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSimulation } from '../src/simulation/engine';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';
import { parallelModel } from './helpers/parallel-model';

let updates: WorkerUpdate[];
let scope: {
  postMessage: (value: WorkerUpdate) => void;
  onmessage?: (event: MessageEvent<WorkerCommand>) => void;
};
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  updates = [];
  scope = { postMessage: (value) => updates.push(structuredClone(value)) };
  vi.stubGlobal('self', scope);
  await import('../src/simulation/worker');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const send = (command: WorkerCommand) =>
  scope.onmessage!({ data: command } as MessageEvent<WorkerCommand>);
const state = () => {
  const update = [...updates].reverse().find((update) => update.kind === 'state');
  if (!update || update.kind !== 'state') throw new Error('Worker did not publish its state');
  return update;
};

describe('actual fork/join worker protocol', () => {
  it.each([1, 10, 100, 'max'] as const)(
    'shares deterministic results between speed %s and headless execution',
    async (speed) => {
      const model = parallelModel({
        durations: [0.1, 0.3, 0.2],
        travelSeconds: 0.1,
        particles: 3,
        resourceCapacity: 2,
      });
      const options = {
        durationSeconds: 10,
        seed: 12345,
        untilComplete: true,
        runId: 'worker-parity',
        speed,
        animated: true,
      };
      send({ kind: 'start', model, options });
      await vi.runAllTimersAsync();
      expect(updates.some((update) => update.kind === 'error')).toBe(false);
      expect(state().result).toEqual(runSimulation(model, options));
    },
  );
  it('freezes real waiting branches on pause and reconstructs them exactly on seek', async () => {
    const model = parallelModel({ durations: [0.1, 0.3] });
    const options = {
      durationSeconds: 10,
      seed: 42,
      untilComplete: true,
      runId: 'worker-seek',
      speed: 1 as const,
      animated: true,
    };
    send({ kind: 'start', model, options });
    await vi.advanceTimersByTimeAsync(150);
    send({ kind: 'pause' });
    const paused = state().state;
    expect(paused.status).toBe('paused');
    expect(paused.nodes.join.join).toMatchObject({
      waitingGroups: 1,
      arrivedBranches: 1,
      expectedBranches: 2,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(state().state).toEqual(paused);
    send({ kind: 'seek', timeSeconds: paused.timeSeconds });
    await vi.runAllTimersAsync();
    expect(state().state).toEqual(paused);
    send({ kind: 'resume' });
    await vi.runAllTimersAsync();
    expect(state().result).toEqual(runSimulation(model, options));
  });
  it('keeps stopped partial results inspectable without pretending waiting branches completed', async () => {
    const model = parallelModel({ durations: [0.1, 100] });
    send({
      kind: 'start',
      model,
      options: { durationSeconds: 200, seed: 42, animated: true, speed: 1 },
    });
    await vi.advanceTimersByTimeAsync(150);
    send({ kind: 'stop' });
    expect(state().result).toMatchObject({
      status: 'stopped',
      metrics: { created: 1, completed: 0, inSystem: 1, realizedRevenue: 0 },
      parallel: { activeGroups: 1, activeBranches: 2 },
    });
    const stopped = state();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state()).toEqual(stopped);
  });
});
