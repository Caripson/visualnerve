import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { blankGraph } from '../src/model/types';
import { SimulationService, simulationRuntimeLimits } from '../src/simulation/service';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import type { WorkerCommand, WorkerUpdate } from '../src/simulation/protocol';
import type { SimulationModel, SimulationState } from '../src/simulation/types';
class MockWorker {
  static instances: MockWorker[] = [];
  onmessage?: (event: MessageEvent<WorkerUpdate>) => void;
  onerror?: (event: ErrorEvent) => void;
  commands: WorkerCommand[] = [];
  terminated = false;
  engine?: SimulationEngine;
  constructor() {
    MockWorker.instances.push(this);
  }
  postMessage(command: WorkerCommand) {
    this.commands.push(structuredClone(command));
    if (command.kind === 'start')
      this.engine = new SimulationEngine(command.model, command.options);
    else if (['pause', 'resume', 'stop'].includes(command.kind)) {
      queueMicrotask(() => {
        const state = this.engine!.state();
        state.status =
          command.kind === 'pause' ? 'paused' : command.kind === 'resume' ? 'running' : 'stopped';
        this.emit({
          kind: 'state',
          state,
          ...(command.kind === 'stop'
            ? { result: { ...this.engine!.result(), status: 'stopped' } }
            : {}),
        });
      });
    }
  }
  emit(update: WorkerUpdate) {
    if (!this.terminated)
      this.onmessage?.({ data: structuredClone(update) } as MessageEvent<WorkerUpdate>);
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    this.engine!.advance(this.engine!.options.durationSeconds);
    this.emit({ kind: 'state', state: this.engine!.state(), result: this.engine!.result() });
  }
}
let db: WorkspaceDatabase, service: SimulationService, diagramId: string, model: SimulationModel;
beforeEach(async () => {
  MockWorker.instances = [];
  vi.stubGlobal('Worker', MockWorker);
  db = new WorkspaceDatabase(`simulation-runtime-${crypto.randomUUID()}`);
  await db.open();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  const graph = blankGraph('Simulation', 'process-simulator');
  await db.diagrams.put(graph.diagram);
  diagramId = graph.diagram.id;
  model = createBasicModel({ particles: 1 });
  service = new SimulationService(db);
});
afterEach(async () => {
  service.dispose();
  await db.delete();
  vi.unstubAllGlobals();
});
const latest = () => MockWorker.instances[MockWorker.instances.length - 1];
describe('Process Simulator shared runtime', () => {
  it('invalid effective scenario/run options are rejected before storing or starting a worker', async () => {
    await expect(service.start(diagramId, model, { scenarioId: 'missing' })).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.start(diagramId, model, { speed: 9 as never })).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.start(diagramId, model, { demandMultiplier: -1 })).rejects.toMatchObject({
      status: 422,
    });
    expect(await db.simulationRuns.count()).toBe(0);
    expect(MockWorker.instances).toHaveLength(0);
  });
  it('pause/resume/stop waits for actual worker state and stop keeps final metrics', async () => {
    const run = await service.start(diagramId, model);
    const worker = latest();
    worker.engine!.advance(1);
    worker.emit({ kind: 'state', state: worker.engine!.state() });
    expect((await service.control(run.id, 'pause')).status).toBe('paused');
    expect((await service.state(run.id)).status).toBe('paused');
    expect((await service.control(run.id, 'resume')).status).toBe('running');
    expect((await service.control(run.id, 'stop')).status).toBe('stopped');
    expect(worker.terminated).toBe(true);
    expect((await service.result(run.id)).status).toBe('stopped');
    expect((await service.result(run.id)).timeSeconds).toBe(1);
  });
  it('reset freezes a new run using the same immutable original assumptions', async () => {
    const run = await service.start(diagramId, model);
    model.particleTypes[0].revenue = 10000;
    const reset = await service.control(run.id, 'reset');
    expect(reset.id).not.toBe(run.id);
    expect(reset.model.particleTypes[0].revenue).toBe(100);
    expect(reset.status).toBe('paused');
    expect(reset.options.startPaused).toBe(true);
    expect(MockWorker.instances[0].terminated).toBe(true);
    expect(service.current(diagramId)?.run.id).toBe(reset.id);
  });
  it.each(['live UI run', 'archived UI run'] as const)(
    'external reset of a %s remains governed by MCP write access',
    async (source) => {
      const original = await service.start(diagramId, model, { origin: 'ui' });
      if (source === 'archived UI run') {
        latest().finish();
        await expect
          .poll(() => db.simulationRuns.get(original.id).then((run) => run?.status))
          .toBe('completed');
        service.dispose();
        service = new SimulationService(db);
      }
      const reset = await service.control(original.id, 'reset', { origin: 'api' });
      const worker = latest();
      expect(reset.status).toBe('paused');
      await db.settings.put({ key: 'mcp-access', value: 'read' });
      await expect.poll(() => worker.terminated).toBe(true);
      expect((await service.get(reset.id)).status).toBe('stopped');
      expect((await service.get(original.id)).status).toBe(
        source === 'archived UI run' ? 'completed' : 'stopped',
      );
      await expect(service.control(original.id, 'reset', { origin: 'api' })).rejects.toMatchObject({
        status: 403,
      });
    },
  );
  it('changing speed updates common runtime options and rejects unsupported speeds', async () => {
    const run = await service.start(diagramId, model);
    await service.setSpeed(run.id, 10);
    expect((await service.get(run.id)).options.speed).toBe(10);
    expect(latest().commands.at(-1)).toEqual({ kind: 'speed', speed: 10 });
    await expect(service.setSpeed(run.id, 3 as never)).rejects.toMatchObject({ status: 422 });
  });
  it('reading archived runs does not change UI selection and reload reconstructs results', async () => {
    const a = await service.start(diagramId, model);
    latest().finish();
    const b = await service.start(diagramId, model);
    latest().finish();
    await expect.poll(() => db.simulationRuns.get(b.id).then((r) => r?.status)).toBe('completed');
    await service.get(a.id);
    expect(service.current(diagramId)?.run.id).toBe(b.id);
    await service.selectRun(a.id);
    expect(service.current(diagramId)?.run.id).toBe(a.id);
    service.dispose();
    service = new SimulationService(db);
    await service.selectRun(b.id);
    expect(service.current(diagramId)?.state?.metrics.completed).toBe(1);
  });
  it('completed-run cache stays bounded during repeated API stress runs', async () => {
    for (let i = 0; i < simulationRuntimeLimits.cachedRuns + 10; i++) {
      await service.start(diagramId, model, { origin: 'api' });
      latest().finish();
    }
    expect((service as unknown as { runs: Map<string, unknown> }).runs.size).toBeLessThanOrEqual(
      simulationRuntimeLimits.cachedRuns,
    );
    expect(latest().terminated).toBe(true);
    await expect.poll(() => db.simulationRuns.count()).toBeLessThanOrEqual(30);
  });
  it('concurrent execution has an explicit limit and releases slots on stop', async () => {
    const runs = [];
    for (let i = 0; i < simulationRuntimeLimits.activeRuns; i++)
      runs.push(await service.start(diagramId, model));
    await expect(service.start(diagramId, model)).rejects.toMatchObject({ status: 409 });
    await service.control(runs[0].id, 'stop');
    await expect(service.start(diagramId, model)).resolves.toHaveProperty('id');
  });
  it('reserves startup slots before asynchronous work for simultaneous external starts', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.start(diagramId, model, { origin: 'api' })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    expect(MockWorker.instances).toHaveLength(4);
    expect(await db.simulationRuns.count()).toBe(4);
  });
  it.each([
    'missing document',
    'consent',
    'options',
    'storage failure',
    'worker failure',
    'post failure',
  ] as const)('releases a startup reservation after %s rejection', async (failure) => {
    let attempt: Promise<unknown>;
    if (failure === 'missing document') attempt = service.start(crypto.randomUUID(), model);
    else if (failure === 'consent') {
      await db.settings.put({ key: 'storage-consent', value: false });
      attempt = service.start(diagramId, model);
    } else if (failure === 'options')
      attempt = service.start(diagramId, model, { durationSeconds: -1 });
    else if (failure === 'storage failure') {
      const store = (service as unknown as { store: { put: (run: unknown) => Promise<unknown> } })
        .store;
      vi.spyOn(store, 'put').mockRejectedValueOnce(new Error('Storage unavailable.'));
      attempt = service.start(diagramId, model);
    } else if (failure === 'worker failure') {
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            throw new Error('Worker unavailable.');
          }
        },
      );
      attempt = service.start(diagramId, model);
    } else {
      vi.stubGlobal(
        'Worker',
        class extends MockWorker {
          postMessage() {
            throw new Error('Worker start message failed.');
          }
        },
      );
      attempt = service.start(diagramId, model);
    }
    await expect(attempt).rejects.toBeDefined();
    await db.settings.put({ key: 'storage-consent', value: true });
    vi.stubGlobal('Worker', MockWorker);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => service.start(diagramId, model)),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(MockWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(4);
  });
  it('API execution stops when MCP write access is revoked, while local UI execution continues', async () => {
    const api = await service.start(diagramId, model, { origin: 'api' }),
      apiWorker = latest();
    const ui = await service.start(diagramId, model, { origin: 'ui' }),
      uiWorker = latest();
    await db.settings.put({ key: 'mcp-access', value: 'read' });
    await expect.poll(() => apiWorker.terminated).toBe(true);
    expect(uiWorker.terminated).toBe(false);
    expect((await service.get(api.id)).status).toBe('stopped');
    expect((await service.get(ui.id)).status).toBe('running');
    await expect(service.start(diagramId, model, { origin: 'api' })).rejects.toMatchObject({
      status: 403,
    });
  });
  it('replay reconstructs state without mutating the immutable final result', async () => {
    const run = await service.start(diagramId, model);
    latest().finish();
    const original = await service.result(run.id);
    const replay = service.seek(run.id, 30);
    await expect.poll(() => MockWorker.instances.length).toBe(2);
    const worker = latest();
    worker.emit({ kind: 'state', state: worker.engine!.state() });
    expect(worker.commands.at(-1)).toEqual({ kind: 'seek', timeSeconds: 30 });
    worker.engine!.advance(30, 5000, true);
    worker.emit({ kind: 'state', state: { ...worker.engine!.state(), status: 'paused' } });
    const state = await replay;
    expect(state.timeSeconds).toBe(30);
    expect(state.metrics.completed).toBe(0);
    expect(await service.result(run.id)).toEqual(original);
    expect(worker.terminated).toBe(true);
  });
  it('revoking storage consent cancels pending replay even for a completed run', async () => {
    const run = await service.start(diagramId, model);
    latest().finish();
    const replay = service.seek(run.id, 30);
    const rejection = expect(replay).rejects.toMatchObject({ status: 403 });
    await expect.poll(() => MockWorker.instances.length).toBe(2);
    const worker = latest();
    await db.settings.put({ key: 'storage-consent', value: false });
    await rejection;
    expect(worker.terminated).toBe(true);
  });
  it.each(['completed UI run', 'archived UI run'] as const)(
    'API replay of a %s stops on write revocation without changing its final result',
    async (source) => {
      const run = await service.start(diagramId, model, { origin: 'ui' });
      latest().finish();
      const result = await service.result(run.id);
      if (source === 'archived UI run') {
        service.dispose();
        service = new SimulationService(db);
      }
      const replay = service.seek(run.id, 30, { origin: 'api' });
      const rejection = expect(replay).rejects.toMatchObject({ status: 403 });
      await expect.poll(() => MockWorker.instances.length).toBe(2);
      const worker = latest();
      await db.settings.put({ key: 'mcp-access', value: 'read' });
      await rejection;
      expect(worker.terminated).toBe(true);
      expect(await service.result(run.id)).toEqual(result);
      await expect(service.seek(run.id, 30, { origin: 'api' })).rejects.toMatchObject({
        status: 403,
      });
    },
  );
  it('bounds simultaneous archived replays and execution starts with one worker limit', async () => {
    const runs = [];
    for (let index = 0; index < 8; index++) {
      const run = await service.start(diagramId, model);
      latest().finish();
      await service.result(run.id);
      runs.push(run);
    }
    service.dispose();
    service = new SimulationService(db);
    const replays = Promise.allSettled(
      runs.map((run) => service.seek(run.id, 30, { origin: 'api' })),
    );
    await expect
      .poll(() => MockWorker.instances.filter((worker) => !worker.terminated).length)
      .toBe(4);
    await expect(service.start(diagramId, model)).rejects.toMatchObject({ status: 409 });
    for (const worker of MockWorker.instances.filter((value) => !value.terminated)) {
      worker.emit({ kind: 'state', state: worker.engine!.state() });
      worker.engine!.advance(30, 5000, true);
      worker.emit({ kind: 'state', state: { ...worker.engine!.state(), status: 'paused' } });
    }
    const results = await replays;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    expect(MockWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(0);
    await expect(service.start(diagramId, model)).resolves.toHaveProperty('id');
  });
  it('converges simultaneous archive reads and replaces replay workers for the same run', async () => {
    const run = await service.start(diagramId, model);
    latest().finish();
    await service.result(run.id);
    service.dispose();
    service = new SimulationService(db);
    const replays = Promise.allSettled(
      Array.from({ length: 8 }, () => service.seek(run.id, 30, { origin: 'api' })),
    );
    await expect.poll(() => MockWorker.instances.length).toBe(5);
    const resident = MockWorker.instances.filter((worker) => !worker.terminated);
    expect(resident).toHaveLength(1);
    resident[0].emit({ kind: 'state', state: resident[0].engine!.state() });
    resident[0].engine!.advance(30, 5000, true);
    resident[0].emit({
      kind: 'state',
      state: { ...resident[0].engine!.state(), status: 'paused' },
    });
    const results = await replays;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    expect((await service.state(run.id)).timeSeconds).toBe(30);
  });
  it('counts paused resident execution workers against replay capacity', async () => {
    const completed = await service.start(diagramId, model);
    latest().finish();
    await service.result(completed.id);
    for (let index = 0; index < 4; index++)
      await service.start(diagramId, model, { startPaused: true });
    await expect(service.seek(completed.id, 30)).rejects.toMatchObject({ status: 409 });
    expect(MockWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(4);
  });
  it.each(['missing run', 'invalid time', 'worker failure', 'post failure'] as const)(
    'releases replay startup reservations after %s failure',
    async (failure) => {
      const run = await service.start(diagramId, model);
      latest().finish();
      await service.result(run.id);
      if (failure === 'worker failure')
        vi.stubGlobal(
          'Worker',
          class {
            constructor() {
              throw new Error('Worker unavailable.');
            }
          },
        );
      if (failure === 'post failure')
        vi.stubGlobal(
          'Worker',
          class extends MockWorker {
            postMessage() {
              throw new Error('Worker start message failed.');
            }
          },
        );
      await expect(
        service.seek(
          failure === 'missing run' ? crypto.randomUUID() : run.id,
          failure === 'invalid time' ? 999999 : 30,
        ),
      ).rejects.toBeDefined();
      vi.stubGlobal('Worker', MockWorker);
      const starts = await Promise.allSettled(
        Array.from({ length: 4 }, () => service.start(diagramId, model)),
      );
      expect(starts.every((start) => start.status === 'fulfilled')).toBe(true);
      expect(MockWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(4);
    },
  );
  it('final results are durably saved before completion is published or returned', async () => {
    const run = await service.start(diagramId, model);
    const store = (service as unknown as { store: { put: (value: unknown) => Promise<unknown> } })
      .store;
    const original = store.put.bind(store);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(store, 'put').mockImplementationOnce(async (value) => {
      await gate;
      return original(value);
    });
    let published = false;
    service.subscribe(() => {
      if (service.current(diagramId)?.run.status === 'completed') published = true;
    });
    latest().finish();
    let returned = false;
    const result = service.result(run.id).then((value) => {
      returned = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(returned).toBe(false);
    expect(published).toBe(false);
    release();
    expect((await result).metrics.completed).toBe(1);
    expect(published).toBe(true);
    expect((await db.simulationRuns.get(run.id))?.result?.metrics.completed).toBe(1);
  });
});
