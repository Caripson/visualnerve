import type { Graph } from '../model/types';
import type { ExportGuard } from './guard';
import type { AppLocale } from '../i18n/types';
import type { SimulationView } from '../simulation/service';

export const svgJobLimits = {
  nodes: 20_000,
  sourceNodes: 100_000,
  sourceEdges: 500_000,
  edges: 100_000,
  textCharacters: 5_000_000,
  bytes: 64 * 1024 * 1024,
  dimension: 16_777_216,
  active: 2,
  retained: 4,
  retainedBytes: 128 * 1024 * 1024,
  retentionMs: 15 * 60_000,
  deadlineMs: 120_000,
  synchronousNodes: 100,
  synchronousTextCharacters: 20_000,
} as const;
export interface SvgJobOptions {
  scope?: 'complete' | 'viewport' | 'selected';
  nodeIds?: string[];
}
export interface SvgJobStatus {
  jobId: string;
  diagramId: string;
  format: 'svg';
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  phase: 'queued' | 'projection' | 'layout' | 'edges' | 'nodes' | 'drawing' | 'complete';
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  bytes?: number;
  error?: { code: string; message: string };
}
/** The caller owns one real originating workspace lease, not a replacement grant. */
export interface SvgJobAuthority {
  guard: ExportGuard;
  dispose(): void;
}
export interface SvgTheme {
  background: string;
  node: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  doneBackground: string;
  doneText: string;
  doneBorder: string;
  statusColors?: Record<string, { background: string; text: string }>;
}
export interface SvgWorkerRequest {
  graph: Graph;
  options: SvgJobOptions;
  theme: SvgTheme;
  locale: AppLocale;
  viewportSize: { width: number; height: number };
  simulationView?: SimulationView;
}
export type SvgWorkerResponse =
  | {
      type: 'progress';
      progress: number;
      phase: SvgJobStatus['phase'];
      nodeCount?: number;
      edgeCount?: number;
    }
  | { type: 'result'; svg: string; bytes: number; nodeCount: number; edgeCount: number }
  | { type: 'error'; code: string; message: string };

export class SvgExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'SvgExportError';
  }
}
