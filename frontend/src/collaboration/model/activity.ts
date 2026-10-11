import { StorageError } from '../../model/errors';
import type { Graph, GraphEdge } from '../../model/types';
import {
  type ActivityEvent,
  type ActivityKind,
  type CollaborationActionContext,
  type CollaborationGraph,
} from './types';
import { collaborationFor, validateCollaboration } from './validation';
import {
  appendCollaborationActivity,
  assertCollaborationContext,
  collaborationActivityEvent,
  collaborationWriterTime,
} from './service';

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Stable JSON comparison ignores object insertion order, while preserving array order. */
function canonical(value: unknown): string {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => compareText(a, b))
          .map(([key, value]) => [key, visit(value)]),
      );
    return value;
  };
  return JSON.stringify(visit(value));
}
const equal = (before: unknown, after: unknown) =>
  before === after || canonical(before) === canonical(after);
function semanticEntity(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        !['version', 'createdAt', 'updatedAt', 'x', 'y', 'width', 'height', 'collapsed'].includes(
          key,
        ),
    ),
  );
}
function semanticNode(value: Graph['nodes'][number]): Record<string, unknown> {
  return {
    ...semanticEntity(value),
    metadata: Object.fromEntries(
      Object.entries(value.metadata).filter(([key]) => key !== 'spatial'),
    ),
  };
}
function semanticDiagram(graph: Graph): Record<string, unknown> {
  const diagram = Object.fromEntries(
    Object.entries(graph.diagram).filter(
      ([key]) => !['version', 'createdAt', 'updatedAt', 'collaboration', 'settings'].includes(key),
    ),
  );
  const settings = Object.fromEntries(
    Object.entries(graph.diagram.settings).filter(
      ([key]) =>
        !['viewport', 'grid', 'snap', 'spatialView', 'entityOrder', 'csvDatasetOrder'].includes(
          key,
        ),
    ),
  );
  return { ...diagram, settings };
}
type Summary = Pick<ActivityEvent, 'kind' | 'summary' | 'nodeIds' | 'entityId'>;
function changes<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  semantic: (value: T) => Record<string, unknown> = semanticEntity,
) {
  const previous = new Map(before.map((item) => [item.id, item]));
  const current = new Map(after.map((item) => [item.id, item]));
  const ordered = (items: T[]) => items.sort((a, b) => compareText(a.id, b.id));
  return {
    created: ordered(after.filter((item) => !previous.has(item.id))),
    updated: ordered(
      after.filter(
        (item) => previous.has(item.id) && !equal(semantic(previous.get(item.id)!), semantic(item)),
      ),
    ),
    removed: ordered(before.filter((item) => !current.has(item.id))),
  };
}

/** Layout, camera, timestamps and collaboration annotations do not generate graph-edit noise. */
export function summarizeGraphActivity(before: Graph, after: Graph): Summary[] {
  const summaries: Summary[] = [];
  if (!equal(semanticDiagram(before), semanticDiagram(after)))
    summaries.push({ kind: 'diagram.updated', summary: 'Diagram details or settings updated.' });
  const nodeChanges = changes(before.nodes, after.nodes, semanticNode);
  for (const operation of ['created', 'updated', 'removed'] as const) {
    const nodes = nodeChanges[operation];
    if (nodes.length)
      summaries.push({
        kind: `nodes.${operation}`,
        summary: `${operation[0].toUpperCase()}${operation.slice(1)} ${nodes.length} node${nodes.length === 1 ? '' : 's'}.`,
        nodeIds: nodes.map((node) => node.id).slice(0, 32),
        ...(nodes.length === 1 ? { entityId: nodes[0].id } : {}),
      });
  }
  const edgeChanges = changes(before.edges, after.edges);
  for (const operation of ['created', 'updated', 'removed'] as const) {
    const edges: GraphEdge[] = edgeChanges[operation];
    if (edges.length)
      summaries.push({
        kind: `connections.${operation}`,
        summary: `${operation[0].toUpperCase()}${operation.slice(1)} ${edges.length} connection${edges.length === 1 ? '' : 's'}.`,
        nodeIds: [...new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]))]
          .sort()
          .slice(0, 32),
        ...(edges.length === 1 ? { entityId: edges[0].id } : {}),
      });
  }
  if (
    !equal(
      before.owners.map(semanticEntity).sort((a, b) => compareText(String(a.id), String(b.id))),
      after.owners.map(semanticEntity).sort((a, b) => compareText(String(a.id), String(b.id))),
    )
  )
    summaries.push({ kind: 'owners.updated', summary: 'Diagram responsibility owners updated.' });
  if (!equal(before.simulation, after.simulation))
    summaries.push({ kind: 'simulation.updated', summary: 'Process simulation model updated.' });
  if (!equal([before.dataset, before.datasets], [after.dataset, after.datasets]))
    summaries.push({ kind: 'data.updated', summary: 'Diagram data sources updated.' });
  return summaries;
}

/** Refreshes title snapshots while preserving all work attached to deleted nodes. */
export function retainCollaborationNodeTitles<G extends CollaborationGraph>(graph: G): G {
  if (!graph.diagram.collaboration) return graph;
  const document = structuredClone(collaborationFor(graph));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node.title]));
  let changed = false;
  for (const item of [...document.comments, ...document.tasks]) {
    const title = item.nodeId ? nodes.get(item.nodeId) : undefined;
    if (title !== undefined && title !== item.nodeTitle) {
      item.nodeTitle = title;
      changed = true;
    }
  }
  return changed ? { ...graph, diagram: { ...graph.diagram, collaboration: document } } : graph;
}

/** Call once at a successful local semantic save boundary, with adapter-owned actor/source. */
export function appendSemanticActivity<G extends CollaborationGraph>(
  before: Graph,
  after: G,
  context: CollaborationActionContext,
): G {
  const summaries = summarizeGraphActivity(before, after);
  if (!summaries.length) return after;
  const document = structuredClone(collaborationFor(after));
  assertCollaborationContext(context, document);
  if (context.role === 'viewer')
    throw new StorageError(403, 'Viewers cannot record document changes.');
  const writer = { ...context, now: collaborationWriterTime(context) };
  const events = summaries.map(({ kind, summary, ...details }) =>
    collaborationActivityEvent(writer, kind as ActivityKind, summary, details),
  );
  appendCollaborationActivity(document, events);
  validateCollaboration(document);
  return retainCollaborationNodeTitles({
    ...after,
    diagram: { ...after.diagram, collaboration: document },
  });
}

export const recordGraphActivity = appendSemanticActivity;
