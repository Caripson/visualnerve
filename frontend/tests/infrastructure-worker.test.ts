import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApiComputeCapacityExample,
  NetworkMultiSiteCapacityExample,
} from '../src/simulation/infrastructure/examples';
import { runSimulation } from '../src/simulation/engine';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';

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
const latest = () => {
  const update = [...updates].reverse().find((entry) => entry.kind === 'state');
  if (!update || update.kind !== 'state') throw new Error('No worker state');
  return update;
};

it.each([1, 10, 100, 'max'] as const)(
  'actual infrastructure worker at speed%s matches headless numerical results',
  async (speed) => {
    const model = new ApiComputeCapacityExample().model();
    const source = model.nodes.find((node) => node.type === 'source')!;
    if (source.type === 'source')
      source.source = { particleTypeId: 'request', burst: 4, maxCount: 4 };
    const options = {
      durationSeconds: 2,
      seed: 42,
      runId: 'typed-worker-parity',
      animated: true,
      untilComplete: false,
      speed,
    };
    send({ kind: 'start', model, options });
    await vi.runAllTimersAsync();
    expect(updates.some((update) => update.kind === 'error')).toBe(false);
    expect(latest().result).toEqual(runSimulation(model, options));
  },
);
it('pause freezes fluid progress, seek reconstructs it and stop releases active leases/transfers', async () => {
  const model = new NetworkMultiSiteCapacityExample().model();
  send({
    kind: 'start',
    model,
    options: { durationSeconds: 20, seed: 42, animated: true, speed: 1, untilComplete: false },
  });
  await vi.advanceTimersByTimeAsync(1000);
  send({ kind: 'pause' });
  const paused = latest().state;
  expect(paused.particles.some((particle) => particle.transferProgress !== undefined)).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(latest().state).toEqual(paused);
  send({ kind: 'seek', timeSeconds: paused.timeSeconds });
  await vi.runAllTimersAsync();
  const replay = latest().state;
  for (let index = 0; index < paused.particles.length; index++) {
    const progress = paused.particles[index].transferProgress;
    if (progress !== undefined)
      expect(replay.particles[index].transferProgress).toBeCloseTo(progress, 12);
  }
  const withoutVisualProgress = (state: typeof paused) => ({
    ...state,
    particles: state.particles.map(({ transferProgress: _progress, ...particle }) => particle),
  });
  expect(withoutVisualProgress(replay)).toEqual(withoutVisualProgress(paused));
  send({ kind: 'stop' });
  const stopped = latest().result!;
  expect(stopped.status).toBe('stopped');
  expect(stopped.infrastructure!.bandwidth.backbone.activeTransfers).toBe(0);
  await vi.advanceTimersByTimeAsync(3000);
  expect(latest().result).toEqual(stopped);
});
