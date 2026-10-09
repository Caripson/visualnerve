import { qualityIssueLabel } from './data-ui-text';
import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import type { Graph } from '../model/types';
import { graphDatasets, analysisForDataset } from '../data/model';
import { QualityClient } from '../data/qualityClient';
import type { EvidencePage, QualityOptions, QualityReport } from '../data/quality';
import { getSqlQueryResult } from '../sql/query-schema';
import { SqlQueryQualityChecks } from './SqlQueryQualityChecks';
import { getSqlRelationship, getSqlTable } from '../sql/schema';
import { Modal } from './Modal';
import { DataEvidence, RelatedDataScope } from './DataEvidence';

export function DataQualityDialog({ graph, onClose }: { graph: Graph; onClose(): void }) {
  const { t, number } = useI18n();
  const datasets = useMemo(() => graphDatasets(graph), [graph]);
  const [sourceId, setSourceId] = useState(datasets[0]?.id ?? '');
  const dataset = datasets.find((source) => source.id === sourceId) ?? datasets[0];
  const analysis = dataset && analysisForDataset(graph, dataset.id);
  const client = useMemo(() => new QualityClient(), []);
  const [keys, setKeys] = useState<string[]>([]);
  const [report, setReport] = useState<QualityReport>();
  const [issueId, setIssueId] = useState('');
  const [offset, setOffset] = useState(0);
  const [original, setOriginal] = useState(false);
  const [page, setPage] = useState<EvidencePage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useMemo<QualityOptions>(() => {
    const relations = graph.diagram.settings.csvRelationships ?? [];
    return {
      keyColumns: keys,
      references: relations
        .filter((link) => link.sourceDatasetId === dataset?.id)
        .flatMap((link) => {
          const target = datasets.find((source) => source.id === link.targetDatasetId);
          const targetAnalysis = target && analysisForDataset(graph, target.id);
          return target && targetAnalysis
            ? [
                {
                  id: link.id,
                  label: `${dataset!.columns.find((column) => column.id === link.sourceColumnId)?.label} → ${target.name}: missing referenced keys`,
                  columnId: link.sourceColumnId,
                  target,
                  targetColumnId: link.targetColumnId,
                  targetAnalysis,
                  matchMode: link.matchMode,
                },
              ]
            : [];
        }),
    };
  }, [graph, datasets, dataset, keys]);
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    let active = true;
    setReport(undefined);
    setPage(undefined);
    setError('');
    if (!dataset || !analysis) return;
    setBusy(true);
    void client
      .request<QualityReport>({ operation: 'report', dataset, analysis, options, model: graph })
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client, dataset, analysis, options, graph]);
  useEffect(() => {
    let active = true;
    setPage(undefined);
    if (!dataset || !analysis || !issueId || !report) return;
    setBusy(true);
    void client
      .request<EvidencePage>({
        operation: 'evidence',
        dataset,
        analysis,
        options,
        issueId,
        offset,
        model: graph,
      })
      .then((value) => {
        if (active) setPage(value);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client, dataset, analysis, options, issueId, offset, report, graph]);
  const issue = report?.issues.find((entry) => entry.id === issueId);
  const sqlNodes = graph.nodes.filter((node) => !!getSqlTable(node));
  const hasQuery = graph.nodes.some((node) => !!getSqlQueryResult(node));
  const external = sqlNodes.filter((node) => getSqlTable(node)!.external);
  const unresolved = graph.edges.filter((edge) => getSqlRelationship(edge)?.unresolved);
  return (
    <Modal title={t('data.quality.title')} close={onClose} wide>
      <div className="data-inspection" aria-busy={busy}>
        {dataset && (
          <>
            <label className="field">
              <span>{t('data.quality.source')}</span>
              <select
                aria-label={t('data.quality.sourceAccessible')}
                value={dataset.id}
                onChange={(event) => {
                  setSourceId(event.target.value);
                  setKeys([]);
                  setIssueId('');
                  setOffset(0);
                }}
              >
                {datasets.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>{t('data.quality.identityTitle')}</summary>
              <p className="muted">{t('data.quality.identityExplanation')}</p>
              <div className="data-inspection-key-columns">
                {dataset.columns.map((column) => (
                  <label className="check-field" key={column.id}>
                    <input
                      type="checkbox"
                      aria-label={t('data.refresh.identityAccessible', { label: column.label })}
                      checked={keys.includes(column.id)}
                      onChange={(event) => {
                        setIssueId('');
                        setOffset(0);
                        setKeys(
                          event.target.checked
                            ? [...keys, column.id]
                            : keys.filter((id) => id !== column.id),
                        );
                      }}
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            </details>
            {busy && <p role="status">{t('data.quality.inspecting')}</p>}
            {error && (
              <p className="form-error" role="alert">
                {localizedFeedback(error, t)}
              </p>
            )}
            {report && (
              <>
                <RelatedDataScope graph={graph} />
                <p>
                  {t('data.quality.scopeCounts', {
                    matching: number(report.matchingRows),
                    source: number(report.sourceRows),
                  })}
                </p>
                <p className="muted">{t('data.quality.checkScope')}</p>
                {!report.issues.length && <p>{t('data.quality.noneFound')}</p>}
                <div
                  className="data-inspection-issues"
                  aria-label={t('data.quality.checksAccessible')}
                >
                  {report.issues.map((entry) => (
                    <button
                      key={entry.id}
                      className={entry.id === issueId ? 'active' : ''}
                      onClick={() => {
                        setIssueId(entry.id);
                        setOffset(0);
                      }}
                    >
                      <span>
                        {qualityIssueLabel(entry, dataset, t)}
                        {entry.groups !== undefined
                          ? t('data.quality.groupsSuffix', { count: number(entry.groups) })
                          : ''}
                      </span>
                      <b>{t('data.quality.rowCount', { count: number(entry.count) })}</b>
                    </button>
                  ))}
                </div>
                {issue && page && (
                  <>
                    <h3>{qualityIssueLabel(issue, dataset, t)}</h3>
                    <DataEvidence
                      dataset={dataset}
                      page={page}
                      originalValues={original}
                      onOriginalChange={setOriginal}
                      onPage={setOffset}
                      highlight={issue.columnId}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
        {!!sqlNodes.length && (
          <section aria-label={t('data.quality.sqlAccessible')}>
            <h3>{t('data.quality.sqlTitle')}</h3>
            <p>
              {t('data.quality.sqlCounts', {
                tables: sqlNodes.length,
                external: external.length,
                unresolved: unresolved.length,
              })}
            </p>
            <p className="muted">{t('data.quality.noSqlRows')}</p>
            {external.map((node) => (
              <p key={node.id}>
                {t('data.quality.definitionMissing', {
                  qualifiedName: getSqlTable(node)!.qualifiedName.join('.'),
                })}
              </p>
            ))}
            {unresolved.map((edge) => (
              <p key={edge.id}>
                {t('data.quality.columnsUnknown', {
                  source: graph.nodes.find((node) => node.id === edge.sourceNodeId)?.title ?? '',
                  target: graph.nodes.find((node) => node.id === edge.targetNodeId)?.title ?? '',
                })}
              </p>
            ))}
          </section>
        )}
        <SqlQueryQualityChecks graph={graph} />
        {!dataset && !sqlNodes.length && !hasQuery && <p>{t('data.quality.importFirst')}</p>}
      </div>
    </Modal>
  );
}
