import { useEffect, useState } from 'react';
import type { Graph, GraphNode } from '../model/types';
import type { CsvAnalysis, CsvNodeData, CsvPathEntry } from '../data/types';
import { getCsvAnalysis, getCsvNode } from '../data/csv';
import { previewCsvRows } from '../data/client';
import { useEditor } from '../state/editor';
import { formatCsvMeasure } from './MetricSummary';
import './csv-properties.css';
import { MeasureExplanationDialog } from './MeasureExplanationDialog';
import { analysisForDataset, datasetForNode } from '../data/model';

export function CsvProperties({
  graph,
  node,
  onEditCsv,
  onFocusCsv,
  onPageCsv,
}: {
  graph: Graph;
  node?: GraphNode;
  onEditCsv?: (datasetId?: string) => void;
  onFocusCsv?: (path: CsvPathEntry[], datasetId?: string) => void;
  onPageCsv?: (direction: 'next' | 'previous', datasetId?: string) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [explainId, setExplainId] = useState<string>();
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [originalValues, setOriginalValues] = useState(false);
  const [preview, setPreview] = useState<{
    rows: string[][];
    originalRows: string[][];
    total: number;
  }>();
  const dataset = node ? datasetForNode(graph, node) : graph.dataset;
  const analysis = dataset ? analysisForDataset(graph, dataset.id) : getCsvAnalysis(graph);
  const data = node ? getCsvNode(node) : undefined;
  const sourceAvailable =
    node?.metadata.csvSnapshot === undefined &&
    !!dataset &&
    (!data ||
      (data.datasetId === dataset.id &&
        data.path.every((entry) =>
          dataset.columns.some((column) => column.id === entry.columnId),
        )));
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setSourceError('');
    if (!sourceOpen || !dataset || !data || !sourceAvailable) {
      setSourceBusy(false);
      return;
    }
    if (!analysis) {
      setSourceError('CSV analysis settings are unavailable for this source.');
      setSourceBusy(false);
      return;
    }
    setSourceBusy(true);
    void previewCsvRows(dataset, analysis, data.path, 100, graph)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((error) => {
        if (active) setSourceError((error as Error).message);
      })
      .finally(() => {
        if (active) setSourceBusy(false);
      });
    return () => {
      active = false;
    };
  }, [sourceOpen, dataset, data?.groupKey, sourceAvailable, analysis, graph]);
  if (node && !data) return null;
  if (!node && !dataset) return null;
  const focusedGroup = graph.nodes
    .map((item) => (item.metadata.csv !== undefined ? getCsvNode(item) : undefined))
    .find(
      (item) =>
        item?.datasetId === dataset?.id &&
        item?.groupKey === JSON.stringify(analysis?.focusPath ?? []),
    );
  const navigation =
    !sourceAvailable || !analysis ? null : (
      <CsvNavigation
        analysis={analysis}
        focusedGroup={focusedGroup}
        group={data}
        onFocus={onFocusCsv ? (path) => onFocusCsv(path, dataset?.id) : undefined}
        onPage={onPageCsv ? (direction) => onPageCsv(direction, dataset?.id) : undefined}
      />
    );

  const edit = (patch: Partial<CsvNodeData>) => {
    if (!node) return;
    const state = useEditor.getState();
    const current = state.graph?.nodes.find((item) => item.id === node.id);
    if (!current) return;
    const csv = getCsvNode(current);
    if (!csv) return;
    const key = current.metadata.csv ? 'csv' : 'csvSnapshot';
    state.updateNode(
      current.id,
      { metadata: { ...current.metadata, [key]: { ...csv, ...patch } } },
      false,
    );
  };

  if (!node)
    return (
      <section className="csv-properties" aria-label="CSV data">
        <div className="property-section">CSV data</div>
        <p className="csv-source-name">{dataset!.fileName}</p>
        <p className="muted">
          {numberFormat(dataset!.rows.length)} rows · {dataset!.columns.length} columns
        </p>
        {analysis && (
          <p className="csv-grouping-path">
            Grouped by{' '}
            {analysis.levels
              .map((id) => dataset!.columns.find((column) => column.id === id)?.label ?? id)
              .join(' → ') || 'all rows'}
          </p>
        )}
        {focusedGroup && (
          <p className="muted">
            {numberFormat(focusedGroup.rowCount)} matching rows in the current view.
          </p>
        )}
        {navigation}
        {onEditCsv && (
          <button className="full" onClick={() => onEditCsv(dataset?.id)}>
            Change grouping and measures
          </button>
        )}
      </section>
    );

  const hidden = new Set(data!.hiddenMetricIds ?? []);
  const selectedColumns = new Set(
    data!.displayColumns ?? analysis?.displayColumns ?? dataset?.columns.map((column) => column.id),
  );
  const visibleColumns = sourceAvailable
    ? dataset!.columns
        .map((column, index) => ({ ...column, index }))
        .filter((column) => selectedColumns.has(column.id))
    : [];
  return (
    <section className="csv-properties" aria-label="CSV group data">
      <div className="property-section">Group measures</div>
      <p className="muted">{numberFormat(data!.rowCount)} source rows in this group.</p>
      {data!.hiddenChildren > 0 && (
        <p className="csv-group-notice">
          {numberFormat(data!.hiddenChildren)} more groups. Measures include all{' '}
          {numberFormat(data!.rowCount)} matching rows, including groups outside this view.
        </p>
      )}
      {navigation}
      {sourceAvailable && onEditCsv && (
        <button className="full" onClick={() => onEditCsv(dataset?.id)}>
          Change grouping and measures
        </button>
      )}
      <div className="csv-measure-controls">
        {data!.measures.map((measure) => (
          <div className="csv-measure-control" key={measure.id}>
            <label className="check-field">
              <input
                type="checkbox"
                aria-label={`Show ${measure.label}`}
                checked={!hidden.has(measure.id)}
                onChange={(event) => {
                  const next = new Set(hidden);
                  if (event.target.checked) next.delete(measure.id);
                  else next.add(measure.id);
                  edit({ hiddenMetricIds: [...next] });
                }}
              />
              <span>{measure.label}</span>
              <b>{formatCsvMeasure(measure.value)}</b>
            </label>
            {sourceAvailable &&
              data!.visible !== false &&
              analysis?.metrics.some((metric) => metric.id === measure.id) && (
                <button
                  className="quiet"
                  aria-label={`Explain ${measure.label}`}
                  onClick={() => setExplainId(measure.id)}
                >
                  Why this value?
                </button>
              )}
            {(measure.missingCount > 0 || measure.invalidCount > 0) && (
              <small className="csv-measure-quality">
                {measure.missingCount} empty · {measure.invalidCount} non-numeric
              </small>
            )}
          </div>
        ))}
      </div>
      <p className="csv-measure-help muted">
        These checkboxes control the measures shown on this object and in image exports. Numeric
        measures skip empty and non-numeric cells; — means no valid values. Count includes every
        source row. Distinct counts unique non-empty values.
      </p>
      {sourceAvailable ? (
        <details
          className="csv-source-rows"
          aria-busy={sourceBusy}
          onToggle={(event) => setSourceOpen(event.currentTarget.open)}
        >
          <summary>Source rows ({numberFormat(data!.rowCount)})</summary>
          <details className="csv-source-columns">
            <summary>Columns shown ({visibleColumns.length})</summary>
            <div className="csv-column-controls">
              {dataset!.columns.map((column) => (
                <label className="check-field" key={column.id}>
                  <input
                    type="checkbox"
                    aria-label={`Show source column ${column.label}`}
                    checked={selectedColumns.has(column.id)}
                    onChange={(event) => {
                      const next = new Set(selectedColumns);
                      if (event.target.checked) next.add(column.id);
                      else next.delete(column.id);
                      edit({
                        displayColumns: dataset!.columns
                          .filter((entry) => next.has(entry.id))
                          .map((entry) => entry.id),
                      });
                    }}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          </details>
          {sourceOpen && (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  aria-label="Original values"
                  checked={originalValues}
                  onChange={(event) => setOriginalValues(event.target.checked)}
                />
                Original values
              </label>
              {sourceBusy && (
                <p className="muted" role="status">
                  Loading source rows…
                </p>
              )}
              {sourceError && (
                <p className="form-error" role="alert">
                  {sourceError}
                </p>
              )}
              {preview && (
                <>
                  <p className="muted">
                    Showing {preview.rows.length} of {numberFormat(preview.total)} rows.
                    {originalValues
                      ? ' Original CSV cells are preserved.'
                      : ' Cleaned values used in the analysis.'}
                  </p>
                  {visibleColumns.length ? (
                    <div className="csv-table-scroll" tabIndex={0} aria-label="Scroll source rows">
                      <table className="csv-source-table" aria-label="Source rows">
                        <thead>
                          <tr>
                            {visibleColumns.map((column) => (
                              <th key={column.id} scope="col">
                                {column.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(originalValues ? preview.originalRows : preview.rows).map(
                            (row, index) => (
                              <tr key={index}>
                                {visibleColumns.map((column) => (
                                  <td key={column.id}>{row[column.index] || '—'}</td>
                                ))}
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">Choose a column above to show its values.</p>
                  )}
                </>
              )}
            </>
          )}
        </details>
      ) : (
        <p className="muted">The CSV source is unavailable for this object.</p>
      )}
      {explainId && dataset && analysis && (
        <MeasureExplanationDialog
          model={graph}
          dataset={dataset}
          analysis={analysis}
          path={data!.path}
          metricId={explainId}
          onClose={() => setExplainId(undefined)}
        />
      )}
    </section>
  );
}

function CsvNavigation({
  analysis,
  focusedGroup,
  group,
  onFocus,
  onPage,
}: {
  analysis?: CsvAnalysis;
  focusedGroup?: CsvNodeData;
  group?: CsvNodeData;
  onFocus?: (path: CsvPathEntry[]) => void;
  onPage?: (direction: 'next' | 'previous') => void;
}) {
  return (
    <div className="csv-navigation">
      {onFocus && (
        <div className="csv-navigation-actions">
          <button onClick={() => onFocus([])}>All data</button>
          {group && group.path.length > 0 && (
            <button onClick={() => onFocus(group.path)}>Explore this group</button>
          )}
        </div>
      )}
      {analysis && focusedGroup && onPage && focusedGroup.hiddenChildren > 0 && (
        <>
          <p className="muted">
            Current view: groups {Math.min(analysis.offset + 1, focusedGroup.totalChildren)}–
            {Math.min(
              analysis.offset + focusedGroup.totalChildren - focusedGroup.hiddenChildren,
              focusedGroup.totalChildren,
            )}{' '}
            of {numberFormat(focusedGroup.totalChildren)}.
          </p>
          <div className="csv-navigation-actions">
            <button disabled={!analysis.offset} onClick={() => onPage('previous')}>
              Previous groups
            </button>
            <button
              disabled={
                analysis.offset + focusedGroup.totalChildren - focusedGroup.hiddenChildren >=
                focusedGroup.totalChildren
              }
              onClick={() => onPage('next')}
            >
              Next groups
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function numberFormat(value: number) {
  return new Intl.NumberFormat().format(value);
}
