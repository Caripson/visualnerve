import { nodeKindLabel, statusLabel } from '../ui/editor-labels';
import { timelineScaleKeys } from './ui-labels';
import { useI18n } from '../i18n';
import { presentation } from '../presentation/service';
import { useEffect, useState } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import {
  ArrowRight,
  Download,
  GitBranch,
  Layers,
  Maximize,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  SlidersHorizontal,
  Check,
  CircleAlert,
  LoaderCircle,
  Expand,
  Minimize2,
  Menu,
  PanelRight,
  MoreHorizontal,
  Settings,
  Sparkles,
  Database,
  Code2,
  LayoutTemplate,
  Clapperboard,
} from 'lucide-react';
import { useEditor } from '../state/editor';
import { fitDiagram } from '../drawing/navigation';
import { nodeRegistry } from '../nodes/registry';
import { layoutGraph, type Direction } from '../layouts/layout';
import type { NodeKind, TimelineScale } from '../model/types';
import type { DialogName } from '../App';
import { DocumentTitle } from '../ui/DocumentTitle';
import { getSpatialView, setSpatialView } from '../spatial/types';
import { createSpatialExample } from '../spatial/examples';
import { workspace } from '../storage/workspace';
import { ToolbarMenu } from './ToolbarMenu';
import { DataToolActions, ToolbarDataTools } from './ToolbarDataTools';
import { UnderstandingActions, UnderstandingTools } from './UnderstandingTools';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { CompactToolbar } from './mobile/CompactToolbar';
export function Toolbar({
  open,
  showFilters,
  toggleFilters,
}: {
  open: (name: DialogName) => void;
  showFilters: boolean;
  toggleFilters: () => void;
}) {
  const { t } = useI18n();
  const graph = useEditor((s) => s.graph);
  const history = useEditor((s) => s.history);
  const future = useEditor((s) => s.future);
  const selectionCount = useEditor((s) => s.selectedNodes.length);
  const status = useEditor((s) => s.status);
  const focusMap = useEditor((s) => s.focusMap);
  const compact = useCompactLayout();
  const [kind, setKind] = useState<NodeKind>('generic');
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [busy, setBusy] = useState(false);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  useEffect(
    () => setDirection(graph?.diagram.type === 'mindmap' ? 'BALANCED' : 'RIGHT'),
    [graph?.diagram.id, graph?.diagram.type],
  );
  if (!graph) return null;
  const mindmap = graph.diagram.type === 'mindmap';
  const spatial = getSpatialView(graph).mode === '3d';
  const switchView = (mode: '2d' | '3d') => {
    window.dispatchEvent(new Event('visualnerve:spatial-camera-flush'));
    const state = useEditor.getState();
    state.finishEditing();
    state.setDrawingTool('none');
    state.command(`${mode.toUpperCase()} view`, (current) => setSpatialView(current, { mode }));
  };
  const newSpatialExample = async () => {
    try {
      await workspace.create(createSpatialExample());
    } catch (error) {
      useEditor.setState({ status: 'error', message: (error as Error).message });
    }
  };
  const addTopic = (sibling = false) => {
    const state = useEditor.getState();
    const current = state.graph!;
    const parent =
      current.nodes.find((n) => n.id === state.selectedNodes[0]) ??
      current.nodes.find((n) => !n.parentId && n.nodeType !== 'group');
    let id: string | undefined;
    if (parent) {
      state.select([parent.id]);
      id = state.child(sibling);
    } else id = state.addNode();
    if (id && !spatial) useEditor.getState().beginEditing(id);
    else if (id) useEditor.setState({ mobilePanel: 'details' });
  };
  const runLayout = async () => {
    setBusy(true);
    try {
      const current = useEditor.getState().graph!;
      const version = useEditor.getState().editRevision;
      const positions = await layoutGraph(current, direction);
      if (
        useEditor.getState().graph?.diagram.id !== current.diagram.id ||
        useEditor.getState().editRevision !== version
      )
        throw new Error('The diagram changed during layout. Run layout again.');
      useEditor.getState().command('Auto layout', (g) => ({
        ...g,
        nodes: g.nodes.map((n) => (positions.has(n.id) ? { ...n, ...positions.get(n.id) } : n)),
      }));
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      const laidOut = useEditor.getState().graph;
      if (laidOut?.diagram.id === current.diagram.id)
        await fitDiagram(
          flow,
          laidOut,
          laidOut.diagram.type === 'mindmap' ? 0.14 : 0.25,
          250,
          undefined,
          flowStore.getState(),
        );
    } catch (e) {
      useEditor.setState({ status: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const icons = {
    saved: Check,
    saving: LoaderCircle,
    error: CircleAlert,
    conflict: CircleAlert,
  };
  const StatusIcon = icons[status];
  const addNode = () => {
    const rect = document.querySelector('.canvas-shell')?.getBoundingClientRect();
    const point =
      rect && !spatial
        ? flow.screenToFlowPosition({
            x: rect.left + rect.width / 2 - 100,
            y: rect.top + rect.height / 2 - 43,
          })
        : undefined;
    useEditor.getState().addNode({ nodeType: kind, ...point });
  };
  if (compact)
    return (
      <CompactToolbar
        graph={graph}
        spatial={spatial}
        mindmap={mindmap}
        kind={kind}
        setKind={setKind}
        direction={direction}
        setDirection={setDirection}
        busy={busy}
        canUndo={!!history.length}
        canRedo={!!future.length}
        selectionCount={selectionCount}
        status={status}
        statusIcon={<StatusIcon size={14} className={status === 'saving' ? 'spin' : ''} />}
        showFilters={showFilters}
        toggleFilters={toggleFilters}
        open={open}
        switchView={switchView}
        add={mindmap ? () => addTopic() : addNode}
        addSibling={() => addTopic(true)}
        fit={() =>
          void fitDiagram(flow, graph, mindmap ? 0.14 : 0.25, 0, undefined, flowStore.getState())
        }
        runLayout={runLayout}
        newSpatialExample={newSpatialExample}
      />
    );
  return (
    <>
      <div className="document-bar">
        <button
          className="mobile-only project-menu"
          data-mobile-panel-trigger="projects"
          aria-label={t('workspace.openProjects')}
          onClick={() => useEditor.setState({ mobilePanel: 'projects' })}
        >
          <Menu size={19} />
        </button>
        <DocumentTitle />
        <div className="document-actions">
          <span className={`save-status save-${status}`} role="status">
            <StatusIcon size={13} className={status === 'saving' ? 'spin' : ''} />
            {
              {
                saved: t('workspace.saved'),
                saving: t('workspace.saving'),
                error: t('workspace.error'),
                conflict: t('workspace.conflict'),
              }[status]
            }
          </span>
          <button
            aria-label={t('toolbar.playerAria')}
            onClick={() => {
              useEditor.getState().finishEditing();
              presentation.open();
            }}
          >
            <Clapperboard size={15} />
            <span>{t('toolbar.playerLabel')}</span>
          </button>
          <button aria-label={t('dialogs.exportField')} onClick={() => open('export')}>
            <Download size={14} />
            <span>{t('dialogs.exportField')}</span>
          </button>
          <button
            className="desktop-tools"
            aria-label={t('toolbar.buildLovable')}
            onClick={() => open('lovable')}
          >
            <Sparkles size={14} />
            <span>{t('toolbar.buildLovable')}</span>
          </button>
          <button
            className="mobile-only"
            data-mobile-panel-trigger="details"
            aria-label={t('workspace.openProperties')}
            onClick={() => useEditor.setState({ mobilePanel: 'details' })}
          >
            <PanelRight size={18} />
          </button>
          <button
            className="icon-button"
            aria-label={t('dialogs.deleteDiagramTitle')}
            title={t('dialogs.deleteDiagramTitle')}
            onClick={() => open('delete')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="spatial-view-bar" role="group" aria-label={t('toolbar.diagramViewGroup')}>
        <button
          aria-label={t('toolbar.view2DAria')}
          aria-pressed={!spatial}
          onClick={() => switchView('2d')}
        >
          2D
        </button>
        <button
          aria-label={t('toolbar.view3DAria')}
          aria-pressed={spatial}
          onClick={() => switchView('3d')}
        >
          3D
        </button>
        <span>{spatial ? t('toolbar.spatialViewHint') : t('toolbar.overviewViewHint')}</span>
      </div>
      <div className="editor-toolbar">
        <div className="toolbar-group">
          {mindmap ? (
            <>
              <button
                className="add-node"
                title={t('toolbar.addSubtopicHint')}
                onClick={() => addTopic()}
              >
                <Plus size={15} />
                {graph.nodes.length ? t('toolbar.addSubtopic') : t('toolbar.centralIdea')}
              </button>
              <button
                className="sibling-button"
                title={t('toolbar.addSiblingHint')}
                disabled={!selectionCount}
                onClick={() => addTopic(true)}
              >
                <GitBranch size={14} />
                <span>{t('toolbar.sibling')}</span>
              </button>
            </>
          ) : (
            <>
              <select
                className="desktop-tools"
                aria-label={t('toolbar.nodeTypeField')}
                value={kind}
                onChange={(e) => setKind(e.target.value as NodeKind)}
              >
                {Object.entries(nodeRegistry).map(([k]) => (
                  <option key={k} value={k}>
                    {nodeKindLabel(t, k)}
                  </option>
                ))}
              </select>
              <button className="add-node" onClick={addNode}>
                <Plus size={15} />
                {t('toolbar.addNode')}
              </button>
            </>
          )}
          <button
            className="desktop-tools"
            title={t('toolbar.connectNodes')}
            aria-label={t('toolbar.connectNodes')}
            disabled={graph.nodes.length < 2}
            onClick={() => open('connect')}
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button
            title={t('toolbar.undoHint')}
            aria-label={t('toolbar.undo')}
            disabled={!history.length}
            onClick={() => useEditor.getState().undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            title={t('toolbar.redoHint')}
            aria-label={t('toolbar.redo')}
            disabled={!future.length}
            onClick={() => useEditor.getState().redo()}
          >
            <Redo2 size={16} />
          </button>
          <button
            className="desktop-tools"
            title={t('toolbar.groupHint')}
            aria-label={t('toolbar.groupSelection')}
            disabled={selectionCount < 2}
            onClick={() => useEditor.getState().group()}
          >
            <Layers size={16} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group layout-group desktop-tools">
          <select
            aria-label={t('toolbar.layoutDirection')}
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            {mindmap && <option value="BALANCED">{t('toolbar.balancedLayout')}</option>}
            <option value="RIGHT">{t('toolbar.leftRightLayout')}</option>
            <option value="DOWN">{t('toolbar.topBottomLayout')}</option>
            <option value="LEFT">{t('toolbar.rightLeftLayout')}</option>
            <option value="UP">{t('toolbar.bottomTopLayout')}</option>
            <option value="RADIAL">{t('toolbar.radialLayout')}</option>
          </select>
          <button
            disabled={spatial || busy || !graph.nodes.length}
            onClick={runLayout}
            title={spatial ? t('toolbar.arrangeNeeds2DHint') : undefined}
          >
            <GitBranch size={14} />
            {busy ? t('toolbar.layingOut') : t('toolbar.autoLayout')}
          </button>
        </div>
        <div className="toolbar-spacer" />
        {mindmap && (
          <button
            className={`desktop-tools ${focusMap ? 'active' : ''}`}
            aria-label={focusMap ? t('toolbar.exitMapFocus') : t('toolbar.focusMap')}
            title={focusMap ? t('toolbar.showPanelsHint') : t('toolbar.focusMapHint')}
            onClick={() => {
              useEditor.setState({ focusMap: !focusMap });
              setTimeout(() => {
                const current = useEditor.getState().graph;
                if (
                  current?.diagram.id === graph.diagram.id &&
                  getSpatialView(current).mode === '2d'
                )
                  void fitDiagram(flow, current, 0.14, 250, 1, flowStore.getState());
              }, 80);
            }}
          >
            {focusMap ? <Minimize2 size={14} /> : <Expand size={14} />}
            <span>{focusMap ? t('toolbar.exitFocusLabel') : t('toolbar.focusMap')}</span>
          </button>
        )}
        {graph.diagram.type === 'timeline' && (
          <select
            aria-label={t('toolbar.timelineZoom')}
            value={graph.diagram.settings.timelineScale ?? 'month'}
            onChange={(e) =>
              useEditor.getState().command('Timeline zoom', (g) => ({
                ...g,
                diagram: {
                  ...g.diagram,
                  settings: {
                    ...g.diagram.settings,
                    timelineScale: e.target.value as TimelineScale,
                  },
                },
              }))
            }
          >
            {(['day', 'week', 'month', 'quarter', 'year'] as const).map((v) => (
              <option key={v} value={v}>
                {t(timelineScaleKeys[v])}
              </option>
            ))}
          </select>
        )}
        <button className={`desktop-tools ${showFilters ? 'active' : ''}`} onClick={toggleFilters}>
          <SlidersHorizontal size={14} />
          {t('toolbar.filters')}
        </button>
        <ToolbarDataTools graph={graph} open={open} />
        <UnderstandingTools open={open} />
        <ToolbarMenu
          label={t('toolbar.examples')}
          icon={<LayoutTemplate size={15} />}
          className="desktop-tools"
        >
          <h3>{t('toolbar.examplesTitle')}</h3>
          <p>{t('toolbar.examplesHint')}</p>
          <button className="full" onClick={() => void newSpatialExample()}>
            {t('toolbar.truckExampleAction')}
          </button>
        </ToolbarMenu>
        <ToolbarMenu
          label={t('toolbar.moreTools')}
          icon={<MoreHorizontal size={20} />}
          className="mobile-only mobile-more"
          text={false}
        >
          <button
            className="full"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              void newSpatialExample();
            }}
          >
            {t('toolbar.truckExampleAction')}
          </button>
          <DataToolActions graph={graph} open={open} />
          <UnderstandingActions open={open} />
          <h3>{t('toolbar.importBuildTitle')}</h3>
          <button className="full" onClick={() => open('code')}>
            <Code2 size={17} />
            {t('toolbar.visualizeCode')}
          </button>
          <button className="full" onClick={() => open('sql')}>
            <Database size={17} />
            {t('toolbar.importSql')}
          </button>
          <button className="full" onClick={() => open('lovable')}>
            <Sparkles size={17} />
            {t('toolbar.buildLovable')}
          </button>
          <select
            aria-label={t('toolbar.mobileLayoutDirection')}
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            {mindmap && <option value="BALANCED">{t('toolbar.balancedLayout')}</option>}
            <option value="RIGHT">{t('toolbar.leftRightLayout')}</option>
            <option value="LEFT">{t('toolbar.rightLeftLayout')}</option>
            <option value="DOWN">{t('toolbar.topBottomLayout')}</option>
            <option value="UP">{t('toolbar.bottomTopLayout')}</option>
            <option value="RADIAL">{t('toolbar.radialLayout')}</option>
          </select>
          <button
            className="full"
            disabled={spatial || busy || !graph.nodes.length}
            onClick={(e) => {
              e.currentTarget.closest('details')?.removeAttribute('open');
              void runLayout();
            }}
          >
            <GitBranch size={17} />
            {t('toolbar.autoLayout')}
          </button>
          <button
            className="full"
            disabled={graph.nodes.length < 2}
            onClick={() => open('connect')}
          >
            <ArrowRight size={17} />
            {t('toolbar.connectNodes')}
          </button>
          <button
            className="full"
            onClick={(e) => {
              toggleFilters();
              e.currentTarget.closest('details')?.removeAttribute('open');
            }}
          >
            <SlidersHorizontal size={17} />
            {t('toolbar.filters')}
          </button>
          <button
            className="full"
            onClick={(e) => {
              useEditor.getState().select([]);
              useEditor.setState({ mobilePanel: 'details' });
              e.currentTarget.closest('details')?.removeAttribute('open');
            }}
          >
            <PanelRight size={17} />
            {t('toolbar.projectProperties')}
          </button>
          <button className="full" onClick={() => open('settings')}>
            <Settings size={17} />
            {t('app.settings')}
          </button>
          <button className="full danger" onClick={() => open('delete')}>
            <Trash2 size={17} />
            {t('dialogs.deleteDiagramTitle')}
          </button>
        </ToolbarMenu>
        <button
          aria-label={t('toolbar.fitDiagram')}
          title={t('toolbar.fitHint')}
          disabled={spatial}
          onClick={() =>
            void fitDiagram(flow, graph, mindmap ? 0.14 : 0.25, 0, undefined, flowStore.getState())
          }
        >
          <Maximize size={15} />
        </button>
      </div>
    </>
  );
}
export function FilterBar() {
  const { t } = useI18n();
  const filters = useEditor((s) => s.filters);
  const owners = useEditor((s) => s.owners);
  const graph = useEditor((s) => s.graph);
  const set = (patch: Partial<typeof filters>) =>
    useEditor.setState({ filters: { ...filters, ...patch } });
  return (
    <div className="filter-bar">
      <select
        aria-label={t('toolbar.filterOwner')}
        value={filters.owner}
        onChange={(e) => set({ owner: e.target.value })}
      >
        <option value="">{t('toolbar.allOwners')}</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t('toolbar.filterStatus')}
        value={filters.status}
        onChange={(e) => set({ status: e.target.value })}
      >
        <option value="">{t('toolbar.allStatuses')}</option>
        {[...new Set(graph?.nodes.map((n) => n.status).filter(Boolean))].map((v) => (
          <option key={v} value={v}>
            {statusLabel(t, v ?? '')}
          </option>
        ))}
      </select>
      <select
        aria-label={t('toolbar.filterNodeType')}
        value={filters.kind}
        onChange={(e) => set({ kind: e.target.value })}
      >
        <option value="">{t('toolbar.allTypes')}</option>
        {Object.entries(nodeRegistry).map(([k]) => (
          <option key={k} value={k}>
            {nodeKindLabel(t, k)}
          </option>
        ))}
      </select>
      <select
        aria-label={t('toolbar.filterNodeTags')}
        value={filters.tag}
        onChange={(e) => set({ tag: e.target.value })}
      >
        <option value="">{t('workspace.allTags')}</option>
        {[...new Set(graph?.nodes.flatMap((n) => n.tags))].filter(Boolean).map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input
        aria-label={t('toolbar.filterDatesFrom')}
        type="date"
        value={filters.from}
        onChange={(e) => set({ from: e.target.value })}
      />
      <input
        aria-label={t('toolbar.filterDatesTo')}
        type="date"
        value={filters.to}
        onChange={(e) => set({ to: e.target.value })}
      />
      <select
        aria-label={t('toolbar.filterVisibility')}
        value={filters.mode}
        onChange={(e) => set({ mode: e.target.value as 'dim' | 'hide' })}
      >
        <option value="dim">{t('toolbar.dimUnrelated')}</option>
        <option value="hide">{t('toolbar.hideUnrelated')}</option>
      </select>
      <button onClick={() => set({ owner: '', status: '', kind: '', tag: '', from: '', to: '' })}>
        {t('toolbar.resetFilters')}
      </button>
    </div>
  );
}
