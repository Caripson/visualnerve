import type { Graph, GraphEdge, GraphNode } from '../model/types';
import { getSqlRelationship, getSqlTable } from './schema';
import type { SqlImportResult } from './parser';
import {
  emptyRefreshSummary,
  type RemovedSourcePolicy,
  type SourceRefreshResult,
} from '../data/refresh';

const name = (node: GraphNode) => JSON.stringify(getSqlTable(node)!.qualifiedName);
const tableContent = (node: GraphNode) => JSON.stringify(getSqlTable(node));
const fkPair = (edge: GraphEdge, names: Map<string, string>, named = false) => {
  const data = getSqlRelationship(edge)!;
  return JSON.stringify([
    names.get(edge.sourceNodeId),
    names.get(edge.targetNodeId),
    data.columns,
    data.referencedColumns,
    ...(named ? [data.name ?? ''] : []),
  ]);
};
const fkConstraint = (edge: GraphEdge, names: Map<string, string>) => {
  const data = getSqlRelationship(edge)!;
  return data.name
    ? JSON.stringify([
        names.get(edge.sourceNodeId),
        names.get(edge.targetNodeId),
        data.columns,
        data.name,
      ])
    : undefined;
};

/** Match schema identities, retaining user edits while replacing only extracted definitions. */
export function refreshSqlSchema(
  graph: Graph,
  incoming: SqlImportResult,
  removedPolicy: RemovedSourcePolicy,
): SourceRefreshResult {
  if (!incoming.tableCount || !incoming.graph.nodes.length)
    throw new Error('The replacement script contains no supported table definitions.');
  const summary = emptyRefreshSummary();
  summary.warnings = [...incoming.warnings];
  const previousTables = graph.nodes.filter((node) => getSqlTable(node));
  const byName = new Map<string, GraphNode>();
  for (const node of previousTables) {
    const key = name(node);
    if (byName.has(key))
      throw new Error(
        `Multiple objects describe SQL table ${getSqlTable(node)!.qualifiedName.join('.')}. Refresh requires an unambiguous qualified table name.`,
      );
    byName.set(key, node);
  }
  const idMap = new Map<string, string>();
  const nextNames = new Set<string>();
  const replacementNames = new Set<string>();
  for (const node of incoming.graph.nodes) {
    const key = name(node);
    if (replacementNames.has(key))
      throw new Error(
        `The replacement SQL contains multiple tables named ${getSqlTable(node)!.qualifiedName.join('.')}. Refresh requires unambiguous qualified table names; review quoted and unquoted identifiers.`,
      );
    replacementNames.add(key);
  }
  const nodes = incoming.graph.nodes.map((node) => {
    const key = name(node);
    nextNames.add(key);
    const old = byName.get(key);
    idMap.set(node.id, old?.id ?? node.id);
    if (!old) {
      summary.added++;
      summary.objectsAdded++;
      summary.columnsAdded += getSqlTable(node)!.columns.length;
      if (summary.changes.length < 100)
        summary.changes.push({ kind: 'added', label: getSqlTable(node)!.qualifiedName.join('.') });
      return { ...node, diagramId: graph.diagram.id };
    }
    const oldColumnNames = new Set(getSqlTable(old)!.columns.map((column) => column.name));
    const newColumnNames = new Set(getSqlTable(node)!.columns.map((column) => column.name));
    summary.columnsAdded += [...newColumnNames].filter(
      (column) => !oldColumnNames.has(column),
    ).length;
    summary.columnsRemoved += [...oldColumnNames].filter(
      (column) => !newColumnNames.has(column),
    ).length;
    if (tableContent(old) !== tableContent(node)) {
      summary.changed++;
      summary.objectsChanged++;
      if (summary.changes.length < 100)
        summary.changes.push({
          kind: 'changed',
          label: getSqlTable(node)!.qualifiedName.join('.'),
        });
    } else summary.unchanged++;
    const autoDescription =
      'Referenced table outside the imported SQL script. Its schema is unknown.';
    return {
      ...old,
      height: Math.max(old.height, node.height),
      description: old.description === autoDescription ? node.description : old.description,
      metadata: {
        ...old.metadata,
        sqlTable: {
          ...getSqlTable(old)!,
          ...getSqlTable(node)!,
          external: getSqlTable(node)!.external,
        },
      },
    };
  });
  const removed = previousTables.filter((node) => !nextNames.has(name(node)));
  const removedIds = new Set(removed.map((node) => node.id));
  summary.removed = removed.length;
  summary.objectsRemoved = removed.length;
  summary.columnsRemoved += removed.reduce(
    (total, node) => total + getSqlTable(node)!.columns.length,
    0,
  );
  summary.retainedAnnotations = removedPolicy === 'retain' ? removed.length : 0;
  for (const node of removed)
    if (summary.changes.length < 100)
      summary.changes.push({ kind: 'removed', label: getSqlTable(node)!.qualifiedName.join('.') });
  const now = new Date().toISOString();
  const retained =
    removedPolicy === 'retain'
      ? removed.map((node) => {
          const { sqlTable, ...metadata } = node.metadata;
          return {
            ...node,
            externalId: undefined,
            metadata: {
              ...metadata,
              sqlSnapshot: sqlTable,
              sourceRefresh: { kind: 'sql', removedAt: now },
            },
          };
        })
      : [];
  const manual = graph.nodes.filter((node) => !getSqlTable(node));
  const allNodes = [...nodes, ...retained, ...manual];
  const surviving = new Set(allNodes.map((node) => node.id));
  const oldNames = new Map(previousTables.map((node) => [node.id, name(node)]));
  const incomingNames = new Map(incoming.graph.nodes.map((node) => [node.id, name(node)]));
  const previousForeign = graph.edges.filter(
    (edge) =>
      getSqlRelationship(edge) &&
      oldNames.has(edge.sourceNodeId) &&
      oldNames.has(edge.targetNodeId),
  );
  const exact = new Map<string, GraphEdge[]>();
  const pairs = new Map<string, GraphEdge[]>();
  const constraints = new Map<string, GraphEdge[]>();
  for (const edge of previousForeign) {
    for (const [map, key] of [
      [exact, fkPair(edge, oldNames, true)],
      [pairs, fkPair(edge, oldNames)],
    ] as const)
      map.set(key, [...(map.get(key) ?? []), edge]);
    const constraint = fkConstraint(edge, oldNames);
    if (constraint) constraints.set(constraint, [...(constraints.get(constraint) ?? []), edge]);
  }
  const newPairs = new Map<string, number>();
  const newConstraints = new Map<string, number>();
  for (const edge of incoming.graph.edges) {
    const key = fkPair(edge, incomingNames);
    newPairs.set(key, (newPairs.get(key) ?? 0) + 1);
    const constraint = fkConstraint(edge, incomingNames);
    if (constraint) newConstraints.set(constraint, (newConstraints.get(constraint) ?? 0) + 1);
  }
  const matchedEdges = new Set<string>();
  const edges = incoming.graph.edges.map((edge) => {
    const named = exact.get(fkPair(edge, incomingNames, true)) ?? [];
    const pair = fkPair(edge, incomingNames);
    const alternative = pairs.get(pair) ?? [];
    const constraint = fkConstraint(edge, incomingNames);
    const sameConstraint = constraint ? (constraints.get(constraint) ?? []) : [];
    const old =
      named.find((candidate) => !matchedEdges.has(candidate.id)) ??
      (alternative.length === 1 && newPairs.get(pair) === 1 ? alternative[0] : undefined) ??
      (sameConstraint.length === 1 && newConstraints.get(constraint!) === 1
        ? sameConstraint[0]
        : undefined);
    if (!old) {
      summary.relationshipsAdded++;
      return {
        ...edge,
        diagramId: graph.diagram.id,
        sourceNodeId: idMap.get(edge.sourceNodeId)!,
        targetNodeId: idMap.get(edge.targetNodeId)!,
      };
    }
    matchedEdges.add(old.id);
    const prior = getSqlRelationship(old)!;
    const next = getSqlRelationship(edge)!;
    if (JSON.stringify(prior) !== JSON.stringify(next)) summary.relationshipsChanged++;
    const defaultLabel = `${prior.columns.join(', ')} → ${prior.unresolved ? 'unknown referenced columns' : prior.referencedColumns.join(', ')}`;
    return {
      ...old,
      label: old.label === defaultLabel ? edge.label : old.label,
      metadata: {
        ...old.metadata,
        sqlRelationship: {
          ...prior,
          ...next,
          unresolved: next.unresolved,
          onDelete: next.onDelete,
          onUpdate: next.onUpdate,
          name: next.name,
        },
      },
    };
  });
  const previousForeignIds = new Set(previousForeign.map((edge) => edge.id));
  const removedForeign = previousForeign.filter((edge) => !matchedEdges.has(edge.id));
  summary.relationshipsRemoved = removedForeign.length;
  const manualEdges = graph.edges.filter((edge) => !previousForeignIds.has(edge.id));
  summary.affectedManualRelationships = manualEdges.filter(
    (edge) => removedIds.has(edge.sourceNodeId) || removedIds.has(edge.targetNodeId),
  ).length;
  const annotationEdges =
    removedPolicy === 'retain'
      ? removedForeign.map((edge) => {
          const { sqlRelationship, ...metadata } = edge.metadata;
          return {
            ...edge,
            edgeType: 'relationship',
            metadata: {
              ...metadata,
              sqlSnapshot: sqlRelationship,
              sourceRefresh: { kind: 'sql', removedAt: now },
            },
          };
        })
      : [];
  if (annotationEdges.length)
    summary.warnings.push(
      `${annotationEdges.length} removed schema relationships will remain as manual annotation links, without foreign-key bindings.`,
    );
  if (removed.length && removedPolicy === 'retain')
    summary.warnings.push(
      'Removed tables remain as annotation objects without SQL bindings. Their previous schema is retained only as snapshot metadata.',
    );
  return {
    sourceId: 'sql',
    summary,
    graph: {
      ...graph,
      nodes: allNodes.map((node) =>
        node.parentId && !surviving.has(node.parentId) ? { ...node, parentId: undefined } : node,
      ),
      edges: [...edges, ...manualEdges, ...annotationEdges].filter(
        (edge) => surviving.has(edge.sourceNodeId) && surviving.has(edge.targetNodeId),
      ),
    },
  };
}
