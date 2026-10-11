import type { AnalyticsExtension, AnalysisJobValue } from '../analytics/types';
import { analyticsLimits } from '../analytics/types';
import { AnalyticsCommandError } from './analytics-api-input';

export function bounded<T>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024)
    throw new AnalyticsCommandError(
      413,
      'This response exceeds the 8 MiB analytics envelope. Use paginated data/result queries.',
      'ANALYTICS_TRANSPORT_LIMIT',
    );
  return structuredClone(value);
}
export function page(url: URL) {
  const value = (key: string, fallback: number) => {
    const raw = url.searchParams.get(key);
    if (raw !== null && !/^\d+$/.test(raw))
      throw new AnalyticsCommandError(422, `${key} must be a nonnegative integer.`);
    const parsed = raw === null ? fallback : Number(raw);
    if (!Number.isSafeInteger(parsed))
      throw new AnalyticsCommandError(422, `${key} exceeds the integer limit.`);
    return parsed;
  };
  const offset = value('offset', 0),
    limit = value('limit', 100);
  if (limit < 1 || limit > analyticsLimits.page)
    throw new AnalyticsCommandError(422, `limit must be 1..${analyticsLimits.page}.`);
  return { offset, limit };
}
export function section<T>(values: T[], offset: number, limit: number) {
  if (offset > values.length)
    throw new AnalyticsCommandError(422, 'offset exceeds the available result.');
  const nextOffset = Math.min(values.length, offset + limit);
  return {
    offset,
    nextOffset,
    total: values.length,
    complete: nextOffset === values.length,
    items: values.slice(offset, nextOffset),
  };
}
export function summary(model: AnalyticsExtension) {
  return {
    ...model,
    datasets: model.datasets.map(({ observations, ...dataset }) => ({
      ...dataset,
      observationCount: observations.length,
    })),
    signals: { count: model.signals.length },
    results: model.results.map(({ inputSnapshot, content, ...result }) => ({
      ...result,
      kind: content.kind,
      inputAvailable: true,
    })),
  };
}
export function resultPage(value: AnalysisJobValue, offset: number, limit: number) {
  if (Array.isArray(value)) return { kind: 'query', summary: {}, ...section(value, offset, limit) };
  if ('schemaVersion' in value)
    throw new AnalyticsCommandError(
      422,
      'Internal model-validation results are not public analysis jobs.',
    );
  if ('reconciled' in value) {
    const { components, ...details } = value;
    return {
      kind: 'waterfall',
      summary: details,
      itemKey: 'components',
      ...section(components, offset, limit),
    };
  }
  if ('sheets' in value)
    return {
      kind: 'inspect-import',
      summary: {
        columns: value.columns,
        rows: value.rows,
        sheets: value.sheets,
        ...(value.seriesNames ? { seriesNames: value.seriesNames } : {}),
      },
      ...section(value.sample, offset, limit),
    };
  if ('dataset' in value)
    return {
      kind: 'import',
      summary: {
        valid: value.valid,
        rows: value.rows,
        skippedRows: value.skippedRows,
        columns: value.columns,
        issues: value.issues,
        series: value.series,
        dataset: { ...value.dataset, observations: undefined },
      },
      ...section(value.dataset.observations, offset, limit),
    };
  if (value.kind === 'measurement') {
    const { values, residuals, ...details } = value;
    const rows =
      values?.map((point, index) => ({
        ...point,
        ...(residuals?.[index] ? { residual: residuals[index].value } : {}),
      })) ??
      residuals?.map((point) => ({ time: point.time, value: null, residual: point.value })) ??
      [];
    return {
      kind: value.kind,
      summary: details,
      itemKey: residuals ? 'values-with-residuals' : 'values',
      ...section(rows, offset, limit),
    };
  }
  const key =
    value.kind === 'signals' ? 'signals' : value.kind === 'backtest' ? 'results' : 'points';
  const items = (value as unknown as Record<string, unknown>)[key] as unknown[] | undefined;
  const { [key]: omitted, ...details } = value as unknown as Record<string, unknown>;
  return {
    kind: value.kind,
    summary: details,
    itemKey: key,
    ...section(items ?? [], offset, limit),
  };
}
export function csv(rows: Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) => {
    let text =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    columns.map(cell).join(','),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(',')),
  ].join('\r\n');
}
