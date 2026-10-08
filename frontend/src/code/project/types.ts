import type { CodeFile } from '../types';

export const projectIgnoredReasons = [
  'dependency',
  'build',
  'vcs',
  'private',
  'binary',
  'generated',
  'unsupported',
  'directory',
] as const;
export type ProjectIgnoredReason = (typeof projectIgnoredReasons)[number];
export interface ProjectArchiveInput {
  name?: string;
  /** Strict base64 ZIP bytes; data URLs and remote archive URLs are not accepted. */
  data: string;
}
export interface ProjectArchiveProgress {
  stage: 'scan' | 'read';
  completed: number;
  total: number;
  path?: string;
}
export interface ProjectArchiveResult {
  name: string;
  files: CodeFile[];
  /** Counts excluded archive entries, including explicit directory records. */
  ignored: { total: number; reasons: Record<ProjectIgnoredReason, number> };
  /** The verified expanded byte count, including files excluded from analysis. */
  expandedBytes: number;
  /** Captured browser-local analyzed source-file budget for this scan. */
  fileLimit?: number;
}
export interface ProjectArchiveOptions {
  signal?: AbortSignal;
  byteLimit?: number;
  fileLimit?: number;
  onProgress?: (progress: ProjectArchiveProgress) => void;
}
export const projectArchiveLimits = { entries: 10_000, path: 500, timeoutMs: 120_000 } as const;
