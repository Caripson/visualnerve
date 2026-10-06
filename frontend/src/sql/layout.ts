import { layoutGraph } from '../layouts/layout';
import type { SqlImportResult } from './parser';

export async function arrangeSql(result: SqlImportResult): Promise<SqlImportResult> {
  const { graph } = result;
  const fallback = () => {
    if (result.kind !== 'query') return graph;
    const columns = Math.ceil(Math.sqrt(graph.nodes.length));
    const width = graph.nodes.reduce((max, node) => Math.max(max, node.width), 400) + 100;
    const height = graph.nodes.reduce((max, node) => Math.max(max, node.height), 430) + 100;
    return {
      ...graph,
      nodes: graph.nodes.map((node, index) => ({
        ...node,
        x: (index % columns) * width,
        y: Math.floor(index / columns) * height,
      })),
    };
  };
  // Large schemas retain a predictable grid; an explicit Auto layout remains available.
  if (graph.nodes.length > 300) return { ...result, graph: fallback() };
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
      graph: fallback(),
      warnings: [
        ...result.warnings.slice(0, 99),
        'Automatic layout was unavailable. Objects use a grid; you can arrange them manually.',
      ],
    };
  }
}
