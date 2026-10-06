import type { OverviewProjection } from './types';
/** Selection stays canonical in the editor; renderers highlight the representing view IDs. */
export function overviewSelection(
  projection: OverviewProjection | undefined,
  nodes: string[],
  edges: string[],
) {
  if (!projection?.active) return { nodes, edges };
  const map = (ids: string[], mapping: Record<string, string>) => [
    ...new Set(ids.flatMap((id) => (mapping[id] ? [mapping[id]] : []))),
  ];
  return { nodes: map(nodes, projection.nodeMap), edges: map(edges, projection.edgeMap) };
}
