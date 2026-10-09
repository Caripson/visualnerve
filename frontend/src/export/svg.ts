import type { Graph } from '../model/types';
import type { RenderOptions } from './rendered';
import { download, safeName } from './semantic';
import { vectorSVG } from './vector-svg';
import { ProcessHierarchy } from '../simulation/process-hierarchy';
import { shouldUseBackgroundSVG, svgExportController } from './svg-jobs';
import type { SvgJobStatus } from './svg-job-types';
import { assertExportActive, checkExportActive, waitForExport, type ExportGuard } from './guard';

export async function graphSVG(
  graph: Graph,
  scope: RenderOptions['scope'] = 'complete',
  selection: string[] = [],
  guard?: ExportGuard,
  onProgress?: (status: SvgJobStatus) => void,
) {
  assertExportActive(guard);
  if (shouldUseBackgroundSVG(graph)) {
    const fallback = new AbortController();
    const authority = {
      guard: guard ?? {
        signal: fallback.signal,
        check: async () => undefined,
        assertCurrent: () => undefined,
      },
      dispose: () => undefined,
    };
    const job = svgExportController.start(
      graph,
      {
        scope,
        ...(scope === 'selected' ? { nodeIds: canonicalSVGSelection(graph, selection) } : {}),
      },
      authority,
    );
    try {
      return await svgExportController.wait(job.jobId, onProgress);
    } finally {
      await svgExportController.cancel(job.jobId).catch(() => undefined);
    }
  }
  const { capture2DScene } = await waitForExport(import('./rendered'), guard);
  assertExportActive(guard);
  return capture2DScene(
    graph,
    scope,
    selection,
    (flow, width, height, background) =>
      vectorSVG(flow, width, height, background, {
        format: 'visual-nerve-svg',
        formatVersion: 1,
        diagramId: graph.diagram.id,
        scope,
        view: '2d',
      }),
    undefined,
    guard,
  );
}
export async function exportSVG(
  graph: Graph,
  scope: RenderOptions['scope'],
  selection: string[],
  guard?: ExportGuard,
  onProgress?: (status: SvgJobStatus) => void,
) {
  const svg = await graphSVG(graph, scope, selection, guard, onProgress);
  await checkExportActive(guard);
  assertExportActive(guard);
  download(`${safeName(graph.diagram.name)}.svg`, svg, 'image/svg+xml');
}

/** Virtual capacity/process cards select actual logical objects, never a second model. */
export function canonicalSVGSelection(graph: Graph, selection: string[]) {
  const known = new Set(graph.nodes.map((node) => node.id));
  const selected = new Set<string>();
  const hierarchy = graph.simulation ? new ProcessHierarchy(graph.simulation) : undefined;
  for (const id of selection) {
    if (known.has(id)) {
      selected.add(id);
      continue;
    }
    const capacity = id.match(/^simulation-capacity:([^:]+):\d+$/);
    if (capacity && known.has(capacity[1])) {
      selected.add(capacity[1]);
      continue;
    }
    const process = id.startsWith('simulation-process:')
      ? id.slice('simulation-process:'.length)
      : undefined;
    if (process && hierarchy?.processes.has(process))
      for (const member of hierarchy.nodeIds(process)) if (known.has(member)) selected.add(member);
  }
  return [...selected];
}
