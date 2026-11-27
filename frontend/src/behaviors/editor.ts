import { isValidNodeTitle, type Graph, type GraphEdge } from '../model/types';
import { getBehaviorLibrary } from './document';
import { compileBehavior, runBehavior, type BehaviorAction } from './language';

export interface BehaviorTraceEntry {
  definitionName: string;
  bindingId: string;
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  line: number;
  column: number;
  previousName: string;
  proposedName?: string;
  outcome: 'renamed' | 'unchanged' | 'rejected';
  message: string;
}

function isDuplicate(graph: Graph, edge: GraphEdge): boolean {
  return graph.edges.some(
    (previous) =>
      previous.sourceNodeId === edge.sourceNodeId &&
      previous.targetNodeId === edge.targetNodeId &&
      previous.edgeType === edge.edgeType &&
      previous.direction === edge.direction &&
      (previous.metadata.sourceHandle ?? 'out') === (edge.metadata.sourceHandle ?? 'out') &&
      (previous.metadata.targetHandle ?? 'in') === (edge.metadata.targetHandle ?? 'in'),
  );
}

/** Evaluate only the ordinary editor connect command, before committing its graph delta. */
export function evaluateConnectionBehaviors(graph: Graph, edge: GraphEdge) {
  const trace: BehaviorTraceEntry[] = [];
  const library = getBehaviorLibrary(graph);
  const bindings = library.bindings.filter(
    (binding) => binding.enabled && binding.nodeId === edge.sourceNodeId,
  );
  if (!bindings.length || isDuplicate(graph, edge)) return { nodes: graph.nodes, trace };
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const target = nodes.get(edge.targetNodeId);
  if (!target || !nodes.has(edge.sourceNodeId)) return { nodes: graph.nodes, trace };

  const proposals: BehaviorTraceEntry[] = [];
  const definitions = new Map(library.definitions.map((definition) => [definition.id, definition]));
  const event = {
    kind: 'connectionAdded' as const,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    edgeId: edge.id,
  };

  for (const binding of bindings) {
    const definition = definitions.get(binding.definitionId);
    if (!definition) continue;
    const entry = {
      definitionName: definition.name,
      bindingId: binding.id,
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: target.id,
      previousName: target.title,
    };
    const compiled = compileBehavior(definition.source);
    if (compiled.ok && !compiled.program.contexts.includes('editor')) continue;
    const result = compiled.ok
      ? runBehavior(compiled.program, binding.parameters, event, {
          nodeExists: (id) => nodes.has(id),
        })
      : compiled;
    if (!result.ok) {
      trace.push({ ...entry, ...result.error, outcome: 'rejected' });
      continue;
    }
    const renames = result.actions.filter(
      (action): action is Extract<BehaviorAction, { kind: 'rename' }> => action.kind === 'rename',
    );
    for (const action of renames) {
      const candidate = action.title.trim();
      const proposal = {
        ...entry,
        line: action.line,
        column: action.column,
        proposedName: candidate,
      };
      if (action.nodeId !== target.id || !isValidNodeTitle(candidate)) {
        trace.push({
          ...proposal,
          outcome: 'rejected',
          message: 'Proposed node title is invalid.',
        });
      } else {
        proposals.push({
          ...proposal,
          outcome: candidate === target.title ? 'unchanged' : 'renamed',
          message:
            candidate === target.title
              ? 'The node already has this title.'
              : 'Renamed the target node.',
        });
      }
    }
  }
  const proposedNames = new Set(proposals.map(({ proposedName }) => proposedName));
  if (proposedNames.size > 1) {
    trace.push(
      ...proposals.map((proposal) => ({
        ...proposal,
        outcome: 'rejected' as const,
        message:
          'Active Behaviors proposed different names for the same target. Its name was kept.',
      })),
    );
    return { nodes: graph.nodes, trace };
  }
  trace.push(...proposals);
  const title = proposals[0]?.proposedName;
  return {
    nodes:
      title && title !== target.title
        ? graph.nodes.map((node) => (node.id === target.id ? { ...node, title } : node))
        : graph.nodes,
    trace,
  };
}
