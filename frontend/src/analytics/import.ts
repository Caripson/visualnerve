import Papa from 'papaparse';
import { analyticsIdentity, observationIdentityKey } from './identity';
import { SaxesParser } from 'saxes';
import { VisioPackage } from '../imports/diagram/vsdx-zip';
import { assertImportBytes, DEFAULT_IMPORT_LIMIT_BYTES, utf8Bytes } from '../imports/limits';
import {
  analyticsLimits,
  type AnalysisContext,
  type AnalyticsDataset,
  type AnalyticsSeries,
  type ImportSource,
  type ImportMapping,
  type ImportPreview,
  type AnalysisIssue,
  type AnalyticsUnit,
  type Observation,
} from './types';
import {
  AnalyticsError,
  requireAnalysis,
  validateAnalytics,
  blankAnalytics,
  validateOhlc,
  validateObservation,
  strictKeys,
} from './validation';
import { zonedTimestamp, checkAnalysis, lexical } from './series';
interface ImportTable {
  columns: string[];
  rows: Record<string, string | number | null>[];
  sheets: string[];
}
function parseXml(
  text: string,
  callbacks: {
    open?: (name: string, attributes: Record<string, string>) => void;
    close?: (name: string) => void;
    text?: (text: string) => void;
  },
) {
  requireAnalysis(!/<!DOCTYPE|<!ENTITY/i.test(text), 'XML DTDs and entities are not supported.');
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) =>
    callbacks.open?.(
      tag.name.split(':').at(-1)!,
      Object.fromEntries(
        Object.entries(tag.attributes).map(([key, value]) => [key, String(value)]),
      ),
    ),
  );
  parser.on('closetag', (tag) => callbacks.close?.(tag.name.split(':').at(-1)!));
  parser.on('text', (text) => callbacks.text?.(text));
  parser.on('cdata', (text) => callbacks.text?.(text));
  parser.write(text).close();
}
function xlsxTable(
  source: ImportSource,
  byteLimit: number,
  context?: AnalysisContext,
): ImportTable {
  requireAnalysis(source.bytes instanceof Uint8Array, 'XLSX requires file bytes.');
  const xlsxBudget = Math.min(byteLimit, DEFAULT_IMPORT_LIMIT_BYTES);
  requireAnalysis(
    source.bytes.byteLength <= xlsxBudget,
    'Workbook exceeds its supported compressed import limit (bytes).',
    'source.bytes',
    'IMPORT_LIMIT',
  );
  const archive = new VisioPackage(source.bytes, xlsxBudget);
  const names = archive.names();
  requireAnalysis(
    names.every((name) => !/(?:vbaProject|externalLinks|embeddings|macrosheets)/i.test(name)),
    'Macros, embedded objects and external workbook links are not accepted.',
  );
  const requested = [
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    ...(archive.has('xl/sharedStrings.xml') ? ['xl/sharedStrings.xml'] : []),
  ];
  let expanded = 0;
  const xml = (name: string) => {
    const text = archive.text(name);
    expanded += utf8Bytes(text);
    requireAnalysis(
      expanded <= analyticsLimits.expandedXlsxBytes,
      'XLSX exceeds the 100 MiB expanded parsing limit.',
      undefined,
      'IMPORT_LIMIT',
    );
    return text;
  };
  const sheets: { name: string; rid: string }[] = [];
  parseXml(xml(requested[0]), {
    open: (name, a) => {
      if (name === 'sheet') sheets.push({ name: a.name, rid: a['r:id'] });
    },
  });
  requireAnalysis(sheets.length > 0 && sheets.length <= 100, 'XLSX must contain 1–100 worksheets.');
  const relationships = new Map<string, string>();
  parseXml(xml(requested[1]), {
    open: (name, a) => {
      if (name === 'Relationship') {
        requireAnalysis(a.TargetMode !== 'External', 'External workbook links are not supported.');
        relationships.set(a.Id, a.Target);
      }
    },
  });
  const selected = source.sheet ? sheets.find((s) => s.name === source.sheet) : sheets[0];
  requireAnalysis(selected, 'Unknown worksheet.');
  const target = relationships.get(selected.rid);
  requireAnalysis(
    target && !target.includes('..') && !target.includes('\\'),
    'Invalid worksheet relationship.',
  );
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  requireAnalysis(/^xl\/worksheets\/[^/]+\.xml$/.test(sheetPath), 'Invalid worksheet path.');
  const strings: string[] = [];
  if (archive.has('xl/sharedStrings.xml')) {
    let active = false,
      value = '';
    parseXml(xml('xl/sharedStrings.xml'), {
      open: (name) => {
        if (name === 'si') {
          active = true;
          value = '';
        }
      },
      text: (text) => {
        if (active) value += text;
      },
      close: (name) => {
        if (name === 'si') {
          strings.push(value);
          active = false;
          requireAnalysis(
            strings.length <= analyticsLimits.importCells,
            'Too many XLSX shared strings.',
            undefined,
            'IMPORT_LIMIT',
          );
        }
      },
    });
  }
  const cells: (string | number | null)[][] = [];
  let row: (string | number | null)[] = [],
    cellType = '',
    cellIndex = 0,
    value = '',
    inline = '',
    capture = '',
    cellCount = 0;
  parseXml(xml(sheetPath), {
    open: (name, a) => {
      checkAnalysis(context);
      if (name === 'row') row = [];
      if (name === 'c') {
        cellType = a.t ?? 'n';
        const ref = /^([A-Z]+)\d+$/.exec(a.r ?? '');
        requireAnalysis(ref, 'Invalid XLSX cell address.');
        cellIndex = [...ref[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
        requireAnalysis(
          cellIndex < analyticsLimits.importColumns,
          'XLSX exceeds 200 columns.',
          undefined,
          'IMPORT_LIMIT',
        );
        value = '';
        inline = '';
        if (++cellCount > analyticsLimits.importCells)
          throw new AnalyticsError('IMPORT_LIMIT', 'XLSX exceeds 10 million cells.');
      }
      if (name === 'f')
        throw new AnalyticsError(
          'INVALID_ANALYTICS',
          'Formula cells are not evaluated or imported. Export literal values first.',
        );
      if (name === 'v' || name === 't') capture = name;
    },
    text: (text) => {
      if (capture === 'v') value += text;
      else if (capture === 't') inline += text;
    },
    close: (name) => {
      if (name === 'v' || name === 't') capture = '';
      if (name === 'c') {
        let cell: string | number | null = value === '' ? null : value;
        if (cellType === 's') {
          const index = Number(value);
          requireAnalysis(
            Number.isInteger(index) && strings[index] !== undefined,
            'Invalid XLSX shared-string index.',
          );
          cell = strings[index];
        } else if (cellType === 'inlineStr') cell = inline;
        else if (cellType === 'n' && value !== '') {
          cell = Number(value);
          requireAnalysis(Number.isFinite(cell), 'Invalid numeric XLSX cell.');
        } else if (cellType === 'e')
          throw new AnalyticsError(
            'INVALID_ANALYTICS',
            'Workbook contains an Excel error cell. Correct it before importing.',
          );
        row[cellIndex] = cell;
      }
      if (name === 'row') {
        cells.push(row);
        requireAnalysis(
          cells.length <= analyticsLimits.observations + 1,
          'XLSX exceeds its row limit.',
          undefined,
          'IMPORT_LIMIT',
        );
      }
    },
  });
  return fromCells(
    cells,
    sheets.map((s) => s.name),
  );
}
function fromCells(cells: (string | number | null)[][], sheets: string[] = []): ImportTable {
  const nonempty = cells.filter((row) =>
    row.some((v) => v !== null && v !== undefined && String(v).trim() !== ''),
  );
  requireAnalysis(nonempty.length >= 2, 'Include a header and at least one observation.');
  const columns = nonempty[0].map((v) => String(v ?? '').trim());
  requireAnalysis(
    columns.length >= 1 &&
      columns.length <= analyticsLimits.importColumns &&
      columns.every((v) => v.length > 0 && v.length <= 300) &&
      new Set(columns).size === columns.length,
    'Headers must be unique nonempty names; at most 200 columns.',
  );
  for (const c of columns)
    requireAnalysis(!['__proto__', 'constructor', 'prototype'].includes(c), 'Unsafe column name.');
  const rows = nonempty.slice(1).map((row, i) => {
    requireAnalysis(row.length <= columns.length, `Row ${i + 2} has more cells than the header.`);
    return Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]));
  });
  requireAnalysis(
    rows.length <= analyticsLimits.observations &&
      rows.length * columns.length <= analyticsLimits.importCells,
    'Import exceeds observation or cell limits.',
    undefined,
    'IMPORT_LIMIT',
  );
  return { columns, rows, sheets };
}
/** File parsing is local; it never evaluates formulas, links, macros or code. */
export function readImportTable(
  source: ImportSource,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
  context?: AnalysisContext,
): ImportTable {
  checkAnalysis(context);
  strictKeys(source as unknown, ['kind', 'name', 'text', 'bytes', 'sheet'], 'source');
  requireAnalysis(['csv', 'xlsx', 'json'].includes(source.kind), 'Unsupported import format.');
  requireAnalysis(
    typeof source.name === 'string' && source.name.length > 0 && source.name.length <= 1000,
    'Import source needs a bounded filename.',
  );
  if (source.sheet !== undefined)
    requireAnalysis(
      typeof source.sheet === 'string' && source.sheet.length <= 300,
      'Invalid worksheet name.',
    );
  if (source.kind === 'xlsx') return xlsxTable(source, byteLimit, context);
  requireAnalysis(typeof source.text === 'string', 'CSV/JSON imports require text.');
  const sourceBytes = utf8Bytes(source.text);
  requireAnalysis(
    sourceBytes <= byteLimit,
    'Analytics file exceeds its configured import limit (bytes).',
    'source.text',
    'IMPORT_LIMIT',
  );
  assertImportBytes(sourceBytes, byteLimit, 'Analytics file');
  if (source.kind === 'csv') {
    const parsed = Papa.parse<string[]>(source.text.replace(/^\uFEFF/, ''), {
      header: false,
      dynamicTyping: false,
      skipEmptyLines: 'greedy',
    });
    requireAnalysis(
      parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter').length === 0,
      'CSV contains malformed quotes or rows.',
    );
    return fromCells(parsed.data);
  }
  requireAnalysis(source.kind === 'json', 'Unsupported import format.');
  let value: unknown;
  try {
    value = JSON.parse(source.text, (key, value) => {
      requireAnalysis(
        !['__proto__', 'constructor', 'prototype'].includes(key),
        'Unsafe JSON field.',
      );
      return value;
    });
  } catch (error) {
    if (error instanceof AnalyticsError) throw error;
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'JSON must be a valid array of plain row objects.',
    );
  }
  requireAnalysis(
    Array.isArray(value) && value.length > 0 && value.length <= analyticsLimits.observations,
    'JSON must contain a bounded array of row objects.',
  );
  const columns = Object.keys(value[0]);
  requireAnalysis(
    columns.length > 0 && columns.length <= analyticsLimits.importColumns,
    'JSON exceeds its column limit.',
  );
  const rows = value.map((row, index) => {
    requireAnalysis(
      row &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        Object.keys(row).every((k) => columns.includes(k)),
      `JSON row ${index + 1} has inconsistent fields.`,
    );
    return Object.fromEntries(
      columns.map((c) => {
        const cell = row[c];
        requireAnalysis(
          cell === undefined ||
            cell === null ||
            typeof cell === 'string' ||
            (typeof cell === 'number' && Number.isFinite(cell)),
          `JSON row ${index + 1}, ${c} must be a literal text/number/null.`,
        );
        return [c, cell ?? null];
      }),
    );
  });
  return { columns, rows, sheets: [] };
}
export function parseImportNumber(
  input: string | number | null,
  decimal: '.' | ',',
  percent: 'ratio' | 'percent',
  unit: AnalyticsUnit,
) {
  if (input === null || (typeof input === 'string' && !input.trim())) return null;
  let value: number;
  let percentSuffix = false;
  if (typeof input === 'number') value = input;
  else {
    let text = input.trim();
    percentSuffix = text.endsWith('%');
    if (percentSuffix) text = text.slice(0, -1).trim();
    const pattern =
      decimal === '.'
        ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
        : /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/;
    requireAnalysis(
      pattern.test(text),
      'Invalid number for the selected decimal convention; grouping separators are not accepted.',
      undefined,
      'AMBIGUOUS_INPUT',
    );
    value = Number(decimal === ',' ? text.replace(',', '.') : text);
  }
  requireAnalysis(Number.isFinite(value), 'Value must be finite.');
  if (percentSuffix)
    requireAnalysis(
      unit.kind === 'ratio',
      'A percent suffix requires an explicitly mapped ratio unit.',
    );
  return unit.kind === 'ratio' && (percentSuffix || percent === 'percent') ? value / 100 : value;
}
export function parseImportDate(
  input: string | number | null,
  mapping: Pick<ImportMapping, 'dateFormat' | 'timezone'>,
) {
  requireAnalysis(input !== null, 'Date/time is required.');
  if (mapping.dateFormat.startsWith('excel')) {
    requireAnalysis(
      typeof input === 'number' || /^[\d.]+$/.test(String(input)),
      'Excel dates require a numeric serial.',
    );
    const serial = Number(input);
    requireAnalysis(
      Number.isFinite(serial) && serial >= 0 && serial < 2958466,
      'Invalid Excel serial date.',
    );
    const is1904 = mapping.dateFormat === 'excel-1904';
    requireAnalysis(
      is1904 || Math.floor(serial) !== 60,
      'Excel serial 60 represents the nonexistent 1900-02-29.',
    );
    const epoch = Date.UTC(is1904 ? 1904 : 1899, is1904 ? 0 : 11, is1904 ? 1 : 31);
    const date = new Date(epoch + (serial - (!is1904 && serial >= 60 ? 1 : 0)) * 86400000);
    return zonedTimestamp(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      mapping.timezone,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    );
  }
  const text = String(input).trim();
  if (mapping.dateFormat === 'iso') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) return zonedTimestamp(+dateOnly[1], +dateOnly[2], +dateOnly[3], mapping.timezone);
    const local = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(text);
    if (local)
      return zonedTimestamp(
        +local[1],
        +local[2],
        +local[3],
        mapping.timezone,
        +local[4],
        +local[5],
        +(local[6] ?? 0),
      );
    requireAnalysis(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(text) &&
        Number.isFinite(Date.parse(text)),
      'Use ISO dates/timestamps or choose the date convention explicitly.',
      undefined,
      'AMBIGUOUS_INPUT',
    );
    const parts = /^(\d{4})-(\d\d)-(\d\d)/.exec(text)!;
    const calendar = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    requireAnalysis(
      calendar.getUTCFullYear() === +parts[1] &&
        calendar.getUTCMonth() === +parts[2] - 1 &&
        calendar.getUTCDate() === +parts[3],
      'Invalid calendar date.',
    );
    return new Date(text).toISOString();
  }
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  requireAnalysis(
    match,
    'Use day/month/year or month/day/year according to your selected convention.',
    undefined,
    'AMBIGUOUS_INPUT',
  );
  return zonedTimestamp(
    +match[3],
    mapping.dateFormat === 'dmy' ? +match[2] : +match[1],
    mapping.dateFormat === 'dmy' ? +match[1] : +match[2],
    mapping.timezone,
  );
}
export function previewImport(
  source: ImportSource,
  mapping: ImportMapping,
  datasetId: string,
  byteLimit = DEFAULT_IMPORT_LIMIT_BYTES,
  context?: AnalysisContext,
): ImportPreview {
  const table = readImportTable(source, byteLimit, context);
  strictKeys(
    mapping,
    [
      'format',
      'timeColumn',
      'valueColumns',
      'valueColumn',
      'seriesColumn',
      'dimensions',
      'knownAtColumn',
      'numeratorColumn',
      'denominatorColumn',
      'ohlcColumns',
      'decimal',
      'percent',
      'dateFormat',
      'timezone',
      'resolution',
      'duplicatePolicy',
      'invalidRows',
      'missingValues',
      'longSeries',
    ],
    'mapping',
  );
  requireAnalysis(
    mapping && ['wide', 'long'].includes(mapping.format),
    'Choose wide or long format.',
  );
  requireAnalysis(
    ['.', ','].includes(mapping.decimal) && ['ratio', 'percent'].includes(mapping.percent),
    'Choose decimal and percentage conventions explicitly.',
  );
  requireAnalysis(
    ['iso', 'dmy', 'mdy', 'excel-1900', 'excel-1904'].includes(mapping.dateFormat),
    'Choose a date convention explicitly.',
  );
  requireAnalysis(
    ['reject', 'first', 'last', 'keep'].includes(mapping.duplicatePolicy) &&
      ['reject', 'skip'].includes(mapping.invalidRows) &&
      ['preserve', 'reject'].includes(mapping.missingValues),
    'Choose duplicate, invalid-row and missing-value policies.',
  );
  requireAnalysis(
    Array.isArray(mapping.dimensions) &&
      mapping.dimensions.length <= 10 &&
      mapping.dimensions.every((c) => table.columns.includes(c)),
    'Map valid dimension columns.',
  );
  requireAnalysis(
    typeof mapping.timezone === 'string' &&
      mapping.timezone.length > 0 &&
      mapping.timezone.length <= 100,
    'Specify an IANA time zone explicitly.',
    'mapping.timezone',
  );
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: mapping.timezone });
  } catch {
    throw new AnalyticsError('INVALID_ANALYTICS', 'Unknown IANA time zone.');
  }
  const required = [
    mapping.timeColumn,
    ...mapping.dimensions,
    ...(mapping.format === 'wide'
      ? (mapping.valueColumns ?? []).map((c) => c.column)
      : [mapping.valueColumn, mapping.seriesColumn]),
    mapping.knownAtColumn,
    mapping.numeratorColumn,
    mapping.denominatorColumn,
    ...Object.values(mapping.ohlcColumns ?? {}),
  ].filter((v): v is string => typeof v === 'string');
  requireAnalysis(
    required.every((c) => table.columns.includes(c)),
    'Mapping references an unknown column.',
  );
  const configs =
    mapping.format === 'wide'
      ? (mapping.valueColumns ?? []).map((c) => ({ ...c, key: c.column }))
      : (mapping.longSeries ?? []).map((c) => ({
          ...c,
          seriesId: c.id,
          key: c.name,
          column: mapping.valueColumn!,
        }));
  requireAnalysis(
    configs.length >= 1 && configs.length <= 100,
    'Map at least one and at most 100 series.',
  );
  for (const c of mapping.valueColumns ?? [])
    strictKeys(
      c,
      [
        'column',
        'seriesId',
        'name',
        'unit',
        'semantics',
        'aggregation',
        'direction',
        'riskPopulation',
      ],
      'mapping.valueColumns',
    );
  for (const c of mapping.longSeries ?? [])
    strictKeys(
      c,
      ['name', 'id', 'unit', 'semantics', 'aggregation', 'direction', 'riskPopulation'],
      'mapping.longSeries',
    );
  if (mapping.ohlcColumns)
    strictKeys(mapping.ohlcColumns, ['open', 'high', 'low', 'close'], 'mapping.ohlcColumns');
  const series: AnalyticsSeries[] = configs.map((c) => ({
    id: c.seriesId,
    name: c.name,
    datasetId,
    columnId: c.column,
    dimensions: {},
    unit: c.unit,
    semantics: c.semantics,
    provenance: 'observed',
    resolution: mapping.resolution,
    timezone: mapping.timezone,
    periodBoundary: 'start',
    aggregation: c.aggregation,
    direction: c.direction,
    ...(c.riskPopulation ? { riskPopulation: c.riskPopulation } : {}),
    definition: `Imported ${c.column} with explicit ${mapping.percent} and ${mapping.decimal} decimal conventions.`,
  }));
  const dataset: AnalyticsDataset = {
    id: datasetId,
    name: source.name.replace(/\.[^.]+$/, ''),
    version: 1,
    source: { kind: source.kind, name: source.name },
    observations: [],
    transformations: [
      `Format ${mapping.format}; time zone ${mapping.timezone}; date ${mapping.dateFormat}; decimal ${mapping.decimal}; percentages ${mapping.percent}; duplicates ${mapping.duplicatePolicy}; invalid rows ${mapping.invalidRows}; missing values ${mapping.missingValues}.`,
    ],
    importedAt: context?.now?.() ?? new Date().toISOString(),
    revisionHistory: 'unavailable',
  };
  validateAnalytics({ ...blankAnalytics(), datasets: [dataset], series });
  const seriesById = new Map(series.map((item) => [item.id, item]));
  const issues: AnalysisIssue[] = [],
    keys = new Map<string, number>();
  let skippedRows = 0;
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    if (rowIndex % 256 === 0) {
      checkAnalysis(context);
      context?.progress?.(rowIndex, table.rows.length);
    }
    const row = table.rows[rowIndex],
      pending: Observation[] = [];
    let currentColumn = mapping.timeColumn;
    try {
      const time = parseImportDate(row[mapping.timeColumn], mapping);
      const dimensions = Object.fromEntries(
        mapping.dimensions.map((c) => [c, String(row[c] ?? '')]),
      );
      const selected =
        mapping.format === 'wide'
          ? configs
          : configs.filter((c) => c.key === String(row[mapping.seriesColumn!]));
      currentColumn = mapping.seriesColumn ?? mapping.timeColumn;
      requireAnalysis(
        selected.length > 0,
        'Unknown long-format series; map each named series explicitly.',
      );
      for (const c of selected) {
        currentColumn = c.column;
        const value = parseImportNumber(row[c.column], mapping.decimal, mapping.percent, c.unit);
        requireAnalysis(
          value !== null || mapping.missingValues === 'preserve',
          'Missing value; choose preserve or correct the row.',
        );
        const o: Observation = {
          id: `obs-${rowIndex}-${c.seriesId.slice(0, 100)}`,
          seriesId: c.seriesId,
          time,
          value,
          dimensions,
          quality: value === null ? 'missing' : 'valid',
          sourceRow: rowIndex + 2,
        };
        if (mapping.knownAtColumn && row[mapping.knownAtColumn] !== null) {
          currentColumn = mapping.knownAtColumn;
          o.knownAt = parseImportDate(row[mapping.knownAtColumn], mapping);
        }
        if (mapping.numeratorColumn) {
          currentColumn = mapping.numeratorColumn;
          const numerator = parseImportNumber(
            row[mapping.numeratorColumn],
            mapping.decimal,
            'ratio',
            { kind: 'number', label: 'numerator' },
          );
          if (numerator !== null) o.numerator = numerator;
        }
        if (mapping.denominatorColumn) {
          currentColumn = mapping.denominatorColumn;
          const denominator = parseImportNumber(
            row[mapping.denominatorColumn],
            mapping.decimal,
            'ratio',
            { kind: 'number', label: 'denominator' },
          );
          if (denominator !== null) o.denominator = denominator;
        }
        if (mapping.ohlcColumns) {
          const entries = Object.entries(mapping.ohlcColumns).map(([key, column]) => {
            currentColumn = column;
            return [key, parseImportNumber(row[column], mapping.decimal, mapping.percent, c.unit)];
          });
          const ohlc = Object.fromEntries(entries);
          validateOhlc(ohlc);
          o.ohlc = ohlc as unknown as Observation['ohlc'];
        }
        currentColumn = c.column;
        if (c.riskPopulation === 'opening-customers') {
          requireAnalysis(
            value === null || (value >= 0 && value <= 1),
            'Customer churn must be between 0 and 100% of its defined opening risk population.',
            undefined,
            'INVALID_RATE_DENOMINATOR',
          );
          requireAnalysis(
            o.numerator === undefined ||
              (o.denominator !== undefined && o.denominator > 0 && o.numerator <= o.denominator),
            'Loss count must not exceed a positive risk population.',
            undefined,
            'INVALID_RATE_DENOMINATOR',
          );
        }
        validateObservation(o, 'observation', seriesById);
        if (
          c.semantics === 'rate' &&
          value !== null &&
          o.numerator !== undefined &&
          o.denominator !== undefined &&
          o.denominator > 0
        ) {
          const exposureRate = o.numerator / o.denominator;
          if (
            Math.abs(value - exposureRate) >
            1e-10 * Math.max(1, Math.abs(value), Math.abs(exposureRate))
          ) {
            if (issues.length < 10000)
              issues.push({
                code: 'INVALID_RATE_DENOMINATOR',
                message: `Reported rate ${value} differs from numerator/denominator ${exposureRate}. The reported value is preserved; explicit same-period segment pooling uses the exact exposures. Confirm that both describe the same risk population.`,
                row: rowIndex + 2,
                column: c.column,
                severity: 'warning',
              });
            const note =
              'Reported rate values are preserved, including rounding; explicit compatible same-period pooling recomputes rates from supplied numerators and denominators. Review rate/exposure discrepancies before commit.';
            if (!dataset.transformations.includes(note)) dataset.transformations.push(note);
          }
        }
        pending.push(o);
      }
      if (mapping.duplicatePolicy === 'reject') {
        const rowKeys = new Set<string>();
        for (const o of pending) {
          const key = JSON.stringify([o.seriesId, o.time, Object.entries(o.dimensions).sort()]);
          requireAnalysis(
            !keys.has(key) && !rowKeys.has(key),
            'Duplicate time/series/segment key; choose an explicit conflict policy.',
            mapping.timeColumn,
            'AMBIGUOUS_INPUT',
          );
          rowKeys.add(key);
        }
      }
      for (const o of pending) {
        const key = observationIdentityKey(o.seriesId, o.time, o.dimensions);
        o.id = `obs-${analyticsIdentity(`${datasetId}|${key}`)}${mapping.duplicatePolicy === 'keep' ? `-${rowIndex}` : ''}`;
        const index = keys.get(key);
        if (index !== undefined) {
          if (mapping.duplicatePolicy === 'reject')
            throw new AnalyticsError(
              'AMBIGUOUS_INPUT',
              'Duplicate time/series/segment key; choose an explicit conflict policy.',
            );
          if (mapping.duplicatePolicy === 'first') continue;
          if (mapping.duplicatePolicy === 'last') {
            dataset.observations[index] = o;
            continue;
          }
          if (issues.length < 10000)
            issues.push({
              code: 'AMBIGUOUS_INPUT',
              message: 'Duplicate observation retained by your explicit keep policy.',
              row: rowIndex + 2,
              column: mapping.timeColumn,
              severity: 'warning',
            });
        } else keys.set(key, dataset.observations.length);
        dataset.observations.push(o);
        requireAnalysis(
          dataset.observations.length <= analyticsLimits.observations,
          'Import exceeds 200,000 observations.',
          undefined,
          'IMPORT_LIMIT',
        );
      }
    } catch (error) {
      if (error instanceof AnalyticsError && error.code === 'IMPORT_LIMIT') throw error;
      const e =
        error instanceof AnalyticsError
          ? error
          : new AnalyticsError('INVALID_ANALYTICS', 'Invalid row.');
      if (issues.length < 10000)
        issues.push({
          code: e.code,
          message: e.message,
          row: rowIndex + 2,
          column: e.path?.endsWith('.denominator')
            ? (mapping.denominatorColumn ?? currentColumn)
            : e.path?.endsWith('.numerator')
              ? (mapping.numeratorColumn ?? currentColumn)
              : currentColumn,
          ...(e.path ? { path: e.path } : {}),
          severity: mapping.invalidRows === 'skip' ? 'warning' : 'error',
        });
      skippedRows++;
      if (mapping.invalidRows === 'reject')
        dataset.observations = dataset.observations.filter((o) => o.sourceRow !== rowIndex + 2);
    }
  }
  dataset.observations.sort(
    (a, b) => lexical(a.time, b.time) || lexical(a.seriesId, b.seriesId) || lexical(a.id, b.id),
  );
  const valid = !issues.some((i) => i.severity === 'error');
  if (valid) {
    const model = { ...blankAnalytics(), datasets: [dataset], series };
    validateAnalytics(model);
  }
  checkAnalysis(context);
  context?.progress?.(table.rows.length, table.rows.length);
  return {
    dataset,
    series,
    issues,
    columns: table.columns,
    sample: table.rows.slice(0, 10),
    valid,
    rows: table.rows.length,
    skippedRows,
  };
}
/** CSV exports protect spreadsheet users from formula injection in text cells. */
export function analyticsCsvCell(value: string | number | null) {
  if (value === null) return '';
  const text =
    typeof value === 'number'
      ? String(value)
      : /^[\s\u0000]*[=+\-@\t\r]/.test(value)
        ? `'${value}`
        : value;
  return `"${text.replace(/"/g, '""')}"`;
}
