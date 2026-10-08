import type { Graph, GraphEdge, GraphNode } from '../model/types';
import {
  codeLanguageIds,
  codeLimits,
  projectIgnoredReasons,
  type CodeAnalysis,
  type CodeObject,
  type CodeRelation,
  type ProjectDirectory,
} from './types';
import { MAX_IMPORT_LIMIT_BYTES } from '../imports/limits';
import { DEFAULT_PROJECT_SOURCE_FILE_LIMIT, MAX_PROJECT_SOURCE_FILE_LIMIT } from './project/limits';
import { projectArchiveLimits } from './project/types';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 500): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const language = (value: unknown) =>
  codeLanguageIds.includes(value as (typeof codeLanguageIds)[number]);
const languageList = (value: unknown, empty = false): value is (typeof codeLanguageIds)[number][] =>
  Array.isArray(value) &&
  (empty || value.length > 0) &&
  value.length <= codeLanguageIds.length &&
  value.every(language) &&
  new Set(value).size === value.length;
const directoryPath = (value: unknown): value is string =>
  text(value) &&
  (value === '.' ||
    (!/[\u0000-\u001f\u007f\\]/.test(value) &&
      !value.startsWith('/') &&
      !/^[a-zA-Z]:/.test(value) &&
      value.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')));

export function getProjectDirectory(node: GraphNode): ProjectDirectory | undefined {
  const value = node.metadata?.projectDirectory;
  if (
    !object(value) ||
    !keys(value, ['version', 'path', 'fileCount', 'languages']) ||
    value.version !== 1 ||
    !directoryPath(value.path) ||
    !integer(value.fileCount, MAX_PROJECT_SOURCE_FILE_LIMIT) ||
    !languageList(value.languages, value.fileCount === 0)
  )
    return undefined;
  return value as unknown as ProjectDirectory;
}

function validProject(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, [
      'version',
      'name',
      'expandedBytes',
      'ignoredEntries',
      'ignoredReasons',
      'sourceFileLimit',
    ]) ||
    value.version !== 1 ||
    !text(value.name) ||
    !integer(value.expandedBytes, MAX_IMPORT_LIMIT_BYTES) ||
    !integer(value.ignoredEntries, projectArchiveLimits.entries) ||
    !object(value.ignoredReasons) ||
    !keys(value.ignoredReasons, [...projectIgnoredReasons]) ||
    !Object.values(value.ignoredReasons).every((entry) =>
      integer(entry, projectArchiveLimits.entries),
    ) ||
    (value.sourceFileLimit !== undefined &&
      (!integer(value.sourceFileLimit, MAX_PROJECT_SOURCE_FILE_LIMIT) ||
        Number(value.sourceFileLimit) < DEFAULT_PROJECT_SOURCE_FILE_LIMIT))
  )
    return false;
  return (
    Object.values(value.ignoredReasons).reduce<number>((sum, count) => sum + Number(count), 0) ===
    value.ignoredEntries
  );
}

export function getCodeObject(node: GraphNode): CodeObject | undefined {
  const value = node.metadata?.codeObject;
  if (
    !object(value) ||
    !keys(value, [
      'version',
      'language',
      'path',
      'kind',
      'name',
      'line',
      'endLine',
      'external',
      'summary',
    ]) ||
    value.version !== 1 ||
    !language(value.language) ||
    !text(value.path) ||
    !text(value.name) ||
    typeof value.kind !== 'string' ||
    ![
      'file',
      'class',
      'function',
      'type',
      'resource',
      'query',
      'measure',
      'variable',
      'external',
    ].includes(value.kind) ||
    (value.line !== undefined && (!integer(value.line) || value.line === 0)) ||
    (value.endLine !== undefined &&
      (!integer(value.endLine) ||
        value.endLine === 0 ||
        (value.line !== undefined && Number(value.endLine) < Number(value.line)))) ||
    (value.external !== undefined && typeof value.external !== 'boolean') ||
    (value.summary !== undefined &&
      (!Array.isArray(value.summary) ||
        value.summary.length > 200 ||
        !value.summary.every((entry) => text(entry))))
  )
    return undefined;
  return value as unknown as CodeObject;
}
export function getCodeRelation(edge: GraphEdge): CodeRelation | undefined {
  const value = edge.metadata?.codeRelation;
  if (
    !object(value) ||
    !keys(value, ['version', 'kind', 'confidence', 'evidence', 'occurrences']) ||
    value.version !== 1 ||
    typeof value.kind !== 'string' ||
    ![
      'contains',
      'imports',
      'calls',
      'inherits',
      'references',
      'reads',
      'writes',
      'depends-on',
    ].includes(value.kind) ||
    typeof value.confidence !== 'string' ||
    !['syntax', 'heuristic', 'unresolved'].includes(value.confidence) ||
    (value.occurrences !== undefined &&
      (!integer(value.occurrences, codeLimits.edges) || value.occurrences === 0))
  )
    return undefined;
  if (
    value.evidence !== undefined &&
    (!object(value.evidence) ||
      !keys(value.evidence, ['path', 'line']) ||
      !text(value.evidence.path) ||
      !integer(value.evidence.line) ||
      value.evidence.line === 0)
  )
    return undefined;
  return value as unknown as CodeRelation;
}
export function getCodeAnalysis(graph: Graph): CodeAnalysis | undefined {
  const value = graph.diagram.metadata?.codeAnalysis;
  if (
    !object(value) ||
    !keys(value, [
      'version',
      'languages',
      'mode',
      'fileCount',
      'directoryCount',
      'symbolCount',
      'dependencyCount',
      'unresolvedCount',
      'warnings',
      'focus',
      'project',
    ]) ||
    value.version !== 1 ||
    !languageList(value.languages) ||
    typeof value.mode !== 'string' ||
    !['files', 'symbols', 'folders'].includes(value.mode) ||
    !integer(value.fileCount, MAX_PROJECT_SOURCE_FILE_LIMIT) ||
    (value.directoryCount !== undefined && !integer(value.directoryCount, codeLimits.nodes)) ||
    !integer(value.symbolCount, codeLimits.symbols) ||
    !integer(value.dependencyCount, codeLimits.edges) ||
    !integer(value.unresolvedCount, codeLimits.edges) ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > codeLimits.warnings ||
    !value.warnings.every((entry) => text(entry, 1000)) ||
    (value.focus !== undefined && !text(value.focus, 500)) ||
    (value.project !== undefined && !validProject(value.project))
  )
    return undefined;
  return value as unknown as CodeAnalysis;
}
export function validateCodeGraph(graph: Graph) {
  if (graph.diagram.metadata?.codeAnalysis !== undefined && !getCodeAnalysis(graph))
    throw new Error('Invalid code analysis metadata.');
  for (const node of graph.nodes) {
    if (node.metadata?.codeObject !== undefined && node.metadata?.projectDirectory !== undefined)
      throw new Error('A project directory cannot also be a code object.');
    if (node.metadata?.codeObject !== undefined && !getCodeObject(node))
      throw new Error('Invalid code object metadata.');
    else if (node.metadata?.projectDirectory !== undefined && !getProjectDirectory(node))
      throw new Error('Invalid project directory metadata.');
  }
  for (const edge of graph.edges)
    if (edge.metadata?.codeRelation !== undefined && !getCodeRelation(edge))
      throw new Error('Invalid code relationship metadata.');
}
