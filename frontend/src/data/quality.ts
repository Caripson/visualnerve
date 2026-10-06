import { effectiveDataset, measures, numberFor, rowPredicate, validateAnalysis } from './csv';
import type { CsvAnalysis, CsvDataset, CsvMeasure, CsvPathEntry } from './types';
import type { Graph } from '../model/types';
import { modelDatasetForAnalysis } from './model';

export type QualityKind =
  | 'missing'
  | 'invalid'
  | 'ambiguous'
  | 'collision'
  | 'duplicate-key'
  | 'missing-key'
  | 'missing-reference';
export interface ReferenceCheck {
  id: string;
  label: string;
  columnId: string;
  target: CsvDataset;
  targetColumnId: string;
  targetAnalysis: CsvAnalysis;
  matchMode?: 'exact' | 'trim' | 'case-insensitive';
}
export interface QualityOptions {
  keyColumns?: string[];
  references?: ReferenceCheck[];
}
export interface QualityIssue {
  id: string;
  kind: QualityKind;
  label: string;
  count: number;
  groups?: number;
  columnId?: string;
}
export interface QualityReport {
  sourceRows: number;
  matchingRows: number;
  issues: QualityIssue[];
}
export interface EvidenceRow {
  rowNumber: number;
  original: string[];
  cleaned: string[];
  numericValue?: number | null;
  disposition?: 'included' | 'empty' | 'invalid' | 'duplicate';
}
export interface EvidencePage {
  rows: EvidenceRow[];
  total: number;
  offset: number;
}
export interface MeasureExplanation extends EvidencePage {
  measure: CsvMeasure;
  matchingRows: number;
  contributingRows: number;
  ignoredRows: number;
  duplicateRows: number;
  rule: string;
}

const ambiguous = (value: string) => /^[+-]?\d+[.,]\d{3}(?:[eE][+-]?\d+)?$/.test(value);
const pageSize = 100;
function checkedPage(offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid evidence page.');
}
function prepared(dataset: CsvDataset, analysis: CsvAnalysis) {
  validateAnalysis(dataset, analysis);
  const cleaned = effectiveDataset(dataset, analysis);
  const predicate = rowPredicate(cleaned, analysis.focusPath, analysis);
  const indices: number[] = [];
  cleaned.rows.forEach((row, index) => {
    if (predicate(row)) indices.push(index);
  });
  return { cleaned, indices };
}
function evidence(dataset: CsvDataset, cleaned: CsvDataset, index: number): EvidenceRow {
  return {
    rowNumber:
      (dataset as CsvDataset & { sourceRowNumbers?: number[] }).sourceRowNumbers?.[index] ??
      index + 1,
    original: dataset.rows[index],
    cleaned: cleaned.rows[index],
  };
}

/** Keep file row numbers when relationship exploration selects original rows. */
export function inspectionDataset(model: Graph, dataset: CsvDataset): CsvDataset {
  const scoped = modelDatasetForAnalysis(model, dataset.id);
  if (scoped.rows === dataset.rows) return dataset;
  const rowNumbers = new Map(dataset.rows.map((row, index) => [row, index + 1]));
  return {
    ...scoped,
    sourceRowCount: dataset.rows.length,
    sourceRowNumbers: scoped.rows.map((row) => rowNumbers.get(row)!),
  } as CsvDataset;
}

/** The report contains counts only. Raw rows are requested separately in bounded pages. */
function qualityChecks(dataset: CsvDataset, analysis: CsvAnalysis, options: QualityOptions) {
  const { cleaned, indices } = prepared(dataset, analysis);
  const issues: QualityIssue[] = [];
  const matches = new Map<string, (index: number) => boolean>();
  const add = (issue: Omit<QualityIssue, 'count'>, test: (index: number) => boolean) => {
    let count = 0;
    for (const index of indices) if (test(index)) count++;
    if (count) {
      issues.push({ ...issue, count });
      matches.set(issue.id, test);
    }
  };
  const numericColumns = new Set(
    analysis.metrics
      .filter((metric) => !['count', 'distinct'].includes(metric.operation))
      .map((metric) => metric.columnId),
  );
  for (const rule of analysis.columnRules) if (rule.numberFormat) numericColumns.add(rule.columnId);
  dataset.columns.forEach((column, col) => {
    add(
      {
        id: `missing:${column.id}`,
        kind: 'missing',
        columnId: column.id,
        label: `${column.label}: empty values`,
      },
      (index) => !cleaned.rows[index][col].trim(),
    );
    if (numericColumns.has(column.id)) {
      add(
        {
          id: `invalid:${column.id}`,
          kind: 'invalid',
          columnId: column.id,
          label: `${column.label}: excluded numeric values`,
        },
        (index) =>
          !!cleaned.rows[index][col].trim() &&
          numberFor(cleaned.rows[index][col], column.id, analysis) === null,
      );
      const format = analysis.columnRules.find((rule) => rule.columnId === column.id)?.numberFormat;
      if (!format || format === 'auto')
        add(
          {
            id: `ambiguous:${column.id}`,
            kind: 'ambiguous',
            columnId: column.id,
            label: `${column.label}: ambiguous decimal or thousands separator`,
          },
          (index) =>
            ambiguous(cleaned.rows[index][col].trim()) &&
            numberFor(cleaned.rows[index][col], column.id, analysis) === null,
        );
    }
    if (
      analysis.columnRules.some(
        (rule) => rule.columnId === column.id && (rule.pattern || rule.trim !== false),
      )
    ) {
      const originals = new Map<string, string>();
      const collisions = new Set<string>();
      for (const index of indices) {
        const value = cleaned.rows[index][col].trim();
        if (!value) continue;
        const original = dataset.rows[index][col];
        if (originals.has(value) && originals.get(value) !== original) collisions.add(value);
        else originals.set(value, original);
      }
      add(
        {
          id: `collision:${column.id}`,
          kind: 'collision',
          columnId: column.id,
          label: `${column.label}: different originals merged by cleanup`,
          groups: collisions.size,
        },
        (index) => collisions.has(cleaned.rows[index][col].trim()),
      );
    }
  });
  const keys = options.keyColumns ?? [];
  if (keys.length) {
    if (
      new Set(keys).size !== keys.length ||
      keys.some((id) => !dataset.columns.some((column) => column.id === id))
    )
      throw new Error('Choose valid, distinct key columns.');
    const keyIndices = keys.map((id) => dataset.columns.findIndex((column) => column.id === id));
    const keyFor = (index: number) =>
      JSON.stringify(keyIndices.map((col) => cleaned.rows[index][col].trim()));
    const empty = (index: number) => keyIndices.some((col) => !cleaned.rows[index][col].trim());
    const counts = new Map<string, number>();
    for (const index of indices)
      if (!empty(index)) counts.set(keyFor(index), (counts.get(keyFor(index)) ?? 0) + 1);
    add(
      {
        id: 'missing-key',
        kind: 'missing-key',
        label: 'Rows with incomplete selected identity keys',
      },
      empty,
    );
    add(
      {
        id: 'duplicate-key',
        kind: 'duplicate-key',
        label: 'Rows sharing the selected identity keys',
        groups: [...counts.values()].filter((count) => count > 1).length,
      },
      (index) => !empty(index) && (counts.get(keyFor(index)) ?? 0) > 1,
    );
  }
  for (const reference of options.references ?? []) {
    const col = dataset.columns.findIndex((column) => column.id === reference.columnId);
    const targetCol = reference.target.columns.findIndex(
      (column) => column.id === reference.targetColumnId,
    );
    if (col < 0 || targetCol < 0) throw new Error('Reference check refers to an unknown column.');
    validateAnalysis(reference.target, reference.targetAnalysis);
    const target = effectiveDataset(reference.target, reference.targetAnalysis);
    // Referential integrity checks the entire source, independently of display filters.
    const key = (value: string) =>
      reference.matchMode === 'exact'
        ? value
        : reference.matchMode === 'case-insensitive'
          ? value.trim().toLocaleLowerCase()
          : value.trim();
    const targetKeys = new Set(target.rows.map((row) => key(row[targetCol])).filter(Boolean));
    add(
      {
        id: `reference:${reference.id}`,
        kind: 'missing-reference',
        columnId: reference.columnId,
        label: reference.label,
      },
      (index) => !!key(cleaned.rows[index][col]) && !targetKeys.has(key(cleaned.rows[index][col])),
    );
  }
  return { cleaned, indices, issues, matches };
}

export function qualityReport(
  dataset: CsvDataset,
  analysis: CsvAnalysis,
  options: QualityOptions = {},
): QualityReport {
  const result = qualityChecks(dataset, analysis, options);
  return {
    sourceRows:
      (dataset as CsvDataset & { sourceRowCount?: number }).sourceRowCount ?? dataset.rows.length,
    matchingRows: result.indices.length,
    issues: result.issues,
  };
}
export function qualityEvidence(
  dataset: CsvDataset,
  analysis: CsvAnalysis,
  options: QualityOptions,
  issueId: string,
  offset = 0,
): EvidencePage {
  checkedPage(offset);
  const result = qualityChecks(dataset, analysis, options);
  const test = result.matches.get(issueId);
  if (!test) return { rows: [], total: 0, offset };
  const rows: EvidenceRow[] = [];
  let total = 0;
  for (const index of result.indices)
    if (test(index)) {
      if (total >= offset && rows.length < pageSize)
        rows.push(evidence(dataset, result.cleaned, index));
      total++;
    }
  return { rows, total, offset };
}

const operationRules = {
  count: 'Count includes every matching source row, including empty and invalid cells.',
  sum: 'Sum adds all valid numeric values once. Empty and invalid cells are excluded.',
  avg: 'Average divides the sum of valid numeric values by their count. Empty and invalid cells are excluded.',
  median:
    'Median sorts all valid numeric values and uses the middle value, or the average of the two middle values.',
  min: 'Minimum is the smallest valid numeric value among matching rows.',
  max: 'Maximum is the largest valid numeric value among matching rows.',
  distinct: 'Distinct counts unique non-empty cleaned values. Repeated values contribute once.',
};
export function explainMeasure(
  dataset: CsvDataset,
  analysis: CsvAnalysis,
  path: CsvPathEntry[],
  metricId: string,
  offset = 0,
  disposition: 'all' | 'included' | 'excluded' = 'all',
): MeasureExplanation {
  checkedPage(offset);
  validateAnalysis(dataset, analysis);
  const metric = analysis.metrics.find((entry) => entry.id === metricId);
  if (!metric) throw new Error('This measure is no longer part of the current analysis.');
  const cleaned = effectiveDataset(dataset, analysis);
  const predicate = rowPredicate(cleaned, path, analysis);
  const matching: number[] = [];
  cleaned.rows.forEach((row, index) => {
    if (predicate(row)) matching.push(index);
  });
  const measure = measures(
    cleaned,
    { ...analysis, metrics: [metric] },
    matching.map((index) => cleaned.rows[index]),
  )[0];
  const columnIndex = dataset.columns.findIndex((column) => column.id === metric.columnId);
  const distinct = new Set<string>();
  const rows: EvidenceRow[] = [];
  let total = 0;
  let contributingRows = 0;
  let duplicateRows = 0;
  for (const index of matching) {
    const row = evidence(dataset, cleaned, index);
    row.disposition = 'included';
    if (metric.operation !== 'count') {
      const cell = cleaned.rows[index][columnIndex].trim();
      if (!cell) row.disposition = 'empty';
      else if (metric.operation === 'distinct') {
        if (distinct.has(cell)) {
          row.disposition = 'duplicate';
          duplicateRows++;
        } else distinct.add(cell);
      } else {
        row.numericValue = numberFor(cell, metric.columnId!, analysis);
        if (row.numericValue === null) row.disposition = 'invalid';
      }
    }
    if (row.disposition === 'included') contributingRows++;
    if (
      disposition === 'all' ||
      (disposition === 'included' ? row.disposition === 'included' : row.disposition !== 'included')
    ) {
      if (total >= offset && rows.length < pageSize) rows.push(row);
      total++;
    }
  }
  return {
    rows,
    total,
    offset,
    measure,
    matchingRows: matching.length,
    contributingRows,
    ignoredRows: matching.length - contributingRows,
    duplicateRows,
    rule: operationRules[metric.operation],
  };
}
