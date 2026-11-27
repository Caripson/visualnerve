import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { compileBehavior, validateBehaviorBindings } from './language';

export interface BehaviorDefinition {
  id: string;
  name: string;
  version: 1;
  source: string;
  draftSource?: string;
}

export type BehaviorParameters = Record<string, string | number | boolean>;

export interface BehaviorBinding {
  id: string;
  definitionId: string;
  nodeId: string;
  enabled: boolean;
  parameters: BehaviorParameters;
}

export interface BehaviorLibrary {
  definitions: BehaviorDefinition[];
  bindings: BehaviorBinding[];
}

const emptyLibrary: BehaviorLibrary = { definitions: [], bindings: [] };
export const behaviorDocumentLimits = {
  definitions: 50,
  bindings: 500,
  name: 120,
  source: 32_768,
  parameters: 32,
  parameterText: 4_096,
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function sourceText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= behaviorDocumentLimits.source;
}

function isDefinition(value: unknown): value is BehaviorDefinition {
  return (
    record(value) &&
    identifier(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= behaviorDocumentLimits.name &&
    value.version === 1 &&
    sourceText(value.source) &&
    (value.draftSource === undefined || sourceText(value.draftSource))
  );
}

function isParameters(value: unknown): value is BehaviorParameters {
  if (!record(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= behaviorDocumentLimits.parameters &&
    entries.every(
      ([name, item]) =>
        identifier(name) &&
        ((typeof item === 'string' && item.length <= behaviorDocumentLimits.parameterText) ||
          (typeof item === 'number' && Number.isSafeInteger(item)) ||
          typeof item === 'boolean'),
    )
  );
}

function isBinding(value: unknown): value is BehaviorBinding {
  return (
    record(value) &&
    identifier(value.id) &&
    identifier(value.definitionId) &&
    identifier(value.nodeId) &&
    typeof value.enabled === 'boolean' &&
    isParameters(value.parameters)
  );
}

function isLibrary(value: unknown): value is BehaviorLibrary {
  return (
    record(value) &&
    Array.isArray(value.definitions) &&
    value.definitions.length <= behaviorDocumentLimits.definitions &&
    value.definitions.every(isDefinition) &&
    Array.isArray(value.bindings) &&
    value.bindings.length <= behaviorDocumentLimits.bindings &&
    value.bindings.every(isBinding)
  );
}

export function validateBehaviorLibrary(value: unknown): void {
  if (!isLibrary(value)) throw new StorageError(422, 'Invalid Behavior library.');
  const definitions = new Set(value.definitions.map(({ id }) => id));
  const bindings = new Set(value.bindings.map(({ id }) => id));
  if (definitions.size !== value.definitions.length || bindings.size !== value.bindings.length)
    throw new StorageError(422, 'Duplicate Behavior definition or binding ID.');
  if (value.bindings.some(({ definitionId }) => !definitions.has(definitionId)))
    throw new StorageError(422, 'Behavior binding refers to an unknown definition.');
}

export function getBehaviorLibrary(graph: Graph): BehaviorLibrary {
  const value = graph.diagram.settings.behaviors;
  return value ?? emptyLibrary;
}

export function setBehaviorLibrary(graph: Graph, library: BehaviorLibrary): Graph {
  return {
    ...graph,
    diagram: { ...graph.diagram, settings: { ...graph.diagram.settings, behaviors: library } },
  };
}

export function isBehaviorCompatible(
  graph: Graph,
  nodeId: string,
  definition: BehaviorDefinition,
): boolean {
  if (!graph.nodes.some((node) => node.id === nodeId)) return false;
  const compiled = compileBehavior(definition.source);
  if (!compiled.ok) return false;
  return graph.simulation && compiled.program.contexts.includes('simulation')
    ? graph.simulation.nodes.some((node) => node.id === nodeId && node.type === 'work')
    : compiled.program.contexts.includes('editor');
}

export function validateBehaviorConfiguration(
  graph: Graph,
  definition: BehaviorDefinition,
  parameters: BehaviorParameters,
) {
  const compiled = compileBehavior(definition.source);
  if (!compiled.ok) return compiled;
  return validateBehaviorBindings(compiled.program, parameters, {
    nodeExists: (id) =>
      graph.simulation && compiled.program.contexts.includes('simulation')
        ? graph.simulation.nodes.some((node) => node.id === id && node.type === 'work')
        : graph.nodes.some((node) => node.id === id),
    resourceExists: (id) =>
      graph.simulation?.resources.some((resource) => resource.id === id) ?? false,
  });
}

export function saveBehaviorDefinition(graph: Graph, definition: BehaviorDefinition): Graph {
  const library = getBehaviorLibrary(graph);
  const existing = library.definitions.find((item) => item.id === definition.id);
  const next = { ...definition, name: definition.name.trim() };
  if (!isDefinition(next) || (next.source && !compileBehavior(next.source).ok)) return graph;
  if (!existing && library.definitions.length >= behaviorDocumentLimits.definitions) return graph;
  return setBehaviorLibrary(graph, {
    ...library,
    definitions: existing
      ? library.definitions.map((item) => (item === existing ? next : item))
      : [...library.definitions, next],
  });
}

export function removeBehaviorDefinition(graph: Graph, id: string): Graph {
  const library = getBehaviorLibrary(graph);
  return setBehaviorLibrary(graph, {
    definitions: library.definitions.filter((definition) => definition.id !== id),
    bindings: library.bindings.filter((binding) => binding.definitionId !== id),
  });
}

export function bindBehavior(graph: Graph, nodeId: string, definitionId: string): Graph {
  const library = getBehaviorLibrary(graph);
  const definition = library.definitions.find((item) => item.id === definitionId);
  if (!definition || !isBehaviorCompatible(graph, nodeId, definition)) return graph;
  if (library.bindings.length >= behaviorDocumentLimits.bindings) return graph;
  if (library.bindings.some((item) => item.nodeId === nodeId && item.definitionId === definitionId))
    return graph;
  const binding: BehaviorBinding = {
    id: crypto.randomUUID(),
    definitionId,
    nodeId,
    enabled: validateBehaviorConfiguration(graph, definition, {}).ok,
    parameters: {},
  };
  return setBehaviorLibrary(graph, { ...library, bindings: [...library.bindings, binding] });
}

export function updateBehaviorBinding(
  graph: Graph,
  id: string,
  patch: Partial<Pick<BehaviorBinding, 'enabled' | 'parameters'>>,
): Graph {
  const library = getBehaviorLibrary(graph);
  const binding = library.bindings.find((item) => item.id === id);
  if (!binding) return graph;
  const next = { ...binding, ...patch };
  if (!isBinding(next)) return graph;
  if (patch.enabled === true) {
    const definition = library.definitions.find((item) => item.id === binding.definitionId);
    if (!definition || !isBehaviorCompatible(graph, next.nodeId, definition)) return graph;
    if (!validateBehaviorConfiguration(graph, definition, next.parameters).ok) return graph;
  }
  return setBehaviorLibrary(graph, {
    ...library,
    bindings: library.bindings.map((item) => (item === binding ? next : item)),
  });
}

export function removeBehaviorBinding(graph: Graph, id: string): Graph {
  const library = getBehaviorLibrary(graph);
  return setBehaviorLibrary(graph, {
    ...library,
    bindings: library.bindings.filter((binding) => binding.id !== id),
  });
}

export function pruneBehaviorBindings(graph: Graph): Graph {
  const library = graph.diagram.settings.behaviors;
  if (!library?.bindings.length) return graph;
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));
  const bindings = library.bindings.filter((binding) => nodeIds.has(binding.nodeId));
  return bindings.length === library.bindings.length
    ? graph
    : setBehaviorLibrary(graph, { ...library, bindings });
}

export function remapBehaviorLibrary(graph: Graph, nodeIds: ReadonlyMap<string, string>): Graph {
  const library = graph.diagram.settings.behaviors;
  if (!library?.bindings.length) return graph;
  const nodeParameters = new Map(
    library.definitions.map(({ id, source }) => {
      const compiled = compileBehavior(source);
      const names = compiled.ok
        ? compiled.program.parameters.filter(({ type }) => type === 'node').map(({ name }) => name)
        : [];
      return [id, names];
    }),
  );
  const bindings = library.bindings.map((binding) => {
    const parameters = { ...binding.parameters };
    for (const name of nodeParameters.get(binding.definitionId) ?? []) {
      const original = parameters[name];
      if (typeof original === 'string') parameters[name] = nodeIds.get(original) ?? original;
    }
    return { ...binding, nodeId: nodeIds.get(binding.nodeId) ?? binding.nodeId, parameters };
  });
  return setBehaviorLibrary(graph, { ...library, bindings });
}
