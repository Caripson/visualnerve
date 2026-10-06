import { useEffect, useMemo, useState } from 'react';
import type { Graph } from '../model/types';
import { graphDatasets, analysisForDataset } from '../data/model';
import { QualityClient } from '../data/qualityClient';
import type { EvidencePage, QualityOptions, QualityReport } from '../data/quality';
import { getSqlRelationship, getSqlTable } from '../sql/schema';
import { Modal } from './Modal';
import { DataEvidence, RelatedDataScope } from './DataEvidence';

export function DataQualityDialog({ graph, onClose }: { graph: Graph; onClose(): void }) {
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
  const external = sqlNodes.filter((node) => getSqlTable(node)!.external);
  const unresolved = graph.edges.filter((edge) => getSqlRelationship(edge)?.unresolved);
  return (
    <Modal title="Data quality" close={onClose} wide>
      <div className="data-inspection" aria-busy={busy}>
        {dataset && (
          <>
            <label className="field">
              <span>Source</span>
              <select
                aria-label="Quality source"
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
              <summary>Check identity keys</summary>
              <p className="muted">
                Choose columns expected to identify one row. Repeated keys can be valid in order or
                transaction data; this check does not remove anything.
              </p>
              <div className="data-inspection-key-columns">
                {dataset.columns.map((column) => (
                  <label className="check-field" key={column.id}>
                    <input
                      type="checkbox"
                      aria-label={`Identity key ${column.label}`}
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
            {busy && <p role="status">Inspecting data…</p>}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {report && (
              <>
                <RelatedDataScope graph={graph} />
                <p>
                  {report.matchingRows.toLocaleString()} rows in the current filters and focus ·{' '}
                  {report.sourceRows.toLocaleString()} source rows.
                </p>
                <p className="muted">
                  Numeric checks use columns in numeric measures or an explicit number format.
                  Cleanup collisions flag different original names that now look identical.
                  Reference checks use the entire target file. A row can appear in several checks.
                </p>
                {!report.issues.length && <p>No issues found by the configured checks.</p>}
                <div className="data-inspection-issues" aria-label="Quality checks">
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
                        {entry.label}
                        {entry.groups !== undefined
                          ? ` (${entry.groups.toLocaleString()} groups)`
                          : ''}
                      </span>
                      <b>{entry.count.toLocaleString()} rows</b>
                    </button>
                  ))}
                </div>
                {issue && page && (
                  <>
                    <h3>{issue.label}</h3>
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
          <section aria-label="SQL quality checks">
            <h3>SQL schema checks</h3>
            <p>
              {sqlNodes.length} tables · {external.length} referenced tables without a definition ·{' '}
              {unresolved.length} relationships with unknown referenced columns.
            </p>
            <p className="muted">
              These are schema diagnostics. SQL imports contain no table rows, so duplicate values
              and numeric data cannot be checked.
            </p>
            {external.map((node) => (
              <p key={node.id}>
                {getSqlTable(node)!.qualifiedName.join('.')}: definition missing from the imported
                script.
              </p>
            ))}
            {unresolved.map((edge) => (
              <p key={edge.id}>
                {graph.nodes.find((node) => node.id === edge.sourceNodeId)?.title} →{' '}
                {graph.nodes.find((node) => node.id === edge.targetNodeId)?.title}: referenced
                columns unknown.
              </p>
            ))}
          </section>
        )}
        {!dataset && !sqlNodes.length && (
          <p>Import CSV data or a SQL schema to inspect its quality.</p>
        )}
      </div>
    </Modal>
  );
}
