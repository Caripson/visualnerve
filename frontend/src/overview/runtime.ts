import { create } from 'zustand';
import type { Graph } from '../model/types';
import type { OverviewProjection } from './types';
import type { StoryboardView } from '../presentation/storyboard';
export const OVERVIEW_RESTORE_VIEW = 'visualnerve:overview-restore-view';

interface OverviewPreview {
  diagramId: string | null;
  nodeIds: string[];
  zoom?: number;
  baseline?: StoryboardView;
}
let rendered: { graph: Graph; projection: OverviewProjection } | undefined;
export function publishOverview(graph: Graph, projection: OverviewProjection) {
  rendered = { graph, projection };
}
export function renderedOverview(graph: Graph) {
  return rendered?.graph === graph ? rendered.projection : undefined;
}
export function clearRenderedOverview(diagramId: string) {
  if (rendered?.graph.diagram.id === diagramId) rendered = undefined;
}
/** Presentation/search previews never modify saved overview configuration. */
export const useOverviewPreview = create<OverviewPreview>(() => ({ diagramId: null, nodeIds: [] }));
export function revealOverview(
  diagramId: string,
  nodeIds: string[],
  zoom: number,
  baseline?: StoryboardView,
) {
  const current = useOverviewPreview.getState();
  useOverviewPreview.setState({
    diagramId,
    nodeIds: [...new Set(nodeIds)],
    zoom: current.diagramId === diagramId ? current.zoom : zoom,
    baseline: current.diagramId === diagramId ? current.baseline : baseline,
  });
}
export function releaseOverview(diagramId?: string) {
  if (diagramId && useOverviewPreview.getState().diagramId !== diagramId) return;
  const baseline = useOverviewPreview.getState().baseline;
  useOverviewPreview.setState({
    diagramId: null,
    nodeIds: [],
    zoom: undefined,
    baseline: undefined,
  });
  if (baseline) window.dispatchEvent(new CustomEvent(OVERVIEW_RESTORE_VIEW, { detail: baseline }));
}
export async function overviewProjectionReady(
  ids: string[],
  ready: (id: string) => boolean,
  signal?: AbortSignal,
) {
  const deadline = performance.now() + 5000;
  do {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const frame = requestAnimationFrame(() => {
        signal?.removeEventListener('abort', stop);
        resolve();
      });
      const stop = () => {
        cancelAnimationFrame(frame);
        reject(signal?.reason ?? new DOMException('Overview reveal cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', stop, { once: true });
    });
    signal?.throwIfAborted();
    if (ids.every(ready)) return;
  } while (performance.now() < deadline);
  throw new Error(
    'The walkthrough objects are hidden or exceed the overview detail limit. Filter the diagram or choose fewer objects.',
  );
}
