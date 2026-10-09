import type { Graph } from '../model/types';
import type { RenderOptions } from './rendered';
import { download, safeName } from './semantic';
import { vectorSVG } from './vector-svg';
import { canonicalSVGSelection } from './selection';
export { canonicalSVGSelection } from './selection';
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
