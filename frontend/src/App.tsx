import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ArrowUpRight, GitBranch, Plus, X, Menu } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Toolbar, FilterBar } from './components/Toolbar';
import { Properties } from './components/Properties';
import { Canvas } from './canvas/Canvas';
import { LocalBadge, PrivacyIntro, RestoreBackup } from './components/DataPrivacy';
import {
  NewDiagram,
  ExportDialog,
  OwnersDialog,
  SearchDialog,
  SettingsDialog,
  DeleteDialog,
  ConnectDialog,
} from './components/Dialogs';
import { useEditor } from './state/editor';
import { workspace } from './storage/workspace';
import { type WorkspaceBackup } from './storage/database';
import { parseImport } from './export/semantic';
import type { Clip } from './state/clipboard';
import type { Graph } from './model/types';
import { CsvImportDialog } from './components/CsvImportDialog';
import { analyzeCsv, openCsvFile } from './data/client';
import { getCsvAnalysis, getCsvNode } from './data/csv';
import type { CsvAnalysis, CsvDataset, CsvPathEntry } from './data/types';
export type DialogName = 'new' | 'export' | 'owners' | 'search' | 'settings' | 'delete' | 'connect';
export function App() {
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [ready, setReady] = useState(false);
  const [backup, setBackup] = useState<WorkspaceBackup | null>(null);
  const [csvDraft, setCsvDraft] = useState<{
    dataset: CsvDataset;
    previous?: Graph;
    file?: File;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const dragDepth = useRef(0);
  const importInFlight = useRef(false);
  const acknowledged = useEditor((state) => state.privacyAcknowledged);
  const inspectBackup = (data: WorkspaceBackup) => {
    setDialog(null);
    setBackup(data);
  };
  const [filters, setFilters] = useState(false);
  const theme = useEditor((state) => state.theme);
  const updateTheme = (value: string) => {
    void workspace
      .setPreference('theme', value)
      .catch((error) => useEditor.setState({ status: 'error', message: error.message }));
  };
  const graph = useEditor((s) => s.graph);
  const viewCounts = useMemo(() => {
    if (!graph) return { nodes: 0, edges: 0, hidden: 0 };
    if (!graph.dataset) return { nodes: graph.nodes.length, edges: graph.edges.length, hidden: 0 };
    const visible = new Set(
      graph.nodes.filter((node) => getCsvNode(node)?.visible !== false).map((node) => node.id),
    );
    return {
      nodes: visible.size,
      edges: graph.edges.filter(
        (edge) => visible.has(edge.sourceNodeId) && visible.has(edge.targetNodeId),
      ).length,
      hidden: graph.nodes.length - visible.size,
    };
  }, [graph]);
  const focusMap = useEditor((s) => s.focusMap);
  const mobilePanel = useEditor((s) => s.mobilePanel);
  const status = useEditor((s) => s.status);
  const message = useEditor((s) => s.message);
  const file = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setDialog(null), []);
  const open = useCallback((name: DialogName) => {
    document
      .querySelectorAll('details.quick-picker[open]')
      .forEach((picker) => picker.removeAttribute('open'));
    useEditor.setState({ mobilePanel: null });
    setDialog(name);
  }, []);
  const importFile = useCallback(async (picked: File) => {
    if (!useEditor.getState().privacyAcknowledged || importInFlight.current) return;
    importInFlight.current = true;
    setImporting(true);
    try {
      if (/\.csv$/i.test(picked.name)) {
        const dataset = await openCsvFile(picked);
        setDialog(null);
        setCsvDraft({ dataset, file: picked });
      } else {
        const format = /\.json$/i.test(picked.name) ? 'json' : 'markdown';
        const text = await picked.text();
        const json = format === 'json' ? JSON.parse(text) : undefined;
        if (json?.format === 'visual-nerve-workspace') inspectBackup(json as WorkspaceBackup);
        else {
          const data = parseImport(format, text);
          await workspace.create(data);
        }
      }
    } catch (error) {
      useEditor.setState({
        status: 'error',
        message: `Import failed: ${(error as Error).message}`,
      });
    } finally {
      importInFlight.current = false;
      setImporting(false);
    }
  }, []);

  const applyCsv = useCallback(
    async (dataset: CsvDataset, analysis: CsvAnalysis, name: string, previous?: Graph) => {
      if (importInFlight.current) throw new Error('Wait for the current data operation to finish.');
      importInFlight.current = true;
      try {
        if (!previous) {
          const generated = await analyzeCsv(dataset, analysis);
          generated.diagram = { ...generated.diagram, name };
          await workspace.create(generated);
          return;
        }
        await workspace.settled();
        const snapshot = useEditor.getState().graph;
        const revision = useEditor.getState().editRevision;
        if (!snapshot || snapshot.diagram.id !== previous.diagram.id)
          throw new Error('Open this data diagram before changing its view.');
        const generated = await analyzeCsv(dataset, analysis, snapshot);
        const current = useEditor.getState();
        if (
          current.graph?.diagram.id !== snapshot.diagram.id ||
          current.editRevision !== revision ||
          current.graph?.diagram.version !== snapshot.diagram.version
        )
          throw new Error('The diagram changed during analysis. Apply the data view again.');
        generated.diagram = { ...generated.diagram, name };
        current.command('Update CSV data view', () => generated);
        useEditor.setState({ selectedNodes: [], selectedEdges: [], focusNode: null });
        await workspace.settled();
        if (useEditor.getState().status === 'error' || useEditor.getState().status === 'conflict')
          throw new Error(useEditor.getState().message || 'The data view could not be saved.');
      } finally {
        importInFlight.current = false;
      }
    },
    [],
  );

  const navigateCsv = useCallback(
    async (patch: Partial<CsvAnalysis>) => {
      if (importInFlight.current) return;
      const current = useEditor.getState().graph;
      const analysis = current && getCsvAnalysis(current);
      if (!current?.dataset || !analysis) return;
      setImporting(true);
      try {
        await applyCsv(current.dataset, { ...analysis, ...patch }, current.diagram.name, current);
      } catch (error) {
        useEditor.setState({ status: 'error', message: (error as Error).message });
      } finally {
        setImporting(false);
      }
    },
    [applyCsv],
  );

  useEffect(() => {
    const isFile = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      if (!useEditor.getState().privacyAcknowledged) return;
      dragDepth.current++;
      setDraggingFile(true);
    };
    const over = (event: DragEvent) => {
      if (isFile(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }
    };
    const leave = (event: DragEvent) => {
      if (!isFile(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDraggingFile(false);
    };
    const drop = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDraggingFile(false);
      if (!useEditor.getState().privacyAcknowledged) return;
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      if (files.length > 1) {
        useEditor.setState({
          status: 'error',
          message: 'Drop one file at a time to create a data diagram.',
        });
        return;
      }
      void importFile(files[0]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFile]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      document.querySelectorAll('details.quick-picker[open]').forEach((picker) => {
        if (!picker.contains(event.target as Node)) picker.removeAttribute('open');
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        document
          .querySelectorAll('details.quick-picker[open]')
          .forEach((picker) => picker.removeAttribute('open'));
        useEditor.setState({ mobilePanel: null });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    workspace
      .start()
      .then(() => setReady(true))
      .catch((e) => {
        setReady(true);
        useEditor.setState({ status: 'error', message: (e as Error).message });
      });
    return () => workspace.stop();
  }, []);
  useEffect(() => {
    if (acknowledged && import.meta.env.PROD && 'serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  }, [acknowledged]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const editing = (e.target as HTMLElement)?.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      if (dialog || backup || csvDraft || importing || !useEditor.getState().privacyAcknowledged)
        return;
      if (modifier && (key === 'f' || key === 'k')) {
        e.preventDefault();
        open('search');
        return;
      }
      if (modifier && key === 'n') {
        e.preventDefault();
        open('new');
        return;
      }
      if (editing) return;
      const s = useEditor.getState();
      if (modifier && key === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (modifier && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (modifier && key === 'c') {
        e.preventDefault();
        const clip = s.copy();
        if (clip) void navigator.clipboard?.writeText(JSON.stringify(clip)).catch(() => {});
      } else if (modifier && key === 'v') {
        e.preventDefault();
        const paste = async () => {
          try {
            const text = await navigator.clipboard.readText();
            const clip = JSON.parse(text) as Clip;
            if (
              clip.format === 'visual-nerve-clipboard' &&
              Array.isArray(clip.nodes) &&
              Array.isArray(clip.edges)
            ) {
              s.paste(clip);
              return;
            }
          } catch {}
          s.paste();
        };
        void paste();
      } else if (modifier && key === 'd') {
        e.preventDefault();
        const clip = s.copy();
        if (clip) s.paste(clip);
      } else if (modifier && key === 'g') {
        e.preventDefault();
        e.shiftKey ? s.ungroup() : s.group();
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        s.remove(e.shiftKey);
      } else if (
        key === 'f2' &&
        s.graph?.diagram.type === 'mindmap' &&
        s.selectedNodes.length === 1
      ) {
        e.preventDefault();
        s.beginEditing(s.selectedNodes[0]);
      } else if (
        s.graph?.diagram.type === 'mindmap' &&
        s.selectedNodes.length &&
        !(e.target as HTMLElement)?.closest('button,a,summary') &&
        (key === 'tab' || key === 'enter')
      ) {
        e.preventDefault();
        e.stopPropagation();
        const id = s.child(key === 'enter');
        if (id) useEditor.getState().beginEditing(id);
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [dialog, backup, csvDraft, importing, open]);
  if (!acknowledged)
    return (
      <div className="application storage-gate">
        <main className="welcome">
          <div className="welcome-mark">
            <GitBranch size={31} />
          </div>
          <h1>Visual Nerve</h1>
          <p>Accept local browser storage to open your workspace.</p>
          {status === 'error' && <p className="form-error">{message}</p>}
        </main>
        {ready && status !== 'error' && <PrivacyIntro />}
      </div>
    );
  return (
    <ReactFlowProvider>
      <div
        className={`application ${focusMap && graph?.diagram.type === 'mindmap' ? 'map-focus' : ''}`}
        data-mobile-panel={mobilePanel ?? ''}
      >
        {mobilePanel && (
          <button
            className="mobile-scrim mobile-only"
            aria-label="Close panel"
            onClick={() => useEditor.setState({ mobilePanel: null })}
          />
        )}
        <Sidebar open={open} importFile={() => file.current?.click()} />
        <main className="main-workspace">
          {graph ? (
            <>
              <Toolbar
                open={open}
                showFilters={filters}
                toggleFilters={() => setFilters((v) => !v)}
              />
              {filters && <FilterBar />}
              {status === 'conflict' && (
                <div className="notice conflict-notice">
                  <span>{message || 'Another tab changed this project.'}</span>
                  <button
                    onClick={() =>
                      void workspace
                        .resolve('copy')
                        .catch((e) => useEditor.setState({ message: e.message }))
                    }
                  >
                    Save local copy
                  </button>
                  <button
                    onClick={() =>
                      void workspace
                        .resolve('discard')
                        .catch((e) => useEditor.setState({ message: e.message }))
                    }
                  >
                    Use saved version
                  </button>
                  <button
                    onClick={() =>
                      void workspace
                        .resolve('retry')
                        .catch((e) => useEditor.setState({ message: e.message }))
                    }
                  >
                    Replace saved version
                  </button>
                </div>
              )}
              {status === 'error' && message && (
                <div className="notice error-notice">
                  <span>{message}</span>
                  <button
                    onClick={() =>
                      void workspace
                        .settled()
                        .catch((error) => useEditor.setState({ message: error.message }))
                    }
                  >
                    Retry save
                  </button>
                  <button onClick={() => open('settings')}>Settings</button>
                </div>
              )}
              <Canvas />
              <div className="canvas-statusbar">
                <span>
                  <LocalBadge onClick={() => open('settings')} /> {viewCounts.nodes}{' '}
                  {graph.dataset ? 'visible nodes' : 'nodes'} <i>·</i> {viewCounts.edges}{' '}
                  connections
                  {viewCounts.hidden > 0 && (
                    <>
                      {' '}
                      <i>·</i> {viewCounts.hidden} hidden
                    </>
                  )}
                </span>
                <span>
                  {graph.diagram.type === 'mindmap' ? (
                    <>
                      Tab: subtopic <i>·</i> Enter: sibling <i>·</i> Double-click: edit
                    </>
                  ) : (
                    <>
                      Drag to select <i>·</i> Space to pan <i>·</i> F to fit
                    </>
                  )}
                </span>
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-mark">
                <GitBranch size={31} />
              </div>
              <span className="eyebrow">VISUAL NERVE</span>
              <h1>
                Give your thinking
                <br />a place to connect.
              </h1>
              <p>
                From a first idea to the whole picture.
                <br />
                Your work is saved only in this browser. No account or cloud storage.
              </p>
              <LocalBadge onClick={() => open('settings')} />
              <div className="welcome-actions">
                <button className="primary" onClick={() => open('new')}>
                  <Plus size={16} />
                  Create a diagram
                </button>
                <a href="/help/">
                  Explore the guide
                  <ArrowUpRight size={14} />
                </a>
              </div>
              <button
                className="mobile-only"
                aria-label="Open projects"
                onClick={() => useEditor.setState({ mobilePanel: 'projects' })}
              >
                <Menu size={18} />
                Projects
              </button>
              <div className="welcome-bottom">
                <span>Mind maps</span>
                <i>·</i>
                <span>Flows</span>
                <i>·</i>
                <span>Timelines</span>
                <i>·</i>
                <span>Systems</span>
              </div>
              {!ready && <p className="muted">Opening local workspace…</p>}
              {status === 'error' && <p className="form-error">{message}</p>}
            </div>
          )}
        </main>
        <div className="properties-shell">
          <button
            className="mobile-only mobile-sheet-close"
            aria-label="Close properties"
            onClick={() => useEditor.setState({ mobilePanel: null })}
          >
            <X size={19} />
          </button>
          <Properties
            editCsv={() => {
              if (graph?.dataset) setCsvDraft({ dataset: graph.dataset, previous: graph });
            }}
            focusCsv={(path: CsvPathEntry[]) => void navigateCsv({ focusPath: path, offset: 0 })}
            pageCsv={(direction: 'next' | 'previous') => {
              const analysis = graph && getCsvAnalysis(graph);
              if (analysis) {
                const group = graph!.nodes
                  .map(getCsvNode)
                  .find(
                    (data) =>
                      data?.visible !== false &&
                      data?.groupKey === JSON.stringify(analysis.focusPath),
                  );
                const step =
                  direction === 'next' && group
                    ? Math.max(1, group.totalChildren - group.hiddenChildren)
                    : analysis.limit;
                void navigateCsv({
                  offset: Math.max(0, analysis.offset + (direction === 'next' ? step : -step)),
                });
              }
            }}
          />
        </div>
      </div>
      <input
        ref={file}
        aria-label="Import file"
        className="file-input"
        type="file"
        accept=".json,.md,.markdown,.csv"
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          if (!picked) return;
          await importFile(picked);
          if (file.current) file.current.value = '';
        }}
      />
      {dialog === 'new' && <NewDiagram close={close} />}
      {dialog === 'export' && <ExportDialog close={close} />}
      {dialog === 'owners' && <OwnersDialog close={close} />}
      {dialog === 'search' && <SearchDialog close={close} />}
      {dialog === 'settings' && (
        <SettingsDialog
          close={close}
          theme={theme}
          setTheme={updateTheme}
          restore={inspectBackup}
        />
      )}
      {dialog === 'delete' && <DeleteDialog close={close} />}
      {dialog === 'connect' && <ConnectDialog close={close} />}
      {backup && <RestoreBackup backup={backup} close={() => setBackup(null)} />}
      {csvDraft && (
        <CsvImportDialog
          key={csvDraft.dataset.id}
          dataset={csvDraft.dataset}
          previous={csvDraft.previous}
          close={() => setCsvDraft(null)}
          apply={(analysis, name) => applyCsv(csvDraft.dataset, analysis, name, csvDraft.previous)}
          legacyImport={
            csvDraft.file
              ? async () => {
                  const graph = parseImport('csv', await csvDraft.file!.text());
                  await workspace.create(graph);
                }
              : undefined
          }
        />
      )}
      {draggingFile && (
        <div className="csv-drop-overlay">
          <strong>Drop a CSV to explore your data</strong>
          <span>Choose columns, clean values, filter rows and build a connected diagram.</span>
        </div>
      )}
      {importing && (
        <div className="csv-import-progress" role="status">
          Preparing data in the background…
        </div>
      )}
    </ReactFlowProvider>
  );
}
