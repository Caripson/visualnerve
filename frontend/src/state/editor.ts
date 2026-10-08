import { workspace } from '../storage/workspace';
import { reanalyzeDataModelAsync } from '../data/modelClient';
import { prunePresentation } from '../presentation/definition';
import { pruneStoryboard } from '../presentation/storyboard';
import { reconcileSimulationGraph } from '../simulation/document';
import { addConnectedNode, type ConnectedNodeType } from '../nodes/connected-node';
import { create } from 'zustand';
import { GroupMembership } from './group-membership';
import type { McpAccess } from '../integration/access';
import { applyDelta, diffGraph, mergeDelta, type Delta } from './history';
import { copySelection, pasteSelection, type Clip } from './clipboard';
import { mindmapTopics, newTopicPosition } from '../mindmap/tree';
import { getCsvNode } from '../data/csv';
import { getDrawingLayer } from '../drawing/types';
import { syncSpatialPositions } from '../spatial/movement';
import { validateDrawingLayer } from '../model/validation';
import { reconnectedAnalysisEdge } from '../model/relationships';
import { reconnectedDataModelEdge, suppressDataModelEdge } from '../data/model';
import { applyViewConfiguration, deleteAnalysisView, saveAnalysisView } from '../analysis/views';
import {
  getNamedAnalysisViews,
  validateFilters,
  type ExplorationResult,
  type RelationshipExploration,
} from '../analysis/types';
import {
  descendantIds,
  emptyFilters,
  newEdge,
  newNode,
  type Diagram,
  type DrawingLayer,
  type DrawingStroke,
  type Filters,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict';
export type DrawingTool = 'none' | 'pen' | 'eraser';

function suppressCsvParentConnections(nodes: GraphNode[], ids: Set<string>): GraphNode[] {
  return nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const csv = node.metadata.csv !== undefined ? getCsvNode(node) : undefined;
    return csv
      ? { ...node, metadata: { ...node.metadata, csv: { ...csv, suppressParentConnection: true } } }
      : node;
  });
}

interface Editor {
  graph: Graph | null;
  diagrams: Diagram[];
  owners: Owner[];
  selectedNodes: string[];
  selectedEdges: string[];
  history: Delta[];
  future: Delta[];
  editRevision: number;
  status: SaveStatus;
  message: string;
  commandError: string;
  preferenceError: { key: string; message: string } | null;
  theme: string;
  importFileLimitMb: number;
  projectSourceFileLimit: number;
  mcpAccess: McpAccess;
  bridgeUrl: string;
  workspaceId: string;
  privacyAcknowledged: boolean;
  lastExport: string;
  backupNudgeDismissed: boolean;
  bridgeStatus: string;
  filters: Filters;
  explorationResult: ExplorationResult | null;
  explorationBusy: boolean;
  explorationError: string;
  viewportRequest: number;
  focusNode: string | null;
  editingNode: string | null;
  editingTitle: string;
  focusMap: boolean;
  mobilePanel: 'projects' | 'details' | null;
  clipboard: Clip | null;
  drawingTool: DrawingTool;
  drawingColor: string;
  drawingWidth: number;
  setGraph(g: Graph | null): void;
  command(label: string, change: (graph: Graph) => Graph, coalesce?: boolean): void;
  addNode(partial?: Partial<GraphNode>): string | undefined;
  addConnectedNode(sourceId: string, type?: ConnectedNodeType): string | undefined;
  child(sibling?: boolean): string | undefined;
  beginEditing(id: string): void;
  finishEditing(save?: boolean): void;
  updateNode(id: string, patch: Partial<GraphNode>, coalesce?: boolean): void;
  updateEdge(id: string, patch: Partial<GraphEdge>): void;
  connect(source: string, target: string): void;
  remove(branch?: boolean): void;
  undo(): void;
  redo(): void;
  select(nodes: string[], edges?: string[]): void;
  copy(): Clip | null;
  paste(clip?: Clip): void;
  group(): void;
  ungroup(): void;
  setDrawingTool(tool: DrawingTool): void;
  addDrawingStroke(stroke: DrawingStroke): void;
  eraseDrawingStrokes(ids: string[]): void;
  toggleDrawingVisibility(): void;
  clearDrawing(): void;
  explore(config?: RelationshipExploration): void;
  saveView(name: string, replaceId?: string): void;
  deleteView(id: string): void;
  loadView(id: string): Promise<void>;
}
function analysisFilters(graph: Graph | null): Filters {
  const value = graph?.diagram.settings.analysisFilters;
  try {
    validateFilters(value);
    return value;
  } catch {
    return emptyFilters;
  }
}
export const useEditor = create<Editor>((set, get) => ({
  graph: null,
  diagrams: [],
  owners: [],
  selectedNodes: [],
  selectedEdges: [],
  history: [],
  future: [],
  editRevision: 0,
  status: 'saved',
  message: '',
  commandError: '',
  preferenceError: null,
  theme: 'system',
  importFileLimitMb: 50,
  projectSourceFileLimit: 500,
  mcpAccess: 'off',
  bridgeUrl: '',
  workspaceId: '',
  privacyAcknowledged: false,
  lastExport: '',
  backupNudgeDismissed: false,
  bridgeStatus: 'disabled',
  filters: emptyFilters,
  explorationResult: null,
  explorationBusy: false,
  explorationError: '',
  viewportRequest: 0,
  focusNode: null,
  editingNode: null,
  editingTitle: '',
  focusMap: false,
  mobilePanel: null,
  clipboard: null,
  drawingTool: 'none',
  drawingColor: '#e85d3f',
  drawingWidth: 3,
  setGraph: (graph) =>
    set({
      graph,
      selectedNodes: [],
      selectedEdges: [],
      history: [],
      future: [],
      filters: analysisFilters(graph),
      explorationResult: null,
      explorationBusy: false,
      explorationError: '',
      focusNode: null,
      editingNode: null,
      editingTitle: '',
      mobilePanel: null,
      drawingTool: 'none',
      commandError: '',
    }),
  command: (label, change, coalesce = false) => {
    const s = get();
    if (!s.graph) return;
    const changed = change(s.graph);
    let reconciled: Graph;
    try {
      reconciled = reconcileSimulationGraph(s.graph, changed);
    } catch (error) {
      set({
        status: 'error',
        message: (error as Error).message,
        commandError: (error as Error).message,
      });
      return;
    }
    const next = pruneStoryboard(prunePresentation(syncSpatialPositions(s.graph, reconciled)));
    const changedFilters =
      s.graph.diagram.settings.analysisFilters !== next.diagram.settings.analysisFilters;
    const before = changedFilters
      ? {
          ...s.graph,
          diagram: {
            ...s.graph.diagram,
            settings: { ...s.graph.diagram.settings, analysisFilters: { ...s.filters } },
          },
        }
      : s.graph;
    const delta = diffGraph(before, next, label);
    if (
      !delta.nodes.length &&
      !delta.edges.length &&
      !delta.nodeOrder &&
      !delta.edgeOrder &&
      !delta.diagram &&
      !delta.simulation &&
      !delta.sources?.length
    )
      return;
    const h = s.history;
    const prev = h.at(-1);
    const merge = coalesce && prev?.label === label && Date.now() - prev.timestamp < 650;
    set({
      graph: next,
      history: (merge ? [...h.slice(0, -1), mergeDelta(prev!, delta)] : [...h, delta]).slice(-100),
      future: [],
      editRevision: s.editRevision + 1,
      status: 'saving',
      message: '',
      // Viewport persistence must not dismiss a rejected edit while the user reads it.
      ...(delta.nodes.length ||
      delta.edges.length ||
      delta.nodeOrder ||
      delta.edgeOrder ||
      delta.simulation
        ? { commandError: '' }
        : {}),
      ...(changedFilters ? { filters: analysisFilters(next) } : {}),
    });
  },
  explore: (config) => {
    const previous = get().graph;
    get().command(config ? 'Explore relationships' : 'Reset relationship exploration', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: { ...graph.diagram.settings, relationshipExploration: config },
      },
    }));
    if (get().graph !== previous) set({ explorationResult: null, explorationError: '' });
  },
  saveView: (name, replaceId) => {
    const state = get();
    state.command(replaceId ? 'Update saved analysis view' : 'Save analysis view', (graph) =>
      saveAnalysisView(graph, state.filters, name, replaceId),
    );
  },
  deleteView: (id) =>
    get().command('Delete saved analysis view', (graph) => deleteAnalysisView(graph, id)),
  loadView: async (id) => {
    // Settle pending persistence before taking a versioned source snapshot.
    await workspace.settled();
    const state = get();
    const snapshot = state.graph;
    if (!snapshot) return;
    const view = getNamedAnalysisViews(snapshot).views.find((item) => item.id === id);
    if (!view) throw new Error('This saved analysis view no longer exists.');
    const revision = state.editRevision;
    let next = applyViewConfiguration(snapshot, view);
    if (next.dataset || next.diagram.settings.csvSourceAnalyses) {
      next = await reanalyzeDataModelAsync(next);
      next = applyViewConfiguration(next, view);
    }
    const current = get();
    if (
      current.graph?.diagram.id !== snapshot.diagram.id ||
      current.editRevision !== revision ||
      current.graph.diagram.version !== snapshot.diagram.version
    )
      throw new Error(
        'The diagram changed while loading this view. Load it again to keep the latest edits.',
      );
    current.command('Load analysis view', () => next);
    const changed = get().graph !== current.graph;
    set({
      selectedNodes: [],
      selectedEdges: [],
      ...(changed ? { explorationResult: null, explorationError: '' } : {}),
      viewportRequest: current.viewportRequest + 1,
    });
  },
  setDrawingTool: (tool) => {
    if (tool !== 'none') get().finishEditing();
    set({ drawingTool: tool });
  },
  addDrawingStroke: (stroke) => {
    const state = get();
    if (!state.graph) return;
    const previous = getDrawingLayer(state.graph.diagram.settings.drawing);
    const drawing: DrawingLayer = {
      version: 1,
      visible: true,
      strokes: [
        ...(previous?.strokes ?? []),
        {
          ...stroke,
          points: stroke.points.map(([x, y]) => [x, y]),
        },
      ],
    };
    validateDrawingLayer(drawing);
    state.command('Draw stroke', (graph) => ({
      ...graph,
      diagram: { ...graph.diagram, settings: { ...graph.diagram.settings, drawing } },
    }));
  },
  eraseDrawingStrokes: (ids) => {
    const state = get();
    const previous = getDrawingLayer(state.graph?.diagram.settings.drawing);
    if (!previous) return;
    const removed = new Set(ids);
    const strokes = previous.strokes.filter((stroke) => !removed.has(stroke.id));
    if (strokes.length === previous.strokes.length) return;
    state.command('Erase drawing strokes', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: { ...graph.diagram.settings, drawing: { ...previous, strokes } },
      },
    }));
  },
  toggleDrawingVisibility: () => {
    const state = get();
    const previous = getDrawingLayer(state.graph?.diagram.settings.drawing);
    if (!previous) return;
    state.command('Toggle drawing visibility', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: {
          ...graph.diagram.settings,
          drawing: { ...previous, visible: !previous.visible },
        },
      },
    }));
  },
  clearDrawing: () => {
    const state = get();
    const previous = getDrawingLayer(state.graph?.diagram.settings.drawing);
    if (!previous?.strokes.length) return;
    state.command('Clear drawing', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: { ...graph.diagram.settings, drawing: { ...previous, strokes: [] } },
      },
    }));
  },
  addNode: (partial) => {
    const s = get();
    if (!s.graph) return;
    const n = newNode(s.graph.diagram.id, {
      x: (s.graph.nodes.length % 5) * 250,
      y: Math.floor(s.graph.nodes.length / 5) * 140,
      nodeType:
        s.graph.diagram.type === 'flowchart' ||
        s.graph.diagram.type === 'process' ||
        s.graph.diagram.type === 'responsibility'
          ? 'process'
          : 'generic',
      ...(s.graph.diagram.type === 'mindmap'
        ? { title: 'Central idea', width: 220, height: 112 }
        : {}),
      ...partial,
    });
    s.command('Add node', (g) => ({ ...g, nodes: [...g.nodes, n] }));
    s.select([n.id]);
    set({ focusNode: n.id });
    return n.id;
  },
  addConnectedNode: (sourceId, type) => {
    const state = get();
    if (!state.graph) return;
    try {
      const added = addConnectedNode(state.graph, sourceId, type);
      if (!added) return;
      state.command('Add connected node', () => added.graph);
      if (!get().graph?.nodes.some((node) => node.id === added.nodeId)) return;
      get().select([added.nodeId]);
      set({ focusNode: added.nodeId });
      return added.nodeId;
    } catch (error) {
      set({
        status: 'error',
        message: (error as Error).message,
        commandError: (error as Error).message,
      });
    }
  },
  beginEditing: (id) => {
    const state = get();
    if (state.editingNode === id) return;
    state.finishEditing();
    const node = get().graph?.nodes.find((node) => node.id === id);
    if (node) set({ editingNode: id, editingTitle: node.title, focusNode: id });
  },
  finishEditing: (save = true) => {
    const state = get();
    const title = state.editingTitle.trim();
    const node = state.graph?.nodes.find((node) => node.id === state.editingNode);
    if (save && node && title && title !== node.title) state.updateNode(node.id, { title });
    set({ editingNode: null, editingTitle: '' });
  },
  child: (sibling = false) => {
    const s = get();
    const g = s.graph;
    const selected = g?.nodes.find((n) => n.id === s.selectedNodes[0]);
    if (!g || !selected) return;
    const parent = sibling
      ? (g.nodes.find((n) => n.id === selected.parentId) ?? selected)
      : selected;
    const mindmap = g.diagram.type === 'mindmap';
    const depth = parent ? mindmapTopics(g.nodes).get(parent.id)?.depth : undefined;
    const width = 180,
      height = depth === 0 ? 64 : 60;
    const n = newNode(g.diagram.id, {
      title: sibling ? 'New sibling' : 'New child',
      parentId: parent?.id,
      x: parent ? parent.x + 260 : selected.x,
      y: parent
        ? parent.y + g.nodes.filter((n) => n.parentId === parent.id).length * 116
        : selected.y + 116,
      ...(mindmap && parent
        ? newTopicPosition(
            g.nodes,
            parent,
            width,
            height,
            sibling && selected !== parent ? selected : undefined,
          )
        : {}),
    });
    s.command(sibling ? 'Add sibling' : 'Add child', (g) => ({
      ...g,
      nodes: [...g.nodes.map((x) => (x.id === parent?.id ? { ...x, collapsed: false } : x)), n],
      edges: parent
        ? [
            ...g.edges,
            newEdge(g.diagram.id, parent.id, n.id, {
              edgeType: 'hierarchy',
              direction: mindmap ? 'none' : 'forward',
            }),
          ]
        : g.edges,
    }));
    s.select([n.id]);
    set({ focusNode: n.id });
    return n.id;
  },
  updateNode: (id, patch, coalesce = false) =>
    get().command(
      'Edit node',
      (g) => {
        const original = g.nodes.find((n) => n.id === id);
        const descendants =
          original?.nodeType === 'group' && (patch.x !== undefined || patch.y !== undefined)
            ? descendantIds(g.nodes, id)
            : new Set<string>();
        const dx = original ? (patch.x ?? original.x) - original.x : 0;
        const dy = original ? (patch.y ?? original.y) - original.y : 0;
        return {
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === id
              ? { ...n, ...patch, ...(patch.ownerIds ? { ownerId: patch.ownerIds[0] } : {}) }
              : descendants.has(n.id)
                ? { ...n, x: n.x + dx, y: n.y + dy }
                : n,
          ),
        };
      },
      coalesce,
    ),
  updateEdge: (id, patch) =>
    get().command(
      'Edit connection',
      (g) => {
        const original = g.edges.find((edge) => edge.id === id);
        const endpointsChanged =
          original &&
          ((patch.sourceNodeId !== undefined && patch.sourceNodeId !== original.sourceNodeId) ||
            (patch.targetNodeId !== undefined && patch.targetNodeId !== original.targetNodeId));
        const model = original && endpointsChanged ? suppressDataModelEdge(g, original) : g;
        const reconnected =
          original?.metadata.csvGenerated === true &&
          ((patch.sourceNodeId !== undefined && patch.sourceNodeId !== original.sourceNodeId) ||
            (patch.targetNodeId !== undefined && patch.targetNodeId !== original.targetNodeId));
        return {
          ...model,
          nodes: reconnected
            ? suppressCsvParentConnections(g.nodes, new Set([original!.targetNodeId]))
            : g.nodes,
          edges: g.edges.map((edge) =>
            edge.id === id
              ? reconnectedDataModelEdge(
                  edge,
                  reconnectedAnalysisEdge(edge, {
                    ...edge,
                    ...patch,
                    ...(reconnected
                      ? {
                          metadata: {
                            ...edge.metadata,
                            ...patch.metadata,
                            csvGenerated: false,
                          },
                        }
                      : {}),
                  }),
                )
              : edge,
          ),
        };
      },
      true,
    ),
  connect: (source, target) =>
    get().command('Connect nodes', (g) => ({
      ...g,
      edges: [...g.edges, newEdge(g.diagram.id, source, target)],
    })),
  remove: (branch = false) => {
    const s = get();
    if (!s.graph) return;
    const ids = new Set(s.selectedNodes);
    for (const n of s.graph.nodes)
      if (ids.has(n.id) && (n.nodeType === 'group' || branch))
        for (const id of descendantIds(s.graph.nodes, n.id)) ids.add(id);
    const edges = new Set(s.selectedEdges);
    const disconnectedCsvTargets = new Set(
      s.graph.edges
        .filter((edge) => edges.has(edge.id) && edge.metadata.csvGenerated === true)
        .map((edge) => edge.targetNodeId),
    );
    s.command('Delete selection', (g) => ({
      ...g.edges
        .filter(
          (edge) =>
            edges.has(edge.id) && !ids.has(edge.sourceNodeId) && !ids.has(edge.targetNodeId),
        )
        .reduce((model, edge) => suppressDataModelEdge(model, edge), g),
      nodes: suppressCsvParentConnections(
        g.nodes
          .filter((n) => !ids.has(n.id))
          .map((n) => (n.parentId && ids.has(n.parentId) ? { ...n, parentId: undefined } : n)),
        disconnectedCsvTargets,
      ),
      edges: g.edges.filter(
        (e) => !ids.has(e.sourceNodeId) && !ids.has(e.targetNodeId) && !edges.has(e.id),
      ),
    }));
    // A rejected command leaves the model unchanged. Keep its selection so the
    // user can inspect the reason and correct dependencies before trying again.
    if (get().graph !== s.graph) s.select([]);
  },
  undo: () => {
    const s = get();
    const delta = s.history.at(-1);
    if (s.graph && delta) {
      const graph = applyDelta(s.graph, delta, false);
      set({
        graph,
        history: s.history.slice(0, -1),
        future: [...s.future, delta],
        editRevision: s.editRevision + 1,
        status: 'saving',
        selectedNodes: [],
        selectedEdges: [],
        editingNode: null,
        editingTitle: '',
        commandError: '',
        ...(delta.diagram &&
        delta.diagram.before.settings.analysisFilters !==
          delta.diagram.after.settings.analysisFilters
          ? { filters: analysisFilters(graph) }
          : {}),
        ...(delta.diagram &&
        delta.diagram.before.settings.relationshipExploration !==
          delta.diagram.after.settings.relationshipExploration
          ? { explorationResult: null }
          : {}),
        ...(delta.diagram &&
        delta.diagram.before.settings.viewport !== delta.diagram.after.settings.viewport
          ? { viewportRequest: s.viewportRequest + 1 }
          : {}),
      });
    }
  },
  redo: () => {
    const s = get();
    const delta = s.future.at(-1);
    if (s.graph && delta) {
      const graph = applyDelta(s.graph, delta, true);
      set({
        graph,
        future: s.future.slice(0, -1),
        history: [...s.history, delta],
        editRevision: s.editRevision + 1,
        status: 'saving',
        selectedNodes: [],
        selectedEdges: [],
        editingNode: null,
        editingTitle: '',
        commandError: '',
        ...(delta.diagram &&
        delta.diagram.before.settings.analysisFilters !==
          delta.diagram.after.settings.analysisFilters
          ? { filters: analysisFilters(graph) }
          : {}),
        ...(delta.diagram &&
        delta.diagram.before.settings.relationshipExploration !==
          delta.diagram.after.settings.relationshipExploration
          ? { explorationResult: null }
          : {}),
        ...(delta.diagram &&
        delta.diagram.before.settings.viewport !== delta.diagram.after.settings.viewport
          ? { viewportRequest: s.viewportRequest + 1 }
          : {}),
      });
    }
  },
  select: (selectedNodes, selectedEdges = []) => {
    if (get().editingNode && !selectedNodes.includes(get().editingNode!)) get().finishEditing();
    set({ selectedNodes, selectedEdges });
  },
  copy: () => {
    const s = get();
    if (!s.graph || !s.selectedNodes.length) return null;
    const clip = copySelection(s.graph, s.selectedNodes);
    set({ clipboard: clip });
    return clip;
  },
  paste: (clip) => {
    const s = get();
    const c = clip ?? s.clipboard;
    if (!s.graph || !c) return;
    let p: ReturnType<typeof pasteSelection>;
    try {
      p = pasteSelection(c, s.graph);
    } catch (error) {
      set({
        status: 'error',
        message: (error as Error).message,
        commandError: (error as Error).message,
      });
      return;
    }
    s.command('Paste nodes', (g) => ({
      ...g,
      nodes: [...g.nodes, ...p.nodes],
      edges: [...g.edges, ...p.edges],
      ...(p.simulation ? { simulation: p.simulation } : {}),
    }));
    if (get().graph !== s.graph) s.select(p.nodes.map((n) => n.id));
  },
  group: () => {
    const s = get();
    const g = s.graph;
    if (!g || s.selectedNodes.length < 2) return;
    const chosen = g.nodes.filter((n) => s.selectedNodes.includes(n.id));
    const x = Math.min(...chosen.map((n) => n.x)) - 30;
    const y = Math.min(...chosen.map((n) => n.y)) - 50;
    const group = newNode(g.diagram.id, {
      title: 'New group',
      nodeType: 'group',
      x,
      y,
      width: Math.max(...chosen.map((n) => n.x + n.width)) - x + 30,
      height: Math.max(...chosen.map((n) => n.y + n.height)) - y + 30,
    });
    s.command('Group nodes', (g) => ({
      ...g,
      nodes: [
        group,
        ...g.nodes.map((n) => (s.selectedNodes.includes(n.id) ? { ...n, parentId: group.id } : n)),
      ],
    }));
    s.select([group.id]);
  },
  ungroup: () => {
    const s = get();
    const g = s.graph;
    if (!g) return;
    const selected = new Set(
      g.nodes
        .filter((n) => s.selectedNodes.includes(n.id) && n.nodeType === 'group')
        .map((n) => n.id),
    );
    s.command('Ungroup nodes', (g) => ({
      ...g,
      nodes: new GroupMembership(g.nodes, selected).ungroup(),
      edges: g.edges.filter((e) => !selected.has(e.sourceNodeId) && !selected.has(e.targetNodeId)),
    }));
    s.select([]);
  },
}));
