import { SeriesNameField } from './SeriesNameField';
import { DimensionFilterFields } from './DimensionFilterFields';
import { useState } from 'react';
import type { AnalyticsDataset, AnalyticsSeries } from '../types';
import { downloadText, errorMessage, valueLabel } from './display';
import type { PanelProps } from './types';
import { analyticsCsvCell } from '../import';
import { DerivedSeriesEditor } from './DerivedSeriesEditor';
import { UtcTimestamp } from './UtcTimestamp';
import { ResultRetentionPanel } from './ResultRetentionPanel';

export function DatasetPanel(
  props: PanelProps & {
    onImport: (targetDatasetId?: string) => void;
  },
) {
  const [datasetId, setDatasetId] = useState(props.model.datasets[0]?.id ?? '');
  const [seriesId, setSeriesId] = useState('all');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const dataset =
    props.model.datasets.find((entry) => entry.id === datasetId) ?? props.model.datasets[0];
  const series = props.model.series.filter((entry) => entry.datasetId === dataset?.id);
  const observations =
    dataset?.observations.filter((point) => seriesId === 'all' || point.seriesId === seriesId) ??
    [];
  const stale = props.model.results.filter((result) => result.stale).length;
  const exportCsv = () => {
    if (!dataset) return;
    const rows: (string | number | null)[][] = [
      [
        'time',
        'known_at',
        'series',
        'value',
        'unit',
        'quality',
        'dimensions',
        'numerator',
        'denominator',
      ],
    ];
    for (const point of observations) {
      const series = props.model.series.find((series) => series.id === point.seriesId);
      rows.push([
        point.time,
        point.knownAt ?? null,
        series?.name ?? point.seriesId,
        point.value,
        series?.unit.label ?? '',
        point.quality,
        JSON.stringify(point.dimensions),
        point.numerator ?? null,
        point.denominator ?? null,
      ]);
    }
    downloadText(
      rows.map((row) => row.map(analyticsCsvCell).join(',')).join('\r\n'),
      'visual-nerve-observations.csv',
      'text/csv;charset=utf-8',
    );
  };
  const changeSeries = async (id: string, patch: Partial<AnalyticsSeries>) => {
    try {
      setError('');
      await props.save({
        ...props.model,
        series: props.model.series.map((series) =>
          series.id === id ? { ...series, ...patch } : series,
        ),
        results: props.model.results.map((result) => ({ ...result, stale: true })),
      });
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  return (
    <>
      <section className="analytics-panel">
        <div className="analytics-panel-header">
          <div>
            <h2>Import and data quality</h2>
            <span className="muted">
              Local preview → column mapping → validation → explicit commit.
            </span>
          </div>
          <button className="primary" disabled={props.busy} onClick={() => props.onImport()}>
            Import CSV, XLSX or JSON
          </button>
        </div>
        <p className="analytics-note">
          Files are parsed locally. Missing data remains missing. No AI, remote workbook evaluation
          or external links are executed. Data stays inside your encrypted workspace until you
          explicitly export, share or allow an API/MCP response.
        </p>
        {stale > 0 && (
          <p role="status" className="analytics-note">
            {stale} archived result{stale !== 1 ? 's are' : ' is'} stale after a source or
            definition change. Definitions and notes are preserved. Recalculate to create a new
            result; original snapshots remain attached to their saved versions.
          </p>
        )}
        {!dataset && (
          <p>No dataset yet. Import a file or use the bundled Growth & Churn example.</p>
        )}
        {dataset && (
          <>
            <div className="analytics-fields">
              <label>
                Dataset
                <select
                  aria-label="Analytics dataset"
                  value={dataset.id}
                  onChange={(event) => {
                    setDatasetId(event.target.value);
                    setSeriesId('all');
                    setOffset(0);
                  }}
                >
                  {props.model.datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} · version {dataset.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Observation series
                <select
                  aria-label="Observation series"
                  value={seriesId}
                  onChange={(event) => {
                    setSeriesId(event.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="all">All series</option>
                  {series.map((series) => (
                    <option key={series.id} value={series.id}>
                      {series.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="analytics-stat-grid">
              <div className="analytics-stat">
                Observations<strong>{observations.length.toLocaleString('en')}</strong>
              </div>
              <div className="analytics-stat">
                Series<strong>{series.length}</strong>
              </div>
              <div className="analytics-stat">
                Missing values
                <strong>{observations.filter((point) => point.value === null).length}</strong>
              </div>
              <div className="analytics-stat">
                Incomplete observations
                <strong>
                  {observations.filter((point) => point.quality === 'incomplete').length}
                </strong>
              </div>
            </div>
            <div className="analytics-table-scroll">
              <table className="analytics-table">
                <caption style={{ textAlign: 'left', padding: 12 }}>
                  {dataset.name} · observations {Math.min(offset + 1, observations.length)}–
                  {Math.min(offset + 100, observations.length)} of {observations.length}
                </caption>
                <thead>
                  <tr>
                    <th>Observation time</th>
                    <th>Known at</th>
                    <th>Series</th>
                    <th>Value</th>
                    <th>Quality</th>
                    <th>Segments</th>
                    <th>Numerator / denominator</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.slice(offset, offset + 100).map((point) => {
                    const series = props.model.series.find(
                      (series) => series.id === point.seriesId,
                    );
                    return (
                      <tr key={point.id}>
                        <td>
                          <UtcTimestamp value={point.time} />
                          <small>UTC instant · calendar: {series?.timezone ?? 'UTC'}</small>
                        </td>
                        <td>
                          {point.knownAt ? <UtcTimestamp value={point.knownAt} /> : 'Not supplied'}
                        </td>
                        <td>{series?.name ?? point.seriesId}</td>
                        <td>
                          {valueLabel(
                            point.value,
                            series?.unit.kind === 'ratio' ? 'ratio' : series?.unit.label,
                          )}
                        </td>
                        <td>{point.quality}</td>
                        <td>
                          {Object.entries(point.dimensions)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(' · ') || 'All'}
                        </td>
                        <td>
                          {point.numerator !== undefined
                            ? `${valueLabel(point.numerator)} / ${valueLabel(point.denominator)}`
                            : 'Not supplied'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="analytics-actions">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>
                Previous 100
              </button>
              <button
                disabled={offset + 100 >= observations.length}
                onClick={() => setOffset(offset + 100)}
              >
                Next 100
              </button>
              <button disabled={props.busy} onClick={() => props.onImport(dataset.id)}>
                Refresh this dataset
              </button>
              <button
                onClick={() =>
                  downloadText(
                    JSON.stringify(dataset, null, 2),
                    'visual-nerve-analytics-dataset.json',
                  )
                }
              >
                Export dataset JSON
              </button>
              <button onClick={exportCsv}>Export observations CSV</button>
            </div>
            <SourceDetails dataset={dataset} />
          </>
        )}
        {error && (
          <p role="alert" className="analytics-note analytics-error">
            {error}
          </p>
        )}
      </section>
      {dataset && (
        <section className="analytics-panel">
          <h2>Series meaning</h2>
          <p className="muted">
            Meaning is separate from chart appearance. Changes invalidate saved analyses.
            Unsupported temporal rate aggregation is refused.
          </p>
          {series.map((series) => (
            <details key={series.id} style={{ marginBottom: 12 }}>
              <summary>
                {series.name} · {series.semantics} · {series.unit.label} · {series.resolution}
              </summary>
              <div className="analytics-fields" style={{ marginTop: 15 }}>
                <SeriesNameField
                  series={series}
                  disabled={props.busy}
                  save={(name) => void changeSeries(series.id, { name })}
                />
                <label>
                  Desired business direction
                  <select
                    value={series.direction}
                    onChange={(event) =>
                      void changeSeries(series.id, {
                        direction: event.target.value as AnalyticsSeries['direction'],
                      })
                    }
                  >
                    <option value="higher-is-better">Higher is better</option>
                    <option value="lower-is-better">Lower is better</option>
                    <option value="neutral">Neutral</option>
                  </select>
                </label>
                <label>
                  Allowed aggregation
                  <select
                    value={series.aggregation}
                    onChange={(event) =>
                      void changeSeries(series.id, {
                        aggregation: event.target.value as AnalyticsSeries['aggregation'],
                      })
                    }
                  >
                    {(series.semantics === 'snapshot'
                      ? ['first', 'last', 'none']
                      : series.semantics === 'flow'
                        ? ['sum', 'none']
                        : ['ratio', 'none']
                    ).map((aggregation) => (
                      <option key={aggregation}>{aggregation}</option>
                    ))}
                  </select>
                </label>
              </div>
              <DimensionFilterFields
                model={props.model}
                seriesIds={[series.id]}
                value={series.dimensions}
                disabled={props.busy}
                onChange={(dimensions) => void changeSeries(series.id, { dimensions })}
              />
              <p>{series.definition}</p>
              <p className="muted">
                Timezone: {series.timezone}. Period boundary: {series.periodBoundary}. Provenance:{' '}
                {series.provenance}. Column: {series.columnId ?? 'Derived definition'}.{' '}
                {series.riskPopulation ? `Risk population: ${series.riskPopulation}.` : ''}
              </p>
            </details>
          ))}
        </section>
      )}
      <DerivedSeriesEditor {...props} />
      <ResultRetentionPanel {...props} />
    </>
  );
}

function SourceDetails({ dataset }: { dataset: AnalyticsDataset }) {
  return (
    <details style={{ marginTop: 18 }}>
      <summary>Source and transformations</summary>
      <p>
        Source: {dataset.source.name} · {dataset.source.kind}. Imported{' '}
        <UtcTimestamp value={dataset.importedAt} />. Publication/revision history:{' '}
        {dataset.revisionHistory}.
      </p>
      {dataset.source.illustrative && (
        <p className="analytics-example-label">Illustrative example data</p>
      )}
      <ol>
        {dataset.transformations.map((step, index) => (
          <li key={index} style={{ marginBottom: 8 }}>
            {step}
          </li>
        ))}
      </ol>
      <p className="muted">Import time is not assumed to be the observation's publication time.</p>
    </details>
  );
}
