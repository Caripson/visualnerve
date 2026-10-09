import type { Graph } from '../model/types';
import { ProcessHierarchy } from '../simulation/process-hierarchy';

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
