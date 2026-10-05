import { getViewportForBounds, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import type { Graph } from '../model/types';
import { drawingBounds, unionBounds } from './geometry';
import { getDrawingLayer } from './types';

/** Fit visible diagram objects and its separate annotation layer together. */
export function fitDiagram<N extends Node, E extends Edge>(
  flow: ReactFlowInstance<N, E>,
  graph: Graph,
  padding = 0.2,
  duration = 0,
  maxZoom?: number,
  viewportSize?: { width: number; height: number; minZoom: number },
) {
  const layer = getDrawingLayer(graph.diagram.settings.drawing);
  const ink = layer?.visible ? drawingBounds(layer.strokes) : undefined;
  if (!ink)
    return flow.fitView({ padding, duration, ...(maxZoom === undefined ? {} : { maxZoom }) });
  const nodes = flow.getNodes().filter((node) => !node.hidden);
  const bounds = unionBounds(nodes.length ? flow.getNodesBounds(nodes) : undefined, ink)!;
  // fitBounds has no zoom cap. Use the same fit calculation with the live flow's
  // dimensions when an initial/focus view must keep a small drawing at 100%.
  if (maxZoom !== undefined && viewportSize) {
    const viewport = getViewportForBounds(
      bounds,
      viewportSize.width,
      viewportSize.height,
      viewportSize.minZoom,
      maxZoom,
      padding,
    );
    return flow.setViewport(viewport, { duration });
  }
  return flow.fitBounds(bounds, { padding, duration });
}
