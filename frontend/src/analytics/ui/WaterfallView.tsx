import { useEffect, useMemo, useRef, useState } from 'react';
import { DefinitionRevisionNotice, useDefinitionRevision } from './use-definition-revision';
import { analyticsService } from '../service';
import type { AnalyticsChart, AnalyticsExtension, WaterfallResult } from '../types';
import { ChartViewport } from './chart-viewport';
import { errorMessage, valueLabel } from './display';
import { exportAnalyticsChartSvg } from '../vector-export';
import { downloadText } from './display';

export function WaterfallView({
  model,
  chart,
  onChartChange,
}: {
  model: AnalyticsExtension;
  chart: AnalyticsChart;
  onChartChange: (next: AnalyticsChart) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const exports = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of exports.current) controller.abort();
      exports.current.clear();
    },
    [],
  );
  const [surfaceWidth, setSurfaceWidth] = useState(900);
  const definition = chart.waterfall;
  const series = model.series.find((series) => series.id === definition?.openingSeriesId);
  const dates = useMemo(
    () =>
      [
        ...new Set(
          model.datasets
            .find((dataset) => dataset.id === series?.datasetId)
            ?.observations.filter((point) => point.seriesId === series?.id)
            .map((point) => point.time) ?? [],
        ),
      ].sort(),
    [model.datasets, series?.datasetId, series?.id],
  );
  const [date, setDate] = useState(dates.at(-1) ?? '');
  const [editing, setEditing] = useState(!definition);
  const canonical = {
    id: chart.id,
    ...(definition ?? {
      openingSeriesId: model.series[0]?.id ?? '',
      closingSeriesId: model.series[1]?.id ?? '',
      components: [],
    }),
  };
  const [draft, setDraft] = useState(canonical);
  const revision = useDefinitionRevision(chart.id, draft, canonical, setDraft);
  useEffect(() => {
    if (!dates.includes(date)) setDate(dates.at(-1) ?? '');
  }, [dates, date]);
  const [result, setResult] = useState<WaterfallResult>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setSurfaceWidth(Math.max(280, Math.min(1800, width)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult(undefined);
    setError('');
    setLoading(false);
    if (!definition || !date) return () => controller.abort();
    setLoading(true);
    void analyticsService
      .run({ kind: 'waterfall', model, chart, time: date }, { signal: controller.signal })
      .then((content) => {
        if (!active) return;
        if (!('reconciled' in content)) throw new Error('Unexpected waterfall result.');
        setResult(content);
      })
      .catch((issue) => {
        if (active && !controller.signal.aborted) setError(errorMessage(issue));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [model, chart, date, definition]);
  const steps: { name: string; value: number; from: number; to: number; balance: boolean }[] = [];
  if (result) {
    steps.push({
      name: 'Opening',
      value: result.opening,
      from: 0,
      to: result.opening,
      balance: true,
    });
    let prior = result.opening;
    for (const component of result.components) {
      steps.push({
        name: component.name,
        value: component.value,
        from: prior,
        to: prior + component.value,
        balance: false,
      });
      prior += component.value;
    }
    steps.push({
      name: 'Closing',
      value: result.closing,
      from: 0,
      to: result.closing,
      balance: true,
    });
  }
  const extremes = steps.flatMap((step) => [step.from, step.to]);
  const low = extremes.reduce((low, value) => Math.min(low, value), 0);
  const high = extremes.reduce((high, value) => Math.max(high, value), 1);
  const view = new ChartViewport(
    surfaceWidth,
    surfaceWidth < 600 ? 310 : 370,
    [0, Math.max(1, steps.length - 1)],
    [low - (high - low) * 0.08, high + (high - low) * 0.15],
  );
  const unit = result?.unit.kind === 'ratio' ? 'ratio' : result?.unit.label;
  const choices = model.series.map((series) => (
    <option key={series.id} value={series.id}>
      {series.name} · {series.unit.label}
    </option>
  ));
  return (
    <div>
      <div className="analytics-fields">
        <label>
          Waterfall period
          <select
            aria-label="Waterfall period"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          >
            {dates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setEditing(!editing)}>
          {editing ? 'Hide balance configuration' : 'Configure balance components'}
        </button>
      </div>
      <DefinitionRevisionNotice revision={revision} label="balance configuration" />
      {editing && (
        <fieldset>
          <legend>Explicit balance reconciliation</legend>
          <div className="analytics-fields">
            <label>
              Opening balance series
              <select
                value={draft.openingSeriesId}
                onChange={(event) => setDraft({ ...draft, openingSeriesId: event.target.value })}
              >
                {choices}
              </select>
            </label>
            <label>
              Closing balance series
              <select
                value={draft.closingSeriesId}
                onChange={(event) => setDraft({ ...draft, closingSeriesId: event.target.value })}
              >
                {choices}
              </select>
            </label>
          </div>
          {draft.components.map((component, index) => (
            <div className="analytics-rule-row" key={index}>
              <label>
                Change component {index + 1}
                <select
                  value={component.seriesId}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      components: draft.components.map((entry, i) =>
                        i === index ? { ...entry, seriesId: event.target.value } : entry,
                      ),
                    })
                  }
                >
                  {choices}
                </select>
              </label>
              <label>
                Sign
                <select
                  value={component.sign}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      components: draft.components.map((entry, i) =>
                        i === index
                          ? { ...entry, sign: Number(event.target.value) as 1 | -1 }
                          : entry,
                      ),
                    })
                  }
                >
                  <option value={1}>Add</option>
                  <option value={-1}>Subtract</option>
                </select>
              </label>
              <button
                onClick={() =>
                  setDraft({ ...draft, components: draft.components.filter((_, i) => i !== index) })
                }
              >
                Remove component
              </button>
            </div>
          ))}
          <div className="analytics-actions">
            <button
              onClick={() =>
                setDraft({
                  ...draft,
                  components: [
                    ...draft.components,
                    { seriesId: model.series[0]?.id ?? '', sign: 1 },
                  ],
                })
              }
            >
              Add change component
            </button>
            <button
              className="primary"
              disabled={revision.blocked}
              onClick={() => {
                revision.assertCurrent();
                const { id: _id, ...waterfall } = draft;
                onChartChange({ ...chart, waterfall });
                setEditing(false);
              }}
            >
              Apply balance configuration
            </button>
          </div>
        </fieldset>
      )}
      {!definition && (
        <p className="analytics-note">
          Waterfall needs explicit opening, closing and signed change components. Configure them
          above. A generic time-series bar chart is not a reconciled waterfall.
        </p>
      )}
      {loading && <p role="status">Reconciling the selected period locally…</p>}
      {error && (
        <p role="status" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <button
            onClick={() => {
              const controller = new AbortController();
              exports.current.add(controller);
              void exportAnalyticsChartSvg(
                model,
                chart,
                {
                  time: date,
                  width: Math.max(320, Math.round(view.width)),
                  height: view.height,
                  appearance: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
                },
                { signal: controller.signal },
              )
                .then((output) => {
                  controller.signal.throwIfAborted();
                  downloadText(
                    output.data,
                    `${chart.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.svg`,
                    'image/svg+xml',
                  );
                })
                .catch((error) => {
                  if (!controller.signal.aborted) setError(errorMessage(error));
                })
                .finally(() => exports.current.delete(controller));
            }}
          >
            Export chart SVG
          </button>
          <svg
            ref={svgRef}
            className="analytics-chart"
            viewBox={`0 0 ${view.width} ${view.height}`}
            role="img"
            aria-label="Waterfall reconciliation from opening balance through signed changes to closing balance"
          >
            <title>{chart.name}</title>
            {steps.map((step, index) => {
              const x = view.x(index);
              const width = Math.min(68, (view.plotWidth / steps.length) * 0.65);
              return (
                <g key={index}>
                  <rect
                    x={x - width / 2}
                    y={Math.min(view.y(step.from), view.y(step.to))}
                    width={width}
                    height={Math.max(2, Math.abs(view.y(step.from) - view.y(step.to)))}
                    fill={
                      step.balance ? 'var(--accent)' : step.value < 0 ? 'var(--caution)' : '#648dcc'
                    }
                    fillOpacity={0.8}
                  />
                  {index < steps.length - 1 && (
                    <line
                      x1={x + width / 2}
                      x2={view.x(index + 1) - width / 2}
                      y1={view.y(step.to)}
                      y2={view.y(step.to)}
                      stroke="var(--muted)"
                      strokeDasharray="3 4"
                    />
                  )}
                  <text
                    x={x}
                    y={Math.min(view.y(step.from), view.y(step.to)) - 10}
                    textAnchor="middle"
                  >
                    {step.value > 0 && !step.balance ? '+' : ''}
                    {valueLabel(step.value)}
                  </text>
                  <text x={x} y={view.height - 22} textAnchor="middle">
                    {step.name.length > (surfaceWidth < 600 ? 8 : 16)
                      ? `${step.name.slice(0, surfaceWidth < 600 ? 6 : 14)}…`
                      : step.name}
                  </text>
                </g>
              );
            })}
          </svg>
          <p
            className={`analytics-note ${result.reconciled ? 'analytics-success' : 'analytics-error'}`}
          >
            Reconciliation residual: {valueLabel(result.residual, unit)}.{' '}
            {result.reconciled
              ? 'Opening plus signed changes matches closing.'
              : 'The balance does not reconcile. Review the selected components and source data.'}
          </p>
          <div className="analytics-table-scroll">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Change / balance</th>
                  <th>Balance after change</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, index) => (
                  <tr key={index}>
                    <td>{step.name}</td>
                    <td>{valueLabel(step.value, unit)}</td>
                    <td>{valueLabel(step.to, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
