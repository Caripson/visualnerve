import { useDefinitionRevision, DefinitionRevisionNotice } from './use-definition-revision';
import { useEffect, useState } from 'react';
import type { AnalyticsMeasurement, MeasurementKind, MeasurementResult } from '../types';
import { downloadText, errorMessage, isCancelled, metricName, valueLabel } from './display';
import type { ChartSelection, MeasurementFitOverlay, PanelProps } from './types';
import { usePreview } from './use-preview';
import { DimensionFilterFields } from './DimensionFilterFields';
import { measurementMetricLabel } from './measurement-display';
import { UtcDateTimeFields } from './UtcDateTimeFields';
import { UtcTimestamp } from './UtcTimestamp';

const tools: { kind: MeasurementKind; label: string; description: string }[] = [
  {
    kind: 'point-to-point',
    label: 'Point-to-point measure',
    description: 'Absolute change, relative change and percentage points from two observations.',
  },
  {
    kind: 'time-range',
    label: 'Time range',
    description: 'Elapsed time, calendar periods and actual observation count are separate values.',
  },
  {
    kind: 'range-statistics',
    label: 'Range statistics',
    description:
      'Minimum, maximum, mean, median, sample deviation and data coverage. Summation follows the series semantics.',
  },
  {
    kind: 'trend-line',
    label: 'Trend line',
    description:
      'A hand-positioned line with two data-anchored points. Its slope is a numeric rate, independent of screen angle.',
  },
  {
    kind: 'regression',
    label: 'Regression',
    description:
      'Least-squares fit against elapsed time, including slope, intercept, R² and residuals.',
  },
  {
    kind: 'compare-periods',
    label: 'Compare periods',
    description:
      'Compare two explicit intervals. Different lengths and calendar seasonality remain visible.',
  },
  {
    kind: 'compare-series',
    label: 'Compare series',
    description:
      'Compare aligned observations in their original units or explicitly normalized display.',
  },
  {
    kind: 'correlation',
    label: 'Correlation',
    description:
      'Pearson or Spearman with matched observations and an explicit observation lag. Correlation does not establish causation.',
  },
  {
    kind: 'annotation',
    label: 'Annotation',
    description: 'A named event or comment, optionally linked to an existing diagram node.',
  },
];

export function MeasurementsPanel(
  props: PanelProps & {
    selection?: ChartSelection;
    draft?: AnalyticsMeasurement;
    onDraft: (draft: AnalyticsMeasurement) => void;
    onFit?: (overlay: MeasurementFitOverlay | undefined) => void;
  },
) {
  const firstSeries = props.model.series[0];
  const firstDataset = props.model.datasets.find(
    (dataset) => dataset.id === firstSeries?.datasetId,
  );
  const observations =
    firstDataset?.observations.filter((point) => point.seriesId === firstSeries?.id) ?? [];
  const initial = (): AnalyticsMeasurement => ({
    id: crypto.randomUUID(),
    name: 'Change in the selected range',
    kind: 'point-to-point',
    seriesIds: [firstSeries?.id ?? ''],
    from: observations[0]?.time ?? new Date().toISOString(),
    to: observations.at(-1)?.time ?? new Date().toISOString(),
  });
  const [fallback] = useState(initial);
  const draft = props.draft ?? fallback;
  const preview = usePreview<MeasurementResult, AnalyticsMeasurement>(draft, props.model);
  const result = preview.value;
  const setResult = preview.setValue;
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const revision = useDefinitionRevision(
    selected,
    draft,
    props.model.measurements.find((item) => item.id === selected),
    props.onDraft,
  );
  const set = (patch: Partial<AnalyticsMeasurement>) => props.onDraft({ ...draft, ...patch });
  useEffect(() => {
    if (props.selection)
      props.onDraft({
        ...draft,
        seriesIds: [props.selection.seriesId],
        from: props.selection.from,
        to: props.selection.to,
        points: props.selection.points,
        dimensions: props.selection.dimensions,
      });
  }, [props.selection]);
  const compute = async (save = false) => {
    setError('');
    try {
      if (save) revision.assertCurrent();
      const computed = await props.run({
        kind: 'measurement',
        model: props.model,
        measurement: draft,
      });
      if (!('kind' in computed) || computed.kind !== 'measurement')
        throw new Error('Unexpected measurement result.');
      setResult(computed);
      if (save) {
        const archived = await props.archive(
          computed,
          { measurement: draft },
          {
            ...props.model,
            measurements: [
              ...props.model.measurements.filter((entry) => entry.id !== draft.id),
              draft,
            ],
          },
        );
        const resultId = archived.results.at(-1)!.id;
        await props.save({
          ...archived,
          measurements: archived.measurements.map((entry) =>
            entry.id === draft.id ? { ...entry, resultId } : entry,
          ),
        });
        setSelected(draft.id);
      }
    } catch (error) {
      if (!isCancelled(error)) setError(errorMessage(error));
    }
  };
  const tool = tools.find((tool) => tool.kind === draft.kind)!;
  const series = props.model.series.find((series) => series.id === draft.seriesIds[0]);
  const fitDataVersion = props.model.datasets.find(
    (dataset) => dataset.id === series?.datasetId,
  )?.version;
  useEffect(() => {
    if (!props.onFit) return;
    if (
      draft.kind !== 'regression' ||
      !result?.values?.length ||
      !series ||
      preview.archive?.stale
    ) {
      props.onFit(undefined);
      return;
    }
    props.onFit({
      sourceSeriesId: series.id,
      definitionKey: JSON.stringify(draft),
      series: {
        id: `regression-fit-${draft.id}`,
        name: 'Regression fit · descriptive selected interval',
        unit: series.unit,
        color: '#ba804a',
        provenance: 'derived',
        renderAs: 'line',
        dimensions: { ...series.dimensions, ...draft.dimensions },
        sourceDimensions: series.dimensions,
        dataVersion: fitDataVersion,
        seriesVersion: series.version ?? 1,
        points: result.values.map((point) => ({
          time: Date.parse(point.time),
          value: point.value,
        })),
      },
    });
  }, [result, JSON.stringify(draft), series, fitDataVersion, preview.archive?.stale, props.onFit]);

  const resultSeries = preview.archive?.inputSnapshot.series ?? props.model.series;
  const resultSource = resultSeries.find((source) => source.id === draft.seriesIds[0]);
  return (
    <section className="analytics-panel" aria-labelledby="analytics-measure-heading">
      <div className="analytics-panel-header">
        <div>
          <h2 id="analytics-measure-heading">Measurement tools</h2>
          <span className="muted">
            Select a range in the chart, or enter UTC dates and times below.
          </span>
        </div>
        <a
          href="https://www.visualnerve.com/help/time-series-analysis/#measure"
          target="_blank"
          rel="noreferrer"
        >
          Measurement guide
        </a>
      </div>
      <DefinitionRevisionNotice revision={revision} label="measurement" />
      <div className="analytics-fields">
        <label>
          Saved measurement
          <select
            aria-label="Saved measurement"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              const measurement = props.model.measurements.find(
                (entry) => entry.id === event.target.value,
              );
              if (measurement) {
                props.onDraft(structuredClone(measurement));
                const saved = props.model.results.find(
                  (result) => result.id === measurement.resultId,
                );
                setResult(
                  saved?.content.kind === 'measurement' ? saved.content : undefined,
                  measurement,
                  saved,
                );
              } else {
                props.onDraft(initial());
                setResult(undefined);
              }
            }}
          >
            <option value="">New measurement</option>
            {props.model.measurements.map((measurement) => (
              <option key={measurement.id} value={measurement.id}>
                {measurement.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Measurement tool
          <select
            aria-label="Measurement tool"
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as MeasurementKind;
              set({
                kind,
                name: tools.find((tool) => tool.kind === kind)!.label,
                points:
                  kind === 'trend-line'
                    ? (props.selection?.points ?? [
                        { time: draft.from, value: 0 },
                        { time: draft.to, value: 1 },
                      ])
                    : undefined,
              });
              setResult(undefined);
            }}
          >
            {tools.map((tool) => (
              <option key={tool.kind} value={tool.kind}>
                {tool.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            aria-label="Measurement name"
            value={draft.name}
            maxLength={500}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label>
          Series
          <select
            aria-label="Measurement series"
            value={draft.seriesIds[0] ?? ''}
            onChange={(event) =>
              set({
                seriesIds: [event.target.value, ...draft.seriesIds.slice(1)],
                dimensions: undefined,
              })
            }
          >
            {props.model.series.map((series) => (
              <option key={series.id} value={series.id}>
                {series.name} · {series.unit.label}
              </option>
            ))}
          </select>
        </label>
        <UtcDateTimeFields
          label="From"
          ariaLabel="Measurement from"
          value={draft.from}
          onChange={(next) => next && set({ from: next })}
        />
        <UtcDateTimeFields
          label="To"
          ariaLabel="Measurement to"
          value={draft.to}
          onChange={(next) => next && set({ to: next })}
        />
      </div>
      <p className="analytics-note">{tool.description}</p>
      {(draft.kind === 'correlation' || draft.kind === 'compare-series') && (
        <div className="analytics-fields">
          <label>
            Second series
            <select
              aria-label="Comparison series"
              value={draft.seriesIds[1] ?? ''}
              onChange={(event) => set({ seriesIds: [draft.seriesIds[0], event.target.value] })}
            >
              <option value="">Choose a series</option>
              {props.model.series
                .filter((series) => series.id !== draft.seriesIds[0])
                .map((series) => (
                  <option key={series.id} value={series.id}>
                    {series.name} · {series.unit.label}
                  </option>
                ))}
            </select>
          </label>
          {draft.kind === 'correlation' && (
            <>
              <label>
                Method
                <select
                  value={draft.method ?? 'pearson'}
                  onChange={(event) =>
                    set({ method: event.target.value as 'pearson' | 'spearman' })
                  }
                >
                  <option value="pearson">Pearson</option>
                  <option value="spearman">Spearman (average ranks for ties)</option>
                </select>
              </label>
              <label>
                Observation lag
                <input
                  type="number"
                  min={-10000}
                  max={10000}
                  value={draft.lag ?? 0}
                  onChange={(event) => set({ lag: Number(event.target.value) })}
                />
              </label>
            </>
          )}
          <label>
            Comparison display
            <select
              value={draft.normalized ? 'normalized' : 'original'}
              onChange={(event) => set({ normalized: event.target.value === 'normalized' })}
            >
              <option value="original">Original units</option>
              <option value="normalized">Normalize first matched value to 100</option>
            </select>
          </label>
        </div>
      )}
      {draft.kind === 'compare-periods' && (
        <div className="analytics-fields">
          <UtcDateTimeFields
            label="Comparison from"
            value={draft.comparisonFrom}
            optional
            onChange={(next) => set({ comparisonFrom: next })}
          />
          <UtcDateTimeFields
            label="Comparison to"
            value={draft.comparisonTo}
            optional
            onChange={(next) => set({ comparisonTo: next })}
          />
        </div>
      )}
      {draft.kind === 'trend-line' && (
        <fieldset>
          <legend>Data-anchored line endpoints</legend>
          <p className="muted">
            Drag handles in the chart or use these fields. This is independent of statistical
            regression.
          </p>
          <div className="analytics-fields">
            {(draft.points ?? []).map((point, index) => (
              <div key={index}>
                <UtcDateTimeFields
                  label={`Anchor ${index + 1} date`}
                  value={point.time}
                  onChange={(next) => {
                    if (next)
                      set({
                        points: draft.points!.map((entry, i) =>
                          i === index ? { ...entry, time: next } : entry,
                        ),
                      });
                  }}
                />
                <label>
                  Anchor {index + 1} value
                  <input
                    type="number"
                    step="any"
                    value={point.value}
                    onChange={(event) =>
                      set({
                        points: draft.points!.map((entry, i) =>
                          i === index ? { ...entry, value: Number(event.target.value) } : entry,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <div className="analytics-fields">
        <label>
          Comment
          <textarea
            aria-label="Measurement comment"
            rows={3}
            value={draft.note ?? ''}
            maxLength={10000}
            onChange={(event) => set({ note: event.target.value })}
          />
        </label>
        {props.nodes?.length ? (
          <label>
            Link to diagram node
            <select
              value={draft.nodeId ?? ''}
              onChange={(event) => set({ nodeId: event.target.value || undefined })}
            >
              <option value="">No node link</option>
              {props.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <DimensionFilterFields
        model={props.model}
        seriesIds={draft.seriesIds}
        value={draft.dimensions}
        onChange={(dimensions) => set({ dimensions })}
        disabled={props.busy}
      />
      <div className="analytics-actions">
        <button
          className="primary"
          disabled={props.busy || !draft.name.trim()}
          onClick={() => void compute(false)}
        >
          Calculate measurement
        </button>
        <button
          disabled={props.busy || revision.blocked || !draft.name.trim()}
          onClick={() => void compute(true)}
        >
          Save definition and result
        </button>
        {selected && (
          <>
            <button
              disabled={props.busy}
              onClick={() => {
                const duplicate = {
                  ...structuredClone(draft),
                  id: crypto.randomUUID(),
                  name: `${draft.name} copy`,
                  resultId: undefined,
                };
                setSelected('');
                props.onDraft(duplicate);
                setResult(undefined);
              }}
            >
              Duplicate
            </button>
            <button
              className="danger"
              disabled={props.busy || revision.blocked}
              onClick={() => {
                void props
                  .save({
                    ...props.model,
                    measurements: props.model.measurements.filter((entry) => entry.id !== selected),
                  })
                  .then(() => {
                    setSelected('');
                    props.onDraft(initial());
                    setResult(undefined);
                  })
                  .catch((error) => setError(errorMessage(error)));
              }}
            >
              Delete measurement
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="analytics-note analytics-error">
          {error}
        </p>
      )}
      {result && (
        <div className="analytics-results" aria-label="Measurement results">
          {preview.archive && (
            <p className="analytics-note">
              Locked saved result · data{' '}
              {Object.entries(preview.archive.dataVersions)
                .map(([id, version]) => `${id}: v${version}`)
                .join(', ')}
              .{' '}
              {preview.archive.stale
                ? 'Definition or source changed; this remains the retained historical result. Recalculate to assess current data.'
                : 'Calculated from the retained immutable inputs.'}
            </p>
          )}
          <div className="analytics-stat-grid">
            {Object.entries(result.metrics).map(([name, metric]) => (
              <div className="analytics-stat" key={name}>
                <span>{metricName(name)}</span>
                <strong>{measurementMetricLabel(name, metric.value, draft, resultSeries)}</strong>
                {metric.explanation && <small>{metric.explanation}</small>}
              </div>
            ))}
          </div>
          {result.metrics.absoluteChange?.value !== null &&
            result.metrics.absoluteChange?.value !== undefined &&
            resultSource?.direction !== 'neutral' && (
              <p className="analytics-note">
                Numerical{' '}
                {result.metrics.absoluteChange.value > 0
                  ? 'increase'
                  : result.metrics.absoluteChange.value < 0
                    ? 'decrease'
                    : 'no change'}{' '}
                · Business{' '}
                {result.metrics.absoluteChange.value === 0
                  ? 'unchanged'
                  : result.metrics.absoluteChange.value > 0 ===
                      (resultSource?.direction === 'higher-is-better')
                    ? 'improvement'
                    : 'deterioration'}{' '}
                according to this series’ configured desired direction.
              </p>
            )}
          {result.notes.map((note, index) => (
            <p className="analytics-note" key={index}>
              {note}
            </p>
          ))}
          <p className="muted">
            {resultSource?.name} · {resultSource?.unit.label} · <UtcTimestamp value={draft.from} />{' '}
            – <UtcTimestamp value={draft.to} />. Saved definitions can be recalculated; archived
            results retain their input data version.
          </p>
          <div className="analytics-actions">
            <button
              onClick={() =>
                downloadText(
                  JSON.stringify({ definition: draft, result }, null, 2),
                  'visual-nerve-measurement.json',
                )
              }
            >
              Export measurement JSON
            </button>
          </div>
          {result.residuals?.length ? (
            <details>
              <summary>Regression residuals ({result.residuals.length})</summary>
              <div className="analytics-table-scroll">
                <table className="analytics-table">
                  <caption>
                    Showing first {valueLabel(Math.min(1000, result.residuals.length))} of{' '}
                    {valueLabel(result.residuals.length)} residuals. Export measurement JSON
                    includes the full result.
                  </caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Residual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.residuals.slice(0, 1000).map((point) => (
                      <tr key={point.time}>
                        <td>
                          <UtcTimestamp value={point.time} />
                        </td>
                        <td>{valueLabel(point.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
