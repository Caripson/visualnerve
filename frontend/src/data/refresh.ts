import type { Graph, GraphNode } from '../model/types';
import type { CsvAnalysis, CsvDataset, CsvPathEntry } from './types';
import {
  effectiveDataset,
  getCsvNode,
  measures,
  rowPredicate,
  validateAnalysis,
  validateDataset,
} from './csv';
import {
  analysisForDataset,
  graphDatasets,
  isGeneratedCsvNode,
  reanalyzeDataModel,
  setAnalysisForDataset,
  validateDataModel,
} from './model';
import {
  validateNamedAnalysisViews,
  type NamedAnalysisView,
  type NamedAnalysisViews,
} from '../analysis/types';

export type RemovedSourcePolicy = 'retain' | 'remove';
export interface SourceChange {
  kind: 'added' | 'changed' | 'removed';
  label: string;
}
export interface SourceRefreshSummary {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  columnsAdded: number;
  columnsRemoved: number;
  objectsAdded: number;
  objectsChanged: number;
  objectsRemoved: number;
  relationshipsAdded: number;
  relationshipsChanged: number;
  relationshipsRemoved: number;
  affectedManualRelationships: number;
  retainedAnnotations: number;
  warnings: string[];
  changes: SourceChange[];
}
export interface SourceRefreshResult {
  graph: Graph;
  summary: SourceRefreshSummary;
  sourceId: string;
}
export interface CsvRefreshOptions {
  datasetId: string;
  keyColumnIds: string[];
  /** Existing column ID -> incoming column ID; null explicitly removes an old column. */
  columnMap: Record<string, string | null>;
  removedPolicy: RemovedSourcePolicy;
}
export const emptyRefreshSummary = (): SourceRefreshSummary => ({
  added: 0,
  changed: 0,
  removed: 0,
  unchanged: 0,
  columnsAdded: 0,
  columnsRemoved: 0,
  objectsAdded: 0,
  objectsChanged: 0,
  objectsRemoved: 0,
  relationshipsAdded: 0,
  relationshipsChanged: 0,
  relationshipsRemoved: 0,
  affectedManualRelationships: 0,
  retainedAnnotations: 0,
  warnings: [],
  changes: [],
});
export function defaultColumnMap(
  previous: CsvDataset,
  incoming: CsvDataset,
): Record<string, string | null> {
  return Object.fromEntries(
    previous.columns.map((column) => [
      column.id,
      incoming.columns.find((item) => item.label === column.label)?.id ?? null,
    ]),
  );
}
function identities(dataset: CsvDataset, columns: string[], side: string) {
  if (!columns.length) throw new Error('Choose at least one identity key column.');
  const indices = columns.map((id) => dataset.columns.findIndex((column) => column.id === id));
  if (indices.some((index) => index < 0))
    throw new Error('Map every identity key column to the replacement source.');
  const keys: string[] = [];
  const rows = new Map<string, number>();
  for (let index = 0; index < dataset.rows.length; index++) {
    const values = indices.map((column) => dataset.rows[index][column].trim());
    if (values.some((value) => !value))
      throw new Error(
        `${side} source has an empty identity key at data row ${index + 1}. Choose non-empty keys.`,
      );
    const key = JSON.stringify(values);
    if (rows.has(key))
      throw new Error(
        `${side} source has duplicate identity keys at data rows ${rows.get(key)! + 1} and ${index + 1}. Choose a unique combination of columns.`,
      );
    rows.set(key, index);
    keys.push(key);
  }
  return { keys, rows };
}
function mappedSource(
  previous: CsvDataset,
  incoming: CsvDataset,
  map: CsvRefreshOptions['columnMap'],
) {
  validateDataset(incoming);
  const used = new Map<string, string>();
  for (const column of previous.columns) {
    const target = map[column.id];
    if (!target) continue;
    if (!incoming.columns.some((item) => item.id === target))
      throw new Error(`Replacement column for ${column.label} is unavailable.`);
    if (used.has(target))
      throw new Error('Each replacement column can map to only one existing column.');
    used.set(target, column.id);
  }
  const existingIds = new Set(previous.columns.map((column) => column.id));
  const columns = incoming.columns.map((column) => ({
    ...column,
    id: used.get(column.id) ?? `refresh-${crypto.randomUUID()}`,
  }));
  const next: CsvDataset = {
    ...incoming,
    id: previous.id,
    diagramId: previous.diagramId,
    name: previous.name,
    createdAt: previous.createdAt,
    version: previous.version + 1,
    updatedAt: new Date().toISOString(),
    columns,
  };
  return {
    next,
    added: columns.filter((column) => !existingIds.has(column.id)).length,
    removed: previous.columns.filter((column) => !columns.some((item) => item.id === column.id))
      .length,
  };
}
function detached(node: GraphNode, now: string): GraphNode {
  const { csv: _csv, ...metadata } = node.metadata;
  return {
    ...node,
    externalId: undefined,
    parentId: undefined,
    metadata: {
      ...metadata,
      csvSnapshot: { ...getCsvNode(node)!, visible: true },
      sourceRefresh: { removedAt: now, kind: 'csv' },
    },
  };
}

/** Keyed source replacement. Work is bounded by rows and distinct historic grouping shapes. */
export function refreshCsvSource(
  graph: Graph,
  incoming: CsvDataset,
  options: CsvRefreshOptions,
): SourceRefreshResult {
  const previous = graphDatasets(graph).find((dataset) => dataset.id === options.datasetId);
  if (!previous) throw new Error('The selected CSV source is no longer in this diagram.');
  const originalAnalysis = analysisForDataset(graph, previous.id);
  if (!originalAnalysis) throw new Error('The selected CSV source has no analysis settings.');
  if (new Set(options.keyColumnIds).size !== options.keyColumnIds.length)
    throw new Error('Choose distinct identity key columns.');
  const {
    next,
    added: columnsAdded,
    removed: columnsRemoved,
  } = mappedSource(previous, incoming, options.columnMap);
  for (const key of options.keyColumnIds)
    if (!next.columns.some((column) => column.id === key))
      throw new Error('Map every identity key column to the replacement source.');
  const nextColumnIds = new Set(next.columns.map((column) => column.id));
  const required = new Set([
    ...originalAnalysis.levels,
    ...originalAnalysis.metrics.flatMap((metric) => (metric.columnId ? [metric.columnId] : [])),
    ...originalAnalysis.filters.map((filter) => filter.columnId),
    ...originalAnalysis.columnRules.map((rule) => rule.columnId),
  ]);
  if ([...required].some((id) => !nextColumnIds.has(id)))
    throw new Error(
      'Map all columns used by grouping, measures, filters and cleanup before refreshing.',
    );
  const analysis: CsvAnalysis = {
    ...originalAnalysis,
    displayColumns: originalAnalysis.displayColumns.filter((id) => nextColumnIds.has(id)),
    offset: 0,
  };
  validateAnalysis(next, analysis);
  const oldIdentity = identities(previous, options.keyColumnIds, 'Existing');
  const newIdentity = identities(next, options.keyColumnIds, 'Replacement');
  const summary = emptyRefreshSummary();
  summary.columnsAdded = columnsAdded;
  summary.columnsRemoved = columnsRemoved;
  const oldColumns = new Map(previous.columns.map((column, index) => [column.id, index]));
  const newColumns = new Map(next.columns.map((column, index) => [column.id, index]));
  const comparable = [...new Set([...oldColumns.keys(), ...newColumns.keys()])];
  const addChange = (kind: SourceChange['kind'], key: string) => {
    if (summary.changes.length < 100)
      summary.changes.push({ kind, label: JSON.parse(key).join(' · ') });
  };
  for (const [key, index] of newIdentity.rows) {
    const old = oldIdentity.rows.get(key);
    if (old === undefined) {
      summary.added++;
      addChange('added', key);
    } else if (
      comparable.some(
        (column) =>
          previous.rows[old][oldColumns.get(column)!] !== next.rows[index][newColumns.get(column)!],
      )
    ) {
      summary.changed++;
      addChange('changed', key);
    } else summary.unchanged++;
  }
  for (const key of oldIdentity.rows.keys())
    if (!newIdentity.rows.has(key)) {
      summary.removed++;
      addChange('removed', key);
    }

  const oldEffective = effectiveDataset(previous, originalAnalysis);
  const newEffective = effectiveDataset(next, analysis);
  const bound = graph.nodes.filter(
    (node) => isGeneratedCsvNode(node) && getCsvNode(node)?.datasetId === previous.id,
  );
  const copies = graph.nodes.filter(
    (node) =>
      !isGeneratedCsvNode(node) &&
      node.metadata.csv !== undefined &&
      getCsvNode(node)?.datasetId === previous.id,
  );
  type Shape = { ids: string[]; old: Map<string, number[]>; next: Map<string, string[][]> };
  const shapes = new Map<string, Shape>();
  for (const node of bound) {
    const ids = getCsvNode(node)!.path.map((entry) => entry.columnId);
    if (ids.some((id) => !oldColumns.has(id) || !newColumns.has(id))) continue;
    const key = JSON.stringify(ids);
    if (shapes.has(key)) continue;
    const shape: Shape = { ids, old: new Map(), next: new Map() };
    for (let index = 0; index < oldEffective.rows.length; index++) {
      const path = JSON.stringify(
        ids.map((columnId) => ({
          columnId,
          value: oldEffective.rows[index][oldColumns.get(columnId)!].trim(),
        })),
      );
      const members = shape.old.get(path);
      if (members) members.push(index);
      else shape.old.set(path, [index]);
    }
    for (const row of newEffective.rows) {
      const path = JSON.stringify(
        ids.map((columnId) => ({ columnId, value: row[newColumns.get(columnId)!].trim() })),
      );
      const members = shape.next.get(path);
      if (members) members.push(row);
      else shape.next.set(path, [row]);
    }
    shapes.set(key, shape);
  }
  const candidates = new Map<string, string>();
  const targets = new Map<string, string[]>();
  for (const node of bound) {
    const data = getCsvNode(node)!;
    const shape = shapes.get(JSON.stringify(data.path.map((entry) => entry.columnId)));
    if (!shape) continue;
    const possible = new Set<string>();
    if (!data.path.length) possible.add('[]');
    for (const index of shape.old.get(data.groupKey) ?? []) {
      const newIndex = newIdentity.rows.get(oldIdentity.keys[index]);
      if (newIndex === undefined) continue;
      possible.add(
        JSON.stringify(
          shape.ids.map((columnId) => ({
            columnId,
            value: newEffective.rows[newIndex][newColumns.get(columnId)!].trim(),
          })),
        ),
      );
      if (possible.size > 1) break;
    }
    if (possible.size === 1) {
      const path = [...possible][0];
      candidates.set(node.id, path);
      targets.set(path, [...(targets.get(path) ?? []), node.id]);
    } else if (possible.size > 1)
      summary.warnings.push(
        `Group ${node.title} split across multiple replacement groups; its annotations will not be assigned automatically.`,
      );
  }
  const removedIds = new Set<string>();
  const remapped = new Map<string, GraphNode>();
  const accepts = rowPredicate(newEffective, [], analysis);
  for (const node of bound) {
    const data = getCsvNode(node)!;
    const pathKey = candidates.get(node.id);
    if (!pathKey || targets.get(pathKey)!.length !== 1) {
      removedIds.add(node.id);
      if (pathKey)
        summary.warnings.push(
          `Multiple groups now map to ${node.title}; automatic annotation matching was skipped.`,
        );
      continue;
    }
    const path = JSON.parse(pathKey) as CsvPathEntry[];
    const shape = shapes.get(JSON.stringify(path.map((entry) => entry.columnId)))!;
    const rows = (shape.next.get(pathKey) ?? []).filter(accepts);
    const level = analysis.levels[path.length];
    const childCount = level
      ? new Set(rows.map((row) => row[newColumns.get(level)!].trim())).size
      : 0;
    const title =
      node.title === (data.path.at(-1)?.value || previous.name)
        ? path.at(-1)?.value || next.name
        : node.title;
    remapped.set(node.id, {
      ...node,
      title,
      externalId: `csv:${previous.id}:${pathKey}`,
      metadata: {
        ...node.metadata,
        csv: {
          ...data,
          path,
          groupKey: pathKey,
          measures: measures(next, analysis, rows),
          rowCount: rows.length,
          totalChildren: childCount,
          hiddenChildren: childCount,
          visible: false,
        },
      },
    });
  }
  const focus = JSON.stringify(analysis.focusPath);
  if (analysis.focusPath.length) {
    const focused = bound.find((node) => getCsvNode(node)!.groupKey === focus);
    const updated = focused && remapped.get(focused.id);
    analysis.focusPath = updated ? getCsvNode(updated)!.path : [];
    if (!updated)
      summary.warnings.push(
        'The focused group could not be matched. The refreshed view returns to all data.',
      );
  }
  summary.objectsRemoved = removedIds.size;
  summary.retainedAnnotations = options.removedPolicy === 'retain' ? removedIds.size : 0;
  summary.affectedManualRelationships = graph.edges.filter(
    (edge) =>
      edge.metadata.csvGenerated !== true &&
      edge.metadata.csvModelGenerated !== true &&
      (removedIds.has(edge.sourceNodeId) || removedIds.has(edge.targetNodeId)),
  ).length;
  const now = new Date().toISOString();
  // Manual copies remain objects even when their source group disappears.
  const copyUpdates = new Map<string, GraphNode>();
  for (const node of copies) {
    const data = getCsvNode(node)!;
    const original = bound.find((candidate) => getCsvNode(candidate)!.groupKey === data.groupKey);
    const matched = original && remapped.get(original.id);
    copyUpdates.set(
      node.id,
      matched
        ? {
            ...node,
            metadata: {
              ...node.metadata,
              csv: {
                ...getCsvNode(matched)!,
                hiddenMetricIds: data.hiddenMetricIds,
                displayColumns: data.displayColumns,
                visible: data.visible,
              },
            },
          }
        : detached(node, now),
    );
  }
  const nodes = graph.nodes.flatMap((node) =>
    removedIds.has(node.id)
      ? options.removedPolicy === 'retain'
        ? [detached(node, now)]
        : []
      : [remapped.get(node.id) ?? copyUpdates.get(node.id) ?? node],
  );
  const surviving = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.flatMap((edge) => {
    if (!surviving.has(edge.sourceNodeId) || !surviving.has(edge.targetNodeId)) return [];
    if (
      (edge.metadata.csvGenerated === true || edge.metadata.csvModelGenerated === true) &&
      (removedIds.has(edge.sourceNodeId) || removedIds.has(edge.targetNodeId))
    )
      return [];
    return [edge];
  });
  let pending: Graph = {
    ...graph,
    dataset: graph.dataset?.id === next.id ? next : graph.dataset,
    datasets: (graph.datasets ?? []).map((dataset) => (dataset.id === next.id ? next : dataset)),
    nodes: nodes.map((node) =>
      node.parentId && !surviving.has(node.parentId) ? { ...node, parentId: undefined } : node,
    ),
    edges,
  };
  pending = setAnalysisForDataset(pending, next.id, analysis);
  const remapFocus = (
    path: CsvPathEntry[],
    settings: CsvAnalysis,
    context: string,
  ): CsvPathEntry[] => {
    if (!path.length) return path;
    const before = effectiveDataset(previous, settings);
    const after = effectiveDataset(next, settings);
    const indices = path.map((entry) =>
      previous.columns.findIndex((column) => column.id === entry.columnId),
    );
    const nextIndices = path.map((entry) =>
      next.columns.findIndex((column) => column.id === entry.columnId),
    );
    if (nextIndices.some((index) => index < 0))
      throw new Error(`${context} uses a removed focus column. Map it before refreshing.`);
    const destinations = new Map<string, CsvPathEntry[]>();
    for (let index = 0; index < before.rows.length; index++) {
      if (!path.every((entry, part) => before.rows[index][indices[part]].trim() === entry.value))
        continue;
      const replacement = newIdentity.rows.get(oldIdentity.keys[index]);
      if (replacement === undefined) continue;
      const value = path.map((entry, part) => ({
        ...entry,
        value: after.rows[replacement][nextIndices[part]].trim(),
      }));
      destinations.set(JSON.stringify(value), value);
      if (destinations.size > 1) break;
    }
    if (destinations.size !== 1)
      throw new Error(
        `${context} focused group cannot be matched unambiguously. Clear its focus before refreshing.`,
      );
    return [...destinations.values()][0];
  };
  const entityFocus = pending.diagram.settings.csvEntityFocus;
  if (entityFocus?.datasetId === next.id) {
    try {
      pending = {
        ...pending,
        diagram: {
          ...pending.diagram,
          settings: {
            ...pending.diagram.settings,
            csvEntityFocus: {
              ...entityFocus,
              path: remapFocus(entityFocus.path, originalAnalysis, 'The linked-entity view'),
            },
          },
        },
      };
    } catch (error) {
      pending = {
        ...pending,
        diagram: {
          ...pending.diagram,
          settings: { ...pending.diagram.settings, csvEntityFocus: undefined },
        },
      };
      summary.warnings.push(
        `${error instanceof Error ? error.message : 'Linked-entity focus changed.'} The view returns to all linked data.`,
      );
    }
  }
  const named = graph.diagram.settings.namedAnalysisViews as NamedAnalysisViews | undefined;
  if (named !== undefined) {
    // Validate first: malformed saved settings must never be silently discarded.
    validateNamedAnalysisViews(graph, named, validateDataModel);
    const views: NamedAnalysisView[] = named.views.map((view) => {
      const context = `Saved analysis view “${view.name}”`;
      try {
        const saved =
          view.csvSourceAnalyses?.[next.id] ??
          (graph.dataset?.id === next.id ? view.csvAnalysis : undefined);
        let updated = view;
        if (saved) {
          validateAnalysis(next, saved);
          const updatedAnalysis = {
            ...saved,
            focusPath: remapFocus(saved.focusPath, saved, context),
          };
          updated = {
            ...view,
            ...(view.csvSourceAnalyses?.[next.id]
              ? { csvSourceAnalyses: { ...view.csvSourceAnalyses, [next.id]: updatedAnalysis } }
              : {}),
            ...(graph.dataset?.id === next.id && view.csvAnalysis
              ? { csvAnalysis: updatedAnalysis }
              : {}),
          };
        }
        if (view.csvEntityFocus?.datasetId === next.id)
          updated = {
            ...updated,
            csvEntityFocus: {
              ...view.csvEntityFocus,
              path: remapFocus(view.csvEntityFocus.path, saved ?? originalAnalysis, context),
            },
          };
        validateNamedAnalysisViews(pending, { version: 1, views: [updated] }, validateDataModel);
        return updated;
      } catch (error) {
        throw new Error(
          `${context} is no longer valid: ${error instanceof Error ? error.message : 'source columns changed.'} Update that saved view or map its columns before refreshing.`,
        );
      }
    });
    pending = {
      ...pending,
      diagram: {
        ...pending.diagram,
        settings: { ...pending.diagram.settings, namedAnalysisViews: { ...named, views } },
      },
    };
  }
  validateDataModel(pending);
  // Rebuild every source once so model relationships are refreshed with the changed groups.
  const rebuilt = reanalyzeDataModel(pending);
  const byId = new Map(rebuilt.nodes.map((node) => [node.id, node]));
  rebuilt.edges = rebuilt.edges.filter(
    (edge) =>
      edge.metadata.csvGenerated !== true ||
      getCsvNode(byId.get(edge.targetNodeId)!)?.datasetId !== next.id ||
      byId.get(edge.targetNodeId)?.parentId === edge.sourceNodeId,
  );
  const previousIds = new Set(graph.nodes.map((node) => node.id));
  summary.objectsAdded = rebuilt.nodes.filter((node) => !previousIds.has(node.id)).length;
  summary.objectsChanged = remapped.size;
  const oldEdges = new Set(graph.edges.map((edge) => edge.id));
  const newEdges = new Set(rebuilt.edges.map((edge) => edge.id));
  summary.relationshipsAdded = rebuilt.edges.filter((edge) => !oldEdges.has(edge.id)).length;
  summary.relationshipsRemoved = graph.edges.filter((edge) => !newEdges.has(edge.id)).length;
  summary.warnings = [...new Set(summary.warnings)].slice(0, 50);
  rebuilt.diagram = {
    ...rebuilt.diagram,
    settings: {
      ...rebuilt.diagram.settings,
      csvRefreshKeys: {
        ...(graph.diagram.settings.csvRefreshKeys as Record<string, string[]> | undefined),
        [next.id]: [...options.keyColumnIds],
      },
    },
  };
  return { graph: rebuilt, summary, sourceId: next.id };
}
