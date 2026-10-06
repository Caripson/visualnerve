import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { emptyPresentation, validatePresentation, type PresentationDefinition } from './types';

export function getPresentation(graph: Graph): PresentationDefinition {
  const definition = graph.diagram.settings.presentation;
  if (definition === undefined) return emptyPresentation();
  validatePresentation(definition);
  return { ...definition, nodeIds: [...definition.nodeIds] };
}
export function presentationNumber(graph: Graph, nodeId: string): number | null {
  const index = getPresentation(graph).nodeIds.indexOf(nodeId);
  return index < 0 ? null : index + 1;
}
export function setPresentation(graph: Graph, definition: PresentationDefinition): Graph {
  validatePresentation(definition, graph);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        presentation: { ...definition, nodeIds: [...definition.nodeIds] },
      },
    },
  };
}
export function assignPresentationNumber(
  graph: Graph,
  nodeId: string,
  number: number | null,
): Graph {
  if (!graph.nodes.some((node) => node.id === nodeId))
    throw new StorageError(422, 'Presentation node must belong to this diagram.');
  const definition = getPresentation(graph);
  const nodeIds = definition.nodeIds.filter((id) => id !== nodeId);
  if (number !== null) {
    if (!Number.isSafeInteger(number) || number < 1 || number > nodeIds.length + 1)
      throw new StorageError(
        422,
        'Choose a contiguous presentation number from 1 to the next slot.',
      );
    nodeIds.splice(number - 1, 0, nodeId);
  }
  return setPresentation(graph, { ...definition, nodeIds });
}
export function autoNumber(graph: Graph, nodeIds = graph.nodes.map((node) => node.id)): Graph {
  return setPresentation(graph, { ...getPresentation(graph), nodeIds: [...new Set(nodeIds)] });
}
export function prunePresentation(graph: Graph): Graph {
  if (graph.diagram.settings.presentation === undefined) return graph;
  const definition = getPresentation(graph);
  const existing = new Set(graph.nodes.map((node) => node.id));
  const nodeIds = definition.nodeIds.filter((id) => existing.has(id));
  return nodeIds.length === definition.nodeIds.length
    ? graph
    : setPresentation(graph, { ...definition, nodeIds });
}
export function remapPresentation(graph: Graph, nodeIds: Map<string, string>): Graph {
  if (graph.diagram.settings.presentation === undefined) return graph;
  const definition = getPresentation(graph);
  return setPresentation(graph, {
    ...definition,
    nodeIds: definition.nodeIds.flatMap((id) => {
      const remapped = nodeIds.get(id);
      return remapped ? [remapped] : [];
    }),
  });
}
