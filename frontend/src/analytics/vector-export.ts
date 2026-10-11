import type {
  AnalyticsChart,
  AnalyticsExtension,
  IndicatorResult,
  MeasurementResult,
  Observation,
  ScenarioResult,
  WaterfallResult,
} from './types';
import { analyticsService, type AnalysisRunOptions } from './service';
import { AnalyticsError, strictKeys, validateAnalytics } from './validation';
import { contiguous, normalizeSeries } from './series';
import { isCurrentSignal } from './identity';
import {
  serializePreparedChartSvg,
  analyticsSvgColors,
  type AnalyticsSvgExport,
  type AnalyticsSvgSeries,
} from './vector-renderer';
export { serializePreparedChartSvg } from './vector-renderer';
export type {
  AnalyticsSvgSeries,
  AnalyticsSvgOptions,
  AnalyticsSvgExport,
} from './vector-renderer';

export interface AnalyticsChartExportOptions {
  width?: number;
  height?: number;
  appearance?: 'light' | 'dark';
  from?: string;
  to?: string;
  dimensions?: Record<string, string>;
  maxPoints?: number;
  time?: string;
  threshold?: number;
}
function validateOptions(options: AnalyticsChartExportOptions) {
  strictKeys(
    options as unknown,
    ['width', 'height', 'appearance', 'from', 'to', 'dimensions', 'maxPoints', 'time', 'threshold'],
    'export.options',
  );
  for (const key of ['from', 'to', 'time'] as const)
    if (
      options[key] !== undefined &&
      (!Number.isFinite(Date.parse(options[key]!)) ||
        new Date(options[key]!).toISOString() !== options[key])
    )
      throw new AnalyticsError(
        'INVALID_ANALYTICS',
        'Export times must use canonical UTC millisecond ISO timestamps.',
        `export.options.${key}`,
      );
}
function prepared(
  model: AnalyticsExtension,
  id: string,
  points: Observation[],
  index: number,
  normalized: boolean,
  resolution: AnalyticsChart['resolution'],
  dimensions: Record<string, string> = {},
): AnalyticsSvgSeries {
  const source = model.series.find((series) => series.id === id)!;
  const displayed = normalized ? normalizeSeries(points) : points;
  return {
    id,
    name: source.name,
    dimensions: { ...source.dimensions, ...dimensions },
    sourceDimensions: source.dimensions,
    dataVersion: model.datasets.find((dataset) => dataset.id === source.datasetId)?.version,
    seriesVersion: source.version ?? 1,
    unit: normalized ? { kind: 'number', label: 'index (first value = 100)' } : source.unit,
    provenance: source.provenance,
    color: analyticsSvgColors[index % analyticsSvgColors.length],
    points: displayed.map((point, i) => ({
      time: Date.parse(point.time),
      value: point.value,
      ...point.ohlc,
      breakBefore:
        i > 0 &&
        !contiguous(points[i - 1], points[i], {
          ...source,
          resolution: resolution === 'observation' ? source.resolution : resolution,
        }),
    })),
  };
}
/** Heavy queries and OHLC preparation use the same guarded worker as numerical analysis. */
export async function exportAnalyticsChartSvg(
  model: AnalyticsExtension,
  chartOrId: AnalyticsChart | string,
  options: AnalyticsChartExportOptions = {},
  controls: AnalysisRunOptions = {},
): Promise<AnalyticsSvgExport> {
  validateAnalytics(model);
  validateOptions(options);
  await controls.guard?.();
  controls.signal?.throwIfAborted();
  const chart =
    typeof chartOrId === 'string' ? model.charts.find((item) => item.id === chartOrId) : chartOrId;
  if (!chart) throw new AnalyticsError('INVALID_ANALYTICS', 'Chart not found.');
  const from = options.from ?? chart.from,
    to = options.to ?? chart.to;
  if (chart.kind === 'waterfall') {
    const time = options.time ?? from;
    if (!time)
      throw new AnalyticsError(
        'INVALID_ANALYTICS',
        'Waterfall SVG export requires a selected period in options.time.',
      );
    const result = (await analyticsService.run(
      { kind: 'waterfall', model, chart, time },
      controls,
    )) as WaterfallResult;
    let balance = result.opening;
    const points = [
      { time: 0, value: balance, open: 0 },
      ...result.components.map((component) => {
        const open = balance;
        balance += component.value;
        return { time: 0, value: balance, open };
      }),
      { time: 0, value: result.closing, open: 0 },
    ].map((point, index) => ({ ...point, time: index }));
    const unit = model.series.find(
      (series) => series.id === chart.waterfall?.openingSeriesId,
    )!.unit;
    const output = serializePreparedChartSvg(
      { ...chart, from: undefined, to: undefined },
      [
        {
          id: chart.id,
          name: `Opening · ${result.components.map((item) => item.name).join(' · ')} · Closing`,
          unit,
          points,
        },
      ],
      {
        ...options,
        from: undefined,
        to: undefined,
        categoryLabels: ['Opening', ...result.components.map((item) => item.name), 'Closing'],
      },
    );
    output.warnings.push(
      `Balance reconciliation residual: ${result.residual}. Component bars show cumulative balances.`,
    );
    await controls.guard?.();
    controls.signal?.throwIfAborted();
    return output;
  }
  const display: AnalyticsSvgSeries[] = [];
  for (const [index, id] of chart.seriesIds.entries()) {
    const points = (await analyticsService.run(
      {
        kind: 'query',
        model,
        seriesId: id,
        query: {
          from,
          to,
          resolution: chart.resolution,
          dimensions: options.dimensions ?? chart.dimensions,
        },
        ohlc: chart.kind === 'candlestick',
      },
      controls,
    )) as Observation[];
    const times = new Set(points.map((point) => point.time));
    if (times.size !== points.length)
      throw new AnalyticsError(
        'INCOMPATIBLE_UNITS',
        'Select one segment or a semantically valid segment aggregation before SVG export.',
      );
    display.push(
      prepared(
        model,
        id,
        points,
        index,
        chart.normalized,
        chart.resolution,
        options.dimensions ?? chart.dimensions,
      ),
    );
  }
  const currentSignals = new Map<string, boolean>();
  const signals = model.signals.filter((signal) => {
    const key = JSON.stringify([
      signal.ruleId,
      signal.ruleVersion,
      signal.seriesId,
      signal.seriesVersion ?? 1,
      signal.dataVersion,
      signal.definitionFingerprint,
    ]);
    if (!currentSignals.has(key)) currentSignals.set(key, isCurrentSignal(model, signal));
    return currentSignals.get(key);
  });
  const output = serializePreparedChartSvg(
    { ...chart, dimensions: options.dimensions ?? chart.dimensions },
    display,
    {
      width: options.width,
      height: options.height,
      appearance: options.appearance,
      maxPoints: options.maxPoints,
      threshold: options.threshold,
      from: from ? Date.parse(from) : undefined,
      to: to ? Date.parse(to) : undefined,
      signals,
      measurements: model.measurements,
    },
  );
  await controls.guard?.();
  controls.signal?.throwIfAborted();
  return output;
}
/** Analytical result charts use actual shared-engine outputs, without canvas coordinates. */
export async function exportAnalyticsResultSvg(
  model: AnalyticsExtension,
  scope: 'indicator' | 'scenario' | 'measurement',
  id: string,
  options: AnalyticsChartExportOptions = {},
  controls: AnalysisRunOptions = {},
): Promise<AnalyticsSvgExport> {
  validateAnalytics(model);
  validateOptions(options);
  let display: AnalyticsSvgSeries[], name: string;
  if (scope === 'measurement') {
    const measurement = model.measurements.find((item) => item.id === id);
    if (!measurement) throw new AnalyticsError('INVALID_ANALYTICS', 'Measurement not found.');
    if (measurement.kind !== 'regression')
      throw new AnalyticsError(
        'INVALID_ANALYTICS',
        'Measurement SVG supports regression only. Export other measurement tools as JSON or CSV.',
      );
    const sourceId = measurement.seriesIds[0];
    const sourceDimensions = model.series.find((series) => series.id === sourceId)!.dimensions;
    if (
      options.dimensions &&
      JSON.stringify(Object.entries({ ...sourceDimensions, ...options.dimensions }).sort()) !==
        JSON.stringify(Object.entries({ ...sourceDimensions, ...measurement.dimensions }).sort())
    )
      throw new AnalyticsError(
        'INCOMPATIBLE_UNITS',
        'A regression export must retain the measurement segment filter. Edit its definition to analyze another segment.',
      );
    const result = (await analyticsService.run(
      { kind: 'measurement', model, measurement },
      controls,
    )) as MeasurementResult;
    if (!result.values?.length)
      throw new AnalyticsError(
        'INSUFFICIENT_DATA',
        'Regression SVG requires an actual fitted result with sufficient observations.',
      );
    const points = (await analyticsService.run(
      {
        kind: 'query',
        model,
        seriesId: sourceId,
        query: { from: measurement.from, to: measurement.to, dimensions: measurement.dimensions },
      },
      controls,
    )) as Observation[];
    const original = prepared(
      model,
      sourceId,
      points,
      0,
      false,
      'observation',
      measurement.dimensions,
    );
    name = `${measurement.name}: descriptive regression`;
    display = [
      original,
      {
        id: `${id}:fit`,
        name: `${measurement.name}: computed regression fit`,
        unit: original.unit,
        provenance: 'derived',
        renderAs: 'line',
        dimensions: original.dimensions,
        sourceDimensions: original.sourceDimensions,
        dataVersion: original.dataVersion,
        seriesVersion: original.seriesVersion,
        color: analyticsSvgColors[1],
        points: result.values.map((point) => ({
          time: Date.parse(point.time),
          value: point.value,
        })),
      },
    ];
    options = {
      ...options,
      from: options.from ?? measurement.from,
      to: options.to ?? measurement.to,
      dimensions: measurement.dimensions,
    };
  } else if (scope === 'indicator') {
    const indicator = model.indicators.find((item) => item.id === id);
    if (!indicator) throw new AnalyticsError('INVALID_ANALYTICS', 'Indicator not found.');
    const result = (await analyticsService.run(
      { kind: 'indicator', model, indicator },
      controls,
    )) as IndicatorResult;
    const source = model.series.find((series) => series.id === indicator.seriesId)!;
    name = indicator.name;
    display = ['value', 'upper', 'lower', 'signal', 'histogram']
      .filter((component) =>
        result.points.some(
          (point) => (point as unknown as Record<string, unknown>)[component] !== undefined,
        ),
      )
      .map((component, index) => ({
        id: `${id}:${component}`,
        name: `${name}: ${component}`,
        unit:
          indicator.kind === 'rsi'
            ? { kind: 'number' as const, label: 'RSI points' }
            : indicator.kind === 'roc'
              ? { kind: 'ratio' as const, label: '%' }
              : source.unit,
        provenance: 'derived' as const,
        color: analyticsSvgColors[index],
        points: result.points.map((point) => ({
          time: Date.parse(point.time),
          value: (point as unknown as Record<string, number | null>)[component] ?? null,
        })),
      }));
  } else {
    const scenario = model.scenarios.find((item) => item.id === id);
    if (!scenario) throw new AnalyticsError('INVALID_ANALYTICS', 'Scenario not found.');
    const result = (await analyticsService.run(
      { kind: 'scenario', scenario },
      controls,
    )) as ScenarioResult;
    name = scenario.name;
    display = [
      {
        id: `${id}:customers`,
        name: `${name}: customer balance`,
        unit: { kind: 'count', label: 'customers' },
        provenance: 'scenario',
        points: result.points.map((point) => ({
          time: Date.parse(point.time),
          value: point.closingCustomers,
        })),
      },
      {
        id: `${id}:mrc`,
        name: `${name}: MRC balance`,
        unit: { kind: 'currency', label: 'MRC', currency: scenario.assumptions.currency },
        provenance: 'scenario',
        points: result.points.map((point) => ({
          time: Date.parse(point.time),
          value: point.closingMrc,
        })),
      },
    ];
  }
  const chart: AnalyticsChart = {
    id,
    name,
    kind: 'line',
    seriesIds: display.map((series) => series.id),
    resolution: scope === 'scenario' ? 'month' : 'observation',
    normalized: false,
  };
  const output = serializePreparedChartSvg(
    { ...chart, dimensions: options.dimensions ?? chart.dimensions },
    display,
    {
      ...options,
      from: options.from ? Date.parse(options.from) : undefined,
      to: options.to ? Date.parse(options.to) : undefined,
    },
  );
  await controls.guard?.();
  controls.signal?.throwIfAborted();
  return output;
}
