import type { Graph, GraphEdge } from '../model/types';
import type { EdgeNotation, NodeNotation } from './types';

/** Choosing a collection never changes the execution semantics of a document. */
export function defaultNotationConnection(
  graph: Graph,
  sourceId: string,
  targetId: string,
): Pick<GraphEdge, 'notation'> {
  const source = graph.nodes.find((node) => node.id === sourceId)?.notation;
  const target = graph.nodes.find((node) => node.id === targetId)?.notation;
  if (!source || !target || source.collection !== target.collection) return {};
  const kind = source.diagramKind ?? graph.diagram.notation?.diagramKind;
  const symbol =
    source.collection === 'hipo'
      ? kind === 'vtoc'
        ? 'hierarchy'
        : 'data-flow'
      : source.collection.startsWith('dfd')
        ? 'data-flow'
        : source.collection === 'bpmn'
          ? kind === 'conversation'
            ? 'conversation-link'
            : 'sequence-flow'
          : kind === 'activity' || kind === 'interaction-overview'
            ? 'control-flow'
            : kind === 'state-machine'
              ? 'transition'
              : kind === 'sequence'
                ? 'synchronous-message'
                : 'association';
  return { notation: { collection: source.collection, symbol } as EdgeNotation };
}
export function nextNodeNotation(anchor: NodeNotation): NodeNotation {
  return {
    collection: anchor.collection,
    symbol: anchor.symbol,
    ...(anchor.diagramKind ? { diagramKind: anchor.diagramKind } : {}),
    ...(anchor.compartments
      ? { compartments: anchor.compartments.map((section) => ({ ...section, lines: [] })) }
      : {}),
  } as NodeNotation;
}
