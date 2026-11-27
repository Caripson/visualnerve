import { describe, expect, it, vi } from 'vitest';
import { SimulationEngine, runSimulation } from '../src/simulation/engine';
import { createBasicModel } from '../src/simulation/examples';
import { remapSimulationBehaviors } from '../src/simulation/behaviors';
import { createSimulationGraph } from '../src/simulation/document';
import { SimulationRunStore } from '../src/simulation/run-store';
import { SimulationService } from '../src/simulation/service';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { simulationCommand } from '../src/storage/simulation-commands';
import type {
  SimulationBehaviorSnapshot,
  SimulationModel,
  SimulationState,
} from '../src/simulation/types';
import type { ExecutionOptions, WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';

const thresholdSource = `parameter threshold as number = 15
parameter receiver as node

on queueChanged
  if queue.previousLength <= threshold and queue.length > threshold then
    send "öppna" to node receiver
  end if
end`;
const reserveSource = `parameter staffing as resource

on "öppna"
  open reserve slot using resource staffing
end`;
const definitions = [
  { id: 'threshold', name: 'Kötröskel', version: 1 as const, source: thresholdSource },
  { id: 'reserve', name: 'Öppna reservkassa', version: 1 as const, source: reserveSource },
];

function behaviors(receiver = 'work'): SimulationBehaviorSnapshot {
  return {
    definitions: structuredClone(definitions),
    bindings: [
      { id: 'watch', definitionId: 'threshold', nodeId: 'work', parameters: { receiver } },
      {
        id: 'reserve',
        definitionId: 'reserve',
        nodeId: receiver,
        parameters: { staffing: 'staff' },
      },
    ],
  };
}

function model(particles = 17, staff = 2) {
  const value = createBasicModel({ particles, processingSeconds: 60 });
  value.defaults = { durationSeconds: 75, seed: 42 };
  value.resources = [{ id: 'staff', name: 'Personal', capacity: staff, unit: 'person' }];
  const work = value.nodes.find((node) => node.type === 'work')!;
  work.work.resourceRequirements = [{ resourceId: 'staff', units: 1 }];
  return { value, work };
}

function addWork(target: SimulationModel, id: string, particles: number, processingSeconds = 60) {
  target.nodes.push(
    {
      id: id + '-source',
      type: 'source',
      name: id + ' arrivals',
      source: { particleTypeId: 'work-item', burst: particles },
    },
    {
      id,
      type: 'work',
      name: id,
      work: {
        capacity: 1,
        processingSeconds,
        resourceRequirements: [{ resourceId: 'staff', units: 1 }],
      },
    },
  );
  target.edges.push(
    { id: id + '-input', sourceNodeId: id + '-source', targetNodeId: id },
    { id: id + '-output', sourceNodeId: id, targetNodeId: 'outcome' },
  );
}

const sends = (state: SimulationState) =>
  state.behaviorTrace?.filter((row) => row.kind === 'send') ?? [];
const reserves = (state: SimulationState) =>
  state.behaviorTrace?.filter((row) => row.kind === 'reserve') ?? [];

describe('queue Behavior and reserve checkout', () => {
  it('crosses only 15 to 16 and opens one extra slot with ordinary staff, cost and processing', () => {
    const exact = runSimulation(model(16).value, { behaviors: behaviors() });
    expect(sends(exact)).toEqual([]);
    expect(exact.metrics.completed).toBe(1);
    const primary = model();
    const active = new SimulationEngine(primary.value, { behaviors: behaviors() });
    active.advance(1);
    const running = active.state();
    expect(running.nodes.work).toMatchObject({ capacity: 2, busy: 2, queue: { current: 15 } });
    expect(running.resources.staff).toMatchObject({ capacity: 2, busy: 2 });
    expect(running.behaviorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'queueChanged', previousLength: 14, length: 15 }),
        expect.objectContaining({
          kind: 'queueChanged',
          previousLength: 15,
          length: 16,
          phase: 5,
          line: 4,
        }),
      ]),
    );
    expect(sends(running)).toMatchObject([
      { nodeId: 'work', targetNodeId: 'work', line: 6, message: 'öppna', messageId: 1 },
    ]);
    expect(reserves(running)).toMatchObject([
      {
        nodeId: 'work',
        resourceId: 'staff',
        particleId: 2,
        decision: 'opened-and-allocated',
        messageId: 1,
        line: 4,
      },
    ]);
    expect(running.events.filter(({ type }) => type === 'RESOURCE_ACQUIRED')).toMatchObject([
      { resourceId: 'staff', particleId: 1, amount: 1 },
      { resourceId: 'staff', particleId: 2, amount: 1 },
    ]);
    expect(running.events.filter(({ type }) => type === 'CAPACITY_SCALE_UP')).toMatchObject([
      { nodeId: 'work', previousCapacity: 1, capacity: 2, amount: 0 },
    ]);
    active.advance(75);
    expect(active.result()).toMatchObject({
      metrics: { completed: 2, scalingCost: 0 },
      finalCapacities: { work: 2 },
    });
    expect(active.result().events.filter(({ type }) => type === 'RESOURCE_RELEASED')).toHaveLength(
      2,
    );
    const further = runSimulation(model(18).value, { behaviors: behaviors() });
    expect(
      further.behaviorTrace?.some((row) => row.previousLength === 16 && row.length === 17),
    ).toBe(true);
    expect(sends(further)).toHaveLength(1);
  });

  it('preserves one cashier with all staff busy, or with the threshold binding disabled', () => {
    const busy = runSimulation(model(17, 1).value, { behaviors: behaviors() });
    expect(reserves(busy)).toMatchObject([{ decision: 'staff-busy', messageId: 1 }]);
    expect(busy.events.some(({ type }) => type === 'CAPACITY_SCALE_UP')).toBe(false);
    expect(busy.metrics.completed).toBe(1);
    const off = behaviors();
    off.bindings.shift();
    const disabled = runSimulation(model().value, { behaviors: off });
    expect(disabled.behaviorTrace).toEqual([]);
    expect(disabled.metrics.completed).toBe(1);
    expect(disabled.finalCapacities.work).toBe(1);
  });

  it('waits for a new upward crossing after a denied opening, even after staff are free', () => {
    const { value } = model();
    addWork(value, 'other', 1, 10);
    value.nodes.push({
      id: 'later',
      name: 'One later arrival',
      type: 'source',
      source: { particleTypeId: 'work-item', burst: 1, startSeconds: 61 },
    });
    value.edges.push({ id: 'later-work', sourceNodeId: 'later', targetNodeId: 'work' });
    const engine = new SimulationEngine(value, { behaviors: behaviors() });
    engine.advance(30);
    expect(engine.state().resources.staff.busy).toBe(1);
    expect(engine.state().nodes.work.capacity).toBe(1);
    expect(reserves(engine.state())).toMatchObject([{ decision: 'staff-busy', timeSeconds: 0 }]);
    engine.advance(62);
    expect(reserves(engine.state())).toMatchObject([
      { decision: 'staff-busy', timeSeconds: 0 },
      { decision: 'opened-and-allocated', timeSeconds: 61 },
    ]);
    expect(engine.state().nodes.work.capacity).toBe(2);
  });

  it('delivers to the explicit Work node and grants competing claims only once', () => {
    const { value } = model(17, 3);
    addWork(value, 'receiver', 2);
    const snapshot = behaviors('receiver');
    snapshot.definitions.push({ ...snapshot.definitions[1], id: 'another' });
    snapshot.bindings.push({
      id: 'another-reserve',
      definitionId: 'another',
      nodeId: 'receiver',
      parameters: { staffing: 'staff' },
    });
    const result = runSimulation(value, { behaviors: snapshot });
    expect(sends(result)).toMatchObject([{ nodeId: 'work', targetNodeId: 'receiver' }]);
    expect(reserves(result)).toMatchObject([
      { nodeId: 'receiver', bindingId: 'reserve', messageId: 1, decision: 'opened-and-allocated' },
      { nodeId: 'receiver', bindingId: 'another-reserve', messageId: 1, decision: 'already-open' },
    ]);
    expect(result.finalCapacities).toMatchObject({ work: 1, receiver: 2 });
    expect(result.events.filter(({ type }) => type === 'CAPACITY_SCALE_UP')).toHaveLength(1);
    expect(
      result.events.filter(
        ({ type, nodeId, timeSeconds }) =>
          type === 'RESOURCE_ACQUIRED' && nodeId === 'receiver' && timeSeconds === 0,
      ),
    ).toHaveLength(2);
  });

  it('orders simultaneous claims from two cashiers against the same last available staff unit', () => {
    const { value } = model(17, 3);
    addWork(value, 'other', 17);
    const snapshot = behaviors();
    snapshot.bindings.push(
      {
        id: 'watch-other',
        definitionId: 'threshold',
        nodeId: 'other',
        parameters: { receiver: 'other' },
      },
      {
        id: 'reserve-other',
        definitionId: 'reserve',
        nodeId: 'other',
        parameters: { staffing: 'staff' },
      },
    );
    const result = runSimulation(value, { behaviors: snapshot });
    expect(sends(result)).toMatchObject([
      { targetNodeId: 'work', messageId: 1 },
      { targetNodeId: 'other', messageId: 2 },
    ]);
    expect(reserves(result)).toMatchObject([
      { nodeId: 'work', resourceId: 'staff', decision: 'opened-and-allocated' },
      { nodeId: 'other', resourceId: 'staff', decision: 'staff-busy' },
    ]);
    expect(result.finalCapacities).toMatchObject({ work: 2, other: 1 });
    expect(
      result.events.filter(
        ({ type, timeSeconds }) => type === 'RESOURCE_ACQUIRED' && timeSeconds === 0,
      ),
    ).toHaveLength(3);
  });

  it.each(['work', 'staff'] as const)(
    'reports closed %s schedule, without opening on a downward crossing',
    (closed) => {
      const { value, work } = model();
      (closed === 'work' ? work.work : value.resources[0]).schedule = [
        { startSeconds: 5, endSeconds: 80 },
      ];
      const result = runSimulation(value, { behaviors: behaviors() });
      expect(reserves(result)).toMatchObject([{ decision: 'schedule-closed' }]);
      expect(result.finalCapacities.work).toBe(1);
    },
  );

  it('reports an empty queue or missing receiver handler, and rejects unavailable references', () => {
    const { value } = model();
    addWork(value, 'receiver', 1);
    value.nodes = value.nodes.filter(({ id }) => id !== 'receiver-source');
    value.edges = value.edges.filter(({ id }) => id !== 'receiver-input');
    const empty = runSimulation(value, { behaviors: behaviors('receiver') });
    expect(reserves(empty)).toMatchObject([{ nodeId: 'receiver', decision: 'queue-empty' }]);
    const inactive = behaviors('receiver');
    inactive.bindings.pop();
    const ignored = runSimulation(value, { behaviors: inactive });
    expect(ignored.behaviorTrace).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        nodeId: 'receiver',
        decision: 'no-active-handler',
        messageId: 1,
      }),
    );
    expect(() => new SimulationEngine(value, { behaviors: behaviors('absent') })).toThrow(
      /Kötröskel \(2:\d+\).*unavailable/,
    );
  });
});

it('produces the same checkout trace and result through the worker Play, MAX and captured replay', async () => {
  vi.useFakeTimers();
  const updates: WorkerUpdate[] = [];
  const scope = {
    postMessage: (value: WorkerUpdate) => updates.push(structuredClone(value)),
    onmessage: undefined as ((event: MessageEvent<WorkerCommand>) => void) | undefined,
  };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  try {
    await import('../src/simulation/worker');
    const send = (data: WorkerCommand) =>
      scope.onmessage!({ data: structuredClone(data) } as MessageEvent<WorkerCommand>);
    const last = () => {
      const update = updates.at(-1);
      if (update?.kind !== 'state') throw new Error('Worker did not publish its state');
      return update;
    };
    const { value } = model();
    const snapshot = behaviors();
    const options: ExecutionOptions = {
      durationSeconds: 75,
      seed: 42,
      runId: 'checkout-parity',
      behaviors: snapshot,
    };
    send({ kind: 'start', model: value, options: { ...options, speed: 100 } });
    await vi.runAllTimersAsync();
    const play = last().result;
    expect(play?.metrics.completed).toBe(2);
    send({ kind: 'start', model: value, options: { ...options, speed: 'max' } });
    await vi.runAllTimersAsync();
    const max = last().result;
    expect(max).toEqual(play);
    snapshot.definitions[0].source = thresholdSource.replace('= 15', '= 100');
    expect(runSimulation(value, options).metrics.completed).toBe(1);
    send({ kind: 'seek', timeSeconds: 75 });
    await vi.runAllTimersAsync();
    expect(last().state.events).toEqual(max!.events);
    expect(last().state.behaviorTrace).toEqual(max!.behaviorTrace);
    expect(last().state.metrics).toEqual(max!.metrics);
    expect(updates.some(({ kind }) => kind === 'error')).toBe(false);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

it('restores captured code, remaps directed node references and reproduces the archived trace', async () => {
  const db = new WorkspaceDatabase(`behavior-run-archive-${crypto.randomUUID()}`);
  const service = new SimulationService(db);
  try {
    await db.initialize();
    const repo = new Repository(db);
    const store = new SimulationRunStore(db);
    const graph = await repo.importGraph(createSimulationGraph('Checkout archive', model().value));
    const capturedModel = graph.simulation!;
    const originalWork = capturedModel.nodes.find(({ type }) => type === 'work')!.id;
    const options = {
      durationSeconds: 75,
      seed: 42,
      runId: 'behavior-archive',
      behaviors: remapSimulationBehaviors(behaviors(), new Map([['work', originalWork]])),
    };
    const result = runSimulation(capturedModel, options);
    const now = new Date().toISOString();
    await store.put({
      id: result.runId,
      diagramId: graph.diagram.id,
      createdAt: now,
      updatedAt: now,
      status: result.status,
      model: capturedModel,
      options,
      result,
    });
    await store.putCheckpoint(result.runId, result.timeSeconds, result);
    const [restored] = await repo.restore(JSON.parse(JSON.stringify(await db.backup())), 'merge');
    const [archived] = await store.list(restored.diagram.id);
    const replay = runSimulation(archived.model, archived.options);
    const restoredWork = archived.model.nodes.find(({ type }) => type === 'work')!.id;
    expect(restoredWork).not.toBe(originalWork);
    expect(archived.options.behaviors?.definitions[0].source).toBe(thresholdSource);
    expect(sends(replay)).toMatchObject([{ nodeId: restoredWork, targetNodeId: restoredWork }]);
    expect(replay.behaviorTrace).toEqual(archived.result?.behaviorTrace);
    expect(replay.modelHash).toBe(archived.result?.modelHash);
    const [checkpoint] = await store.checkpoints(archived.id);
    expect(checkpoint.state.behaviorTrace).toEqual(replay.behaviorTrace);

    const base = `/diagrams/${restored.diagram.id}/simulation`;
    const api = (path: string, method = 'GET', payload?: unknown) => {
      const url = new URL(base + path, 'http://browser.local');
      return simulationCommand(
        repo,
        restored.diagram.id,
        url.pathname.split('/').filter(Boolean),
        url,
        method,
        payload,
        undefined,
        service,
      );
    };
    expect(await service.list(restored.diagram.id)).toHaveLength(1);
    expect(await api('/runs')).toEqual([]);
    for (const action of ['', '/state', '/events', '/result'])
      await expect(api(`/runs/${archived.id}${action}`)).rejects.toMatchObject({ status: 404 });
    await expect(
      api(`/runs/${archived.id}/seek`, 'POST', { timeSeconds: 0 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(api('/compare', 'POST', { runIds: [archived.id, 'other'] })).rejects.toMatchObject(
      { status: 404 },
    );
  } finally {
    service.dispose();
    await db.delete();
  }
});
