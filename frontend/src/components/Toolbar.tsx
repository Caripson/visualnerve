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
import { statusLabel } from '../ui/status';
import { getSpatialView, setSpatialView } from '../spatial/types';
import { createSpatialExample } from '../spatial/examples';
import { workspace } from '../storage/workspace';
import { ToolbarMenu } from './ToolbarMenu';
import { DataToolActions, ToolbarDataTools } from './ToolbarDataTools';
import { UnderstandingActions, UnderstandingTools } from './UnderstandingTools';
export function Toolbar({
  open,
  showFilters,
  toggleFilters,
}: {
  open: (name: DialogName) => void;
  showFilters: boolean;
  toggleFilters: () => void;
}) {
  const graph = useEditor((s) => s.graph);
  const history = useEditor((s) => s.history);
  const future = useEditor((s) => s.future);
  const selectionCount = useEditor((s) => s.selectedNodes.length);
  const status = useEditor((s) => s.status);
  const focusMap = useEditor((s) => s.focusMap);
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
        await fitDiagram(flow, laidOut, laidOut.diagram.type === 'mindmap' ? 0.14 : 0.25, 250);
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
  return (
    <>
      <div className="document-bar">
        <button
          className="mobile-only project-menu"
          aria-label="Open projects"
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
                saved: 'Saved',
                saving: 'Saving…',
                error: 'Error',
                conflict: 'Conflict',
              }[status]
            }
          </span>
          <button
            aria-label="Diagram player"
            onClick={() => {
              useEditor.getState().finishEditing();
              presentation.open();
            }}
          >
            <Clapperboard size={15} />
            <span>Player</span>
          </button>
          <button aria-label="Export" onClick={() => open('export')}>
            <Download size={14} />
            <span>Export</span>
          </button>
          <button
            className="desktop-tools"
            aria-label="Build with Lovable"
            onClick={() => open('lovable')}
          >
            <Sparkles size={14} />
            <span>Build with Lovable</span>
          </button>
          <button
            className="mobile-only"
            aria-label="Open properties"
            onClick={() => useEditor.setState({ mobilePanel: 'details' })}
          >
            <PanelRight size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Delete diagram"
            title="Delete diagram"
            onClick={() => open('delete')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="spatial-view-bar" role="group" aria-label="Diagram view">
        <button aria-label="2D view" aria-pressed={!spatial} onClick={() => switchView('2d')}>
          2D
        </button>
        <button aria-label="3D view" aria-pressed={spatial} onClick={() => switchView('3d')}>
          3D
        </button>
        <span>{spatial ? 'Rotate to explore · export uses 2D' : 'Overview · draw and export'}</span>
      </div>
      <div className="editor-toolbar">
        <div className="toolbar-group">
          {mindmap ? (
            <>
              <button className="add-node" title="Add subtopic (Tab)" onClick={() => addTopic()}>
                <Plus size={15} />
                {graph.nodes.length ? 'Add subtopic' : 'Central idea'}
              </button>
              <button
                className="sibling-button"
                title="Add sibling (Enter)"
                disabled={!selectionCount}
                onClick={() => addTopic(true)}
              >
                <GitBranch size={14} />
                <span>Sibling</span>
              </button>
            </>
          ) : (
            <>
              <select
                className="desktop-tools"
                aria-label="New node type"
                value={kind}
                onChange={(e) => setKind(e.target.value as NodeKind)}
              >
                {Object.entries(nodeRegistry).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button
                className="add-node"
                onClick={() => {
                  const rect = document.querySelector('.canvas-shell')?.getBoundingClientRect();
                  const point =
                    rect && !spatial
                      ? flow.screenToFlowPosition({
                          x: rect.left + rect.width / 2 - 100,
                          y: rect.top + rect.height / 2 - 43,
                        })
                      : undefined;
                  useEditor.getState().addNode({ nodeType: kind, ...point });
                }}
              >
                <Plus size={15} />
                Add node
              </button>
            </>
          )}
          <button
            className="desktop-tools"
            title="Connect nodes"
            aria-label="Connect nodes"
            disabled={graph.nodes.length < 2}
            onClick={() => open('connect')}
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button
            title="Undo (Ctrl/Cmd Z)"
            aria-label="Undo"
            disabled={!history.length}
            onClick={() => useEditor.getState().undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            title="Redo (Ctrl/Cmd Shift Z)"
            aria-label="Redo"
            disabled={!future.length}
            onClick={() => useEditor.getState().redo()}
          >
            <Redo2 size={16} />
          </button>
          <button
            className="desktop-tools"
            title="Group selection (Ctrl/Cmd G)"
            aria-label="Group selection"
            disabled={selectionCount < 2}
            onClick={() => useEditor.getState().group()}
          >
            <Layers size={16} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group layout-group desktop-tools">
          <select
            aria-label="Layout direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            {mindmap && <option value="BALANCED">Balanced branches</option>}
            <option value="RIGHT">Left → Right</option>
            <option value="DOWN">Top → Bottom</option>
            <option value="LEFT">Right → Left</option>
            <option value="UP">Bottom → Top</option>
            <option value="RADIAL">Radial</option>
          </select>
          <button
            disabled={spatial || busy || !graph.nodes.length}
            onClick={runLayout}
            title={spatial ? 'Switch to 2D to arrange the overview' : undefined}
          >
            <GitBranch size={14} />
            {busy ? 'Laying out…' : 'Auto layout'}
          </button>
        </div>
        <div className="toolbar-spacer" />
        {mindmap && (
          <button
            className={`desktop-tools ${focusMap ? 'active' : ''}`}
            aria-label={focusMap ? 'Exit map focus' : 'Focus map'}
            title={focusMap ? 'Show workspace panels' : 'Give the map the whole workspace'}
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
            <span>{focusMap ? 'Exit focus' : 'Focus map'}</span>
          </button>
        )}
        {graph.diagram.type === 'timeline' && (
          <select
            aria-label="Timeline zoom"
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
            {['day', 'week', 'month', 'quarter', 'year'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        )}
        <button className={`desktop-tools ${showFilters ? 'active' : ''}`} onClick={toggleFilters}>
          <SlidersHorizontal size={14} />
          Filters
        </button>
        <ToolbarDataTools graph={graph} open={open} />
        <UnderstandingTools open={open} />
        <ToolbarMenu label="Examples" icon={<LayoutTemplate size={15} />} className="desktop-tools">
          <h3>Diagram examples</h3>
          <p>Start a separate diagram to explore an example.</p>
          <button className="full" onClick={() => void newSpatialExample()}>
            New 3D truck lifecycle example
          </button>
        </ToolbarMenu>
        <ToolbarMenu
          label="More tools"
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
            New 3D truck lifecycle example
          </button>
          <DataToolActions graph={graph} open={open} />
          <UnderstandingActions open={open} />
          <h3>Import and build</h3>
          <button className="full" onClick={() => open('code')}>
            <Code2 size={17} />
            Visualize code
          </button>
          <button className="full" onClick={() => open('sql')}>
            <Database size={17} />
            Import SQL script
          </button>
          <button className="full" onClick={() => open('lovable')}>
            <Sparkles size={17} />
            Build with Lovable
          </button>
          <select
            aria-label="Mobile layout direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            {mindmap && <option value="BALANCED">Balanced branches</option>}
            <option value="RIGHT">Left → Right</option>
            <option value="LEFT">Right → Left</option>
            <option value="DOWN">Top → Bottom</option>
            <option value="UP">Bottom → Top</option>
            <option value="RADIAL">Radial</option>
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
            Auto layout
          </button>
          <button
            className="full"
            disabled={graph.nodes.length < 2}
            onClick={() => open('connect')}
          >
            <ArrowRight size={17} />
            Connect nodes
          </button>
          <button
            className="full"
            onClick={(e) => {
              toggleFilters();
              e.currentTarget.closest('details')?.removeAttribute('open');
            }}
          >
            <SlidersHorizontal size={17} />
            Filters
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
            Project properties
          </button>
          <button className="full" onClick={() => open('settings')}>
            <Settings size={17} />
            Settings
          </button>
          <button className="full danger" onClick={() => open('delete')}>
            <Trash2 size={17} />
            Delete diagram
          </button>
        </ToolbarMenu>
        <button
          aria-label="Fit diagram"
          title="Fit diagram (F)"
          disabled={spatial}
          onClick={() => void fitDiagram(flow, graph, mindmap ? 0.14 : 0.25)}
        >
          <Maximize size={15} />
        </button>
      </div>
    </>
  );
}
export function FilterBar() {
  const filters = useEditor((s) => s.filters);
  const owners = useEditor((s) => s.owners);
  const graph = useEditor((s) => s.graph);
  const set = (patch: Partial<typeof filters>) =>
    useEditor.setState({ filters: { ...filters, ...patch } });
  return (
    <div className="filter-bar">
      <select
        aria-label="Filter owner"
        value={filters.owner}
        onChange={(e) => set({ owner: e.target.value })}
      >
        <option value="">All owners</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter status"
        value={filters.status}
        onChange={(e) => set({ status: e.target.value })}
      >
        <option value="">All statuses</option>
        {[...new Set(graph?.nodes.map((n) => n.status).filter(Boolean))].map((v) => (
          <option key={v} value={v}>
            {statusLabel(v)}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter node type"
        value={filters.kind}
        onChange={(e) => set({ kind: e.target.value })}
      >
        <option value="">All types</option>
        {Object.entries(nodeRegistry).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter node tags"
        value={filters.tag}
        onChange={(e) => set({ tag: e.target.value })}
      >
        <option value="">All tags</option>
        {[...new Set(graph?.nodes.flatMap((n) => n.tags))].filter(Boolean).map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input
        aria-label="Filter dates from"
        type="date"
        value={filters.from}
        onChange={(e) => set({ from: e.target.value })}
      />
      <input
        aria-label="Filter dates to"
        type="date"
        value={filters.to}
        onChange={(e) => set({ to: e.target.value })}
      />
      <select
        aria-label="Filter visibility"
        value={filters.mode}
        onChange={(e) => set({ mode: e.target.value as 'dim' | 'hide' })}
      >
        <option value="dim">Dim unrelated</option>
        <option value="hide">Hide unrelated</option>
      </select>
      <button onClick={() => set({ owner: '', status: '', kind: '', tag: '', from: '', to: '' })}>
        Reset
      </button>
    </div>
  );
}
