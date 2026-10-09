import type { Graph } from '../model/types';
import { svgJobLimits } from './svg-job-types';

/** Dataset rows are not canvas content and must never be copied into an SVG worker. */
export function svgGraphSnapshot(graph: Graph): Graph {
  const { dataset: _dataset, datasets: _datasets, ...visual } = graph;
  return structuredClone(visual);
}
export function shouldUseBackgroundSVG(graph: Graph) {
  if (graph.nodes.length > svgJobLimits.synchronousNodes) return true;
  let size = 0;
  for (const node of graph.nodes) {
    size += node.title.length + (node.description?.length ?? 0);
    // Reserved source summaries may be long even when the diagram has few cards.
    size += JSON.stringify(node.metadata).length;
    if (size > svgJobLimits.synchronousTextCharacters) return true;
  }
  return false;
}
