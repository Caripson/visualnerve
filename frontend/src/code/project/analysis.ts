import type { CodeImportResult } from '../types';
import type { ProjectArchiveResult } from './types';

export type ProjectArchiveSummary = Pick<
  ProjectArchiveResult,
  'name' | 'expandedBytes' | 'ignored' | 'fileLimit'
>;

/** Retain scan counts, never source buffers or the archive itself. */
export function attachProjectAnalysis(
  result: CodeImportResult,
  summary: ProjectArchiveSummary,
): CodeImportResult {
  const project = {
    version: 1 as const,
    name: summary.name,
    expandedBytes: summary.expandedBytes,
    ignoredEntries: summary.ignored.total,
    ignoredReasons: { ...summary.ignored.reasons },
    ...(summary.fileLimit !== undefined ? { sourceFileLimit: summary.fileLimit } : {}),
  };
  const { graph, ...analysis } = result;
  return {
    ...result,
    project,
    graph: {
      ...graph,
      diagram: {
        ...graph.diagram,
        metadata: { ...graph.diagram.metadata, codeAnalysis: { ...analysis, project } },
      },
    },
  };
}
