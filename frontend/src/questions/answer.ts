import { StorageError } from '../model/errors';
import type { QuestionGraph } from './evidence';
import { weakestEvidence } from './evidence';
import {
  normalizeQuestion,
  questionLimits,
  type DiagramQuestionResult,
  type QuestionAnswer,
  type EvidenceConfidence,
} from './types';

/** Breadth-first paths follow declared arrow directions. This models relationships, not execution. */
export function answerDiagramQuestion(graph: QuestionGraph, value: unknown): DiagramQuestionResult {
  const question = normalizeQuestion(value);
  if (graph.nodes.length > questionLimits.nodes || graph.edges.length > questionLimits.edges)
    throw new StorageError(
      422,
      'Question analysis supports at most 50,000 objects and 200,000 relationships.',
    );
  const nodes = new Map(
    graph.nodes
      .filter((node) => question.includeHidden || !node.outsideView)
      .map((node) => [node.id, node]),
  );
  if (!nodes.has(question.startId) || (question.targetId && !nodes.has(question.targetId)))
    throw new StorageError(
      422,
      'Choose objects in this data view, or explicitly include retained groups.',
    );
  const adjacency = new Map<
    string,
    { nodeId: string; edgeId: string; confidence: EvidenceConfidence }[]
  >();
  const evidence = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const add = (from: string, to: string, edgeId: string, confidence: EvidenceConfidence) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    const neighbors = adjacency.get(from) ?? [];
    neighbors.push({ nodeId: to, edgeId, confidence });
    adjacency.set(from, neighbors);
  };
  for (const edge of graph.edges) {
    if (
      (!question.includeHidden && edge.outsideView) ||
      (question.edgeTypes.length && !question.edgeTypes.includes(edge.kind)) ||
      (!question.includeUncertain && ['heuristic', 'unresolved'].includes(edge.confidence))
    )
      continue;
    const forward = edge.direction === 'forward' || edge.direction === 'both';
    const backward = edge.direction === 'backward' || edge.direction === 'both';
    if (question.kind === 'upstream') {
      if (forward) add(edge.targetNodeId, edge.sourceNodeId, edge.edgeId, edge.confidence);
      if (backward) add(edge.sourceNodeId, edge.targetNodeId, edge.edgeId, edge.confidence);
    } else {
      if (forward) add(edge.sourceNodeId, edge.targetNodeId, edge.edgeId, edge.confidence);
      if (backward) add(edge.targetNodeId, edge.sourceNodeId, edge.edgeId, edge.confidence);
    }
  }
  const reached = new Map<
    string,
    { distance: number; previous?: string; edgeId?: string; confidence: EvidenceConfidence }
  >([[question.startId, { distance: 0, confidence: 'explicit' }]]);
  const queue = [question.startId];
  let depthLimited = false;
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index],
      previous = reached.get(id)!;
    if (question.kind === 'path' && id === question.targetId) break;
    for (const entry of adjacency.get(id) ?? []) {
      if (reached.has(entry.nodeId)) continue;
      if (previous.distance >= question.maxDepth) {
        depthLimited = true;
        continue;
      }
      reached.set(entry.nodeId, {
        distance: previous.distance + 1,
        previous: id,
        edgeId: entry.edgeId,
        confidence: weakestEvidence(previous.confidence, entry.confidence),
      });
      queue.push(entry.nodeId);
    }
  }
  const targets =
    question.kind === 'path'
      ? reached.has(question.targetId!)
        ? [question.targetId!]
        : []
      : queue.slice(1);
  const selectedEvidence = new Set<string>();
  const answers = targets
    .slice(question.offset, question.offset + question.limit)
    .map((nodeId): QuestionAnswer => {
      const nodeIds: string[] = [],
        edgeIds: string[] = [];
      let current: string | undefined = nodeId;
      while (current !== undefined) {
        nodeIds.push(current);
        const entry: {
          distance: number;
          previous?: string;
          edgeId?: string;
          confidence: EvidenceConfidence;
        } = reached.get(current)!;
        if (entry.edgeId) {
          edgeIds.push(entry.edgeId);
          selectedEvidence.add(entry.edgeId);
        }
        current = entry.previous;
      }
      return {
        nodeId,
        title: nodes.get(nodeId)!.title,
        distance: reached.get(nodeId)!.distance,
        confidence: reached.get(nodeId)!.confidence,
        nodeIds: nodeIds.reverse(),
        edgeIds: edgeIds.reverse(),
      };
    });
  const warnings = [
    'These are modeled relationship paths, not proof of runtime behavior. Arrow direction and relationship type determine their meaning. Undirected associations are excluded.',
  ];
  if (question.includeHidden)
    warnings.push(
      'Retained groups outside the current CSV view may contain earlier aggregate values.',
    );
  if (depthLimited)
    warnings.push(
      `More relationships exist beyond the selected depth of ${question.maxDepth}. Increase the depth to investigate them.`,
    );
  if (answers.some((answer) => ['heuristic', 'unresolved'].includes(answer.confidence)))
    warnings.push(
      'Some paths contain heuristic or unresolved connections. Review their evidence before relying on them.',
    );
  return {
    diagramId: graph.diagramId,
    graphVersion: graph.graphVersion,
    question,
    summary:
      question.kind === 'path'
        ? targets.length
          ? 'A directed modeled path connects these objects.'
          : 'No directed modeled path was found within this scope and depth.'
        : `${targets.length} objects are ${question.kind} of ${nodes.get(question.startId)!.title} within ${question.maxDepth} steps.`,
    answers,
    evidence: [...selectedEvidence].map((id) => {
      const { outsideView: _outside, ...item } = evidence.get(id)!;
      return item;
    }),
    total: targets.length,
    offset: question.offset,
    limit: question.limit,
    hasMore: question.offset + answers.length < targets.length,
    found: targets.length > 0,
    depthLimited,
    warnings,
  };
}
