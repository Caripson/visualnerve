import type { Graph } from '../model/types';
import type { RenderOptions } from './rendered';
import { download, safeName } from './semantic';
import { vectorSVG } from './vector-svg';

export async function graphSVG(
  graph: Graph,
  scope: RenderOptions['scope'] = 'complete',
  selection: string[] = [],
) {
  const { capture2DScene } = await import('./rendered');
  return capture2DScene(graph, scope, selection, (flow, width, height, background) =>
    vectorSVG(flow, width, height, background, {
      format: 'visual-nerve-svg',
      formatVersion: 1,
      diagramId: graph.diagram.id,
      scope,
      view: '2d',
    }),
  );
}
export async function exportSVG(graph: Graph, scope: RenderOptions['scope'], selection: string[]) {
  download(
    `${safeName(graph.diagram.name)}.svg`,
    await graphSVG(graph, scope, selection),
    'image/svg+xml',
  );
}
