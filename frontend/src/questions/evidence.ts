import { getCodeObject, getCodeRelation } from '../code/schema';
import { getCsvNode } from '../data/csv';
import { getSqlRelationship } from '../sql/schema';
import { getSqlQueryRelationship } from '../sql/query-schema';
import type { Graph, GraphEdge } from '../model/types';
import { relationshipGraph } from '../analysis/relationships';
import type { EvidenceConfidence, RelationshipEvidence } from './types';

const confidenceOrder: EvidenceConfidence[] = ['explicit', 'syntax', 'heuristic', 'unresolved'];
export const weakestEvidence = (a: EvidenceConfidence, b: EvidenceConfidence) =>
  confidenceOrder[Math.max(confidenceOrder.indexOf(a), confidenceOrder.indexOf(b))];
export function questionGraph(graph: Graph) {
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    outsideView: getCsvNode(node)?.visible === false,
  }));
  const stored = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = relationshipGraph(graph).edges.map(
    (edge): RelationshipEvidence & { outsideView: boolean } => {
      const original = stored.get(edge.id);
      const code = original && getCodeRelation(original);
      const sql = original && getSqlQueryRelationship(original);
      const key = original && getSqlRelationship(original);
      const implicit = !original;
      const source = code
        ? 'code'
        : sql || key
          ? 'sql'
          : original?.metadata.csvGenerated === true ||
              original?.metadata.csvModelGenerated === true
            ? 'csv'
            : implicit
              ? 'hierarchy'
              : 'diagram';
      const confidence: EvidenceConfidence =
        code?.confidence ??
        (sql?.references?.some((reference) => reference.resolution !== 'resolved') ||
        key?.unresolved
          ? 'unresolved'
          : implicit
            ? 'syntax'
            : 'explicit');
      const location = code?.evidence ?? (code ? getCodeObject(byId.get(edge.source)!) : undefined);
      const description = code
        ? `${code.kind} (${code.confidence})`
        : sql
          ? `${sql.kind}${sql.joinType ? ` ${sql.joinType}` : ''}${sql.condition ? `: ${sql.condition}` : ''}`
          : key
            ? `Foreign key ${key.columns.join(', ')} → ${key.unresolved ? 'unknown referenced key' : key.referencedColumns.join(', ')}`
            : (csvEvidence(original) ??
              original?.description ??
              original?.label ??
              (implicit ? 'Mind map parent relationship' : (original?.edgeType ?? 'relationship')));
      return {
        edgeId: edge.id,
        kind: original?.edgeType ?? 'hierarchy',
        confidence,
        source,
        description: description.slice(0, 2000),
        ...(description.length > 2000 ? { shortened: true } : {}),
        ...(location?.path
          ? { path: location.path, ...(location.line ? { line: location.line } : {}) }
          : {}),
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        direction: edge.direction,
        outsideView: edge.outsideView === true,
      };
    },
  );
  return { diagramId: graph.diagram.id, graphVersion: graph.diagram.version, nodes, edges };
}
function csvEvidence(edge?: GraphEdge): string | undefined {
  if (!edge || (edge.metadata.csvGenerated !== true && edge.metadata.csvModelGenerated !== true))
    return undefined;
  return edge.label
    ? `CSV relationship: ${edge.label}`
    : 'CSV grouping or matched source relationship; inspect the source group for original row evidence.';
}
export type QuestionGraph = ReturnType<typeof questionGraph>;
