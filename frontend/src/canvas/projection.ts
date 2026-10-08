import { getPresentation } from '../presentation/definition';
import { getNodesBounds, MarkerType, type Edge, type Node, type XYPosition } from '@xyflow/react';
import {
  emptyFilters,
  type Filters,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Owner,
} from '../model/types';
import { timelineGeometry, type Geometry } from '../layouts/layout';
import { mindmapTopics, type MindmapTopic } from '../mindmap/tree';
import { getCsvNode } from '../data/csv';
import type { ExplorationResult } from '../analysis/types';
import { importedConnectionStyle } from '../imports/diagram/presentation';
import { isReadonlyCanvasNode } from './logical-geometry';
import { SimulationCardSizing } from '../simulation/card-sizing';
export type NodeData = {
  node: GraphNode;
  owners: Owner[];
  childCount: number;
  presentationNumber?: number;
  exporting: boolean;
  mindmap?: MindmapTopic;
  resize?: (id: string, geometry: Geometry) => void;
  minimumHeight?: number;
};
export type CanvasNode = Node<NodeData>;
export interface RenderCache {
  nodes: Map<string, CanvasNode>;
  edges: Map<string, { source: GraphEdge; view: Edge; presentation?: string }>;
}
export function projectedBounds(nodes: CanvasNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map<string, XYPosition>();
  const absolute = (node: CanvasNode): XYPosition => {
    const cached = positions.get(node.id);
    if (cached) return cached;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const origin = parent ? absolute(parent) : { x: 0, y: 0 };
    const position = { x: origin.x + node.position.x, y: origin.y + node.position.y };
    positions.set(node.id, position);
    return position;
  };
  return getNodesBounds(nodes.map((node) => ({ ...node, position: absolute(node) })));
}
export function projectGraph(
  graph: Graph,
  owners: Owner[],
  selectedNodes: string[] = [],
  selectedEdges: string[] = [],
  filters: Filters = emptyFilters,
  exporting = false,
  resize?: NodeData['resize'],
  dataCache?: Map<string, NodeData>,
  renderCache?: RenderCache,
  topicContext?: GraphNode[],
  exploration?: ExplorationResult | null,
): { nodes: CanvasNode[]; edges: Edge[] } {
  const presentationNumbers = new Map(
    getPresentation(graph).nodeIds.map((id, index) => [id, index + 1]),
  );
  const exploredIds = exploration ? new Set(exploration.nodeIds) : undefined;
  const exploredEdges = exploration ? new Set(exploration.edgeIds) : undefined;
  const semanticNodeId = (node: GraphNode) =>
    typeof node.metadata.simulationLogicalNodeId === 'string'
      ? node.metadata.simulationLogicalNodeId
      : node.id;
  const visibleNodes = graph.nodes.filter((node) =>
    exploredIds ? exploredIds.has(semanticNodeId(node)) : getCsvNode(node)?.visible !== false,
  );
  const byId = new Map(visibleNodes.map((n) => [n.id, n]));
  const mindmap = graph.diagram.type === 'mindmap';
  const topics = mindmap
    ? mindmapTopics(
        (topicContext ?? visibleNodes).filter((node) =>
          exploredIds ? exploredIds.has(node.id) : getCsvNode(node)?.visible !== false,
        ),
      )
    : undefined;
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const selected = new Set(selectedNodes);
  const simulationNodes = new Map(graph.simulation?.nodes.map((node) => [node.id, node]));
  const sizing = new SimulationCardSizing();
  const edgeSelected = new Set(selectedEdges);
  const counts = new Map<string, number>();
  for (const n of visibleNodes)
    if (n.parentId) counts.set(n.parentId, (counts.get(n.parentId) ?? 0) + 1);
  const hidden = new Map<string, boolean>();
  const collapsed = (n: GraphNode): boolean => {
    if (exporting || exploration) return false;
    if (hidden.has(n.id)) return hidden.get(n.id)!;
    const path = new Set<string>();
    let current = n;
    let value = false;
    while (!path.has(current.id)) {
      if (hidden.has(current.id)) {
        value = hidden.get(current.id)!;
        break;
      }
      path.add(current.id);
      const parent = current.parentId ? byId.get(current.parentId) : undefined;
      if (!parent || parent.collapsed) {
        value = !!parent?.collapsed;
        break;
      }
      current = parent;
    }
    for (const id of path) hidden.set(id, value);
    return value;
  };
  const timeline =
    graph.diagram.type === 'timeline'
      ? timelineGeometry(visibleNodes, graph.diagram.settings.timelineScale ?? 'month')
      : null;
  const matches = (n: GraphNode) =>
    (!filters.owner || n.ownerIds.includes(filters.owner)) &&
    (!filters.status || n.status === filters.status) &&
    (!filters.kind || n.nodeType === filters.kind) &&
    (!filters.tag || n.tags.includes(filters.tag)) &&
    (!filters.from || (n.endDate || n.startDate || n.dueDate || '') >= filters.from) &&
    (!filters.to || (n.startDate || n.dueDate || n.endDate || '') <= filters.to);
  const depths = new Map<string, number>();
  const depth = (n: GraphNode): number => {
    if (depths.has(n.id)) return depths.get(n.id)!;
    const path: string[] = [];
    const seen = new Set<string>();
    let current = n;
    while (!depths.has(current.id)) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      const parent = current.parentId ? byId.get(current.parentId) : undefined;
      if (parent?.nodeType !== 'group') break;
      path.push(current.id);
      current = parent;
    }
    let value = depths.get(current.id) ?? 0;
    depths.set(current.id, value);
    for (let index = path.length - 1; index >= 0; index--) depths.set(path[index], ++value);
    return depths.get(n.id)!;
  };
  const nodes: CanvasNode[] = [...visibleNodes]
    .sort((a, b) => depth(a) - depth(b))
    .map((n) => {
      const simulationProjected = n.metadata.simulationProjected === true;
      const readonly = isReadonlyCanvasNode(n);
      const logicalSelectionId =
        simulationProjected && typeof n.metadata.simulationLogicalNodeId === 'string'
          ? n.metadata.simulationLogicalNodeId
          : n.id;
      const geom = timeline?.positions.get(n.id) ?? n;
      const semantic = simulationNodes.get(semanticNodeId(n));
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      const grouped = !timeline && parent?.nodeType === 'group';
      const match = exporting || !!exploration || matches(n);
      let data: NodeData = {
        node: n,
        presentationNumber: presentationNumbers.get(n.id),
        owners: n.ownerIds.map((id) => ownerById.get(id)).filter((o): o is Owner => !!o),
        childCount: counts.get(n.id) ?? 0,
        exporting,
        mindmap: topics?.get(n.id),
        resize: readonly ? undefined : resize,
        minimumHeight: semantic ? sizing.minimumHeight(semantic) : undefined,
      };
      const previous = dataCache?.get(n.id);
      if (
        previous &&
        previous.node === n &&
        previous.presentationNumber === data.presentationNumber &&
        previous.childCount === data.childCount &&
        previous.exporting === exporting &&
        previous.resize === data.resize &&
        previous.minimumHeight === data.minimumHeight &&
        previous.mindmap?.depth === data.mindmap?.depth &&
        previous.mindmap?.color === data.mindmap?.color &&
        previous.mindmap?.side === data.mindmap?.side &&
        previous.owners.length === data.owners.length &&
        previous.owners.every((o, i) => o === data.owners[i])
      )
        data = previous;
      dataCache?.set(n.id, data);
      const view: CanvasNode = {
        id: n.id,
        className:
          exploration && getCsvNode(n)?.visible === false
            ? 'analysis-outside-data-view'
            : undefined,
        type:
          n.metadata.simulationPoolSummary === true
            ? 'simulation-resource-pool'
            : typeof n.metadata.simulationProcessId === 'string'
              ? 'simulation-process'
              : mindmap && n.nodeType !== 'group'
                ? 'mindmap-topic'
                : n.nodeType,
        position: { x: geom.x - (grouped ? parent!.x : 0), y: geom.y - (grouped ? parent!.y : 0) },
        ...(grouped ? { parentId: parent!.id } : {}),
        width: geom.width ?? n.width,
        height: geom.height ?? n.height,
        // Frames have explicit model dimensions, including offscreen topics.
        // React Flow otherwise waits for virtualized nodes to mount before fitting.
        measured: { width: geom.width ?? n.width, height: geom.height ?? n.height },
        style: {
          width: geom.width ?? n.width,
          height: geom.height ?? n.height,
          opacity: match ? 1 : 0.2,
        },
        selected: selected.has(logicalSelectionId),
        ...(readonly ? { draggable: false, connectable: false } : {}),
        ...(readonly && simulationProjected ? { selectable: false } : {}),
        hidden: collapsed(n) || (!match && filters.mode === 'hide'),
        data,
        ariaLabel: `${n.title}, ${typeof n.metadata.simulationProcessId === 'string' ? 'process group. Open to inspect subprocesses' : n.nodeType}${simulationProjected && !n.metadata.simulationProcessId ? '. Open shared process properties' : ''}`,
        // A card contains its own focusable details and actions; the wrapper is a group.
        ariaRole: 'group',
        zIndex: n.nodeType === 'group' ? -1 : 1,
      };
      const cached = renderCache?.nodes.get(n.id);
      if (
        cached &&
        cached.data === data &&
        cached.type === view.type &&
        cached.parentId === view.parentId &&
        cached.selected === view.selected &&
        cached.hidden === view.hidden &&
        cached.className === view.className &&
        cached.position.x === view.position.x &&
        cached.position.y === view.position.y &&
        cached.width === view.width &&
        cached.height === view.height &&
        cached.style?.opacity === view.style?.opacity
      )
        return cached;
      renderCache?.nodes.set(n.id, view);
      return view;
    });
  if (dataCache) for (const id of dataCache.keys()) if (!byId.has(id)) dataCache.delete(id);
  if (renderCache)
    for (const id of renderCache.nodes.keys()) if (!byId.has(id)) renderCache.nodes.delete(id);
  const hiddenIds = new Set(nodes.filter((n) => n.hidden).map((n) => n.id));
  const visibleEdges = graph.edges.filter(
    (edge) =>
      byId.has(edge.sourceNodeId) &&
      byId.has(edge.targetNodeId) &&
      (exploredEdges
        ? exploredEdges.has(
            typeof edge.metadata.simulationLogicalEdgeId === 'string'
              ? edge.metadata.simulationLogicalEdgeId
              : edge.id,
          )
        : edge.metadata.csvModelVisible !== false),
  );
  const represented = new Set(
    visibleEdges.flatMap((e) => [
      `${e.sourceNodeId}:${e.targetNodeId}`,
      `${e.targetNodeId}:${e.sourceNodeId}`,
    ]),
  );
  const derived: GraphEdge[] = mindmap
    ? visibleNodes.flatMap((n) => {
        const parent = n.parentId ? byId.get(n.parentId) : undefined;
        if (
          !parent ||
          getCsvNode(n) ||
          parent.nodeType === 'group' ||
          (exploredEdges && !exploredEdges.has(`hierarchy:${n.id}`)) ||
          represented.has(`${parent.id}:${n.id}`)
        )
          return [];
        return [
          {
            id: `hierarchy:${n.id}`,
            version: 1,
            createdAt: '',
            updatedAt: '',
            diagramId: graph.diagram.id,
            sourceNodeId: parent.id,
            targetNodeId: n.id,
            edgeType: 'hierarchy',
            direction: 'none' as const,
            style: 'solid' as const,
            metadata: {},
          },
        ];
      })
    : [];
  const edges = [...visibleEdges, ...derived].map((e) => {
    const selected = edgeSelected.has(e.id);
    const hidden = hiddenIds.has(e.sourceNodeId) || hiddenIds.has(e.targetNodeId);
    const source = byId.get(e.sourceNodeId);
    const target = byId.get(e.targetNodeId);
    const csvRelation =
      (e.edgeType !== 'hierarchy' || e.direction !== 'none') &&
      ((source && !!getCsvNode(source)) || (target && !!getCsvNode(target)));
    const branch =
      mindmap && !csvRelation && source?.nodeType !== 'group' && target?.nodeType !== 'group'
        ? target?.parentId === source?.id
          ? target
          : source?.parentId === target?.id
            ? source
            : undefined
        : undefined;
    const imported = importedConnectionStyle(e);
    const simulationProjected = e.metadata.simulationProjected === true;
    const color = branch ? topics?.get(branch.id)?.color : (imported.color ?? '#8a9694');
    const strokeWidth = branch
      ? topics?.get(branch.id)?.depth === 1
        ? 4
        : 2.5
      : (imported.width ?? 1.6);
    const right = source && target && target.x + target.width / 2 >= source.x + source.width / 2;
    const processPath =
      typeof e.metadata.simulationProcessPath === 'string'
        ? e.metadata.simulationProcessPath
        : undefined;
    const sourceHandle = processPath
      ? String(e.metadata.simulationProcessSourceHandle)
      : mindmap && source?.nodeType !== 'group'
        ? `source-${right ? 'right' : 'left'}`
        : undefined;
    const targetHandle = processPath
      ? String(e.metadata.simulationProcessTargetHandle)
      : mindmap && target?.nodeType !== 'group'
        ? `target-${right ? 'left' : 'right'}`
        : undefined;
    const presentation = `${mindmap}:${!!branch}:${color}:${strokeWidth}:${sourceHandle}:${targetHandle}`;
    const cached = renderCache?.edges.get(e.id);
    if (
      cached?.source === e &&
      cached.presentation === presentation &&
      cached.view.selected === selected &&
      cached.view.hidden === hidden
    )
      return cached.view;
    const end = !branch && (e.direction === 'forward' || e.direction === 'both');
    const start = !branch && (e.direction === 'backward' || e.direction === 'both');
    const view: Edge = {
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      label:
        exploration && e.metadata.csvModelVisible === false
          ? `${e.label || e.edgeType} · outside current data view`
          : e.label,
      type: processPath
        ? 'simulation-process-connection'
        : branch
          ? 'mindmap-branch'
          : mindmap
            ? 'default'
            : 'smoothstep',
      ...(processPath
        ? {
            data: {
              path: processPath,
              labelX: e.metadata.simulationProcessLabelX,
              labelY: e.metadata.simulationProcessLabelY,
              resourceRequirement: e.edgeType === 'simulation-resource',
            },
          }
        : {}),
      sourceHandle,
      targetHandle,
      selected: simulationProjected ? false : selected,
      hidden,
      markerEnd: end ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
      markerStart: start ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
      style: {
        stroke: color,
        strokeWidth,
        strokeLinecap: 'round',
        ...(e.style !== 'solid' ? { strokeDasharray: e.style === 'dashed' ? '7 4' : '2 4' } : {}),
      },
      labelStyle: { fill: 'var(--text)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--surface)' },
      labelBgPadding: [5, 3] as [number, number],
      reconnectable: !branch && !simulationProjected,
      selectable: !e.id.startsWith('hierarchy:') && !simulationProjected,
    };
    renderCache?.edges.set(e.id, { source: e, view, presentation });
    return view;
  });
  if (renderCache) {
    const ids = new Set(edges.map((edge) => edge.id));
    for (const id of renderCache.edges.keys()) if (!ids.has(id)) renderCache.edges.delete(id);
  }
  return { nodes, edges };
}
