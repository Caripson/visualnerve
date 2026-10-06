import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assertImportBytes, utf8Bytes } from '../imports/limits';
import { currentImportLimitBytes } from '../imports/preference';
import { ImportSizeNotice } from './ImportSizeNotice';
import { Modal } from './Modal';
import { useEditor } from '../state/editor';
import { workspace } from '../storage/workspace';
import type { Graph } from '../model/types';
import type { CsvDataset } from '../data/types';
import { graphDatasets } from '../data/model';
import { getSqlTable } from '../sql/schema';
import {
  defaultColumnMap,
  type RemovedSourcePolicy,
  type SourceRefreshResult,
} from '../data/refresh';
import { loadRefreshCsv, previewCsvRefresh, previewSqlRefresh } from '../data/refreshClient';
import './source-refresh.css';

type Capture = { graph: Graph; revision: number; generation: number };
const readable = (error: unknown) =>
  error instanceof Error ? error.message : 'Source refresh failed.';
const number = (value: number) => value.toLocaleString();

export function SourceRefreshDialog({ onClose }: { onClose: () => void }) {
  const graph = useEditor((state) => state.graph);
  const revision = useEditor((state) => state.editRevision);
  const initialDiagramId = useRef(graph?.diagram.id);
  const sources = graph ? graphDatasets(graph) : [];
  const hasSql = graph?.nodes.some((node) => getSqlTable(node)) ?? false;
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? 'sql');
  const source = sources.find((dataset) => dataset.id === sourceId);
  const [incoming, setIncoming] = useState<CsvDataset>();
  const [sql, setSql] = useState('');
  const [sourceBytes, setSourceBytes] = useState(0);
  const displayedBytes = useMemo(
    () => (sourceId === 'sql' ? utf8Bytes(sql) : sourceBytes),
    [sourceId, sql, sourceBytes],
  );
  const [keys, setKeys] = useState<string[]>(
    () =>
      (graph?.diagram.settings.csvRefreshKeys as Record<string, string[]> | undefined)?.[
        sources[0]?.id
      ] ?? [],
  );
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [policy, setPolicy] = useState<RemovedSourcePolicy>('retain');
  const [result, setResult] = useState<SourceRefreshResult>();
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const mounted = useRef(true);
  const capture = useRef<Capture | undefined>(undefined);
  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = undefined;
    capture.current = undefined;
  }, []);
  const invalidate = () => {
    cancel();
    setResult(undefined);
    setWorking(false);
    setLoading(false);
    setError('');
  };
  const dismiss = useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  useEffect(() => {
    if (graph?.diagram.id !== initialDiagramId.current) {
      cancel();
      setWorking(false);
      setLoading(false);
      setResult(undefined);
      setError(
        'The open diagram changed. Close this dialog and refresh the source in the intended diagram.',
      );
      return;
    }
    const prior = capture.current;
    if (!prior || applying) return;
    if (
      graph?.diagram.id !== prior.graph.diagram.id ||
      graph.diagram.version !== prior.graph.diagram.version ||
      revision !== prior.revision
    ) {
      cancel();
      setWorking(false);
      setLoading(false);
      setResult(undefined);
      setError('The diagram changed during source review. Preview changes again before applying.');
    }
  }, [graph?.diagram.id, graph?.diagram.version, revision, applying, cancel]);

  const load = async (file: File) => {
    invalidate();
    setSourceBytes(0);
    if (sourceId !== 'sql') {
      setIncoming(undefined);
      setMapping({});
    }
    const byteLimit = currentImportLimitBytes();
    try {
      assertImportBytes(file.size, byteLimit, 'Source file');
    } catch (error) {
      setError(readable(error));
      return;
    }
    setSourceBytes(file.size);
    const current = generation.current;
    const pending = new AbortController();
    controller.current = pending;
    setWorking(true);
    setLoading(true);
    try {
      if (sourceId === 'sql') {
        const text = await file.text();
        if (mounted.current && current === generation.current) setSql(text);
      } else {
        const replacement = await loadRefreshCsv(file, { signal: pending.signal, byteLimit });
        if (!mounted.current || current !== generation.current) return;
        setIncoming(replacement);
        setMapping(defaultColumnMap(source!, replacement));
      }
    } catch (error) {
      if (mounted.current && current === generation.current && !pending.signal.aborted)
        setError(readable(error));
    } finally {
      if (mounted.current && current === generation.current) {
        setWorking(false);
        setLoading(false);
        controller.current = undefined;
      }
    }
  };
  const preview = async () => {
    if (working || applying || (!source && sourceId !== 'sql')) return;
    invalidate();
    const current = generation.current;
    const pending = new AbortController();
    controller.current = pending;
    setWorking(true);
    const byteLimit = currentImportLimitBytes();
    try {
      await workspace.settled();
      if (current !== generation.current || !mounted.current) return;
      const state = useEditor.getState();
      if (!state.graph || state.graph.diagram.id !== initialDiagramId.current)
        throw new Error('Open this diagram before refreshing its source.');
      const snapshot: Capture = {
        graph: state.graph,
        revision: state.editRevision,
        generation: current,
      };
      capture.current = snapshot;
      const changes =
        sourceId === 'sql'
          ? await previewSqlRefresh(snapshot.graph, sql, policy, {
              signal: pending.signal,
              byteLimit,
            })
          : await previewCsvRefresh(
              snapshot.graph,
              incoming!,
              {
                datasetId: sourceId,
                keyColumnIds: keys,
                columnMap: mapping,
                removedPolicy: policy,
              },
              { signal: pending.signal },
            );
      const latest = useEditor.getState();
      if (!mounted.current || current !== generation.current || pending.signal.aborted) return;
      if (
        latest.graph?.diagram.id !== snapshot.graph.diagram.id ||
        latest.graph.diagram.version !== snapshot.graph.diagram.version ||
        latest.editRevision !== snapshot.revision
      )
        throw new Error('The diagram changed during analysis. Preview changes again.');
      setResult(changes);
    } catch (error) {
      if (mounted.current && current === generation.current && !pending.signal.aborted) {
        setError(readable(error));
        capture.current = undefined;
      }
    } finally {
      if (mounted.current && current === generation.current) {
        setWorking(false);
        controller.current = undefined;
      }
    }
  };
  const apply = async () => {
    if (!result || !capture.current || working || applying) return;
    const snapshot = capture.current;
    setApplying(true);
    setError('');
    try {
      await workspace.settled();
      const state = useEditor.getState();
      if (
        state.graph?.diagram.id !== snapshot.graph.diagram.id ||
        state.graph.diagram.version !== snapshot.graph.diagram.version ||
        state.editRevision !== snapshot.revision ||
        generation.current !== snapshot.generation
      )
        throw new Error('The diagram changed. Preview changes again before applying.');
      state.command('Refresh source', () => result.graph);
      const applied = useEditor.getState();
      const nodeIds = new Set(applied.graph?.nodes.map((node) => node.id));
      const edgeIds = new Set(applied.graph?.edges.map((edge) => edge.id));
      const selectedNodes = applied.selectedNodes.filter((id) => nodeIds.has(id));
      const selectedEdges = applied.selectedEdges.filter((id) => edgeIds.has(id));
      if (
        selectedNodes.length !== applied.selectedNodes.length ||
        selectedEdges.length !== applied.selectedEdges.length
      )
        applied.select(selectedNodes, selectedEdges);
      await workspace.settled();
      const saved = useEditor.getState();
      if (saved.status === 'error' || saved.status === 'conflict')
        throw new Error(saved.message || 'The refreshed source could not be saved.');
      if (mounted.current) dismiss();
    } catch (error) {
      if (mounted.current) {
        setError(readable(error));
        setResult(undefined);
        capture.current = undefined;
        setApplying(false);
      }
    }
  };
  if (!graph) return null;
  const ready =
    graph.diagram.id === initialDiagramId.current &&
    (sourceId === 'sql' ? !!sql.trim() : !!source && !!incoming && keys.length > 0);
  const summary = result?.summary;
  return (
    <Modal title="Refresh source" close={dismiss} wide dismissible={!applying}>
      <div className="source-refresh" aria-busy={working || applying}>
        <p className="source-refresh-intro">
          Review changes before replacing source data. Matching objects retain their IDs, positions,
          notes, status and manual connections. SQL is parsed locally and never executed.
        </p>
        <ImportSizeNotice bytes={displayedBytes} />
        <label className="field">
          Source to refresh
          <select
            aria-label="Source to refresh"
            value={sourceId}
            disabled={applying}
            onChange={(event) => {
              invalidate();
              const id = event.target.value;
              setSourceId(id);
              setIncoming(undefined);
              setSourceBytes(0);
              setSql('');
              setMapping({});
              setKeys(
                (graph.diagram.settings.csvRefreshKeys as Record<string, string[]> | undefined)?.[
                  id
                ] ?? [],
              );
            }}
          >
            {sources.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} · {dataset.fileName}
              </option>
            ))}
            {hasSql && <option value="sql">SQL schema</option>}
          </select>
        </label>
        <label className="field">
          Replacement source file
          <input
            aria-label="Replacement source file"
            type="file"
            accept={sourceId === 'sql' ? '.sql,.ddl' : '.csv'}
            disabled={applying}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void load(file);
            }}
          />
        </label>
        {sourceId === 'sql' ? (
          <label className="field">
            Replacement SQL script
            <textarea
              aria-label="Replacement SQL script"
              rows={8}
              value={sql}
              disabled={applying}
              spellCheck={false}
              onChange={(event) => {
                invalidate();
                setSql(event.target.value);
              }}
            />
          </label>
        ) : (
          source && (
            <>
              {incoming && (
                <p className="muted">
                  {incoming.fileName} · {number(incoming.rows.length)} replacement rows ·{' '}
                  {incoming.columns.length} columns
                </p>
              )}
              <fieldset>
                <legend>Identity keys</legend>
                <p>
                  Choose one or more stable columns that uniquely identify every row in both files.
                  Empty or duplicate keys block refresh. Keys use trimmed original cells.
                </p>
                <div className="source-key-columns">
                  {source.columns.map((column) => (
                    <label key={column.id} className="check-field">
                      <input
                        type="checkbox"
                        aria-label={`Identity key ${column.label}`}
                        checked={keys.includes(column.id)}
                        disabled={applying || loading}
                        onChange={(event) => {
                          invalidate();
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
              </fieldset>
              {incoming && (
                <details className="source-column-map" open>
                  <summary>Map replacement columns</summary>
                  <p>
                    Matching labels keep existing column IDs. Map renamed headers explicitly;
                    columns used by analyses, relationships or saved views must remain mapped.
                  </p>
                  {source.columns.map((column) => (
                    <label className="field source-map-row" key={column.id}>
                      {column.label}
                      <select
                        aria-label={`Replacement column for ${column.label}`}
                        value={mapping[column.id] ?? ''}
                        disabled={applying || loading}
                        onChange={(event) => {
                          invalidate();
                          setMapping({ ...mapping, [column.id]: event.target.value || null });
                        }}
                      >
                        <option value="">Column removed</option>
                        {incoming.columns.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </details>
              )}
            </>
          )
        )}
        <label className="field">
          Removed source objects
          <select
            aria-label="Removed source objects"
            value={policy}
            disabled={applying || loading}
            onChange={(event) => {
              invalidate();
              setPolicy(event.target.value as RemovedSourcePolicy);
            }}
          >
            <option value="retain">Keep as annotations</option>
            <option value="remove">Remove objects and attached connections</option>
          </select>
        </label>
        <p className="source-removal-note">
          {policy === 'retain'
            ? 'Removed objects remain visible as annotations without live source bindings. CSV measures become snapshots; obsolete SQL foreign keys become manual annotation links. Existing manual connections and the drawing layer are retained.'
            : 'Removed objects and every connection attached to them will be deleted. Matching objects, their manual connections and the drawing layer are retained.'}
        </p>
        {working && <p role="status">Preparing source changes…</p>}
        {error && (
          <p role="alert" className="source-refresh-error">
            {error}
          </p>
        )}
        {summary && (
          <section className="source-change-preview" aria-label="Source changes preview">
            <h3>Review source changes</h3>
            <dl className="source-change-counts">
              {[
                [`${sourceId === 'sql' ? 'Tables' : 'Rows'} added`, summary.added],
                [`${sourceId === 'sql' ? 'Tables' : 'Rows'} changed`, summary.changed],
                [`${sourceId === 'sql' ? 'Tables' : 'Rows'} removed`, summary.removed],
                ['Unchanged', summary.unchanged],
                ['Columns added', summary.columnsAdded],
                ['Columns removed', summary.columnsRemoved],
                ['Objects added', summary.objectsAdded],
                ['Objects removed', summary.objectsRemoved],
                ['Annotations retained', summary.retainedAnnotations],
                ['Relationships added', summary.relationshipsAdded],
                ['Relationships changed', summary.relationshipsChanged],
                ['Relationships removed', summary.relationshipsRemoved],
                ['Manual connections affected', summary.affectedManualRelationships],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{number(value as number)}</dd>
                </div>
              ))}
            </dl>
            {!!summary.affectedManualRelationships && (
              <p>
                {policy === 'retain'
                  ? 'These manual connections remain attached to the retained annotations.'
                  : 'These manual connections will be deleted with the removed objects.'}
              </p>
            )}
            {summary.changes.length > 0 && (
              <ul aria-label="Source change samples">
                {summary.changes.slice(0, 50).map((change, index) => (
                  <li key={index}>
                    <b>{change.kind}</b> {change.label}
                  </li>
                ))}
              </ul>
            )}
            {summary.added + summary.changed + summary.removed > 50 && (
              <p>Showing at most 50 sample changes. Counts include the whole source.</p>
            )}
            {summary.warnings.length > 0 && (
              <div className="source-refresh-warnings">
                <h4>Review notes</h4>
                <ul>
                  {summary.warnings.slice(0, 20).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
                {summary.warnings.length > 20 && <p>{summary.warnings.length - 20} more notes.</p>}
              </div>
            )}
          </section>
        )}
        <div className="modal-actions source-refresh-actions">
          <button disabled={applying} onClick={dismiss}>
            Cancel
          </button>
          <button disabled={!ready || working || applying} onClick={() => void preview()}>
            Preview changes
          </button>
          <button
            className="primary"
            disabled={!result || working || applying || !!error}
            onClick={() => void apply()}
          >
            {applying ? 'Applying source refresh…' : 'Apply source refresh'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
