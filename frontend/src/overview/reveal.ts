import type { Graph } from '../model/types';
import type { StoryboardView } from '../presentation/storyboard';
import { getOverviewConfig } from './types';
import { overviewProjectionReady, revealOverview, useOverviewPreview } from './runtime';

interface RevealOptions {
  zoom: number;
  ready: (id: string) => boolean;
  captureView: () => Promise<StoryboardView>;
  signal?: AbortSignal;
}
/** Ready Details needs no projection change; an active overview must commit its revealed frontier. */
export async function revealOverviewTargets(graph: Graph, ids: string[], options: RevealOptions) {
  const { signal, ready } = options;
  signal?.throwIfAborted();
  const enabled = getOverviewConfig(graph).enabled;
  if (!enabled && ids.every(ready)) return;
  let baseline;
  if (enabled && useOverviewPreview.getState().diagramId !== graph.diagram.id) {
    try {
      baseline = await options.captureView();
    } catch {
      /* A preparing renderer has no camera yet. */
    }
  }
  signal?.throwIfAborted();
  revealOverview(graph.diagram.id, ids, options.zoom, baseline);
  await overviewProjectionReady(ids, ready, signal);
}
