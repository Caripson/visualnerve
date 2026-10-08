import type { Graph } from '../model/types';
import type { RenderOptions } from './rendered';
import { download, safeName } from './semantic';
import { vectorSVG } from './vector-svg';
import { assertExportActive, checkExportActive, waitForExport, type ExportGuard } from './guard';

export async function graphSVG(
  graph: Graph,
  scope: RenderOptions['scope'] = 'complete',
  selection: string[] = [],
  guard?: ExportGuard,
) {
  assertExportActive(guard);
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
) {
  const svg = await graphSVG(graph, scope, selection, guard);
  await checkExportActive(guard);
  assertExportActive(guard);
  download(`${safeName(graph.diagram.name)}.svg`, svg, 'image/svg+xml');
}
