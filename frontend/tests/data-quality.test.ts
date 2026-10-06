import { expect, it } from 'vitest';
import { defaultAnalysis, parseCsv } from '../src/data/csv';
import { explainMeasure, qualityEvidence, qualityReport } from '../src/data/quality';
import { reanalyzeDataModel, setSourceAnalysis } from '../src/data/model';
import { csvGraph } from '../src/data/csv';
import { runQuality } from '../src/data/qualityClient';
import type { MeasureExplanation } from '../src/data/quality';

function source() {
  const dataset = parseCsv(
    'Id;Company;Amount\n1;310-AAA;10,50\n2;420-AAA;20.50\n2;BBB;1,234\n3;CCC;broken\n4;DDD;\n5;EEE;100\n',
    'orders.csv',
  );
  const analysis = {
    ...defaultAnalysis(dataset),
    levels: ['c1'],
    metrics: [
      { id: 'sum', operation: 'sum' as const, columnId: 'c2' },
      { id: 'count', operation: 'count' as const },
      { id: 'distinct', operation: 'distinct' as const, columnId: 'c1' },
    ],
    columnRules: [{ columnId: 'c1', pattern: '^\\d+-', replacement: '' }],
  };
  return { dataset, analysis };
}
it('reports real cleanup collisions, ambiguous numbers and duplicate identities with original evidence', () => {
  const { dataset, analysis } = source();
  const report = qualityReport(dataset, analysis, { keyColumns: ['c0'] });
  expect(report.matchingRows).toBe(6);
  expect(report.issues.find((issue) => issue.id === 'collision:c1')).toMatchObject({
    count: 2,
    groups: 1,
  });
  expect(report.issues.find((issue) => issue.id === 'duplicate-key')).toMatchObject({
    count: 2,
    groups: 1,
  });
  expect(report.issues.find((issue) => issue.id === 'ambiguous:c2')?.count).toBe(1);
  expect(report.issues.find((issue) => issue.id === 'invalid:c2')?.count).toBe(2);
  const evidence = qualityEvidence(dataset, analysis, {}, 'collision:c1');
  expect(evidence.rows.map((row) => [row.rowNumber, row.original[1], row.cleaned[1]])).toEqual([
    [1, '310-AAA', 'AAA'],
    [2, '420-AAA', 'AAA'],
  ]);
  expect(dataset.rows[0][1]).toBe('310-AAA');
});
it('explains exact filtered group totals and identifies excluded or repeated source rows', () => {
  const { dataset, analysis } = source();
  const sum = explainMeasure(dataset, analysis, [], 'sum');
  expect(sum.measure.value).toBe(131);
  expect(sum).toMatchObject({ matchingRows: 6, contributingRows: 3, ignoredRows: 3 });
  const excluded = explainMeasure(dataset, analysis, [], 'sum', 0, 'excluded');
  expect(excluded.rows.map((row) => [row.rowNumber, row.disposition])).toEqual([
    [3, 'invalid'],
    [4, 'invalid'],
    [5, 'empty'],
  ]);
  const group = explainMeasure(dataset, analysis, [{ columnId: 'c1', value: 'AAA' }], 'sum');
  expect(group.measure.value).toBe(31);
  expect(explainMeasure(dataset, analysis, [], 'distinct')).toMatchObject({
    contributingRows: 5,
    duplicateRows: 1,
    measure: { value: 5 },
  });
  expect(explainMeasure(dataset, analysis, [], 'count').contributingRows).toBe(6);
});
it('bounds evidence pages without limiting totals or ignoring filter scope', () => {
  const dataset = parseCsv(
    `Id,Amount\n${Array.from({ length: 100000 }, (_, index) => `${index},${index % 2 ? 'bad' : '10'}`).join('\n')}`,
    'large.csv',
  );
  const analysis = {
    ...defaultAnalysis(dataset),
    metrics: [{ id: 'sum', operation: 'sum' as const, columnId: 'c1' }],
  };
  const result = explainMeasure(dataset, analysis, [], 'sum', 100, 'excluded');
  expect(result).toMatchObject({
    total: 50000,
    contributingRows: 50000,
    measure: { value: 500000 },
  });
  expect(result.rows).toHaveLength(100);
  expect(result.rows[0].rowNumber).toBe(202);
  expect(qualityEvidence(dataset, analysis, {}, 'invalid:c1', 100).rows[0].rowNumber).toBe(202);
  const filtered = {
    ...analysis,
    filters: [{ id: 'filter', columnId: 'c0', operation: 'lt' as const, value: '3' }],
  };
  expect(qualityReport(dataset, filtered).matchingRows).toBe(3);
  expect(explainMeasure(dataset, filtered, [], 'sum').measure.value).toBe(20);
});
it('checks references against the whole target file and honors explicit numeric formats', () => {
  const { dataset, analysis } = source();
  const target = parseCsv('Id,Name\n1,One\n2,Two\n3,Three', 'customers.csv');
  const targetAnalysis = {
    ...defaultAnalysis(target),
    filters: [{ id: 'one', columnId: 'c0', operation: 'equals' as const, value: '1' }],
  };
  const report = qualityReport(dataset, analysis, {
    references: [
      {
        id: 'customer',
        label: 'Unknown customer',
        columnId: 'c0',
        target,
        targetColumnId: 'c0',
        targetAnalysis,
      },
    ],
  });
  expect(report.issues.find((issue) => issue.id === 'reference:customer')?.count).toBe(2);
  const explicit = {
    ...analysis,
    columnRules: [...analysis.columnRules, { columnId: 'c2', numberFormat: 'dot' as const }],
  };
  expect(
    qualityReport(dataset, explicit).issues.find((issue) => issue.kind === 'ambiguous'),
  ).toBeUndefined();
  expect(() => explainMeasure(dataset, analysis, [], 'obsolete')).toThrow('no longer');
  expect(() => qualityEvidence(dataset, analysis, {}, 'invalid:c2', -1)).toThrow(
    'Invalid evidence',
  );
});

it('reconciles related-source sums without multiplying rows and preserves original file row numbers', () => {
  const customers = parseCsv('Id,Company\nK1,BBB\nK2,AAA\nK2,AAA', 'customers.csv');
  const orders = {
    ...parseCsv('Customer,Amount\nK1,100\nK2,10\nK1,200\nK2,5', 'orders.csv'),
    diagramId: customers.diagramId,
  };
  const customerAnalysis = { ...defaultAnalysis(customers), levels: ['c1'] };
  const orderAnalysis = {
    ...defaultAnalysis(orders),
    levels: ['c0'],
    metrics: [{ id: 'total', operation: 'sum' as const, columnId: 'c1' }],
  };
  let graph = { ...csvGraph(customers, customerAnalysis), datasets: [orders] };
  graph = setSourceAnalysis(graph, orders.id, orderAnalysis) as typeof graph;
  graph.diagram.settings.csvRelationships = [
    {
      id: crypto.randomUUID(),
      sourceDatasetId: orders.id,
      sourceColumnId: 'c0',
      targetDatasetId: customers.id,
      targetColumnId: 'c0',
    },
  ];
  graph.diagram.settings.csvEntityFocus = {
    datasetId: customers.id,
    path: [{ columnId: 'c1', value: 'AAA' }],
  };
  const generated = reanalyzeDataModel(graph);
  const explanation = runQuality({
    operation: 'measure',
    dataset: orders,
    analysis: orderAnalysis,
    model: generated,
    path: [],
    metricId: 'total',
  }) as MeasureExplanation;
  expect(explanation.measure.value).toBe(15);
  expect(explanation.matchingRows).toBe(2);
  expect(explanation.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  expect(
    generated.nodes.find(
      (node) =>
        (node.metadata.csv as { datasetId?: string; path?: unknown[] })?.datasetId === orders.id &&
        (node.metadata.csv as { path: unknown[] }).path.length === 0,
    )?.metadata.csv,
  ).toMatchObject({ measures: [{ value: 15 }] });
});
