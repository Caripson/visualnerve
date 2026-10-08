import type { CsvDataset } from '../data/types';
import type { Graph, Diagram, GraphNode, GraphEdge, Owner } from '../model/types';
import type { HistoryContent, HistoryRows, HistorySnapshot, HistorySource } from '../history/types';
import type {
  SimulationModelRecord,
  SimulationRunRecord,
  SimulationCheckpointRecord,
} from '../simulation/storage';
import type { Setting, TemplateRecord, WorkspaceBackup } from './database';

/** Logical workspace schema, independent of an encrypted backend's physical IDB version. */
export const WORKSPACE_SCHEMA_VERSION = 8;

export interface WorkspaceRecordMap {
  diagrams: Diagram;
  nodes: GraphNode;
  edges: GraphEdge;
  owners: Owner;
  settings: Setting;
  templates: TemplateRecord;
  datasets: CsvDataset;
  historySnapshots: HistorySnapshot;
  historyContents: HistoryContent;
  historySources: HistorySource;
  historyRows: HistoryRows;
  simulationModels: SimulationModelRecord;
  simulationRuns: SimulationRunRecord;
  simulationCheckpoints: SimulationCheckpointRecord;
}
export type WorkspaceStoreName = keyof WorkspaceRecordMap;
export const workspaceStoreNames = [
  'diagrams',
  'nodes',
  'edges',
  'owners',
  'settings',
  'templates',
  'datasets',
  'historySnapshots',
  'historyContents',
  'historySources',
  'historyRows',
  'simulationModels',
  'simulationRuns',
  'simulationCheckpoints',
] as const satisfies readonly WorkspaceStoreName[];

export interface WorkspaceIndexDefinition {
  fields: readonly string[];
  unique?: boolean;
  multiEntry?: boolean;
}
export interface WorkspaceStoreDefinition {
  primaryKey: string;
  indexes: Readonly<Record<string, WorkspaceIndexDefinition>>;
}
const field = (name: string): WorkspaceIndexDefinition => ({ fields: [name] });
const multi = (name: string): WorkspaceIndexDefinition => ({ fields: [name], multiEntry: true });
/** Existing logical index semantics; an encrypted backend protects equality keys. */
export const workspaceStoreDefinitions: Readonly<
  Record<WorkspaceStoreName, WorkspaceStoreDefinition>
> = {
  diagrams: {
    primaryKey: 'id',
    indexes: {
      name: field('name'),
      type: field('type'),
      updatedAt: field('updatedAt'),
      folder: field('folder'),
      tags: multi('tags'),
    },
  },
  nodes: {
    primaryKey: 'id',
    indexes: {
      diagramId: field('diagramId'),
      '[diagramId+externalId]': { fields: ['diagramId', 'externalId'], unique: true },
      updatedAt: field('updatedAt'),
      nodeType: field('nodeType'),
      status: field('status'),
      parentId: field('parentId'),
      ownerIds: multi('ownerIds'),
    },
  },
  edges: {
    primaryKey: 'id',
    indexes: {
      diagramId: field('diagramId'),
      '[diagramId+externalId]': { fields: ['diagramId', 'externalId'], unique: true },
      sourceNodeId: field('sourceNodeId'),
      targetNodeId: field('targetNodeId'),
      updatedAt: field('updatedAt'),
    },
  },
  owners: {
    primaryKey: 'id',
    indexes: {
      externalId: { fields: ['externalId'], unique: true },
      name: field('name'),
      kind: field('kind'),
      team: field('team'),
      updatedAt: field('updatedAt'),
    },
  },
  settings: { primaryKey: 'key', indexes: {} },
  templates: { primaryKey: 'id', indexes: { name: field('name') } },
  datasets: {
    primaryKey: 'id',
    indexes: { diagramId: field('diagramId'), updatedAt: field('updatedAt') },
  },
  historySnapshots: {
    primaryKey: 'id',
    indexes: {
      diagramId: field('diagramId'),
      createdAt: field('createdAt'),
      contentId: field('contentId'),
      sourceIds: multi('sourceIds'),
    },
  },
  historyContents: {
    primaryKey: 'id',
    indexes: { diagramId: field('diagramId'), bytes: field('bytes') },
  },
  historySources: {
    primaryKey: 'id',
    indexes: {
      diagramId: field('diagramId'),
      '[diagramId+datasetId+datasetVersion]': {
        fields: ['diagramId', 'datasetId', 'datasetVersion'],
        unique: true,
      },
      rowId: field('rowId'),
      bytes: field('bytes'),
    },
  },
  historyRows: {
    primaryKey: 'id',
    indexes: { diagramId: field('diagramId'), bytes: field('bytes') },
  },
  simulationModels: {
    primaryKey: 'diagramId',
    indexes: { diagramVersion: field('diagramVersion') },
  },
  simulationRuns: {
    primaryKey: 'id',
    indexes: {
      diagramId: field('diagramId'),
      createdAt: field('createdAt'),
      status: field('status'),
    },
  },
  simulationCheckpoints: {
    primaryKey: 'id',
    indexes: {
      runId: field('runId'),
      diagramId: field('diagramId'),
      '[runId+timeSeconds]': { fields: ['runId', 'timeSeconds'] },
    },
  },
};

export type WorkspaceIndexKey = string | number | readonly (string | number)[];
export interface WorkspaceMetadata {
  id: string;
  value: WorkspaceIndexKey;
}
export interface WorkspaceQuery<T> {
  toArray(): Promise<T[]>;
  first(): Promise<T | undefined>;
  count(): Promise<number>;
  keys(): Promise<WorkspaceIndexKey[]>;
  primaryKeys(): Promise<string[]>;
  eachKey(
    callback: (value: WorkspaceIndexKey, cursor: { primaryKey: string }) => void,
  ): Promise<void>;
  filter(predicate: (record: T) => boolean): WorkspaceQuery<T>;
  limit(count: number): WorkspaceQuery<T>;
  reverse(): WorkspaceQuery<T>;
  delete(): Promise<number>;
}
export interface WorkspaceWhere<T> {
  equals(value: WorkspaceIndexKey): WorkspaceQuery<T>;
  notEqual(value: WorkspaceIndexKey): WorkspaceQuery<T>;
}
export interface WorkspaceTable<T> {
  readonly name: WorkspaceStoreName;
  get(id: string): Promise<T | undefined>;
  bulkGet(ids: readonly string[]): Promise<Array<T | undefined>>;
  toArray(): Promise<T[]>;
  count(): Promise<number>;
  put(record: T): Promise<string>;
  add(record: T): Promise<string>;
  bulkPut(records: readonly T[]): Promise<string>;
  bulkDelete(ids: readonly string[]): Promise<void>;
  update(id: string, changes: Partial<T>): Promise<number>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  where(index: string): WorkspaceWhere<T>;
  orderBy(index: string): WorkspaceQuery<T>;
  filter(predicate: (record: T) => boolean): WorkspaceQuery<T>;
  /** Small unlocked projections; implementations must not load row bodies just to total bytes. */
  metadata(index: string): Promise<WorkspaceMetadata[]>;
}
export type WorkspaceTables = {
  readonly [K in WorkspaceStoreName]: WorkspaceTable<WorkspaceRecordMap[K]>;
};
export interface WorkspaceChange {
  readonly stores: readonly WorkspaceStoreName[];
}
/** A job retains its starting session. Locking aborts it, including after a later unlock. */
export interface WorkspaceOperation {
  readonly signal: AbortSignal;
  readonly storage: WorkspaceStorage;
  check(): Promise<void>;
  dispose(): void;
}
export interface WorkspaceStorage extends WorkspaceTables {
  readonly name: string;
  readonly schemaVersion: number;
  readonly inTransaction: boolean;
  /** Compatibility alias for the logical schema; never the physical encrypted DB version. */
  readonly verno: number;
  readonly tables: readonly WorkspaceTable<unknown>[];
  open(): Promise<unknown>;
  close(): void;
  captureOperation(): Promise<WorkspaceOperation>;
  atomic<T>(
    mode: 'r' | 'rw',
    stores: readonly WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T>;
  subscribe(listener: (change: WorkspaceChange) => void): () => void;
  initialize(): Promise<void>;
  graph(id: string): Promise<Graph | undefined>;
  backup(): Promise<WorkspaceBackup>;
  forgetDatasets(): void;
  rememberDataset(diagram: Diagram, dataset?: CsvDataset, additional?: CsvDataset[]): void;
}
/** Scope and its table handles expire with the transaction; callbacks are synchronous cache updates. */
export interface WorkspaceScope extends WorkspaceStorage {
  afterCommit(action: () => void): void;
}
