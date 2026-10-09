import type { Translate, MessageId } from '../i18n';
import type { Graph } from '../model/types';
import type { DiagramQuestionResult } from './types';

const evidenceLabels: Record<string, MessageId> = {
  explicit: 'questions.confidence.explicit',
  syntax: 'questions.confidence.syntax',
  heuristic: 'questions.confidence.heuristic',
  unresolved: 'questions.confidence.unresolved',
  diagram: 'questions.source.diagram',
  code: 'questions.source.code',
  sql: 'questions.source.sql',
  csv: 'questions.source.csv',
  hierarchy: 'questions.source.hierarchy',
};
export function questionEvidenceLabel(value: string, t: Translate) {
  return Object.hasOwn(evidenceLabels, value) ? t(evidenceLabels[value]) : value;
}

export function questionSummary(result: DiagramQuestionResult, graph: Graph, t: Translate) {
  if (result.question.kind === 'path')
    return t(result.found ? 'questions.pathFound' : 'questions.pathNotFound');
  return t(
    result.question.kind === 'upstream'
      ? 'questions.upstreamSummary'
      : 'questions.downstreamSummary',
    {
      count: result.total,
      name:
        graph.nodes.find((node) => node.id === result.question.startId)?.title ??
        result.question.startId,
      depth: result.question.maxDepth,
    },
  );
}

export function questionDisplayMessage(message: string, t: Translate, depth?: number) {
  switch (message) {
    case 'The diagram changed during analysis. Ask again to use the latest relationships.':
      return t('questions.changedDuringRun');
    case 'Relationship focus applied. Large views are bounded; the complete answer remains available here.':
      return t('questions.focusApplied');
    case 'These are modeled relationship paths, not proof of runtime behavior. Arrow direction and relationship type determine their meaning. Undirected associations are excluded.':
      return t('questions.warningModel');
    case 'Retained groups outside the current CSV view may contain earlier aggregate values.':
      return t('questions.warningHidden');
    case 'Some paths contain heuristic or unresolved connections. Review their evidence before relying on them.':
      return t('questions.warningUncertain');
  }
  if (
    depth !== undefined &&
    message ===
      `More relationships exist beyond the selected depth of ${depth}. Increase the depth to investigate them.`
  )
    return t('questions.warningDepth', { depth });
  return message;
}
