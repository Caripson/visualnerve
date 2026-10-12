import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenariosPanel } from '../src/analytics/ui/ScenariosPanel';
import { ScenarioComparison } from '../src/analytics/ui/ScenarioComparison';
import { analyticsService } from '../src/analytics/service';
import { executeAnalysis } from '../src/analytics/engine';
import { blankAnalytics, validateAnalytics } from '../src/analytics/validation';
import { serializePreparedChartSvg } from '../src/analytics/vector-renderer';
import type {
  AnalyticsExtension,
  AnalysisJobRequest,
  AnalysisJobValue,
  ScenarioResult,
} from '../src/analytics/types';
import type { PanelProps } from '../src/analytics/ui/types';

function model(): AnalyticsExtension {
  const value = blankAnalytics();
  value.series = [
    {
      id: 'customers',
      name: 'Closing customers',
      datasetId: 'history',
      dimensions: {},
      unit: { kind: 'count', label: 'customer accounts' },
      semantics: 'snapshot',
      aggregation: 'last',
      direction: 'higher-is-better',
      resolution: 'month',
      timezone: 'UTC',
      periodBoundary: 'start',
      provenance: 'observed',
      definition: 'Synthetic period-closing customer balance.',
    },
    {
      id: 'mrc',
      name: 'Closing MRC',
      datasetId: 'history',
      dimensions: {},
      unit: { kind: 'currency', label: 'Recurring balance', currency: 'SEK' },
      semantics: 'snapshot',
      aggregation: 'last',
      direction: 'higher-is-better',
      resolution: 'month',
      timezone: 'UTC',
      periodBoundary: 'start',
      provenance: 'observed',
      definition: 'Synthetic period-closing MRC balance.',
    },
  ];
  value.datasets = [
    {
      id: 'history',
      name: 'Synthetic history',
      version: 1,
      source: { kind: 'example', name: 'Synthetic history', illustrative: true },
      observations: value.series.flatMap((series) =>
        [0, 1, 2, 3].map((month) => ({
          id: `${series.id}-${month}`,
          seriesId: series.id,
          time: new Date(Date.UTC(2025, month, 1)).toISOString(),
          value:
            month === 3
              ? 9000
              : series.id === 'customers'
                ? 1000 + month * 10
                : 10000 + month * 200,
          dimensions: {},
          quality: 'valid' as const,
        })),
      ),
      transformations: [],
      importedAt: '2025-01-01T00:00:00.000Z',
      revisionHistory: 'unavailable',
    },
  ];
  value.scenarios = [0.02, 0.04].map((rate, index) => ({
    id: `scenario-${index}`,
    name: index ? 'Stress' : 'Baseline',
    version: 1,
    model: 'growth-churn',
    start: '2025-04-01T00:00:00.000Z',
    periods: 3,
    resolution: 'month',
    reviewed: true,
    assumptions: {
      openingCustomers: 1050,
      newCustomers: 30,
      reactivatedCustomers: 0,
      churnRate: rate,
      newCustomerGrowth: 0,
      openingMrc: 10500,
      newMrc: 500,
      expansionMrc: 100,
      contractionMrc: 200,
      churnedMrc: 300,
      currency: 'SEK',
    },
  }));
  validateAnalytics(value);
  return value;
}
function props(value: AnalyticsExtension): PanelProps {
  return {
    model: value,
    save: vi.fn(async (_next: AnalyticsExtension) => {}),
    run: vi.fn(async (request: AnalysisJobRequest) => executeAnalysis(request)),
    archive: vi.fn(async () => value),
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

describe('Observed history and scenario projection boundaries', () => {
  it('requires explicit historical sources, separates count/currency panels, and saves only the comparison view', async () => {
    const source = model();
    const original = structuredClone(source);
    const context = props(source);
    render(<ScenariosPanel {...context} />);
    expect(screen.getByLabelText('Historical customer balance')).toHaveValue('');
    expect(screen.getByLabelText('Historical MRC balance')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Historical customer balance'), {
      target: { value: 'customers' },
    });
    fireEvent.change(screen.getByLabelText('Historical MRC balance'), { target: { value: 'mrc' } });
    expect(context.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Compare saved scenarios' }));
    const chart = await screen.findByRole('img', {
      name: /^Customer balance: history and scenarios/,
    });
    const currency = screen.getByRole('img', { name: /^MRC balance: history and scenarios/ });
    expect(chart.querySelector('[data-series-id="customers"]')).toBeInTheDocument();
    expect(chart.querySelector('[data-series-id="mrc"]')).not.toBeInTheDocument();
    expect(currency.querySelector('[data-series-id="mrc"]')).toBeInTheDocument();
    expect(currency.getAttribute('aria-label')).toContain('SEK');
    expect(currency.querySelector('[data-series-id="customers"]')).not.toBeInTheDocument();
    expect(chart.querySelector('[data-projection-boundary]')).toHaveAttribute(
      'data-projection-boundary',
      '2025-04-01T00:00:00.000Z',
    );
    expect(currency.querySelector('[data-projection-boundary]')).toHaveTextContent(
      'Projection starts',
    );
    expect(chart.querySelector('[data-series-id="customers"] path')).not.toHaveAttribute(
      'stroke-dasharray',
    );
    expect(chart.querySelector('[data-series-id="scenario-0-customer"] path')).toHaveAttribute(
      'stroke-dasharray',
      '7 5',
    );
    expect(context.run).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'query',
        seriesId: 'customers',
        query: { to: '2025-03-31T23:59:59.999Z', resolution: 'month' },
      }),
    );

    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    let readout = chart.parentElement!.querySelector('.analytics-chart-readout')!;
    expect(readout).toHaveTextContent('2025-01-01T00:00:00.000Z');
    expect(readout).toHaveTextContent('1,000 customer accounts');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    readout = chart.parentElement!.querySelector('.analytics-chart-readout')!;
    expect(readout).toHaveTextContent('2025-04-01T00:00:00.000Z');
    expect(readout).toHaveTextContent('1,059 customer accounts');
    expect(readout).toHaveTextContent('outside observed range');
    expect(readout).not.toHaveTextContent('9,000');
    fireEvent.keyDown(currency, { key: 'ArrowLeft' });
    let mrcReadout = currency.parentElement!.querySelector('.analytics-chart-readout')!;
    expect(mrcReadout).toHaveTextContent('10,000 SEK');
    fireEvent.keyDown(currency, { key: 'ArrowRight' });
    fireEvent.keyDown(currency, { key: 'ArrowRight' });
    fireEvent.keyDown(currency, { key: 'ArrowRight' });
    mrcReadout = currency.parentElement!.querySelector('.analytics-chart-readout')!;
    expect(mrcReadout).toHaveTextContent('10,600 SEK');
    expect(mrcReadout).toHaveTextContent('outside observed range');

    fireEvent.click(screen.getByRole('button', { name: 'Save comparison view' }));
    await waitFor(() => expect(context.save).toHaveBeenCalledOnce());
    const saved = vi.mocked(context.save).mock.calls[0][0];
    expect(saved.scenarioView).toEqual({
      customerHistorySeriesId: 'customers',
      mrcHistorySeriesId: 'mrc',
    });
    expect(saved.datasets).toEqual(original.datasets);
    expect(saved.scenarios).toEqual(original.scenarios);
    expect(source).toEqual(original);
    validateAnalytics(saved);
  });

  it('never offers incompatible rates, period flows, foreign currencies or derived balances as observed history', async () => {
    const source = model();
    source.series.push({
      ...source.series[0],
      id: 'flow',
      name: 'New customers',
      semantics: 'flow',
      aggregation: 'sum',
    });
    source.series.push({
      ...source.series[1],
      id: 'foreign',
      name: 'EUR balance',
      unit: { kind: 'currency', label: 'MRC', currency: 'EUR' },
    });
    const result = executeAnalysis({
      kind: 'scenario',
      scenario: source.scenarios[0],
    }) as ScenarioResult;
    render(<ScenarioComparison {...props(source)} results={[result]} />);
    await screen.findByRole('img', { name: /^Customer balance: history and scenarios/ });
    expect(
      within(screen.getByLabelText('Historical customer balance')).queryByRole('option', {
        name: /New customers/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Historical MRC balance')).queryByRole('option', {
        name: /EUR balance/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Historical customer balance')).toHaveValue('');
  });

  it('keeps a comparison view draft from overwriting an external source-selection update', async () => {
    const source = model();
    source.scenarioView = { customerHistorySeriesId: 'customers' };
    const context = props(source);
    const surface = render(<ScenarioComparison {...context} results={[]} />);
    fireEvent.change(screen.getByLabelText('Historical MRC balance'), { target: { value: 'mrc' } });
    const changed = { ...source, scenarioView: {} };
    surface.rerender(<ScenarioComparison {...context} model={changed} results={[]} />);
    expect(screen.getByRole('button', { name: 'Save comparison view' })).toBeDisabled();
    expect(screen.getByText(/saved comparison view changed elsewhere/)).toBeVisible();
    expect(context.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved comparison view' }));
    expect(screen.getByLabelText('Historical customer balance')).toHaveValue('');
    expect(screen.getByLabelText('Historical MRC balance')).toHaveValue('');
  });

  it('routes historical queries through the originating screen and cancels the remaining preparation after unmount', async () => {
    const source = model();
    source.scenarioView = { customerHistorySeriesId: 'customers', mrcHistorySeriesId: 'mrc' };
    const result = executeAnalysis({
      kind: 'scenario',
      scenario: source.scenarios[0],
    }) as ScenarioResult;
    let release!: (result: AnalysisJobValue) => void;
    let pending!: AnalysisJobRequest;
    const run = vi.fn((request: AnalysisJobRequest) => {
      pending = request;
      return new Promise<AnalysisJobValue>((resolve) => {
        release = resolve;
      });
    });
    const context = { ...props(source), run };
    const surface = render(<ScenarioComparison {...context} results={[result]} />);
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'query', seriesId: 'customers' }),
    );
    expect(analyticsService.run).not.toHaveBeenCalled();
    surface.unmount();
    await act(async () => {
      release(executeAnalysis(pending));
    });
    expect(run).toHaveBeenCalledOnce();
    expect(context.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: /history and scenarios/ })).not.toBeInTheDocument();
  });

  it('renders the same escaped projection boundary in each independent SVG unit panel, without joining history or inventing confidence', () => {
    const start = Date.parse('2025-04-01T00:00:00.000Z');
    const customer = { kind: 'count' as const, label: 'customers' };
    const mrc = { kind: 'currency' as const, label: 'MRC', currency: 'SEK' };
    const chart = {
      id: 'comparison',
      name: 'History and assumptions',
      kind: 'line' as const,
      seriesIds: ['history', 'future', 'mrc'],
      resolution: 'month' as const,
      normalized: false,
    };
    const result = serializePreparedChartSvg(
      chart,
      [
        {
          id: 'history',
          name: 'Observed <balance>',
          unit: customer,
          provenance: 'observed',
          points: [{ time: start - 86400000, value: 1000 }],
        },
        {
          id: 'future',
          name: 'Projected',
          unit: customer,
          provenance: 'scenario',
          points: [
            { time: start, value: 1010 },
            { time: start + 86400000, value: 1020 },
          ],
        },
        {
          id: 'mrc',
          name: 'Projected MRC',
          unit: mrc,
          provenance: 'scenario',
          points: [
            { time: start, value: 101000 },
            { time: start + 86400000, value: 102000 },
          ],
        },
      ],
      { projectionStart: start, appearance: 'dark' },
    );
    const svg = new DOMParser().parseFromString(result.data, 'image/svg+xml');
    expect(svg.querySelectorAll('[data-projection-boundary]')).toHaveLength(2);
    expect(svg.querySelector('[data-series-id="future"]')?.getAttribute('stroke-dasharray')).toBe(
      '7 5',
    );
    expect(svg.querySelector('[data-series-id="history"]')?.hasAttribute('stroke-dasharray')).toBe(
      false,
    );
    expect(
      svg.querySelector('[data-projection-boundary]')?.getAttribute('data-projection-boundary'),
    ).toBe('2025-04-01T00:00:00.000Z');
    expect(result.data).toContain('Observed &lt;balance&gt;');
    expect(result.warnings).toContain(
      'Observed history and separate scenario projections; projection starts 2025-04-01T00:00:00.000Z.',
    );
    expect(result.warnings.join(' ')).toContain('not a confidence or prediction interval');
    expect(() =>
      serializePreparedChartSvg(
        chart,
        [{ id: 'x', name: 'x', unit: customer, points: [{ time: start, value: 1 }] }],
        { projectionStart: Infinity },
      ),
    ).toThrow(/valid timestamp/);
  });
});
