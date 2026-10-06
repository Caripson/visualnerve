import { describe, expect, it, vi } from 'vitest';
import * as importLimits from '../src/imports/limits';
import {
  csvGraph,
  csvLimits,
  csvNumber,
  csvFormattedNumber,
  defaultAnalysis,
  getCsvAnalysis,
  getCsvNode,
  groupCsv,
  parseCsv,
  profileCsv,
  previewCsvRowsSync,
  rowsForGroup,
  validateAnalysis,
  validateCsvNode,
  validateDataset,
} from '../src/data/csv';
import type { CsvAnalysis, CsvDataset, CsvGroup, CsvMetric } from '../src/data/types';
import { newEdge, newNode } from '../src/model/types';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { validateGraph } from '../src/model/validation';
import {
  analyzeCsv,
  previewCsvRows,
  profileCsvAsync,
  type CsvWorkerRequest,
} from '../src/data/client';

const source =
  'Region,Product,Amount,Code\nNord,A,10,x\nNord,A,30,x\nNord,B,100,y\nSyd,C,oops,z\nSyd,C,,z';

function analysis(dataset: CsvDataset, metrics?: CsvMetric[]): CsvAnalysis {
  return {
    ...defaultAnalysis(dataset),
    levels: [dataset.columns[0].id, dataset.columns[1].id],
    metrics: metrics ?? [
      { id: 'count', operation: 'count' },
      ...(['sum', 'avg', 'median', 'min', 'max'] as const).map((operation) => ({
        id: operation,
        operation,
        columnId: dataset.columns[2].id,
      })),
      { id: 'distinct', operation: 'distinct', columnId: dataset.columns[3].id },
    ],
  };
}

function value(group: CsvGroup, id: string) {
  return group.measures.find((measure) => measure.id === id)!.value;
}

describe('CSV datasets and column profiles', () => {
  it('preserves quoted multiline cells, identifiers and duplicate/empty headers without object-key collisions', () => {
    const dataset = parseCsv(
      '\uFEFFRegion;Region;;Amount\r\n"__proto__";"Line one\nLine two";001;"1,5"\r\nNord;x;002;"2,5"',
      'Customers.csv',
    );
    expect(dataset.name).toBe('Customers');
    expect(dataset.columns).toEqual([
      { id: 'c0', label: 'Region' },
      { id: 'c1', label: 'Region (2)' },
      { id: 'c2', label: 'Column 3' },
      { id: 'c3', label: 'Amount' },
    ]);
    expect(dataset.rows[0]).toEqual(['__proto__', 'Line one\nLine two', '001', '1,5']);
    expect(dataset.id).not.toBe(dataset.diagramId);
    expect(profileCsv(dataset, ',')[3]).toMatchObject({
      numericCount: 2,
      missingCount: 0,
      invalidCount: 0,
      distinctCount: 2,
    });
    expect(profileCsv(dataset, '.')[3].numericCount).toBe(2);
  });

  it('supports single-column CSV and skips empty lines without inventing records', () => {
    const dataset = parseCsv('\nName\nAlice\n\nBob\n', 'Names.csv');
    expect(dataset.rows).toEqual([['Alice'], ['Bob']]);
    expect(defaultAnalysis(dataset)).toMatchObject({
      levels: ['c0'],
      displayColumns: ['c0'],
      decimalSeparator: '.',
    });
  });

  it('rejects empty, header-only, malformed quotes and ragged records', () => {
    expect(() => parseCsv('', 'empty.csv')).toThrow('CSV is empty');
    expect(() => parseCsv('A,B\n', 'empty.csv')).toThrow('data rows');
    expect(() => parseCsv('A,B\n"unfinished,value', 'broken.csv')).toThrow(
      'CSV could not be parsed',
    );
    expect(() => parseCsv('A,B\n1,2,3', 'wide.csv')).toThrow('CSV row 2 has 3 columns; expected 2');
    expect(() => parseCsv('A,B\n1', 'short.csv')).toThrow('expected 2');
  });

  it('uses the selected decimal separator and full-cell numeric parsing', () => {
    for (const cell of [
      '',
      ' ',
      'null',
      'NaN',
      'Infinity',
      '12 kr',
      '1 234',
      '1e309',
      '0x10',
      '2,5',
    ])
      expect(csvNumber(cell, '.')).toBeNull();
    expect(csvNumber(' 0 ', '.')).toBe(0);
    expect(csvNumber('-2.5e2', '.')).toBe(-250);
    expect(csvNumber('+0,25', ',')).toBe(0.25);
    expect(csvNumber('1.25', ',')).toBeNull();
  });

  it('caps bytes, rows, columns and cells for parsing and restored datasets', () => {
    expect(() => parseCsv('A\n' + 'x'.repeat(csvLimits.bytes), 'large.csv')).toThrow('50 MB');
    expect(() =>
      parseCsv(
        Array.from({ length: csvLimits.columns + 1 }, (_, i) => `c${i}`).join(',') +
          '\n' +
          Array(csvLimits.columns + 1)
            .fill('x')
            .join(','),
        'wide.csv',
      ),
    ).toThrow('column limit');
    const dataset = parseCsv('A\nx', 'small.csv');
    expect(() =>
      validateDataset({ ...dataset, rows: Array(csvLimits.rows + 1).fill(['x']) }),
    ).toThrow('200,000');
    const columns = Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, label: `C${i}` }));
    expect(() =>
      validateDataset({
        ...dataset,
        columns,
        rows: Array(csvLimits.rows).fill(Array(51).fill('x')),
      }),
    ).toThrow('cell limit');
    expect(() => validateDataset({ ...dataset, rows: [['x', 'y']] })).toThrow(
      'one string cell per column',
    );
    expect(() =>
      validateDataset({ ...dataset, columns: [dataset.columns[0], dataset.columns[0]] }),
    ).toThrow('Duplicate CSV column id');
  });

  it('enforces restored-source byte limits for multibyte text, emoji and unpaired surrogates', () => {
    const dataset = parseCsv('A\nx', 'Unicode.csv');
    const chunk = 'é界😀\ud800x\udc00';
    const chunkBytes = new TextEncoder().encode(chunk).byteLength;
    const belowLimit = chunk.repeat(Math.floor((csvLimits.bytes - 1) / chunkBytes));
    expect(() => validateDataset({ ...dataset, rows: [[belowLimit]] })).not.toThrow();
    // Previously this persisted source was rejected at the import preference's old50MiB cap.
    expect(() => validateDataset({ ...dataset, rows: [[belowLimit + chunk]] })).not.toThrow();
    const byteCount = vi
      .spyOn(importLimits, 'utf8Bytes')
      .mockImplementation((value) => (value === 'x' ? importLimits.MAX_IMPORT_LIMIT_BYTES : 1));
    try {
      expect(() => validateDataset({ ...dataset, rows: [['x']] })).toThrow('1 GiB data limit');
    } finally {
      byteCount.mockRestore();
    }
  });
});

describe('CSV hierarchy and measures', () => {
  it('analyzes original row selections after cleanup without accepting empty stored sources or duplicate rows', () => {
    const dataset = parseCsv('Customer;Amount\n1-A;1,5\n2-B;2,5\n3-A;4,5', 'Selected.csv');
    const config: CsvAnalysis = {
      ...defaultAnalysis(dataset),
      metrics: [
        { id: 'count', operation: 'count' },
        { id: 'sum', operation: 'sum', columnId: 'c1' },
      ],
      columnRules: [{ columnId: 'c0', pattern: '^\\d+-', replacement: '' }],
    };
    const before = structuredClone(dataset);
    const selected = groupCsv(dataset, config, [0, 2]);
    expect(selected.rowCount).toBe(2);
    expect(value(selected, 'sum')).toBe(6);
    expect(selected.children.map((child) => [child.label, child.rowCount])).toEqual([['A', 2]]);
    const empty = groupCsv(dataset, config, []);
    expect(empty).toMatchObject({ rowCount: 0, children: [], totalChildren: 0 });
    expect(value(empty, 'count')).toBe(0);
    expect(value(empty, 'sum')).toBeNull();
    expect(dataset).toEqual(before);
    expect(() => groupCsv(dataset, config, [0, 0])).toThrow('unique existing row indices');
    expect(() => groupCsv(dataset, config, [-1])).toThrow('unique existing row indices');
    expect(() => groupCsv(dataset, config, [dataset.rows.length])).toThrow(
      'unique existing row indices',
    );
    expect(() => groupCsv({ ...dataset, rows: [] }, config, [])).toThrow('data rows');
  });

  it('calculates parent means and medians from raw rows, alongside count/sum/min/max/distinct', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const before = structuredClone(dataset);
    const tree = groupCsv(dataset, config);
    expect(tree.rowCount).toBe(5);
    expect(value(tree, 'count')).toBe(5);
    expect(value(tree, 'sum')).toBe(140);
    expect(value(tree, 'avg')).toBeCloseTo(140 / 3);
    expect(value(tree, 'median')).toBe(30);
    expect(value(tree, 'min')).toBe(10);
    expect(value(tree, 'max')).toBe(100);
    expect(value(tree, 'distinct')).toBe(3);
    const north = tree.children[0];
    expect(north.children.map((child) => [child.label, value(child, 'avg')])).toEqual([
      ['A', 20],
      ['B', 100],
    ]);
    expect(value(north, 'avg')).not.toBe(60);
    expect(value(north, 'median')).not.toBe(60);
    expect(dataset).toEqual(before);
    expect(tree.measures.find((measure) => measure.id === 'avg')).toMatchObject({
      numericCount: 3,
      invalidCount: 1,
      missingCount: 1,
    });
    for (const measure of tree.children[1].measures.filter(
      (item) => !['count', 'distinct'].includes(item.operation),
    ))
      expect(measure).toMatchObject({
        value: null,
        numericCount: 0,
        missingCount: 1,
        invalidCount: 1,
      });
  });

  it('groups special text safely, keeps missing values separate and selects raw source rows', () => {
    const dataset = parseCsv(
      'Category,Amount\n__proto__,1\n,2\n(Empty),3\na/b,4\na|b,5\na,6\n a ,7',
      'Categories.csv',
    );
    const config = defaultAnalysis(dataset);
    const tree = groupCsv(dataset, config);
    expect(tree.children).toHaveLength(6);
    expect(new Set(tree.children.map((group) => group.key)).size).toBe(6);
    const empty = tree.children.find((group) => group.path[0].value === '')!;
    const literal = tree.children.find((group) => group.path[0].value === '(Empty)')!;
    expect(empty.label).toBe(literal.label);
    expect(empty.key).not.toBe(literal.key);
    const a = tree.children.find((group) => group.label === 'a')!;
    expect(a.rowCount).toBe(2);
    expect(rowsForGroup(dataset, a.path)).toEqual([
      ['a', '6'],
      [' a ', '7'],
    ]);
    expect(rowsForGroup(dataset, [])).toEqual(dataset.rows);
    expect(() => rowsForGroup(dataset, [{ columnId: 'absent', value: 'x' }])).toThrow(
      'invalid CSV column',
    );
  });

  it('supports root-only summaries and rejects invalid configuration or excessive group cardinality', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    expect(groupCsv(dataset, { ...config, levels: [] }).children).toEqual([]);
    expect(() => validateAnalysis(dataset, { ...config, levels: ['c0', 'c0'] })).toThrow(
      'unique existing',
    );
    expect(() =>
      validateAnalysis(dataset, {
        ...config,
        metrics: [{ id: 'x', operation: 'sum', columnId: 'missing' }],
      }),
    ).toThrow('existing column');
    expect(() => validateAnalysis(dataset, { ...config, metrics: [] })).toThrow('Choose between');
    expect(() =>
      validateAnalysis(dataset, { ...config, metrics: [config.metrics[0], config.metrics[0]] }),
    ).toThrow('unique id');
    const unique = parseCsv(
      'Id\n' + Array.from({ length: 2000 }, (_, index) => index).join('\n'),
      'Ids.csv',
    );
    const tree = groupCsv(unique, defaultAnalysis(unique));
    expect(tree).toMatchObject({ rowCount: 2000, totalChildren: 2000, hiddenChildren: 1950 });
    expect(tree.children).toHaveLength(50);
  });

  it('handles even medians, cancellation and numeric overflow without silently storing Infinity', () => {
    const dataset = parseCsv('Category,Amount\nA,1e16\nA,1\nA,-1e16\nA,3', 'Numbers.csv');
    const config = {
      ...defaultAnalysis(dataset),
      metrics: [
        { id: 'sum', operation: 'sum' as const, columnId: 'c1' },
        { id: 'median', operation: 'median' as const, columnId: 'c1' },
      ],
    };
    const tree = groupCsv(dataset, config);
    expect(value(tree, 'sum')).toBe(4);
    expect(value(tree, 'median')).toBe(2);
    const huge = parseCsv('Category,Amount\nA,1e308\nA,1e308', 'Huge.csv');
    expect(() => groupCsv(huge, config)).toThrow('supported numeric range');
    expect(
      value(
        groupCsv(huge, { ...config, metrics: [{ id: 'avg', operation: 'avg', columnId: 'c1' }] }),
        'avg',
      ),
    ).toBe(1e308);
  });
});

describe('CSV canonical graphs', () => {
  it('preserves the chosen diagram type and grid preference when regenerating an existing analysis', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const graph = csvGraph(dataset, config);
    expect(graph.diagram.settings.grid).toBe(false);
    graph.diagram.type = 'flowchart';
    graph.diagram.settings.grid = true;
    const regenerated = csvGraph(dataset, { ...config, levels: ['c0'] }, graph);
    expect(regenerated.diagram.type).toBe('flowchart');
    expect(regenerated.diagram.settings.grid).toBe(true);
  });

  it('retains edited generated connection properties when groups leave and return to the view', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const graph = csvGraph(dataset, config);
    const north = graph.nodes.find((node) => node.title === 'Nord')!;
    const edge = graph.edges.find((item) => item.targetNodeId === north.id)!;
    Object.assign(edge, {
      label: 'Own label',
      edgeType: 'dependency',
      direction: 'both',
      style: 'dotted',
      description: 'My relationship notes',
    });
    const filtered = csvGraph(
      dataset,
      { ...config, filters: [{ id: 'filter', columnId: 'c0', operation: 'equals', value: 'Syd' }] },
      graph,
    );
    expect(filtered.edges.find((item) => item.id === edge.id)).toEqual(edge);
    const restored = csvGraph(dataset, config, filtered);
    expect(restored.edges.find((item) => item.id === edge.id)).toEqual(edge);
    expect(
      restored.edges.filter(
        (item) =>
          item.sourceNodeId === edge.sourceNodeId && item.targetNodeId === edge.targetNodeId,
      ),
    ).toHaveLength(1);
  });

  it('keeps pasted CSV copies as manual nodes without claiming the generated group identity', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const graph = csvGraph(dataset, config);
    const north = graph.nodes.find((node) => node.title === 'Nord')!;
    const pasted = pasteSelection(copySelection(graph, [north.id]), graph);
    pasted.nodes[0].title = 'My copied regional card';
    const manualEdge = newEdge(dataset.diagramId, pasted.nodes[0].id, north.id, {
      label: 'Copy versus original',
      style: 'dashed',
    });
    graph.nodes.push(...pasted.nodes);
    graph.edges.push(manualEdge);
    const filtered = csvGraph(
      dataset,
      { ...config, filters: [{ id: 'filter', columnId: 'c0', operation: 'equals', value: 'Syd' }] },
      graph,
    );
    expect(filtered.nodes.find((node) => node.id === pasted.nodes[0].id)).toEqual(pasted.nodes[0]);
    expect(getCsvNode(filtered.nodes.find((node) => node.id === north.id)!)?.visible).toBe(false);
    const restored = csvGraph(dataset, config, filtered);
    expect(restored.nodes.find((node) => node.id === pasted.nodes[0].id)).toEqual(pasted.nodes[0]);
    expect(restored.nodes.find((node) => node.id === north.id)?.externalId).toBe(
      getCsvNode(north)!.groupKey,
    );
    expect(restored.edges.find((edge) => edge.id === manualEdge.id)).toEqual(manualEdge);
    expect(() => validateGraph(restored)).not.toThrow();
  });
  it('keeps editable manual connections while groups are filtered out and restored', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const graph = csvGraph(dataset, config);
    const a = graph.nodes.find((node) => node.title === 'Nord')!;
    const b = graph.nodes.find((node) => node.title === 'Syd')!;
    const link = newEdge(dataset.diagramId, a.id, b.id, {
      edgeType: 'relationship',
      direction: 'both',
      style: 'dashed',
      label: 'My comparison',
    });
    graph.edges.push(link);
    const filtered = csvGraph(
      dataset,
      { ...config, filters: [{ id: 'filter', columnId: 'c0', operation: 'equals', value: 'Syd' }] },
      graph,
    );
    expect(filtered.edges.find((edge) => edge.id === link.id)).toEqual(link);
    expect(getCsvNode(filtered.nodes.find((node) => node.id === a.id)!)?.visible).toBe(false);
    const restored = csvGraph(dataset, config, filtered);
    expect(getCsvNode(restored.nodes.find((node) => node.id === a.id)!)?.visible).toBe(true);
    expect(restored.edges.find((edge) => edge.id === link.id)).toEqual(link);
  });
  it('creates valid canonical hierarchy with source data only on the graph and enough height for measures', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const graph = csvGraph(dataset, config);
    expect(graph.diagram.id).toBe(dataset.diagramId);
    expect(graph.diagram.type).toBe('mindmap');
    expect((graph as typeof graph & { dataset: CsvDataset }).dataset).toEqual(dataset);
    expect(getCsvAnalysis(graph)).toEqual(config);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
    expect(
      graph.edges.every((edge) => edge.direction === 'none' && edge.edgeType === 'hierarchy'),
    ).toBe(true);
    for (const node of graph.nodes) {
      const data = getCsvNode(node)!;
      expect(data.datasetId).toBe(dataset.id);
      expect(node.externalId).toBe(data.groupKey);
      expect(node.height).toBeGreaterThanOrEqual(76 + config.metrics.length * 20);
      expect(node.width).toBe(280);
      expect(JSON.stringify(node.metadata)).not.toContain('Line one');
      expect(node.metadata).not.toHaveProperty('rows');
    }
    expect(() => validateGraph(graph)).not.toThrow();
    const left = graph.nodes.filter((node) => node.parentId === graph.nodes[0].id);
    expect(left.some((node) => node.x < graph.nodes[0].x)).toBe(true);
    expect(left.some((node) => node.x > graph.nodes[0].x)).toBe(true);
  });

  it('regroups while retaining identities, edits, manual nodes, surviving cross-links and column visibility', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const config = analysis(dataset);
    const graph = csvGraph(dataset, config);
    const north = graph.nodes.find((node) => node.title === 'Nord')!;
    const south = graph.nodes.find((node) => node.title === 'Syd')!;
    const removed = graph.nodes.find((node) => node.title === 'A')!;
    Object.assign(north, {
      title: 'My regional summary',
      x: 777,
      y: 333,
      width: 420,
      height: 500,
      color: '#abcdef',
      collapsed: true,
      notes: 'Keep my comment',
    });
    const csv = getCsvNode(north)!;
    north.metadata.csv = { ...csv, hiddenMetricIds: ['avg'], displayColumns: ['c3'] };
    graph.diagram.metadata = { userComment: 'Keep this diagram comment' };
    const manual = newNode(dataset.diagramId, {
      title: 'My annotation',
      parentId: removed.id,
      x: 123,
    });
    graph.nodes.push(manual);
    const crossLink = newEdge(dataset.diagramId, north.id, south.id, { label: 'Compare regions' });
    const survivingLink = newEdge(dataset.diagramId, manual.id, north.id);
    const obsoleteLink = newEdge(dataset.diagramId, manual.id, removed.id);
    graph.edges.push(crossLink, survivingLink, obsoleteLink);
    const regenerated = csvGraph(dataset, { ...config, levels: ['c0'] }, graph);
    const retained = regenerated.nodes.find((node) => node.id === north.id)!;
    expect(retained).toMatchObject({
      title: north.title,
      x: 777,
      y: 333,
      width: 420,
      height: 500,
      color: '#abcdef',
      collapsed: true,
      notes: north.notes,
    });
    expect(getCsvNode(retained)).toMatchObject({
      hiddenMetricIds: ['avg'],
      displayColumns: ['c3'],
    });
    expect(regenerated.diagram.metadata).toEqual(graph.diagram.metadata);
    expect(regenerated.nodes.find((node) => node.id === manual.id)).toMatchObject({
      title: manual.title,
      x: 123,
      parentId: removed.id,
    });
    expect(regenerated.edges).toEqual(expect.arrayContaining([crossLink, survivingLink]));
    expect(regenerated.edges.some((edge) => edge.id === obsoleteLink.id)).toBe(true);
    expect(getCsvNode(regenerated.nodes.find((node) => node.id === removed.id)!)?.visible).toBe(
      false,
    );
    expect(() => validateGraph(regenerated)).not.toThrow();
  });

  it('rejects malformed CSV metadata through defensive getters', () => {
    const dataset = parseCsv(source, 'Revenue.csv');
    const graph = csvGraph(dataset, analysis(dataset));
    const node = graph.nodes[0];
    const data = getCsvNode(node)!;
    expect(() => validateCsvNode({ ...data, groupKey: 'wrong' })).toThrow('group path');
    expect(() =>
      validateCsvNode({ ...data, suppressParentConnection: 'yes' as unknown as boolean }),
    ).toThrow('parent connection preference');
    expect(getCsvNode({ ...node, metadata: { csv: { ...data, rowCount: -1 } } })).toBeUndefined();
    expect(
      getCsvAnalysis({
        ...graph,
        diagram: { ...graph.diagram, settings: { csvAnalysis: {} as CsvAnalysis } },
      }),
    ).toBeUndefined();
  });
});

describe('large CSV exploration and cleaning', () => {
  it('reserves every top-level page entry before expanding deeper groups within the 600-node budget', () => {
    const dataset = parseCsv(
      'Customer,Product,Amount\n' +
        Array.from(
          { length: 100000 },
          (_, index) => `Customer${Math.floor(index / 50)},P${index % 50},1`,
        ).join('\n'),
      'Many products.csv',
    );
    const config: CsvAnalysis = {
      ...defaultAnalysis(dataset),
      levels: ['c0', 'c1'],
      metrics: [
        { id: 'count', operation: 'count' },
        { id: 'sum', operation: 'sum', columnId: 'c2' },
      ],
      limit: 50,
    };
    const tree = groupCsv(dataset, config);
    expect(tree).toMatchObject({ rowCount: 100000, totalChildren: 2000, hiddenChildren: 1950 });
    expect(value(tree, 'sum')).toBe(100000);
    expect(tree.children).toHaveLength(50);
    const countNodes = (group: CsvGroup): number =>
      1 + group.children.reduce((count, child) => count + countNodes(child), 0);
    expect(countNodes(tree)).toBe(csvLimits.groups);
    expect(tree.children.some((group) => group.hiddenChildren > 0)).toBe(true);
    for (const child of tree.children) {
      expect(child.rowCount).toBe(50);
      expect(value(child, 'sum')).toBe(50);
      expect(child.totalChildren).toBe(50);
      expect(child.hiddenChildren).toBe(50 - child.children.length);
    }
    const next = groupCsv(dataset, { ...config, offset: 50 });
    expect(next.children).toHaveLength(50);
    const firstKeys = new Set(tree.children.map((group) => group.key));
    expect(next.children.every((group) => !firstKeys.has(group.key))).toBe(true);
    const last = tree.children.at(-1)!;
    expect(last.children).toHaveLength(0);
    const focused = groupCsv(dataset, { ...config, focusPath: last.path });
    expect(focused).toMatchObject({ rowCount: 50, totalChildren: 50, hiddenChildren: 0 });
    expect(focused.children).toHaveLength(50);
    expect(value(focused, 'sum')).toBe(50);
  }, 15000);

  it('analyzes 100,000 source rows across 2,000 customers with bounded views and exact full-data measures', () => {
    const text =
      'Customer,Product,Amount\n' +
      Array.from({ length: 100000 }, (_, index) => `AAA${index % 2000},P${index % 3},1`).join('\n');
    const dataset = parseCsv(text, 'Large.csv');
    const config: CsvAnalysis = {
      ...defaultAnalysis(dataset),
      levels: ['c0', 'c1'],
      metrics: [
        { id: 'count', operation: 'count' },
        { id: 'sum', operation: 'sum', columnId: 'c2' },
      ],
      filters: [{ id: 'prefix', columnId: 'c0', operation: 'startsWith', value: 'AAA' }],
      limit: 50,
    };
    const tree = groupCsv(dataset, config);
    expect(tree.rowCount).toBe(100000);
    expect(value(tree, 'sum')).toBe(100000);
    expect(tree.totalChildren).toBe(2000);
    expect(tree.hiddenChildren).toBe(1950);
    expect(
      tree.children.every((group) => group.rowCount === 50 && value(group, 'sum') === 50),
    ).toBe(true);
    const countNodes = (group: CsvGroup): number =>
      1 + group.children.reduce((count, child) => count + countNodes(child), 0);
    expect(countNodes(tree)).toBeLessThanOrEqual(csvLimits.groups);
    const next = groupCsv(dataset, { ...config, offset: 50 });
    expect(next.children[0].key).not.toBe(tree.children[0].key);
    const focused = groupCsv(dataset, { ...config, focusPath: tree.children[0].path, offset: 0 });
    expect(focused).toMatchObject({ path: tree.children[0].path, rowCount: 50, totalChildren: 3 });
    expect(previewCsvRowsSync(dataset, config, [], 5)).toMatchObject({ total: 100000 });
    expect(previewCsvRowsSync(dataset, config, [], 5).rows).toHaveLength(5);
  }, 15000);

  it('applies prefix cleaning consistently to grouping, filters, distinct measures and source previews', () => {
    const dataset = parseCsv(
      'Customer;Amount\n310293 - Företag;12,50\n9223 – Företag;12.50\n12 — Annat;1.234,56\n13 - Annat;1,234.56\n14 - Third;1.234',
      'Excel.csv',
    );
    const config: CsvAnalysis = {
      ...defaultAnalysis(dataset),
      columnRules: [
        { columnId: 'c0', pattern: '^\\s*\\d+\\s*[-–—]\\s*', replacement: '', trim: true },
        { columnId: 'c1', numberFormat: 'auto' },
      ],
      metrics: [
        { id: 'sum', operation: 'sum', columnId: 'c1' },
        { id: 'distinct', operation: 'distinct', columnId: 'c0' },
      ],
    };
    const tree = groupCsv(dataset, config);
    expect(tree.children).toHaveLength(3);
    expect(value(tree, 'sum')).toBeCloseTo(2494.12);
    expect(value(tree, 'distinct')).toBe(3);
    const company = tree.children.find((group) => group.label === 'Företag')!;
    expect(value(company, 'sum')).toBe(25);
    const filtered = {
      ...config,
      filters: [{ id: 'f', columnId: 'c0', operation: 'startsWith' as const, value: 'Före' }],
    };
    expect(groupCsv(dataset, filtered).rowCount).toBe(2);
    const preview = previewCsvRowsSync(dataset, filtered);
    expect(preview.rows[0][0]).toBe('Företag');
    expect(preview.originalRows[0][0]).toBe('310293 - Företag');
    expect(dataset.rows[0][0]).toBe('310293 - Företag');
    expect(profileCsv(dataset, '.', config)[1]).toMatchObject({
      numericCount: 4,
      invalidCount: 1,
      ambiguousCount: 1,
    });
    expect(csvFormattedNumber('1.234', 'auto')).toBeNull();
    expect(csvFormattedNumber('1.234', 'dot')).toBe(1.234);
    expect(csvFormattedNumber('1.234', 'comma')).toBe(1234);
    expect(csvFormattedNumber('1 234,56', 'auto')).toBe(1234.56);
    expect(() =>
      validateAnalysis(dataset, { ...config, columnRules: [{ columnId: 'c0', pattern: '[' }] }),
    ).toThrow('Invalid cleaning pattern');
    expect(() =>
      validateAnalysis(dataset, { ...config, columnRules: [{ columnId: 'c0', flags: 'gg' }] }),
    ).toThrow('flags');
  });
});

describe('CSV worker orchestration', () => {
  it('caches raw source, cancels stale analysis, transfers only small graphs and restarts after a watchdog timeout', async () => {
    vi.useFakeTimers();
    const instances: MockWorker[] = [];
    class MockWorker {
      messages: CsvWorkerRequest[] = [];
      onmessage?: (event: {
        data: { id: number; result?: unknown; error?: { name: string; message: string } };
      }) => void;
      onerror?: (event: { message: string }) => void;
      terminate = vi.fn();
      constructor() {
        instances.push(this);
      }
      postMessage(message: CsvWorkerRequest) {
        this.messages.push(message);
      }
      respond(id: number, result: unknown) {
        this.onmessage?.({ data: { id, result } });
      }
      cacheExpired(id: number) {
        this.onmessage?.({
          data: {
            id,
            error: { name: 'Error', message: 'CSV source cache expired. Reopen the dataset.' },
          },
        });
      }
    }
    vi.stubGlobal('Worker', MockWorker);
    try {
      const dataset = parseCsv(source, 'Worker.csv');
      const config = analysis(dataset);
      const graph = csvGraph(dataset, config);
      const obsolete = analyzeCsv(dataset, config).catch((error: Error) => error.name);
      const current = analyzeCsv(dataset, config, graph);
      const worker = instances[0];
      expect(await obsolete).toBe('AbortError');
      expect(worker.messages[0].dataset).toBe(dataset);
      expect(worker.messages[1].dataset).toBeUndefined();
      expect(worker.messages[1].previous?.dataset).toBeUndefined();
      worker.respond(worker.messages[1].id, { ...graph, dataset: undefined });
      expect((await current).dataset).toBe(dataset);
      const profiles = profileCsvAsync(dataset, '.', config);
      const request = worker.messages.at(-1)!;
      expect(request.dataset).toBeUndefined();
      worker.respond(request.id, profileCsv(dataset, '.', config));
      expect(await profiles).toHaveLength(4);
      const cacheRace = previewCsvRows(dataset, config);
      const beforeRetry = worker.messages.length;
      worker.cacheExpired(worker.messages.at(-1)!.id);
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.messages).toHaveLength(beforeRetry + 1);
      expect(worker.messages.at(-1)!.dataset).toBe(dataset);
      const preview = previewCsvRowsSync(dataset, config);
      worker.respond(worker.messages.at(-1)!.id, preview);
      expect(await cacheRace).toEqual(preview);
      const timedOut = previewCsvRows(dataset, config).catch((error: Error) => error.message);
      const alsoPending = profileCsvAsync(dataset, '.').catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(10001);
      expect(await timedOut).toContain('longer than 10 seconds');
      expect(await alsoPending).toContain('longer than 10 seconds');
      expect(worker.terminate).toHaveBeenCalledOnce();
      const retried = profileCsvAsync(dataset, '.');
      const fresh = instances[1];
      expect(fresh.messages[0].dataset).toBe(dataset);
      fresh.respond(fresh.messages[0].id, []);
      expect(await retried).toEqual([]);
      // Close the persistent mock so the following tests cannot inherit it.
      fresh.onerror?.({ message: 'fixture cleanup' });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
