import type { CodeAnalysis, CodeObject, CodeRelation, ProjectDirectory } from '../code/types';

/** Allowlist the public code contract; never forward arbitrary imported metadata. */
export const codeObjectSummary = (value?: CodeObject) =>
  value && {
    language: value.language,
    path: value.path,
    kind: value.kind,
    name: value.name,
    line: value.line,
    endLine: value.endLine,
    external: value.external,
    summary: value.summary?.slice(),
  };
export const codeRelationSummary = (value?: CodeRelation) =>
  value && {
    kind: value.kind,
    confidence: value.confidence,
    occurrences: value.occurrences,
    evidence: value.evidence && { path: value.evidence.path, line: value.evidence.line },
  };

export const codeAnalysisSummary = (value?: CodeAnalysis) =>
  value && {
    languages: value.languages.slice(),
    mode: value.mode,
    fileCount: value.fileCount,
    directoryCount: value.directoryCount,
    project: value.project && {
      ...value.project,
      ignoredReasons: { ...value.project.ignoredReasons },
    },
    symbolCount: value.symbolCount,
    dependencyCount: value.dependencyCount,
    unresolvedCount: value.unresolvedCount,
    focus: value.focus,
    warnings: value.warnings.slice(),
  };

export const projectDirectorySummary = (value?: ProjectDirectory) =>
  value && {
    path: value.path,
    fileCount: value.fileCount,
    languages: value.languages.slice(),
  };
