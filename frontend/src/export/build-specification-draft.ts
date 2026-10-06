import { StorageError } from '../model/errors';
import type { Graph } from '../model/types';

export const buildSectionLabels = {
  dataModel: 'Data model',
  screens: 'Screens and navigation',
  businessRules: 'Business rules',
  apiContract: 'Proposed API contract',
  acceptanceCriteria: 'Acceptance criteria',
  decisions: 'Decisions and assumptions',
} as const;
export type BuildSection = keyof typeof buildSectionLabels;
export interface BuildSpecificationDraft {
  version: 1;
  sections: Partial<Record<BuildSection, string>>;
  answers: Record<string, string>;
}
export interface BuildDecision {
  id: string;
  question: string;
  nodeIds: string[];
  answer?: string;
}
export interface ApplicationSpecification {
  version: 1;
  sections: Record<BuildSection, string>;
  decisions: BuildDecision[];
  unresolved: number;
  omittedDecisions: number;
  nodeCount: number;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function validateBuildSpecification(
  value: unknown,
): asserts value is BuildSpecificationDraft {
  const fail = () => {
    throw new StorageError(
      422,
      'Build specification needs version 1, known text sections and decision answers. Each field supports at most 30,000 characters and the draft at most 180,000.',
    );
  };
  if (
    !object(value) ||
    value.version !== 1 ||
    Object.keys(value).some((key) => !['version', 'sections', 'answers'].includes(key)) ||
    !object(value.sections) ||
    !object(value.answers)
  )
    fail();
  const draft = value as unknown as BuildSpecificationDraft;
  if (
    Object.keys(draft.sections).some(
      (key) => !Object.prototype.hasOwnProperty.call(buildSectionLabels, key),
    ) ||
    Object.keys(draft.answers).length > 200 ||
    Object.keys(draft.answers).some(
      (key) => !key || key.length > 250 || ['__proto__', 'constructor', 'prototype'].includes(key),
    )
  )
    fail();
  const fields = [...Object.values(draft.sections), ...Object.values(draft.answers)];
  if (
    fields.some((text) => typeof text !== 'string' || text.length > 30_000) ||
    fields.reduce((sum, text) => sum + (text?.length ?? 0), 0) > 180_000
  )
    fail();
}
export function getBuildSpecification(graph: Graph): BuildSpecificationDraft {
  const value = graph.diagram.settings.buildSpecification;
  if (value !== undefined) {
    try {
      validateBuildSpecification(value);
      return value;
    } catch {
      /* Older custom settings are not interpreted as an app specification. */
    }
  }
  return { version: 1, sections: {}, answers: {} };
}
export function setBuildSpecification(graph: Graph, value: unknown): Graph {
  validateBuildSpecification(value);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, buildSpecification: value },
    },
  };
}
export function remapBuildSpecification(
  graph: Graph,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
  sourceIds: Map<string, string>,
): Graph {
  if (graph.diagram.settings.buildSpecification === undefined) return graph;
  const draft = getBuildSpecification(graph);
  const answers = Object.fromEntries(
    Object.entries(draft.answers).map(([key, answer]) => {
      const separator = key.indexOf(':');
      if (separator < 0) return [key, answer];
      const prefix = key.slice(0, separator),
        id = key.slice(separator + 1);
      const mapping =
        prefix === 'csv' ? sourceIds : ['relation', 'key'].includes(prefix) ? edgeIds : nodeIds;
      return [`${prefix}:${mapping.get(id) ?? id}`, answer];
    }),
  );
  return setBuildSpecification(graph, { ...draft, answers });
}
