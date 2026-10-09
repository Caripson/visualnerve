import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useEditor } from '../state/editor';
import type { Base, Graph } from '../model/types';
import type { CsvDataset } from '../data/types';
import { openCsvFile } from '../data/client';
import { currentImportLimitBytes } from '../imports/preference';
import { defaultAnalysis } from '../data/csv';
import {
  graphDatasets,
  removeDataModelSource,
  setAnalysisForDataset,
  type CsvRelationshipPreview,
  type CsvSourceRelationship,
} from '../data/model';
import { previewCsvRelationshipAsync, reanalyzeDataModelAsync } from '../data/modelClient';
import './data-sources.css';

const content = <T extends Base>(value: T) => {
  const { version: _version, updatedAt: _updatedAt, ...fields } = value;
  return fields;
};
function sameSource(a: CsvDataset, b: CsvDataset) {
  if (a === b) return true;
  if (a.rows !== b.rows) return false;
  const { rows: _aRows, ...aSchema } = content(a);
  const { rows: _bRows, ...bSchema } = content(b);
  return JSON.stringify(aSchema) === JSON.stringify(bSchema);
}
function sameBaseline(a: Graph, b: Graph) {
  if (a === b) return true;
  const sources = graphDatasets(a),
    previous = graphDatasets(b);
  if (
    sources.length !== previous.length ||
    sources.some((source, index) => !sameSource(source, previous[index]))
  )
    return false;
  const canonical = (graph: Graph) => {
    const { dataset: _primary, datasets: _additional, ...light } = graph;
    // Viewport movement is automatic on initial fit. Entity order is derived
    // from the arrays compared below; committed revisions carry no user data.
    const {
      viewport: _viewport,
      viewportDevice: _device,
      entityOrder: _order,
      ...settings
    } = graph.diagram.settings;
    return {
      ...light,
      diagram: { ...content(graph.diagram), settings },
      nodes: graph.nodes.map(content),
      edges: graph.edges.map(content),
      owners: graph.owners.map(content),
    };
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function rebaseResult(result: Graph, current: Graph): Graph {
  const revisions = <T extends Base>(items: T[], existing: T[]) => {
    const index = new Map(existing.map((item) => [item.id, item]));
    return items.map((item) => {
      const saved = index.get(item.id);
      return saved
        ? {
            ...item,
            version: saved.version,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
          }
        : item;
    });
  };
  const sources = new Map(graphDatasets(current).map((source) => [source.id, source]));
  const source = (value: CsvDataset) => {
    const saved = sources.get(value.id);
    return saved && sameSource(value, saved) ? saved : value;
  };
  return {
    ...result,
    dataset: result.dataset ? source(result.dataset) : undefined,
    datasets: result.datasets?.map(source),
    nodes: revisions(result.nodes, current.nodes),
    edges: revisions(result.edges, current.edges),
    owners: current.owners,
    diagram: {
      ...result.diagram,
      version: current.diagram.version,
      createdAt: current.diagram.createdAt,
      updatedAt: current.diagram.updatedAt,
      settings: {
        ...result.diagram.settings,
        viewport: current.diagram.settings.viewport,
        viewportDevice: current.diagram.settings.viewportDevice,
      },
    },
  };
}

export function DataSourcesDialog({
  onClose,
  initialFiles,
}: {
  onClose: () => void;
  initialFiles?: File[];
}) {
  const { t, number } = useI18n();
  const initial = useRef(useEditor.getState().graph);
  const [draft, setDraft] = useState<Graph | null>(initial.current);
  const [relationship, setRelationship] = useState<CsvSourceRelationship | null>(null);
  const [preview, setPreview] = useState<CsvRelationshipPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const close = useCallback(() => {
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
  const addFiles = useCallback(
    async (files: File[]) => {
      const graph = draftRef.current;
      if (!graph || !files.length) return;
      cancel();
      const current = generation.current;
      const byteLimit = currentImportLimitBytes();
      setWorking(true);
      setError('');
      setPreview(null);
      try {
        let next = graph;
        if (graphDatasets(next).length + files.length > 8)
          throw new Error('A diagram supports up to 8 CSV sources.');
        for (const file of files) {
          const parsed = await openCsvFile(file, byteLimit);
          if (!mounted.current || current !== generation.current) return;
          const dataset = { ...parsed, diagramId: graph.diagram.id };
          next = {
            ...next,
            ...(!next.dataset
              ? { dataset, datasets: next.datasets ?? [] }
              : { datasets: [...(next.datasets ?? []), dataset] }),
          };
          next = setAnalysisForDataset(next, dataset.id, defaultAnalysis(dataset));
        }
        next = {
          ...next,
          diagram: {
            ...next.diagram,
            settings: {
              ...next.diagram.settings,
              csvDatasetOrder: graphDatasets(next).map((source) => source.id),
            },
          },
        };
        setDraft(next);
        draftRef.current = next;
        setDirty(true);
      } catch (error) {
        if (mounted.current && current === generation.current) setError((error as Error).message);
      } finally {
        if (mounted.current && current === generation.current) setWorking(false);
      }
    },
    [cancel],
  );
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && initialFiles?.length) {
      started.current = true;
      void addFiles(initialFiles);
    }
  }, [initialFiles, addFiles]);
  if (!draft) return null;
  const sources = graphDatasets(draft);
  const source = sources.find((source) => source.id === relationship?.sourceDatasetId);
  const target = sources.find((source) => source.id === relationship?.targetDatasetId);
  const choose = (update: Partial<CsvSourceRelationship>) => {
    cancel();
    setWorking(false);
    setPreview(null);
    setError('');
    setRelationship((previous) => (previous ? { ...previous, ...update } : null));
  };
  const beginRelationship = () => {
    const [a, b] = sources;
    if (!a || !b) return;
    setRelationship({
      id: crypto.randomUUID(),
      sourceDatasetId: a.id,
      sourceColumnId: a.columns[0].id,
      targetDatasetId: b.id,
      targetColumnId: b.columns[0].id,
      matchMode: 'trim',
    });
    setPreview(null);
    setError('');
  };
  const previewRelationship = async () => {
    if (!relationship) return;
    cancel();
    const current = generation.current,
      pending = new AbortController();
    controller.current = pending;
    setWorking(true);
    setPreview(null);
    setError('');
    try {
      const result = await previewCsvRelationshipAsync(draft, relationship, {
        signal: pending.signal,
      });
      if (mounted.current && current === generation.current) setPreview(result);
    } catch (error) {
      if (mounted.current && current === generation.current && !pending.signal.aborted)
        setError((error as Error).message);
    } finally {
      if (mounted.current && current === generation.current) setWorking(false);
    }
  };
  const addRelationship = () => {
    if (!relationship || !preview) return;
    const next = {
      ...draft,
      diagram: {
        ...draft.diagram,
        settings: {
          ...draft.diagram.settings,
          csvRelationships: [...(draft.diagram.settings.csvRelationships ?? []), relationship],
        },
      },
    };
    setDraft(next);
    draftRef.current = next;
    setDirty(true);
    setRelationship(null);
    setPreview(null);
  };
  const apply = async () => {
    cancel();
    const current = generation.current,
      pending = new AbortController();
    controller.current = pending;
    setWorking(true);
    setError('');
    try {
      const result = await reanalyzeDataModelAsync(draft, { signal: pending.signal });
      if (!mounted.current || current !== generation.current) return;
      const state = useEditor.getState();
      if (!state.graph || !initial.current || !sameBaseline(state.graph, initial.current))
        throw new Error(
          'The diagram changed while this dialog was open. Close and reopen Data sources before applying.',
        );
      state.command('Update data sources', (graph) => rebaseResult(result, graph));
      close();
    } catch (error) {
      if (mounted.current && current === generation.current && !pending.signal.aborted)
        setError((error as Error).message);
    } finally {
      if (mounted.current && current === generation.current) setWorking(false);
    }
  };
  return (
    <Modal title={t('data.sources.title')} close={close} wide>
      <div
        className="data-sources"
        aria-busy={working}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (working) return;
          const files = Array.from(event.dataTransfer.files).filter((file) =>
            /\.(csv|tsv)$/i.test(file.name),
          );
          if (files.length) void addFiles(files);
          else setError('Drop CSV or TSV files to add diagram sources.');
        }}
      >
        <p>{t('data.sources.independentTotals')}</p>
        <label className="field">
          {t('data.sources.addCsv')}
          <input
            aria-label={t('data.sources.addCsv')}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            multiple
            disabled={working || sources.length >= 8}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              void addFiles(files);
            }}
          />
        </label>
        <ul className="data-source-list">
          {sources.map((dataset) => (
            <li key={dataset.id}>
              <span>
                <strong>{dataset.name}</strong>
                <small>
                  {t('data.csvProperties.sourceCounts', {
                    rows: number(dataset.rows.length),
                    columns: dataset.columns.length,
                  })}
                  {dataset.id === draft.dataset?.id ? t('data.sources.primarySuffix') : ''}
                </small>
              </span>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  const next = removeDataModelSource(draft, dataset.id);
                  setDraft(next);
                  draftRef.current = next;
                  setRelationship(null);
                  setPreview(null);
                  setDirty(true);
                }}
              >
                {t('data.sources.removeSource', { name: dataset.name })}
              </button>
            </li>
          ))}
        </ul>
        <h3>{t('data.sources.relationshipsTitle')}</h3>
        {(draft.diagram.settings.csvRelationships ?? []).map((link) => {
          const a = sources.find((source) => source.id === link.sourceDatasetId),
            b = sources.find((source) => source.id === link.targetDatasetId);
          return (
            <div className="data-source-link" key={link.id}>
              <span>
                {a?.name}.{a?.columns.find((c) => c.id === link.sourceColumnId)?.label} → {b?.name}.
                {b?.columns.find((c) => c.id === link.targetColumnId)?.label}
              </span>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  const next = {
                    ...draft,
                    diagram: {
                      ...draft.diagram,
                      settings: {
                        ...draft.diagram.settings,
                        csvRelationships: draft.diagram.settings.csvRelationships?.filter(
                          (r) => r.id !== link.id,
                        ),
                      },
                    },
                  };
                  setDraft(next);
                  draftRef.current = next;
                  setDirty(true);
                }}
              >
                {t('data.sources.removeRelationship')}
              </button>
            </div>
          );
        })}
        {!relationship && (
          <button
            type="button"
            disabled={working || sources.length < 2}
            onClick={beginRelationship}
          >
            {t('data.sources.matchColumns')}
          </button>
        )}
        {relationship && (
          <fieldset disabled={working} className="data-source-matching">
            <legend>{t('data.sources.previewTitle')}</legend>
            <label className="field">
              {t('data.sources.fromSource')}
              <select
                aria-label={t('data.sources.sourceAccessible')}
                value={relationship.sourceDatasetId}
                onChange={(event) => {
                  const dataset = sources.find((s) => s.id === event.target.value)!;
                  choose({
                    sourceDatasetId: dataset.id,
                    sourceColumnId: dataset.columns[0].id,
                    ...(dataset.id === relationship.targetDatasetId
                      ? {
                          targetDatasetId: relationship.sourceDatasetId,
                          targetColumnId: relationship.sourceColumnId,
                        }
                      : {}),
                  });
                }}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('data.sources.fromColumn')}
              <select
                aria-label={t('data.sources.sourceColumnAccessible')}
                value={relationship.sourceColumnId}
                onChange={(event) => choose({ sourceColumnId: event.target.value })}
              >
                {source?.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('data.sources.toSource')}
              <select
                aria-label={t('data.sources.targetAccessible')}
                value={relationship.targetDatasetId}
                onChange={(event) => {
                  const dataset = sources.find((s) => s.id === event.target.value)!;
                  choose({
                    targetDatasetId: dataset.id,
                    targetColumnId: dataset.columns[0].id,
                    ...(dataset.id === relationship.sourceDatasetId
                      ? {
                          sourceDatasetId: relationship.targetDatasetId,
                          sourceColumnId: relationship.targetColumnId,
                        }
                      : {}),
                  });
                }}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('data.sources.toColumn')}
              <select
                aria-label={t('data.sources.targetColumnAccessible')}
                value={relationship.targetColumnId}
                onChange={(event) => choose({ targetColumnId: event.target.value })}
              >
                {target?.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('data.sources.matchValues')}
              <select
                aria-label={t('data.sources.matchModeAccessible')}
                value={relationship.matchMode ?? 'trim'}
                onChange={(event) =>
                  choose({ matchMode: event.target.value as CsvSourceRelationship['matchMode'] })
                }
              >
                <option value="trim">{t('data.sources.trimMode')}</option>
                <option value="exact">{t('data.sources.exactMode')}</option>
                <option value="case-insensitive">{t('data.sources.ignoreCaseMode')}</option>
              </select>
            </label>
            <button type="button" onClick={() => void previewRelationship()}>
              {t('data.sources.previewMatch')}
            </button>
            {preview && (
              <div className="data-match-preview" role="status">
                <strong>{preview.cardinality}</strong>
                <dl>
                  <dt>{t('data.sources.matchedSourceRows')}</dt>
                  <dd>
                    {number(preview.matchedSourceRows)} / {number(preview.sourceRows)}
                  </dd>
                  <dt>{t('data.sources.matchedTargetRows')}</dt>
                  <dd>
                    {number(preview.matchedTargetRows)} / {number(preview.targetRows)}
                  </dd>
                  <dt>{t('data.sources.unmatchedRows')}</dt>
                  <dd>
                    {number(preview.unmatchedSourceRows)} / {number(preview.unmatchedTargetRows)}
                  </dd>
                  <dt>{t('data.sources.missingKeys')}</dt>
                  <dd>
                    {number(preview.missingSourceRows)} / {number(preview.missingTargetRows)}
                  </dd>
                  <dt>{t('data.sources.duplicateKeys')}</dt>
                  <dd>
                    {number(preview.duplicateSourceKeys)} / {number(preview.duplicateTargetKeys)}
                  </dd>
                  <dt>{t('data.sources.rowPairs')}</dt>
                  <dd>{number(preview.matchedPairs)}</dd>
                </dl>
                <p>{t('data.sources.countEachRowOnce')}</p>
                <button type="button" onClick={addRelationship}>
                  {t('data.sources.addRelationship')}
                </button>
              </div>
            )}
          </fieldset>
        )}
        {error && (
          <p className="data-source-error" role="alert">
            {localizedFeedback(error, t)}
          </p>
        )}
        <div className="data-source-actions">
          <button type="button" onClick={close}>
            {working ? t('data.sources.cancel') : t('data.sources.close')}
          </button>
          <button
            className="primary"
            type="button"
            disabled={working || !dirty || !!relationship}
            onClick={() => void apply()}
          >
            {working ? t('data.sources.working') : t('data.sources.apply')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
