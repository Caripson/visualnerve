import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsWorkspace } from '../src/analytics/ui/AnalyticsWorkspace';
import { AnalyticsImportDialog } from '../src/analytics/ui/AnalyticsImportDialog';
import { SignalHistory } from '../src/analytics/ui/SignalHistory';
import { SignalsPanel } from '../src/analytics/ui/SignalsPanel';
import { MeasurementsPanel } from '../src/analytics/ui/MeasurementsPanel';
import { DatasetPanel } from '../src/analytics/ui/DatasetPanel';
import { SignalLabPanel } from '../src/analytics/ui/SignalLabPanel';
import { IndicatorsPanel } from '../src/analytics/ui/IndicatorsPanel';
import { ResultRetentionPanel } from '../src/analytics/ui/ResultRetentionPanel';
import { DimensionFilterFields } from '../src/analytics/ui/DimensionFilterFields';
import { measurementMetricLabel } from '../src/analytics/ui/measurement-display';
import { inputUtcTime, replaceUtcDate, replaceUtcTime } from '../src/analytics/ui/utc-time';
import { ScenariosPanel } from '../src/analytics/ui/ScenariosPanel';
import { DerivedSeriesEditor } from '../src/analytics/ui/DerivedSeriesEditor';
import { WaterfallView } from '../src/analytics/ui/WaterfallView';
import { reconcileAnalytics } from '../src/analytics/reconcile';
import { RuleExpressionEditor, defaultExpression } from '../src/analytics/ui/RuleExpressionEditor';
import { ChartView } from '../src/analytics/ui/ChartView';
import { ChartViewport } from '../src/analytics/ui/chart-viewport';
import { ExplorePanel } from '../src/analytics/ui/ExplorePanel';
import { usePreview } from '../src/analytics/ui/use-preview';
import { valueLabel } from '../src/analytics/ui/display';
import * as analyticsDisplay from '../src/analytics/ui/display';
import { useAnalysis } from '../src/analytics/ui/use-analysis';
import { executeAnalysis } from '../src/analytics/engine';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { analyticsService } from '../src/analytics/service';
import { archiveResult } from '../src/analytics/document';
import {
  analyticsAxisTickLabel,
  serializePreparedChartSvg,
} from '../src/analytics/vector-renderer';
import type {
  AnalyticsExtension,
  AnalyticsMeasurement,
  AnalyticsIndicator,
  AnalyticsResultContent,
  AnalysisJobRequest,
  AnalysisJobValue,
  SignalExpression,
} from '../src/analytics/types';
import type { PanelProps } from '../src/analytics/ui/types';

function fixture(ratio = false): AnalyticsExtension {
  const model = blankAnalytics();
  model.series = [
    {
      id: 'value',
      name: ratio ? 'Customer churn' : 'Customers',
      datasetId: 'data',
      dimensions: {},
      unit: ratio ? { kind: 'ratio', label: '%' } : { kind: 'count', label: 'customers' },
      semantics: ratio ? 'rate' : 'snapshot',
      aggregation: ratio ? 'none' : 'last',
      direction: ratio ? 'lower-is-better' : 'higher-is-better',
      resolution: 'day',
      timezone: 'UTC',
      periodBoundary: 'start',
      provenance: 'observed',
      definition: 'Synthetic UI test observations.',
    },
  ];
  model.datasets = [
    {
      id: 'data',
      name: 'Synthetic UI data',
      version: 1,
      source: { kind: 'example', name: 'Synthetic UI data', illustrative: true },
      observations: (ratio ? [0.02, 0.03] : [100, 110, 95, 105]).map((value, index) => ({
        id: `observation-${index}`,
        seriesId: 'value',
        time: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
        value,
        dimensions: {},
        quality: 'valid',
      })),
      transformations: [],
      importedAt: '2025-01-01T00:00:00.000Z',
      revisionHistory: 'unavailable',
    },
  ];
  model.charts = [
    {
      id: 'chart',
      name: 'Customers over time',
      kind: 'line',
      seriesIds: ['value'],
      resolution: 'observation',
      normalized: false,
    },
  ];
  return model;
}

const numericalRun = async (request: AnalysisJobRequest) => executeAnalysis(request);
function archivedVersions(): AnalyticsExtension {
  let model = fixture();
  model.retention = { results: 12, dataVersions: 3 };
  for (let version = 1; version <= 3; version++) {
    model.datasets[0].version = version;
    model.results = model.results.map((run) => ({ ...run, stale: true }));
    const measurement: AnalyticsMeasurement = {
      id: `measurement-v${version}`,
      name: `Version ${version}`,
      kind: 'point-to-point',
      seriesIds: ['value'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-04T00:00:00.000Z',
    };
    model.measurements.push(measurement);
    const content = executeAnalysis({ kind: 'measurement', model, measurement });
    if (!('kind' in content) || content.kind !== 'measurement')
      throw new Error('Expected measurement');
    model = archiveResult(model, content, { measurement }, version);
    model.measurements.find((entry) => entry.id === measurement.id)!.resultId =
      model.results.at(-1)!.id;
  }
  validateAnalytics(model);
  return model;
}
function panel(
  model: AnalyticsExtension,
  save: PanelProps['save'] = vi.fn(async (_model: AnalyticsExtension) => {}),
): PanelProps {
  return {
    model,
    save,
    run: numericalRun,
    archive: async (content, parameters, source = model) =>
      archiveResult(source, content, parameters, 1),
    busy: false,
  };
}

beforeEach(() => {
  vi.spyOn(analyticsService, 'run').mockImplementation(async (request) => executeAnalysis(request));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Time Series & Signal Analysis normal-user workflow', () => {
  it('retains original count and currency units in normalized comparisons and displays fractional changes as percentages', async () => {
    const model = fixture();
    model.series.push({
      ...model.series[0],
      id: 'mrc',
      name: 'Recurring revenue',
      unit: { kind: 'currency', label: 'MRC', currency: 'SEK' },
    });
    model.datasets[0].observations.push(
      ...[2000, 2500, 2100, 2300].map((value, index) => ({
        ...model.datasets[0].observations[index],
        id: `mrc-${index}`,
        seriesId: 'mrc',
        value,
      })),
    );
    const save = vi.fn(async (_next: AnalyticsExtension) => {});
    function Form() {
      const [draft, setDraft] = useState<AnalyticsMeasurement>({
        id: 'comparison',
        name: 'Customers and MRC',
        kind: 'compare-series',
        seriesIds: ['value', 'mrc'],
        normalized: true,
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-04T00:00:00.000Z',
      });
      return <MeasurementsPanel {...panel(model, save)} draft={draft} onDraft={setDraft} />;
    }
    render(<Form />);
    fireEvent.click(screen.getByRole('button', { name: 'Save definition and result' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const result = screen.getByLabelText('Measurement results');
    expect(within(result).getByText('First mean').parentElement).toHaveTextContent(
      '102.5 customers',
    );
    expect(within(result).getByText('Second mean').parentElement).toHaveTextContent('2,225 SEK');
    expect(within(result).getByText('First change').parentElement).toHaveTextContent('5%');
    expect(within(result).getByText('Second change').parentElement).toHaveTextContent('15%');
    expect(result).not.toHaveTextContent('2,225 customers');
    expect(save.mock.calls[0][0].results[0].content).toMatchObject({
      kind: 'measurement',
      metrics: {
        firstMean: { value: 102.5 },
        secondMean: { value: 2225 },
        firstChange: { value: 0.05 },
        secondChange: { value: 0.15 },
      },
    });
  });

  it('labels a retained measurement using its immutable historical unit rather than a revised source unit', async () => {
    const model = fixture();
    model.series[0].unit = { kind: 'currency', label: 'MRC', currency: 'SEK' };
    const measurement: AnalyticsMeasurement = {
      id: 'saved-measurement',
      name: 'Historical MRC',
      kind: 'range-statistics',
      seriesIds: ['value'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-04T00:00:00.000Z',
    };
    model.measurements = [measurement];
    const content = executeAnalysis({ kind: 'measurement', model, measurement });
    if (!('kind' in content) || content.kind !== 'measurement')
      throw new Error('Expected measurement');
    const retained = archiveResult(model, content, { measurement }, 1);
    retained.measurements[0].resultId = retained.results[0].id;
    retained.series[0].unit = { kind: 'currency', label: 'MRC', currency: 'EUR' };
    retained.series[0].version = 2;
    retained.results[0].stale = true;
    function Form() {
      const [draft, setDraft] = useState(measurement);
      return <MeasurementsPanel {...panel(retained)} draft={draft} onDraft={setDraft} />;
    }
    render(<Form />);
    fireEvent.change(screen.getByLabelText('Saved measurement'), {
      target: { value: measurement.id },
    });
    const result = screen.getByLabelText('Measurement results');
    expect(within(result).getByText('Mean').parentElement).toHaveTextContent('102.5 SEK');
    expect(result).not.toHaveTextContent('102.5 EUR');
    expect(result).toHaveTextContent('retained historical result');
  });

  it('uses percentage formatting only for ratio-valued metrics while preserving count/time measures and undefined results', () => {
    const model = fixture(true);
    const definition: AnalyticsMeasurement = {
      id: 'display',
      name: 'Units',
      kind: 'point-to-point',
      seriesIds: ['value'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-02T00:00:00.000Z',
    };
    expect(measurementMetricLabel('percentagePoints', 1, definition, model.series)).toBe('1 pp');
    expect(measurementMetricLabel('relativeChange', 0.5, definition, model.series)).toBe('50%');
    expect(measurementMetricLabel('first.calendarCoverage', 0.75, definition, model.series)).toBe(
      '75%',
    );
    expect(measurementMetricLabel('firstMean', 0.02, definition, model.series)).toBe('2%');
    expect(measurementMetricLabel('matchedObservations', 12, definition, model.series)).toBe('12');
    expect(measurementMetricLabel('elapsedSeconds', 3600, definition, model.series)).toBe(
      '3,600 seconds',
    );
    expect(measurementMetricLabel('relativeChange', null, definition, model.series)).toBe(
      'Not applicable',
    );
  });

  it('retains the untouched portion of UTC timestamps with millisecond precision and rejects invalid dates or clocks', () => {
    const original = '2025-03-29T09:15:30.125Z';
    expect(inputUtcTime(original)).toBe('09:15:30.125');
    expect(replaceUtcDate(original, '2025-03-30')).toBe('2025-03-30T09:15:30.125Z');
    expect(replaceUtcTime(original, '10:05:00.625')).toBe('2025-03-29T10:05:00.625Z');
    expect(replaceUtcTime(original, '10:05')).toBe('2025-03-29T10:05:00.000Z');
    expect(replaceUtcDate(original, '2025-02-30')).toBeUndefined();
    expect(replaceUtcTime(original, '24:00:00.000')).toBeUndefined();
    expect(replaceUtcTime(original, '10:05:60.000')).toBeUndefined();
    expect(replaceUtcTime(original, '10:05:00.0001')).toBeUndefined();
  });

  it('makes intraday manual trend anchors and measurement intervals editable numerically without silently resetting their clock', async () => {
    const model = fixture();
    let current: AnalyticsMeasurement;
    const save = vi.fn(async (_next: AnalyticsExtension) => {});
    function Form() {
      const [draft, setDraft] = useState<AnalyticsMeasurement>({
        id: 'intraday-trend',
        name: 'One-hour change',
        kind: 'trend-line',
        seriesIds: ['value'],
        from: '2025-01-01T09:00:00.125Z',
        to: '2025-01-01T10:00:00.125Z',
        points: [
          { time: '2025-01-02T09:00:00.125Z', value: 10 },
          { time: '2025-01-02T10:00:00.125Z', value: 20 },
        ],
      });
      current = draft;
      return <MeasurementsPanel {...panel(model, save)} draft={draft} onDraft={setDraft} />;
    }
    render(<Form />);
    fireEvent.change(screen.getByLabelText('Anchor 1 date'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('Anchor 2 date'), { target: { value: '2025-01-01' } });
    expect(current!.points![0].time).toBe('2025-01-01T09:00:00.125Z');
    expect(current!.points![1].time).toBe('2025-01-01T10:00:00.125Z');
    fireEvent.change(screen.getByLabelText('Anchor 2 time (UTC)'), {
      target: { value: '10:00:00.625' },
    });
    fireEvent.change(screen.getByLabelText('Measurement to time (UTC)'), {
      target: { value: '10:00:00.625' },
    });
    fireEvent.change(screen.getByLabelText('Measurement from'), {
      target: { value: '2025-01-02' },
    });
    expect(current!.from).toBe('2025-01-02T09:00:00.125Z');
    fireEvent.change(screen.getByLabelText('Measurement from'), {
      target: { value: '2025-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition and result' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].measurements[0]).toMatchObject({
      from: '2025-01-01T09:00:00.125Z',
      to: '2025-01-01T10:00:00.625Z',
      points: [
        { time: '2025-01-01T09:00:00.125Z', value: 10 },
        { time: '2025-01-01T10:00:00.625Z', value: 20 },
      ],
    });
    expect(save.mock.calls[0][0].results[0].content).toMatchObject({
      metrics: { slopePerDay: { value: expect.closeTo((10 * 86400) / 3600.5, 10) } },
    });
    expect(screen.getByLabelText('Anchor 2 time (UTC)')).toHaveAttribute('step', '0.001');
  });

  it('preserves exact intraday chart ranges and distinguishes observation/publication times within one day', () => {
    const model = fixture();
    model.series[0].resolution = 'observation';
    const times = ['2025-01-01T08:00:00.125Z', '2025-01-01T09:00:00.875Z'];
    model.datasets[0].observations = times.map((time, index) => ({
      ...model.datasets[0].observations[index],
      time,
      knownAt: `2025-01-01T${index + 10}:00:00.625Z`,
    }));
    const series = {
      id: 'value',
      name: 'Customers',
      unit: model.series[0].unit,
      color: '#23664d',
      points: model.datasets[0].observations.map((point) => ({
        time: Date.parse(point.time),
        value: point.value,
      })),
    };
    const rendered = render(<ChartView chart={model.charts[0]} series={[series]} />);
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowLeft' });
    expect(document.querySelector('.analytics-chart-readout')).toHaveTextContent(times[0]);
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' });
    expect(document.querySelector('.analytics-chart-readout')).toHaveTextContent(times[1]);
    fireEvent.change(screen.getByLabelText('Visible from time (UTC)'), {
      target: { value: '08:15:30.125' },
    });
    expect(screen.getByLabelText('Visible from time (UTC)')).toHaveValue('08:15:30.125');
    expect(screen.getByLabelText('Visible to time (UTC)')).toHaveValue('09:00:00.875');
    rendered.rerender(<DatasetPanel {...panel(model)} onImport={vi.fn()} />);
    const table = screen.getByRole('table', { name: /Synthetic UI data/ });
    for (const point of model.datasets[0].observations) {
      expect(within(table).getByText(point.time)).toHaveAttribute('datetime', point.time);
      expect(within(table).getByText(point.knownAt!)).toHaveAttribute('datetime', point.knownAt);
    }
  });

  it('makes every imported dimension value available explicitly beyond the bounded option list without saving each keystroke', async () => {
    const model = fixture();
    model.datasets[0].observations = Array.from({ length: 1001 }, (_, index) => ({
      ...model.datasets[0].observations[0],
      id: `segment-${index}`,
      dimensions: { region: `region-${index}` },
      value: index,
    }));
    const onChange = vi.fn();
    function Form() {
      const [dimensions, setDimensions] = useState<Record<string, string>>({});
      return (
        <DimensionFilterFields
          model={model}
          seriesIds={['value']}
          value={dimensions}
          onChange={(next) => {
            onChange(next);
            setDimensions(next);
          }}
        />
      );
    }
    render(<Form />);
    expect(screen.getByText(/The first 1,000 distinct values are listed/)).toBeVisible();
    expect(screen.queryByRole('option', { name: 'region-1000' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Exact measurement segment region'), {
      target: { value: 'region-1000' },
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply exact segment: region' }));
    expect(onChange).toHaveBeenCalledWith({ region: 'region-1000' });
    expect(screen.getByLabelText('Measurement segment region')).toHaveValue('selected:region-1000');
    const measurement: AnalyticsMeasurement = {
      id: 'segment-measurement',
      name: 'Selected customer',
      kind: 'range-statistics',
      seriesIds: ['value'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-01T00:00:00.000Z',
      dimensions: onChange.mock.calls[0][0],
    };
    expect(executeAnalysis({ kind: 'measurement', model, measurement })).toMatchObject({
      metrics: { mean: { value: 1000 }, observations: { value: 1 } },
    });
  });

  it('preserves intraday Signal Lab cutoffs and uses the singular search-attempt label', async () => {
    const model = fixture();
    model.series[0].resolution = 'observation';
    model.datasets[0].observations = Array.from({ length: 12 }, (_, index) => ({
      ...model.datasets[0].observations[0],
      id: `intraday-${index}`,
      time: new Date(Date.UTC(2025, 0, 1, index, 0, 0, 125)).toISOString(),
      value: 10 + index,
    }));
    model.rules = [
      {
        id: 'threshold',
        name: 'Threshold',
        family: 'threshold',
        seriesId: 'value',
        enabled: true,
        version: 1,
        severity: 'warning',
        parameters: { comparator: '>', threshold: 15 },
      },
    ];
    render(<SignalLabPanel {...panel(model)} />);
    fireEvent.change(screen.getByLabelText('Train ends time (UTC)'), {
      target: { value: '04:00:00.625' },
    });
    expect(screen.getByLabelText('Train ends time (UTC)')).toHaveValue('04:00:00.625');
    expect(screen.getByLabelText('Validation ends time (UTC)')).toHaveValue('08:00:00.125');
    fireEvent.click(screen.getByRole('button', { name: 'Run historical validation' }));
    expect(await screen.findByText(/1 declared search attempt\./)).toBeVisible();
    expect(screen.queryByText(/1 declared search attempts\./)).not.toBeInTheDocument();
  });

  it('reopens matching historical indicator results with their original currency and exact intraday timestamps', async () => {
    const model = fixture();
    model.series[0].unit = { kind: 'currency', label: 'MRC', currency: 'SEK' };
    model.series[0].resolution = 'observation';
    model.datasets[0].observations = model.datasets[0].observations.map((point, index) => ({
      ...point,
      time: new Date(Date.UTC(2025, 0, 1, index, 0, 0, 125)).toISOString(),
    }));
    const indicator: AnalyticsIndicator = {
      id: 'historical-sma',
      name: 'Historical MRC average',
      seriesId: 'value',
      kind: 'sma',
      window: 2,
    };
    model.indicators = [indicator];
    const result = executeAnalysis({ kind: 'indicator', model, indicator });
    if (!('kind' in result) || result.kind !== 'indicator') throw new Error('Expected indicator');
    const retained = archiveResult(model, result, { indicator }, 1);
    retained.series[0].unit = { kind: 'currency', label: 'MRC', currency: 'EUR' };
    retained.series[0].version = 2;
    retained.results[0].stale = true;
    const onOverlay = vi.fn();
    retained.indicators[0] = Object.fromEntries(
      Object.entries(retained.indicators[0]).reverse(),
    ) as unknown as AnalyticsIndicator;
    const rendered = render(<IndicatorsPanel {...panel(retained)} onOverlay={onOverlay} />);
    fireEvent.click(screen.getByText(/Indicator tools · SMA/));
    fireEvent.change(screen.getByLabelText('Saved indicator'), { target: { value: indicator.id } });
    fireEvent.click(screen.getByText('Indicator values'));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('105 SEK');
    expect(table).not.toHaveTextContent('105 EUR');
    for (const point of model.datasets[0].observations)
      expect(within(table).getByText(point.time)).toHaveAttribute('datetime', point.time);
    expect(screen.getByText(/historical result retains its original inputs/)).toBeVisible();
    expect(onOverlay).not.toHaveBeenCalled();
    const changed = structuredClone(retained);
    changed.indicators[0].kind = 'ema';
    rendered.rerender(<IndicatorsPanel {...panel(changed)} onOverlay={onOverlay} />);
    fireEvent.change(screen.getByLabelText('Saved indicator'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Saved indicator'), { target: { value: indicator.id } });
    expect(screen.queryByText('Indicator values')).not.toBeInTheDocument();
  });

  it('keeps precise observed and first-possible-detection times visible when creating a reviewed scenario from a signal', async () => {
    const model = fixture();
    model.series[0].resolution = 'observation';
    model.datasets[0].observations = model.datasets[0].observations.map((point, index) => ({
      ...point,
      time: new Date(Date.UTC(2025, 0, 1, index, 0, 0, 125)).toISOString(),
      knownAt: new Date(Date.UTC(2025, 0, 1, index, 5, 0, 625)).toISOString(),
    }));
    model.rules = [
      {
        id: 'intraday-threshold',
        name: 'Intraday threshold',
        version: 1,
        enabled: true,
        family: 'threshold',
        seriesId: 'value',
        severity: 'warning',
        parameters: { comparator: '>', threshold: 105 },
      },
    ];
    const result = executeAnalysis({ kind: 'signals', model });
    if (!('kind' in result) || result.kind !== 'signals') throw new Error('Expected signals');
    const signal = result.signals.find((entry) => entry.state === 'onset')!;
    model.signals = result.signals;
    const onScenario = vi.fn();
    const rendered = render(
      <SignalHistory {...panel(model)} onFocus={vi.fn()} onScenario={onScenario} />,
    );
    const observed = screen.getByText(signal.observationTime);
    const detected = screen.getByText(signal.detectedAt);
    expect(observed).toHaveAttribute('datetime', signal.observationTime);
    expect(detected).toHaveAttribute('datetime', signal.detectedAt);
    expect(signal.observationTime).toBe('2025-01-01T01:00:00.125Z');
    expect(signal.detectedAt).toBe('2025-01-01T01:05:00.625Z');
    fireEvent.click(screen.getByRole('button', { name: 'Create scenario from signal' }));
    expect(onScenario).toHaveBeenCalledWith(signal);
    rendered.rerender(<ScenariosPanel {...panel(model)} sourceSignal={signal} />);
    expect(screen.getByText(signal.observationTime)).toHaveAttribute(
      'datetime',
      signal.observationTime,
    );
    expect(screen.getByText(signal.detectedAt)).toHaveAttribute('datetime', signal.detectedAt);
    expect(screen.getByRole('button', { name: 'Preview scenario' })).toBeDisabled();
  });

  it.each(['data versions', 'results'] as const)(
    'reviews removed snapshots before reducing retained %s and keeps surviving measurement links valid',
    async (setting) => {
      const model = archivedVersions();
      const original = structuredClone(model);
      const save = vi.fn(async (_next: AnalyticsExtension) => {});
      render(<ResultRetentionPanel {...panel(model, save)} />);
      fireEvent.change(
        screen.getByLabelText(
          setting === 'results' ? 'Maximum retained results' : 'Maximum retained data versions',
        ),
        {
          target: { value: '1' },
        },
      );
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Review retention changes' }));
      let dialog = screen.getByRole('dialog', { name: 'Review saved-run removal' });
      expect(dialog).toHaveTextContent('2 saved runs will be removed');
      expect(dialog).toHaveTextContent('data: v1');
      expect(dialog).toHaveTextContent('data: v2');
      expect(dialog).toHaveTextContent('Historical inputs may no longer be reproducible');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(save).not.toHaveBeenCalled();
      expect(model).toEqual(original);
      fireEvent.click(screen.getByRole('button', { name: 'Review retention changes' }));
      dialog = screen.getByRole('dialog', { name: 'Review saved-run removal' });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Remove saved runs and confirm' }),
      );
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      const next = save.mock.calls[0][0];
      expect(next.results.map((run) => run.id)).toEqual([model.results[2].id]);
      expect(next.results[0].inputSnapshot).toBe(model.results[2].inputSnapshot);
      expect(
        next.measurements.find((entry) => entry.id === 'measurement-v1')!.resultId,
      ).toBeUndefined();
      expect(
        next.measurements.find((entry) => entry.id === 'measurement-v2')!.resultId,
      ).toBeUndefined();
      expect(next.measurements.find((entry) => entry.id === 'measurement-v3')!.resultId).toBe(
        model.results[2].id,
      );
      expect(() => validateAnalytics(next)).not.toThrow();
      expect(model).toEqual(original);
    },
  );

  it('requires explicit saved-run deletion confirmation and rejects a removal preview after concurrent model changes', async () => {
    const model = archivedVersions();
    const save = vi.fn(async (_next: AnalyticsExtension) => {});
    const rendered = render(<ResultRetentionPanel {...panel(model, save)} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete saved run and inputs' })[0]);
    let dialog = screen.getByRole('dialog', { name: 'Review saved-run removal' });
    expect(dialog).toHaveTextContent('1 saved run will be removed');
    expect(dialog).toHaveTextContent(model.results[0].id);
    expect(save).not.toHaveBeenCalled();
    const changed = structuredClone(model);
    changed.datasets[0].name = 'Updated by another client';
    rendered.rerender(<ResultRetentionPanel {...panel(changed, save)} />);
    expect(dialog).toHaveTextContent('The analysis changed after this review');
    expect(
      within(dialog).getByRole('button', { name: 'Remove saved runs and confirm' }),
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete saved run and inputs' })[0]);
    dialog = screen.getByRole('dialog', { name: 'Review saved-run removal' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove saved runs and confirm' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].results.map((run) => run.id)).toEqual(
      changed.results.slice(1).map((run) => run.id),
    );
    expect(save.mock.calls[0][0].measurements[0].resultId).toBeUndefined();
    expect(() => validateAnalytics(save.mock.calls[0][0])).not.toThrow();
  });

  it('clearly bounds large indicator/residual tables while numerical JSON exports retain the complete population', async () => {
    const model = fixture();
    model.series[0].resolution = 'observation';
    model.datasets[0].observations = Array.from({ length: 1002 }, (_, index) => ({
      ...model.datasets[0].observations[0],
      id: `dense-${index}`,
      time: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
      value: 10 + index * 2,
    }));
    const exported = vi.spyOn(analyticsDisplay, 'downloadText').mockImplementation(() => {});
    const rendered = render(<IndicatorsPanel {...panel(model)} onOverlay={vi.fn()} />);
    fireEvent.click(screen.getByText(/Indicator tools · SMA/));
    fireEvent.click(screen.getByRole('button', { name: 'Calculate indicator' }));
    await screen.findByText('Indicator values');
    fireEvent.click(screen.getByText('Indicator values'));
    const indicatorTable = screen.getByRole('table');
    expect(indicatorTable).toHaveAccessibleName(
      /Showing first 1,000 of 1,002 observation positions/,
    );
    expect(indicatorTable.querySelectorAll('tbody tr')).toHaveLength(1000);
    expect(
      within(indicatorTable).queryByText(model.datasets[0].observations.at(-1)!.time),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export indicator JSON' }));
    expect(JSON.parse(exported.mock.calls[0][0]).result.points).toHaveLength(1002);
    function Measurement() {
      const [draft, setDraft] = useState<AnalyticsMeasurement>({
        id: 'dense-regression',
        name: 'Full regression',
        kind: 'regression',
        seriesIds: ['value'],
        from: model.datasets[0].observations[0].time,
        to: model.datasets[0].observations.at(-1)!.time,
      });
      return <MeasurementsPanel {...panel(model)} draft={draft} onDraft={setDraft} />;
    }
    rendered.rerender(<Measurement />);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate measurement' }));
    await screen.findByText('Regression residuals (1002)');
    fireEvent.click(screen.getByText('Regression residuals (1002)'));
    const residualTable = screen.getByRole('table');
    expect(residualTable).toHaveAccessibleName(/Showing first 1,000 of 1,002 residuals/);
    expect(residualTable.querySelectorAll('tbody tr')).toHaveLength(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Export measurement JSON' }));
    expect(JSON.parse(exported.mock.calls[1][0]).result.residuals).toHaveLength(1002);
    expect(JSON.parse(exported.mock.calls[1][0]).result.values).toHaveLength(1002);
  });

  it('labels a nearest observation by its actual timestamp and never extrapolates a shorter series at the crosshair', () => {
    const model = fixture();
    render(
      <ChartView
        chart={model.charts[0]}
        series={[
          {
            id: 'value',
            name: 'Primary',
            unit: model.series[0].unit,
            color: '#23664d',
            points: [1, 3, 5].map((day) => ({ time: Date.UTC(2025, 0, day), value: day * 100 })),
          },
          {
            id: 'other',
            name: 'Shorter history',
            unit: model.series[0].unit,
            color: '#426b9e',
            points: [2, 4].map((day) => ({ time: Date.UTC(2025, 0, day), value: day * 10 })),
          },
        ]}
      />,
    );
    const chart = screen.getByRole('img');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    const readout = document.querySelector('.analytics-chart-readout')!;
    expect(readout.textContent).toContain(
      'Shorter history: Not available · outside observed range',
    );
    expect(readout.textContent).not.toContain('20 customers');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(readout.textContent).toContain('Shorter history: 20 customers');
    expect(readout.textContent).toContain('nearest observed 2025-01-02T00:00:00.000Z');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(readout.textContent).toContain(
      'Shorter history: Not available · outside observed range',
    );
    expect(readout.textContent).not.toContain('40 customers');
  });
  it('keeps compact value ticks and endpoint dates inside the live and exported chart while inspection retains precision', () => {
    const model = fixture();
    const series = {
      id: 'value',
      name: 'Customers',
      unit: model.series[0].unit,
      color: '#23664d',
      points: [1555.7645, 1903.1234].map((value, index) => ({
        time: Date.UTC(2025, index, 1),
        value,
      })),
    };
    const { container } = render(<ChartView chart={model.charts[0]} series={[series]} />);
    expect(
      [...container.querySelectorAll('svg text')].filter(
        (text) => text.textContent === 'customers',
      ),
    ).toHaveLength(1);
    const dates = [...container.querySelectorAll('text[data-axis="time"]')];
    expect(dates[0].getAttribute('text-anchor')).toBe('start');
    expect(dates.at(-1)!.getAttribute('text-anchor')).toBe('end');
    for (const tick of container.querySelectorAll('text[data-axis="value"]')) {
      expect(Number(tick.getAttribute('x')) - tick.textContent!.length * 7).toBeGreaterThanOrEqual(
        8,
      );
    }
    expect(analyticsAxisTickLabel(1555.7645, series.unit)).toBe('1,556');
    expect(analyticsAxisTickLabel(-0.00000015557645, series.unit)).not.toBe('0');
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' });
    expect(screen.getByText('1,903.1234 customers')).toBeVisible();
    const exported = serializePreparedChartSvg(model.charts[0], [series], { width: 390 });
    const svg = new DOMParser().parseFromString(exported.data, 'image/svg+xml');
    const exportedDates = [...svg.querySelectorAll('text[data-axis="time"]')];
    expect(exportedDates[0].getAttribute('text-anchor')).toBe('start');
    expect(exportedDates.at(-1)!.getAttribute('text-anchor')).toBe('end');
    for (const tick of svg.querySelectorAll('text[data-axis="value"]')) {
      expect(Number(tick.getAttribute('x')) - tick.textContent!.length * 7).toBeGreaterThanOrEqual(
        8,
      );
    }
    expect(series.points[0].value).toBe(1555.7645);
  });
  it('keeps the actual source chart, zoom and pan usable during analysis while blocking model writes', async () => {
    const model = fixture();
    const save = vi.fn(async (_next: AnalyticsExtension) => {});
    const props = {
      ...panel(model, save),
      busy: true,
      onSelection: vi.fn(),
      onThreshold: vi.fn(),
      onSignalFocus: vi.fn(),
    };
    const rendered = render(<ExplorePanel {...props} />);
    await screen.findByRole('heading', { name: 'Customers (customers)', level: 3 });
    expect(screen.getByLabelText('Visible to')).toHaveValue('2025-01-04');
    expect(
      document.querySelector('[data-series-id="value"] path')?.getAttribute('d')?.match(/[ML]/g),
    ).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save chart settings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete chart' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Visible to')).toHaveValue('2025-01-03');
    expect(
      document.querySelector('[data-series-id="value"] path')?.getAttribute('d')?.match(/[ML]/g),
    ).toHaveLength(2);
    const zoomedPath = document.querySelector('[data-series-id="value"] path')?.getAttribute('d');
    fireEvent.click(screen.getByRole('button', { name: 'Earlier time' }));
    expect(document.querySelector('[data-series-id="value"] path')?.getAttribute('d')).not.toBe(
      zoomedPath,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Later time' }));
    expect(document.querySelector('[data-series-id="value"] path')?.getAttribute('d')).toBe(
      zoomedPath,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save chart settings' }));
    expect(save).not.toHaveBeenCalled();
    rendered.rerender(<ExplorePanel {...props} busy={false} />);
    expect(screen.getByRole('button', { name: 'Save chart settings' })).toBeEnabled();
  });

  it('keeps small nonzero slopes visible without changing ordinary count or percentage formatting', () => {
    expect(valueLabel(0.00000123456, 'ratio units / day')).toBe('1.235E-6 ratio units / day');
    expect(valueLabel(-0.00000123456, 'ratio units / day')).toBe('-1.235E-6 ratio units / day');
    expect(valueLabel(0.00000001, 'ratio')).toBe('1E-6%');
    expect(valueLabel(0, 'customers')).toBe('0 customers');
    expect(valueLabel(1200, 'customers')).toBe('1,200 customers');
    expect(valueLabel(0.025, 'ratio')).toBe('2.5%');
  });

  it('focuses a selected measurement source and interval across tab changes and plots its real regression fit', async () => {
    const model = fixture();
    model.series.push({
      ...structuredClone(model.series[0]),
      id: 'churn',
      name: 'Customer churn',
      unit: { kind: 'ratio', label: 'customer churn' },
      semantics: 'rate',
      aggregation: 'none',
      direction: 'lower-is-better',
    });
    model.datasets[0].observations.push(
      ...model.datasets[0].observations.map((point, index) => ({
        ...point,
        id: `churn-${index}`,
        seriesId: 'churn',
        value: (index + 1) * 0.01,
      })),
    );
    model.charts.push({
      ...structuredClone(model.charts[0]),
      id: 'churn-chart',
      name: 'Customer churn',
      seriesIds: ['churn'],
    });
    model.measurements.push({
      id: 'retention',
      name: 'Retention shift',
      kind: 'point-to-point',
      seriesIds: ['churn'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-04T00:00:00.000Z',
    });
    render(
      <AnalyticsWorkspace diagramId="focus" analytics={model} version={1} onChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Saved chart'), { target: { value: 'churn-chart' } });
    await screen.findByRole('heading', { name: 'Customer churn (customer churn)', level: 3 });
    fireEvent.click(screen.getByRole('tab', { name: /3 · Measure/ }));
    fireEvent.change(screen.getByLabelText('Saved measurement'), {
      target: { value: 'retention' },
    });
    await waitFor(() => expect(screen.getByLabelText('Saved chart')).toHaveValue('churn-chart'));
    await screen.findByRole('heading', { name: 'Customer churn (customer churn)', level: 3 });
    fireEvent.change(screen.getByLabelText('Measurement tool'), {
      target: { value: 'regression' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate measurement' }));
    await screen.findByText('Regression fit · descriptive selected interval');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const path = document.querySelector('[data-series-id="churn"] path');
    await waitFor(() => expect(path?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(2));
    fireEvent.click(screen.getByRole('tab', { name: /2 · Explore/ }));
    fireEvent.click(screen.getByRole('tab', { name: /3 · Measure/ }));
    await waitFor(() => expect(screen.getByLabelText('Saved chart')).toHaveValue('churn-chart'));
    await screen.findByRole('heading', { name: 'Customer churn (customer churn)', level: 3 });
    expect(screen.getByLabelText('Measurement series')).toHaveValue('churn');
    expect(screen.getByLabelText('Measurement from')).toHaveValue('2025-01-01');
    expect(screen.getByLabelText('Measurement to')).toHaveValue('2025-01-04');
  });

  it('clears divergence-only and custom-only fields when switching signal families', async () => {
    const model = fixture();
    model.series.push({ ...structuredClone(model.series[0]), id: 'second', name: 'Second KPI' });
    const save = vi.fn(async (next: AnalyticsExtension) => {
      reconcileAnalytics(model, next);
    });
    render(<SignalsPanel {...panel(model, save)} onFocus={vi.fn()} onScenario={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Signal family'), {
      target: { value: 'kpi-divergence' },
    });
    fireEvent.change(screen.getByLabelText('Second KPI'), { target: { value: 'second' } });
    fireEvent.change(screen.getByLabelText('Signal family'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Signal family'), { target: { value: 'threshold' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save signal rule' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].rules[0]).toMatchObject({ family: 'threshold' });
    expect(save.mock.calls[0][0].rules[0].secondSeriesId).toBeUndefined();
    expect(save.mock.calls[0][0].rules[0].expression).toBeUndefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refreshes a clean nested waterfall configuration and preserves dirty edits without overwriting an external update', async () => {
    const model = fixture();
    model.series.push(
      { ...structuredClone(model.series[0]), id: 'opening', name: 'Opening balance' },
      { ...structuredClone(model.series[0]), id: 'closing', name: 'Closing balance' },
    );
    const chart = {
      ...model.charts[0],
      kind: 'waterfall' as const,
      waterfall: { openingSeriesId: 'opening', closingSeriesId: 'value', components: [] },
    };
    const change = vi.fn();
    const rendered = render(<WaterfallView model={model} chart={chart} onChartChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure balance components' }));
    expect(screen.getByLabelText('Closing balance series')).toHaveValue('value');
    const refreshed = {
      ...chart,
      waterfall: { ...chart.waterfall, closingSeriesId: 'closing' },
    };
    rendered.rerender(<WaterfallView model={model} chart={refreshed} onChartChange={change} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Closing balance series')).toHaveValue('closing'),
    );
    fireEvent.change(screen.getByLabelText('Opening balance series'), {
      target: { value: 'value' },
    });
    const newer = {
      ...refreshed,
      waterfall: { ...refreshed.waterfall, closingSeriesId: 'opening' },
    };
    rendered.rerender(<WaterfallView model={model} chart={newer} onChartChange={change} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'saved balance configuration changed elsewhere',
    );
    expect(screen.getByLabelText('Opening balance series')).toHaveValue('value');
    expect(screen.getByRole('button', { name: 'Apply balance configuration' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply balance configuration' }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved balance configuration' }));
    expect(screen.getByLabelText('Opening balance series')).toHaveValue('opening');
    expect(screen.getByLabelText('Closing balance series')).toHaveValue('opening');
    fireEvent.click(screen.getByRole('button', { name: 'Apply balance configuration' }));
    expect(change).toHaveBeenCalledWith(newer);
    expect(change.mock.calls[0][0].waterfall).not.toHaveProperty('id');
  });

  it('creates a new derived series at version 1 even when its source definition has advanced', async () => {
    const model = fixture();
    model.series[0].version = 3;
    const save = vi.fn(async (next: AnalyticsExtension) => {
      reconcileAnalytics(model, next);
    });
    render(<DerivedSeriesEditor {...panel(model, save)} />);
    fireEvent.click(screen.getByText('Create a derived series with a validated expression'));
    fireEvent.click(screen.getByRole('button', { name: 'Create derived series' }));
    await screen.findByText('Derived series saved. Select it in Explore.');
    const created = save.mock.calls[0][0].series.at(-1)!;
    expect(created).toMatchObject({
      version: 1,
      provenance: 'derived',
      derived: { operation: 'difference', seriesIds: ['value'] },
    });
    expect(created.id).not.toBe('value');
    expect(save.mock.calls[0][0].series[0].version).toBe(3);
  });

  it('offers two real entry points on an empty analytics extension and no analysis work before choosing one', () => {
    render(
      <AnalyticsWorkspace
        diagramId="diagram"
        analytics={blankAnalytics()}
        version={1}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Use example data/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Import your data/ })).toBeEnabled();
    expect(screen.getByRole('tab', { name: /Explore/ })).toBeDisabled();
    expect(analyticsService.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Import your data/ }));
    expect(screen.getByRole('dialog', { name: 'Import time-series data' })).toBeVisible();
  });

  it('plots the actual full-interval regression fit as a separate line above a bar chart and invalidates it when the definition changes', async () => {
    const model = fixture();
    model.charts[0].kind = 'bar';
    model.datasets[0].observations.forEach((point, index) => {
      point.value = 10 * (index + 1);
    });
    render(
      <AnalyticsWorkspace
        diagramId="regression"
        analytics={model}
        version={1}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /3 · Measure/ }));
    fireEvent.change(screen.getByLabelText('Measurement tool'), {
      target: { value: 'regression' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate measurement' }));
    await screen.findByText('Regression fit · descriptive selected interval');
    expect(screen.getByLabelText('Measurement results')).toHaveTextContent('10 customers / day');
    expect(screen.getByText('R²')).toBeVisible();
    expect(screen.getByText('Slope per day')).toBeVisible();
    const fitPath = document.querySelector(
      '.analytics-chart [data-series-id^="regression-fit-"] path',
    );
    expect(fitPath?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(4);
    expect(fitPath?.getAttribute('stroke-dasharray')).toBe('5 3');
    expect(document.querySelectorAll('.analytics-chart rect').length).toBeGreaterThanOrEqual(4);
    fireEvent.change(screen.getByLabelText('Measurement to'), {
      target: { value: '2025-01-03' },
    });
    await waitFor(() =>
      expect(
        screen.queryByText('Regression fit · descriptive selected interval'),
      ).not.toBeInTheDocument(),
    );
  });

  it('maps a CSV, previews validated data and saves only after explicit confirmation', async () => {
    const apply = vi.fn(async (_preview: import('../src/analytics/types').ImportPreview) => {});
    render(<AnalyticsImportDialog model={blankAnalytics()} apply={apply} close={vi.fn()} />);
    const file = new File(['date,value\n2025-01-01,100\n2025-01-02,120'], 'observations.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(file, 'text', {
      value: async () => 'date,value\n2025-01-01,100\n2025-01-02,120',
    });
    fireEvent.change(screen.getByLabelText('Time-series file'), { target: { files: [file] } });
    await screen.findByText(/Source preview/);
    fireEvent.change(screen.getByLabelText('Observation date / time'), {
      target: { value: 'date' },
    });
    fireEvent.change(screen.getByLabelText('Native time resolution'), { target: { value: 'day' } });
    fireEvent.click(screen.getByLabelText('Import column value'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate import preview' }));
    await screen.findByRole('region', { name: 'Import validation report' });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and commit import' }));
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(apply.mock.calls[0][0]).toMatchObject({
      valid: true,
      dataset: { observations: [{ value: 100 }, { value: 120 }] },
    });
  });

  it('locks import conventions and destination during validation and rejects a preview after the source document changes', async () => {
    const model = fixture();
    const apply = vi.fn(async () => {});
    const rendered = render(<AnalyticsImportDialog model={model} apply={apply} close={vi.fn()} />);
    const file = new File(['date,value\n2025-01-01,100\n2025-01-02,120'], 'observations.csv');
    Object.defineProperty(file, 'text', {
      value: async () => 'date,value\n2025-01-01,100\n2025-01-02,120',
    });
    fireEvent.change(screen.getByLabelText('Time-series file'), { target: { files: [file] } });
    await screen.findByText(/Source preview/);
    fireEvent.change(screen.getByLabelText('Observation date / time'), {
      target: { value: 'date' },
    });
    fireEvent.change(screen.getByLabelText('Native time resolution'), { target: { value: 'day' } });
    fireEvent.click(screen.getByLabelText('Import column value'));
    let finish: (value: AnalysisJobValue) => void = () => {};
    let input: AnalysisJobRequest | undefined;
    let signal: AbortSignal | undefined;
    vi.mocked(analyticsService.run).mockImplementationOnce((request, options) => {
      input = request;
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate import preview' }));
    expect(screen.getByLabelText('Decimal convention')).toBeDisabled();
    expect(screen.getByLabelText('Import action')).toBeDisabled();
    expect(screen.getByLabelText('Import column value')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel processing' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Decimal convention'), { target: { value: ',' } });
    expect(screen.getByLabelText('Decimal convention')).toHaveValue('.');
    const current = structuredClone(model);
    current.datasets[0].version++;
    rendered.rerender(<AnalyticsImportDialog model={current} apply={apply} close={vi.fn()} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(executeAnalysis(input!)));
    expect(
      screen.queryByRole('region', { name: 'Import validation report' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm and commit import' }),
    ).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Validate import preview' })).toBeEnabled();
  });

  it('uses the shared measurement engine and archives the reproducible definition and source snapshot', async () => {
    const model = fixture(true);
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    function Form() {
      const [draft, setDraft] = useState<AnalyticsMeasurement>({
        id: 'measurement',
        name: 'Retention movement',
        kind: 'point-to-point',
        seriesIds: ['value'],
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
      });
      return <MeasurementsPanel {...panel(model, save)} draft={draft} onDraft={setDraft} />;
    }
    render(<Form />);
    fireEvent.click(screen.getByRole('button', { name: 'Save definition and result' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.getByText('Percentage points')).toBeVisible();
    expect(screen.getByText('Absolute change')).toBeVisible();
    expect(screen.getByText('Relative change')).toBeVisible();
    const saved = save.mock.calls[0][0] as AnalyticsExtension;
    expect(saved.measurements[0].resultId).toBe(saved.results[0].id);
    expect(saved.results[0].inputSnapshot.datasets[0].observations[0].value).toBe(0.02);
    expect(saved.results[0].content).toMatchObject({
      kind: 'measurement',
      metrics: {
        percentagePoints: { value: expect.closeTo(1, 12) },
        relativeChange: { value: expect.closeTo(0.5, 12) },
      },
    });
  });

  it('requires review before a scenario runs and preserves history when previewing a customer balance', async () => {
    const model = fixture();
    const original = structuredClone(model);
    render(<ScenariosPanel {...panel(model)} />);
    expect(screen.getByRole('button', { name: 'Preview scenario' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Opening customers'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('New customers / month'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Reactivated customers / month'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Customer churn (fraction of opening base)'), {
      target: { value: '0.02' },
    });
    fireEvent.change(screen.getByLabelText('Scenario months'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Reviewed scenario assumptions'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview scenario' }));
    await screen.findByText('Scenario preview · expected counts');
    expect(screen.getByRole('table')).toHaveTextContent('1,010');
    expect(model).toEqual(original);
  });

  it('retains handled signal evidence and linked scenario sources when refreshed data no longer triggers the rule', async () => {
    let model = fixture(true);
    model.rules = [
      {
        id: 'churn-threshold',
        version: 1,
        name: 'Retention pressure',
        enabled: true,
        family: 'threshold',
        seriesId: 'value',
        severity: 'warning',
        parameters: { comparator: '>', threshold: 0.025 },
      },
    ];
    const detected = executeAnalysis({ kind: 'signals', model });
    if (!('kind' in detected) || detected.kind !== 'signals') throw new Error('Expected signals');
    const onset = detected.signals.find((signal) => signal.state === 'onset')!;
    model.signals = [{ ...onset, acknowledged: true }];
    model.scenarios = [
      {
        id: 'signal-scenario',
        name: 'Reviewed retention assumption',
        version: 1,
        model: 'growth-churn',
        start: '2025-02-01T00:00:00.000Z',
        periods: 1,
        resolution: 'month',
        reviewed: true,
        sourceSignalId: onset.id,
        assumptions: {
          openingCustomers: 1000,
          newCustomers: 30,
          reactivatedCustomers: 0,
          churnRate: 0.02,
          newCustomerGrowth: 0,
          openingMrc: 0,
          newMrc: 0,
          expansionMrc: 0,
          contractionMrc: 0,
          churnedMrc: 0,
          currency: 'SEK',
        },
      },
    ];
    model = archiveResult(model, detected, { ruleIds: ['churn-threshold'] }, 1);
    model.datasets[0].version = 2;
    model.datasets[0].observations.forEach((observation) => {
      observation.value = 0.01;
    });
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    const props = { ...panel(model, save), onFocus: vi.fn(), onScenario: vi.fn() };
    const rendered = render(<SignalsPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate saved rules' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0];
    expect(saved.signals.find((signal) => signal.id === onset.id)).toMatchObject({
      acknowledged: true,
      dataVersion: 1,
    });
    expect(saved.scenarios[0].sourceSignalId).toBe(onset.id);
    const archived = saved.results.at(-1)!.content;
    expect(archived.kind === 'signals' && archived.totalEvents).toBe(0);
    rendered.rerender(<SignalsPanel {...props} {...panel(saved, save)} />);
    fireEvent.change(screen.getByLabelText('History versions'), {
      target: { value: 'historical' },
    });
    expect(screen.getByText(/Historical evidence · data version 1, rule version 1/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create scenario from signal' }));
    expect(props.onScenario).toHaveBeenCalledWith(expect.objectContaining({ id: onset.id }));
    fireEvent.change(screen.getByLabelText('Saved rule'), {
      target: { value: 'churn-threshold' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].rules).toHaveLength(0);
    expect(save.mock.calls[1][0].signals.some((signal) => signal.id === onset.id)).toBe(true);
    expect(save.mock.calls[1][0].scenarios[0].sourceSignalId).toBe(onset.id);
  });

  it('marks earlier semantic series versions as historical and formats captured fractional thresholds correctly', () => {
    const model = fixture(true);
    model.rules = [
      {
        id: 'threshold',
        name: 'Churn boundary',
        version: 1,
        enabled: true,
        family: 'threshold',
        seriesId: 'value',
        severity: 'warning',
        parameters: { comparator: '>', threshold: 0.025 },
      },
    ];
    const result = executeAnalysis({ kind: 'signals', model });
    if (!('kind' in result) || result.kind !== 'signals') throw new Error('Expected signals');
    model.signals = result.signals;
    model.series[0].version = 2;
    model.series[0].unit = { kind: 'ratio', label: 'customer churn' };
    render(<SignalHistory {...panel(model)} onFocus={vi.fn()} onScenario={vi.fn()} />);
    expect(screen.queryByText(/Historical evidence/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('History versions'), {
      target: { value: 'historical' },
    });
    expect(screen.getByText(/series version 1/)).toBeVisible();
    expect(document.querySelector('.analytics-signal-item')).toHaveTextContent('threshold 2.5%');
    expect(document.querySelector('.analytics-signal-item')).not.toHaveTextContent(
      'threshold 0.025%',
    );
  });

  it('preserves a scenario version when re-saving an unchanged definition and adds reviewed local process links without changing the target', async () => {
    const model = fixture();
    model.scenarios = [
      {
        id: 'baseline',
        name: 'Baseline',
        version: 3,
        model: 'growth-churn',
        start: '2025-02-01T00:00:00.000Z',
        periods: 1,
        resolution: 'month',
        reviewed: true,
        assumptions: {
          openingCustomers: 1000,
          newCustomers: 30,
          reactivatedCustomers: 0,
          churnRate: 0.02,
          newCustomerGrowth: 0,
          openingMrc: 100000,
          newMrc: 5000,
          expansionMrc: 1000,
          contractionMrc: 2000,
          churnedMrc: 3000,
          currency: 'SEK',
        },
      },
    ];
    const target = {
      id: 'kiosk',
      name: 'Kiosk',
      nodes: [{ id: 'customers', name: 'Customer arrivals', type: 'source' }],
      scenarios: [{ id: 'base', name: 'Base model' }],
    };
    const unchangedTarget = structuredClone(target);
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    render(
      <ScenariosPanel
        {...panel(model, save)}
        processTargets={[{ id: target.id, name: target.name }]}
        loadProcessTarget={async () => target}
      />,
    );
    fireEvent.change(screen.getByLabelText('Saved scenario'), { target: { value: 'baseline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save scenario and result' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].scenarios[0].version).toBe(3);
    fireEvent.click(screen.getByText('Link to a Process Simulator scenario'));
    fireEvent.change(screen.getByLabelText('Linked process diagram'), {
      target: { value: 'kiosk' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Process link node')).toHaveTextContent('Customer arrivals'),
    );
    fireEvent.change(screen.getByLabelText('Process link source series'), {
      target: { value: 'value' },
    });
    fireEvent.change(screen.getByLabelText('Process link node'), {
      target: { value: 'customers' },
    });
    fireEvent.change(screen.getByLabelText('Process link target scenario'), {
      target: { value: 'base' },
    });
    fireEvent.change(screen.getByLabelText('Process link parameter'), {
      target: { value: 'source.maxCount' },
    });
    fireEvent.click(screen.getByLabelText('Reviewed process link'));
    fireEvent.click(screen.getByLabelText('Reviewed scenario assumptions'));
    fireEvent.click(screen.getByRole('button', { name: 'Save scenario and result' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].scenarios[0]).toMatchObject({
      version: 4,
      processLink: {
        sourceSeriesId: 'value',
        diagramId: 'kiosk',
        nodeId: 'customers',
        scenarioId: 'base',
        parameter: 'source.maxCount',
        resolution: 'day',
        unit: 'customers',
        reviewed: true,
      },
    });
    expect(target).toEqual(unchangedTarget);
  });

  it('requires a saved segment filter for numeric measurements and preserves the chosen scope', async () => {
    const model = fixture();
    model.datasets[0].observations.push(
      ...model.datasets[0].observations.map((row) => ({
        ...row,
        id: row.id + '-second',
        value: row.value! + 1000,
        dimensions: { region: 'South' },
      })),
    );
    model.datasets[0].observations.slice(0, 4).forEach((row) => {
      row.dimensions = { region: 'North' };
    });
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    function Form() {
      const [draft, setDraft] = useState<AnalyticsMeasurement>({
        id: 'measurement',
        name: 'North change',
        kind: 'point-to-point',
        seriesIds: ['value'],
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-04T00:00:00.000Z',
      });
      return <MeasurementsPanel {...panel(model, save)} draft={draft} onDraft={setDraft} />;
    }
    render(<Form />);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate measurement' }));
    await screen.findAllByRole('alert');
    fireEvent.change(screen.getByLabelText('Measurement segment region'), {
      target: { value: 'selected:North' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition and result' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].measurements[0].dimensions).toEqual({ region: 'North' });
    expect(save.mock.calls[0][0].results[0].content).toMatchObject({
      kind: 'measurement',
      metrics: { absoluteChange: { value: 5 } },
    });
  });

  it('never labels an older completed preview as the result of edited parameters', async () => {
    const model = fixture();
    let finish: (value: string) => void = () => {};
    function Form() {
      const [definition, setDefinition] = useState({ window: 3 });
      const preview = usePreview<string, typeof definition>(definition, model);
      return (
        <>
          <button
            onClick={() => {
              const captured = definition;
              void new Promise<string>((resolve) => {
                finish = resolve;
              }).then((value) => preview.setValue(value, captured));
            }}
          >
            Start preview
          </button>
          <button onClick={() => setDefinition({ window: 5 })}>Change window</button>
          <output>{preview.value ?? 'No matching result'}</output>
        </>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change window' }));
    await act(async () => finish('old preview'));
    expect(screen.getByText('No matching result')).toBeVisible();
    expect(screen.queryByText('old preview')).toBeNull();
  });

  it('reloads clean saved definitions after external edits and fences dirty definitions until explicit reload', async () => {
    const model = fixture();
    model.scenarios = [
      {
        id: 'baseline',
        name: 'Baseline',
        version: 1,
        model: 'growth-churn',
        start: '2025-02-01T00:00:00.000Z',
        periods: 1,
        resolution: 'month',
        reviewed: true,
        assumptions: {
          openingCustomers: 1000,
          newCustomers: 30,
          reactivatedCustomers: 0,
          churnRate: 0.02,
          newCustomerGrowth: 0,
          openingMrc: 100000,
          newMrc: 5000,
          expansionMrc: 1000,
          contractionMrc: 2000,
          churnedMrc: 3000,
          currency: 'SEK',
        },
      },
    ];
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    const view = render(<ScenariosPanel {...panel(model, save)} />);
    fireEvent.change(screen.getByLabelText('Saved scenario'), { target: { value: 'baseline' } });
    const clean = structuredClone(model);
    clean.scenarios[0].version = 2;
    clean.scenarios[0].assumptions.churnRate = 0.03;
    view.rerender(<ScenariosPanel {...panel(clean, save)} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Customer churn (fraction of opening base)')).toHaveValue(0.03),
    );
    fireEvent.change(screen.getByLabelText('Scenario name'), {
      target: { value: 'Unsaved local name' },
    });
    const remote = structuredClone(clean);
    remote.scenarios[0].version = 3;
    remote.scenarios[0].name = 'Remote name';
    remote.scenarios[0].assumptions.churnRate = 0.04;
    view.rerender(<ScenariosPanel {...panel(remote, save)} />);
    await screen.findByText(/Your unsaved edits are preserved/);
    expect(screen.getByLabelText('Scenario name')).toHaveValue('Unsaved local name');
    expect(screen.getByRole('button', { name: 'Save scenario and result' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved scenario' }));
    expect(screen.getByLabelText('Scenario name')).toHaveValue('Remote name');
    expect(screen.getByLabelText('Customer churn (fraction of opening base)')).toHaveValue(0.04);
    expect(screen.getByRole('button', { name: 'Save scenario and result' })).toBeEnabled();
  });

  it('does not render unconverted OHLC as normalized candlesticks', () => {
    const { container } = render(
      <ChartView
        chart={{
          id: 'chart',
          name: 'Normalized OHLC',
          kind: 'candlestick',
          seriesIds: ['value'],
          resolution: 'month',
          normalized: true,
        }}
        series={[
          {
            id: 'value',
            name: 'Customers index',
            unit: { kind: 'number', label: 'index' },
            color: '#23664d',
            points: [
              {
                time: Date.UTC(2025, 0, 1),
                value: 100,
                open: 1000,
                high: 1200,
                low: 800,
                close: 1100,
              },
              {
                time: Date.UTC(2025, 1, 1),
                value: 110,
                open: 1100,
                high: 1500,
                low: 900,
                close: 1200,
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/Normalized candlesticks are unavailable/)).toBeVisible();
    expect(container.querySelectorAll('g rect')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Use original units for candlesticks' }),
    ).toBeEnabled();
  });

  it('builds nested AND, NOT, sustained and window rules without executable text', () => {
    const model = fixture(true);
    function Form() {
      const [expression, setExpression] = useState<SignalExpression>(defaultExpression('value'));
      return (
        <>
          <RuleExpressionEditor expression={expression} model={model} onChange={setExpression} />
          <output aria-label="Expression">{JSON.stringify(expression)}</output>
        </>
      );
    }
    render(<Form />);
    fireEvent.change(screen.getByLabelText('Rule logic'), { target: { value: 'and' } });
    fireEvent.change(screen.getByLabelText('Rule 1 logic'), { target: { value: 'sustained' } });
    fireEvent.change(screen.getByLabelText('Rule 2 logic'), { target: { value: 'window' } });
    const expression = JSON.parse(screen.getByLabelText('Expression').textContent!);
    expect(expression).toMatchObject({
      kind: 'and',
      children: [
        { kind: 'sustained', periods: 3, child: { kind: 'comparison' } },
        { kind: 'window', operation: 'mean', periods: 3 },
      ],
    });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('supports exact keyboard inspection and never invents candlestick wicks', () => {
    render(
      <ChartView
        chart={{
          id: 'chart',
          name: 'Exact observations',
          kind: 'candlestick',
          seriesIds: ['value'],
          resolution: 'month',
          normalized: false,
        }}
        series={[
          {
            id: 'value',
            name: 'Customers',
            unit: { kind: 'count', label: 'customers' },
            color: '#23664d',
            points: [
              { time: Date.UTC(2025, 0, 1), value: 100 },
              { time: Date.UTC(2025, 1, 1), value: 120 },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/without invented wicks/)).toBeVisible();
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' });
    expect(screen.getByText('120 customers')).toBeVisible();
  });
});

describe('analysis screen lifecycle and display sampling', () => {
  it.each(['document edit', 'new lock epoch'] as const)(
    'prepares the immutable archive in a cancellable worker and prevents publication after a %s',
    async (change) => {
      const model = fixture();
      const save = vi.fn(async (_next: AnalyticsExtension) => {});
      const content: AnalyticsResultContent = {
        kind: 'signals',
        signals: [],
        evaluated: 0,
        unknown: 0,
        totalEvents: 0,
        omittedEvents: 0,
        episodeCount: 0,
        notes: [],
      };
      const prepared = archiveResult(model, content, { ruleIds: [] }, 1);
      let finish: (value: AnalysisJobValue) => void = () => {};
      vi.mocked(analyticsService.run).mockImplementation(async (request) => {
        expect(request).toMatchObject({ kind: 'archive', modelVersion: 1 });
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      function Form({
        value,
        epoch,
        version,
      }: {
        value: AnalyticsExtension;
        epoch: number;
        version: number;
      }) {
        const analysis = useAnalysis({
          diagramId: 'diagram',
          analytics: value,
          version,
          securityEpoch: epoch,
          onChange: save,
        });
        return (
          <button
            disabled={analysis.busy}
            onClick={() => {
              void analysis
                .archive(content, { ruleIds: [] })
                .then(analysis.save)
                .catch(() => {});
            }}
          >
            Archive result
          </button>
        );
      }
      const view = render(<Form value={model} epoch={1} version={1} />);
      fireEvent.click(screen.getByRole('button', { name: 'Archive result' }));
      expect(screen.getByRole('button', { name: 'Archive result' })).toBeDisabled();
      view.rerender(
        <Form
          value={change === 'document edit' ? structuredClone(model) : model}
          epoch={change === 'new lock epoch' ? 2 : 1}
          version={change === 'document edit' ? 2 : 1}
        />,
      );
      await act(async () => {
        finish(prepared);
      });
      expect(save).not.toHaveBeenCalled();
    },
  );
  it('keeps sample extrema and missing gaps while measured values remain on the original data', () => {
    const original = Array.from({ length: 100000 }, (_, index) => ({
      time: index,
      value: index === 53231 ? 1000000 : index === 74202 ? null : Math.sin(index),
    }));
    const viewport = new ChartViewport(900, 360, [0, 99999], [-1, 1000000]);
    const sample = viewport.sample(original, 1200);
    expect(sample.length).toBeLessThan(1600);
    expect(sample.some((point) => point.value === 1000000)).toBe(true);
    expect(sample.some((point) => point.value === null)).toBe(true);
    expect(original).toHaveLength(100000);
    const path = viewport.path([
      { time: 0, value: 1 },
      { time: 1, value: null },
      { time: 2, value: 2 },
    ]);
    expect(path.match(/M/g)).toHaveLength(2);
  });

  it('renders an absent calendar month as a visual discontinuity without changing observations', async () => {
    const model = fixture();
    model.series[0].resolution = 'month';
    model.datasets[0].observations = [
      { ...model.datasets[0].observations[0], time: '2025-01-01T00:00:00.000Z' },
      { ...model.datasets[0].observations[1], time: '2025-03-01T00:00:00.000Z' },
    ];
    const before = structuredClone(model.datasets);
    const { container } = render(
      <ExplorePanel
        {...panel(model)}
        onSelection={vi.fn()}
        onThreshold={vi.fn()}
        onSignalFocus={vi.fn()}
      />,
    );
    await screen.findByRole('button', { name: 'Zoom in' });
    const paths = [...container.querySelectorAll('path')].map(
      (path) => path.getAttribute('d') ?? '',
    );
    expect(paths.some((path) => (path.match(/M/g) ?? []).length === 2 && !path.includes('L'))).toBe(
      true,
    );
    expect(model.datasets).toEqual(before);
  });

  it('rejects a late saved result after its originating component unmounts', async () => {
    const model = fixture();
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    let resolve: (value: AnalysisJobValue) => void = () => {};
    vi.mocked(analyticsService.run).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    function Form() {
      const analysis = useAnalysis({
        diagramId: 'diagram',
        analytics: model,
        version: 1,
        onChange: save,
      });
      return (
        <button
          onClick={() => {
            void analysis
              .run({ kind: 'signals', model })
              .then(() => analysis.save(model))
              .catch(() => {});
          }}
        >
          Start and save
        </button>
      );
    }
    const view = render(<Form />);
    fireEvent.click(screen.getByRole('button', { name: 'Start and save' }));
    view.unmount();
    await act(async () => {
      resolve({
        kind: 'signals',
        signals: [],
        evaluated: 0,
        unknown: 0,
        totalEvents: 0,
        omittedEvents: 0,
        episodeCount: 0,
        notes: [],
      });
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not capture a fresh security epoch to publish an older action and works in StrictMode', async () => {
    const model = fixture();
    const save = vi.fn(async (_model: AnalyticsExtension) => {});
    let action: (() => Promise<void>) | undefined;
    function Form({ epoch }: { epoch: number }) {
      const analysis = useAnalysis({
        diagramId: 'diagram',
        analytics: model,
        version: 1,
        securityEpoch: epoch,
        onChange: save,
      });
      return (
        <button
          onClick={() => {
            action = () => analysis.save(model);
          }}
        >
          Capture save
        </button>
      );
    }
    const view = render(
      <StrictMode>
        <Form epoch={1} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Capture save' }));
    await act(async () => {
      await action!();
    });
    expect(save).toHaveBeenCalledOnce();
    const old = action!;
    view.rerender(
      <StrictMode>
        <Form epoch={2} />
      </StrictMode>,
    );
    await expect(old()).rejects.toThrow('Workspace access changed');
    expect(save).toHaveBeenCalledOnce();
  });
});
