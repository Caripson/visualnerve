import { PresentationFeature } from './presentation/Player';
import { SimulationFeature } from './simulation/SimulationFeature';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ArrowUpRight, GitBranch, Plus, X, Menu, Database, Code2 } from 'lucide-react';
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
import { LovableDialog } from './components/LovableDialog';
import { SqlImportDialog } from './components/SqlImportDialog';
import { CodeImportDialog } from './components/CodeImportDialog';
import { DiagramFileImportDialog } from './components/DiagramFileImportDialog';
import { useImportFiles } from './imports/useImportFiles';
import { importFileAccept } from './imports/fileRouting';
import { currentImportLimitBytes } from './imports/preference';
import { analyzeCsv } from './data/client';
import { getCsvNode } from './data/csv';
import type { CsvAnalysis, CsvDataset, CsvPathEntry } from './data/types';
import {
  analysisForDataset,
  graphDatasets,
  setSourceAnalysis,
  clearDataModelFocus,
} from './data/model';
import { getExploration } from './analysis/types';
import { getSpatialView } from './spatial/types';
import { reanalyzeDataModelAsync } from './data/modelClient';
import { DataSourcesDialog } from './components/DataSourcesDialog';
import { SourceRefreshDialog } from './components/SourceRefreshDialog';
import { DataQualityDialog } from './components/DataQualityDialog';
import { UnderstandingDialogs } from './components/UnderstandingDialogs';
import { useCompactLayout } from './hooks/useCompactLayout';
import { MobileWorkspacePanel } from './components/mobile/MobileWorkspacePanel';
import { applyAppearance } from './ui/appearance';
import { useStarterDemo } from './templates/useStarterDemo';
import './components/mobile/mobile-workspace.css';
export type DialogName =
  | 'new'
  | 'export'
  | 'lovable'
  | 'sql'
  | 'code'
  | 'sources'
  | 'refresh'
  | 'quality'
  | 'overview'
  | 'questions'
  | 'history'
  | 'owners'
  | 'search'
  | 'settings'
  | 'delete'
  | 'connect';
export function App() {
  const compact = useCompactLayout();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [ready, setReady] = useState(false);
  const [backup, setBackup] = useState<WorkspaceBackup | null>(null);
  const [sqlDraft, setSqlDraft] = useState<{ id: string; text: string; name: string }>();
  const [codeFiles, setCodeFiles] = useState<File[]>();
  const [diagramFile, setDiagramFile] = useState<File>();
  const [sourceFiles, setSourceFiles] = useState<File[]>();
  const pendingSourceFiles = useRef<File[]>([]);
  const [csvDraft, setCsvDraft] = useState<{
    dataset: CsvDataset;
    previous?: Graph;
    file?: File;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const importInFlight = useRef(false);
  const acknowledged = useEditor((state) => state.privacyAcknowledged);
  useStarterDemo(ready, acknowledged);
  const inspectBackup = (data: WorkspaceBackup) => {
    setDialog(null);
    setSqlDraft(undefined);
    setCodeFiles(undefined);
    setDiagramFile(undefined);
    setCsvDraft(null);
    pendingSourceFiles.current = [];
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
  const explorationResult = useEditor((s) => s.explorationResult);
  const viewCounts = useMemo(() => {
    if (!graph) return { nodes: 0, edges: 0, hidden: 0 };
    const explored =
      getExploration(graph) && explorationResult ? new Set(explorationResult.nodeIds) : undefined;
    const exploredEdges =
      explored && explorationResult ? new Set(explorationResult.edgeIds) : undefined;
    const visible = new Set(
      graph.nodes
        .filter(
          (node) =>
            (getCsvNode(node)?.visible !== false ||
              (explored?.has(node.id) && getExploration(graph)?.includeHidden)) &&
            (!explored || explored.has(node.id)),
        )
        .map((node) => node.id),
    );
    return {
      nodes: visible.size,
      edges: graph.edges.filter(
        (edge) =>
          (exploredEdges ? exploredEdges.has(edge.id) : edge.metadata.csvModelVisible !== false) &&
          visible.has(edge.sourceNodeId) &&
          visible.has(edge.targetNodeId) &&
          (!exploredEdges || exploredEdges.has(edge.id)),
      ).length,
      hidden: graph.nodes.length - visible.size,
    };
  }, [graph, explorationResult]);
  const focusMap = useEditor((s) => s.focusMap);
  const mobilePanel = useEditor((s) => s.mobilePanel);
  const closeMobilePanel = useCallback(() => useEditor.setState({ mobilePanel: null }), []);
  useEffect(() => {
    closeMobilePanel();
  }, [graph?.diagram.id, compact, closeMobilePanel]);
  const status = useEditor((s) => s.status);
  const message = useEditor((s) => s.message);
  const file = useRef<HTMLInputElement>(null);
  const close = useCallback(() => {
    useEditor.setState({ mobilePanel: null });
    setDialog(null);
    setSqlDraft(undefined);
    setCodeFiles(undefined);
    setDiagramFile(undefined);
  }, []);
  const open = useCallback((name: DialogName) => {
    window.dispatchEvent(new Event('visualnerve:close-toolbar-menus'));
    document
      .querySelectorAll('details.quick-picker[open]')
      .forEach((picker) => picker.removeAttribute('open'));
    useEditor.setState({ mobilePanel: null });
    setSqlDraft(undefined);
    setCodeFiles(undefined);
    setDiagramFile(undefined);
    setDialog(name);
  }, []);
  const { importFile, draggingFile } = useImportFiles({
    busy: importInFlight,
    setImporting,
    sql: (draft) => {
      pendingSourceFiles.current = [];
      setCsvDraft(null);
      open('sql');
      setSqlDraft(draft);
    },
    code: (files) => {
      pendingSourceFiles.current = [];
      setCsvDraft(null);
      open('code');
      setCodeFiles(files);
    },
    diagramFile: (picked) => {
      pendingSourceFiles.current = [];
      setCsvDraft(null);
      close();
      setDiagramFile(picked);
    },
    csv: (dataset, file) => {
      close();
      setCsvDraft({ dataset, file });
    },
    csvFiles: (files) => {
      if (useEditor.getState().graph) {
        open('sources');
        setSourceFiles(files);
      } else {
        pendingSourceFiles.current = files.slice(1);
        void importFile(files[0]);
      }
    },
    backup: inspectBackup,
    failed: () => {
      pendingSourceFiles.current = [];
    },
  });

  const createImportedDiagram = useCallback(async (generated: Graph) => {
    if (importInFlight.current) throw new Error('Wait for the current import to finish.');
    importInFlight.current = true;
    setImporting(true);
    try {
      await workspace.create(generated);
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
          if (pendingSourceFiles.current.length) {
            setSourceFiles(pendingSourceFiles.current);
            pendingSourceFiles.current = [];
            open('sources');
          }
          return;
        }
        await workspace.settled();
        const snapshot = useEditor.getState().graph;
        const revision = useEditor.getState().editRevision;
        if (!snapshot || snapshot.diagram.id !== previous.diagram.id)
          throw new Error('Open this data diagram before changing its view.');
        const liveDataset = graphDatasets(snapshot).find((source) => source.id === dataset.id);
        if (!liveDataset || liveDataset.version !== dataset.version)
          throw new Error('The source changed while its settings were open. Reopen the data view.');
        const linked = !!snapshot.datasets?.length || !!snapshot.diagram.settings.csvSourceAnalyses;
        const generated = linked
          ? await reanalyzeDataModelAsync(setSourceAnalysis(snapshot, dataset.id, analysis))
          : await analyzeCsv(liveDataset, analysis, snapshot);
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
    [open],
  );

  const navigateCsv = useCallback(
    async (patch: Partial<CsvAnalysis>, datasetId?: string) => {
      if (importInFlight.current) return;
      const current = useEditor.getState().graph;
      const dataset =
        current &&
        graphDatasets(current).find((source) => source.id === (datasetId ?? current.dataset?.id));
      const analysis = current && dataset && analysisForDataset(current, dataset.id);
      if (!current || !dataset || !analysis) return;
      setImporting(true);
      try {
        if (current.diagram.settings.csvRelationships?.length && patch.focusPath) {
          importInFlight.current = true;
          await workspace.settled();
          const snapshot = useEditor.getState().graph;
          const revision = useEditor.getState().editRevision;
          if (!snapshot || snapshot.diagram.id !== current.diagram.id) return;
          const focused = patch.focusPath.length
            ? setSourceAnalysis(snapshot, dataset.id, { ...analysis, ...patch })
            : clearDataModelFocus(snapshot);
          const generated = await reanalyzeDataModelAsync({
            ...focused,
            diagram: {
              ...focused.diagram,
              settings: {
                ...focused.diagram.settings,
                csvEntityFocus: patch.focusPath.length
                  ? { datasetId: dataset.id, path: patch.focusPath }
                  : undefined,
              },
            },
          });
          const live = useEditor.getState();
          if (
            live.graph?.diagram.id !== snapshot.diagram.id ||
            live.graph.diagram.version !== snapshot.diagram.version ||
            live.editRevision !== revision
          )
            throw new Error('The diagram changed during analysis. Explore the group again.');
          live.command('Explore related CSV data', () => generated);
          useEditor.setState({ selectedNodes: [], selectedEdges: [], focusNode: null });
          await workspace.settled();
        } else await applyCsv(dataset, { ...analysis, ...patch }, current.diagram.name, current);
      } catch (error) {
        useEditor.setState({ status: 'error', message: (error as Error).message });
      } finally {
        importInFlight.current = false;
        setImporting(false);
      }
    },
    [applyCsv],
  );

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
    if (ready) return applyAppearance(theme);
  }, [ready, theme]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const editing = (e.target as HTMLElement)?.closest(
        'input,textarea,select,[contenteditable="true"],[data-node-scroll]',
      );
      if (
        dialog ||
        backup ||
        csvDraft ||
        importing ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        !useEditor.getState().privacyAcknowledged
      )
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
        const diagramId = s.graph?.diagram.id;
        const canPaste = () => {
          const current = useEditor.getState();
          return (
            !!diagramId &&
            current.graph?.diagram.id === diagramId &&
            current.privacyAcknowledged &&
            !importInFlight.current &&
            !document.querySelector('[role="dialog"][aria-modal="true"]') &&
            !(document.activeElement as HTMLElement | null)?.closest(
              'input,textarea,select,[contenteditable="true"],[data-node-scroll]',
            )
          );
        };
        const paste = async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (!canPaste()) return;
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
          if (canPaste()) s.paste();
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
        if (getSpatialView(s.graph!).mode === '2d') s.beginEditing(s.selectedNodes[0]);
        else useEditor.setState({ mobilePanel: 'details' });
      } else if (
        s.graph?.diagram.type === 'mindmap' &&
        s.selectedNodes.length &&
        !(e.target as HTMLElement)?.closest('button,a,summary') &&
        (key === 'tab' || key === 'enter')
      ) {
        e.preventDefault();
        e.stopPropagation();
        const id = s.child(key === 'enter');
        if (id && getSpatialView(s.graph!).mode === '2d') useEditor.getState().beginEditing(id);
        else if (id) useEditor.setState({ mobilePanel: 'details' });
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
        data-compact-layout={compact ? 'true' : undefined}
        data-has-document={graph ? 'true' : undefined}
        data-mobile-panel={mobilePanel ?? ''}
      >
        {compact && mobilePanel && (
          <button
            className="mobile-scrim"
            aria-label="Close panel"
            tabIndex={-1}
            onClick={closeMobilePanel}
          />
        )}
        <MobileWorkspacePanel
          className="projects-shell"
          label="Projects"
          compact={compact}
          active={compact && mobilePanel === 'projects'}
          close={closeMobilePanel}
        >
          <Sidebar
            open={open}
            importFile={() => {
              closeMobilePanel();
              file.current?.click();
            }}
          />
        </MobileWorkspacePanel>
        <main className="main-workspace" inert={compact && !!mobilePanel ? true : undefined}>
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
              <SimulationFeature />
              <Canvas />
              <PresentationFeature />
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
                  {getSpatialView(graph).mode === '3d' ? (
                    <>
                      Drag: rotate <i>·</i> Scroll: zoom <i>·</i> Select: inspect
                    </>
                  ) : graph.diagram.type === 'mindmap' ? (
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
                <button onClick={() => open('sql')}>
                  <Database size={16} />
                  Import SQL script
                </button>
                <button onClick={() => open('code')}>
                  <Code2 size={16} />
                  Visualize code
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
        <MobileWorkspacePanel
          className="properties-shell"
          label="Properties"
          compact={compact}
          active={compact && mobilePanel === 'details'}
          close={closeMobilePanel}
        >
          <button
            className="mobile-only mobile-sheet-close"
            aria-label="Close properties"
            onClick={() => useEditor.setState({ mobilePanel: null })}
          >
            <X size={19} />
          </button>
          <Properties
            editCsv={(datasetId) => {
              const dataset =
                graph &&
                graphDatasets(graph).find(
                  (source) => source.id === (datasetId ?? graph.dataset?.id),
                );
              if (graph && dataset) {
                closeMobilePanel();
                setCsvDraft({ dataset, previous: graph });
              }
            }}
            focusCsv={(path: CsvPathEntry[], datasetId) =>
              void navigateCsv({ focusPath: path, offset: 0 }, datasetId)
            }
            pageCsv={(direction: 'next' | 'previous', datasetId) => {
              const id = datasetId ?? graph?.dataset?.id;
              const analysis = graph && id && analysisForDataset(graph, id);
              if (analysis) {
                const group = graph!.nodes
                  .map(getCsvNode)
                  .find(
                    (data) =>
                      data?.visible !== false &&
                      data?.datasetId === id &&
                      data?.groupKey === JSON.stringify(analysis.focusPath),
                  );
                const step =
                  direction === 'next' && group
                    ? Math.max(1, group.totalChildren - group.hiddenChildren)
                    : analysis.limit;
                void navigateCsv(
                  {
                    offset: Math.max(0, analysis.offset + (direction === 'next' ? step : -step)),
                  },
                  id,
                );
              }
            }}
          />
        </MobileWorkspacePanel>
      </div>
      <input
        ref={file}
        aria-label="Import file"
        className="file-input"
        type="file"
        accept={importFileAccept}
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          if (!picked) return;
          await importFile(picked);
          if (file.current) file.current.value = '';
        }}
      />
      {dialog === 'new' && <NewDiagram close={close} />}
      {dialog === 'export' && <ExportDialog close={close} />}
      {dialog === 'lovable' && <LovableDialog close={close} />}
      <UnderstandingDialogs name={dialog} close={close} />
      {dialog === 'sources' && graph && (
        <DataSourcesDialog
          initialFiles={sourceFiles}
          onClose={() => {
            setSourceFiles(undefined);
            close();
          }}
        />
      )}
      {dialog === 'refresh' && graph && <SourceRefreshDialog onClose={close} />}
      {dialog === 'quality' && graph && <DataQualityDialog graph={graph} onClose={close} />}
      {dialog === 'sql' && (
        <SqlImportDialog
          key={sqlDraft?.id ?? 'script'}
          initial={sqlDraft}
          close={close}
          create={createImportedDiagram}
        />
      )}
      {dialog === 'code' && (
        <CodeImportDialog initialFiles={codeFiles} close={close} create={createImportedDiagram} />
      )}
      {diagramFile && (
        <DiagramFileImportDialog file={diagramFile} close={close} create={createImportedDiagram} />
      )}
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
          initialAnalysis={
            csvDraft.previous
              ? analysisForDataset(csvDraft.previous, csvDraft.dataset.id)
              : undefined
          }
          close={() => {
            setCsvDraft(null);
            pendingSourceFiles.current = [];
          }}
          apply={(analysis, name) => applyCsv(csvDraft.dataset, analysis, name, csvDraft.previous)}
          legacyImport={
            csvDraft.file
              ? async () => {
                  const graph = parseImport(
                    'csv',
                    await csvDraft.file!.text(),
                    currentImportLimitBytes(),
                  );
                  await workspace.create(graph);
                }
              : undefined
          }
        />
      )}
      {draggingFile && (
        <div className="csv-drop-overlay">
          <strong>Drop a file to create a diagram</strong>
          <span>
            Explore CSV data, SQL queries, source code and dependencies, or import a diagram.
          </span>
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
