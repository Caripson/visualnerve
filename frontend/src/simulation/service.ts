import type { WorkspaceDatabase } from '../storage/database';
import { asWorkspaceStorage } from '../storage/adapter';
import { workspaceStorage } from '../storage/runtime';
import type { WorkspaceStorage, WorkspaceOperation } from '../storage/contracts';
import { StorageError } from '../model/validation';
import { AppUpdateBlockedError } from '../updates/errors';
import { SimulationClient } from './client';
import { SimulationRunStore, simulationRetentionLimits } from './run-store';
import { assertSimulationModel, resolveScenario } from './schema';
import { compareSimulationResults } from './engine';
import type { RunOptions, SimulationModel, SimulationResult, SimulationState } from './types';
import type { ExecutionOptions, SimulationSpeed, WorkerUpdate } from './protocol';

export type SimulationStartOptions = RunOptions & {
  speed?: SimulationSpeed;
  animated?: boolean;
  origin?: 'ui' | 'api';
  startPaused?: boolean;
  beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
};
export interface SimulationRunInfo {
  id: string;
  diagramId: string;
  status: SimulationState['status'];
  options: ExecutionOptions;
  model: SimulationModel;
  createdAt: string;
  updatedAt: string;
  result?: SimulationResult;
  error?: string;
}
export interface SimulationView {
  run: SimulationRunInfo;
  state?: SimulationState;
  replayTimeSeconds?: number;
}
interface LiveRun {
  view: SimulationView;
  client?: SimulationClient;
  replayClient?: SimulationClient;
  replayOrigin?: 'ui' | 'api';
  replayToken?: symbol;
  origin: 'ui' | 'api';
  writes: Promise<unknown>;
  operation: WorkspaceOperation;
  release?: () => void;
  replayReject?: (error: Error) => void;
  unsavedArchive?: { run: SimulationRunInfo; state?: SimulationState };
}
export const simulationRuntimeLimits = { cachedRuns: 60, activeRuns: 4 };

class SimulationCurrencyError extends StorageError {
  readonly code = 'SIMULATION_CURRENCY_MISMATCH';
  readonly issues: { path: string; code: string; message: string }[];
  constructor(currencies: string[]) {
    super(
      422,
      `Compare runs with the same currency. These runs use ${currencies.join(', ')}; exchange-rate conversion is not supported.`,
    );
    this.issues = [{ path: 'runIds', code: this.code, message: this.message }];
  }
}

/** One authoritative runtime shared by UI and Repository/API commands. */
export class SimulationService {
  private runs = new Map<string, LiveRun>();
  private activeRuns = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private observer?: () => void;
  private permissionRefresh = 0;
  private generation = 0;
  private db: WorkspaceStorage;
  private selectedRunId?: string;
  private pendingWorkers = 0;
  constructor(input: WorkspaceStorage | WorkspaceDatabase = workspaceStorage) {
    this.db = asWorkspaceStorage(input);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  version = () => this.revision;
  /** A restart may retain archives, but cannot silently discard running work. */
  async settleBeforeAppUpdate() {
    const busy = () =>
      this.pendingWorkers > 0 ||
      [...this.runs.values()].some((live) => !!live.client || !!live.replayReject);
    if (busy()) {
      throw new AppUpdateBlockedError('waitForRun');
    }
    await Promise.all([...this.runs.values()].map((live) => live.writes));
    if (busy()) {
      throw new AppUpdateBlockedError('waitForRun');
    }
    // The background writer retains failures for the UI instead of rejecting
    // its queue. Retry any retained terminal archive; a second failure must
    // reject this preflight, preserving the RAM-only result in the open tab.
    let retried = false;
    try {
      for (const [id, live] of this.runs)
        if (live.unsavedArchive) {
          await this.archiveLive(id, live, live.unsavedArchive);
          retried = true;
        }
    } finally {
      if (retried) this.emit();
    }
  }
  private emit() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private reserveWorker() {
    const resident = [...this.runs.values()].reduce(
      (count, live) => count + Number(!!live.client) + Number(!!live.replayClient),
      0,
    );
    if (resident + this.pendingWorkers >= simulationRuntimeLimits.activeRuns)
      throw new StorageError(
        409,
        `At most ${simulationRuntimeLimits.activeRuns} execution or replay workers can be resident at once, including paused runs. Stop a run before starting another.`,
      );
    this.pendingWorkers++;
    return () => {
      this.pendingWorkers--;
    };
  }
  private cancelReplay(live: LiveRun, error?: Error) {
    live.replayClient?.dispose();
    live.replayClient = undefined;
    live.replayOrigin = undefined;
    live.replayToken = undefined;
    const reject = live.replayReject;
    live.replayReject = undefined;
    if (error) reject?.(error);
  }
  view(runId?: string): SimulationView | undefined {
    return runId ? this.runs.get(runId)?.view : undefined;
  }
  current(diagramId: string): SimulationView | undefined {
    const id = this.activeRuns.get(diagramId);
    return id ? this.runs.get(id)?.view : undefined;
  }
  async selectRun(id: string) {
    const run = await this.get(id);
    const live = this.runs.get(id);
    if (!live) throw new StorageError(409, 'Simulation service was closed.');
    await live.operation.check();
    if (this.runs.get(id) !== live) throw new StorageError(409, 'Simulation service was closed.');
    this.activeRuns.set(run.diagramId, id);
    this.selectedRunId = id;
    this.emit();
    return run;
  }
  /** Synchronously detach an obsolete canvas view without deleting its immutable archive. */
  async detachCanvasRun(diagramId: string, runId: string) {
    if (this.activeRuns.get(diagramId) !== runId) return;
    this.activeRuns.delete(diagramId);
    this.emit();
    const live = this.runs.get(runId);
    if (
      live?.origin === 'ui' &&
      live.client &&
      ['running', 'paused', 'ready'].includes(live.view.run.status)
    ) {
      try {
        await this.control(runId, 'stop');
      } catch (error) {
        // A final worker update may win the race with the stop request.
        if (live.client && ['running', 'paused', 'ready'].includes(live.view.run.status))
          throw error;
      }
      await live.writes;
    }
  }
  private watchPermissions() {
    if (this.observer) return;
    const refresh = () => {
      const token = ++this.permissionRefresh;
      void this.db
        .atomic('r', ['settings', 'diagrams'], async (scope) => ({
          consent: (await scope.settings.get('storage-consent'))?.value === true,
          write: (await scope.settings.get('mcp-access'))?.value === 'write',
          diagrams: new Set((await scope.diagrams.toArray()).map((diagram) => diagram.id)),
        }))
        .then(({ consent, write, diagrams }) => {
          if (!this.observer || token !== this.permissionRefresh) return;
          for (const live of this.runs.values()) {
            const unavailable = !consent || !diagrams.has(live.view.run.diagramId);
            if (unavailable || (live.replayOrigin === 'api' && !write))
              this.cancelReplay(
                live,
                new StorageError(
                  403,
                  'Replay stopped because access or local storage consent changed.',
                ),
              );
            if (unavailable || (live.origin === 'api' && !write)) {
              live.client?.dispose();
              live.client = undefined;
              if (['completed', 'stopped', 'failed'].includes(live.view.run.status)) continue;
              const error = 'Simulation stopped because access or local storage consent changed.';
              live.view = {
                ...live.view,
                run: { ...live.view.run, status: 'stopped', error },
                ...(live.view.state
                  ? { state: { ...live.view.state, status: 'stopped', message: error } }
                  : {}),
              };
              this.emit();
            }
          }
        })
        .catch(() => {
          // Originating operation signals synchronously clear locked-session caches.
          // An unrelated transient observer failure must not authorize new work.
        });
    };
    this.observer = this.db.subscribe((change) => {
      if (change.stores.some((store) => store === 'settings' || store === 'diagrams')) refresh();
    });
    refresh();
  }
  private retained(id: string, live: LiveRun) {
    const abort = () => {
      if (this.runs.get(id) !== live) return;
      this.removeLive(id, live, new StorageError(423, 'Unlock the workspace to continue.'));
      this.emit();
    };
    live.operation.signal.addEventListener('abort', abort, { once: true });
    live.release = () => {
      live.operation.signal.removeEventListener('abort', abort);
      live.operation.dispose();
    };
    if (live.operation.signal.aborted) abort();
  }
  private removeLive(
    id: string,
    live: LiveRun,
    error = new StorageError(409, 'Simulation service was closed.'),
  ) {
    live.client?.dispose();
    live.client = undefined;
    this.cancelReplay(live, error);
    live.release?.();
    live.release = undefined;
    this.runs.delete(id);
    if (this.activeRuns.get(live.view.run.diagramId) === id)
      this.activeRuns.delete(live.view.run.diagramId);
    if (this.selectedRunId === id) this.selectedRunId = undefined;
  }
  private async withOperation<T>(work: (operation: WorkspaceOperation) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const operation = await this.db.captureOperation();
    try {
      if (generation !== this.generation)
        throw new StorageError(409, 'Simulation service was closed.');
      const result = await work(operation);
      await operation.check();
      if (generation !== this.generation)
        throw new StorageError(409, 'Simulation service was closed.');
      return result;
    } catch (error) {
      await operation.check();
      if (generation !== this.generation)
        throw new StorageError(409, 'Simulation service was closed.');
      throw error;
    } finally {
      operation.dispose();
    }
  }
  private async guard(
    live: LiveRun,
    origin: 'api' | 'ui',
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ) {
    await live.operation.storage.atomic('r', ['settings', 'diagrams'], async (scope) => {
      if ((await scope.settings.get('storage-consent'))?.value !== true)
        throw new StorageError(
          403,
          'Accept local browser storage before controlling a simulation.',
        );
      if (!(await scope.diagrams.get(live.view.run.diagramId)))
        throw new StorageError(404, 'Simulation document was deleted.');
      if (origin === 'api' && (await scope.settings.get('mcp-access'))?.value !== 'write')
        throw new StorageError(403, 'Simulation execution requires MCP write access.');
      await beforeWrite?.(scope);
    });
    await live.operation.check();
    if (this.runs.get(live.view.run.id) !== live)
      throw new StorageError(409, 'Simulation service was closed.');
  }
  start(
    diagramId: string,
    model: SimulationModel,
    input: SimulationStartOptions = {},
  ): Promise<SimulationRunInfo> {
    return this.startRun(diagramId, model, input);
  }
  private async startRun(
    diagramId: string,
    model: SimulationModel,
    input: SimulationStartOptions = {},
    originating?: WorkspaceOperation,
  ): Promise<SimulationRunInfo> {
    assertSimulationModel(model);
    assertSimulationModel({
      ...resolveScenario(model, input.scenarioId, input.demandMultiplier),
      scenarios: [],
    });
    if (input.speed !== undefined && ![1, 10, 100, 'max'].includes(input.speed))
      throw new StorageError(422, 'Simulation speed must be 1, 10, 100 or max.');
    for (const key of ['animated', 'startPaused', 'untilComplete'] as const)
      if (input[key] !== undefined && typeof input[key] !== 'boolean')
        throw new StorageError(422, `${key} must be a boolean.`);
    const releaseWorker = this.reserveWorker();
    const generation = this.generation;
    let operation: WorkspaceOperation | undefined;
    let retained = false;
    try {
      operation = await this.db.captureOperation();
      await originating?.check();
      if ((await operation.storage.settings.get('storage-consent'))?.value !== true)
        throw new StorageError(403, 'Accept local browser storage before running a simulation.');
      if (!(await operation.storage.diagrams.get(diagramId)))
        throw new StorageError(404, 'Diagram not found.');
      const { origin: _origin, beforeWrite: _beforeWrite, ...executionInput } = input;
      const options: ExecutionOptions = {
        ...executionInput,
        durationSeconds: input.durationSeconds ?? model.defaults.durationSeconds,
        seed: input.seed ?? model.defaults.seed,
        speed: input.animated === false ? 'max' : (input.speed ?? 1),
        runId: crypto.randomUUID(),
      };
      if (
        !Number.isFinite(options.durationSeconds) ||
        options.durationSeconds <= 0 ||
        options.durationSeconds > 315360000 ||
        !Number.isSafeInteger(options.seed) ||
        options.seed < 0
      )
        throw new StorageError(422, 'Duration must be positive and seed must be a safe integer.');
      if (
        input.demandMultiplier !== undefined &&
        (!Number.isFinite(input.demandMultiplier) || input.demandMultiplier < 0)
      )
        throw new StorageError(422, 'Demand multiplier must be nonnegative.');
      const timestamp = new Date().toISOString();
      const run: SimulationRunInfo = {
        id: options.runId!,
        diagramId,
        options,
        model: structuredClone(model),
        status: input.startPaused ? 'paused' : 'running',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await operation.storage.atomic(
        'rw',
        ['settings', 'diagrams', 'simulationRuns', 'simulationCheckpoints'],
        async (scope) => {
          if ((await scope.settings.get('storage-consent'))?.value !== true)
            throw new StorageError(
              403,
              'Accept local browser storage before running a simulation.',
            );
          if (input.origin === 'api' && (await scope.settings.get('mcp-access'))?.value !== 'write')
            throw new StorageError(403, 'Simulation execution requires MCP write access.');
          await new SimulationRunStore(scope).put(run, input.beforeWrite);
        },
      );
      await operation.check();
      if (generation !== this.generation)
        throw new StorageError(409, 'Simulation service was closed.');
      const live: LiveRun = {
        view: { run },
        origin: input.origin ?? 'ui',
        writes: Promise.resolve(),
        operation,
      };
      this.runs.set(run.id, live);
      retained = true;
      this.retained(run.id, live);
      this.activeRuns.set(diagramId, run.id);
      this.selectedRunId = run.id;
      this.watchPermissions();
      try {
        live.client = new SimulationClient(run.model, options, (update) =>
          this.update(run.id, update),
        );
      } catch (error) {
        this.update(run.id, { kind: 'error', message: (error as Error).message });
        throw error;
      }
      this.prune(run.id);
      this.emit();
      return structuredClone(run);
    } finally {
      if (!retained) operation?.dispose();
      releaseWorker();
    }
  }
  private update(id: string, update: WorkerUpdate) {
    const live = this.runs.get(id);
    if (!live || live.operation.signal.aborted) return;
    const run = { ...live.view.run, updatedAt: new Date().toISOString() };
    if (update.kind === 'error') {
      run.status = 'failed';
      run.error = update.message;
      live.client?.dispose();
      live.client = undefined;
      live.view = { ...live.view, run };
    } else {
      run.status = update.state.status;
      if (update.result) {
        run.result = { ...update.result, status: update.state.status };
        live.client?.dispose();
        live.client = undefined;
      }
      live.view = { run, state: update.state };
    }
    if (['completed', 'stopped', 'failed'].includes(run.status)) {
      const archive = { run, state: live.view.state };
      live.unsavedArchive = archive;
      live.writes = live.writes
        .then(() => this.archiveLive(id, live, archive))
        .catch((error) => {
          if (this.runs.get(id) !== live || live.operation.signal.aborted) return;
          const message = `Result could not be saved: ${(error as Error).message}`;
          live.view = {
            ...live.view,
            run: { ...run, status: 'failed', error: message },
            ...(live.view.state
              ? { state: { ...live.view.state, status: 'failed', message } }
              : {}),
          };
        })
        .finally(() => {
          if (this.runs.get(id) !== live) return;
          this.prune(id);
          this.emit();
        });
    } else this.emit();
  }
  private async archiveLive(
    id: string,
    live: LiveRun,
    archive: NonNullable<LiveRun['unsavedArchive']>,
  ) {
    await live.operation.check();
    if (this.runs.get(id) !== live) throw new StorageError(409, 'Simulation service was closed.');
    await live.operation.storage.atomic(
      'rw',
      ['settings', 'diagrams', 'simulationRuns', 'simulationCheckpoints'],
      async (scope) => {
        if ((await scope.settings.get('storage-consent'))?.value !== true)
          throw new StorageError(
            403,
            'Local storage consent was revoked before the result could be saved.',
          );
        if (!(await scope.diagrams.get(archive.run.diagramId)))
          throw new StorageError(
            404,
            'Simulation document was deleted before the result could be saved.',
          );
        if (live.origin === 'api' && (await scope.settings.get('mcp-access'))?.value !== 'write')
          throw new StorageError(403, 'Simulation execution requires MCP write access.');
        const store = new SimulationRunStore(scope);
        await store.put(archive.run);
        if (archive.state) await store.putCheckpoint(id, archive.state.timeSeconds, archive.state);
      },
    );
    await live.operation.check();
    if (this.runs.get(id) !== live) throw new StorageError(409, 'Simulation service was closed.');
    if (live.unsavedArchive === archive) {
      live.unsavedArchive = undefined;
      live.view = { run: archive.run, ...(archive.state ? { state: archive.state } : {}) };
    }
  }
  private prune(keep?: string) {
    const completed = [...this.runs].filter(([, live]) => !live.client && !live.replayClient);
    const counts = new Map<string, number>();
    for (const [id, live] of completed.reverse()) {
      const count = (counts.get(live.view.run.diagramId) ?? 0) + 1;
      counts.set(live.view.run.diagramId, count);
      if (
        id !== keep &&
        id !== this.selectedRunId &&
        count > simulationRetentionLimits.runsPerDiagram
      )
        this.removeLive(id, live);
    }
    for (const [id, live] of this.runs) {
      if (this.runs.size <= simulationRuntimeLimits.cachedRuns) break;
      if (id !== keep && id !== this.selectedRunId && !live.client && !live.replayClient)
        this.removeLive(id, live);
    }
  }
  async list(diagramId: string) {
    return this.withOperation(async (operation) => {
      await Promise.all(
        [...this.runs.values()]
          .filter((live) => live.view.run.diagramId === diagramId && !live.client)
          .map((live) => live.writes),
      );
      const persisted = await new SimulationRunStore(operation.storage).list(diagramId);
      const all = new Map(persisted.map((run) => [run.id, run]));
      for (const live of this.runs.values())
        if (live.view.run.diagramId === diagramId) all.set(live.view.run.id, live.view.run);
      return [...all.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((run) => ({
          id: run.id,
          diagramId: run.diagramId,
          status: run.status,
          options: run.options,
          currency: run.model.currency,
          scenarioName: run.options.scenarioId
            ? (run.model.scenarios.find((scenario) => scenario.id === run.options.scenarioId)
                ?.name ?? `Scenario ${run.options.scenarioId}`)
            : 'Baseline',
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          metrics: run.result?.metrics,
          error: run.error,
        }));
    });
  }
  async get(id: string): Promise<SimulationRunInfo> {
    const generation = this.generation;
    const live = this.runs.get(id);
    if (live) {
      await live.operation.check();
      if (['completed', 'stopped', 'failed'].includes(live.view.run.status)) await live.writes;
      await live.operation.check();
      if (generation !== this.generation || this.runs.get(id) !== live)
        throw new StorageError(409, 'Simulation service was closed.');
      this.runs.delete(id);
      this.runs.set(id, live);
      return structuredClone(live.view.run);
    }
    const operation = await this.db.captureOperation();
    let retained = false;
    try {
      const stored = await new SimulationRunStore(operation.storage).get(id);
      await operation.check();
      if (generation !== this.generation)
        throw new StorageError(409, 'Simulation service was closed.');
      // Simultaneous archive reads converge on the same LiveRun/worker owner.
      if (this.runs.has(id)) return this.get(id);
      const run = stored as SimulationRunInfo;
      if (['running', 'paused', 'ready'].includes(run.status)) {
        run.status = 'stopped';
        run.error =
          'Execution ended when this browser was closed. Start a new run or replay the saved model.';
      }
      const entry: LiveRun = {
        view: { run, state: run.result },
        origin: 'ui',
        writes: Promise.resolve(),
        operation,
      };
      this.runs.set(id, entry);
      retained = true;
      this.retained(id, entry);
      this.prune(id);
      this.emit();
      return structuredClone(run);
    } finally {
      if (!retained) operation.dispose();
    }
  }
  async state(id: string): Promise<SimulationState> {
    return this.withOperation(async () => {
      const run = await this.get(id);
      if (run.error?.startsWith('Result could not be saved:'))
        throw new StorageError(500, run.error);
      const state = this.runs.get(id)?.view.state ?? run.result;
      if (!state) throw new StorageError(409, 'Simulation is initializing; retry this read.');
      return structuredClone(state);
    });
  }
  async result(id: string): Promise<SimulationResult> {
    return this.withOperation(async () => {
      const run = await this.get(id);
      if (run.error?.startsWith('Result could not be saved:'))
        throw new StorageError(500, run.error);
      if (!run.result) throw new StorageError(409, 'This run has no final result yet.');
      return structuredClone(run.result);
    });
  }
  async events(id: string, paging: { offset?: number; limit?: number } = {}) {
    return this.withOperation(async () => {
      const state = await this.state(id);
      const offset = Math.max(0, paging.offset ?? 0),
        limit = Math.min(1000, Math.max(1, paging.limit ?? 100));
      return {
        events: state.events.slice(offset, offset + limit),
        offset,
        limit,
        retained: state.events.length,
        dropped: state.retained.droppedEvents,
      };
    });
  }
  async control(
    id: string,
    action: 'pause' | 'resume' | 'stop' | 'reset',
    options: {
      origin?: 'api' | 'ui';
      beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
    } = {},
  ) {
    const run = await this.get(id);
    const live = this.runs.get(id)!;
    await this.guard(live, options.origin ?? live.origin, options.beforeWrite);
    if (action === 'reset') {
      if (live.client) await this.control(id, 'stop', options);
      return this.startRun(
        run.diagramId,
        run.model,
        {
          ...run.options,
          origin: options.origin ?? live.origin,
          startPaused: true,
          beforeWrite: options.beforeWrite,
        },
        live.operation,
      );
    }
    if (!live.client || ['completed', 'failed', 'stopped'].includes(run.status))
      throw new StorageError(
        409,
        'This run has finished. Start a new run to change its execution.',
      );
    const expected = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'running';
    const acknowledged = await new Promise<SimulationRunInfo>((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new StorageError(504, 'Simulation worker did not acknowledge the control.'));
      }, 10000);
      unsubscribe = this.subscribe(() => {
        const current = this.runs.get(id)?.view.run;
        if (!current) {
          clearTimeout(timer);
          unsubscribe();
          reject(new StorageError(409, 'Simulation service was closed.'));
          return;
        }
        if (
          current.status === expected ||
          ['completed', 'failed', 'stopped'].includes(current.status)
        ) {
          clearTimeout(timer);
          unsubscribe();
          resolve(structuredClone(current));
        }
      });
      live.client!.send({ kind: action });
    });
    await live.operation.check();
    return acknowledged;
  }
  async setSpeed(
    id: string,
    speed: SimulationSpeed,
    beforeWrite?: (scope: WorkspaceStorage) => Promise<void>,
  ) {
    if (![1, 10, 100, 'max'].includes(speed))
      throw new StorageError(422, 'Simulation speed must be 1, 10, 100 or max.');
    const run = await this.get(id);
    const live = this.runs.get(id)!;
    await this.guard(live, live.origin, beforeWrite);
    live.client?.send({ kind: 'speed', speed });
    live.view = { ...live.view, run: { ...run, options: { ...run.options, speed } } };
    this.emit();
    return structuredClone(live.view.run);
  }
  async seek(
    id: string,
    timeSeconds: number,
    options: {
      origin?: 'api' | 'ui';
      beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
    } = {},
  ) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
      throw new StorageError(422, 'Replay time must be inside the run duration.');
    const cached = this.runs.get(id);
    if (cached)
      this.cancelReplay(cached, new StorageError(409, 'Replay was replaced by another seek.'));
    const releaseWorker = this.reserveWorker();
    try {
      const run = await this.get(id);
      if (timeSeconds > (run.result?.timeSeconds ?? run.options.durationSeconds))
        throw new StorageError(422, 'Replay time must be inside the run duration.');
      const live = this.runs.get(id)!;
      if (live.client && run.status === 'running')
        throw new StorageError(409, 'Pause the run before replaying.');
      const origin = options.origin ?? live.origin;
      await this.guard(live, origin, options.beforeWrite);
      if (this.runs.get(id) !== live)
        throw new StorageError(409, 'Replay run was unloaded before execution could start.');
      this.cancelReplay(live, new StorageError(409, 'Replay was replaced by another seek.'));
      this.watchPermissions();
      return new Promise<SimulationState>((resolve, reject) => {
        const token = Symbol('replay');
        live.replayToken = token;
        live.replayOrigin = origin;
        live.replayReject = reject;
        let seeking = false;
        try {
          live.replayClient = new SimulationClient(
            run.model,
            { ...run.options, startPaused: true },
            (update) => {
              if (live.replayToken !== token || live.operation.signal.aborted) return;
              if (update.kind === 'error') {
                this.cancelReplay(live, new Error(update.message));
                return;
              }
              if (!seeking) {
                seeking = true;
                live.replayClient?.send({ kind: 'seek', timeSeconds });
                return;
              }
              live.view = { ...live.view, state: update.state, replayTimeSeconds: timeSeconds };
              this.cancelReplay(live);
              this.emit();
              resolve(structuredClone(update.state));
            },
          );
        } catch (error) {
          this.cancelReplay(live, error as Error);
        }
      }).then(async (state) => {
        await live.operation.check();
        return state;
      });
    } finally {
      releaseWorker();
    }
  }
  async compare(ids: string[]) {
    return this.withOperation(async (operation) => {
      if (ids.length < 2)
        throw new StorageError(422, 'Select a baseline and at least one scenario run.');
      const runs = await Promise.all(ids.map((id) => this.get(id)));
      await operation.check();
      const currencies = [...new Set(runs.map((run) => run.model.currency))];
      if (currencies.length > 1) throw new SimulationCurrencyError(currencies);
      const results = await Promise.all(ids.map((id) => this.result(id)));
      return {
        baselineRunId: ids[0],
        currency: currencies[0],
        comparisons: results.slice(1).map((result) => compareSimulationResults(results[0], result)),
      };
    });
  }
  dispose() {
    this.generation++;
    this.permissionRefresh++;
    for (const [id, live] of this.runs) this.removeLive(id, live);
    this.runs.clear();
    this.activeRuns.clear();
    this.selectedRunId = undefined;
    this.emit();
    this.observer?.();
    this.observer = undefined;
  }
}
export const simulationService = new SimulationService();
