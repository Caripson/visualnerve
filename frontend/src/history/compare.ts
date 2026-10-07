import type { Graph } from '../model/types';
import { graphDatasets } from '../data/model';
import { stableJson } from './codec';
import type { HistoryChange, HistoryComparison } from './types';

const omitted = new Set(['version', 'createdAt', 'updatedAt']);
function content(value: unknown, settings = false, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => content(item, false, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !(depth === 0 && omitted.has(key)) &&
          !(settings && ['viewport', 'viewportDevice'].includes(key)),
      )
      .map(([key, item]) => [
        key,
        key === 'settings'
          ? content(item, true, depth + 1)
          : settings && key === 'spatialView' && item && typeof item === 'object'
            ? content(
                Object.fromEntries(Object.entries(item).filter(([name]) => name !== 'camera')),
                false,
                depth + 1,
              )
            : content(item, false, depth + 1),
      ]),
  );
}
function fields(before: unknown, after: unknown, prefix = ''): string[] {
  if (stableJson(before) === stableJson(after)) return [];
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  )
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) =>
        fields(
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
          prefix ? `${prefix}.${key}` : key,
        ),
      );
  return [prefix || 'content'];
}
function equalRows(a: string[][], b: string[][]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index].length !== b[index].length) return false;
    for (let cell = 0; cell < a[index].length; cell++)
      if (a[index][cell] !== b[index][cell]) return false;
  }
  return true;
}
const layoutField = (field: string) =>
  ['x', 'y', 'width', 'height', 'collapsed'].includes(field) ||
  field === 'metadata.spatial' ||
  field === 'metadata.spatial.version' ||
  field === 'metadata.spatial.position' ||
  field.startsWith('metadata.spatial.position.');

/** Changes describe saved structures; impact follows modeled arrows, not inferred execution. */
export function compareHistoryGraphs(
  before: Graph,
  after: Graph,
  context: Pick<HistoryComparison, 'fromSnapshotId' | 'toSnapshotId' | 'currentVersion'>,
  rowDigests?: { before: Map<string, string>; after: Map<string, string> },
): HistoryComparison {
  const counts = Object.fromEntries(
    ['diagram', 'node', 'edge', 'owner', 'source'].map((entity) => [
      entity,
      { added: 0, removed: 0, changed: 0 },
    ]),
  ) as HistoryComparison['counts'];
  const changes: HistoryChange[] = [];
  const seeds = new Set<string>();
  let totalChanges = 0;
  let detailsTruncated = false;
  const add = (change: HistoryChange) => {
    counts[change.entity][change.kind]++;
    totalChanges++;
    if (changes.length < 500) {
      detailsTruncated ||=
        change.fields.length > 100 ||
        change.fields.some((field) => field.length > 300) ||
        change.label.length > 500;
      changes.push({
        ...change,
        label: change.label.slice(0, 500),
        fields: change.fields.slice(0, 100).map((field) => field.slice(0, 300)),
      });
    }
  };
  const entities = <T extends { id: string }>(
    entity: HistoryChange['entity'],
    old: T[],
    next: T[],
    label: (value: T) => string,
  ) => {
    const left = new Map(old.map((item) => [item.id, item]));
    const right = new Map(next.map((item) => [item.id, item]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id),
        b = right.get(id);
      const changed = a && b ? fields(content(a), content(b)) : [];
      if (a && b && !changed.length) continue;
      add({
        entity,
        id,
        label: label((b ?? a)!),
        kind: !a ? 'added' : !b ? 'removed' : 'changed',
        fields: changed,
      });
      if (entity === 'node' && (!a || !b || changed.some((field) => !layoutField(field))))
        seeds.add(id);
      if (entity === 'edge') {
        for (const edge of [a, b])
          if (edge) {
            const value = edge as unknown as Graph['edges'][number];
            seeds.add(value.sourceNodeId);
            seeds.add(value.targetNodeId);
          }
      }
      if (entity === 'owner')
        for (const node of [...before.nodes, ...after.nodes])
          if (node.ownerIds.includes(id)) seeds.add(node.id);
    }
  };
  entities('node', before.nodes, after.nodes, (node) => node.title);
  entities(
    'edge',
    before.edges,
    after.edges,
    (edge) => edge.label || `${edge.sourceNodeId} → ${edge.targetNodeId}`,
  );
  entities('owner', before.owners, after.owners, (owner) => owner.name);
  const diagramFields = fields(content(before.diagram), content(after.diagram));
  diagramFields.push(
    ...fields(before.simulation ?? {}, after.simulation ?? {}).map(
      (field) => `simulation.${field}`,
    ),
  );
  if (diagramFields.length)
    add({
      entity: 'diagram',
      id: after.diagram.id,
      label: after.diagram.name,
      kind: 'changed',
      fields: diagramFields,
    });
  const sourcesBefore = graphDatasets(before),
    sourcesAfter = graphDatasets(after);
  const sources = new Map(sourcesBefore.map((source) => [source.id, source]));
  for (const id of new Set([...sourcesBefore, ...sourcesAfter].map((source) => source.id))) {
    const a = sources.get(id),
      b = sourcesAfter.find((source) => source.id === id);
    // A shared immutable row array needs no full 100k-row traversal.
    const changed =
      a && b
        ? [
            ...fields(content({ ...a, rows: undefined }), content({ ...b, rows: undefined })),
            ...(rowDigests?.before.has(id) && rowDigests.after.has(id)
              ? rowDigests.before.get(id) !== rowDigests.after.get(id)
                ? ['rows']
                : []
              : !equalRows(a.rows, b.rows)
                ? ['rows']
                : []),
          ]
        : [];
    if (a && b && !changed.length) continue;
    add({
      entity: 'source',
      id,
      label: (b ?? a)!.name,
      kind: !a ? 'added' : !b ? 'removed' : 'changed',
      fields: changed,
    });
    for (const node of [...before.nodes, ...after.nodes])
      if ((node.metadata.csv as { datasetId?: string } | undefined)?.datasetId === id)
        seeds.add(node.id);
  }
  if (
    diagramFields.some((field) =>
      /(?:csvAnalysis|csvSourceAnalyses|csvRelationships|namedAnalysisViews|sqlQuery|codeAnalysis)/.test(
        field,
      ),
    )
  )
    for (const node of [...before.nodes, ...after.nodes])
      if (
        ['csv', 'sql', 'sqlTable', 'sqlQuerySource', 'sqlQueryResult', 'codeObject'].some(
          (key) => node.metadata[key] !== undefined,
        )
      )
        seeds.add(node.id);
  const adjacency = new Map<string, string[]>();
  const allEdges = new Map([...before.edges, ...after.edges].map((edge) => [edge.id, edge]));
  const link = (from: string, to: string) => {
    const next = adjacency.get(from);
    if (next) next.push(to);
    else adjacency.set(from, [to]);
  };
  for (const edge of [...before.edges, ...after.edges]) {
    if (edge.direction === 'backward') link(edge.targetNodeId, edge.sourceNodeId);
    else if (edge.direction === 'both' || edge.direction === 'none') {
      link(edge.sourceNodeId, edge.targetNodeId);
      link(edge.targetNodeId, edge.sourceNodeId);
    } else link(edge.sourceNodeId, edge.targetNodeId);
  }
  const queue = [...seeds];
  for (let index = 0; index < queue.length; index++)
    for (const next of adjacency.get(queue[index]) ?? [])
      if (!seeds.has(next)) {
        seeds.add(next);
        queue.push(next);
      }
  const affectedEdges = [...allEdges.values()].filter(
    (edge) => seeds.has(edge.sourceNodeId) || seeds.has(edge.targetNodeId),
  );
  return {
    diagramId: after.diagram.id,
    ...context,
    counts,
    changes,
    totalChanges,
    changesTruncated: totalChanges > changes.length,
    affectedNodeIds: [...seeds].slice(0, 2000),
    affectedEdgeIds: affectedEdges.slice(0, 2000).map((edge) => edge.id),
    affectedTotal: seeds.size,
    affectedTruncated: seeds.size > 2000 || affectedEdges.length > 2000,
    warnings: [
      'Affected objects follow the relationships and arrows modeled in this diagram; this is not an execution plan.',
      ...(detailsTruncated
        ? [
            'Change details are limited to 100 field paths per object, 300 characters per path and 500 characters per label. Counts include all changed objects.',
          ]
        : []),
    ],
  };
}
