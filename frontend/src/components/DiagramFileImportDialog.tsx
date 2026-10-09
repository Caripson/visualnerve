import { localizedFeedback } from './localized-feedback';
import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { DiagramFilePreview } from './DiagramFilePreview';
import { ImportSizeNotice } from './ImportSizeNotice';
import type { Graph } from '../model/types';
import type { DiagramImportResult } from '../imports/diagram/types';
import { parseDiagramFile } from '../imports/diagram/client';
import './diagram-file-import.css';

export function DiagramFileImportDialog({
  file,
  close,
  create,
}: {
  file: File;
  close: () => void;
  create: (graph: Graph) => Promise<void>;
}) {
  const { t, number } = useI18n();
  const [result, setResult] = useState<DiagramImportResult>();
  const [pageId, setPageId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const pending = new AbortController();
    controller.current = pending;
    setResult(undefined);
    setError('');
    void parseDiagramFile(file, { signal: pending.signal })
      .then((preview) => {
        if (pending.signal.aborted) return;
        setResult(preview);
        setPageId(preview.pages[0].id);
        setName(preview.pages[0].graph.diagram.name);
      })
      .catch((failure: Error) => {
        if (!pending.signal.aborted) setError(failure.message);
      });
    return () => pending.abort();
  }, [file]);
  const page = result?.pages.find((page) => page.id === pageId);
  const warnings = [...new Set([...(result?.warnings ?? []), ...(page?.warnings ?? [])])];
  const dismiss = () => {
    controller.current?.abort();
    close();
  };
  const save = async () => {
    if (!page || creating || !name.trim() || [...name].length > 500) return;
    setCreating(true);
    setError('');
    try {
      const graph = { ...page.graph, diagram: { ...page.graph.diagram, name: name.trim() } };
      await create(graph);
      close();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setCreating(false);
    }
  };
  return (
    <Modal title={t('import.diagramFile.title')} wide close={dismiss} dismissible={!creating}>
      <div className="diagram-file-import">
        <p className="muted">
          {file.name} · {/\.vsdx$/i.test(file.name) ? 'Visio' : 'draw.io'}
          <br />
          {t('import.diagramFile.localPageChoice')}
        </p>
        <ImportSizeNotice bytes={file.size} />
        {!result && !error && <p role="status">{t('import.diagramFile.reading')}</p>}
        {error && (
          <p role="alert" className="diagram-file-error">
            {localizedFeedback(error, t)}
          </p>
        )}
        {result && (
          <>
            <label className="field">
              <span>{t('import.diagramFile.pageLabel')}</span>
              <select
                aria-label={t('import.diagramFile.pageLabel')}
                value={pageId}
                disabled={creating}
                onChange={(event) => {
                  const next = result.pages.find((page) => page.id === event.target.value)!;
                  setPageId(next.id);
                  setName(next.graph.diagram.name);
                  setError('');
                }}
              >
                {result.pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {t('import.diagramFile.pageChoice', {
                      name: page.name,
                      objects: page.graph.nodes.length,
                      connections: page.graph.edges.length,
                    })}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('data.csv.nameLabel')}</span>
              <input
                aria-label={t('import.diagramFile.nameAccessible')}
                value={name}
                maxLength={500}
                disabled={creating}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {page && (
              <>
                <p className="diagram-file-counts">
                  {t('import.diagramFile.counts', {
                    objects: number(page.graph.nodes.length),
                    connections: number(page.graph.edges.length),
                  })}
                </p>
                <DiagramFilePreview graph={page.graph} />
              </>
            )}
            {warnings.length > 0 && (
              <details className="diagram-file-notices" open>
                <summary>{t('import.diagramFile.notices', { count: warnings.length })}</summary>
                <ul>
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="muted">{t('import.diagramFile.simplificationNotice')}</p>
          </>
        )}
        <div className="dialog-actions">
          <button onClick={dismiss} disabled={creating}>
            {t('data.action.cancel')}
          </button>
          <button
            className="primary"
            disabled={!page || creating || !name.trim() || [...name].length > 500}
            onClick={() => void save()}
          >
            {creating ? t('import.diagramFile.creating') : t('import.action.createDiagram')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
