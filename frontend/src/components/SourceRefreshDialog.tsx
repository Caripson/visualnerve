import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { repository } from '../storage/repository';
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

export function SourceRefreshDialog({ onClose }: { onClose: () => void }) {
  const { t, number } = useI18n();
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
      if (!mounted.current || generation.current !== snapshot.generation) return;
      const state = useEditor.getState();
      if (
        state.graph?.diagram.id !== snapshot.graph.diagram.id ||
        state.graph.diagram.version !== snapshot.graph.diagram.version ||
        state.editRevision !== snapshot.revision ||
        generation.current !== snapshot.generation
      )
        throw new Error('The diagram changed. Preview changes again before applying.');
      await repository.history.create(snapshot.graph.diagram.id, {
        name: `Before source refresh · ${new Date().toLocaleString()}`,
        baseVersion: snapshot.graph.diagram.version,
        kind: 'source-refresh',
      });
      if (!mounted.current || generation.current !== snapshot.generation) return;
      const latest = useEditor.getState();
      if (
        latest.graph?.diagram.id !== snapshot.graph.diagram.id ||
        latest.editRevision !== snapshot.revision ||
        latest.graph.diagram.version !== snapshot.graph.diagram.version
      )
        throw new Error(
          'The diagram changed while preserving history. Preview changes again before applying.',
        );
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
    <Modal title={t('data.refresh.title')} close={dismiss} wide dismissible={!applying}>
      <div className="source-refresh" aria-busy={working || applying}>
        <p className="source-refresh-intro">{t('data.refresh.reviewBeforeReplace')}</p>
        <ImportSizeNotice bytes={displayedBytes} />
        <label className="field">
          {t('data.refresh.sourceLabel')}
          <select
            aria-label={t('data.refresh.sourceLabel')}
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
            {hasSql && <option value="sql">{t('import.sql.schemaChoice')}</option>}
          </select>
        </label>
        <label className="field">
          {t('data.refresh.fileLabel')}
          <input
            aria-label={t('data.refresh.fileLabel')}
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
            {t('data.refresh.sqlLabel')}
            <textarea
              aria-label={t('data.refresh.sqlLabel')}
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
                  {t('data.refresh.replacementCounts', {
                    fileName: incoming.fileName,
                    rows: number(incoming.rows.length),
                    columns: incoming.columns.length,
                  })}
                </p>
              )}
              <fieldset>
                <legend>{t('data.refresh.identityTitle')}</legend>
                <p>{t('data.refresh.identityUnique')}</p>
                <div className="source-key-columns">
                  {source.columns.map((column) => (
                    <label key={column.id} className="check-field">
                      <input
                        type="checkbox"
                        aria-label={t('data.refresh.identityAccessible', { label: column.label })}
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
                  <summary>{t('data.refresh.mappingTitle')}</summary>
                  <p>{t('data.refresh.mapInvariants')}</p>
                  {source.columns.map((column) => (
                    <label className="field source-map-row" key={column.id}>
                      {column.label}
                      <select
                        aria-label={t('data.refresh.replacementAccessible', {
                          label: column.label,
                        })}
                        value={mapping[column.id] ?? ''}
                        disabled={applying || loading}
                        onChange={(event) => {
                          invalidate();
                          setMapping({ ...mapping, [column.id]: event.target.value || null });
                        }}
                      >
                        <option value="">{t('data.refresh.columnRemoved')}</option>
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
          {t('data.refresh.removedLabel')}
          <select
            aria-label={t('data.refresh.removedLabel')}
            value={policy}
            disabled={applying || loading}
            onChange={(event) => {
              invalidate();
              setPolicy(event.target.value as RemovedSourcePolicy);
            }}
          >
            <option value="retain">{t('data.refresh.retainChoice')}</option>
            <option value="remove">{t('data.refresh.removeChoice')}</option>
          </select>
        </label>
        <p className="source-removal-note">
          {policy === 'retain'
            ? t('data.refresh.retainExplanation')
            : t('data.refresh.removeExplanation')}
        </p>
        {working && <p role="status">{t('data.refresh.preparing')}</p>}
        {error && (
          <p role="alert" className="source-refresh-error">
            {localizedFeedback(error, t)}
          </p>
        )}
        {summary && (
          <section
            className="source-change-preview"
            aria-label={t('data.refresh.previewAccessible')}
          >
            <h3>{t('data.refresh.reviewTitle')}</h3>
            <dl className="source-change-counts">
              {[
                [
                  t(sourceId === 'sql' ? 'data.refresh.tablesAdded' : 'data.refresh.rowsAdded'),
                  summary.added,
                ],
                [
                  t(sourceId === 'sql' ? 'data.refresh.tablesChanged' : 'data.refresh.rowsChanged'),
                  summary.changed,
                ],
                [
                  t(sourceId === 'sql' ? 'data.refresh.tablesRemoved' : 'data.refresh.rowsRemoved'),
                  summary.removed,
                ],
                [t('data.refresh.unchanged'), summary.unchanged],
                [t('data.refresh.columnsAdded'), summary.columnsAdded],
                [t('data.refresh.columnsRemoved'), summary.columnsRemoved],
                [t('data.refresh.objectsAdded'), summary.objectsAdded],
                [t('data.refresh.objectsRemoved'), summary.objectsRemoved],
                [t('data.refresh.annotationsRetained'), summary.retainedAnnotations],
                [t('data.refresh.relationshipsAdded'), summary.relationshipsAdded],
                [t('data.refresh.relationshipsChanged'), summary.relationshipsChanged],
                [t('data.refresh.relationshipsRemoved'), summary.relationshipsRemoved],
                [t('data.refresh.manualConnectionsAffected'), summary.affectedManualRelationships],
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
                  ? t('data.refresh.connectionsRetained')
                  : t('data.refresh.connectionsDeleted')}
              </p>
            )}
            {summary.changes.length > 0 && (
              <ul aria-label={t('data.refresh.samplesAccessible')}>
                {summary.changes.slice(0, 50).map((change, index) => (
                  <li key={index}>
                    <b>{change.kind}</b> {change.label}
                  </li>
                ))}
              </ul>
            )}
            {summary.added + summary.changed + summary.removed > 50 && (
              <p>{t('data.refresh.sampleBound')}</p>
            )}
            {summary.warnings.length > 0 && (
              <div className="source-refresh-warnings">
                <h4>{t('data.refresh.reviewNotes')}</h4>
                <ul>
                  {summary.warnings.slice(0, 20).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
                {summary.warnings.length > 20 && (
                  <p>{t('data.refresh.moreNotes', { count: summary.warnings.length - 20 })}</p>
                )}
              </div>
            )}
          </section>
        )}
        <div className="modal-actions source-refresh-actions">
          <button disabled={applying} onClick={dismiss}>
            {t('data.refresh.cancel')}
          </button>
          <button disabled={!ready || working || applying} onClick={() => void preview()}>
            {t('data.refresh.previewAction')}
          </button>
          <button
            className="primary"
            disabled={!result || working || applying || !!error}
            onClick={() => void apply()}
          >
            {applying ? t('data.refresh.applying') : t('data.refresh.applyAction')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
