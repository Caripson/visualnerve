import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { lazy, useEffect, useState } from 'react';
import type { Graph, GraphNode } from '../model/types';
import type { CsvAnalysis, CsvNodeData, CsvPathEntry } from '../data/types';
import { getCsvAnalysis, getCsvNode } from '../data/csv';
import { previewCsvRows } from '../data/client';
import { useEditor } from '../state/editor';
import { formatCsvMeasure } from './MetricSummary';
import './csv-properties.css';
import { LazyDialogBoundary } from './LazyDialogBoundary';
import { settleWorkspaceBeforeReload } from '../ui/settle-workspace-reload';
import { analysisForDataset, datasetForNode } from '../data/model';

const MeasureExplanationDialog = lazy(() =>
  import('./MeasureExplanationDialog').then((module) => ({
    default: module.MeasureExplanationDialog,
  })),
);

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
  const { t, number: numberFormat } = useI18n();
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
      <section className="csv-properties" aria-label={t('data.csvProperties.title')}>
        <div className="property-section">{t('data.csvProperties.title')}</div>
        <p className="csv-source-name">{dataset!.fileName}</p>
        <p className="muted">
          {t('data.csvProperties.sourceCounts', {
            rows: numberFormat(dataset!.rows.length),
            columns: dataset!.columns.length,
          })}
        </p>
        {analysis && (
          <p className="csv-grouping-path">
            {t('data.csvProperties.groupedBy', {
              path:
                analysis.levels
                  .map((id) => dataset!.columns.find((column) => column.id === id)?.label ?? id)
                  .join(' → ') || t('data.csvProperties.allRows'),
            })}
          </p>
        )}
        {focusedGroup && (
          <p className="muted">
            {t('data.csvProperties.matchingRows', { count: numberFormat(focusedGroup.rowCount) })}
          </p>
        )}
        {navigation}
        {onEditCsv && (
          <button className="full" onClick={() => onEditCsv(dataset?.id)}>
            {t('data.csvProperties.editAnalysis')}
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
    <section className="csv-properties" aria-label={t('data.csvProperties.groupRegion')}>
      <div className="property-section">{t('data.csvProperties.measuresTitle')}</div>
      <p className="muted">
        {t('data.csvProperties.groupRows', { count: numberFormat(data!.rowCount) })}
      </p>
      {data!.hiddenChildren > 0 && (
        <p className="csv-group-notice">
          {t('data.csvProperties.hiddenGroupsIncluded', {
            groups: numberFormat(data!.hiddenChildren),
            rows: numberFormat(data!.rowCount),
          })}
        </p>
      )}
      {navigation}
      {sourceAvailable && onEditCsv && (
        <button className="full" onClick={() => onEditCsv(dataset?.id)}>
          {t('data.csvProperties.editAnalysis')}
        </button>
      )}
      <div className="csv-measure-controls">
        {data!.measures.map((measure) => (
          <div className="csv-measure-control" key={measure.id}>
            <label className="check-field">
              <input
                type="checkbox"
                aria-label={t('data.csvProperties.showMeasure', { label: measure.label })}
                checked={!hidden.has(measure.id)}
                onChange={(event) => {
                  const next = new Set(hidden);
                  if (event.target.checked) next.delete(measure.id);
                  else next.add(measure.id);
                  edit({ hiddenMetricIds: [...next] });
                }}
              />
              <span>{measure.label}</span>
              <b>{formatCsvMeasure(measure.value, numberFormat)}</b>
            </label>
            {sourceAvailable &&
              data!.visible !== false &&
              analysis?.metrics.some((metric) => metric.id === measure.id) && (
                <button
                  className="quiet"
                  aria-label={t('data.csvProperties.explainMeasure', { label: measure.label })}
                  onClick={() => setExplainId(measure.id)}
                >
                  {t('data.csvProperties.explainValue')}
                </button>
              )}
            {(measure.missingCount > 0 || measure.invalidCount > 0) && (
              <small className="csv-measure-quality">
                {t('data.csvProperties.invalidCounts', {
                  empty: measure.missingCount,
                  invalid: measure.invalidCount,
                })}
              </small>
            )}
          </div>
        ))}
      </div>
      <p className="csv-measure-help muted">{t('data.csvProperties.measureInvariants')}</p>
      {sourceAvailable ? (
        <details
          className="csv-source-rows"
          aria-busy={sourceBusy}
          onToggle={(event) => setSourceOpen(event.currentTarget.open)}
        >
          <summary>
            {t('data.csvProperties.sourceRowsSummary', { count: numberFormat(data!.rowCount) })}
          </summary>
          <details className="csv-source-columns">
            <summary>
              {t('data.csvProperties.columnsSummary', { count: visibleColumns.length })}
            </summary>
            <div className="csv-column-controls">
              {dataset!.columns.map((column) => (
                <label className="check-field" key={column.id}>
                  <input
                    type="checkbox"
                    aria-label={t('data.csvProperties.showColumn', { label: column.label })}
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
                  aria-label={t('data.csv.originalValues')}
                  checked={originalValues}
                  onChange={(event) => setOriginalValues(event.target.checked)}
                />
                {t('data.csv.originalValues')}
              </label>
              {sourceBusy && (
                <p className="muted" role="status">
                  {t('data.csvProperties.loadingRows')}
                </p>
              )}
              {sourceError && (
                <p className="form-error" role="alert">
                  {localizedFeedback(sourceError, t)}
                </p>
              )}
              {preview && (
                <>
                  <p className="muted">
                    {t('data.csvProperties.shownRows', {
                      shown: preview.rows.length,
                      total: numberFormat(preview.total),
                    })}
                    {originalValues
                      ? t('data.csvProperties.originalNotice')
                      : t('data.csvProperties.cleanedNotice')}
                  </p>
                  {visibleColumns.length ? (
                    <div
                      className="csv-table-scroll"
                      tabIndex={0}
                      aria-label={t('data.csvProperties.scrollRows')}
                    >
                      <table
                        className="csv-source-table"
                        aria-label={t('data.csvProperties.rowsAccessible')}
                      >
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
                    <p className="muted">{t('data.csvProperties.noColumns')}</p>
                  )}
                </>
              )}
            </>
          )}
        </details>
      ) : (
        <p className="muted">{t('data.csvProperties.sourceUnavailable')}</p>
      )}
      {explainId && dataset && analysis && (
        <LazyDialogBoundary
          close={() => setExplainId(undefined)}
          beforeReload={settleWorkspaceBeforeReload}
        >
          <MeasureExplanationDialog
            model={graph}
            dataset={dataset}
            analysis={analysis}
            path={data!.path}
            metricId={explainId}
            onClose={() => setExplainId(undefined)}
          />
        </LazyDialogBoundary>
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
  const { t, number: numberFormat } = useI18n();
  return (
    <div className="csv-navigation">
      {onFocus && (
        <div className="csv-navigation-actions">
          <button onClick={() => onFocus([])}>{t('data.csv.allData')}</button>
          {group && group.path.length > 0 && (
            <button onClick={() => onFocus(group.path)}>
              {t('data.csvProperties.exploreGroup')}
            </button>
          )}
        </div>
      )}
      {analysis && focusedGroup && onPage && focusedGroup.hiddenChildren > 0 && (
        <>
          <p className="muted">
            {t('data.csvProperties.groupRange', {
              first: Math.min(analysis.offset + 1, focusedGroup.totalChildren),
              last: Math.min(
                analysis.offset + focusedGroup.totalChildren - focusedGroup.hiddenChildren,
                focusedGroup.totalChildren,
              ),
              total: numberFormat(focusedGroup.totalChildren),
            })}
          </p>
          <div className="csv-navigation-actions">
            <button disabled={!analysis.offset} onClick={() => onPage('previous')}>
              {t('data.csvProperties.previousGroups')}
            </button>
            <button
              disabled={
                analysis.offset + focusedGroup.totalChildren - focusedGroup.hiddenChildren >=
                focusedGroup.totalChildren
              }
              onClick={() => onPage('next')}
            >
              {t('data.csvProperties.nextGroups')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
