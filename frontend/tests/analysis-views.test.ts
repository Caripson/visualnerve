import { beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, emptyFilters, newEdge, newNode } from '../src/model/types';
import { applyViewConfiguration, captureAnalysisView } from '../src/analysis/views';
import { getNamedAnalysisViews, validateNamedAnalysisViews } from '../src/analysis/types';
import type { ExplorationResult } from '../src/analysis/types';
import { useEditor } from '../src/state/editor';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { reanalyzeDataModel, setAnalysisForDataset } from '../src/data/model';
import { reanalyzeDataModelAsync } from '../src/data/modelClient';
vi.mock('../src/storage/workspace', () => ({
  workspace: { settled: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/data/modelClient', async (original) => {
  const actual = await original<typeof import('../src/data/modelClient')>();
  return { ...actual, reanalyzeDataModelAsync: vi.fn(actual.reanalyzeDataModelAsync) };
});
beforeEach(() => useEditor.getState().setGraph(null));
it('keeps an existing projection when repeating identical exploration or loading an already-current named view', async () => {
  const graph = blankGraph('No-op exploration');
  graph.nodes = [newNode(graph.diagram.id)];
  useEditor.getState().setGraph(graph);
  const config = {
    version: 1 as const,
    mode: 'neighbors' as const,
    startId: graph.nodes[0].id,
    direction: 'all' as const,
    steps: 1 as const,
    directed: true,
    includeHidden: false,
  };
  useEditor.getState().explore(config);
  const result: ExplorationResult = {
    nodeIds: [graph.nodes[0].id],
    edgeIds: [],
    totalNodes: 1,
    truncated: false,
    found: true,
    outsideViewIds: [],
    outsideViewEdgeIds: [],
  };
  useEditor.setState({ explorationResult: result });
  const before = useEditor.getState().graph;
  const historyLength = useEditor.getState().history.length;
  useEditor.getState().explore({ ...config });
  expect(useEditor.getState().graph).toBe(before);
  expect(useEditor.getState().explorationResult).toBe(result);
  expect(useEditor.getState().history).toHaveLength(historyLength);
  useEditor.getState().saveView('Current exploration');
  const id = getNamedAnalysisViews(useEditor.getState().graph!).views[0].id;
  await useEditor.getState().loadView(id);
  useEditor.setState({ explorationResult: result });
  const loaded = useEditor.getState().graph;
  const loadedHistory = useEditor.getState().history.length;
  await useEditor.getState().loadView(id);
  expect(useEditor.getState().graph).toBe(loaded);
  expect(useEditor.getState().explorationResult).toBe(result);
  expect(useEditor.getState().history).toHaveLength(loadedHistory);
});
it('captures configuration without copying source rows, annotations, drawing or manual connections', () => {
  const source = parseCsv('Region,Name\nNorth,PRIVATE-SOURCE', 'data.csv');
  const graph = csvGraph(source, defaultAnalysis(source));
  graph.nodes[0].notes = 'LATEST-NOTE';
  graph.nodes[0].status = 'done';
  graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [] };
  graph.diagram.settings.viewport = { x: 15, y: -20, zoom: 0.7 };
  const snapshot = captureAnalysisView(graph, { ...emptyFilters, status: 'done' }, 'North');
  const encoded = JSON.stringify(snapshot);
  expect(encoded).not.toContain('PRIVATE-SOURCE');
  expect(encoded).not.toContain('LATEST-NOTE');
  expect(snapshot).not.toHaveProperty('edges');
  expect(snapshot).not.toHaveProperty('drawing');
  expect(snapshot).not.toHaveProperty('dataset');
  const manual = newNode(graph.diagram.id, { title: 'Later annotation' });
  const edge = newEdge(graph.diagram.id, graph.nodes[0].id, manual.id, {
    label: 'Keep latest link',
  });
  const latest = {
    ...graph,
    nodes: [
      ...graph.nodes.map((node) => ({
        ...node,
        x: 999,
        notes: 'Edited after saving',
        status: 'blocked',
      })),
      manual,
    ],
    edges: [...graph.edges, edge],
  };
  const restored = applyViewConfiguration(latest, snapshot);
  expect(restored.dataset).toBe(source);
  expect(restored.edges).toBe(latest.edges);
  expect(restored.diagram.settings.drawing).toBe(graph.diagram.settings.drawing);
  expect(restored.nodes[0]).toMatchObject({
    x: snapshot.layout[0].x,
    notes: 'Edited after saving',
    status: 'blocked',
  });
  expect(restored.nodes.at(-1)).toBe(manual);
});
it('saves, renames, loads and deletes views with undoable filter/layout changes while preserving latest user content', async () => {
  const graph = blankGraph('Shared diagram');
  graph.nodes = [newNode(graph.diagram.id, { x: 20, collapsed: true })];
  useEditor.getState().setGraph(graph);
  useEditor.setState({ filters: { ...emptyFilters, status: 'done' } });
  useEditor.getState().saveView('Overview');
  const id = getNamedAnalysisViews(useEditor.getState().graph!).views[0].id;
  useEditor
    .getState()
    .updateNode(graph.nodes[0].id, { x: 400, notes: 'New note', status: 'done', collapsed: false });
  useEditor.setState({ filters: { ...emptyFilters, status: 'blocked' } });
  await useEditor.getState().loadView(id);
  expect(useEditor.getState().filters.status).toBe('done');
  expect(useEditor.getState().graph!.nodes[0]).toMatchObject({
    x: 20,
    collapsed: true,
    notes: 'New note',
    status: 'done',
  });
  useEditor.getState().undo();
  expect(useEditor.getState().filters.status).toBe('blocked');
  expect(useEditor.getState().graph!.nodes[0].x).toBe(400);
  useEditor.getState().redo();
  expect(useEditor.getState().filters.status).toBe('done');
  useEditor.getState().saveView('Renamed', id);
  expect(getNamedAnalysisViews(useEditor.getState().graph!).views[0].name).toBe('Renamed');
  useEditor.getState().deleteView(id);
  expect(getNamedAnalysisViews(useEditor.getState().graph!).views).toEqual([]);
  useEditor.getState().undo();
  expect(getNamedAnalysisViews(useEditor.getState().graph!).views[0].name).toBe('Renamed');
});
it('rejects raw data and malformed layouts in saved views and safely ignores obsolete node positions', () => {
  const graph = blankGraph('Safe');
  graph.nodes = [newNode(graph.diagram.id)];
  const view = captureAnalysisView(graph, emptyFilters, 'Safe');
  expect(() =>
    validateNamedAnalysisViews(graph, { version: 1, views: [{ ...view, rows: [['secret']] }] }),
  ).toThrow(/unsupported data/);
  expect(() =>
    validateNamedAnalysisViews(graph, {
      version: 1,
      views: [{ ...view, layout: [{ ...view.layout[0], x: Infinity }] }],
    }),
  ).toThrow(/layout/);
  expect(applyViewConfiguration({ ...graph, nodes: [] }, view).nodes).toEqual([]);
  graph.diagram.settings.namedAnalysisViews = { version: 900, views: null };
  expect(getNamedAnalysisViews(graph).views).toEqual([]);
});
it('restores multiple source analyses and semijoin focus without duplicating rows or losing manual annotations and links', async () => {
  const first = parseCsv('Region,Amount\nNorth,12\nSouth,34', 'regions.csv');
  let graph = csvGraph(first, defaultAnalysis(first));
  const second = parseCsv('Region,Contact\nNorth,Anna\nSouth,Bob', 'contacts.csv');
  second.diagramId = graph.diagram.id;
  const extras = [second];
  graph.datasets = extras;
  graph = setAnalysisForDataset(graph, first.id, defaultAnalysis(first));
  graph = setAnalysisForDataset(graph, second.id, defaultAnalysis(second));
  graph.diagram.settings.csvRelationships = [
    {
      id: crypto.randomUUID(),
      sourceDatasetId: first.id,
      sourceColumnId: first.columns[0].id,
      targetDatasetId: second.id,
      targetColumnId: second.columns[0].id,
    },
  ];
  graph = reanalyzeDataModel(graph);
  const manual = newNode(graph.diagram.id, {
    title: 'Current note',
    notes: 'Do not restore old notes',
    status: 'done',
  });
  const manualEdge = newEdge(graph.diagram.id, graph.nodes[0].id, manual.id, {
    label: 'Manual annotation',
  });
  graph.nodes.push(manual);
  graph.edges.push(manualEdge);
  useEditor.getState().setGraph(graph);
  useEditor.getState().saveView('All regions');
  const id = getNamedAnalysisViews(useEditor.getState().graph!).views[0].id;
  useEditor.getState().command('Focus North', (current) => ({
    ...setAnalysisForDataset(current, first.id, {
      ...defaultAnalysis(first),
      filters: [
        {
          id: crypto.randomUUID(),
          columnId: first.columns[0].id,
          operation: 'equals',
          value: 'North',
        },
      ],
    }),
    diagram: {
      ...current.diagram,
      settings: {
        ...current.diagram.settings,
        csvEntityFocus: {
          datasetId: first.id,
          path: [{ columnId: first.columns[0].id, value: 'North' }],
        },
      },
    },
  }));
  await useEditor.getState().loadView(id);
  const loaded = useEditor.getState().graph!;
  expect(loaded.dataset).toBe(first);
  expect(loaded.datasets).toBe(extras);
  expect(loaded.diagram.settings.csvEntityFocus).toBeUndefined();
  expect(loaded.diagram.settings.csvSourceAnalyses?.[first.id].filters).toEqual([]);
  expect(loaded.diagram.settings.csvRelationships).toEqual(graph.diagram.settings.csvRelationships);
  expect(loaded.nodes.find((node) => node.id === manual.id)).toMatchObject({
    notes: manual.notes,
    status: 'done',
  });
  expect(loaded.edges.find((edge) => edge.id === manualEdge.id)).toEqual(manualEdge);
  expect(JSON.stringify(loaded.diagram.settings.namedAnalysisViews)).not.toContain('Anna');
});
it('rejects a stale asynchronous view load instead of overwriting changes made during the worker operation', async () => {
  const dataset = parseCsv('Region\nNorth', 'data.csv');
  const graph = csvGraph(dataset, defaultAnalysis(dataset));
  useEditor.getState().setGraph(graph);
  useEditor.getState().saveView('Initial');
  const id = getNamedAnalysisViews(useEditor.getState().graph!).views[0].id;
  let resolve!: (value: typeof graph) => void;
  vi.mocked(reanalyzeDataModelAsync).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const loading = useEditor.getState().loadView(id);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  useEditor.getState().updateNode(graph.nodes[0].id, { notes: 'Edited while worker runs' });
  resolve(graph);
  await expect(loading).rejects.toThrow(/diagram changed/);
  expect(useEditor.getState().graph!.nodes[0].notes).toBe('Edited while worker runs');
  expect(useEditor.getState().history.at(-1)?.label).toBe('Edit node');
});
