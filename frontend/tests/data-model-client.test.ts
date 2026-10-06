import { afterEach, expect, it, vi } from 'vitest';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { graphDatasets } from '../src/data/model';
import type { DataModelWorkerRequest } from '../src/data/modelClient';
class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: DataModelWorkerRequest[] = [];
  onmessage?: (event: { data: { id: number; result: unknown } }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = (message: DataModelWorkerRequest) => {
    this.messages.push(message);
    if (!FakeWorker.blocked)
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: message.graph } }));
  };
  static blocked = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.blocked = false;
  vi.resetModules();
});
it('caches immutable sources, resends changed raw sources despite unchanged versions, and restores raw identity after worker results', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
  const { reanalyzeDataModelAsync } = await import('../src/data/modelClient');
  const a = parseCsv('Id,Amount\nA,1\n', 'a.csv'),
    b = parseCsv('Id,Amount\nA,2\n', 'b.csv');
  b.diagramId = a.diagramId;
  const graph = { ...csvGraph(a, defaultAnalysis(a)), datasets: [b] };
  const first = await reanalyzeDataModelAsync(graph);
  expect(first.dataset).toBe(a);
  expect(first.datasets![0]).toBe(b);
  expect(FakeWorker.instances[0].messages[0].graph.dataset).toBeUndefined();
  expect(FakeWorker.instances[0].messages[0].graph.datasets).toBeUndefined();
  await reanalyzeDataModelAsync(graph);
  expect(
    FakeWorker.instances[0].messages[1].sources.every((source) => source.dataset === undefined),
  ).toBe(true);
  const changed = { ...graph, datasets: [{ ...b, rows: [['A', '9']] }] };
  await reanalyzeDataModelAsync(changed);
  expect(FakeWorker.instances[0].messages[2].sources[0].dataset).toBeUndefined();
  expect(FakeWorker.instances[0].messages[2].sources[1].dataset).toBe(changed.datasets[0]);
  await reanalyzeDataModelAsync(graph);
  expect(FakeWorker.instances[0].messages[3].sources[1].dataset).toBe(b);
  expect(graphDatasets(graph)[1].rows).toEqual([['A', '2']]);
});
it('cancels an active worker and never accepts its late result', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
  const { reanalyzeDataModelAsync } = await import('../src/data/modelClient');
  FakeWorker.blocked = true;
  const dataset = parseCsv('Id\nA\n', 'a.csv'),
    graph = csvGraph(dataset, defaultAnalysis(dataset)),
    controller = new AbortController();
  const pending = reanalyzeDataModelAsync(graph, { signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejection;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it('row preview reuses source descriptors across filter/focus changes and sends no canonical drawing or layout', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
  const { previewDataModelRowsAsync } = await import('../src/data/modelClient');
  const dataset = parseCsv('Id,Amount\nA,1\nB,2\n', 'a.csv'),
    analysis = defaultAnalysis(dataset),
    graph = csvGraph(dataset, analysis);
  graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [] };
  graph.diagram.settings.namedAnalysisViews = { version: 1, views: [] };
  await previewDataModelRowsAsync(graph, dataset.id, analysis, [], 10);
  const changed = {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        csvEntityFocus: { datasetId: dataset.id, path: [{ columnId: 'c0', value: 'A' }] },
      },
    },
  };
  await previewDataModelRowsAsync(changed, dataset.id, analysis, [], 10);
  const first = FakeWorker.instances[0].messages[0],
    second = FakeWorker.instances[0].messages[1];
  expect(first.operation).toBe('rows');
  expect(second.sources[0].dataset).toBeUndefined();
  expect(second.graph.nodes).toEqual([]);
  expect(second.graph.edges).toEqual([]);
  expect(second.graph.diagram.settings.drawing).toBeUndefined();
  expect(second.graph.diagram.settings.namedAnalysisViews).toBeUndefined();
  expect(second.graph.diagram.settings.csvEntityFocus!.path[0].value).toBe('A');
});
it('worker row preview reconciles original cells and source-native sums using cached sources', async () => {
  vi.resetModules();
  const posted: {
    id: number;
    result: { rows: string[][]; originalRows: string[][]; total: number };
  }[] = [];
  const worker = {
    onmessage: undefined as ((event: { data: DataModelWorkerRequest }) => void) | undefined,
    postMessage: (message: (typeof posted)[number]) => posted.push(message),
  };
  vi.stubGlobal('self', worker);
  await import('../src/data/modelWorker');
  const a = parseCsv('Id\nA\nA\nB\n', 'customers.csv'),
    b = parseCsv('Id,Money\n A ,10\nA,20\nB,90\n', 'orders.csv');
  b.diagramId = a.diagramId;
  const aa = defaultAnalysis(a),
    ba = defaultAnalysis(b);
  const graph = {
    ...csvGraph(a, aa),
    datasets: [b],
    diagram: {
      ...csvGraph(a, aa).diagram,
      id: a.diagramId,
      settings: {
        csvAnalysis: aa,
        csvSourceAnalyses: { [b.id]: ba },
        csvEntityFocus: { datasetId: a.id, path: [{ columnId: 'c0', value: 'A' }] },
        csvRelationships: [
          {
            id: crypto.randomUUID(),
            sourceDatasetId: a.id,
            sourceColumnId: 'c0',
            targetDatasetId: b.id,
            targetColumnId: 'c0',
          },
        ],
      },
    },
  };
  const { dataset: _primary, datasets: _additional, ...light } = graph;
  worker.onmessage!({
    data: {
      id: 1,
      operation: 'rows',
      graph: light,
      sources: [
        { key: 'a', dataset: a },
        { key: 'b', dataset: b },
      ],
      datasetId: b.id,
      analysis: ba,
      path: [],
      limit: 100,
    },
  });
  expect(posted[0].result).toMatchObject({
    total: 2,
    originalRows: [
      [' A ', '10'],
      ['A', '20'],
    ],
  });
  worker.onmessage!({
    data: {
      id: 2,
      operation: 'rows',
      graph: {
        ...light,
        diagram: {
          ...light.diagram,
          settings: {
            ...light.diagram.settings,
            csvEntityFocus: { datasetId: a.id, path: [{ columnId: 'c0', value: 'B' }] },
          },
        },
      },
      sources: [{ key: 'a' }, { key: 'b' }],
      datasetId: b.id,
      analysis: ba,
      path: [],
      limit: 100,
    },
  });
  expect(posted[1].result).toMatchObject({ total: 1, originalRows: [['B', '90']] });
});
