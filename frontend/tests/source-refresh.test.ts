import { expect, it } from 'vitest';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';
import { defaultColumnMap, refreshCsvSource } from '../src/data/refresh';
import { newEdge, newNode, type Graph } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { parseSql } from '../src/sql/parser';
import { getSqlRelationship, getSqlTable } from '../src/sql/schema';
import { refreshSqlSchema } from '../src/sql/refresh';
import { reanalyzeDataModel, setAnalysisForDataset } from '../src/data/model';

function sales(text = 'ID,Customer,Amount\n1,Ada,10\n2,Ben,20\n3,Cara,30') {
  const dataset = parseCsv(text, 'customers.csv');
  const analysis = defaultAnalysis(dataset);
  analysis.levels = ['c1'];
  analysis.metrics = [
    { id: 'count', operation: 'count' },
    { id: 'sum', operation: 'sum', columnId: 'c2' },
  ];
  const graph = csvGraph(dataset, analysis);
  graph.diagram.settings.drawing = {
    version: 1,
    visible: true,
    strokes: [
      {
        id: crypto.randomUUID(),
        color: '#e85d3f',
        width: 3,
        points: [
          [0, 0],
          [150, 150],
        ],
      },
    ],
  };
  return graph;
}
function refresh(
  graph: Graph,
  text: string,
  removedPolicy: 'retain' | 'remove' = 'retain',
  columnMap?: Record<string, string | null>,
) {
  const incoming = parseCsv(text, 'replacement.csv');
  return refreshCsvSource(graph, incoming, {
    datasetId: graph.dataset!.id,
    keyColumnIds: ['c0'],
    columnMap: columnMap ?? defaultColumnMap(graph.dataset!, incoming),
    removedPolicy,
  });
}
const group = (graph: Graph, name: string) =>
  graph.nodes.find((node) => getCsvNode(node)?.path.at(-1)?.value === name)!;

it('matches stable row keys across display/header changes and preserves annotations, layout, drawing and manual links', () => {
  const graph = sales();
  const ada = group(graph, 'Ada'),
    ben = group(graph, 'Ben'),
    cara = group(graph, 'Cara');
  Object.assign(ada, {
    x: 811,
    y: 244,
    status: 'done',
    description: 'Follow up with the customer',
    color: '#123456',
  });
  const link = newEdge(graph.diagram.id, ada.id, ben.id, {
    label: 'Works with',
    direction: 'both',
    metadata: { custom: true },
  });
  graph.edges.push(link);
  const result = refresh(graph, 'Key,Name,Revenue\n1,Adelaide,12\n2,Ben,20\n4,Dan,40', 'retain', {
    c0: 'c0',
    c1: 'c1',
    c2: 'c2',
  });
  expect(result.summary).toMatchObject({
    added: 1,
    changed: 1,
    removed: 1,
    unchanged: 1,
    columnsAdded: 0,
    columnsRemoved: 0,
    retainedAnnotations: 1,
  });
  const updated = group(result.graph, 'Adelaide');
  expect(updated).toMatchObject({
    id: ada.id,
    x: 811,
    y: 244,
    status: 'done',
    description: ada.description,
    color: '#123456',
  });
  expect(getCsvNode(updated)?.measures.find((measure) => measure.id === 'sum')?.value).toBe(12);
  expect(result.graph.edges.find((edge) => edge.id === link.id)).toEqual(link);
  expect(result.graph.diagram.settings.drawing).toEqual(graph.diagram.settings.drawing);
  const retained = result.graph.nodes.find((node) => node.id === cara.id)!;
  expect(retained.metadata.csv).toBeUndefined();
  expect(retained.metadata.csvSnapshot).toBeDefined();
  expect(retained.externalId).toBeUndefined();
  expect(result.graph.dataset?.columns.map((column) => column.id)).toEqual(['c0', 'c1', 'c2']);
  expect(result.graph.dataset?.fileName).toBe('replacement.csv');
  expect(graph.dataset?.rows[0]).toEqual(['1', 'Ada', '10']);
  expect(() => validateGraph(result.graph)).not.toThrow();
});

it('rejects duplicate/blank identity on either side and supports composite keys without coercing identifiers', () => {
  expect(() => refresh(sales(), 'ID,Customer,Amount\n1,A,1\n1,B,2')).toThrow(/duplicate identity/);
  expect(() => refresh(sales(), 'ID,Customer,Amount\n,A,1')).toThrow(/empty identity/);
  const graph = sales('ID,Customer,Amount\n1,A,1\n1,B,2');
  expect(() => refresh(graph, 'ID,Customer,Amount\n1,A,3')).toThrow(
    /Existing source has duplicate/,
  );
  const incoming = parseCsv('ID,Customer,Amount\n1,A,3\n1,B,4', 'next.csv');
  const result = refreshCsvSource(graph, incoming, {
    datasetId: graph.dataset!.id,
    keyColumnIds: ['c0', 'c1'],
    columnMap: defaultColumnMap(graph.dataset!, incoming),
    removedPolicy: 'remove',
  });
  expect(result.summary).toMatchObject({ changed: 2, added: 0, removed: 0 });
  const literal = sales('ID,Customer,Amount\n001,A,1\n1,B,2');
  expect(refresh(literal, 'ID,Customer,Amount\n1,B,2\n001,A,1').summary).toMatchObject({
    unchanged: 2,
    changed: 0,
  });
});

it('makes removed-object/manual-link consequences explicit and never retains a stale source binding', () => {
  const graph = sales();
  const cara = group(graph, 'Cara'),
    ada = group(graph, 'Ada');
  const annotation = newNode(graph.diagram.id, { title: 'Personal note' });
  graph.nodes.push(annotation);
  const edge = newEdge(graph.diagram.id, cara.id, annotation.id, { label: 'Keep context' });
  graph.edges.push(edge);
  const result = refresh(graph, 'ID,Customer,Amount\n1,Ada,15\n2,Ben,20', 'remove');
  expect(result.summary).toMatchObject({
    removed: 1,
    affectedManualRelationships: 1,
    retainedAnnotations: 0,
  });
  expect(result.graph.nodes.some((node) => node.id === cara.id)).toBe(false);
  expect(result.graph.edges.some((item) => item.id === edge.id)).toBe(false);
  expect(group(result.graph, 'Ada').id).toBe(ada.id);
  expect(result.graph.nodes.find((node) => node.id === annotation.id)).toEqual(annotation);
});

it('updates previously hidden groups and manual metric copies and declines ambiguous split/merge matching', () => {
  const graph = sales();
  const ada = group(graph, 'Ada');
  const copy = { ...ada, id: crypto.randomUUID(), externalId: undefined, title: 'My Ada card' };
  graph.nodes.push(copy);
  let focused = setAnalysisForDataset(graph, graph.dataset!.id, {
    ...graph.diagram.settings.csvAnalysis!,
    filters: [{ id: crypto.randomUUID(), columnId: 'c1', operation: 'startsWith', value: 'B' }],
  });
  focused = reanalyzeDataModel(focused);
  const result = refresh(focused, 'ID,Customer,Amount\n1,Adelaide,99\n2,Ben,20\n3,Cara,30');
  expect(
    getCsvNode(result.graph.nodes.find((node) => node.id === ada.id)!)?.path.at(-1)?.value,
  ).toBe('Adelaide');
  expect(getCsvNode(result.graph.nodes.find((node) => node.id === ada.id)!)?.rowCount).toBe(0);
  expect(result.graph.nodes.find((node) => node.id === copy.id)?.externalId).toBeUndefined();
  expect(
    getCsvNode(result.graph.nodes.find((node) => node.id === copy.id)!)?.path.at(-1)?.value,
  ).toBe('Adelaide');
  const merging = refresh(sales(), 'ID,Customer,Amount\n1,Team,10\n2,Team,20\n3,Cara,30');
  expect(merging.summary.warnings.some((warning) => warning.includes('Multiple groups'))).toBe(
    true,
  );
  expect(merging.graph.nodes.filter((node) => node.metadata.csvSnapshot)).toHaveLength(2);
});

it('remaps named/linked focus and refuses an unmapped column needed by a saved analysis view', () => {
  const graph = sales('ID,Customer,Amount,Unused\n1,Ada,10,x\n2,Ben,20,y');
  const path = [{ columnId: 'c1', value: 'Ada' }];
  graph.diagram.settings.csvEntityFocus = { datasetId: graph.dataset!.id, path };
  graph.diagram.settings.namedAnalysisViews = {
    version: 1,
    views: [
      {
        id: 'view',
        name: 'Customer review',
        filters: { owner: '', status: '', kind: '', tag: '', from: '', to: '', mode: 'dim' },
        csvAnalysis: { ...graph.diagram.settings.csvAnalysis!, focusPath: path },
        layout: [],
      },
    ],
  };
  const result = refresh(graph, 'ID,Customer,Amount,Unused\n1,Adelaide,12,x\n2,Ben,20,y');
  expect(result.graph.diagram.settings.csvEntityFocus?.path).toEqual([
    { columnId: 'c1', value: 'Adelaide' },
  ]);
  const views = result.graph.diagram.settings.namedAnalysisViews as {
    views: { csvAnalysis: { focusPath: unknown } }[];
  };
  expect(views.views[0].csvAnalysis.focusPath).toEqual([{ columnId: 'c1', value: 'Adelaide' }]);
  const stale = {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: {
        ...graph.diagram.settings,
        namedAnalysisViews: {
          version: 1,
          views: [
            {
              ...(graph.diagram.settings.namedAnalysisViews as { views: object[] }).views[0],
              csvAnalysis: { ...graph.diagram.settings.csvAnalysis!, levels: ['c3'] },
            },
          ],
        },
      },
    },
  };
  expect(() => refresh(stale, 'ID,Customer,Amount\n1,Ada,12\n2,Ben,20')).toThrow(
    /Customer review.*no longer valid/,
  );
});

it('reviews 100,000 keyed rows without truncating changes or losing totals', () => {
  const rows = Array.from(
    { length: 100000 },
    (_, index) => `${index},Customer ${index % 2000},${index % 20}`,
  );
  const graph = sales(`ID,Customer,Amount\n${rows.join('\n')}`);
  rows.reverse();
  rows[0] = '99999,Renamed customer,50';
  const result = refresh(graph, `ID,Customer,Amount\n${rows.join('\n')}`);
  expect(result.summary).toMatchObject({ changed: 1, unchanged: 99999, added: 0, removed: 0 });
  expect(
    getCsvNode(result.graph.nodes.find((node) => getCsvNode(node)?.path.length === 0)!)?.rowCount,
  ).toBe(100000);
  expect(result.graph.dataset?.rows).toHaveLength(100000);
}, 20000);

it('refreshes qualified SQL tables and constraints while retaining annotations and removing raw literals', () => {
  const graph = parseSql(
    'CREATE TABLE public.customers(id INT PRIMARY KEY, name TEXT); CREATE TABLE public.orders(id INT PRIMARY KEY, customer_id INT, CONSTRAINT customer_fk FOREIGN KEY(customer_id) REFERENCES public.customers(id)); CREATE TABLE obsolete(id INT);',
  ).graph;
  const customer = graph.nodes.find((node) => getSqlTable(node)?.name === 'customers')!;
  Object.assign(customer, { x: 710, y: 99, status: 'done', description: 'Preserve this note' });
  const fk = graph.edges[0];
  fk.label = 'Customer places order';
  graph.diagram.settings.drawing = { version: 1, visible: true, strokes: [] };
  const next = parseSql(
    "CREATE TABLE public.customers(id INT PRIMARY KEY, email TEXT DEFAULT 'PRIVATE_DEFAULT'); CREATE TABLE public.orders(id INT PRIMARY KEY, customer_id INT, CONSTRAINT customer_fk FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE CASCADE); INSERT INTO public.customers VALUES(1,'PRIVATE_ROW');",
  );
  const result = refreshSqlSchema(graph, next, 'retain');
  expect(result.graph.nodes.find((node) => node.id === customer.id)).toMatchObject({
    x: 710,
    y: 99,
    status: 'done',
    description: customer.description,
  });
  expect(result.graph.edges.find((edge) => edge.id === fk.id)?.label).toBe('Customer places order');
  expect(getSqlRelationship(result.graph.edges.find((edge) => edge.id === fk.id)!)?.onDelete).toBe(
    'CASCADE',
  );
  expect(result.summary).toMatchObject({
    changed: 1,
    removed: 1,
    columnsAdded: 1,
    columnsRemoved: 2,
    relationshipsChanged: 1,
    retainedAnnotations: 1,
  });
  expect(
    result.graph.nodes.find((node) => node.title === 'obsolete')?.metadata.sqlTable,
  ).toBeUndefined();
  expect(JSON.stringify(result.graph)).not.toContain('PRIVATE_');
  expect(result.graph.diagram.settings.drawing).toEqual(graph.diagram.settings.drawing);
});

it('resolves an external SQL definition without retaining its external flag or replacing the FK ID', () => {
  const graph = parseSql(
    'CREATE TABLE orders(id INT PRIMARY KEY, customer_id INT, CONSTRAINT fk_customer FOREIGN KEY(customer_id) REFERENCES customers);',
  ).graph;
  const external = graph.nodes.find((node) => getSqlTable(node)?.external)!;
  const fk = graph.edges[0];
  const next = parseSql(
    'CREATE TABLE orders(id INT PRIMARY KEY, customer_id INT, CONSTRAINT fk_customer FOREIGN KEY(customer_id) REFERENCES customers); CREATE TABLE customers(id INT PRIMARY KEY);',
  );
  const result = refreshSqlSchema(graph, next, 'remove');
  expect(
    getSqlTable(result.graph.nodes.find((node) => node.id === external.id)!)?.external,
  ).toBeUndefined();
  expect(result.graph.edges[0].id).toBe(fk.id);
  expect(getSqlRelationship(result.graph.edges[0])?.unresolved).toBeUndefined();
});

it('rejects ambiguous replacement SQL identities before assigning duplicate existing object IDs', () => {
  const graph = parseSql('CREATE TABLE Customers(id INT PRIMARY KEY);').graph;
  const original = graph.nodes[0];
  const incoming = parseSql(
    'CREATE TABLE Customers(id INT PRIMARY KEY); CREATE TABLE "Customers"(email TEXT);',
  );
  expect(incoming.graph.nodes).toHaveLength(2);
  expect(() => refreshSqlSchema(graph, incoming, 'retain')).toThrow(
    /replacement SQL contains multiple tables named Customers/,
  );
  expect(graph.nodes).toEqual([original]);
});
