import type { NodeKind, GraphEdge } from '../model/types';
import type { Graph } from '../model/types';
import type { SvgTheme } from './svg-job-types';

export type ExchangeFormat = 'drawio';
export interface ExchangeOptions {
  scope?: 'complete' | 'selected';
  nodeIds?: string[];
}
/** Only deliberately exported content reaches a third-party document serializer. */
export interface ExchangeNode {
  id: string;
  kind: NodeKind;
  title: string;
  description?: string;
  detailLines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
  fill: string;
  stroke: string;
  textColor: string;
}
export interface ExchangeEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  direction: GraphEdge['direction'];
  style: GraphEdge['style'];
  stroke: string;
  /** Label ink is independent of a possibly pale, user-chosen line accent. */
  textColor?: string;
}
export interface ExchangeWarning {
  code: string;
  message: string;
}
export interface ExchangeScene {
  name: string;
  /** Portable drawing surface; serializers default to white. */
  background?: string;
  nodes: ExchangeNode[];
  edges: ExchangeEdge[];
  warnings: ExchangeWarning[];
}
export interface ExchangeResult {
  format: ExchangeFormat;
  mimeType: string;
  bytes: Uint8Array;
  nodeCount: number;
  edgeCount: number;
  warnings: ExchangeWarning[];
}
export type ExchangeProgress = (
  percent: number,
  phase: 'projection' | 'nodes' | 'edges' | 'packaging',
) => void;
export interface ExchangeJobStatus {
  jobId: string;
  diagramId: string;
  format: ExchangeFormat;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  phase: 'queued' | 'projection' | 'nodes' | 'edges' | 'packaging' | 'complete';
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  bytes?: number;
  warnings: ExchangeWarning[];
  error?: { code: string; message: string };
}
export interface ExchangeWorkerRequest {
  graph: Graph;
  format: ExchangeFormat;
  options: ExchangeOptions;
  theme: SvgTheme;
}
export type ExchangeWorkerResponse =
  | { type: 'progress'; progress: number; phase: ExchangeJobStatus['phase'] }
  | { type: 'result'; result: ExchangeResult }
  | { type: 'error'; code: string; message: string };
export const exchangeLimits = {
  nodes: 20_000,
  edges: 100_000,
  sourceNodes: 100_000,
  sourceEdges: 500_000,
  textCharacters: 5_000_000,
  bytes: 64 * 1024 * 1024,
  dimension: 16_777_216,
  active: 2,
  retained: 4,
  retainedBytes: 128 * 1024 * 1024,
  retentionMs: 15 * 60_000,
  deadlineMs: 120_000,
} as const;
export class ExchangeExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'ExchangeExportError';
  }
}
