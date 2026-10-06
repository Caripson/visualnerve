import { expect, it, vi } from 'vitest';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import {
  analysisForDataset,
  clearDataModelFocus,
  graphDatasets,
  isGeneratedCsvNode,
  modelDatasetForAnalysis,
  modelRowIndices,
  previewCsvRelationship,
  reanalyzeDataModel,
  removeDataModelSource,
  setAnalysisForDataset,
  suppressDataModelEdge,
  reconnectedDataModelEdge,
  validateDataModel,
  type CsvSourceRelationship,
} from '../src/data/model';
import { newEdge, newNode, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { applyDelta, diffGraph } from '../src/state/history';
import { buildLovablePrompt } from '../src/export/lovable';
function fixture() {
  const customers = parseCsv(
    'Customer,Budget\nA,100\nA,200\nB,300\nX,400\n,500\n',
    'Customers.csv',
  );
  const orders = parseCsv(
    'Customer,Order,Amount\nA,one,10\nA,two,20\nB,three,40\nZ,four,80\n,blank,160\n',
    'Orders.csv',
  );
  orders.diagramId = customers.diagramId;
  const ca = defaultAnalysis(customers);
  ca.metrics.push({ id: 'budget', operation: 'sum', columnId: 'c1' });
  const oa = defaultAnalysis(orders);
  oa.metrics.push({ id: 'amount', operation: 'sum', columnId: 'c2' });
  let graph: Graph = { ...csvGraph(customers, ca), datasets: [orders] };
  graph = setAnalysisForDataset(graph, orders.id, oa);
  const relationship: CsvSourceRelationship = {
    id: crypto.randomUUID(),
    sourceDatasetId: customers.id,
    sourceColumnId: 'c0',
    targetDatasetId: orders.id,
    targetColumnId: 'c0',
  };
  graph.diagram.settings.csvRelationships = [relationship];
  return { graph, customers, orders, relationship };
}
const rootOf = (graph: Graph, id: string) =>
  getCsvNode(
    graph.nodes.find(
      (n) =>
        isGeneratedCsvNode(n) &&
        getCsvNode(n)!.datasetId === id &&
        getCsvNode(n)!.path.length === 0,
    )!,
  );
it('previews duplicate cardinality, missing and unmatched keys without joining money', () => {
  const { graph, customers, orders, relationship } = fixture();
  expect(previewCsvRelationship(graph, relationship)).toEqual({
    sourceRows: 5,
    targetRows: 5,
    matchedSourceRows: 3,
    matchedTargetRows: 3,
    unmatchedSourceRows: 1,
    unmatchedTargetRows: 1,
    missingSourceRows: 1,
    missingTargetRows: 1,
    duplicateSourceKeys: 1,
    duplicateTargetKeys: 1,
    matchedPairs: 5,
    cardinality: 'many-to-many',
  });
  const result = reanalyzeDataModel(graph);
  validateGraph(result);
  expect(rootOf(result, customers.id)!.measures.find((m) => m.id === 'budget')!.value).toBe(1500);
  expect(rootOf(result, orders.id)!.measures.find((m) => m.id === 'amount')!.value).toBe(310);
  expect(new Set(result.nodes.map((n) => n.externalId)).size).toBe(result.nodes.length);
  expect(result.edges.filter((e) => e.metadata.csvModelGenerated === true)).toHaveLength(2);
  expect(result.dataset).toBe(customers);
  expect(result.datasets![0]).toBe(orders);
});
it('deduplicates related rows and exposes exact original-row evidence after filters', () => {
  let { graph, customers, orders } = fixture();
  graph = setAnalysisForDataset(graph, orders.id, {
    ...analysisForDataset(graph, orders.id)!,
    filters: [{ id: 'positive', columnId: 'c2', operation: 'gt', value: '15' }],
  });
  graph.diagram.settings.csvEntityFocus = {
    datasetId: customers.id,
    path: [{ columnId: 'c0', value: 'A' }],
  };
  const scope = modelDatasetForAnalysis(graph, orders.id);
  expect(scope.rows).toEqual([['A', 'two', '20']]);
  expect(scope.rows[0]).toBe(orders.rows[1]);
  expect(modelRowIndices(graph, orders.id)).toEqual([1]);
  const result = reanalyzeDataModel(graph);
  expect(rootOf(result, orders.id)!.rowCount).toBe(1);
  expect(rootOf(result, orders.id)!.measures.find((m) => m.id === 'amount')!.value).toBe(20);
  expect(rootOf(result, customers.id)!.measures.find((m) => m.id === 'budget')!.value).toBe(300);
  expect(
    rootOf(reanalyzeDataModel(clearDataModelFocus(result)), orders.id)!.measures.find(
      (m) => m.id === 'amount',
    )!.value,
  ).toBe(300);
});
it('traverses entity chains and preserves empty connected scopes', () => {
  const { graph, customers, orders } = fixture();
  const payments = parseCsv('Order,Paid\none,8\none,2\ntwo,15\nthree,30\n', 'Payments.csv');
  payments.diagramId = graph.diagram.id;
  graph.datasets!.push(payments);
  graph.diagram.settings.csvRelationships!.push({
    id: crypto.randomUUID(),
    sourceDatasetId: orders.id,
    sourceColumnId: 'c1',
    targetDatasetId: payments.id,
    targetColumnId: 'c0',
  });
  graph.diagram.settings.csvEntityFocus = {
    datasetId: customers.id,
    path: [{ columnId: 'c0', value: 'A' }],
  };
  const result = reanalyzeDataModel(
    setAnalysisForDataset(graph, payments.id, {
      ...defaultAnalysis(payments),
      metrics: [{ id: 'paid', operation: 'sum', columnId: 'c1' }],
    }),
  );
  expect(rootOf(result, payments.id)!.measures[0].value).toBe(25);
  graph.diagram.settings.csvEntityFocus.path[0].value = 'not present';
  expect(modelRowIndices(graph, orders.id)).toEqual([]);
  expect(modelRowIndices(graph, payments.id)).toEqual([]);
  const empty = reanalyzeDataModel(graph);
  validateGraph(empty);
  expect(rootOf(empty, customers.id)!.rowCount).toBe(0);
  expect(rootOf(empty, orders.id)!.rowCount).toBe(0);
  expect(rootOf(empty, payments.id)!.rowCount).toBe(0);
});
it.each(['unmatched entity', 'filtered matches'])(
  'rebuilds an empty linked source for %s and restores its data and annotations after clearing focus',
  (scenario) => {
    let { graph, customers, orders } = fixture();
    graph = reanalyzeDataModel(graph);
    const orderGroup = graph.nodes.find(
      (node) =>
        getCsvNode(node)?.datasetId === orders.id && getCsvNode(node)?.path[0]?.value === 'A',
    )!;
    graph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === orderGroup.id ? { ...node, status: 'done', notes: 'Review completed' } : node,
      ),
    };
    if (scenario === 'filtered matches')
      graph = setAnalysisForDataset(graph, orders.id, {
        ...analysisForDataset(graph, orders.id)!,
        filters: [{ id: 'large', columnId: 'c2', operation: 'gt', value: '50' }],
      });
    graph.diagram.settings.csvEntityFocus = {
      datasetId: customers.id,
      path: [{ columnId: 'c0', value: scenario === 'unmatched entity' ? 'X' : 'A' }],
    };
    const original = structuredClone(graph);
    const focused = reanalyzeDataModel(graph);
    validateGraph(focused);
    expect(rootOf(focused, orders.id)).toMatchObject({ rowCount: 0, totalChildren: 0 });
    expect(
      rootOf(focused, orders.id)!.measures.find((metric) => metric.operation === 'count')!.value,
    ).toBe(0);
    expect(
      rootOf(focused, orders.id)!.measures.find((metric) => metric.id === 'amount')!.value,
    ).toBeNull();
    expect(focused.nodes.find((node) => node.id === orderGroup.id)).toMatchObject({
      status: 'done',
      notes: 'Review completed',
      metadata: { csv: { visible: false } },
    });
    expect(
      focused.edges.filter(
        (edge) =>
          edge.metadata.csvModelGenerated === true && edge.metadata.csvModelVisible !== false,
      ),
    ).toHaveLength(0);
    expect(focused.dataset).toBe(customers);
    expect(focused.datasets![0]).toBe(orders);
    expect(graph).toEqual(original);
    const restored = reanalyzeDataModel(
      setAnalysisForDataset(clearDataModelFocus(focused), orders.id, {
        ...analysisForDataset(focused, orders.id)!,
        filters: [],
      }),
    );
    validateGraph(restored);
    expect(rootOf(restored, orders.id)!.rowCount).toBe(orders.rows.length);
    expect(
      rootOf(restored, orders.id)!.measures.find((metric) => metric.id === 'amount')!.value,
    ).toBe(310);
    expect(restored.nodes.find((node) => node.id === orderGroup.id)).toMatchObject({
      status: 'done',
      notes: 'Review completed',
      metadata: { csv: { visible: true } },
    });
  },
);
it('uses exact cleanup and explicit text matching without guessing numeric IDs', () => {
  const { graph, customers, orders, relationship } = fixture();
  let next = {
    ...graph,
    dataset: {
      ...customers,
      rows: [
        ['001', '1'],
        ['ABC', '2'],
      ],
    },
    datasets: [
      {
        ...orders,
        rows: [
          ['1', 'x', '1'],
          ['abc', 'y', '2'],
        ],
      },
    ],
  };
  expect(previewCsvRelationship(next, relationship).matchedSourceRows).toBe(0);
  expect(
    previewCsvRelationship(next, { ...relationship, matchMode: 'case-insensitive' })
      .matchedSourceRows,
  ).toBe(1);
  next = setAnalysisForDataset(next, customers.id, {
    ...analysisForDataset(next, customers.id)!,
    columnRules: [{ columnId: 'c0', pattern: '^0+', replacement: '' }],
  }) as typeof next;
  expect(previewCsvRelationship(next, relationship).matchedSourceRows).toBe(1);
});
it('retains annotations/manual links and edited entity connections across filters', () => {
  const { graph, customers } = fixture();
  let result = reanalyzeDataModel(graph);
  const own = newNode(graph.diagram.id, { title: 'Follow up', status: 'blocked' });
  const match = result.edges.find((e) => e.metadata.csvModelGenerated === true)!;
  result = {
    ...result,
    nodes: [...result.nodes, own].map((n) =>
      n.id === match.sourceNodeId ? { ...n, status: 'done', notes: 'Keep this note' } : n,
    ),
    edges: [
      ...result.edges.map((e) =>
        e.id === match.id ? { ...e, label: 'Approved only', direction: 'both' as const } : e,
      ),
      newEdge(graph.diagram.id, own.id, match.targetNodeId, { label: 'Manual' }),
    ],
  };
  const saved = result;
  result = reanalyzeDataModel(
    setAnalysisForDataset(result, customers.id, {
      ...analysisForDataset(result, customers.id)!,
      filters: [{ id: 'b', columnId: 'c0', operation: 'equals', value: 'B' }],
    }),
  );
  expect(result.edges.find((e) => e.id === match.id)!.metadata.csvModelVisible).toBe(false);
  expect(result.edges.some((e) => e.label === 'Manual')).toBe(true);
  result = reanalyzeDataModel(
    setAnalysisForDataset(result, customers.id, analysisForDataset(saved, customers.id)!),
  );
  expect(result.edges.find((e) => e.id === match.id)).toMatchObject({
    label: 'Approved only',
    direction: 'both',
    metadata: { csvModelVisible: true },
  });
  expect(result.nodes.find((n) => n.id === match.sourceNodeId)).toMatchObject({
    status: 'done',
    notes: 'Keep this note',
  });
  expect(result.nodes.find((n) => n.id === own.id)).toEqual(own);
});
it('explicit deletion/reconnect never regenerates the prior entity relation', () => {
  let { graph } = fixture();
  graph = reanalyzeDataModel(graph);
  const edge = graph.edges.find((e) => e.metadata.csvModelGenerated === true)!;
  const removed = {
    ...suppressDataModelEdge(graph, edge),
    edges: graph.edges.filter((e) => e.id !== edge.id),
  };
  expect(reanalyzeDataModel(removed).edges.some((e) => e.externalId === edge.externalId)).toBe(
    false,
  );
  const next = reconnectedDataModelEdge(edge, { ...edge, targetNodeId: graph.nodes[0].id });
  const reconnected = {
    ...suppressDataModelEdge(graph, edge),
    edges: graph.edges.map((e) => (e.id === edge.id ? next : e)),
  };
  const result = reanalyzeDataModel(reconnected);
  expect(result.edges.find((e) => e.id === edge.id)).toMatchObject({
    targetNodeId: graph.nodes[0].id,
    metadata: { csvModelGenerated: false },
  });
  expect(result.edges.some((e) => e.externalId === edge.externalId)).toBe(false);
});
it('tracks source-only refresh by reference and excludes raw rows from semantic handoff', () => {
  const { graph, orders } = fixture();
  const updated = {
    ...graph,
    datasets: [{ ...orders, rows: [['A', 'private-record-token', '90']] }],
  };
  const stringify = vi.spyOn(JSON, 'stringify');
  const delta = diffGraph(graph, updated, 'Refresh source');
  expect(delta.sources).toHaveLength(1);
  expect(delta.sources![0].before).toBe(orders);
  expect(delta.sources![0].after).toBe(updated.datasets[0]);
  expect(
    stringify.mock.calls.some(([value]) => value && typeof value === 'object' && 'rows' in value),
  ).toBe(false);
  stringify.mockRestore();
  expect(applyDelta(updated, delta, false).datasets![0]).toBe(orders);
  expect(applyDelta(graph, delta, true).datasets![0]).toBe(updated.datasets[0]);
  const prompt = buildLovablePrompt(reanalyzeDataModel(updated), 'Build reports', {
    scope: 'csv-view',
  }).text;
  expect(prompt).not.toContain('private-record-token');
  expect(prompt).toContain('CSV sources:');
  expect(prompt).toContain('CSV column relationships:');
  expect(prompt).toContain('semijoin');
  expect(prompt).toContain('"source":"s2"');
});
it('removes a source but retains manual snapshot cards and rejects dangling bindings', () => {
  const { graph, orders } = fixture();
  let result = reanalyzeDataModel(graph);
  const card = result.nodes.find((n) => getCsvNode(n)?.datasetId === orders.id)!;
  result.nodes.push({
    ...card,
    id: crypto.randomUUID(),
    externalId: undefined,
    title: 'My comparison',
  });
  const removed = removeDataModelSource(result, orders.id);
  validateGraph(removed);
  expect(graphDatasets(removed)).toHaveLength(1);
  expect(removed.diagram.settings.csvRelationships).toEqual([]);
  const snapshot = removed.nodes.find((n) => n.title === 'My comparison')!;
  expect(snapshot.metadata.csv).toBeUndefined();
  expect(getCsvNode(snapshot)).toBeDefined();
  expect(() => validateDataModel({ ...graph, datasets: [] })).toThrow(
    /missing source|source analyses/,
  );
});
it('bounds many-to-many visible graph expansion and total source cells before creating a large result', () => {
  const { graph, customers, orders, relationship } = fixture();
  const a = {
    ...customers,
    rows: Array.from({ length: 101 }, (_, index) => ['same', `left-${index}`]),
  };
  const b = {
    ...orders,
    rows: Array.from({ length: 101 }, (_, index) => ['same', `right-${index}`, '1']),
  };
  let next = setAnalysisForDataset({ ...graph, dataset: a, datasets: [b] }, a.id, {
    ...defaultAnalysis(a),
    levels: ['c1'],
    limit: 150,
  });
  next = setAnalysisForDataset(next, b.id, { ...defaultAnalysis(b), levels: ['c1'], limit: 150 });
  expect(previewCsvRelationship(next, relationship).matchedPairs).toBe(10201);
  expect(() => reanalyzeDataModel(next)).toThrow(/10,000 visible relationships/);
  expect(() =>
    validateDataModel({
      ...graph,
      datasets: [
        {
          ...orders,
          rows: new Array(10000001),
          columns: [
            { id: 'c0', label: 'Id' },
            { id: 'c1', label: 'Value' },
          ],
        },
      ],
    }),
  ).toThrow(/20 million cells/);
});
it('semantic handoff whitelists per-source settings and distinguishes columns with identical local IDs', () => {
  const { graph, orders } = fixture();
  graph.diagram.settings.csvSourceAnalyses![orders.id].columnRules = [
    { columnId: 'c0', trim: true, apiKey: 'private-cleanup-token' } as never,
  ];
  graph.dataset!.columns[0].label = 'Customer identifier';
  graph.datasets![0].columns[0].label = 'Order customer';
  const text = buildLovablePrompt(reanalyzeDataModel(graph), 'Build reports', {
    scope: 'csv-view',
  }).text;
  expect(text).not.toContain('private-cleanup-token');
  expect(text).toContain('"label":"Customer identifier","source":"s1"');
  expect(text).toContain('"label":"Order customer","source":"s2"');
  expect(text).toContain('"sourceColumn":"c1","target":"s2","targetColumn":"c3"');
});
