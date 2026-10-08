import type { WorkspaceOperation, WorkspaceStorage } from '../storage/contracts';

const cancelled = () => new DOMException('This simulation action was cancelled.', 'AbortError');

/** UI continuations borrow a session; the engine retains its own run capability. */
export class SimulationUIAction {
  private operation?: WorkspaceOperation;
  private readonly pending: Promise<WorkspaceOperation>;
  private disposed = false;

  constructor(
    storage: WorkspaceStorage,
    private current: () => boolean,
    private release: () => void,
  ) {
    this.assertCurrent();
    // Acquisition starts synchronously, before any save/worker wait can cross an unlock.
    this.pending = storage.captureOperation().then((operation) => {
      this.operation = operation;
      if (this.disposed) operation.dispose();
      return operation;
    });
    // A cancelled UI may disappear while native acquisition is still settling.
    void this.pending.catch(() => undefined);
  }

  isCurrent = () => !this.disposed && this.current() && !this.operation?.signal.aborted;

  assertCurrent = () => {
    if (!this.isCurrent()) throw cancelled();
    this.operation?.signal.throwIfAborted();
  };

  check = async () => {
    this.assertCurrent();
    const operation = await this.pending;
    await operation.check();
    this.assertCurrent();
  };

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.operation?.dispose();
    this.release();
  };
}

/** Cancels pending UI work without stopping an already-started authoritative run. */
export class SimulationUIActions {
  private mounted = false;
  private lifetime = 0;
  private diagramId?: string;
  private actions = new Map<SimulationUIAction, boolean>();
  revision = 0;

  constructor(
    private storage: () => WorkspaceStorage,
    private currentDiagram: () => string | undefined,
  ) {}

  mount() {
    this.mounted = true;
    this.diagramId = this.currentDiagram();
    return () => {
      this.mounted = false;
      this.lifetime++;
      for (const action of this.actions.keys()) action.dispose();
    };
  }

  observeDiagram() {
    const next = this.currentDiagram();
    if (next === this.diagramId) return;
    this.diagramId = next;
    this.lifetime++;
    this.cancelPending();
    for (const action of this.actions.keys()) action.dispose();
  }

  isCurrent(diagramId: string, revision = this.revision) {
    return this.mounted && this.currentDiagram() === diagramId && revision === this.revision;
  }

  cancelPending() {
    this.revision++;
    for (const [action, interactive] of this.actions) if (interactive) action.dispose();
  }

  begin(diagramId: string, interactive = true) {
    if (interactive)
      for (const [previous, pending] of this.actions) if (pending) previous.dispose();
    const lifetime = this.lifetime;
    const revision = this.revision;
    let action!: SimulationUIAction;
    action = new SimulationUIAction(
      this.storage(),
      () =>
        this.mounted &&
        this.currentDiagram() === diagramId &&
        lifetime === this.lifetime &&
        (!interactive || revision === this.revision),
      () => this.actions.delete(action),
    );
    this.actions.set(action, interactive);
    return action;
  }
}
