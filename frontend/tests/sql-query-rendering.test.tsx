import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CanvasNode } from '../src/canvas/projection';
import { Properties } from '../src/components/Properties';
import {
  SqlQueryDetails,
  SqlQueryRelationshipDetails,
  SqlQuerySummary,
} from '../src/components/SqlQuerySummary';
import { blankGraph, newEdge, newNode, type GraphNode } from '../src/model/types';
import { nodeTypes } from '../src/nodes/registry';
import type { SqlQueryResult, SqlQuerySource } from '../src/sql/query-schema';
import { useEditor } from '../src/state/editor';

const viewport = vi.hoisted(() => ({ zoom: 1 }));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
  NodeResizer: () => null,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, viewport.zoom] }),
}));

beforeEach(() => {
  viewport.zoom = 1;
  useEditor.getState().setGraph(null);
});

function query(count = 14): SqlQueryResult {
  return {
    version: 1,
    scope: 'query_1',
    name: 'Query result',
    distinct: true,
    columns: Array.from({ length: count }, (_, index) => ({
      ordinal: index + 1,
      name: `result_${index + 1}`,
      alias: `result_${index + 1}`,
      expression:
        index === 0
          ? 'CASE WHEN b.active = 1 THEN SUM(b.amount::string::decimal) ELSE 0 END'
          : `b.column_${index + 1}`,
      references: [
        {
          scope: 'query_1',
          sourceAlias: 'b',
          column: `column_${index + 1}`,
          resolution: 'resolved',
        },
      ],
      ...(index === 1 ? { duplicateAlias: true } : {}),
    })),
    clauses: {
      where: "b.country = 'NO' AND (b.active = 1 OR b.booked = 1)",
      groupBy: 'b.id',
      having: 'SUM(b.amount) > 0',
      orderBy: 'b.id DESC',
      limit: '100',
    },
  };
}
function source(alias = 'b'): SqlQuerySource {
  return {
    version: 1,
    scope: 'query_1',
    alias,
    kind: 'table',
    qualifiedName: ['VERUM_DBT', 'STAGING', 'BUSINESS'],
    columns: Array.from({ length: 14 }, (_, index) => `column_${index + 1}`),
  };
}
function node(metadata: GraphNode['metadata'] = { sqlQueryResult: query() }): GraphNode {
  return newNode('diagram', {
    title: 'Query result',
    nodeType: 'output',
    color: '#965de1',
    status: 'done',
    metadata: { visualNerve: { icon: 'technology' }, ...metadata },
  });
}

it('bounds query previews while showing DISTINCT, expressions, duplicate names and filters', () => {
  render(<SqlQuerySummary node={node()} />);
  const outputs = screen.getByRole('table', { name: 'SQL query output' });
  expect(within(outputs).getAllByRole('row')).toHaveLength(13);
  expect(screen.getByText('SELECT DISTINCT')).toBeVisible();
  expect(screen.getByText('14 outputs')).toBeVisible();
  expect(within(outputs).getByText(/CASE WHEN b.active/)).toBeVisible();
  expect(within(outputs).getByText('· duplicate name')).toBeVisible();
  expect(within(outputs).queryByText('result_13')).toBeNull();
  expect(screen.getByText('+2 more outputs · inspect Properties')).toBeVisible();
  expect(screen.getByText("b.country = 'NO' AND (b.active = 1 OR b.booked = 1)")).toBeVisible();
  expect(screen.getByText('GROUP BY')).toBeVisible();
});

it('keeps aliases separate and calls source columns observed references rather than schema definitions', () => {
  const first = node({ sqlQuerySource: source() });
  const second = node({ sqlQuerySource: source('invoice_org') });
  const { rerender } = render(<SqlQuerySummary node={first} />);
  expect(screen.getByText('b')).toBeVisible();
  expect(screen.getByText('VERUM_DBT.STAGING.BUSINESS')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Referenced SQL columns' }).children).toHaveLength(12);
  expect(screen.getByText('+2 more referenced columns')).toBeVisible();
  expect(screen.getByText('Referenced columns · schema types unknown')).toBeVisible();
  rerender(<SqlQuerySummary node={second} />);
  expect(screen.getByText('invoice_org')).toBeVisible();
  expect(screen.queryByText('b')).toBeNull();
  expect(first.metadata.sqlQuerySource).not.toBe(second.metadata.sqlQuerySource);
});

it('renders query fronts with ordinary color, icon and status in overview exports', () => {
  const value = node();
  const Component = nodeTypes.output as ComponentType<NodeProps<CanvasNode>>;
  const props = (exporting = false): NodeProps<CanvasNode> => ({
    id: value.id,
    type: 'output',
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: value.x,
    positionAbsoluteY: value.y,
    data: { node: value, owners: [], childCount: 0, exporting },
  });
  const { container, rerender } = render(<Component {...props()} />);
  expect(screen.getByRole('table', { name: 'SQL query output' })).toBeVisible();
  expect(screen.getByRole('img', { name: 'Status: Done' })).toBeVisible();
  expect(container.querySelector('[data-area-icon="technology"]')).toBeInTheDocument();
  expect(screen.getByTestId('graph-node').style.getPropertyValue('--node-accent')).toBe('#965de1');
  viewport.zoom = 0.1;
  rerender(<Component {...props()} />);
  expect(screen.queryByRole('table', { name: 'SQL query output' })).toBeNull();
  rerender(<Component {...props(true)} />);
  expect(screen.getByRole('table', { name: 'SQL query output' })).toBeVisible();
  expect(container.querySelector('[data-area-icon="technology"]')).toBeInTheDocument();
});

it('pages complete output expressions and column lineage and resets pagination when selecting another query', () => {
  const large = query(250);
  large.columns[249].expression = '<img src=x onerror=alert(1)>';
  large.columns[249].references[0].resolution = 'ambiguous';
  const value = node({ sqlQueryResult: large });
  const { container, rerender } = render(<SqlQueryDetails node={value} />);
  const outputs = () => screen.getByRole('table', { name: 'All SQL query output' });
  expect(within(outputs()).getAllByRole('row')).toHaveLength(101);
  expect(screen.getByLabelText('SQL query column range')).toHaveTextContent('Columns 1–100 of 250');
  expect(screen.getByRole('button', { name: 'Previous columns' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next columns' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next columns' }));
  expect(within(outputs()).getAllByRole('row')).toHaveLength(51);
  expect(within(outputs()).getByText('result_250')).toBeVisible();
  expect(within(outputs()).getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(within(outputs()).getByText('ambiguous')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Next columns' })).toBeDisabled();
  expect(value.metadata.sqlQueryResult).toBe(large);
  rerender(<SqlQueryDetails node={node({ sqlQueryResult: query(120) })} />);
  expect(screen.getByLabelText('SQL query column range')).toHaveTextContent('Columns 1–100 of 120');
});

it('inspects derived query source aliases and pages referenced columns in Properties', () => {
  const graph = blankGraph('Query', 'mindmap');
  const derived: SqlQuerySource = {
    ...source('inv_tmp'),
    kind: 'derived',
    qualifiedName: [],
    queryScope: 'query_1/inv_tmp',
  };
  derived.columns = Array.from({ length: 101 }, (_, index) => `field_${index + 1}`);
  const value = newNode(graph.diagram.id, {
    ...node({ sqlQuerySource: derived }),
    diagramId: graph.diagram.id,
  });
  graph.nodes.push(value);
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([value.id]);
  render(<Properties />);
  const section = screen.getByRole('region', { name: 'SQL query details' });
  expect(within(section).getByText('Derived query')).toBeVisible();
  expect(within(section).getByText('inv_tmp')).toBeVisible();
  expect(within(section).getByText('query_1/inv_tmp')).toBeVisible();
  expect(
    within(section).getByRole('list', { name: 'All referenced SQL columns' }).children,
  ).toHaveLength(100);
  fireEvent.click(within(section).getByRole('button', { name: 'Next columns' }));
  expect(within(section).getByText('field_101')).toBeVisible();
  expect(useEditor.getState().graph).toBe(graph);
});

it('shows complete LEFT JOIN conditions and preserves the normal editable connection controls', () => {
  const graph = blankGraph('Query');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'b' }),
    newNode(graph.diagram.id, { title: 'invoice_org' }),
  ];
  const condition =
    "regexp_replace(b.org_nr, '[^0-9]', '') = invoice_org.org_nr::string AND invoice_org.country = 'NO'";
  const edge = newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
    edgeType: 'sql-join',
    metadata: {
      sqlQueryRelationship: {
        version: 1,
        scope: 'query_1',
        kind: 'join',
        joinType: 'LEFT JOIN',
        condition,
        references: [
          {
            scope: 'query_1',
            sourceAlias: 'invoice_org',
            column: 'org_nr',
            resolution: 'resolved',
          },
        ],
      },
    },
  });
  graph.edges.push(edge);
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([], [edge.id]);
  render(<Properties />);
  const section = screen.getByRole('region', { name: 'SQL join' });
  expect(within(section).getByText('LEFT JOIN')).toBeVisible();
  expect(within(section).getByText(condition)).toBeVisible();
  expect(within(section).getByText('invoice_org.org_nr')).toBeVisible();
  expect(screen.getByLabelText('Relationship type')).toHaveValue('sql-join');
  expect(screen.getByLabelText('Connection source')).toHaveValue(graph.nodes[0].id);
  expect(useEditor.getState().graph).toBe(graph);
});

it('explains column lineage connections with output positions and unresolved references', () => {
  const edge = newEdge('diagram', 'a', 'result', {
    metadata: {
      sqlQueryRelationship: {
        version: 1,
        scope: 'query_1',
        kind: 'lineage',
        outputOrdinals: [1, 8],
        references: [{ column: 'id', resolution: 'unresolved' }],
      },
    },
  });
  render(<SqlQueryRelationshipDetails edge={edge} />);
  expect(screen.getByText('lineage')).toBeVisible();
  expect(screen.getByText('1, 8')).toBeVisible();
  expect(screen.getByText('unresolved')).toBeVisible();
});

it.each([null, 'custom query note', {}, { ...query(), columns: [{ name: 'invalid' }] }])(
  'ignores malformed reserved query metadata %j without crashing',
  (sqlQueryResult) => {
    const { container } = render(
      <>
        <SqlQuerySummary node={node({ sqlQueryResult })} />
        <SqlQueryDetails node={node({ sqlQueryResult })} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  },
);
