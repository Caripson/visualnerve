import type { Graph, GraphNode, GraphEdge } from '../model/types';
import { newEdge } from '../model/types';
import {
  csvGraph,
  defaultAnalysis,
  effectiveDataset,
  getCsvNode,
  rowPredicate,
  validateAnalysis,
} from './csv';
import type { CsvAnalysis, CsvDataset, CsvPathEntry } from './types';

export interface CsvSourceRelationship {
  id: string;
  sourceDatasetId: string;
  sourceColumnId: string;
  targetDatasetId: string;
  targetColumnId: string;
  matchMode?: 'exact' | 'trim' | 'case-insensitive';
}
export interface CsvEntityFocus {
  datasetId: string;
  path: CsvPathEntry[];
}
export interface CsvRelationshipPreview {
  sourceRows: number;
  targetRows: number;
  matchedSourceRows: number;
  matchedTargetRows: number;
  unmatchedSourceRows: number;
  unmatchedTargetRows: number;
  missingSourceRows: number;
  missingTargetRows: number;
  duplicateSourceKeys: number;
  duplicateTargetKeys: number;
  matchedPairs: number;
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
}
export const dataModelLimits = {
  sources: 8,
  relationships: 32,
  nodes: 12000,
  edges: 10000,
  cells: 20000000,
} as const;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const requireValue = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
export function graphDatasets(graph: Graph): CsvDataset[] {
  return [...(graph.dataset ? [graph.dataset] : []), ...(graph.datasets ?? [])];
}
export function analysisForDataset(graph: Graph, datasetId: string): CsvAnalysis | undefined {
  const dataset = graphDatasets(graph).find((source) => source.id === datasetId);
  if (!dataset) return;
  return (
    graph.diagram.settings.csvSourceAnalyses?.[datasetId] ??
    (graph.dataset?.id === datasetId ? graph.diagram.settings.csvAnalysis : undefined) ?? {
      ...defaultAnalysis(dataset),
      metrics: [{ id: `source-count-${dataset.id}`, operation: 'count' }],
    }
  );
}
export function datasetForNode(graph: Graph, node: GraphNode): CsvDataset | undefined {
  const csv = node.metadata.csv !== undefined ? getCsvNode(node) : undefined;
  return csv ? graphDatasets(graph).find((dataset) => dataset.id === csv.datasetId) : undefined;
}
export function setAnalysisForDataset(
  graph: Graph,
  datasetId: string,
  analysis: CsvAnalysis,
): Graph {
  const source = graphDatasets(graph).find((dataset) => dataset.id === datasetId);
  requireValue(source, 'CSV source does not exist.');
  validateAnalysis(source!, analysis);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        ...(graph.dataset?.id === datasetId ? { csvAnalysis: analysis } : {}),
        csvSourceAnalyses: { ...graph.diagram.settings.csvSourceAnalyses, [datasetId]: analysis },
      },
    },
  };
}
export const setSourceAnalysis = setAnalysisForDataset;
export function removeDataModelSource(graph: Graph, datasetId: string): Graph {
  const sources = graphDatasets(graph).filter((source) => source.id !== datasetId);
  const analyses = Object.fromEntries(
    Object.entries(graph.diagram.settings.csvSourceAnalyses ?? {}).filter(
      ([id]) => id !== datasetId,
    ),
  );
  const nodes = graph.nodes
    .filter((node) => !(isGeneratedCsvNode(node) && getCsvNode(node)!.datasetId === datasetId))
    .map((node) => {
      const csv = node.metadata.csv !== undefined ? getCsvNode(node) : undefined;
      if (csv?.datasetId !== datasetId) return node;
      const { csv: _binding, ...metadata } = node.metadata;
      return {
        ...node,
        parentId: undefined,
        metadata: { ...metadata, csvSnapshot: { ...csv, visible: true } },
      };
    });
  const retained = new Set(nodes.map((node) => node.id));
  const named = graph.diagram.settings.namedAnalysisViews as
    | { version: 1; views: Record<string, unknown>[] }
    | undefined;
  return {
    ...graph,
    dataset: sources[0],
    datasets: sources.slice(1),
    nodes: nodes.map((node) =>
      node.parentId && !retained.has(node.parentId) ? { ...node, parentId: undefined } : node,
    ),
    edges: graph.edges.filter(
      (edge) => retained.has(edge.sourceNodeId) && retained.has(edge.targetNodeId),
    ),
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        csvAnalysis: sources[0] ? analysisForDataset(graph, sources[0].id) : undefined,
        csvSourceAnalyses: analyses,
        csvRelationships: graph.diagram.settings.csvRelationships?.filter(
          (r) => r.sourceDatasetId !== datasetId && r.targetDatasetId !== datasetId,
        ),
        csvEntityFocus:
          graph.diagram.settings.csvEntityFocus?.datasetId === datasetId
            ? undefined
            : graph.diagram.settings.csvEntityFocus,
        csvDatasetOrder: sources.map((source) => source.id),
        ...(named
          ? {
              namedAnalysisViews: {
                ...named,
                views: named.views.map((view) => ({
                  ...view,
                  ...(view.csvSourceAnalyses
                    ? {
                        csvSourceAnalyses: Object.fromEntries(
                          Object.entries(
                            view.csvSourceAnalyses as Record<string, CsvAnalysis>,
                          ).filter(([id]) => id !== datasetId),
                        ),
                      }
                    : {}),
                  ...(view.csvRelationships
                    ? {
                        csvRelationships: (view.csvRelationships as CsvSourceRelationship[]).filter(
                          (r) => r.sourceDatasetId !== datasetId && r.targetDatasetId !== datasetId,
                        ),
                      }
                    : {}),
                  ...(view.csvEntityFocus &&
                  (view.csvEntityFocus as CsvEntityFocus).datasetId === datasetId
                    ? { csvEntityFocus: undefined }
                    : {}),
                  ...(sources.length && graph.dataset?.id !== datasetId
                    ? {}
                    : { csvAnalysis: undefined }),
                })),
              },
            }
          : {}),
      },
    },
  };
}
export function clearDataModelFocus(graph: Graph): Graph {
  let next: Graph = {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, csvEntityFocus: undefined },
    },
  };
  for (const source of graphDatasets(graph)) {
    const analysis = analysisForDataset(graph, source.id)!;
    next = setAnalysisForDataset(next, source.id, { ...analysis, focusPath: [], offset: 0 });
  }
  return next;
}
/** Remap only recognized bindings; arbitrary metadata and detached snapshots stay intact. */
export function remapDataModelSources(graph: Graph, ids: Map<string, string>): Graph {
  const remap = (id: string) => ids.get(id) ?? id;
  const analyses = (values: Record<string, CsvAnalysis> | undefined) =>
    values
      ? Object.fromEntries(Object.entries(values).map(([id, value]) => [remap(id), value]))
      : undefined;
  const settings = graph.diagram.settings;
  const named = settings.namedAnalysisViews as
    | { version: 1; views: Record<string, unknown>[] }
    | undefined;
  return {
    ...graph,
    dataset: graph.dataset
      ? { ...graph.dataset, id: remap(graph.dataset.id), diagramId: graph.diagram.id }
      : undefined,
    datasets: graph.datasets?.map((source) => ({
      ...source,
      id: remap(source.id),
      diagramId: graph.diagram.id,
    })),
    diagram: {
      ...graph.diagram,
      settings: {
        ...settings,
        ...(settings.csvSourceAnalyses
          ? { csvSourceAnalyses: analyses(settings.csvSourceAnalyses) }
          : {}),
        ...(settings.csvRelationships
          ? {
              csvRelationships: settings.csvRelationships.map((r) => ({
                ...r,
                sourceDatasetId: remap(r.sourceDatasetId),
                targetDatasetId: remap(r.targetDatasetId),
              })),
            }
          : {}),
        ...(settings.csvDatasetOrder
          ? { csvDatasetOrder: settings.csvDatasetOrder.map(remap) }
          : {}),
        ...(settings.csvEntityFocus
          ? {
              csvEntityFocus: {
                ...settings.csvEntityFocus,
                datasetId: remap(settings.csvEntityFocus.datasetId),
              },
            }
          : {}),
        ...(named
          ? {
              namedAnalysisViews: {
                ...named,
                views: named.views.map((view) => ({
                  ...view,
                  ...(view.csvSourceAnalyses
                    ? {
                        csvSourceAnalyses: analyses(
                          view.csvSourceAnalyses as Record<string, CsvAnalysis>,
                        ),
                      }
                    : {}),
                  ...(view.csvEntityFocus
                    ? {
                        csvEntityFocus: {
                          ...(view.csvEntityFocus as CsvEntityFocus),
                          datasetId: remap((view.csvEntityFocus as CsvEntityFocus).datasetId),
                        },
                      }
                    : {}),
                  ...(view.csvRelationships
                    ? {
                        csvRelationships: (view.csvRelationships as CsvSourceRelationship[]).map(
                          (r) => ({
                            ...r,
                            sourceDatasetId: remap(r.sourceDatasetId),
                            targetDatasetId: remap(r.targetDatasetId),
                          }),
                        ),
                      }
                    : {}),
                })),
              },
            }
          : {}),
      },
    },
    nodes: graph.nodes.map((node) => {
      const csv = node.metadata.csv !== undefined ? getCsvNode(node) : undefined;
      if (!csv) return node;
      const datasetId = remap(csv.datasetId);
      return {
        ...node,
        ...(node.externalId === csvExternalId(csv.datasetId, csv.groupKey)
          ? { externalId: csvExternalId(datasetId, csv.groupKey) }
          : {}),
        metadata: { ...node.metadata, csv: { ...csv, datasetId } },
      };
    }),
    edges: graph.edges.map((edge) => {
      const relationship = edge.metadata.csvSourceRelationship as
        | { relationshipId: string; sourceDatasetId: string; targetDatasetId: string }
        | undefined;
      return relationship && edge.metadata.csvModelGenerated === true
        ? {
            ...edge,
            metadata: {
              ...edge.metadata,
              csvSourceRelationship: {
                ...relationship,
                sourceDatasetId: remap(relationship.sourceDatasetId),
                targetDatasetId: remap(relationship.targetDatasetId),
              },
            },
          }
        : edge;
    }),
  };
}
export function csvExternalId(datasetId: string, groupKey: string): string {
  return `csv:${datasetId}:${groupKey}`;
}
export function isGeneratedCsvNode(node: GraphNode): boolean {
  const csv = node.metadata.csv !== undefined ? getCsvNode(node) : undefined;
  return (
    !!csv &&
    (node.externalId === csv.groupKey ||
      node.externalId === csvExternalId(csv.datasetId, csv.groupKey))
  );
}
export function suppressDataModelEdge(graph: Graph, edge: GraphEdge): Graph {
  if (edge.metadata.csvModelGenerated !== true || !edge.externalId?.startsWith('csv-rel:'))
    return graph;
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        csvSuppressedRelationshipEdges: [
          ...new Set([
            ...(graph.diagram.settings.csvSuppressedRelationshipEdges ?? []),
            edge.externalId,
          ]),
        ],
      },
    },
  };
}
export function reconnectedDataModelEdge(previous: GraphEdge, next: GraphEdge): GraphEdge {
  return previous.metadata.csvModelGenerated === true &&
    (previous.sourceNodeId !== next.sourceNodeId || previous.targetNodeId !== next.targetNodeId)
    ? {
        ...next,
        externalId: undefined,
        edgeType: next.edgeType === 'data-relationship' ? 'relationship' : next.edgeType,
        metadata: {
          ...next.metadata,
          csvModelGenerated: false,
          csvModelVisible: undefined,
          csvSourceRelationship: undefined,
        },
      }
    : next;
}
export function validateDataModel(graph: Graph): void {
  requireValue(
    graph.datasets === undefined || Array.isArray(graph.datasets),
    'Invalid CSV sources.',
  );
  const sources = graphDatasets(graph);
  requireValue(
    sources.length <= dataModelLimits.sources,
    'A diagram supports up to 8 CSV sources.',
  );
  requireValue(!sources.length || graph.dataset, 'CSV sources require a primary dataset.');
  requireValue(
    new Set(sources.map((source) => source.id)).size === sources.length,
    'Duplicate CSV source id.',
  );
  requireValue(
    sources.reduce((total, source) => total + source.rows.length * source.columns.length, 0) <=
      dataModelLimits.cells,
    'The combined CSV sources exceed 20 million cells.',
  );
  const index = new Map(sources.map((source) => [source.id, source]));
  const analyses = graph.diagram.settings.csvSourceAnalyses;
  if (analyses !== undefined) {
    requireValue(
      analyses && typeof analyses === 'object' && !Array.isArray(analyses),
      'Invalid CSV source analyses.',
    );
    for (const [id, analysis] of Object.entries(analyses)) {
      requireValue(index.has(id), 'CSV analysis refers to a missing source.');
      validateAnalysis(index.get(id)!, analysis);
    }
  }
  const relationships = graph.diagram.settings.csvRelationships;
  if (relationships !== undefined) {
    requireValue(
      Array.isArray(relationships) && relationships.length <= dataModelLimits.relationships,
      'A diagram supports up to 32 source relationships.',
    );
    const ids = new Set<string>();
    for (const relationship of relationships) {
      requireValue(
        relationship && uuid.test(relationship.id) && !ids.has(relationship.id),
        'Invalid or duplicate CSV relationship id.',
      );
      ids.add(relationship.id);
      requireValue(
        relationship.sourceDatasetId !== relationship.targetDatasetId,
        'A relationship must connect two different CSV sources.',
      );
      requireValue(
        index
          .get(relationship.sourceDatasetId)
          ?.columns.some((c) => c.id === relationship.sourceColumnId) &&
          index
            .get(relationship.targetDatasetId)
            ?.columns.some((c) => c.id === relationship.targetColumnId),
        'CSV relationship refers to a missing source or column.',
      );
      requireValue(
        relationship.matchMode === undefined ||
          ['exact', 'trim', 'case-insensitive'].includes(relationship.matchMode),
        'Invalid CSV relationship matching mode.',
      );
    }
  }
  const focus = graph.diagram.settings.csvEntityFocus;
  if (focus !== undefined) {
    const source = index.get(focus?.datasetId);
    requireValue(
      source &&
        Array.isArray(focus.path) &&
        focus.path.length <= 8 &&
        new Set(focus.path.map((p) => p.columnId)).size === focus.path.length &&
        focus.path.every(
          (p) =>
            p &&
            typeof p.value === 'string' &&
            p.value.length <= 100000 &&
            source.columns.some((c) => c.id === p.columnId),
        ),
      'Invalid CSV entity focus.',
    );
  }
  const order = graph.diagram.settings.csvDatasetOrder;
  requireValue(
    order === undefined ||
      (Array.isArray(order) &&
        order.length === sources.length &&
        new Set(order).size === order.length &&
        order.every((id) => index.has(id))),
    'Invalid CSV source order.',
  );
  const suppressed = graph.diagram.settings.csvSuppressedRelationshipEdges;
  requireValue(
    suppressed === undefined ||
      (Array.isArray(suppressed) &&
        suppressed.length <= dataModelLimits.edges &&
        suppressed.every((id) => typeof id === 'string' && id.length <= 3000)),
    'Invalid suppressed CSV relationships.',
  );
}
function key(value: string, relationship: CsvSourceRelationship): string {
  const text = relationship.matchMode === 'exact' ? value : value.trim();
  return relationship.matchMode === 'case-insensitive' ? text.toLocaleLowerCase() : text;
}
interface SourceContext {
  dataset: CsvDataset;
  effective: CsvDataset;
  analysis: CsvAnalysis;
  eligible: number[];
}
function sourceContexts(graph: Graph): Map<string, SourceContext> {
  return new Map(
    graphDatasets(graph).map((dataset) => {
      const analysis = analysisForDataset(graph, dataset.id)!;
      validateAnalysis(dataset, analysis);
      const effective = effectiveDataset(dataset, analysis);
      const predicate = rowPredicate(effective, analysis.focusPath, analysis);
      const eligible: number[] = [];
      effective.rows.forEach((row, index) => {
        if (predicate(row)) eligible.push(index);
      });
      return [dataset.id, { dataset, effective, analysis, eligible }];
    }),
  );
}
function keyIndex(context: SourceContext, columnId: string, relationship: CsvSourceRelationship) {
  const column = context.dataset.columns.findIndex((c) => c.id === columnId);
  const values = new Map<string, number[]>();
  let missing = 0;
  for (const index of context.eligible) {
    const value = key(context.effective.rows[index][column], relationship);
    if (!value.trim()) {
      missing++;
      continue;
    }
    const rows = values.get(value);
    if (rows) rows.push(index);
    else values.set(value, [index]);
  }
  return { values, missing, column };
}
export function previewCsvRelationship(
  graph: Graph,
  relationship: CsvSourceRelationship,
): CsvRelationshipPreview {
  validateDataModel({
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, csvRelationships: [relationship] },
    },
  });
  const contexts = sourceContexts(graph);
  const source = contexts.get(relationship.sourceDatasetId)!;
  const target = contexts.get(relationship.targetDatasetId)!;
  const a = keyIndex(source, relationship.sourceColumnId, relationship);
  const b = keyIndex(target, relationship.targetColumnId, relationship);
  let matchedSourceRows = 0,
    matchedTargetRows = 0,
    matchedPairs = 0;
  for (const [value, rows] of a.values) {
    const matches = b.values.get(value);
    if (!matches) continue;
    matchedSourceRows += rows.length;
    matchedTargetRows += matches.length;
    matchedPairs += rows.length * matches.length;
  }
  const duplicateSourceKeys = [...a.values.values()].filter((rows) => rows.length > 1).length;
  const duplicateTargetKeys = [...b.values.values()].filter((rows) => rows.length > 1).length;
  return {
    sourceRows: source.eligible.length,
    targetRows: target.eligible.length,
    matchedSourceRows,
    matchedTargetRows,
    unmatchedSourceRows: source.eligible.length - matchedSourceRows - a.missing,
    unmatchedTargetRows: target.eligible.length - matchedTargetRows - b.missing,
    missingSourceRows: a.missing,
    missingTargetRows: b.missing,
    duplicateSourceKeys,
    duplicateTargetKeys,
    matchedPairs,
    cardinality: duplicateSourceKeys
      ? duplicateTargetKeys
        ? 'many-to-many'
        : 'many-to-one'
      : duplicateTargetKeys
        ? 'one-to-many'
        : 'one-to-one',
  };
}
/** Original-row indices, never joined copies. Each row enters the traversal once. */
export function modelRowScopes(graph: Graph): Map<string, number[]> {
  validateDataModel(graph);
  const contexts = sourceContexts(graph);
  const focus = graph.diagram.settings.csvEntityFocus;
  if (!focus) return new Map([...contexts].map(([id, context]) => [id, context.eligible]));
  const anchor = contexts.get(focus.datasetId)!;
  const predicate = rowPredicate(anchor.effective, focus.path, anchor.analysis);
  const selected = new Map<string, Set<number>>([
    [focus.datasetId, new Set(anchor.eligible.filter((i) => predicate(anchor.effective.rows[i])))],
  ]);
  const links = (graph.diagram.settings.csvRelationships ?? [])
    .map((relationship) => ({
      relationship,
      a: contexts.get(relationship.sourceDatasetId)!,
      b: contexts.get(relationship.targetDatasetId)!,
    }))
    .map((link) => ({
      ...link,
      ai: keyIndex(link.a, link.relationship.sourceColumnId, link.relationship),
      bi: keyIndex(link.b, link.relationship.targetColumnId, link.relationship),
      seenA: new Set<string>(),
      seenB: new Set<string>(),
    }));
  // Connected empty sources remain empty, rather than falling back to all rows.
  const connected = new Set([focus.datasetId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { relationship: r } of links)
      if (connected.has(r.sourceDatasetId) || connected.has(r.targetDatasetId))
        for (const id of [r.sourceDatasetId, r.targetDatasetId])
          if (!connected.has(id)) {
            connected.add(id);
            changed = true;
          }
  }
  connected.forEach((id) => {
    if (!selected.has(id)) selected.set(id, new Set());
  });
  const queue: { id: string; rows: number[] }[] = [
    { id: focus.datasetId, rows: [...selected.get(focus.datasetId)!] },
  ];
  for (let position = 0; position < queue.length; position++) {
    const pending = queue[position];
    for (const link of links) {
      const forward = link.relationship.sourceDatasetId === pending.id;
      if (!forward && link.relationship.targetDatasetId !== pending.id) continue;
      const destination = forward
        ? link.relationship.targetDatasetId
        : link.relationship.sourceDatasetId;
      if (destination === focus.datasetId) continue;
      const from = forward ? link.a : link.b,
        lookup = forward ? link.bi : link.ai,
        column = forward ? link.ai.column : link.bi.column,
        seen = forward ? link.seenA : link.seenB;
      const added: number[] = [];
      const rows = selected.get(destination)!;
      for (const index of pending.rows) {
        const value = key(from.effective.rows[index][column], link.relationship);
        if (!value.trim() || seen.has(value)) continue;
        seen.add(value);
        for (const match of lookup.values.get(value) ?? [])
          if (!rows.has(match)) {
            rows.add(match);
            added.push(match);
          }
      }
      if (added.length) queue.push({ id: destination, rows: added });
    }
  }
  return new Map(
    [...contexts].map(([id, context]) => [
      id,
      selected.has(id) ? [...selected.get(id)!].sort((a, b) => a - b) : context.eligible,
    ]),
  );
}
export function modelRowIndices(graph: Graph, datasetId: string): number[] {
  return modelRowScopes(graph).get(datasetId) ?? [];
}
export function modelDatasetForAnalysis(
  graph: Graph,
  datasetId: string,
  scopes?: Map<string, number[]>,
): CsvDataset {
  const dataset = graphDatasets(graph).find((source) => source.id === datasetId);
  requireValue(dataset, 'CSV source does not exist.');
  const indices = (scopes ?? modelRowScopes(graph)).get(datasetId) ?? [];
  return indices.length === dataset!.rows.length
    ? dataset!
    : { ...dataset!, rows: indices.map((i) => dataset!.rows[i]) };
}
/** Rebuild each source independently; relationship matching never multiplies aggregate rows. */
export function reanalyzeDataModel(graph: Graph): Graph {
  validateDataModel(graph);
  const sources = graphDatasets(graph);
  if (!sources.length) return graph;
  const scopes = modelRowScopes(graph);
  let nodes = graph.nodes,
    edges = graph.edges;
  for (const [sourcePosition, dataset] of sources.entries()) {
    const analysis = analysisForDataset(graph, dataset.id)!;
    const sourceNodes = nodes.filter(
      (node) => isGeneratedCsvNode(node) && getCsvNode(node)!.datasetId === dataset.id,
    );
    const nodeIds = new Set(sourceNodes.map((node) => node.id));
    const previous: Graph = {
      ...graph,
      nodes: sourceNodes.map((node) => ({ ...node, externalId: getCsvNode(node)!.groupKey })),
      edges: edges.filter(
        (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
      ),
      dataset,
      datasets: undefined,
    };
    const scoped = modelDatasetForAnalysis(graph, dataset.id, scopes)!;
    const generated = csvGraph(scoped, analysis, previous);
    const generatedIds = new Set(generated.nodes.map((node) => node.id));
    const hadSource = sourceNodes.length > 0;
    const updated = generated.nodes.map((node) =>
      isGeneratedCsvNode(node)
        ? {
            ...node,
            externalId: csvExternalId(dataset.id, getCsvNode(node)!.groupKey),
            ...(!hadSource ? { x: node.x + sourcePosition * 1600 } : {}),
          }
        : node,
    );
    nodes = [...nodes.filter((node) => !nodeIds.has(node.id)), ...updated];
    edges = [
      ...edges.filter(
        (edge) => !(nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)),
      ),
      ...generated.edges,
    ].filter(
      (edge) =>
        !(
          (nodeIds.has(edge.sourceNodeId) && !generatedIds.has(edge.sourceNodeId)) ||
          (nodeIds.has(edge.targetNodeId) && !generatedIds.has(edge.targetNodeId))
        ),
    );
    requireValue(
      nodes.length <= dataModelLimits.nodes,
      'The data model exceeds 12,000 retained objects. Remove unused groups or use fewer sources.',
    );
  }
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  edges = edges.filter(
    (edge) => nodeIndex.has(edge.sourceNodeId) && nodeIndex.has(edge.targetNodeId),
  );
  const oldGenerated = new Map(
    edges
      .filter((edge) => edge.metadata.csvModelGenerated === true)
      .map((edge) => [edge.externalId, edge]),
  );
  const suppressed = new Set(graph.diagram.settings.csvSuppressedRelationshipEdges ?? []);
  const active = new Set<string>();
  const contexts = sourceContexts(graph);
  for (const relationship of graph.diagram.settings.csvRelationships ?? []) {
    const groupKeys = (datasetId: string, columnId: string) => {
      const context = contexts.get(datasetId)!;
      const visible = nodes.filter(
        (node) =>
          isGeneratedCsvNode(node) &&
          getCsvNode(node)!.datasetId === datasetId &&
          getCsvNode(node)!.visible !== false,
      );
      const groups = new Map(visible.map((node) => [getCsvNode(node)!.groupKey, node.id]));
      const indices = new Map(context.dataset.columns.map((column, index) => [column.id, index]));
      const column = indices.get(columnId)!;
      const result = new Map<string, Set<string>>();
      for (const index of scopes.get(datasetId) ?? []) {
        const row = context.effective.rows[index];
        const value = key(row[column], relationship);
        if (!value.trim()) continue;
        let nodeId: string | undefined;
        for (
          let depth = context.analysis.levels.length;
          depth >= context.analysis.focusPath.length;
          depth--
        ) {
          const path = context.analysis.levels
            .slice(0, depth)
            .map((id) => ({ columnId: id, value: row[indices.get(id)!].trim() }));
          nodeId = groups.get(JSON.stringify(path));
          if (nodeId) break;
        }
        if (!nodeId) continue;
        const values = result.get(value) ?? new Set<string>();
        values.add(nodeId);
        result.set(value, values);
      }
      return result;
    };
    const a = groupKeys(relationship.sourceDatasetId, relationship.sourceColumnId),
      b = groupKeys(relationship.targetDatasetId, relationship.targetColumnId);
    for (const [value, left] of a)
      for (const source of left)
        for (const target of b.get(value) ?? []) {
          const externalId = `csv-rel:${relationship.id}:${source}:${target}`;
          if (active.has(externalId) || suppressed.has(externalId)) continue;
          requireValue(
            active.size < dataModelLimits.edges,
            'Matching creates more than 10,000 visible relationships. Narrow the source grouping or filters.',
          );
          active.add(externalId);
          if (oldGenerated.has(externalId)) continue;
          const sourceColumn = contexts
            .get(relationship.sourceDatasetId)!
            .dataset.columns.find((c) => c.id === relationship.sourceColumnId)!;
          const targetColumn = contexts
            .get(relationship.targetDatasetId)!
            .dataset.columns.find((c) => c.id === relationship.targetColumnId)!;
          edges.push(
            newEdge(graph.diagram.id, source, target, {
              externalId,
              label: `${sourceColumn.label} → ${targetColumn.label}`,
              edgeType: 'data-relationship',
              direction: 'forward',
              metadata: {
                csvModelGenerated: true,
                csvSourceRelationship: {
                  relationshipId: relationship.id,
                  sourceDatasetId: relationship.sourceDatasetId,
                  targetDatasetId: relationship.targetDatasetId,
                },
              },
            }),
          );
        }
  }
  const relationshipIds = new Set(
    (graph.diagram.settings.csvRelationships ?? []).map((relationship) => relationship.id),
  );
  edges = edges
    .filter(
      (edge) =>
        edge.metadata.csvModelGenerated !== true ||
        (relationshipIds.has(
          (edge.metadata.csvSourceRelationship as { relationshipId: string })?.relationshipId,
        ) &&
          !suppressed.has(edge.externalId!)),
    )
    .map((edge) =>
      edge.metadata.csvModelGenerated === true
        ? { ...edge, metadata: { ...edge.metadata, csvModelVisible: active.has(edge.externalId!) } }
        : edge,
    );
  requireValue(
    edges.filter((edge) => edge.metadata.csvModelGenerated === true).length <=
      dataModelLimits.edges,
    'The model retains more than 10,000 source relationships. Remove unused relationships or narrow grouping before applying.',
  );
  return {
    ...graph,
    nodes,
    edges,
    dataset: graph.dataset,
    datasets: graph.datasets,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, csvDatasetOrder: sources.map((source) => source.id) },
    },
  };
}
