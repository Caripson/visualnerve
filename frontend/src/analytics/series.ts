import { unitsCompatible } from './units';
import type {
  AnalyticsExtension,
  AnalyticsChart,
  AnalyticsSeries,
  Observation,
  Resolution,
  AnalysisContext,
} from './types';
import {
  AnalyticsError,
  requireAnalysis,
  finiteNumber,
  validateOhlc,
  strictKeys,
  isoTime,
  dimensions,
} from './validation';
export const DAY_MS = 86400000;
export const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function checkAnalysis(context?: AnalysisContext) {
  if (context?.signal?.aborted) throw new AnalyticsError('CANCELLED', 'Analysis was cancelled.');
  if (context?.cutoff !== undefined) isoTime(context.cutoff, 'context.cutoff');
}
const timezoneFormatters = new Map<string, Intl.DateTimeFormat>();
export function localDateParts(time: string, timezone: string) {
  if (timezone === 'UTC') {
    const date = new Date(time);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  let formatter = timezoneFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    if (timezoneFormatters.size >= 32) timezoneFormatters.clear();
    timezoneFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(new Date(time));
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}
/** Reject DST folds/gaps rather than silently choosing a different observation time. */
export function zonedTimestamp(
  year: number,
  month: number,
  day: number,
  timezone: string,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  requireAnalysis(
    new Date(wall).getUTCFullYear() === year &&
      new Date(wall).getUTCMonth() === month - 1 &&
      new Date(wall).getUTCDate() === day &&
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23 &&
      Number.isInteger(minute) &&
      minute >= 0 &&
      minute <= 59 &&
      Number.isInteger(second) &&
      second >= 0 &&
      second <= 59,
    'Invalid calendar date.',
    undefined,
    'AMBIGUOUS_INPUT',
  );
  if (timezone === 'UTC') return new Date(wall).toISOString();
  let candidate = wall;
  for (let n = 0; n < 4; n++) {
    const p = localDateParts(new Date(candidate).toISOString(), timezone);
    candidate += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  const matches = new Set<number>();
  for (const offset of [0, -7200000, -3600000, -1800000, 1800000, 3600000, 7200000]) {
    const t = candidate + offset;
    const p = localDateParts(new Date(t).toISOString(), timezone);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    )
      matches.add(t);
  }
  requireAnalysis(
    matches.size === 1,
    matches.size
      ? 'Ambiguous daylight-saving local time; import an ISO timestamp with an explicit offset.'
      : 'Nonexistent daylight-saving local time; import an ISO timestamp with an explicit offset.',
    undefined,
    'AMBIGUOUS_INPUT',
  );
  return new Date([...matches][0]).toISOString();
}
export function periodKey(time: string, resolution: Resolution, timezone = 'UTC') {
  if (resolution === 'observation') return time;
  const p = localDateParts(time, timezone);
  if (resolution === 'day')
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (resolution === 'week') {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  if (resolution === 'month') return `${p.year}-${String(p.month).padStart(2, '0')}`;
  if (resolution === 'quarter') return `${p.year}-Q${Math.ceil(p.month / 3)}`;
  return `${p.year}`;
}
export function periodStart(time: string, resolution: Resolution, timezone = 'UTC') {
  if (resolution === 'observation') return time;
  const p = localDateParts(time, timezone);
  if (resolution === 'week') {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return zonedTimestamp(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), timezone);
  }
  return zonedTimestamp(
    p.year,
    resolution === 'year'
      ? 1
      : resolution === 'quarter'
        ? Math.floor((p.month - 1) / 3) * 3 + 1
        : p.month,
    resolution === 'day' ? p.day : 1,
    timezone,
  );
}
export function periodOrdinal(time: string, resolution: Resolution, timezone = 'UTC') {
  const p = localDateParts(time, timezone);
  if (resolution === 'month') return p.year * 12 + p.month - 1;
  if (resolution === 'quarter') return p.year * 4 + Math.floor((p.month - 1) / 3);
  if (resolution === 'year') return p.year;
  if (resolution === 'week')
    return Math.floor(Date.parse(periodKey(time, 'week', timezone)) / DAY_MS / 7);
  if (resolution === 'day') return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
  return Date.parse(time);
}
export function contiguous(a: Observation, b: Observation, series: AnalyticsSeries) {
  return (
    series.resolution === 'observation' ||
    periodOrdinal(b.time, series.resolution, series.timezone) -
      periodOrdinal(a.time, series.resolution, series.timezone) ===
      1
  );
}

/** A gap marker resets rolling state without inventing an observation in persisted data. */
export function calculationValues(
  rows: Observation[],
  series: AnalyticsSeries,
  availabilityCutoff?: string,
) {
  const values: (number | null)[] = [],
    indices: number[] = [];
  let latestKnowledge = '';
  for (let i = 0; i < rows.length; i++) {
    const observation = rows[i],
      knowledge =
        observation.knownAt && observation.knownAt > observation.time
          ? observation.knownAt
          : observation.time;
    if (
      i > 0 &&
      (!contiguous(rows[i - 1], observation, series) ||
        (!availabilityCutoff && knowledge < latestKnowledge))
    )
      values.push(null);
    indices.push(values.length);
    values.push(
      observation.quality === 'valid' && (!availabilityCutoff || knowledge <= availabilityCutoff)
        ? observation.value
        : null,
    );
    latestKnowledge = knowledge;
  }
  return { values, indices };
}

export function compatibleUnits(a: AnalyticsSeries, b: AnalyticsSeries) {
  return unitsCompatible(a.unit, b.unit);
}
function sameDimensions(actual: Record<string, string>, expected: Record<string, string>) {
  return Object.entries(expected).every(([k, v]) => actual[k] === v);
}
export interface SeriesQuery {
  from?: string;
  to?: string;
  resolution?: Resolution;
  dimensions?: Record<string, string>;
  cutoff?: string;
}
export function querySeries(
  model: AnalyticsExtension,
  seriesId: string,
  query: SeriesQuery = {},
  context?: AnalysisContext,
): Observation[] {
  checkAnalysis(context);
  strictKeys(query as unknown, ['from', 'to', 'resolution', 'dimensions', 'cutoff'], 'query');
  if (query.dimensions !== undefined) dimensions(query.dimensions, 'query.dimensions');
  for (const key of ['from', 'to', 'cutoff'] as const)
    if (query[key]) isoTime(query[key], `query.${key}`);
  requireAnalysis(
    !query.from || !query.to || query.from <= query.to,
    'Query interval is reversed.',
  );
  requireAnalysis(
    !query.resolution ||
      ['observation', 'day', 'week', 'month', 'quarter', 'year'].includes(query.resolution),
    'Unsupported query resolution.',
  );
  const series = model.series.find((s) => s.id === seriesId);
  requireAnalysis(series, 'Unknown analytics series.');
  const dataset = model.datasets.find((d) => d.id === series.datasetId);
  requireAnalysis(dataset, 'Unknown analytics dataset.');
  const cutoff = query.cutoff ?? context?.cutoff;
  let raw: Observation[];
  if (series.derived) {
    const inputs = series.derived.seriesIds.map((id) =>
      querySeries(
        model,
        id,
        {
          ...query,
          from: undefined,
          dimensions: { ...series.dimensions, ...query.dimensions },
          resolution: 'observation',
        },
        context,
      ),
    );
    requireAnalysis(
      inputs.every((rows) => new Set(rows.map((item) => item.time)).size === rows.length),
      'Choose an explicit segment for each derived input; duplicate timestamps are ambiguous.',
      undefined,
      'INCOMPATIBLE_UNITS',
    );
    const maps = inputs.map((rows) => new Map(rows.map((o) => [o.time, o])));
    const first = inputs[0];
    raw = first.map((o, index) => {
      const peers = maps.map((map) => map.get(o.time));
      const dependencyObservations =
        ['difference', 'relative-change'].includes(series.derived!.operation) && index > 0
          ? [...peers, first[index - 1]]
          : peers;
      let value: number | null = null;
      const values = peers.map((p) => (p?.quality === 'valid' ? p.value : null));
      if (values.every((v) => v !== null)) {
        const numbers = values as number[];
        switch (series.derived!.operation) {
          case 'difference':
            value =
              index > 0 &&
              first[index - 1].value !== null &&
              first[index - 1].quality === 'valid' &&
              contiguous(first[index - 1], o, series)
                ? numbers[0] - first[index - 1].value!
                : null;
            break;
          case 'relative-change':
            value =
              index > 0 &&
              first[index - 1].value! > 0 &&
              first[index - 1].quality === 'valid' &&
              contiguous(first[index - 1], o, series)
                ? (numbers[0] - first[index - 1].value!) / first[index - 1].value!
                : null;
            break;
          case 'sum':
            value = numbers.reduce((a, b) => a + b, 0);
            break;
          case 'subtract':
            value = numbers[0] - numbers[1];
            break;
          case 'multiply':
            value = numbers.reduce((a, b) => a * b, 1);
            break;
          case 'divide':
            value = numbers[1] !== 0 ? numbers[0] / numbers[1] : null;
        }
      }
      if (value !== null) finiteNumber(value, 'derived.value', -Number.MAX_VALUE, Number.MAX_VALUE);
      requireAnalysis(
        series.riskPopulation !== 'opening-customers' ||
          value === null ||
          (value >= 0 && value <= 1),
        'Derived customer churn must stay within 0–100% of its defined opening risk population.',
        'derived.value',
        'INVALID_RATE_DENOMINATOR',
      );
      return {
        ...o,
        id: `derived-${index}-${seriesId.slice(0, 100)}`,
        knownAt: dependencyObservations
          .map((p) => p?.knownAt ?? p?.time ?? '')
          .sort()
          .at(-1),
        seriesId,
        dimensions: { ...series.dimensions, ...query.dimensions },
        numerator: undefined,
        denominator: undefined,
        ohlc: undefined,
        value,
        quality: value === null ? 'missing' : 'valid',
      };
    });
  } else
    raw = dataset.observations
      .filter(
        (o) =>
          o.seriesId === seriesId &&
          sameDimensions(o.dimensions, series.dimensions) &&
          sameDimensions(o.dimensions, query.dimensions ?? {}) &&
          (!cutoff || (o.time <= cutoff && (!o.knownAt || o.knownAt <= cutoff))),
      )
      .sort((a, b) => lexical(a.time, b.time) || lexical(a.id, b.id));
  raw = raw.filter(
    (o) => (!query.from || o.time >= query.from) && (!query.to || o.time <= query.to),
  );
  const resolution = query.resolution ?? 'observation';
  if (resolution === 'observation')
    return raw.map((o) => ({ ...o, dimensions: { ...o.dimensions } }));
  if (series.aggregation === 'none')
    throw new AnalyticsError(
      'INCOMPATIBLE_UNITS',
      'This series does not allow temporal aggregation.',
    );
  const groups = new Map<string, Observation[]>();
  for (const o of raw) {
    const key = periodKey(o.time, resolution, series.timezone);
    const group = groups.get(key) ?? [];
    group.push(o);
    groups.set(key, group);
  }
  return [...groups.values()].map((rows, index) => {
    const valid = rows.filter((o) => o.value !== null && o.quality === 'valid');
    const dimensions = new Set(rows.map((o) => JSON.stringify(o.dimensions)));
    let value: number | null = null,
      numerator: number | undefined,
      denominator: number | undefined;
    if (valid.length === rows.length && valid.length) {
      if (series.aggregation === 'sum') value = valid.reduce((sum, o) => sum + o.value!, 0);
      else if (series.aggregation === 'ratio') {
        const times = new Set(valid.map((o) => o.time));
        requireAnalysis(
          times.size === 1,
          'Rates cannot be aggregated across time as cumulative cohort churn. Aggregate disjoint segments in the same period or choose their native period.',
          undefined,
          'INVALID_RATE_DENOMINATOR',
        );
        requireAnalysis(
          new Set(
            valid.map((o) =>
              JSON.stringify(Object.entries(o.dimensions).sort(([a], [b]) => lexical(a, b))),
            ),
          ).size === valid.length &&
            valid.every(
              (o) => o.numerator !== undefined && o.denominator !== undefined && o.denominator > 0,
            ),
          'Rate aggregation needs compatible positive numerators/denominators for every observation.',
          undefined,
          'INVALID_RATE_DENOMINATOR',
        );
        numerator = valid.reduce((sum, o) => sum + o.numerator!, 0);
        denominator = valid.reduce((sum, o) => sum + o.denominator!, 0);
        value = numerator / denominator;
      } else {
        requireAnalysis(
          dimensions.size === 1,
          'Select one segment before first/last snapshot aggregation.',
          undefined,
          'INCOMPATIBLE_UNITS',
        );
        value = (series.aggregation === 'first' ? valid[0] : valid[valid.length - 1]).value;
      }
    }
    if (value !== null)
      finiteNumber(value, 'aggregation.value', -Number.MAX_VALUE, Number.MAX_VALUE);
    const first = rows[0];
    return {
      ...first,
      id: `${series.id}:aggregate:${index}`,
      time: periodStart(first.time, resolution, series.timezone),
      knownAt: rows.reduce((latest, row) => {
        const release = row.knownAt && row.knownAt > row.time ? row.knownAt : row.time;
        return release > latest ? release : latest;
      }, first.time),
      periodEnd: rows.reduce(
        (latest, row) =>
          (row.periodEnd ?? row.time) > latest ? (row.periodEnd ?? row.time) : latest,
        first.time,
      ),
      value,
      quality: value === null ? 'missing' : 'valid',
      dimensions: dimensions.size === 1 ? first.dimensions : {},
      ...(numerator !== undefined ? { numerator, denominator } : {}),
      ohlc: undefined,
    };
  });
}
export const seriesObservations = querySeries;
export function aggregateOHLC(
  model: AnalyticsExtension,
  seriesId: string,
  resolution: Resolution,
  query: SeriesQuery = {},
  context?: AnalysisContext,
): Observation[] {
  const series = model.series.find((s) => s.id === seriesId);
  requireAnalysis(
    series?.semantics === 'snapshot',
    'Candlesticks require intraperiod snapshots or explicitly imported OHLC, never period flows/rates.',
    undefined,
    'INVALID_OHLC',
  );
  requireAnalysis(
    ['observation', 'day', 'week', 'month', 'quarter', 'year'].includes(resolution),
    'Unsupported OHLC resolution.',
  );
  const raw = querySeries(model, seriesId, { ...query, resolution: 'observation' }, context);
  const groups = new Map<string, Observation[]>();
  for (const o of raw) {
    const key = periodKey(o.time, resolution, series.timezone);
    const group = groups.get(key) ?? [];
    group.push(o);
    groups.set(key, group);
  }
  return [...groups.values()].map((rows, index) => {
    requireAnalysis(
      rows.every((o) => o.value !== null && o.quality === 'valid'),
      'Candlestick periods require complete valid observations.',
      undefined,
      'INSUFFICIENT_DATA',
    );
    requireAnalysis(
      new Set(rows.map((o) => JSON.stringify(o.dimensions))).size === 1,
      'Select one segment for OHLC.',
      undefined,
      'INCOMPATIBLE_UNITS',
    );
    const imported = rows.every((o) => o.ohlc);
    requireAnalysis(
      imported || rows.every((o) => !o.ohlc),
      'Do not mix imported OHLC periods with individual snapshots in the same candle.',
      undefined,
      'INVALID_OHLC',
    );
    requireAnalysis(
      imported || new Set(rows.map((o) => o.time)).size >= 2,
      'Candlestick is unavailable: fewer than two actual observation times in this period. Use a line chart.',
      undefined,
      'INSUFFICIENT_DATA',
    );
    const values = rows.map((o) => o.value!);
    const ohlc = imported
      ? {
          open: rows[0].ohlc!.open,
          close: rows.at(-1)!.ohlc!.close,
          high: rows.reduce((a, o) => Math.max(a, o.ohlc!.high), -Infinity),
          low: rows.reduce((a, o) => Math.min(a, o.ohlc!.low), Infinity),
        }
      : {
          open: values[0],
          close: values.at(-1)!,
          high: values.reduce((a, b) => Math.max(a, b), -Infinity),
          low: values.reduce((a, b) => Math.min(a, b), Infinity),
        };
    validateOhlc(ohlc);
    return {
      ...rows[0],
      id: `${seriesId}:ohlc:${index}`,
      time: periodStart(rows[0].time, resolution, series.timezone),
      knownAt: rows.reduce((latest, row) => {
        const release = row.knownAt && row.knownAt > row.time ? row.knownAt : row.time;
        return release > latest ? release : latest;
      }, rows[0].time),
      periodEnd: rows.reduce(
        (latest, row) =>
          (row.periodEnd ?? row.time) > latest ? (row.periodEnd ?? row.time) : latest,
        rows[0].time,
      ),
      value: ohlc.close,
      ohlc,
    };
  });
}
export function normalizeSeries(observations: Observation[]) {
  const base = observations.find((o) => o.value !== null)?.value;
  return observations.map((o) => ({
    ...o,
    value:
      base !== null && base !== undefined && base > 0 && o.value !== null
        ? (o.value / base) * 100
        : null,
    quality: base && base > 0 && o.value !== null ? o.quality : ('missing' as const),
  }));
}
export function waterfall(
  model: AnalyticsExtension,
  chart: AnalyticsChart,
  time: string,
  context?: AnalysisContext,
) {
  checkAnalysis(context);
  isoTime(time, 'waterfall.time');
  requireAnalysis(
    chart.kind === 'waterfall' && chart.waterfall,
    'A waterfall requires explicit opening/closing and change components.',
  );
  const spec = chart.waterfall;
  const ids = [
    spec.openingSeriesId,
    ...spec.components.map((c) => c.seriesId),
    spec.closingSeriesId,
  ];
  const series = ids.map((id) => model.series.find((s) => s.id === id)!);
  requireAnalysis(
    series.every((s) => s && compatibleUnits(s, series[0])),
    'Waterfall components must use compatible units; no automatic currency conversion.',
    undefined,
    'INCOMPATIBLE_UNITS',
  );
  const values = ids.map((id) => {
    const matches = querySeries(
      model,
      id,
      { from: time, to: time, dimensions: chart.dimensions },
      context,
    );
    requireAnalysis(
      matches.length <= 1,
      'Select one segment for waterfall components; duplicate times are ambiguous.',
      undefined,
      'INCOMPATIBLE_UNITS',
    );
    return matches.find((o) => o.time === time && o.quality === 'valid')?.value;
  });
  requireAnalysis(
    values.every((v) => typeof v === 'number'),
    'Missing waterfall components.',
    undefined,
    'INSUFFICIENT_DATA',
  );
  const opening = values[0]!,
    closing = values.at(-1)!;
  const components = spec.components.map((c, i) => ({
    seriesId: c.seriesId,
    name: series[i + 1].name,
    value: values[i + 1]! * c.sign,
  }));
  const residual = closing - opening - components.reduce((sum, c) => sum + c.value, 0);
  return {
    opening,
    closing,
    components,
    residual,
    reconciled: Math.abs(residual) <= 1e-8 * Math.max(1, Math.abs(closing)),
    unit: series[0].unit,
  };
}
