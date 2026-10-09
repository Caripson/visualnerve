import { useI18n } from './i18n';
import { PresentationFeature } from './presentation/PresentationFeature';
import { SimulationFeature } from './simulation/SimulationFeature';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ArrowUpRight, GitBranch, Plus, X, Menu, Database, Code2 } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { LazyDialogBoundary } from './components/LazyDialogBoundary';
import { PreferenceSaveNotice } from './components/PreferenceSaveNotice';
import { Toolbar, FilterBar } from './components/Toolbar';
import { PropertiesFeature as Properties } from './components/PropertiesFeature';
import { Canvas } from './canvas/Canvas';
import { LocalBadge, PrivacyIntro, RestoreBackup } from './components/DataPrivacy';
import { useEditor } from './state/editor';
import { workspace } from './storage/workspace';
import { type WorkspaceBackup } from './storage/database';
import type { WorkspaceOperation } from './storage/contracts';
import { parseImport } from './export/semantic';
import type { Clip } from './state/clipboard';
import type { Graph } from './model/types';
import { useImportFiles } from './imports/useImportFiles';
import { useWorkspaceBackupReader } from './security/useWorkspaceBackupReader';
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
import { UnderstandingDialogs } from './components/UnderstandingDialogs';
import { useCompactLayout } from './hooks/useCompactLayout';
import { MobileWorkspacePanel } from './components/mobile/MobileWorkspacePanel';
import { applyAppearance } from './ui/appearance';
import { useStarterDemo } from './templates/useStarterDemo';
import './components/mobile/mobile-workspace.css';
const NewDiagram = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.NewDiagram })),
);
const ExportDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.ExportDialog })),
);
const OwnersDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.OwnersDialog })),
);
const SearchDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.SearchDialog })),
);
const SettingsDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.SettingsDialog })),
);
const DeleteDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.DeleteDialog })),
);
const ConnectDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.ConnectDialog })),
);
const CsvImportDialog = lazy(() =>
  import('./components/CsvImportDialog').then((module) => ({ default: module.CsvImportDialog })),
);
const LovableDialog = lazy(() =>
  import('./components/LovableDialog').then((module) => ({ default: module.LovableDialog })),
);
const SqlImportDialog = lazy(() =>
  import('./components/SqlImportDialog').then((module) => ({ default: module.SqlImportDialog })),
);
const CodeImportDialog = lazy(() =>
  import('./components/CodeImportDialog').then((module) => ({ default: module.CodeImportDialog })),
);
const DiagramFileImportDialog = lazy(() =>
  import('./components/DiagramFileImportDialog').then((module) => ({
    default: module.DiagramFileImportDialog,
  })),
);
const DataSourcesDialog = lazy(() =>
  import('./components/DataSourcesDialog').then((module) => ({
    default: module.DataSourcesDialog,
  })),
);
const SourceRefreshDialog = lazy(() =>
  import('./components/SourceRefreshDialog').then((module) => ({
    default: module.SourceRefreshDialog,
  })),
);
const DataQualityDialog = lazy(() =>
  import('./components/DataQualityDialog').then((module) => ({
    default: module.DataQualityDialog,
  })),
);
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
type AppOperation = {
  operation: WorkspaceOperation;
  check: () => Promise<void>;
  assertCurrent: () => void;
};
export function App() {
  const { t, plural } = useI18n();
  const compact = useCompactLayout();
  const displayMessage = (value: string) => {
    if (
      value ===
      'Collapse the overview before opening more groups; at most 2,000 expansions can be saved.'
    )
      return t('overview.expansionLimit');
    if (value === 'The diagram changed during layout. Run layout again.')
      return t('toolbar.layoutDiagramChanged');
    if (value === 'Drawing limit reached. Erase some strokes or draw shorter lines.')
      return t('editor.drawing.drawingLimitReachedEraseSomeStrokesOrDrawShorterLines');
    if (value === 'Drawing limit reached. Erase some strokes before adding more.')
      return t('editor.drawing.drawingLimitReachedEraseSomeStrokesBeforeAddingMore');
    return value;
  };
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [ready, setReady] = useState(false);
  const [backup, setBackup] = useState<WorkspaceBackup | null>(null);
  const { readBackup, backupDialog } = useWorkspaceBackupReader();
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
  const active = useRef(true);
  const lifecycle = useRef(0);
  const operations = useRef(new Set<WorkspaceOperation>());
  const withAppOperation = useCallback(
    async <T,>(work: (job: AppOperation) => Promise<T>, originating?: WorkspaceOperation) => {
      const generation = lifecycle.current;
      const operation = originating ?? (await workspace.repo.db.captureOperation());
      if (!originating) operations.current.add(operation);
      const assertCurrent = () => {
        if (!active.current || lifecycle.current !== generation || operation.signal.aborted)
          throw new DOMException('The workspace operation was cancelled.', 'AbortError');
      };
      const check = async () => {
        assertCurrent();
        await operation.check();
        assertCurrent();
      };
      try {
        await check();
        assertCurrent();
        return await work({ operation, check, assertCurrent });
      } finally {
        if (!originating) {
          operations.current.delete(operation);
          operation.dispose();
        }
      }
    },
    [],
  );
  const reportFailure = useCallback(
    (action: () => Promise<unknown>, status?: 'error') => {
      void withAppOperation(async ({ check, assertCurrent }) => {
        try {
          await action();
        } catch (error) {
          await check();
          assertCurrent();
          useEditor.setState({ ...(status ? { status } : {}), message: (error as Error).message });
        }
      }).catch(() => {});
    },
    [withAppOperation],
  );
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
    reportFailure(() => workspace.setPreference('theme', value), 'error');
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
  const commandError = useEditor((s) => s.commandError);
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
    readBackup,
    failed: () => {
      pendingSourceFiles.current = [];
    },
  });

  const createImportedDiagram = useCallback(
    async (generated: Graph) => {
      if (!active.current) throw new DOMException('The import was cancelled.', 'AbortError');
      if (importInFlight.current) throw new Error('Wait for the current import to finish.');
      importInFlight.current = true;
      setImporting(true);
      try {
        await withAppOperation(async ({ operation, assertCurrent }) => {
          assertCurrent();
          await workspace.create(generated, operation);
        });
      } finally {
        importInFlight.current = false;
        if (active.current) setImporting(false);
      }
    },
    [withAppOperation],
  );

  const applyCsv = useCallback(
    async (
      dataset: CsvDataset,
      analysis: CsvAnalysis,
      name: string,
      previous?: Graph,
      originating?: WorkspaceOperation,
    ) => {
      if (importInFlight.current) throw new Error('Wait for the current data operation to finish.');
      importInFlight.current = true;
      try {
        await withAppOperation(async ({ operation, check, assertCurrent }) => {
          if (!previous) {
            const generated = await analyzeCsv(dataset, analysis);
            await check();
            assertCurrent();
            generated.diagram = { ...generated.diagram, name };
            await workspace.create(generated, operation);
            await check();
            assertCurrent();
            if (pendingSourceFiles.current.length) {
              setSourceFiles(pendingSourceFiles.current);
              pendingSourceFiles.current = [];
              open('sources');
            }
            return;
          }
          await workspace.settled();
          await check();
          assertCurrent();
          const snapshot = useEditor.getState().graph;
          const revision = useEditor.getState().editRevision;
          if (!snapshot || snapshot.diagram.id !== previous.diagram.id)
            throw new Error('Open this data diagram before changing its view.');
          const liveDataset = graphDatasets(snapshot).find((source) => source.id === dataset.id);
          if (!liveDataset || liveDataset.version !== dataset.version)
            throw new Error(
              'The source changed while its settings were open. Reopen the data view.',
            );
          const linked =
            !!snapshot.datasets?.length || !!snapshot.diagram.settings.csvSourceAnalyses;
          const generated = linked
            ? await reanalyzeDataModelAsync(setSourceAnalysis(snapshot, dataset.id, analysis), {
                signal: operation.signal,
              })
            : await analyzeCsv(liveDataset, analysis, snapshot);
          await check();
          assertCurrent();
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
          await check();
          assertCurrent();
          if (useEditor.getState().status === 'error' || useEditor.getState().status === 'conflict')
            throw new Error(useEditor.getState().message || 'The data view could not be saved.');
        }, originating);
      } finally {
        importInFlight.current = false;
      }
    },
    [open, withAppOperation],
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
        await withAppOperation(async ({ operation, check, assertCurrent }) => {
          try {
            if (current.diagram.settings.csvRelationships?.length && patch.focusPath) {
              importInFlight.current = true;
              await workspace.settled();
              await check();
              assertCurrent();
              const snapshot = useEditor.getState().graph;
              const revision = useEditor.getState().editRevision;
              if (!snapshot || snapshot.diagram.id !== current.diagram.id) return;
              const focused = patch.focusPath.length
                ? setSourceAnalysis(snapshot, dataset.id, { ...analysis, ...patch })
                : clearDataModelFocus(snapshot);
              const generated = await reanalyzeDataModelAsync(
                {
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
                },
                { signal: operation.signal },
              );
              await check();
              assertCurrent();
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
              await check();
              assertCurrent();
            } else
              await applyCsv(
                dataset,
                { ...analysis, ...patch },
                current.diagram.name,
                current,
                operation,
              );
          } catch (error) {
            await check();
            assertCurrent();
            useEditor.setState({ status: 'error', message: (error as Error).message });
          }
        });
      } catch {
        // A cancelled app or vault session must not publish into its replacement.
      } finally {
        importInFlight.current = false;
        if (active.current) setImporting(false);
      }
    },
    [applyCsv, withAppOperation],
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
    active.current = true;
    lifecycle.current++;
    return () => {
      active.current = false;
      lifecycle.current++;
      for (const operation of operations.current) operation.dispose();
      operations.current.clear();
      pendingSourceFiles.current = [];
      importInFlight.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    workspace
      .start()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (!active) return;
        setReady(true);
        useEditor.setState({ status: 'error', message: (e as Error).message });
      });
    return () => {
      active = false;
      workspace.stop();
    };
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
          await withAppOperation(async ({ check, assertCurrent }) => {
            let clip: Clip | undefined;
            try {
              const text = await navigator.clipboard.readText();
              const parsed = JSON.parse(text) as Clip;
              if (
                parsed?.format === 'visual-nerve-clipboard' &&
                Array.isArray(parsed.nodes) &&
                Array.isArray(parsed.edges)
              )
                clip = parsed;
            } catch {}
            await check();
            assertCurrent();
            if (canPaste()) useEditor.getState().paste(clip);
          });
        };
        void paste().catch(() => {});
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
  }, [dialog, backup, csvDraft, importing, open, withAppOperation]);
  if (!acknowledged)
    return (
      <div className="application storage-gate">
        <main className="welcome">
          <div className="welcome-mark">
            <GitBranch size={31} />
          </div>
          <h1>Visual Nerve</h1>
          <p>{t('app.storageGateHint')}</p>
          {status === 'error' && <p className="form-error">{displayMessage(message)}</p>}
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
            aria-label={t('app.closePanel')}
            tabIndex={-1}
            onClick={closeMobilePanel}
          />
        )}
        <MobileWorkspacePanel
          className="projects-shell"
          panelKind="projects"
          label={t('workspace.projects')}
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
          <PreferenceSaveNotice settings={() => open('settings')} />
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
                  <span>{message || t('app.conflictFallback')}</span>
                  <button onClick={() => reportFailure(() => workspace.resolve('copy'))}>
                    {t('app.saveLocalCopy')}
                  </button>
                  <button onClick={() => reportFailure(() => workspace.resolve('discard'))}>
                    {t('app.useSavedVersion')}
                  </button>
                  <button onClick={() => reportFailure(() => workspace.resolve('retry'))}>
                    {t('app.replaceSavedVersion')}
                  </button>
                </div>
              )}
              {(commandError || (status === 'error' && message)) && (
                <div className="notice error-notice" role="alert">
                  <span>{displayMessage(commandError || message)}</span>
                  {commandError ? (
                    <button
                      onClick={() =>
                        useEditor.setState((state) => ({
                          commandError: '',
                          ...(state.status === 'error' && state.message === state.commandError
                            ? { status: 'saved', message: '' }
                            : {}),
                        }))
                      }
                    >
                      {t('app.dismissEditError')}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => reportFailure(() => workspace.settled())}>
                        {t('app.retrySave')}
                      </button>
                      <button onClick={() => open('settings')}>{t('app.settings')}</button>
                    </>
                  )}
                </div>
              )}
              <SimulationFeature />
              <Canvas />
              <PresentationFeature />
              <div className="canvas-statusbar">
                <span>
                  <LocalBadge onClick={() => open('settings')} />{' '}
                  {plural(
                    graph.dataset ? 'app.visibleNodeCountOne' : 'app.nodeCountOne',
                    graph.dataset ? 'app.visibleNodeCount' : 'app.nodeCount',
                    viewCounts.nodes,
                  )}{' '}
                  <i>·</i>{' '}
                  {plural('app.connectionCountOne', 'app.connectionCount', viewCounts.edges)}
                  {viewCounts.hidden > 0 && (
                    <>
                      {' '}
                      <i>·</i> {t('app.hiddenCount', { count: viewCounts.hidden })}
                    </>
                  )}
                </span>
                <span>
                  {getSpatialView(graph).mode === '3d' ? (
                    <>{t('app.spatialStatusHint')}</>
                  ) : graph.diagram.type === 'mindmap' ? (
                    <>{t('app.mindmapStatusHint')}</>
                  ) : (
                    <>{t('app.selectionStatusHint')}</>
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
              <h1>{t('app.welcomeTitle')}</h1>
              <p>
                {t('app.welcomeIntro')}
                <br />
                {t('app.welcomeLocalHint')}
              </p>
              <LocalBadge onClick={() => open('settings')} />
              <div className="welcome-actions">
                <button className="primary" onClick={() => open('new')}>
                  <Plus size={16} />
                  {t('app.createDiagram')}
                </button>
                <button onClick={() => open('sql')}>
                  <Database size={16} />
                  {t('toolbar.importSql')}
                </button>
                <button onClick={() => open('code')}>
                  <Code2 size={16} />
                  {t('toolbar.visualizeCode')}
                </button>
                <a href="/help/">
                  {t('app.exploreGuide')}
                  <ArrowUpRight size={14} />
                </a>
              </div>
              <button
                className="mobile-only"
                data-mobile-panel-trigger="projects"
                aria-label={t('workspace.openProjects')}
                onClick={() => useEditor.setState({ mobilePanel: 'projects' })}
              >
                <Menu size={18} />
                {t('workspace.projects')}
              </button>
              <div className="welcome-bottom">
                <span>{t('app.mindmapsCategory')}</span>
                <i>·</i>
                <span>{t('app.flowsCategory')}</span>
                <i>·</i>
                <span>{t('app.timelinesCategory')}</span>
                <i>·</i>
                <span>{t('app.systemsCategory')}</span>
              </div>
              {!ready && <p className="muted">{t('app.openingLocalWorkspace')}</p>}
              {status === 'error' && <p className="form-error">{displayMessage(message)}</p>}
            </div>
          )}
        </main>
        <MobileWorkspacePanel
          className="properties-shell"
          panelKind="details"
          label={t('workspace.properties')}
          compact={compact}
          active={compact && mobilePanel === 'details'}
          close={closeMobilePanel}
        >
          <button
            className="mobile-only mobile-sheet-close"
            data-mobile-panel-dismiss="details"
            aria-label={t('app.closeProperties')}
            onClick={() => useEditor.setState({ mobilePanel: null })}
          >
            <X size={19} />
          </button>
          <Properties
            active={!compact || mobilePanel === 'details'}
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
        aria-label={t('app.importFilePicker')}
        className="file-input"
        type="file"
        accept={importFileAccept}
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          if (!picked) return;
          await importFile(picked);
          if (active.current && file.current) file.current.value = '';
        }}
      />
      <LazyDialogBoundary
        key={`${dialog ?? ''}:${diagramFile?.name ?? ''}:${csvDraft?.dataset.id ?? ''}`}
        close={() => {
          close();
          setCsvDraft(null);
          pendingSourceFiles.current = [];
        }}
        beforeReload={async () => {
          useEditor.getState().finishEditing();
          await workspace.settled();
        }}
      >
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
          <DiagramFileImportDialog
            file={diagramFile}
            close={close}
            create={createImportedDiagram}
          />
        )}
        {dialog === 'owners' && <OwnersDialog close={close} />}
        {dialog === 'search' && <SearchDialog close={close} />}
        {dialog === 'settings' && (
          <SettingsDialog
            close={close}
            theme={theme}
            setTheme={updateTheme}
            restore={inspectBackup}
            onReadBackup={readBackup}
          />
        )}
        {dialog === 'delete' && <DeleteDialog close={close} />}
        {dialog === 'connect' && <ConnectDialog close={close} />}
        {backup && <RestoreBackup backup={backup} close={() => setBackup(null)} />}
        {backupDialog}
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
            apply={(analysis, name) =>
              applyCsv(csvDraft.dataset, analysis, name, csvDraft.previous)
            }
            legacyImport={
              csvDraft.file
                ? async () => {
                    const limit = currentImportLimitBytes();
                    await withAppOperation(async ({ operation, check, assertCurrent }) => {
                      const text = await csvDraft.file!.text();
                      await check();
                      assertCurrent();
                      const graph = parseImport('csv', text, limit);
                      await workspace.create(graph, operation);
                    });
                  }
                : undefined
            }
          />
        )}
      </LazyDialogBoundary>
      {draggingFile && (
        <div className="csv-drop-overlay">
          <strong>{t('app.dropFileTitle')}</strong>
          <span>{t('app.dropFileHint')}</span>
        </div>
      )}
      {importing && (
        <div className="csv-import-progress" role="status">
          {t('app.preparingImportBackground')}
        </div>
      )}
    </ReactFlowProvider>
  );
}
