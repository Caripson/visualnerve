import { StorageError } from '../model/errors';
import type {
  AnalyticsExtension,
  AnalyticsChart,
  AnalyticsMeasurement,
  AnalyticsIndicator,
  AnalyticsScenario,
  BacktestConfig,
  AnalysisJobRequest,
  ImportSource,
  ImportMapping,
} from '../analytics/types';
import { analyticsLimits } from '../analytics/types';
import { validateScenario, isoTime } from '../analytics/validation';
import { compactAnalysisModel } from '../analytics/signal-history';
import { assertImportBytes } from '../imports/limits';

export const collections = [
  'datasets',
  'series',
  'charts',
  'indicators',
  'measurements',
  'rules',
  'backtests',
  'scenarios',
] as const;
export type Collection = (typeof collections)[number];
export type PublicAnalysisJobRequest = Exclude<
  AnalysisJobRequest,
  { kind: 'archive' | 'reconcile' | 'validate' | 'commit-import' }
>;
export type Entity = { id: string; [key: string]: unknown };
export class AnalyticsCommandError extends StorageError {
  readonly issues;
  constructor(
    status: number,
    message: string,
    readonly code = 'INVALID_ANALYTICS',
    path = '',
  ) {
    super(status, message);
    this.issues = [{ path, code, message, severity: 'error' as const }];
  }
}
export function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new AnalyticsCommandError(422, 'Provide a JSON analytics object.');
  if (
    Object.keys(value).some(
      (key) =>
        ['__proto__', 'constructor', 'prototype'].includes(key) || (keys && !keys.includes(key)),
    )
  )
    throw new AnalyticsCommandError(
      422,
      `Unexpected analytics field${keys ? `; accepted fields: ${keys.join(', ')}` : ''}.`,
    );
  return value as Record<string, unknown>;
}
export function baseVersion(value: unknown): number {
  if (value === undefined)
    throw new AnalyticsCommandError(
      428,
      'Provide the current baseVersion.',
      'VERSION_REQUIRED',
      'baseVersion',
    );
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new AnalyticsCommandError(422, 'baseVersion must be a positive integer.');
  return value as number;
}
export function query(url: URL, keys: string[] = []) {
  if (
    url.hash ||
    [...url.searchParams.keys()].some((key) => !keys.includes(key)) ||
    keys.some((key) => url.searchParams.getAll(key).length > 1)
  )
    throw new AnalyticsCommandError(422, 'Unknown or repeated analytics query parameter.');
}
export function identity(value: unknown, path = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new AnalyticsCommandError(
      422,
      'Use a stable semantic identity of 1–128 letters, numbers, dots, colons, underscores or dashes.',
      'INVALID_ANALYTICS',
      path,
    );
  return value;
}
export function merge(
  previous: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  object(patch);
  const next = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value && typeof value === 'object' && !Array.isArray(value))
      next[key] = merge(
        previous[key] && typeof previous[key] === 'object' && !Array.isArray(previous[key])
          ? (previous[key] as Record<string, unknown>)
          : {},
        object(value),
      );
    else next[key] = value;
  }
  return next;
}
function source(value: unknown, byteLimit?: number): ImportSource {
  const input = object(value, ['kind', 'name', 'text', 'data', 'sheet']);
  if (
    !['csv', 'xlsx', 'json'].includes(String(input.kind)) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 500
  )
    throw new AnalyticsCommandError(422, 'Import source requires csv/xlsx/json kind and a name.');
  if (input.kind === 'xlsx') {
    if (
      typeof input.data !== 'string' ||
      input.text !== undefined ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)
    )
      throw new AnalyticsCommandError(
        422,
        'XLSX source requires padded standard base64 data; text is not accepted.',
      );
    if (
      input.sheet !== undefined &&
      (typeof input.sheet !== 'string' || !input.sheet || input.sheet.length > 1000)
    )
      throw new AnalyticsCommandError(422, 'sheet must be a nonempty worksheet name.');
    const decodedBytes =
      (input.data.length / 4) * 3 -
      (input.data.endsWith('==') ? 2 : input.data.endsWith('=') ? 1 : 0);
    assertImportBytes(decodedBytes, byteLimit, 'XLSX import');
    const binary = atob(input.data);
    return {
      kind: 'xlsx',
      name: input.name,
      bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ...(typeof input.sheet === 'string' ? { sheet: input.sheet } : {}),
    };
  }
  if (typeof input.text !== 'string' || input.data !== undefined || input.sheet !== undefined)
    throw new AnalyticsCommandError(422, 'CSV/JSON source requires text and no binary data/sheet.');
  assertImportBytes(new TextEncoder().encode(input.text).length, byteLimit, 'Time series import');
  return { kind: input.kind as 'csv' | 'json', name: input.name, text: input.text };
}
function appendDefinition(model: AnalyticsExtension, collection: Collection, value: unknown) {
  const entity = object(value);
  const id = identity(entity.id);
  const current = model[collection] as unknown as Entity[];
  const next = { ...model, [collection]: [...current.filter((entry) => entry.id !== id), entity] };
  return next;
}
export function request(
  model: AnalyticsExtension,
  kind: PublicAnalysisJobRequest['kind'],
  payload: unknown,
  byteLimit?: number,
): PublicAnalysisJobRequest {
  const originalModel = model;
  model = compactAnalysisModel(model);
  if (kind === 'inspect-import') {
    const data = object(payload, ['source', 'seriesColumn']);
    if (
      data.seriesColumn !== undefined &&
      (typeof data.seriesColumn !== 'string' ||
        !data.seriesColumn ||
        data.seriesColumn.length > 1000)
    )
      throw new AnalyticsCommandError(422, 'seriesColumn must be a nonempty column name.');
    return {
      kind,
      source: source(data.source, byteLimit),
      byteLimit,
      ...(data.seriesColumn !== undefined ? { seriesColumn: data.seriesColumn as string } : {}),
    };
  }
  if (kind === 'query') {
    const data = object(payload, [
      'seriesId',
      'from',
      'to',
      'resolution',
      'dimensions',
      'cutoff',
      'ohlc',
    ]);
    const seriesId = identity(data.seriesId, 'seriesId');
    if (!model.series.some((series) => series.id === seriesId))
      throw new AnalyticsCommandError(404, 'Analytics series not found.');
    for (const key of ['from', 'to', 'cutoff'])
      if (data[key] !== undefined) isoTime(data[key], key);
    if (data.from && data.to && data.from > data.to)
      throw new AnalyticsCommandError(422, 'from must precede to.');
    if (
      data.resolution !== undefined &&
      !['observation', 'day', 'week', 'month', 'quarter', 'year'].includes(String(data.resolution))
    )
      throw new AnalyticsCommandError(422, 'Unsupported aggregation resolution.');
    if (data.ohlc !== undefined && typeof data.ohlc !== 'boolean')
      throw new AnalyticsCommandError(422, 'ohlc must be boolean.');
    if (data.dimensions !== undefined) {
      const dimensions = object(data.dimensions);
      if (
        Object.keys(dimensions).length > 10 ||
        Object.entries(dimensions).some(
          ([key, value]) => key.length > 100 || typeof value !== 'string' || value.length > 300,
        )
      )
        throw new AnalyticsCommandError(
          422,
          'Provide at most 10 named string dimensions (names ≤100, values ≤300 characters).',
        );
    }
    const { ohlc, ...parameters } = data;
    const { seriesId: ignored, ...options } = parameters;
    return {
      kind,
      model,
      seriesId,
      query: options as Extract<AnalysisJobRequest, { kind: 'query' }>['query'],
      ...(ohlc !== undefined ? { ohlc: ohlc as boolean } : {}),
    };
  }
  if (kind === 'import') {
    const data = object(payload, ['source', 'mapping', 'datasetId']);
    return {
      kind,
      source: source(data.source, byteLimit),
      mapping: object(data.mapping) as unknown as ImportMapping,
      datasetId: identity(data.datasetId),
      byteLimit,
    };
  }
  if (kind === 'signals') {
    const data = object(payload, ['ruleIds', 'from', 'to']);
    if (
      data.ruleIds !== undefined &&
      (!Array.isArray(data.ruleIds) ||
        !data.ruleIds.length ||
        data.ruleIds.length > analyticsLimits.rules ||
        data.ruleIds.some(
          (id) => typeof id !== 'string' || !model.rules.some((rule) => rule.id === id),
        ) ||
        new Set(data.ruleIds).size !== data.ruleIds.length)
    )
      throw new AnalyticsCommandError(422, 'ruleIds must identify distinct existing rules.');
    for (const key of ['from', 'to']) if (data[key] !== undefined) isoTime(data[key], key);
    if (data.from && data.to && Date.parse(data.from as string) > Date.parse(data.to as string))
      throw new AnalyticsCommandError(422, 'from must precede to.');
    return { kind, model, ...data } as PublicAnalysisJobRequest;
  }
  if (kind === 'waterfall') {
    const data = object(payload, ['id', 'chart', 'time']);
    if ((data.chart === undefined) === (data.id === undefined))
      throw new AnalyticsCommandError(
        422,
        'Provide exactly one waterfall chart definition or saved id.',
      );
    isoTime(data.time, 'time');
    const chart = data.chart ?? model.charts.find((entry) => entry.id === identity(data.id));
    if (!chart) throw new AnalyticsCommandError(404, 'Waterfall chart not found.');
    model = appendDefinition(model, 'charts', chart) as AnalyticsExtension;
    return { kind, model, chart: chart as AnalyticsChart, time: data.time as string };
  }
  const configs = {
    measurement: ['measurements', 'measurement'],
    indicator: ['indicators', 'indicator'],
    backtest: ['backtests', 'config'],
    scenario: ['scenarios', 'scenario'],
  } as const;
  const [collection, key] = configs[kind];
  const data = object(payload, [key, 'id']);
  if ((data[key] === undefined) === (data.id === undefined))
    throw new AnalyticsCommandError(422, `Provide exactly one ${key} definition or saved id.`);
  const value =
    data[key] ??
    (originalModel[collection] as unknown as Entity[]).find(
      (entity) => entity.id === identity(data.id),
    );
  if (!value) throw new AnalyticsCommandError(404, `The ${key} definition was not found.`);
  let calculation = value;
  if (kind === 'scenario') {
    validateScenario(value as AnalyticsScenario);
    const { sourceSignalId, ...numeric } = value as AnalyticsScenario;
    if (
      sourceSignalId !== undefined &&
      !originalModel.signals.some((signal) => signal.id === sourceSignalId)
    )
      throw new AnalyticsCommandError(
        422,
        'The scenario source signal is not retained in this document.',
      );
    calculation = numeric;
  }
  if (kind === 'measurement') {
    const { resultId, ...numeric } = object(value);
    if (
      resultId !== undefined &&
      !originalModel.results.some((result) => result.id === identity(resultId))
    )
      throw new AnalyticsCommandError(
        422,
        'The locked measurement result is not retained in this document.',
      );
    calculation = numeric;
  }
  model = appendDefinition(model, collection, calculation) as AnalyticsExtension;
  if (kind === 'measurement')
    return { kind, model, measurement: calculation as AnalyticsMeasurement };
  if (kind === 'indicator') return { kind, model, indicator: value as AnalyticsIndicator };
  if (kind === 'backtest') return { kind, model, config: value as BacktestConfig };
  return { kind, scenario: value as AnalyticsScenario };
}
