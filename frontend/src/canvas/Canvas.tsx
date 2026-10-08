import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
import { Maximize } from 'lucide-react';
import { CanvasTools } from './CanvasTools';
import { COMPACT_LAYOUT_QUERY } from '../hooks/useCompactLayout';
import { useEditor } from '../state/editor';
import { descendantIds, type Graph, type GraphNode } from '../model/types';
import { dayMS, timelineGeometry, type Geometry } from '../layouts/layout';
import {
  overviewNodeTypes as nodeTypes,
  overviewEdgeTypes as edgeTypes,
} from '../overview/renderers';
import { projectOverview } from '../overview/projection';
import { OverviewControls, OVERVIEW_RESET_VIEW } from '../overview/Controls';
import { getOverviewConfig, isOverviewGroupId, isOverviewEdgeId } from '../overview/types';
import { useOverviewZoom } from '../overview/useZoom';
import {
  useOverviewPreview,
  releaseOverview,
  publishOverview,
  clearRenderedOverview,
  OVERVIEW_RESTORE_VIEW,
} from '../overview/runtime';
import { revealOverviewTargets } from '../overview/reveal';
import { SelectionTools } from '../ui/SelectionTools';
import { projectGraph, type CanvasNode, type NodeData, type RenderCache } from './projection';
import { canvasViewportGraph, persistCanvasFocus } from './navigation';
import { canvasFitPadding } from './fit-padding';
import { useResponsiveCanvasViewport } from './useResponsiveCanvasViewport';
import { DrawingOverlay } from '../drawing/DrawingOverlay';
import { ParticleOverlay } from '../simulation/ParticleOverlay';
import { ProcessStartPanel } from '../simulation/ProcessWizard';
import { ProcessHierarchyNav } from '../simulation/ProcessHierarchyNav';
import { ProcessProjection, getSimulationProcessId } from '../simulation/process-projection';
import { ProcessViewLayout } from '../simulation/process-view-layout';
import {
  openSimulationProcess,
  processOverview,
  useProcessNavigation,
} from '../simulation/process-navigation';
import { useSimulation } from '../simulation/useSimulation';
import {
  logicalNodeId,
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../simulation/render-model';
import { getDrawingLayer } from '../drawing/types';
import { fitDiagram } from '../drawing/navigation';
import { exploreRelationshipsAsync } from '../analysis/client';
import { getExploration } from '../analysis/types';
import '../components/analysis-tools.css';
import { getSpatialView, setSpatialView, type SpatialCamera } from '../spatial/types';
import { SpatialLoadFailure } from '../spatial/SpatialLoadFailure';
import {
  presentationViewportKey,
  PRESENTATION_RELEASE,
  PRESENTATION_REVEAL,
  type PresentationRevealRequest,
  capturePresentationView,
} from '../presentation/camera';
import { attachCanvasPresentationCamera } from '../presentation/canvas-camera';
import { presentation } from '../presentation/service';
import { VIDEO_CANVAS_INFO, type VideoCanvasInfoRequest } from '../presentation/video-frame-events';
import { absoluteCanvasMoves, canonicalGeometry, isReadonlyCanvasNode } from './logical-geometry';
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
  const presentationOpen = useSyncExternalStore(
    presentation.subscribe,
    () => {
      const player = presentation.getState();
      return player.open && player.diagramId === graph?.diagram.id;
    },
    () => false,
  );
  const drawingTool = useEditor((s) => s.drawingTool);
  const filters = useEditor((s) => s.filters);
  const explorationResult = useEditor((s) => s.explorationResult);
  const explorationBusy = useEditor((s) => s.explorationBusy);
  const explorationError = useEditor((s) => s.explorationError);
  const viewportRequest = useEditor((s) => s.viewportRequest);
  const simulationView = useSimulation(graph?.simulation ? graph.diagram.id : undefined);
  const spatial = graph ? getSpatialView(graph).mode === '3d' : false;
  const simulationProjection = useMemo(
    () =>
      graph?.simulation ? projectSimulationRenderModel(graph, simulationView?.run) : undefined,
    [
      graph,
      simulationView?.run.model,
      simulationView?.run.options.scenarioId,
      simulationView?.run.options.demandMultiplier,
    ],
  );
  const capacityProjection =
    graph && simulationProjection && !spatial
      ? projectSimulationCapacityNodes(graph, simulationProjection, simulationView?.state)
      : undefined;
  const capacityGraph = useMemo(
    () =>
      graph && capacityProjection
        ? { ...graph, nodes: capacityProjection.nodes, edges: capacityProjection.edges }
        : graph && simulationProjection
          ? { ...graph, edges: simulationProjection.edges }
          : graph,
    [graph, simulationProjection, capacityProjection],
  );
  const processView = useProcessNavigation((state) =>
    graph ? (state.views[graph.diagram.id] ?? processOverview) : processOverview,
  );
  const processProjector = useMemo(
    () => simulationProjection && new ProcessProjection(simulationProjection.model),
    [simulationProjection?.model],
  );
  const processProjection = useMemo(
    () =>
      capacityGraph &&
      processProjector &&
      !spatial &&
      !presentationOpen &&
      !(graph && getExploration(graph))
        ? processProjector.project(capacityGraph, processView)
        : undefined,
    [
      capacityGraph,
      processProjector,
      processView,
      spatial,
      presentationOpen,
      graph?.diagram.settings.relationshipExploration,
    ],
  );
  const renderGraph = processProjection?.graph ?? capacityGraph;
  const projectedIds = useMemo(
    () =>
      new Set(
        renderGraph?.nodes
          .filter((node) => isReadonlyCanvasNode(node) && node.metadata.simulationProjected)
          .map((node) => node.id),
      ),
    [renderGraph?.nodes],
  );
  const layoutOnlyIds = useRef(new Set<string>());
  layoutOnlyIds.current = new Set(
    renderGraph?.nodes
      .filter(
        (node) => node.metadata.simulationLayoutProjected && !node.metadata.simulationProjected,
      )
      .map((node) => node.id),
  );
  const readonlyEdges = useRef(new Set<string>());
  readonlyEdges.current = new Set(
    renderGraph?.edges.filter((edge) => edge.metadata.simulationProcessEdge).map((edge) => edge.id),
  );
  const readonlyNodes = useRef(projectedIds);
  readonlyNodes.current = new Set([...projectedIds, ...layoutOnlyIds.current]);
  const renderedNodes = useRef(new Map<string, GraphNode>());
  renderedNodes.current = new Map(renderGraph?.nodes.map((node) => [node.id, node]));
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
  const focusNavigation = useRef(0);
  const [minimap, setMinimap] = useState(true);
  const [touch, setTouch] = useState(
    () => matchMedia(`(pointer: coarse), ${COMPACT_LAYOUT_QUERY}`).matches,
  );
  const fitProcessNodes = useCallback(
    () =>
      new ProcessViewLayout()
        .fitNodeIds(
          renderGraph?.nodes ?? [],
          processProjection?.focusNodeIds ?? [],
          flowStore.getState(),
          touch,
        )
        .map((id) => ({ id })),
    [renderGraph?.nodes, processProjection?.focusNodeIds, flowStore, touch],
  );
  useEffect(() => {
    const media = matchMedia(`(pointer: coarse), ${COMPACT_LAYOUT_QUERY}`);
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
    const geometryNodes = new Map(index);
    for (const [id, node] of renderedNodes.current) geometryNodes.set(id, node);
    const absolute = relative && !timeline ? absoluteCanvasMoves(geometryNodes, moves) : moves;
    for (const [id, position] of absolute) {
      if (readonlyNodes.current.has(id)) continue;
      const n = index.get(id);
      if (!n) continue;
      const { x, y } = position;
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
        const geometry = canonicalGeometry(n, renderedNodes.current.get(id), {
          x,
          y,
          ...(position.width !== undefined ? { width: position.width } : {}),
          ...(position.height !== undefined ? { height: position.height } : {}),
        });
        adjusted.set(id, geometry);
        if (n.nodeType === 'group')
          for (const child of descendantIds(graph.nodes, id))
            if (!moves.has(child) && !readonlyNodes.current.has(child)) {
              const c = index.get(child)!;
              adjusted.set(child, { x: c.x + geometry.x - n.x, y: c.y + geometry.y - n.y });
            }
      }
    }
    if (!adjusted.size) return;
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
  const baseProjected = useMemo(
    () =>
      renderGraph
        ? projectGraph(
            renderGraph,
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
    [
      renderGraph,
      owners,
      selectedNodes,
      selectedEdges,
      filters,
      resize,
      exploration,
      explorationResult,
    ],
  );
  const overviewZoom = useOverviewZoom(graph?.diagram.id, spatial);
  const zoomLevel = overviewZoom.level;
  const preview = useOverviewPreview();
  const zooms = [0.1, 0.3, 0.8, 1.5];
  const overviewZoomRef = useRef(zooms[zoomLevel]);
  overviewZoomRef.current = zooms[zoomLevel];
  const overview = useMemo(
    () =>
      renderGraph
        ? projectOverview(renderGraph, baseProjected.nodes, baseProjected.edges, {
            zoom: preview.diagramId === renderGraph.diagram.id ? preview.zoom : zooms[zoomLevel],
            revealNodeIds:
              preview.diagramId === renderGraph.diagram.id ? preview.nodeIds : undefined,
          })
        : undefined,
    [renderGraph, baseProjected, preview, zoomLevel],
  );
  const projected = overview ?? baseProjected;
  const particleVisibility = useMemo(
    () => ({
      nodeIds: new Set(projected.nodes.filter((node) => !node.hidden).map((node) => node.id)),
      edgeIds: new Set(projected.edges.filter((edge) => !edge.hidden).map((edge) => edge.id)),
    }),
    [projected.nodes, projected.edges],
  );
  const projectedRef = useRef(projected);
  projectedRef.current = projected;
  useEffect(() => {
    if (renderGraph && overview) publishOverview(renderGraph, overview);
  }, [renderGraph, overview]);
  useEffect(() => {
    const id = graph?.diagram.id;
    return () => {
      if (id) clearRenderedOverview(id);
    };
  }, [graph?.diagram.id]);
  const revealPresentation = useCallback(
    async (ids: string[], signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const current = useEditor.getState().graph;
      if (!current) return;
      await revealOverviewTargets(current, ids, {
        zoom: overviewZoomRef.current,
        ready: (id) => projectedRef.current.nodes.some((node) => node.id === id && !node.hidden),
        captureView: capturePresentationView,
        signal,
      });
    },
    [graph?.diagram.id],
  );
  const [nodes, setNodes] = useState<CanvasNode[]>(projected.nodes);
  const [edges, setEdges] = useState<Edge[]>(projected.edges);
  useEffect(() => setNodes(projected.nodes), [projected.nodes]);
  useEffect(() => setEdges(projected.edges), [projected.edges]);
  const diagramId = graph?.diagram.id;
  const processViewKey = `${processView.mode}:${processView.processId ?? ''}`;
  useEffect(() => {
    if (!processProjection?.active && !processProjector?.hierarchy.processes.size) return;
    useEditor.getState().select([]);
    if (spatial) return;
    const frame = requestAnimationFrame(() => {
      if (!processProjection?.active && graph?.diagram.settings.viewport) {
        void flow.setViewport(graph.diagram.settings.viewport, { duration: 180 });
        return;
      }
      const focusNodes = fitProcessNodes();
      void flow.fitView({
        ...(focusNodes.length ? { nodes: focusNodes } : {}),
        padding: 0.16,
        minZoom: processProjection?.active ? 0.72 : 0.05,
        maxZoom: touch ? 0.9 : 1,
        duration: 180,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    diagramId,
    processViewKey,
    spatial,
    touch,
    !!processProjector?.hierarchy.processes.size,
    flow,
  ]);

  useEffect(() => {
    if (!diagramId) return;
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<PresentationRevealRequest>).detail;
      if (
        !Array.isArray(detail?.nodeIds) ||
        typeof detail.respond !== 'function' ||
        typeof detail.error !== 'function'
      )
        return;
      void revealPresentation(detail.nodeIds, detail.signal).then(
        () => detail.respond(),
        (error) => detail.error(error instanceof Error ? error.message : 'Overview reveal failed.'),
      );
    };
    const release = () => releaseOverview(diagramId);
    window.addEventListener(PRESENTATION_REVEAL, reveal);
    window.addEventListener(PRESENTATION_RELEASE, release);
    return () => {
      window.removeEventListener(PRESENTATION_REVEAL, reveal);
      window.removeEventListener(PRESENTATION_RELEASE, release);
      release();
    };
  }, [diagramId, revealPresentation]);
  useEffect(() => {
    if (!diagramId || spatial) return;
    const restore = (event: Event) => {
      const view = (event as CustomEvent<import('../presentation/storyboard').StoryboardView>)
        .detail;
      const current = useEditor.getState().graph;
      if (
        view?.mode !== '2d' ||
        current?.diagram.id !== diagramId ||
        !getOverviewConfig(current).enabled
      )
        return;
      presentationViewports.current.add(`${diagramId}:${presentationViewportKey(view.viewport)}`);
      void flow.setViewport(view.viewport, { duration: 0 });
    };
    window.addEventListener(OVERVIEW_RESTORE_VIEW, restore);
    return () => window.removeEventListener(OVERVIEW_RESTORE_VIEW, restore);
  }, [diagramId, spatial, flow]);
  useEffect(() => {
    if (!diagramId || spatial) return;
    const receive = (event: Event) => {
      const callback = (event as CustomEvent<VideoCanvasInfoRequest>).detail?.receive;
      const graph = useEditor.getState().graph;
      const host = flowStore.getState().domNode;
      if (typeof callback !== 'function' || !graph || graph.diagram.id !== diagramId || !host)
        return;
      let viewport = flow.getViewport();
      const element = host.querySelector<HTMLElement>('.react-flow__viewport');
      if (element && typeof DOMMatrixReadOnly !== 'undefined') {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        if (Number.isFinite(matrix.a) && matrix.a > 0)
          viewport = { x: matrix.e, y: matrix.f, zoom: matrix.a };
      }
      callback({
        graph,
        host,
        nodes: flow.getNodes(),
        edges: flow.getEdges(),
        viewport,
        overviewActive: overview?.active,
        width: host.clientWidth || flowStore.getState().width,
        height: host.clientHeight || flowStore.getState().height,
        absolute: (id) => flow.getInternalNode(id)?.internals.positionAbsolute,
      });
    };
    window.addEventListener(VIDEO_CANVAS_INFO, receive);
    return () => window.removeEventListener(VIDEO_CANVAS_INFO, receive);
  }, [diagramId, flow, flowStore, spatial, overview?.active]);
  useEffect(() => {
    if (!diagramId || spatial) return;
    const camera = attachCanvasPresentationCamera(flow, {
      viewportSize: () => {
        const { width, height } = flowStore.getState();
        return { width, height };
      },
      transient: (value) => {
        presentationViewport.current = value;
      },
      select: (id) => useEditor.setState({ selectedNodes: [id], selectedEdges: [] }),
      selectMany: (nodeIds, edgeIds) =>
        useEditor.setState({ selectedNodes: nodeIds, selectedEdges: edgeIds }),
      reveal: (request) => revealPresentation(request.nodeIds ?? [request.nodeId]),
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
  }, [diagramId, flow, flowStore, spatial, graph?.nodes, filters, explorationResult, touch]);
  useEffect(() => {
    const viewport = useEditor.getState().graph?.diagram.settings.viewport;
    if (!spatial && viewportRequest) {
      interruptPresentation.current();
      if (viewport) void flow.setViewport(viewport, { duration: 180 });
      else {
        // Guided creation clears the empty canvas camera; reveal its newly rendered process.
        const frame = requestAnimationFrame(() => {
          void flow.fitView({
            ...(processProjection?.active && processProjection.focusNodeIds.length
              ? { nodes: fitProcessNodes(), minZoom: 0.72 }
              : {}),
            padding: 0.16,
            maxZoom: 1,
            duration: 180,
          });
        });
        return () => cancelAnimationFrame(frame);
      }
    }
  }, [viewportRequest, flow, spatial]);
  useEffect(() => {
    if (!graph || spatial) return;
    const frame = requestAnimationFrame(() => {
      if (getOverviewConfig(graph).enabled) {
        window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW));
        return;
      }
      const viewport = graph.diagram.settings.viewport;
      const touchView = graph.diagram.settings.viewportDevice === 'touch';
      if (viewport && touchView === touch && !processProjection?.active)
        void flow.setViewport(viewport);
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
      } else if (touch && graph.simulation) {
        // Start at a readable process step. Fit remains available for the whole system.
        const work = graph.simulation.nodes.find((node) => node.type === 'work');
        void flow.fitView({
          ...(processProjection?.active
            ? { nodes: fitProcessNodes(), minZoom: 0.72 }
            : work
              ? { nodes: [{ id: work.id }] }
              : {}),
          padding: 0.25,
          maxZoom: 0.9,
        });
      } else
        void flow.fitView({
          ...(processProjection?.active && processProjection.focusNodeIds.length
            ? { nodes: fitProcessNodes(), minZoom: 0.72 }
            : {}),
          padding: graph.diagram.type === 'mindmap' ? 0.14 : processProjection?.active ? 0.16 : 0.3,
          maxZoom: 1,
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [diagramId, touch, spatial]);
  const persistViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      if (processProjection?.active) return;
      const state = useEditor.getState();
      const next = canvasViewportGraph(state.graph, diagramId, viewport, touch);
      if (next) useEditor.setState({ graph: next, editRevision: state.editRevision + 1 });
    },
    [diagramId, touch, processProjection?.active],
  );
  useEffect(
    () => () => {
      focusNavigation.current++;
    },
    [diagramId, spatial],
  );
  const focus = useEditor((s) => s.focusNode);
  useEffect(() => {
    if (!focus || spatial) return;
    const node = flow.getNode(focus);
    if (node && !node.hidden) {
      const generation = ++focusNavigation.current;
      let completion: Promise<boolean>;
      if (useEditor.getState().editingNode === focus && graph?.diagram.type === 'mindmap') {
        const position = flow.getInternalNode(focus)?.internals.positionAbsolute ?? node.position;
        completion = flow.setCenter(
          position.x + (node.width ?? 180) / 2,
          position.y + (node.height ?? 60) / 2,
          { zoom: Math.max(0.8, Math.min(1.1, flow.getZoom())), duration: 180 },
        );
      } else completion = flow.fitView({ nodes: [node], maxZoom: 1.1, padding: 1, duration: 250 });
      if (diagramId)
        void persistCanvasFocus({
          completion,
          diagramId,
          nodeId: focus,
          active: () => generation === focusNavigation.current && !presentationViewport.current,
          current: useEditor.getState,
          viewport: () => flow.getViewport(),
          persist: persistViewport,
        }).catch(() => {});
      useEditor.setState({ focusNode: null });
    }
  }, [focus, nodes, flow, spatial, diagramId, persistViewport]);
  const changes = useCallback((changes: NodeChange<CanvasNode>[]) => {
    changes = changes.filter(
      (change) =>
        !('id' in change && readonlyNodes.current.has(change.id)) ||
        change.type === 'dimensions' ||
        (change.type === 'select' && layoutOnlyIds.current.has(change.id)),
    );
    const state = useEditor.getState();
    const selection = changes.filter((change) => change.type === 'select');
    if (selection.length) {
      const selected = new Set(state.selectedNodes);
      for (const change of selection) {
        if (isOverviewGroupId(change.id)) continue;
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
        if (isOverviewEdgeId(change.id) || readonlyEdges.current.has(change.id)) continue;
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
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[data-node-scroll]',
        )
      )
        return;
      const s = useEditor.getState();
      if (!s.graph || getSpatialView(s.graph).mode === '3d') return;
      if (s.drawingTool !== 'none') return;
      if (e.key.startsWith('Arrow') || e.key.toLowerCase() === 'f') interruptPresentation.current();
      if (e.key.startsWith('Arrow') && s.selectedNodes.length && !e.ctrlKey && !e.metaKey) {
        if (overview?.active) return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? 50 : 10;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        const ids = new Set(s.selectedNodes);
        for (const id of readonlyNodes.current) ids.delete(id);
        if (!ids.size) return;
        for (const n of s.graph.nodes)
          if (ids.has(n.id) && n.nodeType === 'group')
            for (const child of descendantIds(s.graph.nodes, n.id))
              if (!readonlyNodes.current.has(child)) ids.add(child);
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
        if (processProjection?.active)
          void flow.fitView({
            nodes: touch ? renderGraph?.nodes.map((node) => ({ id: node.id })) : fitProcessNodes(),
            padding: canvasFitPadding(0.16, flowStore.getState().domNode),
            minZoom: touch ? 0.05 : 0.72,
            maxZoom: 1,
            duration: 180,
          });
        else void fitDiagram(flow, s.graph, 0.2, 0, undefined, flowStore.getState());
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [
    flow,
    overview?.active,
    processProjection?.active,
    fitProcessNodes,
    touch,
    renderGraph?.nodes,
  ]);
  useEffect(() => {
    if (spatial) return;
    const reset = () => {
      const graph = useEditor.getState().graph;
      if (!graph) return;
      const enabled = (graph.diagram.settings.overview as { enabled?: boolean } | undefined)
        ?.enabled;
      releaseOverview(graph.diagram.id);
      if (!enabled && graph.diagram.settings.viewport) {
        const viewport = graph.diagram.settings.viewport;
        presentationViewports.current.add(
          `${graph.diagram.id}:${presentationViewportKey(viewport)}`,
        );
        void flow.setViewport(viewport, { duration: 0 });
        return;
      }
      if (enabled) void overviewZoom.fit();
      else void flow.fitView({ padding: 0.25, maxZoom: 1, duration: 0 });
    };
    window.addEventListener(OVERVIEW_RESET_VIEW, reset);
    return () => window.removeEventListener(OVERVIEW_RESET_VIEW, reset);
  }, [flow, spatial, overviewZoom.fit]);
  const overviewEnabled = graph ? getOverviewConfig(graph).enabled : false;
  const cameraOwned = useCallback(
    () => presentationViewport.current || !!processProjection?.active,
    [processProjection?.active],
  );
  useResponsiveCanvasViewport(
    (touch || !!graph?.simulation) && !spatial && !overview?.active,
    diagramId,
    cameraOwned,
  );
  const previousOverview = useRef({ id: diagramId, enabled: overviewEnabled });
  useEffect(() => {
    const previous = previousOverview.current;
    previousOverview.current = { id: diagramId, enabled: overviewEnabled };
    if (previous.id !== diagramId || previous.enabled === overviewEnabled) return;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event(OVERVIEW_RESET_VIEW)));
    return () => cancelAnimationFrame(frame);
  }, [diagramId, overviewEnabled]);
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
      if (getOverviewConfig(state.graph).enabled) return;
      if (JSON.stringify(getSpatialView(state.graph).camera) === JSON.stringify(camera)) return;
      state.command('3D camera', (current) => setSpatialView(current, { camera }), true);
    },
    [diagramId],
  );
  if (!graph) return null;
  if (spatial)
    return (
      <div className="simulation-process-spatial-shell">
        <div className="simulation-process-spatial-navigation">
          <ProcessHierarchyNav graph={graph} spatial />
        </div>
        <Suspense
          fallback={
            <div className="canvas-shell spatial-canvas">
              <p role="status">Loading 3D view…</p>
              <button onClick={returnTo2D}>Return to 2D</button>
            </div>
          }
        >
          <SpatialCanvas
            graph={renderGraph ?? graph}
            nodes={projected.nodes}
            edges={projected.edges}
            onReturnTo2D={returnTo2D}
            onCameraChange={saveCamera}
            overview={overview}
            onPresentationReveal={revealPresentation}
          />
        </Suspense>
      </div>
    );
  const toggle = (key: 'grid' | 'snap') =>
    useEditor.getState().command(`Toggle ${key}`, (g) => ({
      ...g,
      diagram: {
        ...g.diagram,
        settings: { ...g.diagram.settings, [key]: !g.diagram.settings[key] },
      },
    }));
  const showProcessNavigation = !presentationOpen && !!graph.simulation?.processes?.length;
  return (
    <div
      className={`canvas-shell ${graph.diagram.type === 'mindmap' ? 'mindmap-canvas' : ''} ${showProcessNavigation ? 'simulation-process-canvas' : ''}`}
      data-testid="canvas"
      onPointerDownCapture={() => interruptPresentation.current()}
      onWheelCapture={() => interruptPresentation.current()}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target as HTMLElement;
        if (
          target.closest('input,textarea,select,button,[contenteditable="true"],[data-node-scroll]')
        )
          return;
        const card = target
          .closest('.react-flow__node')
          ?.querySelector<HTMLElement>('[data-simulation-projected="true"]');
        const processId = card?.dataset.simulationProcessId;
        if (processId) {
          event.preventDefault();
          event.stopPropagation();
          openSimulationProcess(graph.diagram.id, processId);
          return;
        }
        const id = card?.dataset.simulationLogicalNode ?? card?.dataset.nodeId;
        if (id) {
          event.preventDefault();
          event.stopPropagation();
          useEditor.getState().select([id]);
        }
      }}
    >
      {showProcessNavigation && (
        <div className="simulation-process-nav-strip">
          <ProcessHierarchyNav graph={graph} />
        </div>
      )}
      <ReactFlow<CanvasNode>
        style={showProcessNavigation ? { flex: 1, minHeight: 0, height: 'auto' } : undefined}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={
          graph.diagram.type === 'mindmap' ? ConnectionMode.Loose : ConnectionMode.Strict
        }
        onNodesChange={changes}
        onEdgesChange={edgeChanges}
        onPaneClick={() => {
          if (readonlyNodes.current.size) useEditor.getState().select([]);
        }}
        onNodeClick={(_, node) => {
          if (getSimulationProcessId(node.data.node)) return;
          if (node.data.node.metadata.simulationProjected && isReadonlyCanvasNode(node.data.node))
            useEditor.getState().select([logicalNodeId(node.data.node)]);
        }}
        onNodeDoubleClick={(_, node) => {
          const processId = getSimulationProcessId(node.data.node);
          if (processId) openSimulationProcess(graph.diagram.id, processId);
        }}
        onConnect={(c) =>
          c.source &&
          c.target &&
          graph.nodes.some((node) => node.id === c.source) &&
          graph.nodes.some((node) => node.id === c.target) &&
          useEditor.getState().connect(c.source, c.target)
        }
        onReconnect={(edge, c) =>
          !readonlyEdges.current.has(edge.id) &&
          c.source &&
          c.target &&
          graph.nodes.some((node) => node.id === c.source) &&
          graph.nodes.some((node) => node.id === c.target) &&
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
            overview?.active ||
            (!!useEditor.getState().graph &&
              getOverviewConfig(useEditor.getState().graph!).enabled) ||
            (!event &&
              presentationViewports.current.has(
                `${diagramId}:${presentationViewportKey(viewport)}`,
              ))
          )
            return;
          persistViewport(viewport);
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
        zoomOnDoubleClick={graph.diagram.type !== 'mindmap' && !processProjection?.active}
      >
        {!overview?.active && (
          <ParticleOverlay renderGraph={renderGraph ?? undefined} visibility={particleVisibility} />
        )}
        {overview && (
          <Panel position="top-right" className="overview-panel">
            <OverviewControls projection={overview} />
          </Panel>
        )}
        {graph.diagram.settings.grid !== false && (
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--grid)" />
        )}
        {!presentationOpen && (selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <Panel position="top-center" className="selection-panel">
            <div className="context-toolbar">
              <SelectionTools />
            </div>
          </Panel>
        )}
        <Controls showInteractive={false} showFitView={false}>
          {processProjection?.active && (
            <ControlButton
              aria-label="Fit view"
              title="Fit process view"
              onClick={() =>
                void flow.fitView({
                  nodes: touch
                    ? renderGraph?.nodes.map((node) => ({ id: node.id }))
                    : fitProcessNodes(),
                  padding: canvasFitPadding(0.16, flowStore.getState().domNode),
                  minZoom: touch ? 0.05 : 0.72,
                  maxZoom: touch ? 0.9 : 1,
                  duration: 180,
                })
              }
            >
              <Maximize size={16} />
            </ControlButton>
          )}
          {!processProjection?.active && (
            <ControlButton
              aria-label="Fit view"
              title="Fit view"
              onClick={() =>
                void fitDiagram(
                  flow,
                  graph,
                  !overview?.active &&
                    getDrawingLayer(graph.diagram.settings.drawing)?.visible &&
                    getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length
                    ? 0.2
                    : 0.1,
                  0,
                  undefined,
                  flowStore.getState(),
                )
              }
            >
              <Maximize size={16} />
            </ControlButton>
          )}
        </Controls>
        {!overview?.active && <DrawingOverlay />}
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
        <Panel position="bottom-center" className="canvas-tools-panel">
          <CanvasTools
            graph={graph}
            overview={!!overview?.active}
            minimap={minimap}
            setMinimap={setMinimap}
            toggle={toggle}
          />
        </Panel>
      </ReactFlow>
      {graph.diagram.type === 'timeline' && !overview?.active && <TimelineRuler graph={graph} />}
      {graph.nodes.length === 0 &&
        drawingTool === 'none' &&
        !getDrawingLayer(graph.diagram.settings.drawing)?.strokes.length && (
          <div className="canvas-empty">
            {graph.simulation ? (
              <ProcessStartPanel />
            ) : (
              <>
                <BoxIcon />
                <h2>A little space for your next idea.</h2>
                <p>
                  {graph.diagram.type === 'mindmap'
                    ? 'Start with a central idea, then branch out.'
                    : 'Add a node, then connect the dots.'}
                </p>
                <button className="primary" onClick={() => useEditor.getState().addNode()}>
                  {graph.diagram.type === 'mindmap'
                    ? 'Add your central idea'
                    : 'Add your first node'}
                </button>
              </>
            )}
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
