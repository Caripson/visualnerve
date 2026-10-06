import type { Graph, GraphEdge, GraphNode } from '../model/types';
import {
  codeLanguageIds,
  codeLimits,
  type CodeAnalysis,
  type CodeObject,
  type CodeRelation,
} from './types';

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
    !keys(value, ['version', 'kind', 'confidence', 'evidence']) ||
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
    !['syntax', 'heuristic', 'unresolved'].includes(value.confidence)
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
      'symbolCount',
      'dependencyCount',
      'unresolvedCount',
      'warnings',
      'focus',
    ]) ||
    value.version !== 1 ||
    !Array.isArray(value.languages) ||
    !value.languages.length ||
    value.languages.length > 50 ||
    !value.languages.every(language) ||
    new Set(value.languages).size !== value.languages.length ||
    typeof value.mode !== 'string' ||
    !['files', 'symbols'].includes(value.mode) ||
    !integer(value.fileCount, codeLimits.files) ||
    !integer(value.symbolCount, codeLimits.symbols) ||
    !integer(value.dependencyCount, codeLimits.edges) ||
    !integer(value.unresolvedCount, codeLimits.edges) ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > codeLimits.warnings ||
    !value.warnings.every((entry) => text(entry, 1000)) ||
    (value.focus !== undefined && !text(value.focus, 500))
  )
    return undefined;
  return value as unknown as CodeAnalysis;
}
export function validateCodeGraph(graph: Graph) {
  if (graph.diagram.metadata?.codeAnalysis !== undefined && !getCodeAnalysis(graph))
    throw new Error('Invalid code analysis metadata.');
  for (const node of graph.nodes)
    if (node.metadata?.codeObject !== undefined && !getCodeObject(node))
      throw new Error('Invalid code object metadata.');
  for (const edge of graph.edges)
    if (edge.metadata?.codeRelation !== undefined && !getCodeRelation(edge))
      throw new Error('Invalid code relationship metadata.');
}
