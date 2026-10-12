import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type {
  AnalyticsChart,
  AnalyticsMeasurement,
  AnalyticsSignal,
  AnalyticsUnit,
} from '../types';
import { ChartViewport, type ChartPoint } from './chart-viewport';
import { dateLabel, valueLabel } from './display';
import type { ChartInteractions, ChartSelection } from './types';
import { serializePreparedChartSvg } from '../vector-export';
import { downloadText } from './display';
import { analyticsAxisTickLabel } from '../vector-renderer';
import { UtcDateTimeFields } from './UtcDateTimeFields';
import { UtcTimestamp } from './UtcTimestamp';

export interface DisplaySeries {
  id: string;
  name: string;
  unit: AnalyticsUnit;
  sourceUnit?: AnalyticsUnit;
  dimensions?: Record<string, string>;
  sourceDimensions?: Record<string, string>;
  dataVersion?: number;
  seriesVersion?: number;
  timezone?: string;
  color: string;
  points: ChartPoint[];
  provenance?: 'observed' | 'derived' | 'scenario';
  renderAs?: 'line';
}

export interface ChartViewProps extends ChartInteractions {
  chart: AnalyticsChart;
  series: DisplaySeries[];
  signals?: AnalyticsSignal[];
  measurements?: AnalyticsMeasurement[];
  threshold?: number;
  setThreshold?: (value: number) => void;
  onChartChange?: (chart: AnalyticsChart) => void;
  onSignalFocus?: (signal: AnalyticsSignal) => void;
  note?: string;
  projectionStart?: string;
}

const stamp = (time: string) => new Date(time).getTime();
const displayUnit = (unit: AnalyticsUnit) =>
  unit.kind === 'currency' ? `${unit.label} (${unit.currency})` : unit.label;

export function ChartView(props: ChartViewProps) {
  const { series, threshold, setThreshold } = props;
  const [localChart, setLocalChart] = useState(props.chart);
  useEffect(() => {
    if (!props.onChartChange) setLocalChart(props.chart);
  }, [props.chart, props.onChartChange]);
  const chart = props.onChartChange ? props.chart : localChart;
  const changeChart = (next: AnalyticsChart) => {
    if (props.onChartChange) props.onChartChange(next);
    else setLocalChart(next);
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(900);
  const id = useId().replace(/:/g, '');
  const [mode, setMode] = useState<'inspect' | 'range' | 'pan' | 'threshold'>('inspect');
  const [hover, setHover] = useState<ChartPoint>();
  const [drag, setDrag] = useState<{
    x: number;
    time: number;
    end: number;
    kind: string;
    anchor?: number;
  }>();
  const hasFinite = useMemo(
    () => series.some((entry) => entry.points.some((point) => point.value !== null)),
    [series],
  );
  useEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0)
        setSurfaceWidth((current) =>
          Math.abs(current - width) < 1 ? current : Math.max(280, Math.min(1800, width)),
        );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasFinite]);
  const fullTime = useMemo<[number, number]>(
    () => [
      Math.min(...series.map((entry) => entry.points[0]?.time ?? Infinity)),
      Math.max(...series.map((entry) => entry.points.at(-1)?.time ?? -Infinity)),
    ],
    [series],
  );
  const from = chart.from ? stamp(chart.from) : fullTime[0];
  const to = chart.to ? stamp(chart.to) : fullTime[1];
  const filtered = useMemo(
    () =>
      series.map((entry) => ({
        ...entry,
        points: entry.points.filter((point) => point.time >= from && point.time <= to),
      })),
    [series, from, to],
  );
  const [low, high] = useMemo(() => {
    let low = Infinity,
      high = -Infinity;
    const include = (value: number) => {
      low = Math.min(low, value);
      high = Math.max(high, value);
    };
    for (const entry of filtered)
      for (const point of entry.points)
        if (point.value !== null) {
          include(point.value);
          if (!chart.normalized && point.low !== undefined) include(point.low);
          if (!chart.normalized && point.high !== undefined) include(point.high);
        }
    if (threshold !== undefined) include(threshold);
    if (['bar', 'area', 'waterfall'].includes(chart.kind)) include(0);
    return Number.isFinite(low) ? [low, high] : [0, 1];
  }, [filtered, threshold, chart.kind, chart.normalized]);
  const padding = (high - low || Math.abs(high) || 1) * 0.08;
  const axisUnit = filtered[0]?.unit ?? { kind: 'number' as const, label: 'units' };
  const valueTicks = Array.from({ length: 5 }, (_, index) => {
    const value = low - padding + ((high - low + padding * 2) * index) / 4;
    return { value, label: analyticsAxisTickLabel(value, axisUnit) };
  });
  const axisLeft = Math.max(64, ...valueTicks.map((tick) => tick.label.length * 7 + 18));
  const view = new ChartViewport(
    surfaceWidth,
    surfaceWidth < 600 ? 290 : 360,
    [from, to],
    [low - padding, high + padding],
    axisLeft,
  );
  const sampled = useMemo(
    () => filtered.map((entry) => ({ ...entry, points: view.sample(entry.points) })),
    [filtered],
  );
  const primary = filtered[0];
  const crosshairPoints = useMemo(() => {
    if (!props.projectionStart) return primary?.points ?? [];
    const timeline = new Map<number, ChartPoint>();
    for (const entry of filtered)
      for (const point of entry.points)
        if (!timeline.has(point.time)) timeline.set(point.time, point);
    return [...timeline.values()].sort((first, second) => first.time - second.time);
  }, [filtered, props.projectionStart]);
  const projectionStart = props.projectionStart ? stamp(props.projectionStart) : undefined;
  const sameScope = (
    id: string,
    dimensions: Record<string, string> | undefined,
    inherit = false,
  ) => {
    const entry = series.find((item) => item.id === id);
    if (!entry) return false;
    const expected = entry.dimensions ?? {};
    const effective = inherit ? { ...entry.sourceDimensions, ...dimensions } : (dimensions ?? {});
    return (
      Object.keys(expected).length === Object.keys(effective).length &&
      Object.entries(expected).every(([key, value]) => effective[key] === value)
    );
  };
  const unit =
    primary?.unit.kind === 'ratio'
      ? 'ratio'
      : primary?.unit.kind === 'currency'
        ? primary.unit.currency
        : primary?.unit.label;
  const candlesValid =
    !chart.normalized &&
    primary?.points.length &&
    primary.points.every(
      (point) =>
        point.value === null ||
        [point.open, point.high, point.low, point.close].every((value) => value !== undefined),
    );
  const kind = chart.kind === 'candlestick' && !candlesValid ? 'line' : chart.kind;
  const coordinate = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * view.width,
      y: ((event.clientY - bounds.top) / bounds.height) * view.height,
    };
  };
  const range = (start: number, end: number) => {
    const lower = Math.max(fullTime[0], Math.min(start, end));
    const upper = Math.min(fullTime[1], Math.max(start, end));
    if (upper <= lower) return;
    changeChart({
      ...chart,
      from: new Date(lower).toISOString(),
      to: new Date(upper).toISOString(),
    });
  };
  const zoom = (factor: number) => {
    const center = (from + to) / 2;
    const span = ((to - from) * factor) / 2;
    range(center - span, center + span);
  };
  const shift = (direction: number) => {
    const delta = (to - from) * 0.2 * direction;
    range(from + delta, to + delta);
  };
  const selected =
    props.selection &&
    props.selection.seriesId === primary?.id &&
    sameScope(props.selection.seriesId, props.selection.dimensions, true)
      ? props.selection
      : undefined;
  const hoveredValues = hover
    ? filtered.map((entry) => ({
        entry,
        point:
          entry.points.length &&
          hover.time >= entry.points[0].time &&
          hover.time <= entry.points.at(-1)!.time
            ? view.nearest(entry.points, hover.time)
            : undefined,
      }))
    : [];
  const trend =
    props.measurement?.kind === 'trend-line' &&
    !chart.normalized &&
    props.measurement.seriesIds.some((id) => sameScope(id, props.measurement?.dimensions, true))
      ? props.measurement.points
      : undefined;

  if (!hasFinite || !Number.isFinite(from) || !Number.isFinite(to))
    return (
      <p className="analytics-note">
        No finite observations in this chart. Import data or choose another series.
      </p>
    );

  return (
    <div className="analytics-chart-shell">
      <div className="analytics-chart-toolbar">
        <label>
          Chart type
          <select
            aria-label="Chart type"
            value={chart.kind}
            onChange={(event) =>
              changeChart({ ...chart, kind: event.target.value as AnalyticsChart['kind'] })
            }
          >
            <option value="line">Line</option>
            <option value="area">Area</option>
            <option value="bar">Bar</option>
            <option value="candlestick" disabled={!props.onChartChange && !candlesValid}>
              Candlestick / OHLC
            </option>
            {props.onChartChange && <option value="waterfall">Waterfall</option>}
          </select>
        </label>
        <label>
          Chart interaction
          <select
            aria-label="Chart interaction"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="inspect">Crosshair</option>
            <option value="range" disabled={!props.onSelection}>
              Select range
            </option>
            <option value="pan">Pan time</option>
            <option value="threshold" disabled={!setThreshold}>
              Move threshold
            </option>
          </select>
        </label>
        <div className="analytics-actions" style={{ marginTop: 0 }}>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(0.65)}>
            <ZoomIn size={16} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1.5)}>
            <ZoomOut size={16} />
          </button>
          <button type="button" aria-label="Earlier time" onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Later time" onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            aria-label="Show full history"
            onClick={() => changeChart({ ...chart, from: undefined, to: undefined })}
          >
            <Maximize2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const exported = serializePreparedChartSvg({ ...chart, kind }, series, {
                width: Math.max(320, Math.round(view.width)),
                height: view.height,
                from,
                to,
                appearance: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
                signals: props.signals,
                measurements: props.measurements,
                threshold,
                projectionStart,
              });
              downloadText(
                exported.data,
                `${chart.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'time-series'}.svg`,
                'image/svg+xml',
              );
            }}
          >
            Export chart SVG
          </button>
        </div>
      </div>
      {chart.kind === 'candlestick' && !candlesValid && (
        <p role="status" className="analytics-note">
          {chart.normalized
            ? 'Normalized candlesticks are unavailable because OHLC has not been transformed into an index. Showing a line in index units.'
            : 'Candlestick requires validated OHLC or multiple actual observations within each period. This series has insufficient OHLC detail; showing a line without invented wicks.'}
          {chart.normalized && (
            <button onClick={() => changeChart({ ...chart, normalized: false })}>
              Use original units for candlesticks
            </button>
          )}
        </p>
      )}
      {props.note && <p className="analytics-note">{props.note}</p>}
      {props.projectionStart && (
        <p className="analytics-note">
          Solid series are historical observations. Dashed series are reviewed assumptions, starting{' '}
          <UtcTimestamp value={props.projectionStart} />. Historical values are not replaced or
          joined to projected values.
        </p>
      )}
      {series.length > 1 && (
        <ul className="analytics-chart-legend" aria-label="Chart series">
          {series.map((entry) => (
            <li key={entry.id}>
              <i className="analytics-color-dot" style={{ background: entry.color }} />
              <span>{entry.name}</span>
              <span className="muted">· {displayUnit(entry.unit)}</span>
            </li>
          ))}
        </ul>
      )}
      <svg
        ref={svgRef}
        className="analytics-chart"
        viewBox={`0 0 ${view.width} ${view.height}`}
        role="img"
        aria-label={`${chart.name}. ${primary ? displayUnit(primary.unit) : ''}. Use arrow keys for the crosshair, Shift and arrows to move time, and plus or minus to zoom.`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoom(0.65);
          }
          if (event.key === '-') {
            event.preventDefault();
            zoom(1.5);
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            if (event.shiftKey) shift(direction);
            else if (crosshairPoints.length) {
              const index = hover ? crosshairPoints.indexOf(hover) : 0;
              setHover(
                crosshairPoints[
                  Math.max(0, Math.min(crosshairPoints.length - 1, index + direction))
                ],
              );
            }
          }
        }}
        onPointerDown={(event) => {
          const point = coordinate(event);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          const time = view.timeAt(point.x);
          if (mode === 'threshold' && setThreshold) setThreshold(view.valueAt(point.y));
          setDrag({ x: point.x, time, end: time, kind: mode });
          if (primary) setHover(view.nearest(crosshairPoints, time));
        }}
        onPointerMove={(event) => {
          const point = coordinate(event);
          const time = view.timeAt(point.x);
          if (drag) {
            setDrag({ ...drag, end: time });
            if (drag.kind === 'threshold') setThreshold?.(view.valueAt(point.y));
            if (drag.kind === 'anchor' && trend && drag.anchor !== undefined) {
              const points = trend.map((anchor, index) =>
                index === drag.anchor
                  ? { time: new Date(time).toISOString(), value: view.valueAt(point.y) }
                  : anchor,
              );
              props.onMeasurementPoints?.(points);
            }
          }
          if (primary) setHover(view.nearest(crosshairPoints, time));
        }}
        onPointerUp={() => {
          if (drag?.kind === 'range' && primary) {
            const first = view.nearest(primary.points, Math.min(drag.time, drag.end));
            const last = view.nearest(primary.points, Math.max(drag.time, drag.end));
            if (first && last) {
              const firstValue = first.sourceValue ?? first.value;
              const lastValue = last.sourceValue ?? last.value;
              const selection: ChartSelection = {
                seriesId: primary.id,
                from: new Date(first.time).toISOString(),
                to: new Date(last.time).toISOString(),
                points:
                  firstValue !== null && lastValue !== null
                    ? [
                        { time: new Date(first.time).toISOString(), value: firstValue },
                        { time: new Date(last.time).toISOString(), value: lastValue },
                      ]
                    : undefined,
              };
              props.onSelection?.(selection);
            }
          }
          if (drag?.kind === 'pan') range(from + drag.time - drag.end, to + drag.time - drag.end);
          setDrag(undefined);
        }}
        onPointerCancel={() => setDrag(undefined)}
      >
        <title>
          {chart.name} · {primary && displayUnit(primary.unit)}
        </title>
        <desc>
          Full-resolution analysis is available in the measurement tools. The visual rendering
          samples large series while retaining extrema and missing-value gaps.
        </desc>
        <defs>
          <clipPath id={`${id}-plot`}>
            <rect x={view.left} y={view.top} width={view.plotWidth} height={view.plotHeight} />
          </clipPath>
        </defs>
        {valueTicks.map(({ value, label }, index) => {
          return (
            <g key={index}>
              <line
                className="analytics-chart-grid"
                x1={view.left}
                y1={view.y(value)}
                x2={view.width - view.right}
                y2={view.y(value)}
              />
              <text data-axis="value" x={view.left - 9} y={view.y(value) + 4} textAnchor="end">
                {label}
              </text>
            </g>
          );
        })}
        {Array.from({ length: surfaceWidth < 560 ? 3 : 5 }, (_, index) => {
          const time = from + ((to - from) * index) / (surfaceWidth < 560 ? 2 : 4);
          return (
            <text
              data-axis="time"
              key={index}
              x={view.x(time)}
              y={view.height - 22}
              textAnchor={
                index === 0 ? 'start' : index === (surfaceWidth < 560 ? 2 : 4) ? 'end' : 'middle'
              }
            >
              {dateLabel(time)}
            </text>
          );
        })}
        <text x={view.left} y={17}>
          {primary && displayUnit(primary.unit)}
        </text>
        <g clipPath={`url(#${id}-plot)`}>
          {projectionStart !== undefined && projectionStart >= from && projectionStart <= to && (
            <g data-projection-boundary={props.projectionStart}>
              <line
                x1={view.x(projectionStart)}
                x2={view.x(projectionStart)}
                y1={view.top}
                y2={view.height - view.bottom}
                stroke="var(--text)"
                strokeDasharray="2 4"
                strokeWidth={1.5}
              />
              <text
                x={Math.max(
                  view.left + 8,
                  Math.min(view.width - view.right - 8, view.x(projectionStart) + 8),
                )}
                y={view.top + 14}
                textAnchor={
                  view.x(projectionStart) > view.width - view.right - 150 ? 'end' : 'start'
                }
                style={{ fill: 'var(--text)', fontWeight: 600 }}
              >
                Projection starts
              </text>
            </g>
          )}
          {selected && (
            <rect
              x={view.x(stamp(selected.from))}
              y={view.top}
              width={Math.max(2, view.x(stamp(selected.to)) - view.x(stamp(selected.from)))}
              height={view.plotHeight}
              fill="var(--accent)"
              fillOpacity=".09"
            />
          )}
          {drag?.kind === 'range' && (
            <rect
              x={view.x(Math.min(drag.time, drag.end))}
              y={view.top}
              width={Math.max(2, Math.abs(view.x(drag.time) - view.x(drag.end)))}
              height={view.plotHeight}
              fill="var(--accent)"
              fillOpacity=".18"
            />
          )}
          {sampled.map((entry) => {
            const points = entry.points;
            const dash =
              entry.provenance === 'scenario'
                ? '7 5'
                : entry.renderAs === 'line'
                  ? '5 3'
                  : undefined;
            const entryKind = entry.renderAs ?? kind;
            if (entryKind === 'candlestick')
              return (
                <g key={entry.id}>
                  {points
                    .filter((point) => point.value !== null)
                    .map((point, index) => {
                      const width = Math.max(
                        2,
                        Math.min(14, (view.plotWidth / points.length) * 0.65),
                      );
                      const rising = point.close! >= point.open!;
                      return (
                        <g key={`${point.time}-${index}`}>
                          <line
                            x1={view.x(point.time)}
                            x2={view.x(point.time)}
                            y1={view.y(point.high!)}
                            y2={view.y(point.low!)}
                            stroke={entry.color}
                            strokeWidth={1.5}
                          />
                          <rect
                            x={view.x(point.time) - width / 2}
                            y={Math.min(view.y(point.open!), view.y(point.close!))}
                            width={width}
                            height={Math.max(
                              1,
                              Math.abs(view.y(point.open!) - view.y(point.close!)),
                            )}
                            fill={rising ? entry.color : 'var(--surface)'}
                            stroke={entry.color}
                          />
                        </g>
                      );
                    })}
                </g>
              );
            if (entryKind === 'bar')
              return (
                <g key={entry.id}>
                  {points
                    .filter((point) => point.value !== null)
                    .map((point, index) => {
                      const width = Math.max(
                        2,
                        Math.min(22, (view.plotWidth / points.length) * 0.65),
                      );
                      return (
                        <rect
                          key={`${point.time}-${index}`}
                          x={view.x(point.time) - width / 2}
                          y={Math.min(view.y(0), view.y(point.value!))}
                          width={width}
                          height={Math.max(1, Math.abs(view.y(point.value!) - view.y(0)))}
                          fill={entry.color}
                          fillOpacity={0.75}
                        />
                      );
                    })}
                </g>
              );
            return (
              <g key={entry.id} data-series-id={entry.id}>
                {entryKind === 'area' &&
                  (() => {
                    const segments: ChartPoint[][] = [[]];
                    for (const point of points) {
                      if (point.value === null) segments.push([]);
                      else {
                        if (point.breakBefore) segments.push([]);
                        segments.at(-1)!.push(point);
                      }
                    }
                    return segments
                      .filter((segment) => segment.length > 0)
                      .map((segment, index) => (
                        <path
                          key={index}
                          d={`${view.path(segment)} L${view.x(segment.at(-1)!.time)},${view.y(0)} L${view.x(segment[0].time)},${view.y(0)} Z`}
                          fill={entry.color}
                          fillOpacity={0.1}
                        />
                      ));
                  })()}
                <path
                  d={view.path(points)}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={2.5}
                  strokeDasharray={dash}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {threshold !== undefined && (
            <g>
              <line
                x1={view.left}
                x2={view.width - view.right}
                y1={view.y(threshold)}
                y2={view.y(threshold)}
                stroke="var(--caution)"
                strokeWidth={2}
                strokeDasharray="6 5"
              />
              <text x={view.width - view.right - 4} y={view.y(threshold) - 8} textAnchor="end">
                Threshold {valueLabel(threshold, unit)}
              </text>
            </g>
          )}
          {props.measurements
            ?.filter(
              (measurement) =>
                measurement.kind === 'annotation' &&
                measurement.seriesIds.some((id) => sameScope(id, measurement.dimensions, true)),
            )
            .map((measurement) => (
              <g key={measurement.id}>
                <line
                  x1={view.x(stamp(measurement.from))}
                  x2={view.x(stamp(measurement.from))}
                  y1={view.top}
                  y2={view.height - view.bottom}
                  stroke="var(--muted)"
                  strokeDasharray="3 5"
                />
                <text x={view.x(stamp(measurement.from)) + 6} y={view.top + 15}>
                  {measurement.name}
                </text>
              </g>
            ))}
          {props.signals
            ?.filter(
              (signal) =>
                signal.state === 'onset' &&
                sameScope(signal.seriesId, signal.dimensions) &&
                series.some(
                  (entry) =>
                    entry.id === signal.seriesId &&
                    (entry.dataVersion === undefined || entry.dataVersion === signal.dataVersion) &&
                    (entry.seriesVersion ?? 1) === (signal.seriesVersion ?? 1),
                ),
            )
            .map((signal) => (
              <g
                key={signal.id}
                tabIndex={0}
                role="button"
                aria-label={`${signal.explanation}, observed ${signal.observationTime}, first possible detection ${signal.detectedAt}`}
                onClick={() => props.onSignalFocus?.(signal)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') props.onSignalFocus?.(signal);
                }}
              >
                <circle
                  cx={view.x(stamp(signal.observationTime))}
                  cy={view.top + 14}
                  r={8}
                  fill="var(--caution)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                <text
                  x={view.x(stamp(signal.observationTime))}
                  y={view.top + 18}
                  textAnchor="middle"
                  style={{ fill: 'var(--surface)', fontSize: 10 }}
                >
                  !
                </text>
              </g>
            ))}
          {trend?.length === 2 && (
            <g>
              <line
                x1={view.x(stamp(trend[0].time))}
                y1={view.y(trend[0].value)}
                x2={view.x(stamp(trend[1].time))}
                y2={view.y(trend[1].value)}
                stroke="var(--caution)"
                strokeWidth={2}
              />
              {trend.map((point, index) => (
                <circle
                  key={index}
                  cx={view.x(stamp(point.time))}
                  cy={view.y(point.value)}
                  r={8}
                  fill="var(--surface)"
                  stroke="var(--caution)"
                  strokeWidth={2}
                  role="button"
                  tabIndex={0}
                  aria-label={`Trend anchor ${index + 1}. Edit exact values in the measurement fields.`}
                  onKeyDown={(event) => {
                    if (
                      !props.onMeasurementPoints ||
                      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const next = trend.map((anchor) => ({ ...anchor }));
                    const step = event.shiftKey ? 10 : 1;
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                      next[index].time = new Date(
                        stamp(point.time) + (event.key === 'ArrowLeft' ? -1 : 1) * 86400000 * step,
                      ).toISOString();
                    else
                      next[index].value =
                        point.value +
                        (((event.key === 'ArrowUp' ? 1 : -1) * (high - low || 1)) / 100) * step;
                    props.onMeasurementPoints(next);
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    svgRef.current?.setPointerCapture?.(event.pointerId);
                    setDrag({
                      x: view.x(stamp(point.time)),
                      time: stamp(point.time),
                      end: stamp(point.time),
                      kind: 'anchor',
                      anchor: index,
                    });
                  }}
                />
              ))}
            </g>
          )}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={view.x(hover.time)}
                x2={view.x(hover.time)}
                y1={view.top}
                y2={view.height - view.bottom}
                stroke="var(--muted)"
                strokeDasharray="3 3"
              />
              {hover.value !== null && (
                <circle
                  cx={view.x(hover.time)}
                  cy={view.y(hover.value)}
                  r={4}
                  fill={
                    props.projectionStart
                      ? (filtered.find((entry) => entry.points.includes(hover))?.color ??
                        primary?.color)
                      : primary?.color
                  }
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </g>
      </svg>
      <div className="analytics-chart-readout" role="status" aria-live="polite">
        {hover ? (
          <>
            <strong>
              <UtcTimestamp value={hover.time} />
            </strong>
            {hoveredValues.map(({ entry, point }) => (
              <span key={entry.id}>
                <i className="analytics-color-dot" style={{ background: entry.color }} />{' '}
                {entry.name}:{' '}
                <strong>
                  {valueLabel(
                    point?.value,
                    entry.unit.kind === 'ratio'
                      ? 'ratio'
                      : entry.unit.kind === 'currency'
                        ? entry.unit.currency
                        : entry.unit.label,
                  )}
                </strong>{' '}
                · {point ? (point.quality ?? 'valid') : 'outside observed range'}
                {point && point.time !== hover.time && (
                  <>
                    {' '}
                    · nearest observed <UtcTimestamp value={point.time} />
                  </>
                )}
              </span>
            ))}
          </>
        ) : (
          <span>Move the crosshair or use the arrow keys to inspect exact observations.</span>
        )}
      </div>
      {hover && (
        <details className="analytics-observation-detail">
          <summary>Exact observation details</summary>
          <div className="analytics-table-scroll">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Series</th>
                  <th>Observation time</th>
                  <th>Original value</th>
                  <th>Unit</th>
                  <th>Quality</th>
                </tr>
              </thead>
              <tbody>
                {hoveredValues.map(({ entry, point }) => (
                  <tr key={entry.id}>
                    <td>{entry.name}</td>
                    <td>
                      {point ? <UtcTimestamp value={point.time} /> : 'Not available'}
                      {entry.timezone ? ` · ${entry.timezone}` : ''}
                    </td>
                    <td>
                      {point?.sourceValue === null || point?.value === null
                        ? 'Missing'
                        : String(point?.sourceValue ?? point?.value ?? 'Not available')}
                    </td>
                    <td>{displayUnit(entry.sourceUnit ?? entry.unit)}</td>
                    <td>{point ? (point.quality ?? 'valid') : 'Not available'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <div className="analytics-fields" style={{ marginTop: 15 }}>
        <UtcDateTimeFields
          label="Visible from"
          value={from}
          onChange={(next) => next && range(stamp(next), to)}
        />
        <UtcDateTimeFields
          label="Visible to"
          value={to}
          onChange={(next) => next && range(from, stamp(next))}
        />
        {setThreshold && (
          <label>
            {primary?.unit.kind === 'ratio'
              ? 'Threshold (fraction; 0.02 = 2%)'
              : 'Threshold (source units)'}
            <input
              type="number"
              step="any"
              aria-label="Threshold in source units"
              value={threshold ?? ''}
              onChange={(event) => {
                if (event.target.value !== '') setThreshold(Number(event.target.value));
              }}
            />
          </label>
        )}
      </div>
      {setThreshold && threshold !== undefined && (
        <div className="analytics-actions">
          <button
            type="button"
            disabled={!props.onThreshold}
            onClick={() => primary && props.onThreshold?.(primary.id, threshold)}
          >
            Create signal rule
          </button>
          <span className="muted">
            {primary?.unit.kind === 'ratio'
              ? `Current threshold: ${valueLabel(threshold, 'ratio')}. `
              : ''}
            Review the rule before saving.
          </span>
        </div>
      )}
    </div>
  );
}
