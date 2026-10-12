import type { AnalyticsChart, AnalyticsMeasurement, AnalyticsSignal, AnalyticsUnit } from './types';
import { AnalyticsError } from './validation';

export interface AnalyticsSvgPoint {
  time: number;
  value: number | null;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  breakBefore?: boolean;
  quality?: string;
}
export interface AnalyticsSvgSeries {
  id: string;
  name: string;
  unit: AnalyticsUnit;
  color?: string;
  dimensions?: Record<string, string>;
  sourceDimensions?: Record<string, string>;
  dataVersion?: number;
  seriesVersion?: number;
  renderAs?: 'line';
  provenance?: 'observed' | 'derived' | 'scenario';
  points: AnalyticsSvgPoint[];
}
export interface AnalyticsSvgOptions {
  width?: number;
  height?: number;
  from?: number;
  to?: number;
  appearance?: 'light' | 'dark';
  maxPoints?: number;
  signals?: AnalyticsSignal[];
  measurements?: AnalyticsMeasurement[];
  threshold?: number;
  categoryLabels?: string[];
  projectionStart?: number;
}
export interface AnalyticsSvgExport {
  mimeType: 'image/svg+xml';
  data: string;
  sourcePoints: number;
  renderedPoints: number;
  sampled: boolean;
  warnings: string[];
}
export const analyticsSvgColors = [
  '#256b54',
  '#b9632f',
  '#426b9e',
  '#855a9e',
  '#aa4960',
  '#408c8c',
];
const escape = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
    );
const num = (value: number) => (Number.isFinite(value) ? Number(value.toFixed(3)).toString() : '0');
const color = (value: string | undefined, index: number) =>
  value && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : analyticsSvgColors[index % analyticsSvgColors.length];
const unitKey = (unit: AnalyticsUnit) =>
  JSON.stringify([unit.kind, unit.currency ?? '', unit.label]);
const label = (value: number, unit: AnalyticsUnit) =>
  unit.kind === 'ratio'
    ? `${num(value * 100)}%`
    : `${num(value)}${unit.kind === 'currency' ? ` ${unit.currency}` : ''}`;

/** Compact axis ticks only; inspection and exported source values retain their precision. */
export function analyticsAxisTickLabel(value: number, unit: AnalyticsUnit): string {
  const percent = unit.kind === 'ratio';
  const displayed = percent ? value * 100 : value;
  if (!Number.isFinite(displayed)) return 'N/A';
  const compact = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(displayed);
  const bounded =
    compact.length > 7
      ? new Intl.NumberFormat('en', {
          notation: 'scientific',
          maximumSignificantDigits: displayed < 0 ? 2 : 3,
        }).format(displayed)
      : compact;
  return `${bounded}${percent ? '%' : ''}`;
}
const stamp = (value: number) => new Date(value).toISOString().slice(0, 10);

/** Display sampling preserves missing-data breaks; it never becomes analysis input. */
function sample(points: AnalyticsSvgPoint[], limit: number): AnalyticsSvgPoint[] {
  if (points.length <= limit) return points;
  const sampled: AnalyticsSvgPoint[] = [];
  let previous = -1;
  for (let i = 0; i < limit; i++) {
    const index = Math.round((i * (points.length - 1)) / (limit - 1));
    const gap = points
      .slice(previous + 1, index + 1)
      .some((point) => point.value === null || point.breakBefore);
    sampled.push({
      ...points[index],
      breakBefore: points[index].breakBefore || (previous >= 0 && gap),
    });
    previous = index;
  }
  return sampled;
}
/** One escaped, bounded, DOM-free SVG serializer for UI and programmatic chart export. */
export function serializePreparedChartSvg(
  chart: AnalyticsChart,
  display: AnalyticsSvgSeries[],
  options: AnalyticsSvgOptions = {},
): AnalyticsSvgExport {
  const width = options.width ?? 1200;
  if (!Number.isInteger(width) || width < 320 || width > 4096)
    throw new AnalyticsError('INVALID_ANALYTICS', 'SVG width must be 320–4096 pixels.');
  const maxPoints = options.maxPoints ?? 4000;
  if (!Number.isInteger(maxPoints) || maxPoints < 100 || maxPoints > 10000)
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'SVG maxPoints must be 100–10000 total rendered points.',
    );
  if (maxPoints < display.length * 2)
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'SVG point budget must allow at least two points per series.',
    );
  if (!display.length || display.length > 100)
    throw new AnalyticsError('INSUFFICIENT_DATA', 'Select 1–100 series for chart SVG export.');
  let inputPoints = 0;
  for (const series of display)
    for (const point of series.points) {
      inputPoints++;
      if (
        !Number.isFinite(point.time) ||
        Math.abs(point.time) > 8640000000000000 ||
        (point.value !== null && (!Number.isFinite(point.value) || Math.abs(point.value) > 1e15))
      )
        throw new AnalyticsError(
          'INVALID_ANALYTICS',
          'SVG points require valid timestamps and finite bounded values.',
        );
    }
  if (inputPoints > 2000000)
    throw new AnalyticsError(
      'IMPORT_LIMIT',
      'SVG source preparation is bounded to two million display points.',
    );
  const finite = display.flatMap((series) =>
    series.points.filter(
      (point) =>
        Number.isFinite(point.time) && point.value !== null && Number.isFinite(point.value),
    ),
  );
  if (!finite.length)
    throw new AnalyticsError(
      'INSUFFICIENT_DATA',
      'No finite observations in the exported interval.',
    );
  let first = Infinity,
    last = -Infinity;
  for (const point of finite) {
    first = Math.min(first, point.time);
    last = Math.max(last, point.time);
  }
  if (
    chart.kind === 'waterfall' &&
    (!options.categoryLabels || options.categoryLabels.length !== display[0].points.length)
  )
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'Waterfall SVG requires named, reconciled change components.',
    );
  const from = options.from ?? (chart.from ? Date.parse(chart.from) : first);
  const to = options.to ?? (chart.to ? Date.parse(chart.to) : last);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'SVG time range must contain finite ordered timestamps.',
    );
  if (
    options.projectionStart !== undefined &&
    (!Number.isFinite(options.projectionStart) ||
      Math.abs(options.projectionStart) > 8640000000000000)
  )
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'SVG projection start must be a valid timestamp.',
    );
  const visible = display.map((series) => ({
    ...series,
    points: series.points.filter((point) => point.time >= from && point.time <= to),
  }));
  if (
    !visible.some((series) =>
      series.points.some((point) => point.value !== null && Number.isFinite(point.value)),
    )
  )
    throw new AnalyticsError(
      'INSUFFICIENT_DATA',
      'No finite observations in the exported interval.',
    );
  const groups = new Map<string, AnalyticsSvgSeries[]>();
  for (const series of visible) {
    const key = unitKey(series.unit);
    groups.set(key, [...(groups.get(key) ?? []), series]);
  }
  if (groups.size > 10)
    throw new AnalyticsError(
      'IMPORT_LIMIT',
      'SVG supports at most 10 separate unit panels. Export a smaller chart.',
    );
  const height = options.height ?? Math.min(4096, 110 + groups.size * 300);
  if (
    !Number.isInteger(height) ||
    height < 240 ||
    height > 4096 ||
    height < 110 + groups.size * 140
  )
    throw new AnalyticsError(
      'INVALID_ANALYTICS',
      'SVG height must be 240–4096 pixels and leave room for every unit panel.',
    );
  if (options.appearance !== undefined && !['light', 'dark'].includes(options.appearance))
    throw new AnalyticsError('INVALID_ANALYTICS', 'SVG appearance must be light or dark.');
  const dark = options.appearance === 'dark',
    ink = dark ? '#e7eee9' : '#18352c',
    grid = dark ? '#40564b' : '#d9e2dc',
    background = dark ? '#17231d' : '#fcfdfb';
  const output = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"><title id="title">${escape(chart.name)}</title>`,
  ];
  const sourcePoints = visible.reduce((total, series) => total + series.points.length, 0),
    budget = Math.max(2, Math.floor(maxPoints / visible.length));
  const rendered = visible.map((series) => ({ ...series, points: sample(series.points, budget) }));
  const renderedPoints = rendered.reduce((total, series) => total + series.points.length, 0),
    sampled = renderedPoints < sourcePoints;
  const warnings = [
    sampled
      ? `Visual sampling: ${renderedPoints} of ${sourcePoints} observations. Analysis uses complete data.`
      : 'All observations in the selected chart interval are rendered.',
  ];
  if (chart.normalized && chart.kind === 'candlestick')
    throw new AnalyticsError(
      'INCOMPATIBLE_UNITS',
      'Normalized candlesticks require an explicit OHLC transformation; choose original units.',
    );
  if (chart.normalized)
    warnings.push('Normalized index display; source data and measurement values remain unchanged.');
  if (display.some((series) => series.provenance === 'scenario'))
    warnings.push('Assumption-based scenario projection; not a confidence or prediction interval.');
  if (options.projectionStart !== undefined)
    warnings.push(
      `Observed history and separate scenario projections; projection starts ${new Date(options.projectionStart).toISOString()}.`,
    );
  if (chart.kind === 'waterfall')
    warnings.push(
      'Waterfall bars must be prepared from reconciled change components by the analysis engine.',
    );
  output.push(
    `<desc id="description">${escape(warnings.join(' '))}</desc><rect width="${width}" height="${height}" fill="${background}"/><g font-family="system-ui,sans-serif" fill="${ink}"><text x="20" y="30" font-size="20" font-weight="600">${escape(chart.name)}</text><text x="20" y="52" font-size="12">${escape(warnings[0])}</text>`,
  );
  let panel = 0;
  for (const entries of groups.values()) {
    const unit = entries[0].unit,
      panelHeight = (height - 110) / groups.size,
      top = 80 + panel * panelHeight,
      bottom = top + panelHeight - 42,
      left = 96,
      right = width - 30;
    let low = Infinity,
      high = -Infinity;
    for (const entry of entries)
      for (const point of entry.points)
        if (point.value !== null && Number.isFinite(point.value)) {
          low = Math.min(low, point.low ?? point.value);
          high = Math.max(high, point.high ?? point.value);
        }
    if (!Number.isFinite(low)) {
      panel++;
      continue;
    }
    if (['bar', 'area', 'waterfall'].includes(chart.kind)) {
      low = Math.min(low, 0);
      high = Math.max(high, 0);
    }
    if (options.threshold !== undefined && panel === 0) {
      if (!Number.isFinite(options.threshold))
        throw new AnalyticsError('INVALID_ANALYTICS', 'SVG threshold must be finite.');
      low = Math.min(low, options.threshold);
      high = Math.max(high, options.threshold);
    }
    const padding = (high - low || Math.abs(high) || 1) * 0.08;
    low -= padding;
    high += padding;
    const x = (time: number) => left + ((time - from) / (to - from || 1)) * (right - left),
      y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top),
      zero = y(0);
    output.push(
      `<text x="${left}" y="${num(top - 8)}" font-size="12" font-weight="600">${escape(unit.currency ?? unit.label)}</text>`,
    );
    for (let tick = 0; tick <= 4; tick++) {
      const value = low + ((high - low) * tick) / 4,
        pos = y(value);
      output.push(
        `<path d="M${left} ${num(pos)}H${right}" stroke="${grid}"/><text data-axis="value" x="${left - 8}" y="${num(pos + 4)}" text-anchor="end" font-size="11">${escape(analyticsAxisTickLabel(value, unit))}</text>`,
      );
    }
    if (options.categoryLabels) {
      for (const [index, text] of options.categoryLabels.entries())
        output.push(
          `<text x="${num(x(entries[0].points[index].time))}" y="${num(bottom + 20)}" text-anchor="${index === 0 ? 'start' : index === options.categoryLabels.length - 1 ? 'end' : 'middle'}" font-size="10">${escape(text.slice(0, 24))}</text>`,
        );
    } else
      for (let tick = 0; tick <= 3; tick++) {
        const time = from + ((to - from) * tick) / 3;
        output.push(
          `<text data-axis="time" x="${num(x(time))}" y="${num(bottom + 20)}" text-anchor="${tick === 0 ? 'start' : tick === 3 ? 'end' : 'middle'}" font-size="11">${stamp(time)}</text>`,
        );
      }
    output.push(
      `<defs><clipPath id="panel-${panel}"><rect x="${left}" y="${num(top)}" width="${right - left}" height="${num(bottom - top)}"/></clipPath></defs><g clip-path="url(#panel-${panel})">`,
    );
    if (
      options.projectionStart !== undefined &&
      options.projectionStart >= from &&
      options.projectionStart <= to
    ) {
      const boundary = x(options.projectionStart);
      const atRight = boundary > right - 150;
      output.push(
        `<g data-projection-boundary="${escape(new Date(options.projectionStart).toISOString())}"><path d="M${num(boundary)} ${num(top)}V${num(bottom)}" stroke="${ink}" stroke-dasharray="2 4" stroke-width="1.5"/><text x="${num(Math.max(left + 8, Math.min(right - 8, boundary + 8)))}" y="${num(top + 14)}" text-anchor="${atRight ? 'end' : 'start'}" font-size="11" font-weight="600">Projection starts</text></g>`,
      );
    }
    for (const entry of entries) {
      const index = visible.findIndex((series) => series.id === entry.id),
        points = rendered[index].points,
        paint = color(entry.color, index);
      const kind = entry.renderAs ?? chart.kind;
      output.push(
        `<g data-series-id="${escape(entry.id)}"${entry.provenance === 'scenario' ? ' data-provenance="scenario" stroke-dasharray="7 5"' : ''}><title>${escape(entry.name)} (${escape(unit.label)})</title>`,
      );
      if (kind === 'candlestick') {
        const barWidth = Math.max(
          1,
          Math.min(16, ((right - left) / Math.max(points.length, 1)) * 0.65),
        );
        for (const point of points)
          if (point.value !== null) {
            const { open, high, low, close } = point;
            if (
              ![open, high, low, close].every(
                (value) => value !== undefined && Number.isFinite(value),
              ) ||
              low! > Math.min(open!, close!) ||
              high! < Math.max(open!, close!) ||
              low! > high!
            )
              throw new AnalyticsError(
                'INVALID_OHLC',
                'Candlestick SVG requires real, valid OHLC for every non-missing observation.',
              );
            output.push(
              `<path d="M${num(x(point.time))} ${num(y(high!))}V${num(y(low!))}" stroke="${paint}"/><rect x="${num(x(point.time) - barWidth / 2)}" y="${num(Math.min(y(open!), y(close!)))}" width="${num(barWidth)}" height="${num(Math.max(1, Math.abs(y(open!) - y(close!))))}" fill="${close! >= open! ? paint : background}" stroke="${paint}"/>`,
            );
          }
      } else if (kind === 'bar' || kind === 'waterfall') {
        const barWidth = Math.max(
          1,
          Math.min(28, ((right - left) / Math.max(points.length, 1)) * 0.65),
        );
        for (const point of points)
          if (point.value !== null) {
            const base = kind === 'waterfall' ? (point.open ?? 0) : 0;
            output.push(
              `<rect x="${num(x(point.time) - barWidth / 2)}" y="${num(Math.min(y(point.value), y(base)))}" width="${num(barWidth)}" height="${num(Math.max(1, Math.abs(y(point.value) - y(base))))}" fill="${paint}"/>`,
            );
          }
      } else {
        let segment: AnalyticsSvgPoint[] = [];
        const flush = () => {
          if (!segment.length) return;
          const path = segment
            .map((point, i) => `${i ? 'L' : 'M'}${num(x(point.time))} ${num(y(point.value!))}`)
            .join(' ');
          if (kind === 'area')
            output.push(
              `<path d="${path} L${num(x(segment.at(-1)!.time))} ${num(zero)} L${num(x(segment[0].time))} ${num(zero)}Z" fill="${paint}" opacity="0.12"/>`,
            );
          output.push(`<path d="${path}" fill="none" stroke="${paint}" stroke-width="2"/>`);
          if (segment.length === 1)
            output.push(
              `<circle cx="${num(x(segment[0].time))}" cy="${num(y(segment[0].value!))}" r="3" fill="${paint}"/>`,
            );
          segment = [];
        };
        for (const point of points) {
          if (point.value === null || point.breakBefore) flush();
          if (point.value !== null) segment.push(point);
        }
        flush();
      }
      output.push('</g>');
    }
    if (!chart.normalized) {
      const matchingDimensions = (id: string, dimensions: Record<string, string> = {}) => {
        const entry = entries.find((series) => series.id === id);
        if (!entry) return false;
        const selected = { ...(entry.dimensions ?? {}), ...(chart.dimensions ?? {}) };
        return (
          Object.keys(dimensions).length === Object.keys(selected).length &&
          Object.entries(selected).every(([key, value]) => dimensions[key] === value)
        );
      };
      const signals = (options.signals ?? []).filter(
        (signal) =>
          matchingDimensions(signal.seriesId, signal.dimensions) &&
          (entries.find((series) => series.id === signal.seriesId)?.dataVersion === undefined ||
            entries.find((series) => series.id === signal.seriesId)?.dataVersion ===
              signal.dataVersion) &&
          (entries.find((series) => series.id === signal.seriesId)?.seriesVersion ?? 1) ===
            (signal.seriesVersion ?? 1) &&
          Date.parse(signal.observationTime) >= from &&
          Date.parse(signal.observationTime) <= to,
      );
      if (signals.length > 100)
        warnings.push('Only the first 100 signal markers per unit panel are exported.');
      for (const signal of signals.slice(0, 100))
        output.push(
          `<g><title>${escape(`${signal.state}: ${signal.explanation}`)}</title><path d="M${num(x(Date.parse(signal.observationTime)))} ${num(top)}V${num(bottom)}" stroke="${signal.severity === 'critical' ? '#bc4650' : '#b17a2d'}" stroke-dasharray="4 4"/><text x="${num(x(Date.parse(signal.observationTime)) + 3)}" y="${num(top + 14)}" font-size="11">!</text></g>`,
        );
      const measurements = (options.measurements ?? []).filter((item) =>
        item.seriesIds.some((id) =>
          matchingDimensions(id, {
            ...(entries.find((entry) => entry.id === id)?.sourceDimensions ?? {}),
            ...(item.dimensions ?? {}),
          }),
        ),
      );
      if (measurements.length > 100)
        warnings.push('Only the first 100 saved measurement overlays per unit panel are exported.');
      for (const item of measurements.slice(0, 100)) {
        const a = Math.max(from, Date.parse(item.from)),
          b = Math.min(to, Date.parse(item.to));
        if (a > b) continue;
        output.push(
          `<g><title>${escape(item.name)}</title><rect x="${num(x(a))}" y="${num(top)}" width="${num(Math.max(1, x(b) - x(a)))}" height="${num(bottom - top)}" fill="#426b9e" opacity="0.05"/>`,
        );
        if (item.kind === 'trend-line' && item.points?.length === 2)
          output.push(
            `<path d="M${num(x(Date.parse(item.points[0].time)))} ${num(y(item.points[0].value))}L${num(x(Date.parse(item.points[1].time)))} ${num(y(item.points[1].value))}" stroke="#855a9e" stroke-width="2" stroke-dasharray="6 3"/>`,
          );
        output.push('</g>');
      }
      if (options.threshold !== undefined && panel === 0)
        output.push(
          `<path d="M${left} ${num(y(options.threshold))}H${right}" stroke="#b17a2d" stroke-dasharray="6 4"><title>${escape(`Threshold ${label(options.threshold, unit)}`)}</title></path>`,
        );
    }
    output.push('</g>');
    panel++;
  }
  output.push(
    `<text x="20" y="${height - 10}" font-size="11">${escape(
      display
        .map((series) => `${series.name} (${series.unit.currency ?? series.unit.label})`)
        .join(' · ')
        .slice(0, 400),
    )}</text></g></svg>`,
  );
  output[1] = output[1].replace(
    /<desc id="description">.*?<\/desc>/,
    `<desc id="description">${escape(warnings.join(' '))}</desc>`,
  );
  return {
    mimeType: 'image/svg+xml',
    data: output.join(''),
    sourcePoints,
    renderedPoints,
    sampled,
    warnings,
  };
}
