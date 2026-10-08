import { liveQuery } from 'dexie';
import { database, type WorkspaceDatabase } from '../storage/database';
import { StorageError } from '../model/validation';
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
  replayReject?: (error: Error) => void;
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
  private store: SimulationRunStore;
  private runs = new Map<string, LiveRun>();
  private activeRuns = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private observer?: { unsubscribe(): void };
  private selectedRunId?: string;
  private pendingWorkers = 0;
  constructor(private db: WorkspaceDatabase = database) {
    this.store = new SimulationRunStore(db);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  version = () => this.revision;
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
    this.observer = liveQuery(async () => ({
      consent: (await this.db.settings.get('storage-consent'))?.value === true,
      write: (await this.db.settings.get('mcp-access'))?.value === 'write',
      diagrams: new Set((await this.db.diagrams.toArray()).map((diagram) => diagram.id)),
    })).subscribe({
      next: ({ consent, write, diagrams }) => {
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
      },
      error: () => {},
    });
  }
  async start(
    diagramId: string,
    model: SimulationModel,
    input: SimulationStartOptions = {},
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
    try {
      if ((await this.db.settings.get('storage-consent'))?.value !== true)
        throw new StorageError(403, 'Accept local browser storage before running a simulation.');
      if (!(await this.db.diagrams.get(diagramId)))
        throw new StorageError(404, 'Diagram not found.');
      const { origin: _origin, ...executionInput } = input;
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
      await this.db.transaction(
        'rw',
        [this.db.settings, this.db.diagrams, this.db.simulationRuns, this.db.simulationCheckpoints],
        async () => {
          if ((await this.db.settings.get('storage-consent'))?.value !== true)
            throw new StorageError(
              403,
              'Accept local browser storage before running a simulation.',
            );
          if (
            input.origin === 'api' &&
            (await this.db.settings.get('mcp-access'))?.value !== 'write'
          )
            throw new StorageError(403, 'Simulation execution requires MCP write access.');
          await this.store.put(run);
        },
      );
      const live: LiveRun = {
        view: { run },
        origin: input.origin ?? 'ui',
        writes: Promise.resolve(),
      };
      this.runs.set(run.id, live);
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
      releaseWorker();
    }
  }
  private update(id: string, update: WorkerUpdate) {
    const live = this.runs.get(id);
    if (!live) return;
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
      live.writes = live.writes
        .then(async () => {
          if ((await this.db.settings.get('storage-consent'))?.value !== true)
            throw new StorageError(
              403,
              'Local storage consent was revoked before the result could be saved.',
            );
          if (!(await this.db.diagrams.get(run.diagramId)))
            throw new StorageError(
              404,
              'Simulation document was deleted before the result could be saved.',
            );
          await this.store.put(run);
          if (live.view.state)
            await this.store.putCheckpoint(id, live.view.state.timeSeconds, live.view.state);
        })
        .catch((error) => {
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
          this.prune(id);
          this.emit();
        });
    } else this.emit();
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
        this.runs.delete(id);
    }
    for (const [id, live] of this.runs) {
      if (this.runs.size <= simulationRuntimeLimits.cachedRuns) break;
      if (id !== keep && id !== this.selectedRunId && !live.client && !live.replayClient)
        this.runs.delete(id);
    }
  }
  async list(diagramId: string) {
    await Promise.all(
      [...this.runs.values()]
        .filter((live) => live.view.run.diagramId === diagramId && !live.client)
        .map((live) => live.writes),
    );
    const persisted = await this.store.list(diagramId);
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
          ? (run.model.scenarios.find((scenario) => scenario.id === run.options.scenarioId)?.name ??
            `Scenario ${run.options.scenarioId}`)
          : 'Baseline',
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        metrics: run.result?.metrics,
        error: run.error,
      }));
  }
  async get(id: string): Promise<SimulationRunInfo> {
    const live = this.runs.get(id);
    if (live) {
      if (['completed', 'stopped', 'failed'].includes(live.view.run.status)) await live.writes;
      this.runs.delete(id);
      this.runs.set(id, live);
      return structuredClone(live.view.run);
    }
    const stored = await this.store.get(id);
    // Simultaneous archive reads must converge on the same LiveRun/worker owner.
    if (this.runs.has(id)) return this.get(id);
    if (!stored) throw new StorageError(404, 'Simulation run not found.');
    const run = stored as SimulationRunInfo;
    if (['running', 'paused', 'ready'].includes(run.status)) {
      run.status = 'stopped';
      run.error =
        'Execution ended when this browser was closed. Start a new run or replay the saved model.';
    }
    this.runs.set(id, {
      view: { run, state: run.result },
      origin: 'ui',
      writes: Promise.resolve(),
    });
    this.prune(id);
    this.emit();
    return structuredClone(run);
  }
  async state(id: string): Promise<SimulationState> {
    const run = await this.get(id);
    if (run.error?.startsWith('Result could not be saved:')) throw new StorageError(500, run.error);
    const state = this.runs.get(id)?.view.state ?? run.result;
    if (!state) throw new StorageError(409, 'Simulation is initializing; retry this read.');
    return structuredClone(state);
  }
  async result(id: string): Promise<SimulationResult> {
    const run = await this.get(id);
    if (run.error?.startsWith('Result could not be saved:')) throw new StorageError(500, run.error);
    if (!run.result) throw new StorageError(409, 'This run has no final result yet.');
    return structuredClone(run.result);
  }
  async events(id: string, paging: { offset?: number; limit?: number } = {}) {
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
  }
  async control(
    id: string,
    action: 'pause' | 'resume' | 'stop' | 'reset',
    options: { origin?: 'api' | 'ui' } = {},
  ) {
    const run = await this.get(id);
    const live = this.runs.get(id)!;
    if (action === 'reset') {
      if (live.client) await this.control(id, 'stop');
      return this.start(run.diagramId, run.model, {
        ...run.options,
        origin: options.origin ?? live.origin,
        startPaused: true,
      });
    }
    if (!live.client || ['completed', 'failed', 'stopped'].includes(run.status))
      throw new StorageError(
        409,
        'This run has finished. Start a new run to change its execution.',
      );
    const expected = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'running';
    return new Promise<SimulationRunInfo>((resolve, reject) => {
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
  }
  async setSpeed(id: string, speed: SimulationSpeed) {
    if (![1, 10, 100, 'max'].includes(speed))
      throw new StorageError(422, 'Simulation speed must be 1, 10, 100 or max.');
    const run = await this.get(id);
    const live = this.runs.get(id)!;
    live.client?.send({ kind: 'speed', speed });
    live.view = { ...live.view, run: { ...run, options: { ...run.options, speed } } };
    this.emit();
    return structuredClone(live.view.run);
  }
  async seek(id: string, timeSeconds: number, options: { origin?: 'api' | 'ui' } = {}) {
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
      await this.db.transaction('r', [this.db.settings, this.db.diagrams], async () => {
        if ((await this.db.settings.get('storage-consent'))?.value !== true)
          throw new StorageError(
            403,
            'Accept local browser storage before replaying a simulation.',
          );
        if (!(await this.db.diagrams.get(run.diagramId)))
          throw new StorageError(404, 'Simulation document was deleted.');
        if (origin === 'api' && (await this.db.settings.get('mcp-access'))?.value !== 'write')
          throw new StorageError(403, 'Simulation replay requires MCP write access.');
      });
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
              if (live.replayToken !== token) return;
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
      });
    } finally {
      releaseWorker();
    }
  }
  async compare(ids: string[]) {
    if (ids.length < 2)
      throw new StorageError(422, 'Select a baseline and at least one scenario run.');
    const runs = await Promise.all(ids.map((id) => this.get(id)));
    const currencies = [...new Set(runs.map((run) => run.model.currency))];
    if (currencies.length > 1) throw new SimulationCurrencyError(currencies);
    const results = await Promise.all(ids.map((id) => this.result(id)));
    return {
      baselineRunId: ids[0],
      currency: currencies[0],
      comparisons: results.slice(1).map((result) => compareSimulationResults(results[0], result)),
    };
  }
  dispose() {
    for (const run of this.runs.values()) {
      run.client?.dispose();
      this.cancelReplay(run, new StorageError(409, 'Simulation service was closed.'));
    }
    this.runs.clear();
    this.activeRuns.clear();
    this.selectedRunId = undefined;
    this.emit();
    this.observer?.unsubscribe();
    this.observer = undefined;
  }
}
export const simulationService = new SimulationService();
