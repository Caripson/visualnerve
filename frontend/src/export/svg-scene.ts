import { projectGraph, type CanvasNode } from '../canvas/projection';
import { emptyFilters, type Graph } from '../model/types';
import { getCsvNode } from '../data/csv';
import { getDrawingLayer } from '../drawing/types';
import { drawingBounds, unionBounds } from '../drawing/geometry';
import { getOverviewConfig } from '../overview/types';
import { projectCanonicalOverview } from '../overview/projection';
import { SimulationExportScene } from './simulation-scene';
import type { SvgWorkerRequest } from './svg-job-types';

/** The canonical canvas projection, executed in the export worker rather than rendered into HTML. */
export function svgScene(request: SvgWorkerRequest) {
  const { graph, options } = request;
  const selectedOnly = options.scope === 'selected';
  const simulation = new SimulationExportScene().project(
    graph,
    options.nodeIds ?? [],
    request.simulationView,
  );
  const selected = new Set(simulation.selection);
  const selectedNode = (node: Graph['nodes'][number]) => {
    const csv = selectedOnly && getCsvNode(node);
    if (!csv || csv.visible !== false) return node;
    const key = node.metadata.csv !== undefined ? 'csv' : 'csvSnapshot';
    return { ...node, metadata: { ...node.metadata, [key]: { ...csv, visible: true } } };
  };
  const source = selectedOnly
    ? {
        ...simulation.graph,
        nodes: simulation.graph.nodes.filter((n) => selected.has(n.id)).map(selectedNode),
        edges: simulation.graph.edges.filter(
          (e) => selected.has(e.sourceNodeId) && selected.has(e.targetNodeId),
        ),
      }
    : simulation.graph;
  const projection = projectGraph(
    source,
    source.owners,
    [],
    [],
    emptyFilters,
    true,
    undefined,
    undefined,
    undefined,
    selectedOnly ? graph.nodes.map(selectedNode) : graph.nodes,
  );
  const overview =
    !selectedOnly && getOverviewConfig(graph).enabled ? projectCanonicalOverview(graph) : undefined;
  const nodes = overview?.active ? overview.nodes : projection.nodes;
  const edges = overview?.active ? overview.edges : projection.edges;
  const drawing = getDrawingLayer(graph.diagram.settings.drawing);
  const strokes = drawing?.visible && !overview?.active ? drawing.strokes : [];
  const positions = absoluteSVGPositions(nodes);
  let bounds: { x: number; y: number; width: number; height: number } | undefined;
  for (const node of nodes) {
    const position = positions.get(node.id)!;
    const width = Number(node.width ?? node.data.node.width),
      height = Number(node.height ?? node.data.node.height);
    bounds = unionBounds(bounds, { ...position, width, height });
  }
  if (!selectedOnly) bounds = unionBounds(bounds, drawingBounds(strokes));
  if (!bounds)
    throw new Error(
      selectedOnly
        ? 'Select one or more nodes to export.'
        : 'Add a node or draw a stroke before exporting an image.',
    );
  return { nodes, edges, strokes, bounds, positions, summary: simulation.summary };
}
/** Iterative parent resolution keeps deeply nested imported groups off the JS call stack. */
export function absoluteSVGPositions(nodes: CanvasNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    const path: CanvasNode[] = [],
      seen = new Set<string>();
    let current: CanvasNode | undefined = node;
    while (current && !positions.has(current.id)) {
      if (seen.has(current.id)) throw new Error('Cannot export cyclic node groups.');
      seen.add(current.id);
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    let origin = current ? positions.get(current.id)! : { x: 0, y: 0 };
    for (let index = path.length - 1; index >= 0; index--) {
      const entry = path[index];
      origin = { x: origin.x + entry.position.x, y: origin.y + entry.position.y };
      positions.set(entry.id, origin);
    }
  }
  return positions;
}
