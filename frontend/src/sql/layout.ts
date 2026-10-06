import { layoutGraph } from '../layouts/layout';
import type { SqlImportResult } from './parser';

export async function arrangeSql(result: SqlImportResult): Promise<SqlImportResult> {
  const { graph } = result;
  // Large schemas retain a predictable grid; an explicit Auto layout remains available.
  if (graph.nodes.length > 300) return result;
  try {
    const positions = await layoutGraph(graph, 'RIGHT');
    return {
      ...result,
      graph: {
        ...graph,
        nodes: graph.nodes.map((node) => ({ ...node, ...positions.get(node.id) })),
      },
    };
  } catch {
    return {
      ...result,
      warnings: [
        ...result.warnings.slice(0, 99),
        'Automatic layout was unavailable. Tables use the initial grid; you can arrange them manually.',
      ],
    };
  }
}
