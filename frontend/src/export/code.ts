import type { CodeAnalysis, CodeObject, CodeRelation } from '../code/types';

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
    evidence: value.evidence && { path: value.evidence.path, line: value.evidence.line },
  };

export const codeAnalysisSummary = (value?: CodeAnalysis) =>
  value && {
    languages: value.languages.slice(),
    mode: value.mode,
    fileCount: value.fileCount,
    symbolCount: value.symbolCount,
    dependencyCount: value.dependencyCount,
    unresolvedCount: value.unresolvedCount,
    focus: value.focus,
    warnings: value.warnings.slice(),
  };
