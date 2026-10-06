import Papa from 'papaparse';
import { base, blankGraph, newEdge, newNode, type Graph, type GraphNode } from '../model/types';
import { balancedMindmap } from '../mindmap/tree';
import {
  metricOperations,
  filterOperations,
  type CsvAnalysis,
  type CsvDataset,
  type CsvGroup,
  type CsvMeasure,
  type CsvNodeData,
  type CsvPathEntry,
} from './types';

export const csvLimits = {
  bytes: 50 * 1024 * 1024,
  rows: 200000,
  columns: 200,
  cells: 10000000,
  groups: 600,
  metrics: 20,
} as const;

export interface CsvColumnProfile {
  columnId: string;
  label: string;
  numericCount: number;
  missingCount: number;
  invalidCount: number;
  distinctCount: number;
  ambiguousCount?: number;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const textValue = (value: unknown): value is string => typeof value === 'string';
const groupValue = (value: string) => value.trim();
const pathKey = (path: CsvPathEntry[]) => JSON.stringify(path);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

const numericPatterns = {
  '.': /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/,
  ',': /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/,
};

/** A full-cell numeric parse: no grouping separators, currency or partial numbers. */
export function csvNumber(cell: string, decimalSeparator: '.' | ','): number | null {
  const value = cell.trim();
  if (!value) return null;
  if (!numericPatterns[decimalSeparator].test(value)) return null;
  const number = Number(decimalSeparator === ',' ? value.replace(',', '.') : value);
  return Number.isFinite(number) ? number : null;
}

export function csvFormattedNumber(cell: string, format: 'auto' | 'dot' | 'comma'): number | null {
  let value = cell.trim();
  if (!value) return null;
  if (/[ \u00a0\u202f]/.test(value)) {
    if (!/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(value))
      return null;
    value = value.replace(/[ \u00a0\u202f]/g, '');
  }
  if (format === 'auto') {
    const dots = (value.match(/\./g) ?? []).length;
    const commas = (value.match(/,/g) ?? []).length;
    if (dots && commas)
      return csvFormattedNumber(
        value,
        value.lastIndexOf('.') > value.lastIndexOf(',') ? 'dot' : 'comma',
      );
    const separator = dots ? '.' : ',';
    if (dots + commas > 1) {
      const grouping =
        separator === '.' ? /^[+-]?\d{1,3}(?:\.\d{3})+$/ : /^[+-]?\d{1,3}(?:,\d{3})+$/;
      if (!grouping.test(value)) return null;
      return csvNumber(value.split(separator).join(''), '.');
    }
    if (dots + commas === 1 && /^[+-]?\d+[.,]\d{3}(?:[eE][+-]?\d+)?$/.test(value)) return null;
    return csvNumber(value, dots ? '.' : ',');
  }
  const decimal = format === 'dot' ? '.' : ',';
  const grouping = format === 'dot' ? ',' : '.';
  if (value.includes(grouping)) {
    const pattern =
      format === 'dot'
        ? /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/
        : /^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d*)?(?:[eE][+-]?\d+)?$/;
    if (!pattern.test(value)) return null;
    value = value.split(grouping).join('');
  }
  return csvNumber(value, decimal);
}

const cleanedSources = new WeakMap<CsvDataset, { rules: string; rows: string[][] }>();
const validatedSources = new WeakSet<CsvDataset>();
function effectiveDataset(dataset: CsvDataset, analysis?: CsvAnalysis): CsvDataset {
  if (!analysis?.columnRules.length) return dataset;
  const key = JSON.stringify(analysis.columnRules);
  const cached = cleanedSources.get(dataset);
  if (cached?.rules === key) return { ...dataset, rows: cached.rows };
  const rules = analysis.columnRules.map((rule) => ({
    ...rule,
    index: dataset.columns.findIndex((column) => column.id === rule.columnId),
    regex: rule.pattern ? new RegExp(rule.pattern, rule.flags || '') : undefined,
  }));
  const rows = dataset.rows.map((row) => {
    const result = [...row];
    for (const rule of rules) {
      let cell = result[rule.index];
      if (rule.trim !== false) cell = cell.trim();
      if (rule.regex) cell = cell.replace(rule.regex, rule.replacement || '');
      result[rule.index] = rule.trim !== false ? cell.trim() : cell;
    }
    return result;
  });
  cleanedSources.set(dataset, { rules: key, rows });
  return { ...dataset, rows };
}

function numberFor(cell: string, columnId: string, analysis: CsvAnalysis): number | null {
  const format = analysis.columnRules.find((rule) => rule.columnId === columnId)?.numberFormat;
  return csvFormattedNumber(cell, format ?? 'auto');
}

export function parseCsv(text: string, fileName: string): CsvDataset {
  requireValue(
    new TextEncoder().encode(text).byteLength <= csvLimits.bytes,
    'CSV exceeds the 50 MiB file limit.',
  );
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const errors = parsed.errors.filter((error) => error.code !== 'UndetectableDelimiter');
  if (errors.length) throw new Error(`CSV could not be parsed: ${errors[0].message}`);
  const first = parsed.data.findIndex((row) => row.length > 1 || row.some((cell) => cell.trim()));
  requireValue(first >= 0, 'CSV is empty. Include a header and at least one data row.');
  const header = parsed.data[first];
  requireValue(
    header.length <= csvLimits.columns,
    `CSV exceeds the ${csvLimits.columns} column limit.`,
  );
  const labels = new Set<string>();
  const columns = header.map((cell, index) => {
    const original = cell.trim() || `Column ${index + 1}`;
    let label = original;
    for (let suffix = 2; labels.has(label); suffix++) label = `${original} (${suffix})`;
    labels.add(label);
    return { id: `c${index}`, label };
  });
  const rows: string[][] = [];
  const rowLimitMessage = `CSV exceeds the ${csvLimits.rows.toLocaleString('en-US')} row limit.`;
  for (let index = first + 1; index < parsed.data.length; index++) {
    const row = parsed.data[index];
    if (row.every((cell) => !cell.trim())) continue;
    if (row.length !== columns.length)
      throw new Error(
        `CSV row ${index + 1} has ${row.length} columns; expected ${columns.length}.`,
      );
    rows.push(row);
    requireValue(rows.length <= csvLimits.rows, rowLimitMessage);
    requireValue(
      rows.length * columns.length <= csvLimits.cells,
      'CSV exceeds the 10,000,000 cell limit.',
    );
  }
  const dataset: CsvDataset = {
    ...base(),
    formatVersion: 1,
    diagramId: crypto.randomUUID(),
    name:
      fileName
        .replace(/\.csv$/i, '')
        .trim()
        .slice(0, 500) || 'CSV data',
    fileName,
    columns,
    rows,
  };
  validateDataset(dataset);
  return dataset;
}

export function validateDataset(dataset: CsvDataset): void {
  requireValue(
    dataset && typeof dataset === 'object' && dataset.formatVersion === 1,
    'Unsupported CSV dataset.',
  );
  requireValue(
    uuid.test(dataset.id) && uuid.test(dataset.diagramId),
    'CSV dataset and diagram ids must be UUIDs.',
  );
  requireValue(
    Number.isSafeInteger(dataset.version) &&
      dataset.version > 0 &&
      Number.isFinite(Date.parse(dataset.createdAt)) &&
      Number.isFinite(Date.parse(dataset.updatedAt)),
    'Invalid CSV dataset version or timestamps.',
  );
  requireValue(
    textValue(dataset.name) && dataset.name.trim() && dataset.name.length <= 500,
    'CSV dataset name is required and limited to 500 characters.',
  );
  requireValue(
    textValue(dataset.fileName) && dataset.fileName.length > 0 && dataset.fileName.length <= 1000,
    'CSV filename is required and limited to 1,000 characters.',
  );
  requireValue(
    Array.isArray(dataset.columns) &&
      dataset.columns.length > 0 &&
      dataset.columns.length <= csvLimits.columns,
    'CSV needs between 1 and 200 columns.',
  );
  const columns = new Set<string>();
  let bytes = 0;
  for (const column of dataset.columns) {
    requireValue(
      column &&
        textValue(column.id) &&
        column.id.length > 0 &&
        textValue(column.label) &&
        column.label.trim() &&
        column.label.length <= 1000,
      'Invalid CSV column.',
    );
    requireValue(!columns.has(column.id), 'Duplicate CSV column id.');
    columns.add(column.id);
    bytes += utf8ByteLength(column.label);
  }
  requireValue(
    Array.isArray(dataset.rows) && dataset.rows.length > 0 && dataset.rows.length <= csvLimits.rows,
    'CSV needs between 1 and 200,000 data rows.',
  );
  requireValue(
    dataset.rows.length * dataset.columns.length <= csvLimits.cells,
    'CSV exceeds the 10,000,000 cell limit.',
  );
  for (const row of dataset.rows) {
    requireValue(
      Array.isArray(row) && row.length === dataset.columns.length && row.every(textValue),
      'Every CSV row must contain one string cell per column.',
    );
    for (const cell of row) {
      bytes += utf8ByteLength(cell);
      requireValue(bytes <= csvLimits.bytes, 'CSV exceeds the 50 MiB data limit.');
    }
  }
  validatedSources.add(dataset);
}

export function defaultAnalysis(dataset: CsvDataset): CsvAnalysis {
  return {
    version: 1,
    levels: [dataset.columns[0].id],
    metrics: [{ id: crypto.randomUUID(), operation: 'count' }],
    decimalSeparator: '.',
    displayColumns: dataset.columns.slice(0, 8).map((column) => column.id),
    filters: [],
    focusPath: [],
    limit: 50,
    offset: 0,
    sortBy: 'count',
    sortDirection: 'desc',
    columnRules: [],
  };
}

export function validateAnalysis(dataset: CsvDataset, analysis: CsvAnalysis): void {
  requireValue(
    analysis && typeof analysis === 'object' && analysis.version === 1,
    'Unsupported CSV analysis.',
  );
  requireValue(
    analysis.decimalSeparator === '.' || analysis.decimalSeparator === ',',
    'Choose a dot or comma decimal separator.',
  );
  const columns = new Set(dataset.columns.map((column) => column.id));
  const validColumns = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.every((id) => textValue(id) && columns.has(id)) &&
    new Set(value).size === value.length;
  requireValue(
    validColumns(analysis.levels),
    'Grouping levels must contain unique existing CSV columns.',
  );
  requireValue(analysis.levels.length <= 8, 'Choose at most 8 grouping levels.');
  requireValue(
    validColumns(analysis.displayColumns),
    'Display columns must contain unique existing CSV columns.',
  );
  requireValue(
    Array.isArray(analysis.metrics) &&
      analysis.metrics.length > 0 &&
      analysis.metrics.length <= csvLimits.metrics,
    'Choose between 1 and 20 measures.',
  );
  const ids = new Set<string>();
  for (const metric of analysis.metrics) {
    requireValue(
      metric && textValue(metric.id) && metric.id.length > 0 && !ids.has(metric.id),
      'Every measure needs a unique id.',
    );
    ids.add(metric.id);
    requireValue(metricOperations.includes(metric.operation), 'Unsupported CSV measure.');
    requireValue(
      metric.operation === 'count' || (textValue(metric.columnId) && columns.has(metric.columnId)),
      'Choose an existing column for each measure other than count.',
    );
    requireValue(
      metric.columnId === undefined || columns.has(metric.columnId),
      'Measure refers to an unknown CSV column.',
    );
  }
  requireValue(
    Number.isSafeInteger(analysis.limit) && analysis.limit >= 1 && analysis.limit <= 200,
    'Choose between 1 and 200 visible groups per level.',
  );
  requireValue(
    Number.isSafeInteger(analysis.offset) && analysis.offset >= 0,
    'Group page offset must be a non-negative integer.',
  );
  requireValue(
    analysis.sortBy === 'count' || analysis.sortBy === 'label' || ids.has(analysis.sortBy),
    'Choose an existing measure or label to sort groups.',
  );
  requireValue(
    analysis.sortDirection === 'asc' || analysis.sortDirection === 'desc',
    'Choose ascending or descending group order.',
  );
  requireValue(
    Array.isArray(analysis.focusPath) &&
      analysis.focusPath.length <= analysis.levels.length &&
      analysis.focusPath.every(
        (entry, index) =>
          entry && entry.columnId === analysis.levels[index] && textValue(entry.value),
      ),
    'Focused group must follow the selected grouping levels.',
  );
  requireValue(
    Array.isArray(analysis.filters) && analysis.filters.length <= 50,
    'Choose at most 50 CSV filters.',
  );
  requireValue(Array.isArray(analysis.columnRules), 'Invalid CSV column rules.');
  const filterIds = new Set<string>();
  for (const filter of analysis.filters) {
    requireValue(
      filter &&
        textValue(filter.id) &&
        filter.id.length &&
        !filterIds.has(filter.id) &&
        columns.has(filter.columnId) &&
        filterOperations.includes(filter.operation) &&
        textValue(filter.value) &&
        (filter.caseSensitive === undefined || typeof filter.caseSensitive === 'boolean'),
      'Invalid CSV filter.',
    );
    filterIds.add(filter.id);
    if (['gt', 'gte', 'lt', 'lte'].includes(filter.operation))
      requireValue(
        numberFor(filter.value, filter.columnId, analysis) !== null,
        'Numeric filters need a number using the selected decimal separator or column format.',
      );
  }
  requireValue(
    Array.isArray(analysis.columnRules) && analysis.columnRules.length <= dataset.columns.length,
    'Invalid CSV column rules.',
  );
  const ruleColumns = new Set<string>();
  for (const rule of analysis.columnRules) {
    requireValue(
      rule &&
        columns.has(rule.columnId) &&
        !ruleColumns.has(rule.columnId) &&
        (rule.trim === undefined || typeof rule.trim === 'boolean') &&
        (rule.numberFormat === undefined || ['auto', 'dot', 'comma'].includes(rule.numberFormat)),
      'Invalid or duplicate CSV column rule.',
    );
    ruleColumns.add(rule.columnId);
    requireValue(
      rule.pattern === undefined || (textValue(rule.pattern) && rule.pattern.length <= 500),
      'Cleaning patterns are limited to 500 characters.',
    );
    requireValue(
      rule.replacement === undefined ||
        (textValue(rule.replacement) && rule.replacement.length <= 1000),
      'Cleaning replacements are limited to 1,000 characters.',
    );
    requireValue(
      rule.flags === undefined ||
        (textValue(rule.flags) &&
          /^[gim]*$/.test(rule.flags) &&
          new Set(rule.flags).size === rule.flags.length),
      'Cleaning regex flags can only contain g, i and m once each.',
    );
    if (rule.pattern) {
      try {
        new RegExp(rule.pattern, rule.flags || '');
      } catch (error) {
        throw new Error(
          `Invalid cleaning pattern for ${dataset.columns.find((column) => column.id === rule.columnId)!.label}: ${(error as Error).message}`,
        );
      }
    }
  }
}

export function profileCsv(
  dataset: CsvDataset,
  decimalSeparator: '.' | ',' = '.',
  analysis?: CsvAnalysis,
): CsvColumnProfile[] {
  if (analysis) validateAnalysis(dataset, analysis);
  const source = effectiveDataset(dataset, analysis);
  return dataset.columns.map((column, index) => {
    let numericCount = 0;
    let missingCount = 0;
    let invalidCount = 0;
    let ambiguousCount = 0;
    const distinct = new Set<string>();
    for (const row of source.rows) {
      const value = row[index].trim();
      if (!value) {
        missingCount++;
        continue;
      }
      distinct.add(value);
      if (
        (analysis ? numberFor(value, column.id, analysis) : csvFormattedNumber(value, 'auto')) !==
        null
      )
        numericCount++;
      else {
        invalidCount++;
        if (
          /^[+-]?\d+[.,]\d{3}$/.test(value) &&
          (csvNumber(value, '.') !== null || csvNumber(value, ',') !== null)
        )
          ambiguousCount++;
      }
    }
    return {
      columnId: column.id,
      label: column.label,
      numericCount,
      missingCount,
      invalidCount,
      distinctCount: distinct.size,
      ambiguousCount,
    };
  });
}

function measures(dataset: CsvDataset, analysis: CsvAnalysis, rows: string[][]): CsvMeasure[] {
  return analysis.metrics.map((metric) => {
    const index = dataset.columns.findIndex((column) => column.id === metric.columnId);
    const label =
      metric.operation === 'count'
        ? 'Count'
        : `${metric.operation === 'avg' ? 'Average' : metric.operation[0].toUpperCase() + metric.operation.slice(1)} · ${dataset.columns[index].label}`;
    const result: CsvMeasure = {
      ...metric,
      label,
      value: null,
      numericCount: 0,
      missingCount: 0,
      invalidCount: 0,
    };
    if (metric.operation === 'count') return { ...result, value: rows.length };
    const numbers: number[] = [];
    const distinct = new Set<string>();
    for (const row of rows) {
      const cell = row[index].trim();
      if (!cell) {
        result.missingCount++;
        continue;
      }
      distinct.add(cell);
      if (metric.operation === 'distinct') continue;
      const value = numberFor(cell, metric.columnId!, analysis);
      if (value === null) result.invalidCount++;
      else numbers.push(value);
    }
    if (metric.operation === 'distinct') return { ...result, value: distinct.size };
    result.numericCount = numbers.length;
    if (!numbers.length) return result;
    if (metric.operation === 'sum' || metric.operation === 'avg') {
      // Compensated summation keeps small terms when a group mixes magnitudes.
      let sum = 0;
      let correction = 0;
      for (const number of numbers) {
        const term = metric.operation === 'avg' ? number / numbers.length : number;
        const next = sum + term;
        correction += Math.abs(sum) >= Math.abs(term) ? sum - next + term : term - next + sum;
        sum = next;
      }
      result.value = sum + correction;
    } else if (metric.operation === 'min') result.value = numbers.reduce((a, b) => Math.min(a, b));
    else if (metric.operation === 'max') result.value = numbers.reduce((a, b) => Math.max(a, b));
    else {
      numbers.sort((a, b) => a - b);
      const middle = Math.floor(numbers.length / 2);
      result.value =
        numbers.length % 2 ? numbers[middle] : numbers[middle - 1] / 2 + numbers[middle] / 2;
    }
    requireValue(finite(result.value), `The ${label} result exceeds the supported numeric range.`);
    return result;
  });
}

function rowPredicate(dataset: CsvDataset, path: CsvPathEntry[], analysis?: CsvAnalysis) {
  const indices = new Map(dataset.columns.map((column, index) => [column.id, index]));
  requireValue(
    Array.isArray(path) &&
      path.every((entry) => entry && indices.has(entry.columnId) && textValue(entry.value)),
    'Group path refers to an invalid CSV column or value.',
  );
  const filters = (analysis?.filters ?? []).map((filter) => ({
    ...filter,
    index: indices.get(filter.columnId)!,
  }));
  return (row: string[]) => {
    if (!path.every((entry) => groupValue(row[indices.get(entry.columnId)!]) === entry.value))
      return false;
    return filters.every((filter) => {
      const cell = row[filter.index].trim();
      if (filter.operation === 'empty') return !cell;
      if (filter.operation === 'notEmpty') return !!cell;
      if (['gt', 'gte', 'lt', 'lte'].includes(filter.operation)) {
        const left = numberFor(cell, filter.columnId, analysis!);
        const right = numberFor(filter.value, filter.columnId, analysis!);
        return (
          left !== null &&
          right !== null &&
          (filter.operation === 'gt'
            ? left > right
            : filter.operation === 'gte'
              ? left >= right
              : filter.operation === 'lt'
                ? left < right
                : left <= right)
        );
      }
      const left = filter.caseSensitive ? cell : cell.toLocaleLowerCase();
      const right = filter.caseSensitive
        ? filter.value.trim()
        : filter.value.trim().toLocaleLowerCase();
      return filter.operation === 'equals'
        ? left === right
        : filter.operation === 'notEquals'
          ? left !== right
          : filter.operation === 'startsWith'
            ? left.startsWith(right)
            : left.includes(right);
    });
  };
}

export function groupCsv(dataset: CsvDataset, analysis: CsvAnalysis): CsvGroup {
  if (!validatedSources.has(dataset)) validateDataset(dataset);
  validateAnalysis(dataset, analysis);
  let count = 0;
  const build = (
    rows: string[][],
    path: CsvPathEntry[],
    depth: number,
    ceiling: number = csvLimits.groups,
  ): CsvGroup => {
    count++;
    const group: CsvGroup = {
      key: pathKey(path),
      path,
      label: path.length ? path.at(-1)!.value || '(Empty)' : dataset.name,
      rowCount: rows.length,
      measures: measures(dataset, analysis, rows),
      children: [],
      totalChildren: 0,
      hiddenChildren: 0,
    };
    if (depth === analysis.levels.length) return group;
    const columnId = analysis.levels[depth];
    const index = dataset.columns.findIndex((column) => column.id === columnId);
    const children = new Map<string, string[][]>();
    for (const row of rows) {
      const value = groupValue(row[index]);
      const pending = children.get(value);
      if (pending) pending.push(row);
      else children.set(value, [row]);
    }
    group.totalChildren = children.size;
    const sortMetric = analysis.metrics.find((metric) => metric.id === analysis.sortBy);
    const buckets = [...children].map(([value, records]) => ({
      value,
      records,
      score: sortMetric
        ? measures(dataset, { ...analysis, metrics: [sortMetric] }, records)[0].value
        : records.length,
    }));
    buckets.sort((a, b) => {
      const order =
        analysis.sortBy === 'label'
          ? a.value.localeCompare(b.value)
          : a.score === null
            ? b.score === null
              ? 0
              : 1
            : b.score === null
              ? -1
              : (a.score - b.score) * (analysis.sortDirection === 'asc' ? 1 : -1);
      return analysis.sortBy === 'label'
        ? order * (analysis.sortDirection === 'asc' ? 1 : -1)
        : order || a.value.localeCompare(b.value);
    });
    const offset = path.length === analysis.focusPath.length ? analysis.offset : 0;
    const selected = buckets
      .slice(offset, offset + analysis.limit)
      .slice(0, Math.max(0, ceiling - count));
    for (const [index, { value, records }] of selected.entries()) {
      // Deeper descendants cannot consume the slots promised to this page's siblings.
      const reservedSiblings = selected.length - index - 1;
      group.children.push(
        build(records, [...path, { columnId, value }], depth + 1, ceiling - reservedSiblings),
      );
    }
    group.hiddenChildren = group.totalChildren - group.children.length;
    return group;
  };
  const source = effectiveDataset(dataset, analysis);
  return build(
    source.rows.filter(rowPredicate(source, analysis.focusPath, analysis)),
    analysis.focusPath,
    analysis.focusPath.length,
  );
}

export function rowsForGroup(
  dataset: CsvDataset,
  path: CsvPathEntry[],
  analysis?: CsvAnalysis,
  limit = 200,
): string[][] {
  requireValue(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,
    'Source row preview must contain between 1 and 1,000 rows.',
  );
  if (analysis) validateAnalysis(dataset, analysis);
  const source = effectiveDataset(dataset, analysis);
  const matches = rowPredicate(source, path, analysis);
  const rows: string[][] = [];
  for (let index = 0; index < source.rows.length; index++)
    if (matches(source.rows[index])) {
      rows.push(dataset.rows[index]);
      if (rows.length === limit) break;
    }
  return rows;
}

export function previewCsvRowsSync(
  dataset: CsvDataset,
  analysis: CsvAnalysis,
  path: CsvPathEntry[] = [],
  limit = 100,
): { rows: string[][]; originalRows: string[][]; total: number } {
  validateAnalysis(dataset, analysis);
  requireValue(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,
    'Source preview is limited to 1,000 rows.',
  );
  const source = effectiveDataset(dataset, analysis);
  const matches = rowPredicate(source, path, analysis);
  const rows: string[][] = [];
  const originalRows: string[][] = [];
  let total = 0;
  for (let index = 0; index < source.rows.length; index++)
    if (matches(source.rows[index])) {
      total++;
      if (rows.length < limit) {
        rows.push(source.rows[index]);
        originalRows.push(dataset.rows[index]);
      }
    }
  return { rows, originalRows, total };
}

export function validateCsvNode(data: CsvNodeData): void {
  requireValue(
    data && typeof data === 'object' && uuid.test(data.datasetId) && textValue(data.groupKey),
    'Invalid CSV node reference.',
  );
  requireValue(
    Array.isArray(data.path) &&
      data.path.every((entry) => entry && textValue(entry.columnId) && textValue(entry.value)) &&
      pathKey(data.path) === data.groupKey,
    'Invalid CSV node group path.',
  );
  requireValue(
    Number.isSafeInteger(data.rowCount) && data.rowCount >= 0 && Array.isArray(data.measures),
    'Invalid CSV node measures.',
  );
  requireValue(
    Number.isSafeInteger(data.totalChildren) &&
      data.totalChildren >= 0 &&
      Number.isSafeInteger(data.hiddenChildren) &&
      data.hiddenChildren >= 0 &&
      data.hiddenChildren <= data.totalChildren,
    'Invalid CSV child group counts.',
  );
  const ids = new Set<string>();
  for (const measure of data.measures) {
    requireValue(
      measure &&
        textValue(measure.id) &&
        textValue(measure.label) &&
        metricOperations.includes(measure.operation) &&
        (measure.columnId === undefined || textValue(measure.columnId)) &&
        (measure.value === null || finite(measure.value)),
      'Invalid CSV node measure.',
    );
    requireValue(!ids.has(measure.id), 'Duplicate CSV node measure id.');
    ids.add(measure.id);
    requireValue(
      [measure.numericCount, measure.missingCount, measure.invalidCount].every(
        (value) => Number.isSafeInteger(value) && value >= 0 && value <= data.rowCount,
      ),
      'Invalid CSV node measure counts.',
    );
  }
  requireValue(
    data.hiddenMetricIds === undefined ||
      (Array.isArray(data.hiddenMetricIds) && data.hiddenMetricIds.every(textValue)),
    'Invalid hidden CSV measures.',
  );
  requireValue(
    data.displayColumns === undefined ||
      (Array.isArray(data.displayColumns) &&
        data.displayColumns.every(textValue) &&
        new Set(data.displayColumns).size === data.displayColumns.length),
    'Invalid CSV display columns.',
  );
  requireValue(
    data.visible === undefined || typeof data.visible === 'boolean',
    'Invalid CSV group visibility.',
  );
  requireValue(
    data.suppressParentConnection === undefined ||
      typeof data.suppressParentConnection === 'boolean',
    'Invalid CSV parent connection preference.',
  );
}

export function getCsvNode(node: GraphNode): CsvNodeData | undefined {
  const data = (node.metadata?.csv ?? node.metadata?.csvSnapshot) as CsvNodeData | undefined;
  if (!data) return;
  try {
    validateCsvNode(data);
    return data;
  } catch {
    return undefined;
  }
}

export function getCsvAnalysis(graph: Graph): CsvAnalysis | undefined {
  const analysis = graph.diagram.settings.csvAnalysis as CsvAnalysis | undefined;
  const dataset = (graph as Graph & { dataset?: CsvDataset }).dataset;
  if (!analysis || !dataset) return;
  try {
    validateAnalysis(dataset, analysis);
    return analysis;
  } catch {
    return undefined;
  }
}

export function csvGraph(dataset: CsvDataset, analysis: CsvAnalysis, previous?: Graph): Graph {
  const tree = groupCsv(dataset, analysis);
  const prior = previous?.diagram.id === dataset.diagramId ? previous : undefined;
  const graph = prior ?? blankGraph(dataset.name, 'mindmap');
  const nodes: GraphNode[] = [];
  const edges = [] as Graph['edges'];
  const matching = new Map(
    (prior?.nodes ?? []).flatMap((node) => {
      const csv = getCsvNode(node);
      return node.metadata.csv !== undefined &&
        csv?.datasetId === dataset.id &&
        node.externalId === csv.groupKey
        ? [[csv.groupKey, node] as const]
        : [];
    }),
  );
  const previousEdges = new Map(
    (prior?.edges ?? [])
      .filter((edge) => edge.metadata.csvGenerated === true)
      .map((edge) => [`${edge.sourceNodeId}:${edge.targetNodeId}`, edge]),
  );
  const walk = (group: CsvGroup, parentId?: string) => {
    const old = matching.get(group.key);
    const oldData = old ? getCsvNode(old) : undefined;
    const hiddenMetricIds = oldData?.hiddenMetricIds;
    const data: CsvNodeData = {
      datasetId: dataset.id,
      groupKey: group.key,
      path: group.path,
      rowCount: group.rowCount,
      measures: group.measures,
      totalChildren: group.totalChildren,
      hiddenChildren: group.hiddenChildren,
      visible: true,
      ...(oldData?.suppressParentConnection !== undefined
        ? { suppressParentConnection: oldData.suppressParentConnection }
        : {}),
      ...(hiddenMetricIds
        ? {
            hiddenMetricIds: hiddenMetricIds.filter((id) =>
              analysis.metrics.some((metric) => metric.id === id),
            ),
          }
        : {}),
      ...(oldData?.displayColumns
        ? {
            displayColumns: oldData.displayColumns.filter((id) =>
              dataset.columns.some((column) => column.id === id),
            ),
          }
        : {}),
    };
    const height =
      (parentId ? 76 : 112) + 16 + group.measures.length * 20 + (group.hiddenChildren ? 20 : 0);
    const node = old
      ? {
          ...old,
          parentId,
          externalId: group.key,
          nodeType: 'generic' as const,
          height: Math.max(old.height, height),
          metadata: { ...old.metadata, csv: data },
        }
      : newNode(dataset.diagramId, {
          title: group.label.slice(0, 1000),
          width: 280,
          height,
          parentId,
          externalId: group.key,
          metadata: { csv: data },
        });
    nodes.push(node);
    if (parentId && !data.suppressParentConnection) {
      const oldEdge = previousEdges.get(`${parentId}:${node.id}`);
      edges.push(
        oldEdge ??
          newEdge(dataset.diagramId, parentId, node.id, {
            edgeType: 'hierarchy',
            direction: 'none',
            metadata: { csvGenerated: true },
          }),
      );
    }
    for (const child of group.children) walk(child, node.id);
  };
  walk(tree);
  const positions = balancedMindmap(nodes);
  // Existing groups retain their manual geometry; new groups get automatic positions.
  const positioned = nodes.map((node) =>
    matching.has(getCsvNode(node)!.groupKey) ? node : { ...node, ...positions.get(node.id) },
  );
  const generated = (node: GraphNode) => {
    const csv = getCsvNode(node);
    return (
      node.metadata.csv !== undefined &&
      csv?.datasetId === dataset.id &&
      node.externalId === csv.groupKey
    );
  };
  const manual = (prior?.nodes ?? []).filter((node) => !generated(node));
  const activeIds = new Set(positioned.map((node) => node.id));
  const hidden = (prior?.nodes ?? [])
    .filter((node) => generated(node) && !activeIds.has(node.id))
    .map((node) => ({
      ...node,
      metadata: { ...node.metadata, csv: { ...getCsvNode(node)!, visible: false } },
    }));
  requireValue(
    positioned.length + hidden.length + manual.length <= 12000,
    'This diagram has explored more than 12,000 groups and annotations. Create a new diagram to keep exploration responsive.',
  );
  const surviving = new Set([...positioned, ...manual, ...hidden].map((node) => node.id));
  const suppressed = new Set(
    [...positioned, ...hidden]
      .filter((node) => getCsvNode(node)?.suppressParentConnection)
      .map((node) => node.id),
  );
  const retainedEdges = (prior?.edges ?? []).filter(
    (edge) =>
      surviving.has(edge.sourceNodeId) &&
      surviving.has(edge.targetNodeId) &&
      !(edge.metadata.csvGenerated === true && suppressed.has(edge.targetNodeId)),
  );
  const retainedIds = new Set(retainedEdges.map((edge) => edge.id));
  const result = {
    ...graph,
    dataset,
    diagram: {
      ...graph.diagram,
      id: dataset.diagramId,
      type: prior?.diagram.type ?? ('mindmap' as const),
      settings: {
        ...graph.diagram.settings,
        csvAnalysis: structuredClone(analysis),
        ...(!prior ? { grid: false } : {}),
      },
    },
    nodes: [
      ...positioned,
      ...hidden,
      ...manual.map((node) =>
        node.parentId && !surviving.has(node.parentId) ? { ...node, parentId: undefined } : node,
      ),
    ],
    edges: [...retainedEdges, ...edges.filter((edge) => !retainedIds.has(edge.id))],
  };
  return result;
}
