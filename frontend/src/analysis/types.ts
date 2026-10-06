import type { CsvAnalysis } from '../data/types';
import type { Filters, Graph } from '../model/types';
import { validateAnalysis } from '../data/csv';

export interface RelationshipExploration {
  version: 1;
  mode: 'neighbors' | 'path';
  startId: string;
  targetId?: string;
  direction: 'all' | 'incoming' | 'outgoing';
  steps: 1 | 2;
  directed: boolean;
  includeHidden: boolean;
}
export interface ExplorationResult {
  nodeIds: string[];
  edgeIds: string[];
  totalNodes: number;
  truncated: boolean;
  found: boolean;
  outsideViewIds: string[];
  outsideViewEdgeIds: string[];
}
export interface AnalysisLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
}
export interface NamedAnalysisView {
  id: string;
  name: string;
  filters: Filters;
  csvAnalysis?: CsvAnalysis;
  csvSourceAnalyses?: Record<string, CsvAnalysis>;
  csvRelationships?: import('../data/model').CsvSourceRelationship[];
  csvEntityFocus?: { datasetId: string; path: import('../data/types').CsvPathEntry[] };
  layout: AnalysisLayout[];
  viewport?: { x: number; y: number; zoom: number };
  exploration?: RelationshipExploration;
}
export interface NamedAnalysisViews {
  version: 1;
  views: NamedAnalysisView[];
}
export const analysisLimits = { views: 20, layoutNodes: 12_000, visibleNodes: 500 };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const text = (value: unknown, max = 200) => typeof value === 'string' && value.length <= max;
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
export function validateSavedCsvAnalysis(graph: Graph, datasetId: string, analysis: CsvAnalysis) {
  const source = [graph.dataset, ...(graph.datasets ?? [])].find(
    (dataset) => dataset?.id === datasetId,
  );
  check(source, 'Saved analysis refers to a missing shared source.');
  validateAnalysis(source!, analysis);
  check(
    exactKeys(analysis, [
      'version',
      'levels',
      'metrics',
      'decimalSeparator',
      'displayColumns',
      'filters',
      'focusPath',
      'limit',
      'offset',
      'sortBy',
      'sortDirection',
      'columnRules',
    ]) &&
      analysis.metrics.every((metric) => exactKeys(metric, ['id', 'operation', 'columnId'])) &&
      analysis.filters.every((filter) =>
        exactKeys(filter, ['id', 'columnId', 'operation', 'value', 'caseSensitive']),
      ) &&
      analysis.focusPath.every((entry) => exactKeys(entry, ['columnId', 'value'])) &&
      analysis.columnRules.every((rule) =>
        exactKeys(rule, ['columnId', 'trim', 'pattern', 'replacement', 'flags', 'numberFormat']),
      ),
    'Saved analyses contain unsupported data.',
  );
}
export function validateExploration(value: unknown): asserts value is RelationshipExploration {
  check(object(value), 'Invalid relationship exploration.');
  const config = value as RelationshipExploration;
  check(
    config.version === 1 &&
      ['neighbors', 'path'].includes(config.mode) &&
      text(config.startId) &&
      !!config.startId &&
      (config.targetId === undefined || text(config.targetId)) &&
      ['all', 'incoming', 'outgoing'].includes(config.direction) &&
      [1, 2].includes(config.steps) &&
      typeof config.directed === 'boolean' &&
      typeof config.includeHidden === 'boolean' &&
      exactKeys(config, [
        'version',
        'mode',
        'startId',
        'targetId',
        'direction',
        'steps',
        'directed',
        'includeHidden',
      ]),
    'Invalid relationship exploration options.',
  );
  check(config.mode !== 'path' || !!config.targetId, 'Choose a path destination.');
}
export function getExploration(graph: Graph): RelationshipExploration | undefined {
  const value = graph.diagram.settings.relationshipExploration;
  if (value === undefined) return undefined;
  try {
    validateExploration(value);
    return value;
  } catch {
    return undefined;
  }
}
export function validateFilters(value: unknown): asserts value is Filters {
  check(
    object(value) &&
      ['owner', 'status', 'kind', 'tag', 'from', 'to'].every((key) => text(value[key], 1000)) &&
      ['dim', 'hide'].includes(value.mode as string) &&
      exactKeys(value, ['owner', 'status', 'kind', 'tag', 'from', 'to', 'mode']),
    'Invalid analysis view filters.',
  );
}
export function validateNamedAnalysisViews(
  graph: Graph,
  value: unknown,
  validateSources?: (graph: Graph) => void,
): asserts value is NamedAnalysisViews {
  check(object(value), 'Invalid saved analysis views.');
  const collection = value as NamedAnalysisViews;
  check(
    collection.version === 1 &&
      Array.isArray(collection.views) &&
      collection.views.length <= analysisLimits.views &&
      exactKeys(collection, ['version', 'views']),
    'Invalid saved analysis views or too many views (maximum 20).',
  );
  const ids = new Set<string>();
  for (const view of collection.views) {
    check(
      object(view) &&
        text(view.id) &&
        !!view.id &&
        !ids.has(view.id) &&
        text(view.name, 100) &&
        !!view.name.trim(),
      'Saved analysis views need unique IDs and names.',
    );
    ids.add(view.id);
    check(
      exactKeys(view, [
        'id',
        'name',
        'filters',
        'csvAnalysis',
        'csvSourceAnalyses',
        'csvRelationships',
        'csvEntityFocus',
        'layout',
        'viewport',
        'exploration',
      ]),
      'Saved views contain unsupported data.',
    );
    validateFilters(view.filters);
    check(
      Array.isArray(view.layout) && view.layout.length <= analysisLimits.layoutNodes,
      'Saved view has too many layout positions.',
    );
    const nodes = new Set<string>();
    for (const item of view.layout) {
      check(
        object(item) &&
          text(item.id) &&
          !nodes.has(item.id) &&
          ['x', 'y', 'width', 'height'].every(
            (key) =>
              Number.isFinite(item[key as keyof AnalysisLayout]) &&
              Math.abs(item[key as keyof AnalysisLayout] as number) <= 1e8,
          ) &&
          item.width > 0 &&
          item.height > 0 &&
          typeof item.collapsed === 'boolean' &&
          exactKeys(item, ['id', 'x', 'y', 'width', 'height', 'collapsed']),
        'Invalid saved view node layout.',
      );
      nodes.add(item.id);
    }
    if (view.viewport !== undefined)
      check(
        object(view.viewport) &&
          Number.isFinite(view.viewport.x) &&
          Number.isFinite(view.viewport.y) &&
          Number.isFinite(view.viewport.zoom) &&
          view.viewport.zoom > 0 &&
          view.viewport.zoom <= 10 &&
          exactKeys(view.viewport, ['x', 'y', 'zoom']),
        'Invalid saved view viewport.',
      );
    if (view.exploration !== undefined) validateExploration(view.exploration);
    if (view.csvAnalysis !== undefined) {
      check(graph.dataset, 'Saved CSV analysis requires its shared source.');
      validateSavedCsvAnalysis(graph, graph.dataset!.id, view.csvAnalysis);
    }
    if (view.csvSourceAnalyses !== undefined) {
      check(object(view.csvSourceAnalyses), 'Invalid saved source analyses.');
      check(Object.keys(view.csvSourceAnalyses).length <= 8, 'Too many saved source analyses.');
      for (const [id, analysis] of Object.entries(view.csvSourceAnalyses)) {
        validateSavedCsvAnalysis(graph, id, analysis);
      }
    }
    if (view.csvRelationships !== undefined)
      check(
        Array.isArray(view.csvRelationships) &&
          view.csvRelationships.length <= 32 &&
          view.csvRelationships.every(
            (relationship) =>
              object(relationship) &&
              exactKeys(relationship, [
                'id',
                'sourceDatasetId',
                'sourceColumnId',
                'targetDatasetId',
                'targetColumnId',
                'matchMode',
              ]),
          ),
        'Saved source relationships contain unsupported data.',
      );
    if (view.csvEntityFocus !== undefined)
      check(
        object(view.csvEntityFocus) &&
          exactKeys(view.csvEntityFocus, ['datasetId', 'path']) &&
          text(view.csvEntityFocus.datasetId) &&
          Array.isArray(view.csvEntityFocus.path) &&
          view.csvEntityFocus.path.every(
            (entry) =>
              object(entry) &&
              exactKeys(entry, ['columnId', 'value']) &&
              text(entry.columnId) &&
              text(entry.value, 100000),
          ),
        'Invalid saved source focus.',
      );
    if (validateSources)
      validateSources({
        ...graph,
        diagram: {
          ...graph.diagram,
          settings: {
            ...graph.diagram.settings,
            csvAnalysis: view.csvAnalysis,
            csvSourceAnalyses: view.csvSourceAnalyses,
            csvRelationships: view.csvRelationships,
            csvEntityFocus: view.csvEntityFocus,
          },
        },
      });
  }
}
export function getNamedAnalysisViews(graph: Graph): NamedAnalysisViews {
  const value = graph.diagram.settings.namedAnalysisViews;
  if (value === undefined) return { version: 1, views: [] };
  if (object(value)) {
    const cached = viewCache.get(value);
    if (cached && cached.dataset === graph.dataset && cached.datasets === graph.datasets)
      return cached.result;
  }
  let result: NamedAnalysisViews;
  try {
    validateNamedAnalysisViews(graph, value);
    result = value;
  } catch {
    result = { version: 1, views: [] };
  }
  if (object(value))
    viewCache.set(value, { dataset: graph.dataset, datasets: graph.datasets, result });
  return result;
}
const viewCache = new WeakMap<
  object,
  { dataset: Graph['dataset']; datasets: Graph['datasets']; result: NamedAnalysisViews }
>();
