import { StorageError } from '../model/errors';

export interface DiagramQuestion {
  startId: string;
  kind: 'downstream' | 'upstream' | 'path';
  targetId?: string;
  maxDepth: number;
  edgeTypes: string[];
  includeHidden: boolean;
  includeUncertain: boolean;
  offset: number;
  limit: number;
}
export type EvidenceConfidence = 'explicit' | 'syntax' | 'heuristic' | 'unresolved';
export interface RelationshipEvidence {
  edgeId: string;
  kind: string;
  confidence: EvidenceConfidence;
  source: 'diagram' | 'code' | 'sql' | 'csv' | 'hierarchy';
  description: string;
  path?: string;
  line?: number;
  sourceNodeId: string;
  targetNodeId: string;
  direction: string;
  /** Evidence text is bounded; the canonical edge retains the complete expression. */
  shortened?: boolean;
}
export interface QuestionAnswer {
  nodeId: string;
  title: string;
  distance: number;
  confidence: EvidenceConfidence;
  nodeIds: string[];
  edgeIds: string[];
}
export interface DiagramQuestionResult {
  diagramId: string;
  graphVersion: number;
  question: DiagramQuestion;
  summary: string;
  answers: QuestionAnswer[];
  evidence: RelationshipEvidence[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  found: boolean;
  depthLimited: boolean;
  warnings: string[];
}
export const questionLimits = { depth: 64, page: 100, nodes: 50_000, edges: 200_000 } as const;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function normalizeQuestion(value: unknown): DiagramQuestion {
  const fail = (): never => {
    throw new StorageError(
      422,
      'Choose existing object UUIDs, a question kind, depth 1..64 and a page of at most 100 answers.',
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'startId',
          'kind',
          'targetId',
          'maxDepth',
          'edgeTypes',
          'includeHidden',
          'includeUncertain',
          'offset',
          'limit',
        ].includes(key),
    )
  )
    fail();
  const question = {
    maxDepth: 16,
    edgeTypes: [],
    includeHidden: false,
    includeUncertain: true,
    offset: 0,
    limit: 25,
    ...input,
  } as unknown as DiagramQuestion;
  if (
    typeof question.startId !== 'string' ||
    !uuid.test(question.startId) ||
    !['downstream', 'upstream', 'path'].includes(question.kind) ||
    (question.targetId !== undefined &&
      (typeof question.targetId !== 'string' || !uuid.test(question.targetId))) ||
    (question.kind === 'path' && !question.targetId) ||
    (question.kind !== 'path' && question.targetId !== undefined) ||
    !Number.isSafeInteger(question.maxDepth) ||
    question.maxDepth < 1 ||
    question.maxDepth > questionLimits.depth ||
    !Array.isArray(question.edgeTypes) ||
    question.edgeTypes.length > 100 ||
    question.edgeTypes.some(
      (type) => typeof type !== 'string' || !type.trim() || type.length > 200,
    ) ||
    new Set(question.edgeTypes).size !== question.edgeTypes.length ||
    typeof question.includeHidden !== 'boolean' ||
    typeof question.includeUncertain !== 'boolean' ||
    !Number.isSafeInteger(question.offset) ||
    question.offset < 0 ||
    question.offset > questionLimits.nodes ||
    !Number.isSafeInteger(question.limit) ||
    question.limit < 1 ||
    question.limit > questionLimits.page
  )
    fail();
  return question;
}
