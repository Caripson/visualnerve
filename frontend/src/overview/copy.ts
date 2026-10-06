import type { Graph } from '../model/types';
import { projectCanonicalOverview } from './projection';
import { getOverviewConfig, setOverviewConfig } from './types';

/** Clone/import hashes change with canonical IDs; restore expansion by represented membership. */
export function remapOverview(
  graph: Graph,
  sourceGraph: Graph,
  nodeMap: Map<string, string>,
): Graph {
  const config = getOverviewConfig(graph),
    original = getOverviewConfig(sourceGraph);
  if (!original.expanded.length) return graph;
  const source = projectCanonicalOverview(
    setOverviewConfig(sourceGraph, { ...original, enabled: true }),
  );
  const target = projectCanonicalOverview(setOverviewConfig(graph, { ...config, enabled: true }));
  const signature = (group: (typeof source.groups)[number], remap?: Map<string, string>) =>
    JSON.stringify([
      group.reason,
      group.label,
      group.depth,
      group.nodeIds.map((id) => remap?.get(id) ?? id).sort(),
    ]);
  const bySignature = new Map(target.groups.map((group) => [signature(group), group.id]));
  const expanded = new Set(original.expanded);
  return setOverviewConfig(graph, {
    ...config,
    expanded: [
      ...new Set(
        source.groups
          .filter((group) => expanded.has(group.id))
          .flatMap((group) => {
            const id = bySignature.get(signature(group, nodeMap));
            return id ? [id] : [];
          }),
      ),
    ],
  });
}
