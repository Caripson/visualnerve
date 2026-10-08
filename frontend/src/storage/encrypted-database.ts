import type { CsvDataset } from '../data/types';
import type { Diagram, Graph } from '../model/types';
import { VaultLogicalRecordCodec } from '../security/vault-logical-record';
import { VaultSession, type VaultSessionOperation } from '../security/vault-session';
import { VaultStorageError } from '../security/vault-storage';
import {
  VaultWorkspaceRecords,
  type VaultWorkspaceRecordScope,
} from '../security/vault-workspace-records';
import { VaultWorkspaceTable } from '../security/vault-table';
import type { WorkspaceBackup } from './database';
import {
  WORKSPACE_SCHEMA_VERSION,
  workspaceStoreNames,
  type WorkspaceChange,
  type WorkspaceOperation,
  type WorkspaceRecordMap,
  type WorkspaceScope,
  type WorkspaceStoreName,
  type WorkspaceTable,
  type WorkspaceTables,
} from './contracts';
import {
  graphStoreNames,
  initializeWorkspace,
  readWorkspaceGraph,
  readWorkspaceBackup,
} from './operations';
const invalid = (message: string): never => {
  throw new VaultStorageError(422, 'INVALID_WORKSPACE_TRANSACTION', message);
};
/** One encrypted backend for UI, API and MCP. Plaintext belongs to unlocked operations. */
export class EncryptedWorkspaceDatabase implements WorkspaceScope {
  declare diagrams: WorkspaceTables['diagrams'];
  declare nodes: WorkspaceTables['nodes'];
  declare edges: WorkspaceTables['edges'];
  declare owners: WorkspaceTables['owners'];
  declare settings: WorkspaceTables['settings'];
  declare templates: WorkspaceTables['templates'];
  declare datasets: WorkspaceTables['datasets'];
  declare historySnapshots: WorkspaceTables['historySnapshots'];
  declare historyContents: WorkspaceTables['historyContents'];
  declare historySources: WorkspaceTables['historySources'];
  declare historyRows: WorkspaceTables['historyRows'];
  declare simulationModels: WorkspaceTables['simulationModels'];
  declare simulationRuns: WorkspaceTables['simulationRuns'];
  declare simulationCheckpoints: WorkspaceTables['simulationCheckpoints'];
  readonly schemaVersion = WORKSPACE_SCHEMA_VERSION;
  readonly verno = WORKSPACE_SCHEMA_VERSION;
  readonly name: string;
  private root: EncryptedWorkspaceDatabase;
  private records: VaultWorkspaceRecords;
  private handles = new Map<WorkspaceStoreName, WorkspaceTable<unknown>>();
  private listeners = new Set<(change: WorkspaceChange) => void>();
  private datasetCache = new Map<string, { version: number; datasets: CsvDataset[] }>();
  private immutableDatasets = new WeakSet<CsvDataset>();
  private channel?: BroadcastChannel;
  private operationAbort = new AbortController();
  private removeLock?: () => void;
  constructor(
    readonly session: VaultSession,
    private codec: VaultLogicalRecordCodec,
    private scope?: VaultWorkspaceRecordScope,
    root?: EncryptedWorkspaceDatabase,
    private operation?: VaultSessionOperation,
  ) {
    this.name = session.storage.name;
    this.root = root ?? this;
    this.records = root?.records ?? new VaultWorkspaceRecords(session, codec);
    for (const name of workspaceStoreNames)
      Object.defineProperty(this, name, { enumerable: true, get: () => this.table(name) });
    if (!root) this.removeLock = session.onLock(() => this.clearDatasets());
  }
  private table<K extends WorkspaceStoreName>(name: K): WorkspaceTable<WorkspaceRecordMap[K]> {
    if (this.scope) return this.scope.table(name);
    let table = this.handles.get(name);
    if (!table) {
      const inaccessible = (): never => invalid('Use an explicit workspace transaction.');
      table = new VaultWorkspaceTable(name, {
        get: inaccessible,
        entries: inaccessible,
        put: inaccessible,
        delete: inaccessible,
        run: (mode, work) =>
          this.atomic(mode, [name], (scope) =>
            work((scope as EncryptedWorkspaceDatabase).scope!.access(name)),
          ),
      });
      this.handles.set(name, table);
    }
    return table as WorkspaceTable<WorkspaceRecordMap[K]>;
  }
  get tables() {
    return (this.scope?.storeNames ?? workspaceStoreNames).map((name) => this.table(name));
  }
  get inTransaction() {
    return !!this.scope;
  }
  async open() {
    if (this.scope) invalid('Open the workspace outside a transaction.');
    if (this.operation) await this.operation.check();
    else await this.session.verify();
    this.root.connect();
    return this;
  }
  close() {
    if (this.scope || this !== this.root)
      invalid('Close the root workspace outside a transaction.');
    this.operationAbort.abort();
    this.operationAbort = new AbortController();
    this.clearDatasets();
    this.channel?.close();
    this.channel = undefined;
    this.listeners.clear();
    this.session.storage.close();
  }
  dispose() {
    this.close();
    this.removeLock?.();
    this.removeLock = undefined;
  }
  private child(scope: VaultWorkspaceRecordScope) {
    return new EncryptedWorkspaceDatabase(
      this.session,
      this.codec,
      scope,
      this.root,
      this.operation,
    );
  }
  async atomic<T>(
    mode: 'r' | 'rw',
    stores: readonly WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    if (!stores.length || stores.some((name) => !workspaceStoreNames.includes(name)))
      invalid('Invalid workspace transaction scope.');
    if (this.scope) return this.scope.atomic(mode, stores, (scope) => work(this.child(scope)));
    return this.records.atomic(
      mode,
      stores,
      async (scope) => {
        if (mode === 'rw') scope.afterCommit(() => this.root.publish(stores));
        return work(this.child(scope));
      },
      this.operation,
    );
  }
  afterCommit(action: () => void) {
    if (!this.scope) invalid('A commit hook requires a workspace transaction.');
    this.scope!.afterCommit(action);
  }
  async captureOperation(): Promise<WorkspaceOperation> {
    if (this.scope) invalid('Start long-running work outside a transaction.');
    if (this.operation) await this.operation.check();
    const source = this.operation
      ? AbortSignal.any([this.root.operationAbort.signal, this.operation.signal])
      : this.root.operationAbort.signal;
    const capability = await this.session.captureOperation(source);
    try {
      if (this.operation) await this.operation.check();
    } catch (error) {
      capability.dispose();
      throw error;
    }
    const storage = new EncryptedWorkspaceDatabase(
      this.session,
      this.codec,
      undefined,
      this.root,
      capability,
    );
    return {
      storage,
      signal: capability.signal,
      check: () => capability.check(),
      dispose: () => capability.dispose(),
    };
  }
  private connect(): void {
    if (this !== this.root) return this.root.connect();
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(`visualnerve-workspace-changes:${this.name}`);
    this.channel.onmessage = ({ data }: MessageEvent) => {
      if (
        data?.type !== 'committed' ||
        !Array.isArray(data.stores) ||
        data.stores.some(
          (name: unknown) => !workspaceStoreNames.includes(name as WorkspaceStoreName),
        )
      )
        return;
      this.notify(data.stores);
    };
  }
  private notify(stores: readonly WorkspaceStoreName[]) {
    if (stores.includes('datasets') || stores.includes('diagrams')) this.clearDatasets();
    const change = Object.freeze({ stores: Object.freeze([...new Set(stores)]) });
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        /* a committed transaction cannot be undone by an observer */
      }
    }
  }
  private publish(stores: readonly WorkspaceStoreName[]) {
    this.connect();
    this.notify(stores);
    this.channel?.postMessage({ type: 'committed', stores: [...new Set(stores)] });
  }
  subscribe(listener: (change: WorkspaceChange) => void) {
    this.root.connect();
    this.root.listeners.add(listener);
    return () => {
      this.root.listeners.delete(listener);
    };
  }
  private clearDatasets() {
    this.root.datasetCache.clear();
  }
  forgetDatasets() {
    if (this.scope) this.afterCommit(() => this.clearDatasets());
    else this.clearDatasets();
  }
  rememberDataset(diagram: Diagram, dataset?: CsvDataset, additional: CsvDataset[] = []) {
    this.operation?.assertActive();
    this.session.assertUnlocked();
    const remember = () => {
      const datasets = [...(dataset ? [dataset] : []), ...additional];
      for (const dataset of datasets)
        if (!this.root.immutableDatasets.has(dataset)) {
          dataset.rows.forEach(Object.freeze);
          dataset.columns.forEach(Object.freeze);
          Object.freeze(dataset.rows);
          Object.freeze(dataset.columns);
          Object.freeze(dataset);
          this.root.immutableDatasets.add(dataset);
        }
      this.root.datasetCache.delete(diagram.id);
      this.root.datasetCache.set(diagram.id, { version: diagram.version, datasets });
      while (this.root.datasetCache.size > 3)
        this.root.datasetCache.delete(this.root.datasetCache.keys().next().value!);
    };
    if (this.scope) this.afterCommit(remember);
    else remember();
  }
  async initialize() {
    await this.atomic('rw', ['settings', 'templates'], initializeWorkspace);
  }
  graph(id: string): Promise<Graph | undefined> {
    return this.atomic('r', graphStoreNames, async (scope) => {
      const graph = await readWorkspaceGraph(scope, id, (diagram) => {
        const cached = this.root.datasetCache.get(diagram.id);
        return cached?.version === diagram.version ? cached.datasets : undefined;
      });
      if (graph) scope.rememberDataset(graph.diagram, graph.dataset, graph.datasets);
      return graph;
    });
  }
  backup(): Promise<WorkspaceBackup> {
    return this.atomic('r', workspaceStoreNames, readWorkspaceBackup);
  }
}
