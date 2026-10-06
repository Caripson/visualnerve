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
    <Modal title="Import diagram file" wide close={dismiss} dismissible={!creating}>
      <div className="diagram-file-import">
        <p className="muted">
          {file.name} · {/\.vsdx$/i.test(file.name) ? 'Visio' : 'draw.io'}
          <br />
          Choose a page to import as editable objects and connections. Your file stays in this
          browser.
        </p>
        <ImportSizeNotice bytes={file.size} />
        {!result && !error && <p role="status">Reading diagram pages…</p>}
        {error && (
          <p role="alert" className="diagram-file-error">
            {error}
          </p>
        )}
        {result && (
          <>
            <label className="field">
              <span>Diagram page</span>
              <select
                aria-label="Diagram page"
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
                    {page.name} ({page.graph.nodes.length} objects, {page.graph.edges.length}{' '}
                    connections)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Diagram name</span>
              <input
                aria-label="Imported diagram name"
                value={name}
                maxLength={500}
                disabled={creating}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {page && (
              <>
                <p className="diagram-file-counts">
                  {page.graph.nodes.length.toLocaleString()} objects ·{' '}
                  {page.graph.edges.length.toLocaleString()} connections
                </p>
                <DiagramFilePreview graph={page.graph} />
              </>
            )}
            {warnings.length > 0 && (
              <details className="diagram-file-notices" open>
                <summary>Import notices ({warnings.length})</summary>
                <ul>
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="muted">
              Shapes use Visual Nerve's native styles. Special stencils, pictures and custom line
              paths may be simplified. Other pages can be imported separately.
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button onClick={dismiss} disabled={creating}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!page || creating || !name.trim() || [...name].length > 500}
            onClick={() => void save()}
          >
            {creating ? 'Creating…' : 'Create diagram'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
