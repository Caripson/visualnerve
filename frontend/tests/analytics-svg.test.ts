import { describe, expect, it, vi } from 'vitest';
import { blankAnalytics } from '../src/analytics/validation';
import { executeAnalysis, evaluateSignals } from '../src/analytics/engine';
import { growthChurnInput } from '../src/analytics/example';
import { prepareScenarioHistory } from '../src/analytics/scenario-history';
import {
  serializePreparedChartSvg,
  exportAnalyticsChartSvg,
  exportAnalyticsResultSvg,
} from '../src/analytics/vector-export';
import type { AnalyticsChart, AnalyticsExtension, AnalyticsSignal } from '../src/analytics/types';
vi.mock('../src/analytics/service', () => ({
  analyticsService: {
    run: async (
      request: Parameters<typeof executeAnalysis>[0],
      options: { guard?: () => Promise<void> } = {},
    ) => {
      await options.guard?.();
      const result = executeAnalysis(request);
      await options.guard?.();
      return result;
    },
  },
}));
const chart: AnalyticsChart = {
  id: 'chart',
  name: 'Illustrative chart',
  kind: 'line',
  seriesIds: ['series'],
  resolution: 'day',
  normalized: false,
};
const unit = { kind: 'count' as const, label: 'customers' };
const series = {
  id: 'series',
  name: 'Customers',
  unit,
  points: [10, 20, 30, 40].map((value, index) => ({ time: Date.UTC(2025, 0, index + 1), value })),
};
function model(): AnalyticsExtension {
  const value = blankAnalytics();
  value.charts = [chart];
  value.series = [
    {
      id: 'series',
      name: 'Customers',
      datasetId: 'history',
      unit,
      semantics: 'snapshot',
      provenance: 'observed',
      resolution: 'day',
      timezone: 'UTC',
      periodBoundary: 'start',
      aggregation: 'last',
      direction: 'higher-is-better',
      definition: 'Daily snapshots',
      dimensions: {},
    },
  ];
  value.datasets = [
    {
      id: 'history',
      name: 'Daily history',
      version: 1,
      source: { kind: 'example', name: 'Illustrative example data', illustrative: true },
      observations: series.points.map((point, index) => ({
        id: `observation-${index}`,
        seriesId: 'series',
        time: new Date(point.time).toISOString(),
        value: point.value,
        dimensions: {},
        quality: 'valid',
      })),
      transformations: [],
      importedAt: '2026-10-11T00:00:00.000Z',
      revisionHistory: 'unavailable',
    },
  ];
  return value;
}
describe('shared analytical vector exporter', () => {
  it('UI prepared data and worker/API preparation produce identical deterministic SVG', async () => {
    const options = { width: 900, height: 410, appearance: 'dark' as const };
    const rendered = serializePreparedChartSvg(chart, [series], options);
    expect(await exportAnalyticsChartSvg(model(), 'chart', options)).toEqual(rendered);
    expect(rendered.data).toContain('fill="#17231d"');
    expect(rendered.sampled).toBe(false);
  });
  it('XML labels and unsafe colors never become script, external resources or markup', () => {
    const rendered = serializePreparedChartSvg({ ...chart, name: '<script>alert(1)</script>' }, [
      {
        ...series,
        id: '" onload="alert(1)',
        name: '<img src=x onerror=alert(1)>',
        color: 'url(https://evil.test)',
      },
    ]);
    const svg = new DOMParser().parseFromString(rendered.data, 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.querySelector('script,img,image,foreignObject')).toBeNull();
    expect(svg.querySelector('[onload],[onerror]')).toBeNull();
    expect(rendered.data).not.toContain('https://evil.test');
    expect(svg.querySelector('title')?.textContent).toBe('<script>alert(1)</script>');
  });
  it('incompatible units occupy separate panels and currency is preserved', () => {
    const result = serializePreparedChartSvg(chart, [
      series,
      {
        ...series,
        id: 'mrc',
        name: 'MRC',
        unit: { kind: 'currency', label: 'MRC', currency: 'SEK' },
      },
    ]);
    expect(result.data).toContain('id="panel-0"');
    expect(result.data).toContain('id="panel-1"');
    expect(result.data).toContain('SEK');
    expect(result.sourcePoints).toBe(8);
  });
  it('large visualization is bounded and sampled missing gaps never become connected flow', () => {
    const points = Array.from({ length: 100000 }, (_, index) => ({
      time: Date.UTC(2025, 0, 1) + index * 1000,
      value: index === 250 ? null : index,
    }));
    const result = serializePreparedChartSvg(chart, [{ ...series, points }], { maxPoints: 1000 });
    expect(result.sourcePoints).toBe(100000);
    expect(result.renderedPoints).toBe(1000);
    expect(result.sampled).toBe(true);
    expect(result.data).toContain('Visual sampling: 1000 of 100000');
    const svg = new DOMParser().parseFromString(result.data, 'image/svg+xml');
    expect(svg.querySelectorAll('[data-series-id] path').length).toBeGreaterThan(1);
  });
  it('native missing periods remain breaks even under Original observations', async () => {
    const input = model();
    input.charts[0] = { ...chart, resolution: 'observation' };
    input.datasets[0].observations.splice(1, 1);
    const result = await exportAnalyticsChartSvg(input, 'chart');
    const svg = new DOMParser().parseFromString(result.data, 'image/svg+xml');
    expect(svg.querySelectorAll('[data-series-id] path')).toHaveLength(2);
  });
  it('valid observed OHLC exports real candle bodies and invalid/incomplete candles are rejected', () => {
    const candle = { ...chart, kind: 'candlestick' as const };
    const points = [
      { time: Date.UTC(2025, 0, 1), value: 105, open: 100, high: 110, low: 95, close: 105 },
    ];
    const result = serializePreparedChartSvg(candle, [{ ...series, points }]);
    expect(result.data).toContain('data-series-id="series"');
    expect(() =>
      serializePreparedChartSvg(candle, [{ ...series, points: [{ ...points[0], low: 106 }] }]),
    ).toThrow('real, valid OHLC');
    expect(() => serializePreparedChartSvg(candle, [series])).toThrow('real, valid OHLC');
  });
  it('empty filtered intervals and invalid viewport or point budgets are explicit errors', () => {
    expect(() =>
      serializePreparedChartSvg(chart, [series], {
        from: Date.UTC(2030, 0, 1),
        to: Date.UTC(2030, 0, 2),
      }),
    ).toThrow('No finite observations');
    expect(() => serializePreparedChartSvg(chart, [series], { width: 100 })).toThrow('320–4096');
    expect(() => serializePreparedChartSvg(chart, [series], { maxPoints: 100000 })).toThrow(
      '100–10000',
    );
  });
  it('reconciled waterfall uses named components, never invented calendar observations', () => {
    const result = serializePreparedChartSvg(
      { ...chart, kind: 'waterfall' },
      [
        {
          ...series,
          points: [
            { time: 0, value: 100, open: 0 },
            { time: 1, value: 120, open: 100 },
            { time: 2, value: 120, open: 0 },
          ],
        },
      ],
      { categoryLabels: ['Opening', 'New customers', 'Closing'] },
    );
    expect(result.data).toContain('New customers');
    expect(result.data).not.toContain('1970-');
    expect(() => serializePreparedChartSvg({ ...chart, kind: 'waterfall' }, [series])).toThrow(
      'named, reconciled',
    );
  });
});

it('scenario SVG shares observed-history preparation, separate units and the actual projection-start boundary with UI', async () => {
  const input = growthChurnInput();
  input.scenarioView = {
    customerHistorySeriesId: 'closing-customers',
    mrcHistorySeriesId: 'closing-mrc',
  };
  const scenario = input.scenarios[0];
  const content = executeAnalysis({ kind: 'scenario', scenario });
  if (!('kind' in content) || content.kind !== 'scenario') throw new Error('Invalid fixture.');
  const history = await prepareScenarioHistory(input, [scenario]);
  const projected = [
    {
      id: `${scenario.id}:customers`,
      name: `${scenario.name}: customer balance`,
      unit: history.customerUnit,
      provenance: 'scenario' as const,
      points: content.points.map((point) => ({
        time: Date.parse(point.time),
        value: point.closingCustomers,
      })),
    },
    {
      id: `${scenario.id}:mrc`,
      name: `${scenario.name}: MRC balance`,
      unit: history.mrcUnit,
      provenance: 'scenario' as const,
      points: content.points.map((point) => ({
        time: Date.parse(point.time),
        value: point.closingMrc,
      })),
    },
  ];
  const displayed = [...history.history, ...projected];
  const prepared = serializePreparedChartSvg(
    {
      id: scenario.id,
      name: scenario.name,
      kind: 'line',
      seriesIds: displayed.map((series) => series.id),
      resolution: 'month',
      normalized: false,
    },
    displayed,
    { projectionStart: Date.parse(scenario.start) },
  );
  const result = await exportAnalyticsResultSvg(input, 'scenario', scenario.id);
  expect(result).toEqual(prepared);
  const svg = new DOMParser().parseFromString(result.data, 'image/svg+xml');
  expect(svg.querySelectorAll('[data-projection-boundary]')).toHaveLength(2);
  expect(svg.querySelectorAll('[data-provenance="scenario"][stroke-dasharray="7 5"]')).toHaveLength(
    2,
  );
  expect(svg.querySelectorAll('[id^="panel-"]')).toHaveLength(2);
  expect(result.sourcePoints).toBe(120 + content.points.length * 2);
  expect(result.data).toContain('Closing customers (observed)');
  expect(result.data).toContain('Closing MRC (observed)');
  expect(result.data).toContain('Projection starts');
  const withoutHistory = await exportAnalyticsResultSvg(input, 'scenario', scenario.id, {
    customerHistorySeriesId: null,
    mrcHistorySeriesId: null,
  });
  expect(withoutHistory.sourcePoints).toBe(content.points.length * 2);
  expect(input.scenarioView.customerHistorySeriesId).toBe('closing-customers');
  await expect(
    exportAnalyticsResultSvg(input, 'scenario', scenario.id, { dimensions: { region: 'North' } }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNITS', path: 'export.options.dimensions' });
});

it('SVG dimension filters exclude other-segment signals and saved measurement overlays', () => {
  const base = {
    id: 'signal-a',
    episodeId: 'episode-a',
    ruleId: 'rule',
    ruleVersion: 1,
    seriesId: 'series',
    dimensions: { region: 'A' },
    dataVersion: 1,
    interval: { from: '2025-01-01T00:00:00.000Z', to: '2025-01-04T00:00:00.000Z' },
    observationTime: '2025-01-02T00:00:00.000Z',
    detectedAt: '2025-01-02T00:00:00.000Z',
    state: 'onset',
    value: 20,
    deviationMagnitude: 1,
    deviationUnit: 'customers',
    thresholdUnit: 'customers',
    baseline: 10,
    threshold: 15,
    unit,
    method: 'threshold',
    parameters: { threshold: 15 },
    evidence: { observations: 4, missing: 0 },
    quality: 'valid',
    explanation: 'Region A signal',
    severity: 'warning',
  } as AnalyticsSignal;
  const signals = [
    base,
    { ...base, id: 'signal-b', dimensions: { region: 'B' }, explanation: 'Region B signal' },
  ];
  const measurement = {
    id: 'measure-a',
    name: 'Region A annotation',
    kind: 'annotation' as const,
    seriesIds: ['series'],
    from: base.interval.from,
    to: base.interval.to,
    dimensions: { region: 'A' },
  };
  const measurements = [
    measurement,
    { ...measurement, id: 'measure-b', name: 'Region B annotation', dimensions: { region: 'B' } },
  ];
  const selected = serializePreparedChartSvg({ ...chart, dimensions: { region: 'A' } }, [series], {
    signals,
    measurements,
  });
  expect(selected.data).toContain('Region A signal');
  expect(selected.data).toContain('Region A annotation');
  expect(selected.data).not.toContain('Region B signal');
  expect(selected.data).not.toContain('Region B annotation');
  const pooled = serializePreparedChartSvg(chart, [series], { signals, measurements });
  expect(pooled.data).not.toContain('Region A signal');
  expect(pooled.data).not.toContain('Region A annotation');
});

it('SVG UI and API exclude signal markers captured against an older dataset version', async () => {
  const input = model();
  input.rules = [
    {
      id: 'threshold',
      name: 'Threshold',
      version: 1,
      enabled: true,
      family: 'threshold',
      seriesId: 'series',
      severity: 'warning',
      parameters: { threshold: 15, comparator: '>' },
    },
  ];
  input.signals = evaluateSignals(input).signals;
  expect(input.signals.length).toBeGreaterThan(0);
  const original = serializePreparedChartSvg(chart, [{ ...series, dataVersion: 1 }], {
    signals: input.signals,
  });
  expect(original.data).toContain('stroke-dasharray="4 4"');
  input.datasets[0].version = 2;
  const rendered = serializePreparedChartSvg(chart, [{ ...series, dataVersion: 2 }], {
    signals: input.signals,
  });
  expect(rendered.data).not.toContain('stroke-dasharray="4 4"');
  expect(await exportAnalyticsChartSvg(input, 'chart')).toEqual(rendered);
});

it('SVG API preparation excludes markers from an older rule version on the same data', async () => {
  const input = model();
  input.rules = [
    {
      id: 'threshold',
      name: 'Threshold',
      version: 1,
      enabled: true,
      family: 'threshold',
      seriesId: 'series',
      severity: 'warning',
      parameters: { threshold: 15, comparator: '>' },
    },
  ];
  input.signals = evaluateSignals(input).signals;
  expect(input.signals.length).toBeGreaterThan(0);
  input.rules[0].version = 2;
  input.rules[0].parameters.threshold = 25;
  const rendered = await exportAnalyticsChartSvg(input, 'chart');
  expect(rendered.data).not.toContain('stroke-dasharray="4 4"');
  expect(rendered).toEqual(serializePreparedChartSvg(chart, [{ ...series, dataVersion: 1 }]));
});

it.each(['bar', 'area', 'candlestick'] as const)(
  'computed regression overlays remain lines on a %s source chart',
  (kind) => {
    const source =
      kind === 'candlestick'
        ? {
            ...series,
            points: series.points.map((point) => ({
              ...point,
              open: point.value - 1,
              high: point.value + 2,
              low: point.value - 2,
              close: point.value,
            })),
          }
        : series;
    const fit = {
      ...series,
      id: 'regression-fit',
      name: 'Computed regression fit',
      renderAs: 'line' as const,
    };
    const result = serializePreparedChartSvg({ ...chart, kind }, [source, fit]);
    const overlay = result.data.split('data-series-id="regression-fit"')[1].split('</g>')[0];
    expect(overlay).toContain('Computed regression fit');
    expect(overlay).toContain('<path');
    expect(overlay).toContain('fill="none"');
    expect(overlay).not.toContain('<rect');
  },
);

it('measurement SVG plots shared-engine regression values and rejects other measurement kinds', async () => {
  const input = model();
  input.measurements = [
    {
      id: 'fit',
      name: 'Customer trend',
      kind: 'regression',
      seriesIds: ['series'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-04T00:00:00.000Z',
    },
  ];
  const result = await exportAnalyticsResultSvg(input, 'measurement', 'fit');
  const fit = executeAnalysis({
    kind: 'measurement',
    model: input,
    measurement: input.measurements[0],
  });
  expect(fit).toMatchObject({ kind: 'measurement', metrics: { slopePerDay: { value: 10 } } });
  expect(result.sourcePoints).toBe(8);
  expect(result.data).toContain('Customer trend: computed regression fit');
  expect(result).toEqual(
    serializePreparedChartSvg(
      {
        id: 'fit',
        name: 'Customer trend: descriptive regression',
        kind: 'line',
        seriesIds: ['series', 'fit:fit'],
        resolution: 'observation',
        normalized: false,
      },
      [
        {
          ...series,
          color: '#256b54',
          provenance: 'observed',
          dimensions: {},
          sourceDimensions: {},
          dataVersion: 1,
        },
        {
          ...series,
          id: 'fit:fit',
          name: 'Customer trend: computed regression fit',
          color: '#b9632f',
          provenance: 'derived',
          renderAs: 'line',
          dimensions: {},
          sourceDimensions: {},
          dataVersion: 1,
        },
      ],
    ),
  );
  input.measurements[0].kind = 'point-to-point';
  await expect(exportAnalyticsResultSvg(input, 'measurement', 'fit')).rejects.toMatchObject({
    code: 'INVALID_ANALYTICS',
  });
});

it('regression SVG retains fixed source dimensions when an equivalent explicit filter is provided', async () => {
  const input = model();
  input.series[0].dimensions = { region: 'A' };
  input.datasets[0].observations.forEach((observation) => {
    observation.dimensions = { region: 'A' };
  });
  input.measurements = [
    {
      id: 'fit',
      name: 'Region A trend',
      kind: 'regression',
      seriesIds: ['series'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-04T00:00:00.000Z',
    },
  ];
  const original = await exportAnalyticsResultSvg(input, 'measurement', 'fit');
  expect(
    await exportAnalyticsResultSvg(input, 'measurement', 'fit', { dimensions: { region: 'A' } }),
  ).toEqual(original);
  await expect(
    exportAnalyticsResultSvg(input, 'measurement', 'fit', { dimensions: { region: 'B' } }),
  ).rejects.toMatchObject({ code: 'INCOMPATIBLE_UNITS' });
});
