import type { Viewport } from '@xyflow/react';
import type { Graph } from '../model/types';
import { getOverviewConfig } from '../overview/types';
import { getSpatialView } from '../spatial/types';

/** Preserve the world point under the screen centre when a phone rotates. */
export function resizedCanvasViewport(
  viewport: Viewport,
  before: { width: number; height: number },
  after: { width: number; height: number },
): Viewport {
  if (
    ![before.width, before.height, after.width, after.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return viewport;
  return {
    ...viewport,
    x: viewport.x + (after.width - before.width) / 2,
    y: viewport.y + (after.height - before.height) / 2,
  };
}

/** Canonical viewport persistence excludes transient overview and 3D cameras. */
export function canvasViewportGraph(
  graph: Graph | null,
  diagramId: string | undefined,
  viewport: Viewport,
  touch: boolean,
): Graph | null {
  if (
    !graph ||
    graph.diagram.id !== diagramId ||
    getSpatialView(graph).mode !== '2d' ||
    getOverviewConfig(graph).enabled ||
    ![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) ||
    viewport.zoom <= 0
  )
    return null;
  const viewportDevice = touch ? 'touch' : 'desktop';
  if (
    JSON.stringify(graph.diagram.settings.viewport) === JSON.stringify(viewport) &&
    graph.diagram.settings.viewportDevice === viewportDevice
  )
    return null;
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, viewport, viewportDevice },
    },
  };
}

/** A search focus owns its completion only while its document/selection remain current. */
export async function persistCanvasFocus(options: {
  completion: Promise<boolean>;
  diagramId: string;
  nodeId: string;
  active(): boolean;
  current(): { graph: Graph | null; selectedNodes: string[] };
  viewport(): Viewport;
  persist(viewport: Viewport): void;
}): Promise<void> {
  if (!(await options.completion) || !options.active()) return;
  const state = options.current();
  if (
    state.graph?.diagram.id !== options.diagramId ||
    !state.selectedNodes.includes(options.nodeId) ||
    getSpatialView(state.graph).mode !== '2d' ||
    getOverviewConfig(state.graph).enabled
  )
    return;
  options.persist(options.viewport());
}
