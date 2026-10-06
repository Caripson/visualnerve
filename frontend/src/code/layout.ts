import { layoutGraph } from '../layouts/layout';
import type { CodeImportResult } from './types';

export async function arrangeCode(result: CodeImportResult): Promise<CodeImportResult> {
  if (result.graph.nodes.length > 300) return result;
  try {
    const positions = await layoutGraph(result.graph, 'RIGHT');
    return {
      ...result,
      graph: {
        ...result.graph,
        nodes: result.graph.nodes.map((node) => ({ ...node, ...positions.get(node.id) })),
      },
    };
  } catch {
    const warnings = [
      ...result.warnings.slice(0, 99),
      'Automatic layout was unavailable. Objects use a grid and can be arranged manually.',
    ];
    return {
      ...result,
      warnings,
      graph: {
        ...result.graph,
        diagram: {
          ...result.graph.diagram,
          metadata: {
            ...result.graph.diagram.metadata,
            codeAnalysis: { ...(result.graph.diagram.metadata.codeAnalysis as object), warnings },
          },
        },
      },
    };
  }
}
