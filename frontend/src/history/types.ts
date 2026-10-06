import type { CsvDataset } from '../data/types';
import type { Graph } from '../model/types';

export type HistoryKind = 'named' | 'source-refresh' | 'pre-restore';
export type HistoryGraph = Omit<Graph, 'dataset' | 'datasets'>;
export interface HistorySnapshot {
  id: string;
  diagramId: string;
  name: string;
  kind: HistoryKind;
  createdAt: string;
  graphVersion: number;
  contentId: string;
  sourceIds: string[];
  nodes: number;
  edges: number;
  rows: number;
}
export interface HistoryContent {
  id: string;
  diagramId: string;
  digest: string;
  bytes: number;
  graph: HistoryGraph;
}
export interface HistorySource {
  id: string;
  diagramId: string;
  datasetId: string;
  datasetVersion: number;
  rowId: string;
  bytes: number;
  dataset: Omit<CsvDataset, 'rows'>;
}
export interface HistoryRows {
  id: string;
  diagramId: string;
  digest: string;
  bytes: number;
  rows: CsvDataset['rows'];
}
export interface HistoryRowBackup extends Omit<HistoryRows, 'rows'> {
  rows?: CsvDataset['rows'];
  datasetRef?: { id: string; version: number };
}
export interface HistoryBackup {
  version: 1;
  snapshots: HistorySnapshot[];
  contents: HistoryContent[];
  sources: HistorySource[];
  rows: HistoryRowBackup[];
}
export interface HistoryLimits {
  snapshotsPerDiagram: number;
  snapshots: number;
  bytes: number;
  graphBytes: number;
}
export const historyLimits: HistoryLimits = {
  snapshotsPerDiagram: 50,
  snapshots: 1000,
  bytes: 256 * 1024 * 1024,
  graphBytes: 32 * 1024 * 1024,
};
export interface HistoryChange {
  entity: 'diagram' | 'node' | 'edge' | 'owner' | 'source';
  kind: 'added' | 'removed' | 'changed';
  id: string;
  label: string;
  fields: string[];
}
export interface HistoryComparison {
  diagramId: string;
  fromSnapshotId: string;
  toSnapshotId: string | 'current';
  currentVersion: number;
  counts: Record<HistoryChange['entity'], { added: number; removed: number; changed: number }>;
  changes: HistoryChange[];
  totalChanges: number;
  changesTruncated: boolean;
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
  affectedTotal: number;
  affectedTruncated: boolean;
  warnings: string[];
}
export interface HistoryRestoreResult {
  graph: Graph;
  safetySnapshot: HistorySnapshot;
}
