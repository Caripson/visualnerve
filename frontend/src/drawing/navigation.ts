import { getViewportForBounds, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import type { Graph } from '../model/types';
import { drawingBounds, unionBounds } from './geometry';
import { getDrawingLayer } from './types';
import { getOverviewConfig } from '../overview/types';
import { canvasFitPadding } from '../canvas/fit-padding';

/** Fit visible diagram objects and its separate annotation layer together. */
export function fitDiagram<N extends Node, E extends Edge>(
  flow: ReactFlowInstance<N, E>,
  graph: Graph,
  padding = 0.2,
  duration = 0,
  maxZoom?: number,
  viewportSize?: {
    width: number;
    height: number;
    minZoom: number;
    maxZoom?: number;
    domNode?: HTMLElement | null;
  },
) {
  const safePadding = canvasFitPadding(padding, viewportSize?.domNode);
  const layer = getDrawingLayer(graph.diagram.settings.drawing);
  const ink =
    layer?.visible && !getOverviewConfig(graph).enabled ? drawingBounds(layer.strokes) : undefined;
  if (!ink)
    return flow.fitView({
      padding: safePadding,
      duration,
      ...(maxZoom === undefined ? {} : { maxZoom }),
    });
  const nodes = flow.getNodes().filter((node) => !node.hidden);
  const bounds = unionBounds(nodes.length ? flow.getNodesBounds(nodes) : undefined, ink)!;
  // fitBounds exposes scalar padding only. Use the same fit calculation with
  // live dimensions for asymmetric safe space or a requested zoom cap.
  if (viewportSize && (maxZoom !== undefined || typeof safePadding !== 'number')) {
    const viewport = getViewportForBounds(
      bounds,
      viewportSize.width,
      viewportSize.height,
      viewportSize.minZoom,
      maxZoom ?? viewportSize.maxZoom ?? 2,
      safePadding,
    );
    return flow.setViewport(viewport, { duration });
  }
  return flow.fitBounds(bounds, {
    padding: typeof safePadding === 'number' ? safePadding : padding,
    duration,
  });
}
