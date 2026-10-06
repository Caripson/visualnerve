import { afterEach, expect, it, vi } from 'vitest';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { setSourceAnalysis } from '../src/data/model';
import { QualityClient } from '../src/data/qualityClient';
import type { MeasureExplanation, QualityReport } from '../src/data/quality';
afterEach(() => vi.unstubAllGlobals());

it('uses the actual quality worker cache without expanding joins or renumbering sparse original rows among 100,000 records', async () => {
  const customers = parseCsv('Id,Company\nK1,Other\nK2,Chosen\nK2,Chosen', 'customers.csv');
  const orders = parseCsv(
    `Customer,Amount\n${Array.from({ length: 100_000 }, (_, index) => `${index % 1000 === 999 ? 'K2' : 'K1'},${index === 1999 || index === 99999 ? 'invalid' : index + 1}`).join('\n')}`,
    'orders.csv',
  );
  orders.diagramId = customers.diagramId;
  const customerAnalysis = { ...defaultAnalysis(customers), levels: ['c1'] };
  const orderAnalysis = {
    ...defaultAnalysis(orders),
    levels: ['c0'],
    metrics: [{ id: 'total', operation: 'sum' as const, columnId: 'c1' }],
  };
  let model = { ...csvGraph(customers, customerAnalysis), datasets: [orders] };
  model = setSourceAnalysis(model, orders.id, orderAnalysis) as typeof model;
  model.diagram.settings.csvRelationships = [
    {
      id: crypto.randomUUID(),
      sourceDatasetId: orders.id,
      sourceColumnId: 'c0',
      targetDatasetId: customers.id,
      targetColumnId: 'c0',
    },
  ];
  model.diagram.settings.csvEntityFocus = {
    datasetId: customers.id,
    path: [{ columnId: 'c1', value: 'Chosen' }],
  };
  const sent: { sources: unknown[]; model: { nodes: unknown[]; dataset?: unknown } }[] = [];
  let active: TestWorker;
  const context = {
    location: window.location,
    onmessage: (_event: MessageEvent) => {},
    postMessage: (data: unknown) => active.onmessage?.({ data } as MessageEvent),
  };
  class TestWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: ErrorEvent) => void;
    constructor() {
      active = this;
    }
    postMessage(payload: (typeof sent)[number]) {
      sent.push(payload);
      context.onmessage({ data: structuredClone(payload) } as MessageEvent);
    }
    terminate() {}
  }
  vi.stubGlobal('self', context);
  vi.stubGlobal('Worker', TestWorker);
  await import('../src/data/qualityWorker');
  const client = new QualityClient();
  try {
    const result = await client.request<MeasureExplanation>({
      operation: 'measure',
      dataset: orders,
      analysis: orderAnalysis,
      model,
      path: [],
      metricId: 'total',
    });
    expect(result).toMatchObject({
      matchingRows: 100,
      contributingRows: 98,
      ignoredRows: 2,
      measure: { value: 4_948_000 },
    });
    expect(result.rows).toHaveLength(100);
    expect(result.rows.slice(0, 3).map((row) => row.rowNumber)).toEqual([1000, 2000, 3000]);
    expect(result.rows.at(-1)?.rowNumber).toBe(100000);
    const report = await client.request<QualityReport>({
      operation: 'report',
      dataset: orders,
      analysis: orderAnalysis,
      model,
    });
    expect(report).toMatchObject({ sourceRows: 100000, matchingRows: 100 });
    expect(report.issues.find((issue) => issue.id === 'invalid:c1')?.count).toBe(2);
    expect(sent[0].sources).toHaveLength(2);
    expect(sent[1].sources).toEqual([]);
    expect(sent[1].model.nodes).toEqual([]);
    expect(sent[1].model.dataset).toBeUndefined();
    expect(orders.rows).toHaveLength(100000);
  } finally {
    client.dispose();
  }
});
