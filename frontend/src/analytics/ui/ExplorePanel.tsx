import { useDefinitionRevision, DefinitionRevisionNotice } from './use-definition-revision';
import { useEffect, useMemo, useState } from 'react';
import { analyticsService } from '../service';
import { normalizeSeries } from '../engine';
import { useCurrentSignals } from './use-current-signals';
import { contiguous } from '../series';
import type {
  AnalyticsChart,
  AnalyticsIndicator,
  AnalyticsMeasurement,
  AnalyticsSignal,
  IndicatorResult,
  Observation,
} from '../types';
import { ChartView, type DisplaySeries } from './ChartView';
import { WaterfallView } from './WaterfallView';
import { IndicatorsPanel } from './IndicatorsPanel';
import { errorMessage, seriesColors, valueLabel } from './display';
import type { ChartSelection, MeasurementFitOverlay, PanelProps } from './types';

export function ExplorePanel(
  props: PanelProps & {
    selection?: ChartSelection;
    onSelection: (selection: ChartSelection) => void;
    measurement?: AnalyticsMeasurement;
    measurementFit?: MeasurementFitOverlay;
    onMeasurementPoints?: (points: { time: string; value: number }[]) => void;
    onThreshold: (seriesId: string, value: number) => void;
    focusedSignal?: AnalyticsSignal;
    onSignalFocus: (signal: AnalyticsSignal) => void;
    compact?: boolean;
  },
) {
  const { current: currentSignals } = useCurrentSignals(props.model);
  const initial = props.model.charts[0] ?? {
    id: crypto.randomUUID(),
    name: 'Time-series exploration',
    kind: 'line' as const,
    seriesIds: props.model.series.slice(0, 1).map((series) => series.id),
    resolution: 'observation' as const,
    normalized: false,
  };
  const [chart, setChart] = useState<AnalyticsChart>(structuredClone(initial));
  const chartRevision = useDefinitionRevision(
    chart.id,
    chart,
    props.model.charts.find((item) => item.id === chart.id),
    (next) => {
      setChart(next);
      setDimensions(next.dimensions ?? {});
    },
  );
  const [display, setDisplay] = useState<DisplaySeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState<{ seriesId: string; value: number }>();
  const [dimensions, setDimensions] = useState<Record<string, string>>(initial.dimensions ?? {});
  const [overlay, setOverlay] = useState<{
    indicator: AnalyticsIndicator;
    result: IndicatorResult;
  }>();
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const dataVersion = JSON.stringify(
    props.model.datasets.map((dataset) => [dataset.id, dataset.version]),
  );
  const measurementScope = props.measurement
    ? JSON.stringify([
        props.measurement.seriesIds,
        props.measurement.from,
        props.measurement.to,
        props.measurement.dimensions,
        props.measurement.normalized,
      ])
    : '';
  useEffect(() => {
    if (!props.compact || !props.measurement) return;
    const measurement = props.measurement;
    const ids = measurement.seriesIds;
    const matching = props.model.charts.find(
      (item) =>
        item.kind !== 'waterfall' &&
        item.kind !== 'candlestick' &&
        JSON.stringify([...item.seriesIds].sort()) === JSON.stringify([...ids].sort()),
    );
    const scope = measurement.dimensions ?? {};
    setChart({
      ...(matching ?? {
        id: crypto.randomUUID(),
        name: `Measurement · ${ids
          .map((id) => props.model.series.find((item) => item.id === id)?.name ?? id)
          .join(' · ')}`,
        kind: 'line' as const,
        resolution: 'observation' as const,
      }),
      seriesIds: [...ids],
      from: measurement.from,
      to: measurement.to,
      dimensions: scope,
      normalized: measurement.normalized === true,
    });
    setDimensions(scope);
    setThreshold(undefined);
  }, [props.compact, measurementScope]);

  useEffect(() => {
    setOverlay(undefined);
  }, [dataVersion]);
  const dimensionChoices = useMemo(() => {
    const choices = new Map<string, Set<string>>();
    for (const dataset of props.model.datasets)
      for (const observation of dataset.observations) {
        if (!chart.seriesIds.includes(observation.seriesId)) continue;
        for (const [key, value] of Object.entries(observation.dimensions)) {
          if (!choices.has(key)) choices.set(key, new Set());
          if (choices.get(key)!.size < 1000) choices.get(key)!.add(value);
        }
      }
    return choices;
  }, [props.model.datasets, chart.seriesIds]);
  useEffect(() => {
    if (!props.focusedSignal || (props.compact && props.measurement)) return;
    const signal = props.focusedSignal;
    setChart((chart) => ({
      ...chart,
      kind: 'line',
      seriesIds: [signal.seriesId],
      from: signal.interval.from,
      to: signal.interval.to,
      dimensions: props.model.series.find((item) => item.id === signal.seriesId)?.dimensions,
    }));
    setDimensions(props.model.series.find((item) => item.id === signal.seriesId)?.dimensions ?? {});
  }, [props.focusedSignal]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const series: DisplaySeries[] = [];
        for (const [index, seriesId] of chart.seriesIds.entries()) {
          const definition = props.model.series.find((series) => series.id === seriesId);
          if (!definition) continue;
          const segmentKeys = dimensionChoices.keys();
          const selectedDimensions = Object.fromEntries(
            [...segmentKeys]
              .filter((key) => key in dimensions)
              .map((key) => [key, dimensions[key]]),
          );
          let observations: Observation[];
          let candleError = '';
          try {
            const result = await analyticsService.run(
              {
                kind: 'query',
                model: props.model,
                seriesId,
                query: { resolution: chart.resolution, dimensions: selectedDimensions },
                ohlc: chart.kind === 'candlestick',
              },
              { signal: controller.signal },
            );
            if (!Array.isArray(result)) throw new Error('Unexpected data query result.');
            observations = result;
          } catch (issue) {
            if (chart.kind !== 'candlestick') throw issue;
            candleError = errorMessage(issue);
            const result = await analyticsService.run(
              {
                kind: 'query',
                model: props.model,
                seriesId,
                query: { resolution: chart.resolution, dimensions: selectedDimensions },
              },
              { signal: controller.signal },
            );
            if (!Array.isArray(result)) throw new Error('Unexpected data query result.');
            observations = result;
          }
          if (candleError && active) setError(candleError);
          const sourceObservations = observations;
          if (chart.normalized) observations = normalizeSeries(observations);
          const duplicateTimes = new Set<string>();
          for (const observation of observations) {
            if (duplicateTimes.has(observation.time))
              throw new Error(
                `Choose one segment or an explicit compatible aggregation for ${definition.name}. Multiple observations share a timestamp.`,
              );
            duplicateTimes.add(observation.time);
          }
          series.push({
            id: seriesId,
            name: definition.name,
            unit: chart.normalized
              ? { kind: 'number', label: 'index (first value = 100)' }
              : definition.unit,
            sourceUnit: definition.unit,
            sourceDimensions: definition.dimensions,
            dimensions: { ...definition.dimensions, ...selectedDimensions },
            seriesVersion: definition.version ?? 1,
            dataVersion: props.model.datasets.find((dataset) => dataset.id === definition.datasetId)
              ?.version,
            timezone: definition.timezone,
            color: seriesColors[index % seriesColors.length],
            provenance: definition.provenance,
            points: observations.map((point, pointIndex) => ({
              breakBefore:
                pointIndex > 0 &&
                !contiguous(sourceObservations[pointIndex - 1], point, {
                  ...definition,
                  resolution:
                    chart.resolution === 'observation' ? definition.resolution : chart.resolution,
                }),
              id: point.id,
              time: new Date(point.time).getTime(),
              value: point.value,
              sourceValue: sourceObservations[pointIndex].value,
              quality: point.quality,
              ...(chart.normalized ? {} : (point.ohlc ?? {})),
            })),
          });
        }
        if (active) setDisplay(series);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setError(errorMessage(error));
          setDisplay([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    props.model,
    chart.seriesIds,
    chart.resolution,
    chart.normalized,
    chart.kind,
    dimensions,
    dimensionChoices,
  ]);
  const groups = new Map<string, DisplaySeries[]>();
  for (const entry of display) {
    const key = JSON.stringify(entry.unit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  const addOverlay = (indicator: AnalyticsIndicator, result: IndicatorResult) =>
    setOverlay({ indicator, result });
  const overlaySeries = (original: DisplaySeries[]) => {
    const fit = props.measurementFit;
    const fitSource = original.find((entry) => entry.id === fit?.sourceSeriesId);
    const fitScope =
      fitSource &&
      fit &&
      JSON.stringify(Object.entries(fitSource.dimensions ?? {}).sort()) ===
        JSON.stringify(Object.entries(fit.series.dimensions ?? {}).sort());
    const items =
      fit &&
      fitSource &&
      fitScope &&
      !chart.normalized &&
      fit.definitionKey === JSON.stringify(props.measurement) &&
      fit.series.dataVersion === fitSource.dataVersion &&
      (fit.series.seriesVersion ?? 1) === (fitSource.seriesVersion ?? 1)
        ? [...original, fit.series]
        : original;
    if (
      !overlay ||
      chart.normalized ||
      !items.some((series) => series.id === overlay.indicator.seriesId) ||
      ['rsi', 'roc'].includes(overlay.indicator.kind)
    )
      return items;
    const source = items.find((entry) => entry.id === overlay.indicator.seriesId)!;
    return [
      ...items,
      {
        ...source,
        id: overlay.indicator.id,
        name: overlay.indicator.name,
        color: '#ba804a',
        provenance: 'derived' as const,
        points: overlay.result.points.map((point) => ({
          time: new Date(point.time).getTime(),
          value: point.value,
        })),
      },
      ...(overlay.indicator.kind === 'bollinger'
        ? (['upper', 'lower'] as const).map((component) => ({
            ...source,
            id: `${overlay.indicator.id}-${component}`,
            name: `${overlay.indicator.name} ${component}`,
            color: '#9866b4',
            provenance: 'derived' as const,
            points: overlay.result.points.map((point) => ({
              time: new Date(point.time).getTime(),
              value: point[component] ?? null,
            })),
          }))
        : []),
    ];
  };
  return (
    <>
      <section className="analytics-panel">
        <div className="analytics-panel-header">
          <div>
            <h2>{props.compact ? 'Select and measure' : 'Explore your time series'}</h2>
            <span className="muted">
              Units and meaning stay attached to the data at every zoom level.
            </span>
          </div>
          {props.model.datasets.some((dataset) => dataset.source.illustrative) && (
            <span className="analytics-example-label">Illustrative example data</span>
          )}
        </div>
        <DefinitionRevisionNotice revision={chartRevision} label="chart" />
        <div className="analytics-fields">
          <label>
            Saved chart
            <select
              aria-label="Saved chart"
              value={props.model.charts.some((entry) => entry.id === chart.id) ? chart.id : ''}
              onChange={(event) => {
                const saved = props.model.charts.find((entry) => entry.id === event.target.value);
                if (saved) {
                  setChart(structuredClone(saved));
                  setDimensions(saved.dimensions ?? {});
                  setOverlay(undefined);
                }
              }}
            >
              <option value="">Unsaved chart</option>
              {props.model.charts.map((chart) => (
                <option key={chart.id} value={chart.id}>
                  {chart.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chart name
            <input
              aria-label="Chart name"
              value={chart.name}
              onChange={(event) => setChart({ ...chart, name: event.target.value })}
              maxLength={500}
            />
          </label>
          <label>
            Time aggregation
            <select
              aria-label="Time aggregation"
              value={chart.resolution}
              onChange={(event) =>
                setChart({
                  ...chart,
                  resolution: event.target.value as AnalyticsChart['resolution'],
                })
              }
            >
              <option value="observation">Original observations</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
              <option value="year">Yearly</option>
            </select>
          </label>
          <label>
            Comparison scale
            <select
              disabled={chart.kind === 'candlestick' || chart.kind === 'waterfall'}
              aria-label="Comparison scale"
              value={chart.normalized ? 'normalized' : 'original'}
              onChange={(event) =>
                setChart({ ...chart, normalized: event.target.value === 'normalized' })
              }
            >
              <option value="original">Original units — separate panels</option>
              <option value="normalized">Normalized — first valid value = 100</option>
            </select>
          </label>
          {[...dimensionChoices].map(([key, choices]) => (
            <label key={key}>
              Segment: {key}
              <select
                value={key in dimensions ? `selected:${dimensions[key]}` : 'all'}
                onChange={(event) => {
                  const next = { ...dimensions };
                  if (event.target.value === 'all') delete next[key];
                  else next[key] = event.target.value.slice(9);
                  setDimensions(next);
                  setChart({ ...chart, dimensions: next });
                }}
              >
                <option value="all">Choose one segment or explicit aggregation</option>
                {[...choices].sort().map((value) => (
                  <option key={value} value={`selected:${value}`}>
                    {value || '(empty value)'}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="analytics-series-options">
          {props.model.series.map((series, index) => (
            <label key={series.id}>
              <input
                type="checkbox"
                checked={chart.seriesIds.includes(series.id)}
                onChange={(event) =>
                  setChart({
                    ...chart,
                    seriesIds: event.target.checked
                      ? [...chart.seriesIds, series.id]
                      : chart.seriesIds.filter((id) => id !== series.id),
                  })
                }
              />
              <i
                className="analytics-color-dot"
                style={{ background: seriesColors[index % seriesColors.length] }}
              />
              {series.name}
            </label>
          ))}
        </div>
        {loading && (
          <p role="status" className="analytics-note">
            Preparing chart observations locally… Chart controls remain available.
          </p>
        )}
        {error && (
          <p role="status" className="analytics-note analytics-error">
            {error}
          </p>
        )}
        {chart.kind === 'waterfall' ? (
          <>
            <label style={{ maxWidth: 250, marginBottom: 16 }}>
              Chart type
              <select
                aria-label="Chart type"
                value={chart.kind}
                onChange={(event) =>
                  setChart({ ...chart, kind: event.target.value as AnalyticsChart['kind'] })
                }
              >
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="bar">Bar</option>
                <option value="candlestick">Candlestick / OHLC</option>
                <option value="waterfall">Waterfall</option>
              </select>
            </label>
            <WaterfallView model={props.model} chart={chart} onChartChange={setChart} />
          </>
        ) : (
          [...groups.entries()].map(([key, entries]) => (
            <div key={key} style={{ marginTop: 12 }}>
              <h3>
                {entries.map((entry) => entry.name).join(' · ')}{' '}
                <span className="muted">({entries[0].unit.label})</span>
              </h3>
              <ChartView
                chart={chart}
                series={overlaySeries(entries)}
                signals={currentSignals}
                measurements={props.model.measurements}
                selection={props.selection}
                onSelection={(selection) => props.onSelection({ ...selection, dimensions })}
                measurement={props.measurement}
                onMeasurementPoints={props.onMeasurementPoints}
                threshold={
                  !chart.normalized && threshold?.seriesId === entries[0].id
                    ? threshold.value
                    : undefined
                }
                setThreshold={
                  !chart.normalized
                    ? (value) => setThreshold({ seriesId: entries[0].id, value })
                    : undefined
                }
                onThreshold={
                  !Object.entries(dimensions).some(
                    ([key, value]) =>
                      props.model.series.find((series) => series.id === entries[0].id)?.dimensions[
                        key
                      ] !== value,
                  )
                    ? props.onThreshold
                    : undefined
                }
                focusedSignal={props.focusedSignal}
                onChartChange={(next) =>
                  setChart({
                    ...next,
                    normalized: ['candlestick', 'waterfall'].includes(next.kind)
                      ? false
                      : next.normalized,
                  })
                }
                onSignalFocus={props.onSignalFocus}
                note={
                  chart.normalized
                    ? 'Normalized display changes only the view. Raw observations and every saved measurement retain original units.'
                    : Object.entries(dimensions).some(
                          ([key, value]) =>
                            props.model.series.find((series) => series.id === entries[0].id)
                              ?.dimensions[key] !== value,
                        )
                      ? 'A chart-only segment filter cannot define a signal rule. Save this filter as the semantic series scope in the Data tools first.'
                      : undefined
                }
              />
            </div>
          ))
        )}
        {chart.kind !== 'waterfall' && !groups.size && !loading && (
          <p className="analytics-note">Choose at least one series to display.</p>
        )}
        <div className="analytics-actions">
          <button
            disabled={
              props.busy || chartRevision.blocked || !chart.name.trim() || !chart.seriesIds.length
            }
            onClick={() => {
              setSaveError('');
              setSaveNotice('');
              if (chartRevision.blocked) return;
              void props
                .save({
                  ...props.model,
                  charts: [...props.model.charts.filter((entry) => entry.id !== chart.id), chart],
                })
                .then(() => setSaveNotice('Chart settings saved.'))
                .catch((error) => setSaveError(errorMessage(error)));
            }}
          >
            Save chart settings
          </button>
          <button
            onClick={() => {
              setChart({
                ...structuredClone(chart),
                id: crypto.randomUUID(),
                name: `${chart.name} copy`,
              });
              setSaveNotice('New chart copy. Save its settings to keep it.');
            }}
          >
            Duplicate chart
          </button>
          {props.model.charts.some((entry) => entry.id === chart.id) && (
            <button
              className="danger"
              disabled={props.busy || chartRevision.blocked}
              onClick={() =>
                void props
                  .save({
                    ...props.model,
                    charts: props.model.charts.filter((entry) => entry.id !== chart.id),
                  })
                  .then(() => setChart({ ...initial, id: crypto.randomUUID() }))
                  .catch((error) => setSaveError(errorMessage(error)))
              }
            >
              Delete chart
            </button>
          )}
        </div>
        {saveError && (
          <p role="alert" className="analytics-note analytics-error">
            {saveError}
          </p>
        )}
        {saveNotice && (
          <p role="status" className="analytics-note analytics-success">
            {saveNotice}
          </p>
        )}
        <p className="muted">
          Rendering may sample dense series; calculations always use all relevant observations.
          Lower values can be an improvement when the desired direction is lower-is-better.
        </p>
      </section>
      {!props.compact && (
        <>
          <IndicatorsPanel {...props} onOverlay={addOverlay} />
          {overlay && ['rsi', 'roc'].includes(overlay.indicator.kind) && (
            <section className="analytics-panel">
              <h3>{overlay.indicator.name} · separate indicator panel</h3>
              <ChartView
                chart={{ ...chart, kind: 'line', name: overlay.indicator.name }}
                series={[
                  {
                    id: overlay.indicator.id,
                    name: overlay.indicator.name,
                    color: '#ba804a',
                    unit: {
                      kind: overlay.indicator.kind === 'roc' ? 'ratio' : 'number',
                      label: overlay.indicator.kind === 'roc' ? '%' : 'RSI points',
                    },
                    provenance: 'derived',
                    points: overlay.result.points.map((point) => ({
                      time: new Date(point.time).getTime(),
                      value: point.value,
                    })),
                  },
                ]}
              />
              <p className="muted">
                Current value:{' '}
                {valueLabel(
                  overlay.result.points.at(-1)?.value,
                  overlay.indicator.kind === 'roc' ? 'ratio' : 'RSI points',
                )}
                .
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
