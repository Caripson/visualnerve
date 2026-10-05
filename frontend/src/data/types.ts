import type { Base } from '../model/types';

export interface CsvColumn {
  id: string;
  label: string;
}

/** Original cells are preserved; their meaning belongs to the diagram's analysis. */
export interface CsvDataset extends Base {
  formatVersion: 1;
  diagramId: string;
  name: string;
  fileName: string;
  columns: CsvColumn[];
  rows: string[][];
}

export const metricOperations = [
  'count',
  'sum',
  'avg',
  'median',
  'min',
  'max',
  'distinct',
] as const;
export type MetricOperation = (typeof metricOperations)[number];
export interface CsvMetric {
  id: string;
  operation: MetricOperation;
  columnId?: string;
}

/** Small, undoable configuration stored in diagram.settings.csvAnalysis. */
export interface CsvAnalysis {
  version: 1;
  levels: string[];
  metrics: CsvMetric[];
  decimalSeparator: '.' | ',';
  displayColumns: string[];
  filters: CsvFilter[];
  focusPath: CsvPathEntry[];
  limit: number;
  offset: number;
  sortBy: string;
  sortDirection: 'asc' | 'desc';
  columnRules: CsvColumnRule[];
}

export interface CsvColumnRule {
  columnId: string;
  trim?: boolean;
  pattern?: string;
  replacement?: string;
  flags?: string;
  numberFormat?: 'auto' | 'dot' | 'comma';
}

export const filterOperations = [
  'equals',
  'notEquals',
  'startsWith',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'notEmpty',
] as const;
export interface CsvFilter {
  id: string;
  columnId: string;
  operation: (typeof filterOperations)[number];
  value: string;
  caseSensitive?: boolean;
}

export interface CsvPathEntry {
  columnId: string;
  value: string;
}
export interface CsvMeasure {
  id: string;
  label: string;
  operation: MetricOperation;
  columnId?: string;
  value: number | null;
  numericCount: number;
  missingCount: number;
  invalidCount: number;
}
export interface CsvGroup {
  key: string;
  path: CsvPathEntry[];
  label: string;
  rowCount: number;
  measures: CsvMeasure[];
  children: CsvGroup[];
  totalChildren: number;
  hiddenChildren: number;
}
export interface CsvNodeData {
  datasetId: string;
  groupKey: string;
  path: CsvPathEntry[];
  rowCount: number;
  measures: CsvMeasure[];
  hiddenMetricIds?: string[];
  displayColumns?: string[];
  totalChildren: number;
  hiddenChildren: number;
  visible?: boolean;
  /** A deleted or reconnected generated parent relation stays under user control. */
  suppressParentConnection?: boolean;
}
