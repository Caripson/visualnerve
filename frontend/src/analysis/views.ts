import type { Filters, Graph } from '../model/types';
import type { CsvAnalysis } from '../data/types';
import {
  getExploration,
  getNamedAnalysisViews,
  analysisLimits,
  type NamedAnalysisView,
} from './types';

const copy = <T>(value: T): T => structuredClone(value);
function copyAnalysis(analysis: CsvAnalysis): CsvAnalysis {
  return {
    version: 1,
    levels: [...analysis.levels],
    metrics: analysis.metrics.map(({ id, operation, columnId }) => ({
      id,
      operation,
      ...(columnId !== undefined ? { columnId } : {}),
    })),
    decimalSeparator: analysis.decimalSeparator,
    displayColumns: [...analysis.displayColumns],
    filters: analysis.filters.map(({ id, columnId, operation, value, caseSensitive }) => ({
      id,
      columnId,
      operation,
      value,
      ...(caseSensitive !== undefined ? { caseSensitive } : {}),
    })),
    focusPath: analysis.focusPath.map(({ columnId, value }) => ({ columnId, value })),
    limit: analysis.limit,
    offset: analysis.offset,
    sortBy: analysis.sortBy,
    sortDirection: analysis.sortDirection,
    columnRules: analysis.columnRules.map(
      ({ columnId, trim, pattern, replacement, flags, numberFormat }) => ({
        columnId,
        ...(trim !== undefined ? { trim } : {}),
        ...(pattern !== undefined ? { pattern } : {}),
        ...(replacement !== undefined ? { replacement } : {}),
        ...(flags !== undefined ? { flags } : {}),
        ...(numberFormat !== undefined ? { numberFormat } : {}),
      }),
    ),
  };
}
export function captureAnalysisView(
  graph: Graph,
  filters: Filters,
  name: string,
  id: string = crypto.randomUUID(),
): NamedAnalysisView {
  const settings = graph.diagram.settings;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100)
    throw new Error('Give the view a name of 1–100 characters.');
  if (graph.nodes.length > analysisLimits.layoutNodes)
    throw new Error('This diagram has too many objects to save its layout.');
  return {
    id,
    name: trimmed,
    filters: { ...filters },
    ...(settings.csvAnalysis ? { csvAnalysis: copyAnalysis(settings.csvAnalysis) } : {}),
    ...(settings.csvSourceAnalyses
      ? {
          csvSourceAnalyses: Object.fromEntries(
            Object.entries(settings.csvSourceAnalyses).map(([id, analysis]) => [
              id,
              copyAnalysis(analysis),
            ]),
          ),
        }
      : {}),
    ...(settings.csvRelationships
      ? {
          csvRelationships: settings.csvRelationships.map(
            ({
              id,
              sourceDatasetId,
              sourceColumnId,
              targetDatasetId,
              targetColumnId,
              matchMode,
            }) => ({
              id,
              sourceDatasetId,
              sourceColumnId,
              targetDatasetId,
              targetColumnId,
              ...(matchMode !== undefined ? { matchMode } : {}),
            }),
          ),
        }
      : {}),
    ...(settings.csvEntityFocus
      ? {
          csvEntityFocus: {
            datasetId: settings.csvEntityFocus.datasetId,
            path: settings.csvEntityFocus.path.map(({ columnId, value }) => ({ columnId, value })),
          },
        }
      : {}),
    layout: graph.nodes.map(({ id, x, y, width, height, collapsed }) => ({
      id,
      x,
      y,
      width,
      height,
      collapsed,
    })),
    ...(settings.viewport ? { viewport: { ...settings.viewport } } : {}),
    ...(getExploration(graph) ? { exploration: copy(getExploration(graph)!) } : {}),
  };
}
export function saveAnalysisView(
  graph: Graph,
  filters: Filters,
  name: string,
  replaceId?: string,
): Graph {
  const previous = getNamedAnalysisViews(graph);
  if (!replaceId && previous.views.length >= analysisLimits.views)
    throw new Error('Save at most 20 analysis views. Delete a view before adding another.');
  const view = captureAnalysisView(graph, filters, name, replaceId);
  const views = replaceId
    ? previous.views.map((item) => (item.id === replaceId ? view : item))
    : [...previous.views, view];
  if (replaceId && !previous.views.some((item) => item.id === replaceId))
    throw new Error('This saved view no longer exists.');
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, namedAnalysisViews: { version: 1, views } },
    },
  };
}
export function deleteAnalysisView(graph: Graph, id: string): Graph {
  const previous = getNamedAnalysisViews(graph);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        namedAnalysisViews: { version: 1, views: previous.views.filter((view) => view.id !== id) },
      },
    },
  };
}
/** Only view-owned fields are restored; shared annotations, links, sources and ink remain current. */
export function applyViewConfiguration(graph: Graph, view: NamedAnalysisView): Graph {
  const layout = new Map(view.layout.map((item) => [item.id, item]));
  const sourceAnalyses = {
    ...graph.diagram.settings.csvSourceAnalyses,
    ...copy(view.csvSourceAnalyses),
    ...(graph.dataset && view.csvAnalysis
      ? { [graph.dataset.id]: copy(view.csvSourceAnalyses?.[graph.dataset.id] ?? view.csvAnalysis) }
      : {}),
  };
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const saved = layout.get(node.id);
      return saved
        ? {
            ...node,
            x: saved.x,
            y: saved.y,
            width: saved.width,
            height: saved.height,
            collapsed: saved.collapsed,
          }
        : node;
    }),
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        analysisFilters: { ...view.filters },
        csvAnalysis: copy(
          graph.dataset
            ? (view.csvSourceAnalyses?.[graph.dataset.id] ?? view.csvAnalysis)
            : undefined,
        ),
        csvSourceAnalyses: Object.keys(sourceAnalyses).length ? sourceAnalyses : undefined,
        csvRelationships: copy(view.csvRelationships),
        csvEntityFocus: copy(view.csvEntityFocus),
        relationshipExploration: copy(view.exploration),
        ...(view.viewport ? { viewport: { ...view.viewport } } : {}),
      },
    },
  };
}
/** Importers remap only known references; no shared source rows or arbitrary metadata are copied. */
export function remapAnalysisReferences(graph: Graph, nodeIds: Map<string, string>): Graph {
  const remap = (id: string) => nodeIds.get(id) ?? id;
  const exploration = (value: NamedAnalysisView['exploration']) =>
    value
      ? {
          ...value,
          startId: remap(value.startId),
          ...(value.targetId ? { targetId: remap(value.targetId) } : {}),
        }
      : undefined;
  const saved = getNamedAnalysisViews(graph);
  const current = getExploration(graph);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        ...(current ? { relationshipExploration: exploration(current) } : {}),
        ...(graph.diagram.settings.namedAnalysisViews !== undefined
          ? {
              namedAnalysisViews: {
                ...saved,
                views: saved.views.map((view) => ({
                  ...view,
                  layout: view.layout.map((item) => ({ ...item, id: remap(item.id) })),
                  ...(view.exploration ? { exploration: exploration(view.exploration) } : {}),
                })),
              },
            }
          : {}),
      },
    },
  };
}
