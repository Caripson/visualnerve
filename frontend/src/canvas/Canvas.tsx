import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStoreApi,
  useViewport,
  type NodeChange,
  type EdgeChange,
  type Edge,
} from '@xyflow/react';
import { Crosshair, Grid3X3, Magnet, Map as MapIcon, Maximize, Pencil } from 'lucide-react';
import { useEditor } from '../state/editor';
import { descendantIds, type Graph, type GraphNode } from '../model/types';
import { dayMS, timelineGeometry, type Geometry } from '../layouts/layout';
import { nodeTypes } from '../nodes/registry';
import { edgeTypes } from '../mindmap/Branch';
import { SelectionTools } from '../ui/SelectionTools';
import { projectGraph, type CanvasNode, type NodeData, type RenderCache } from './projection';
import { DrawingOverlay } from '../drawing/DrawingOverlay';
import { getDrawingLayer } from '../drawing/types';
import { fitDiagram } from '../drawing/navigation';
import { exploreRelationshipsAsync } from '../analysis/client';
import { getExploration } from '../analysis/types';
import '../components/analysis-tools.css';
import { getSpatialView, setSpatialView, type SpatialCamera } from '../spatial/types';
import type { SpatialCanvasProps } from '../spatial/SpatialCanvas';
import {
  PRESENTATION_FOCUS,
  presentationFocus,
  presentationArrived,
  presentationViewportKey,
} from '../presentation/camera';
import { attachCanvasPresentationCamera } from '../presentation/canvas-camera';
function SpatialLoadFailure({ onReturnTo2D }: SpatialCanvasProps) {
  useEffect(() => {
    const focus = (event: Event) => {
      const request = presentationFocus(event);
      if (request)
        presentationArrived(request, 'The 3D view could not be loaded. Return to 2D to play.');
    };
    window.addEventListener(PRESENTATION_FOCUS, focus);
    return () => window.removeEventListener(PRESENTATION_FOCUS, focus);
  }, []);
  return (
    <div className="canvas-shell spatial-canvas">
      <p role="status">The 3D view could not be loaded. Continue editing in 2D.</p>
      <button onClick={onReturnTo2D}>Return to 2D</button>
    </div>
  );
}
const SpatialCanvas = lazy(() =>
  import('../spatial/SpatialCanvas')
    .then((module) => ({ default: module.SpatialCanvas }))
    .catch(() => ({ default: SpatialLoadFailure })),
);
const pendingExploration = {
  nodeIds: [],
  edgeIds: [],
  totalNodes: 0,
  truncated: false,
  found: false,
  outsideViewIds: [],
  outsideViewEdgeIds: [],
};

export function Canvas() {
  const graph = useEditor((s) => s.graph);
  const owners = useEditor((s) => s.owners);
  const selectedNodes = useEditor((s) => s.selectedNodes);
  const selectedEdges = useEditor((s) => s.selectedEdges);
  const drawingTool = useEditor((s) => s.drawingTool);
  const filters = useEditor((s) => s.filters);
  const explorationResult = useEditor((s) => s.explorationResult);
  const explorationBusy = useEditor((s) => s.explorationBusy);
  const explorationError = useEditor((s) => s.explorationError);
  const viewportRequest = useEditor((s) => s.viewportRequest);
  const spatial = graph ? getSpatialView(graph).mode === '3d' : false;
  const exploration = useMemo(
    () => (graph ? getExploration(graph) : undefined),
    [graph?.diagram.settings.relationshipExploration],
  );
  useEffect(() => {
    let current = true;
    if (!graph || !exploration) {
      useEditor.setState({ explorationResult: null, explorationBusy: false, explorationError: '' });
      return;
    }
    useEditor.setState({ explorationBusy: true, explorationError: '' });
    void exploreRelationshipsAsync(graph, exploration)
      .then((result) => {
        if (current) useEditor.setState({ explorationResult: result, explorationBusy: false });
      })
      .catch((error: Error) => {
        if (current)
          useEditor.setState({
            explorationResult: null,
            explorationBusy: false,
            explorationError: error.message,
          });
      });
    return () => {
      current = false;
    };
  }, [graph?.diagram.id, graph?.nodes, graph?.edges, exploration]);
  const dataCache = useRef(new Map<string, NodeData>());
  const renderCache = useRef<RenderCache>({ nodes: new Map(), edges: new Map() });
  const flow = useReactFlow<CanvasNode>();
  const flowStore = useStoreApi<CanvasNode>();
  const presentationViewport = useRef(false);
  const presentationViewports = useRef(new Set<string>());
  const interruptPresentation = useRef(() => {});
  const [minimap, setMinimap] = useState(true);
  const [touch, setTouch] = useState(
    () => matchMedia('(pointer: coarse), (max-width: 720px)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(pointer: coarse), (max-width: 720px)');
    const update = () => setTouch(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const commit = useCallback((moves: Map<string, Geometry>, relative = true) => {
    const s = useEditor.getState();
    if (!s.graph) return;
    const graph = s.graph;
    const index = new Map(graph.nodes.map((n) => [n.id, n]));
    const timeline =
      graph.diagram.type === 'timeline'
        ? timelineGeometry(graph.nodes, graph.diagram.settings.timelineScale ?? 'month')
        : null;
    const adjusted = new Map<string, Partial<GraphNode>>();
    for (const [id, position] of moves) {
      const n = index.get(id);
      if (!n) continue;
      const parent = n.parentId ? index.get(n.parentId) : undefined;
      const offset =
        relative && !timeline && parent?.nodeType === 'group'
          ? (moves.get(parent.id) ?? parent)
          : { x: 0, y: 0 };
      const x = position.x + offset.x,
        y = position.y + offset.y;
      if (timeline) {
        const date = new Date(timeline.origin + Math.round(x / timeline.pixelsPerDay) * dayMS)
          .toISOString()
          .slice(0, 10);
        const duration =
          n.startDate && n.endDate ? (Date.parse(n.endDate) - Date.parse(n.startDate)) / dayMS : 0;
        adjusted.set(id, {
          y,
          startDate: date,
          endDate: new Date(Date.parse(date) + duration * dayMS).toISOString().slice(0, 10),
        });
      } else {
        adjusted.set(id, {
          x,
          y,
          ...(position.width !== undefined ? { width: position.width } : {}),
          ...(position.height !== undefined ? { height: position.height } : {}),
        });
        if (n.nodeType === 'group')
          for (const child of descendantIds(graph.nodes, id))
            if (!moves.has(child)) {
              const c = index.get(child)!;
              adjusted.set(child, { x: c.x + x - n.x, y: c.y + y - n.y });
            }
      }
    }
    s.command('Move or resize nodes', (g) => ({
      ...g,
      nodes: g.nodes.map((n) => (adjusted.has(n.id) ? { ...n, ...adjusted.get(n.id) } : n)),
    }));
  }, []);
  const resize = useCallback(
    (id: string, p: Geometry) => {
      const g = useEditor.getState().graph;
      if (!g) return;
      if (g.diagram.type === 'timeline') {
        const geometry = timelineGeometry(g.nodes, g.diagram.settings.timelineScale ?? 'month');
        const date = new Date(geometry.origin + Math.round(p.x / geometry.pixelsPerDay) * dayMS)
          .toISOString()
          .slice(0, 10);
        useEditor.getState().updateNode(id, {
          startDate: date,
          endDate: new Date(
            Date.parse(date) +
              Math.max(0, Math.round((p.width ?? 180) / geometry.pixelsPerDay) - 1) * dayMS,
          )
            .toISOString()
            .slice(0, 10),
          y: p.y,
          height: p.height,
        });
      } else commit(new Map([[id, p]]));
    },
    [commit],
  );
  const projected = useMemo(
    () =>
      graph
        ? projectGraph(
            graph,
            owners,
            selectedNodes,
            selectedEdges,
            filters,
            false,
            resize,
            dataCache.current,
            renderCache.current,
            undefined,
            exploration ? (explorationResult ?? pendingExploration) : undefined,
          )
        : { nodes: [], edges: [] },
    [graph, owners, selectedNodes, selectedEdges, filters, resize, exploration, explorationResult],
  );
  const [nodes, setNodes] = useState<CanvasNode[]>(projected.nodes);
  const [edges, setEdges] = useState<Edge[]>(projected.edges);
  useEffect(() => setNodes(projected.nodes), [projected.nodes]);
  useEffect(() => setEdges(projected.edges), [projected.edges]);
  const diagramId = graph?.diagram.id;
  useEffect(() => {
    if (!diagramId || spatial) return;
    const camera = attachCanvasPresentationCamera(flow, {
      transient: (value) => {
        presentationViewport.current = value;
      },
      select: (id) => useEditor.setState({ selectedNodes: [id], selectedEdges: [] }),
      ignoreViewport: (viewport) => {
        const ignored = presentationViewports.current;
        ignored.add(`${diagramId}:${presentationViewportKey(viewport)}`);
        while (ignored.size > 8) ignored.delete(ignored.values().next().value!);
      },
    });
    interruptPresentation.current = () => camera.cancel('Camera movement interrupted.', true);
    return () => {
      camera.dispose();
      interruptPresentation.current = () => {};
    };
  }, [diagramId, flow, spatial, graph?.nodes, filters, explorationResult, touch]);
  useEffect(() => {
    const viewport = useEditor.getState().graph?.diagram.settings.viewport;
    if (!spatial && viewportRequest && viewport) {
      interruptPresentation.current();
      void flow.setViewport(viewport, { duration: 180 });
    }
  }, [viewportRequest, flow, spatial]);
  useEffect(() => {
    if (!graph || spatial) return;
    const frame = requestAnimationFrame(() => {
      const viewport = graph.diagram.settings.viewport;
      const touchView = graph.diagram.settings.viewportDevice === 'touch';
      if (viewport && touchView === touch) void flow.setViewport(viewport);
      else if (
        getDrawingLayer(graph.diagram.settings.drawing)?.visible &&
        getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length
      )
        void fitDiagram(
          flow,
          graph,
          graph.diagram.type === 'mindmap' ? 0.14 : 0.3,
          0,
          1,
          flowStore.getState(),
        );
      else if (touch && graph.diagram.type === 'mindmap') {
        const root = graph.nodes.find((node) => !node.parentId && node.nodeType !== 'group');
        void flow.fitView({
          ...(root ? { nodes: [{ id: root.id }] } : {}),
          padding: 0.25,
          maxZoom: 1,
        });
      } else
        void flow.fitView({ padding: graph.diagram.type === 'mindmap' ? 0.14 : 0.3, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [diagramId, touch, spatial]);
  const focus = useEditor((s) => s.focusNode);
  useEffect(() => {
    if (!focus || spatial) return;
    const node = flow.getNode(focus);
    if (node && !node.hidden) {
      if (useEditor.getState().editingNode === focus && graph?.diagram.type === 'mindmap') {
        const position = flow.getInternalNode(focus)?.internals.positionAbsolute ?? node.position;
        void flow.setCenter(
          position.x + (node.width ?? 180) / 2,
          position.y + (node.height ?? 60) / 2,
          { zoom: Math.max(0.8, Math.min(1.1, flow.getZoom())), duration: 180 },
        );
      } else void flow.fitView({ nodes: [node], maxZoom: 1.1, padding: 1, duration: 250 });
      useEditor.setState({ focusNode: null });
    }
  }, [focus, nodes, flow, spatial]);
  const changes = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const state = useEditor.getState();
    const selection = changes.filter((change) => change.type === 'select');
    if (selection.length) {
      const selected = new Set(state.selectedNodes);
      for (const change of selection) {
        if (change.selected) selected.add(change.id);
        else selected.delete(change.id);
      }
      state.select([...selected], state.selectedEdges);
    }
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);
  const edgeChanges = useCallback((changes: EdgeChange[]) => {
    const state = useEditor.getState();
    const selection = changes.filter((change) => change.type === 'select');
    if (selection.length) {
      const selected = new Set(state.selectedEdges);
      for (const change of selection) {
        if (change.selected) selected.add(change.id);
        else selected.delete(change.id);
      }
      state.select(state.selectedNodes, [...selected]);
    }
    setEdges((previous) => applyEdgeChanges(changes, previous));
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      const s = useEditor.getState();
      if (!s.graph || getSpatialView(s.graph).mode === '3d') return;
      if (s.drawingTool !== 'none') return;
      if (e.key.startsWith('Arrow') || e.key.toLowerCase() === 'f') interruptPresentation.current();
      if (e.key.startsWith('Arrow') && s.selectedNodes.length && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? 50 : 10;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        const ids = new Set(s.selectedNodes);
        for (const n of s.graph.nodes)
          if (ids.has(n.id) && n.nodeType === 'group')
            for (const child of descendantIds(s.graph.nodes, n.id)) ids.add(child);
        s.command(
          'Nudge nodes',
          (g) => ({
            ...g,
            nodes: g.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
          }),
          true,
        );
      }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void fitDiagram(flow, s.graph, 0.2);
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [flow]);
  const returnTo2D = useCallback(() => {
    useEditor.getState().command('2D view', (current) => setSpatialView(current, { mode: '2d' }));
  }, []);
  const saveCamera = useCallback(
    (camera: SpatialCamera) => {
      const state = useEditor.getState();
      if (
        !state.graph ||
        state.graph.diagram.id !== diagramId ||
        getSpatialView(state.graph).mode !== '3d'
      )
        return;
      if (JSON.stringify(getSpatialView(state.graph).camera) === JSON.stringify(camera)) return;
      state.command('3D camera', (current) => setSpatialView(current, { camera }), true);
    },
    [diagramId],
  );
  if (!graph) return null;
  if (spatial)
    return (
      <Suspense
        fallback={
          <div className="canvas-shell spatial-canvas">
            <p role="status">Loading 3D view…</p>
            <button onClick={returnTo2D}>Return to 2D</button>
          </div>
        }
      >
        <SpatialCanvas
          graph={graph}
          nodes={projected.nodes}
          edges={projected.edges}
          onReturnTo2D={returnTo2D}
          onCameraChange={saveCamera}
        />
      </Suspense>
    );
  const toggle = (key: 'grid' | 'snap') =>
    useEditor.getState().command(`Toggle ${key}`, (g) => ({
      ...g,
      diagram: {
        ...g.diagram,
        settings: { ...g.diagram.settings, [key]: !g.diagram.settings[key] },
      },
    }));
  return (
    <div
      className={`canvas-shell ${graph.diagram.type === 'mindmap' ? 'mindmap-canvas' : ''}`}
      data-testid="canvas"
      onPointerDownCapture={() => interruptPresentation.current()}
      onWheelCapture={() => interruptPresentation.current()}
    >
      <ReactFlow<CanvasNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={
          graph.diagram.type === 'mindmap' ? ConnectionMode.Loose : ConnectionMode.Strict
        }
        onNodesChange={changes}
        onEdgesChange={edgeChanges}
        onConnect={(c) => c.source && c.target && useEditor.getState().connect(c.source, c.target)}
        onReconnect={(edge, c) =>
          c.source &&
          c.target &&
          useEditor
            .getState()
            .updateEdge(edge.id, { sourceNodeId: c.source, targetNodeId: c.target })
        }
        onNodeDragStop={(_, node, moved) =>
          commit(new Map((moved.length ? moved : [node]).map((n) => [n.id, n.position])))
        }
        onSelectionDragStop={(_, moved) => commit(new Map(moved.map((n) => [n.id, n.position])))}
        onMoveEnd={(event, viewport) => {
          if (
            presentationViewport.current ||
            (!event &&
              presentationViewports.current.has(
                `${diagramId}:${presentationViewportKey(viewport)}`,
              ))
          )
            return;
          const s = useEditor.getState();
          if (
            s.graph &&
            s.graph.diagram.id === diagramId &&
            getSpatialView(s.graph).mode === '2d' &&
            (JSON.stringify(s.graph.diagram.settings.viewport) !== JSON.stringify(viewport) ||
              s.graph.diagram.settings.viewportDevice !== (touch ? 'touch' : 'desktop'))
          ) {
            useEditor.setState({
              graph: {
                ...s.graph,
                diagram: {
                  ...s.graph.diagram,
                  settings: {
                    ...s.graph.diagram.settings,
                    viewport,
                    viewportDevice: touch ? 'touch' : 'desktop',
                  },
                },
              },
              editRevision: s.editRevision + 1,
            });
          }
        }}
        deleteKeyCode={null}
        selectionOnDrag={!touch}
        selectionMode={SelectionMode.Partial}
        panOnDrag={touch ? true : [1, 2]}
        panActivationKeyCode="Space"
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        snapToGrid={!!graph.diagram.settings.snap}
        snapGrid={[20, 20]}
        minZoom={0.05}
        maxZoom={3}
        onlyRenderVisibleElements
        nodesFocusable
        edgesFocusable
        zoomOnDoubleClick={graph.diagram.type !== 'mindmap'}
      >
        {graph.diagram.settings.grid !== false && (
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--grid)" />
        )}
        {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <Panel position="top-center" className="selection-panel">
            <div className="context-toolbar">
              <SelectionTools />
            </div>
          </Panel>
        )}
        <Controls
          showInteractive={false}
          showFitView={
            !getDrawingLayer(graph.diagram.settings.drawing)?.visible ||
            !getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length
          }
        >
          {getDrawingLayer(graph.diagram.settings.drawing)?.visible &&
            !!getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length && (
              <ControlButton
                aria-label="Fit view"
                title="Fit view"
                onClick={() => void fitDiagram(flow, graph)}
              >
                <Maximize size={16} />
              </ControlButton>
            )}
        </Controls>
        <DrawingOverlay />
        {!!exploration && (
          <Panel position="top-left" className="analysis-canvas-notice">
            <strong>
              {exploration.mode === 'path' ? 'Relationship path' : 'Relationship neighborhood'}
            </strong>
            <span role="status">
              {explorationBusy
                ? 'Exploring…'
                : explorationError ||
                  (!explorationResult?.found
                    ? 'No matching path or visible starting object.'
                    : `${explorationResult.nodeIds.length} objects shown${explorationResult.truncated ? ' · bounded view; refine the exploration' : ''}`)}
            </span>
            {!!(
              (explorationResult?.outsideViewIds.length ?? 0) +
              (explorationResult?.outsideViewEdgeIds.length ?? 0)
            ) && <span>Groups marked “Outside current data view” retain earlier measures.</span>}
            <span>Object filters and collapsed branches are temporarily overridden.</span>
            <button onClick={() => useEditor.getState().explore()}>Reset exploration</button>
          </Panel>
        )}
        {minimap && (
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              (n.data as NodeData).mindmap?.color || (n.data as NodeData).node?.color || '#659d91'
            }
            maskColor="var(--minimap-mask)"
          />
        )}
        <Panel position="bottom-center">
          <div className="canvas-toggles">
            <button
              className={drawingTool !== 'none' ? 'active' : ''}
              title="Draw on diagram"
              aria-label="Draw on diagram"
              aria-pressed={drawingTool !== 'none'}
              onClick={() => {
                const state = useEditor.getState();
                if (state.drawingTool !== 'none') state.setDrawingTool('none');
                else {
                  if (getDrawingLayer(state.graph?.diagram.settings.drawing)?.visible === false)
                    state.toggleDrawingVisibility();
                  state.select([]);
                  useEditor.setState({ mobilePanel: null });
                  state.setDrawingTool('pen');
                }
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className={graph.diagram.settings.grid !== false ? 'active' : ''}
              title="Toggle grid"
              aria-label="Toggle grid"
              onClick={() => toggle('grid')}
            >
              <Grid3X3 size={15} />
            </button>
            <button
              className={graph.diagram.settings.snap ? 'active' : ''}
              title="Snap to grid"
              aria-label="Snap to grid"
              onClick={() => toggle('snap')}
            >
              <Magnet size={15} />
            </button>
            <button
              className={minimap ? 'active' : ''}
              title="Toggle minimap"
              aria-label="Toggle minimap"
              onClick={() => setMinimap((v) => !v)}
            >
              <MapIcon size={15} />
            </button>
            <span />
            <button
              title="Center selection"
              aria-label="Center selection"
              disabled={!selectedNodes.length}
              onClick={() =>
                void flow.fitView({
                  nodes: flow.getNodes().filter((n) => selectedNodes.includes(n.id)),
                  padding: 0.5,
                  maxZoom: 1,
                })
              }
            >
              <Crosshair size={15} />
            </button>
          </div>
        </Panel>
      </ReactFlow>
      {graph.diagram.type === 'timeline' && <TimelineRuler graph={graph} />}
      {graph.nodes.length === 0 &&
        drawingTool === 'none' &&
        !getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length && (
          <div className="canvas-empty">
            <BoxIcon />
            <h2>A little space for your next idea.</h2>
            <p>
              {graph.diagram.type === 'mindmap'
                ? 'Start with a central idea, then branch out.'
                : 'Add a node, then connect the dots.'}
            </p>
            <button className="primary" onClick={() => useEditor.getState().addNode()}>
              {graph.diagram.type === 'mindmap' ? 'Add your central idea' : 'Add your first node'}
            </button>
          </div>
        )}
    </div>
  );
}
function BoxIcon() {
  return <div className="empty-cross">＋</div>;
}
function TimelineRuler({ graph }: { graph: Graph }) {
  const view = useViewport();
  const timeline = timelineGeometry(graph.nodes, graph.diagram.settings.timelineScale ?? 'month');
  const step = { day: 1, week: 7, month: 30, quarter: 91, year: 365 }[
    graph.diagram.settings.timelineScale ?? 'month'
  ];
  const first = Math.floor(-view.x / view.zoom / timeline.pixelsPerDay / step);
  const count = Math.min(
    60,
    Math.ceil(1800 / Math.max(20, step * timeline.pixelsPerDay * view.zoom)) + 2,
  );
  return (
    <div className="timeline-ruler">
      {Array.from({ length: count }, (_, i) => {
        const day = (first + i) * step;
        const date = new Date(timeline.origin + day * dayMS);
        return (
          <span key={day} style={{ left: view.x + day * timeline.pixelsPerDay * view.zoom }}>
            {date.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: graph.diagram.settings.timelineScale === 'year' ? 'numeric' : undefined,
            })}
          </span>
        );
      })}
    </div>
  );
}
