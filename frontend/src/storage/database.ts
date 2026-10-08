import Dexie, {
  type Collection,
  type EntityTable,
  type IndexableType,
  type ObservabilitySet,
  type Table,
  type Transaction,
  type UpdateSpec,
} from 'dexie';
import type { CsvDataset } from '../data/types';
import {
  type Diagram,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';
import type {
  HistoryBackup,
  HistoryContent,
  HistoryRows,
  HistorySnapshot,
  HistorySource,
} from '../history/types';
import {
  graphStoreNames,
  initializeWorkspace,
  readWorkspaceGraph,
  readWorkspaceBackup,
} from './operations';
import type {
  SimulationModelRecord,
  SimulationRunRecord,
  SimulationCheckpointRecord,
} from '../simulation/storage';
import { StorageError } from '../model/errors';
import {
  WORKSPACE_SCHEMA_VERSION,
  workspaceStoreDefinitions,
  workspaceStoreNames,
  type WorkspaceChange,
  type WorkspaceIndexKey,
  type WorkspaceMetadata,
  type WorkspaceQuery,
  type WorkspaceRecordMap,
  type WorkspaceScope,
  type WorkspaceStorage,
  type WorkspaceStoreName,
  type WorkspaceTable,
  type WorkspaceTables,
  type WorkspaceWhere,
  type WorkspaceOperation,
} from './contracts';
export interface Setting {
  key: string;
  value: unknown;
}
export interface TemplateRecord {
  id: string;
  name: string;
  graph: Graph;
  builtin: boolean;
}
export interface WorkspaceBackup {
  format: 'visual-nerve-workspace';
  formatVersion: 1;
  schemaVersion?: number;
  exportedAt?: string;
  diagrams: Diagram[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  owners: Owner[];
  settings: Setting[];
  templates: TemplateRecord[];
  datasets?: CsvDataset[];
  history?: HistoryBackup;
  simulationModels?: SimulationModelRecord[];
  simulationRuns?: SimulationRunRecord[];
  simulationCheckpoints?: SimulationCheckpointRecord[];
}

export class WorkspaceDatabase extends Dexie {
  private storageAdapter?: LegacyWorkspaceStorage;
  private datasetCache = new Map<string, { diagramVersion: number; datasets: CsvDataset[] }>();
  private immutableDatasets = new WeakSet<CsvDataset>();
  private datasetMutation = (parts: ObservabilitySet) => {
    if (Object.keys(parts).some((part) => part.startsWith(`idb://${this.name}/datasets/`)))
      this.forgetDatasets();
  };
  diagrams!: EntityTable<Diagram, 'id'>;
  nodes!: EntityTable<GraphNode, 'id'>;
  edges!: EntityTable<GraphEdge, 'id'>;
  owners!: EntityTable<Owner, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  templates!: EntityTable<TemplateRecord, 'id'>;
  datasets!: EntityTable<CsvDataset, 'id'>;
  historySnapshots!: EntityTable<HistorySnapshot, 'id'>;
  historyContents!: EntityTable<HistoryContent, 'id'>;
  historySources!: EntityTable<HistorySource, 'id'>;
  historyRows!: EntityTable<HistoryRows, 'id'>;
  simulationModels!: EntityTable<SimulationModelRecord, 'diagramId'>;
  simulationRuns!: EntityTable<SimulationRunRecord, 'id'>;
  simulationCheckpoints!: EntityTable<SimulationCheckpointRecord, 'id'>;
  get schemaVersion() {
    return WORKSPACE_SCHEMA_VERSION;
  }
  /** Explicit adapter; inherited Dexie tables/transaction remain available for legacy callers. */
  asStorage(): WorkspaceStorage {
    return (this.storageAdapter ??= new LegacyWorkspaceStorage(this));
  }
  atomic<T>(
    mode: 'r' | 'rw',
    stores: readonly WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    return this.asStorage().atomic(mode, stores, work);
  }
  subscribe(listener: (change: WorkspaceChange) => void) {
    return this.asStorage().subscribe(listener);
  }
  constructor(name = 'visual-nerve-cache') {
    // Retain the historical database name to upgrade existing browser data in place.
    super(name);
    this.version(1).stores({
      diagrams: 'id,updatedAt,name,folder,*tags',
      graphs: 'id',
      owners: 'id,name,team',
      state: 'id',
    });
    this.version(2)
      .stores({
        diagrams: 'id,name,type,updatedAt,folder,*tags',
        nodes: 'id,diagramId,&[diagramId+externalId],updatedAt,nodeType,status,parentId,*ownerIds',
        edges: 'id,diagramId,&[diagramId+externalId],sourceNodeId,targetNodeId,updatedAt',
        owners: 'id,&externalId,name,kind,team,updatedAt',
        settings: 'key',
        templates: 'id,name',
      })
      .upgrade(async (tx) => {
        const legacy = (await tx.table('graphs').toArray()) as { graph: Graph }[];
        for (const { graph } of legacy) {
          await tx.table('diagrams').put({
            ...graph.diagram,
            settings: {
              ...graph.diagram.settings,
              entityOrder: {
                nodes: graph.nodes.map((node) => node.id),
                edges: graph.edges.map((edge) => edge.id),
              },
            },
          });
          await tx.table('nodes').bulkPut(graph.nodes);
          await tx.table('edges').bulkPut(graph.edges);
          for (const owner of graph.owners) {
            const current = (await tx.table('owners').get(owner.id)) as Owner | undefined;
            if (!current || current.version < owner.version) await tx.table('owners').put(owner);
          }
        }
        const old = (await tx.table('state').toArray()) as { id: string; value: unknown }[];
        await tx
          .table('settings')
          .bulkPut(old.map((record) => ({ key: record.id, value: record.value })));
      });
    this.version(3).stores({ graphs: null, state: null });
    this.version(4)
      .stores({ settings: 'key' })
      .upgrade(async (tx) => {
        await tx.table('settings').delete('integration-enabled');
      });
    this.version(5).stores({ datasets: 'id,&diagramId,updatedAt' });
    this.version(6).stores({ datasets: 'id,diagramId,updatedAt' });
    this.version(7).stores({
      historySnapshots: 'id,diagramId,createdAt,contentId,*sourceIds',
      historyContents: 'id,diagramId,bytes',
      historySources: 'id,diagramId,&[diagramId+datasetId+datasetVersion],rowId,bytes',
      historyRows: 'id,diagramId,bytes',
    });
    // Additive upgrade: ordinary documents retain their original records and types.
    this.version(8).stores({
      simulationModels: 'diagramId,diagramVersion',
      simulationRuns: 'id,diagramId,createdAt,status',
      simulationCheckpoints: 'id,runId,diagramId,[runId+timeSeconds]',
    });
    this.on(
      'ready',
      () => {
        Dexie.on.storagemutated.unsubscribe(this.datasetMutation);
        Dexie.on.storagemutated.subscribe(this.datasetMutation);
      },
      true,
    );
    this.on('close', () => {
      Dexie.on.storagemutated.unsubscribe(this.datasetMutation);
      this.forgetDatasets();
    });
    this.on('versionchange', () => this.close());
  }
  forgetDatasets() {
    this.datasetCache.clear();
  }
  rememberDataset(diagram: Diagram, dataset?: CsvDataset, additional: CsvDataset[] = []) {
    const datasets = [...(dataset ? [dataset] : []), ...additional];
    // Raw cells are immutable. Normal edits share this object without copying
    // or fetching a large dataset again. The committed diagram version changes
    // on every repository write, including source replacement in another tab.
    for (const dataset of datasets)
      if (!this.immutableDatasets.has(dataset)) {
        dataset.rows.forEach(Object.freeze);
        dataset.columns.forEach(Object.freeze);
        Object.freeze(dataset.rows);
        Object.freeze(dataset.columns);
        Object.freeze(dataset);
        this.immutableDatasets.add(dataset);
      }
    const remember = () => {
      this.datasetCache.delete(diagram.id);
      this.datasetCache.set(diagram.id, { diagramVersion: diagram.version, datasets });
      // Keep the active source and a few recent projects without retaining
      // every large dataset ever opened during this browser session.
      while (this.datasetCache.size > 3)
        this.datasetCache.delete(this.datasetCache.keys().next().value!);
    };
    let transaction = Dexie.currentTransaction;
    // import/restore/bulk call graph/saveGraph in nested transactions. A nested
    // scope can finish while the outer write later rolls back.
    while (transaction?.parent) transaction = transaction.parent;
    if (transaction) transaction.on('complete', remember);
    else remember();
  }
  cachedDatasets(diagram: Diagram) {
    const cached = this.datasetCache.get(diagram.id);
    return cached?.diagramVersion === diagram.version ? cached.datasets : undefined;
  }
  initialize() {
    return this.asStorage().initialize();
  }
  graph(id: string): Promise<Graph | undefined> {
    return this.asStorage().graph(id);
  }
  backup(): Promise<WorkspaceBackup> {
    return this.asStorage().backup();
  }
}

function indexKey(value: IndexableType): WorkspaceIndexKey {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (
    Array.isArray(value) &&
    value.every((part) => typeof part === 'string' || typeof part === 'number')
  )
    return value as (string | number)[];
  throw new StorageError(422, 'Unsupported workspace index value.');
}
class LegacyWorkspaceQuery<T> implements WorkspaceQuery<T> {
  constructor(
    private collection: Collection<T, string, T>,
    private check: (write?: boolean) => void,
  ) {}
  toArray() {
    this.check();
    return this.collection.toArray();
  }
  first() {
    this.check();
    return this.collection.first();
  }
  count() {
    this.check();
    return this.collection.count();
  }
  async keys() {
    this.check();
    return (await this.collection.keys()).map(indexKey);
  }
  primaryKeys() {
    this.check();
    return this.collection.primaryKeys();
  }
  eachKey(callback: (value: WorkspaceIndexKey, cursor: { primaryKey: string }) => void) {
    this.check();
    return this.collection.eachKey((value, cursor) =>
      callback(indexKey(value), { primaryKey: cursor.primaryKey }),
    );
  }
  filter(predicate: (record: T) => boolean) {
    this.check();
    return new LegacyWorkspaceQuery(this.collection.clone().filter(predicate), this.check);
  }
  limit(count: number) {
    this.check();
    return new LegacyWorkspaceQuery(this.collection.clone().limit(count), this.check);
  }
  reverse() {
    this.check();
    return new LegacyWorkspaceQuery(this.collection.clone().reverse(), this.check);
  }
  delete() {
    this.check(true);
    return this.collection.delete();
  }
}
class LegacyWorkspaceTable<T> implements WorkspaceTable<T> {
  constructor(
    readonly name: WorkspaceStoreName,
    private native: Table<T, string, T>,
    private check: (write?: boolean) => void,
  ) {}
  get(id: string) {
    this.check();
    return this.native.get(id);
  }
  bulkGet(ids: readonly string[]) {
    this.check();
    return this.native.bulkGet([...ids]);
  }
  toArray() {
    this.check();
    return this.native.toArray();
  }
  count() {
    this.check();
    return this.native.count();
  }
  put(record: T) {
    this.check(true);
    return this.native.put(record);
  }
  add(record: T) {
    this.check(true);
    return this.native.add(record);
  }
  bulkPut(records: readonly T[]) {
    this.check(true);
    return this.native.bulkPut(records);
  }
  bulkDelete(ids: readonly string[]) {
    this.check(true);
    return this.native.bulkDelete([...ids]);
  }
  update(id: string, changes: Partial<T>) {
    this.check(true);
    return this.native.update(id, changes as UpdateSpec<T>);
  }
  delete(id: string) {
    this.check(true);
    return this.native.delete(id);
  }
  clear() {
    this.check(true);
    return this.native.clear();
  }
  private indexed(index: string) {
    this.check();
    const schema = workspaceStoreDefinitions[this.name];
    if (index !== schema.primaryKey && !Object.hasOwn(schema.indexes, index))
      throw new StorageError(422, 'Unknown workspace query index.');
  }
  where(index: string): WorkspaceWhere<T> {
    this.indexed(index);
    const clause = this.native.where(index);
    return {
      equals: (value) => {
        this.check();
        return new LegacyWorkspaceQuery(clause.equals(value), this.check);
      },
      notEqual: (value) => {
        this.check();
        return new LegacyWorkspaceQuery(clause.notEqual(value), this.check);
      },
    };
  }
  orderBy(index: string) {
    this.indexed(index);
    return new LegacyWorkspaceQuery(this.native.orderBy(index), this.check);
  }
  filter(predicate: (record: T) => boolean) {
    this.check();
    return new LegacyWorkspaceQuery(this.native.filter(predicate), this.check);
  }
  async metadata(index: string): Promise<WorkspaceMetadata[]> {
    const result: WorkspaceMetadata[] = [];
    await this.orderBy(index).eachKey((value, cursor) =>
      result.push({ id: cursor.primaryKey, value }),
    );
    return result;
  }
}
interface LegacyScopeContext {
  transaction: Transaction;
  stores: ReadonlySet<WorkspaceStoreName>;
  mode: 'r' | 'rw';
  state: { failed: boolean; error?: unknown; callbacks: Array<() => void> };
}
interface LegacyOperationContext {
  signal: AbortSignal;
  check: () => void;
}

/** Actual legacy Dexie transactions, with explicitly bound scopes and no crypto or shadow database. */
export class LegacyWorkspaceStorage implements WorkspaceScope {
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
  private listeners = new Set<(change: WorkspaceChange) => void>();
  private watched = false;
  private root: LegacyWorkspaceStorage;
  private handles = new Map<WorkspaceStoreName, WorkspaceTable<unknown>>();
  private operationAbort = new AbortController();
  constructor(
    private db: WorkspaceDatabase,
    private context?: LegacyScopeContext,
    root?: LegacyWorkspaceStorage,
    private operation?: LegacyOperationContext,
  ) {
    this.root = root ?? this;
    for (const name of workspaceStoreNames)
      Object.defineProperty(this, name, { enumerable: true, get: () => this.table(name) });
  }
  get name() {
    return this.db.name;
  }
  get inTransaction() {
    return !!this.context;
  }
  get schemaVersion() {
    return WORKSPACE_SCHEMA_VERSION;
  }
  get verno() {
    return WORKSPACE_SCHEMA_VERSION;
  }
  get tables() {
    return workspaceStoreNames
      .filter((name) => !this.context || this.context.stores.has(name))
      .map((name) => this.table(name));
  }
  private check(name?: WorkspaceStoreName, write = false) {
    this.operation?.check();
    if (!this.context) return;
    if (this.context.state.failed) throw this.context.state.error;
    if (!this.context.transaction.active)
      throw new StorageError(409, 'The workspace transaction has ended.');
    if (name && !this.context.stores.has(name))
      throw new StorageError(422, 'Store is outside the workspace transaction.');
    if (write && this.context.mode !== 'rw')
      throw new StorageError(403, 'The workspace transaction is read-only.');
  }
  private table<K extends WorkspaceStoreName>(name: K): WorkspaceTable<WorkspaceRecordMap[K]> {
    this.check(name);
    let table = this.handles.get(name);
    if (!table) {
      const native = this.context
        ? this.context.transaction.table<WorkspaceRecordMap[K], string, WorkspaceRecordMap[K]>(name)
        : this.db.table<WorkspaceRecordMap[K], string, WorkspaceRecordMap[K]>(name);
      table = new LegacyWorkspaceTable(name, native, (write) => this.check(name, write));
      this.handles.set(name, table);
    }
    return table as WorkspaceTable<WorkspaceRecordMap[K]>;
  }
  open() {
    this.check();
    return this.db.open();
  }
  close() {
    this.check();
    if (this.context) throw new StorageError(422, 'Close the workspace outside its transaction.');
    this.root.operationAbort.abort();
    this.root.operationAbort = new AbortController();
    this.db.close();
    if (this.watched) Dexie.on.storagemutated.unsubscribe(this.changed);
    this.watched = false;
    this.listeners.clear();
  }
  async atomic<T>(
    mode: 'r' | 'rw',
    stores: readonly WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    this.check(undefined, mode === 'rw');
    if (
      !['r', 'rw'].includes(mode) ||
      !stores.length ||
      stores.some((name) => !workspaceStoreNames.includes(name))
    )
      throw new StorageError(422, 'Invalid workspace transaction scope.');
    for (const name of stores) this.check(name);
    const selected = new Set(stores);
    if (this.context) {
      try {
        return await work(
          new LegacyWorkspaceStorage(
            this.db,
            { ...this.context, stores: selected, mode },
            this.root,
            this.operation,
          ),
        );
      } catch (error) {
        // A caller may catch an inner error; its partial writes still cannot commit.
        this.context.state.failed = true;
        this.context.state.error = error;
        throw error;
      }
    }
    const outer = Dexie.currentTransaction;
    const state = {
      failed: false,
      error: undefined as unknown,
      callbacks: [] as Array<() => void>,
    };
    const result = await this.db.transaction(
      mode,
      [...selected].map((name) => this.db.table(name)),
      (transaction) => {
        return Dexie.waitFor(
          (async () => {
            const result = await work(
              new LegacyWorkspaceStorage(
                this.db,
                { transaction, stores: selected, mode, state },
                this.root,
                this.operation,
              ),
            );
            if (state.failed) throw state.error;
            return result;
          })(),
        );
      },
    );
    const publish = () => {
      for (const callback of state.callbacks) callback();
      state.callbacks.length = 0;
    };
    if (outer) {
      let parent = outer;
      while (parent.parent) parent = parent.parent;
      // Dexie's mutation event follows its complete event. Publish cached source
      // identities after invalidation and only after the real outer commit.
      parent.on('complete', () => queueMicrotask(publish));
    } else publish();
    return result;
  }
  afterCommit(action: () => void) {
    this.check();
    if (!this.context)
      throw new StorageError(422, 'A commit hook requires a workspace transaction.');
    this.context.state.callbacks.push(action);
  }
  private changed = (parts: ObservabilitySet) => {
    const paths = Object.keys(parts);
    const stores = workspaceStoreNames.filter((name) =>
      paths.some((path) => path.startsWith(`idb://${this.name}/${name}/`)),
    );
    if (!stores.length) return;
    const change = Object.freeze({ stores: Object.freeze(stores) });
    for (const listener of this.listeners) listener(change);
  };
  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    this.check();
    if (this !== this.root) return this.root.subscribe(listener);
    this.listeners.add(listener);
    if (!this.watched) {
      this.watched = true;
      Dexie.on.storagemutated.subscribe(this.changed);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.watched) {
        this.watched = false;
        Dexie.on.storagemutated.unsubscribe(this.changed);
      }
    };
  }
  private domain(stores: readonly WorkspaceStoreName[], write = false) {
    this.check(undefined, write);
    for (const name of stores) this.check(name);
  }
  async initialize() {
    this.domain(['settings', 'templates'], true);
    if (!this.context) await this.open();
    await this.atomic('rw', ['settings', 'templates'], initializeWorkspace);
  }
  graph(id: string) {
    this.domain(graphStoreNames);
    return this.atomic('r', graphStoreNames, async (scope) => {
      const graph = await readWorkspaceGraph(scope, id, (diagram) =>
        this.db.cachedDatasets(diagram),
      );
      if (graph) scope.rememberDataset(graph.diagram, graph.dataset, graph.datasets);
      return graph;
    });
  }
  backup() {
    this.domain(workspaceStoreNames);
    return this.atomic('r', workspaceStoreNames, readWorkspaceBackup);
  }
  forgetDatasets() {
    this.check();
    if (this.context) this.afterCommit(() => this.db.forgetDatasets());
    else this.db.forgetDatasets();
  }
  async captureOperation(): Promise<WorkspaceOperation> {
    this.check();
    if (this.context) throw new StorageError(422, 'Start long-running work outside a transaction.');
    const signal = this.root.operationAbort.signal;
    let disposed = false;
    const check = () => {
      this.operation?.check();
      if (disposed || signal.aborted)
        throw new StorageError(423, 'This workspace operation has ended.');
    };
    const storage = new LegacyWorkspaceStorage(this.db, undefined, this.root, { signal, check });
    return {
      signal,
      storage,
      check: async () => check(),
      dispose: () => {
        disposed = true;
      },
    };
  }
  rememberDataset(diagram: Diagram, dataset?: CsvDataset, additional: CsvDataset[] = []) {
    this.check();
    if (this.context) this.afterCommit(() => this.db.rememberDataset(diagram, dataset, additional));
    else this.db.rememberDataset(diagram, dataset, additional);
  }
}
export const database = new WorkspaceDatabase();
export const legacyStorage = database.asStorage();
