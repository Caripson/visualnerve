import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CanvasNode } from '../src/canvas/projection';
import { Properties } from '../src/components/Properties';
import {
  SqlRelationshipDetails,
  SqlTableDetails,
  SqlTableSummary,
} from '../src/components/SqlTableSummary';
import { blankGraph, newEdge, newNode, type GraphNode } from '../src/model/types';
import { nodeTypes } from '../src/nodes/registry';
import type { SqlTable } from '../src/sql/schema';
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

function table(): SqlTable {
  return {
    version: 1,
    name: 'accounts',
    qualifiedName: ['app', 'accounts'],
    columns: Array.from({ length: 14 }, (_, index) => ({
      name: index === 0 ? 'tenant_id' : index === 1 ? 'account_id' : `field_${index + 1}`,
      dataType: index < 2 ? 'bigint' : 'varchar(255)',
      primaryKey: index < 2,
      foreignKey: index === 0,
      nullable: index > 2,
      unique: index === 2,
    })),
    primaryKey: ['tenant_id', 'account_id'],
    uniqueKeys: [['tenant_id', 'field_3']],
  };
}

function node(sqlTable: unknown = table()): GraphNode {
  return newNode('diagram', {
    title: 'app.accounts',
    nodeType: 'database',
    color: '#965de1',
    status: 'done',
    width: 340,
    height: 384,
    metadata: { sqlTable },
  });
}

it('shows at most twelve columns with types, key/nullability rules and an explicit overflow count', () => {
  render(<SqlTableSummary node={node()} />);
  const columns = screen.getByRole('table', { name: 'SQL table columns' });
  expect(within(columns).getAllByRole('row')).toHaveLength(13);
  const first = within(columns).getByRole('rowheader', { name: 'tenant_id' }).closest('tr')!;
  expect(within(first).getByText('bigint')).toBeVisible();
  expect(within(first).getByText('PK')).toHaveAttribute('title', 'Primary key');
  expect(within(first).getByText('FK')).toHaveAttribute('title', 'Foreign key');
  expect(within(first).getByText('NN')).toHaveAttribute('title', 'Not null');
  expect(within(columns).getByText('UQ')).toHaveAttribute('title', 'Unique');
  expect(within(columns).getAllByText('?').length).toBeGreaterThan(0);
  expect(within(columns).queryByText('field_13')).toBeNull();
  expect(screen.getByText('+2 more columns')).toBeVisible();
});

it('uses the ordinary renderer with status/color and includes the table in image exports at overview zoom', () => {
  const value = node();
  const Component = nodeTypes.database as ComponentType<NodeProps<CanvasNode>>;
  const props = (exporting = false): NodeProps<CanvasNode> => ({
    id: value.id,
    type: 'database',
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
  const { rerender } = render(<Component {...props()} />);
  expect(screen.getByRole('table', { name: 'SQL table columns' })).toBeVisible();
  expect(screen.getByRole('img', { name: 'Status: Done' })).toBeVisible();
  expect(screen.getByTestId('graph-node').style.getPropertyValue('--node-accent')).toBe('#965de1');
  viewport.zoom = 0.15;
  rerender(<Component {...props()} />);
  expect(screen.queryByRole('table', { name: 'SQL table columns' })).toBeNull();
  expect(screen.getByText('app.accounts')).toBeVisible();
  rerender(<Component {...props(true)} />);
  expect(screen.getByRole('table', { name: 'SQL table columns' })).toBeVisible();
});

it('lists the complete schema and composite keys in Properties even after switching diagram modes', () => {
  const graph = blankGraph('Schema', 'mindmap');
  const schema = table();
  schema.columns[13].name = '<img src=x onerror=alert(1)>';
  const value = newNode(graph.diagram.id, { ...node(schema), diagramId: graph.diagram.id });
  graph.nodes.push(value);
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([value.id]);
  const { container } = render(<Properties />);
  const section = screen.getByRole('region', { name: 'SQL table schema' });
  const columns = within(section).getByRole('table', { name: 'All SQL columns' });
  expect(within(columns).getAllByRole('row')).toHaveLength(15);
  expect(within(columns).getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
  expect(within(section).getByText('(tenant_id, account_id)')).toBeVisible();
  expect(within(section).getByText('(tenant_id, field_3)')).toBeVisible();
  expect(within(columns).getAllByText('Primary key')).toHaveLength(2);
  expect(within(columns).getByText('Foreign key')).toBeVisible();
  expect(within(columns).getAllByText('Nullable').length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Node type')).toHaveValue('database');
  expect(useEditor.getState().graph).toBe(graph);
});

it('explains missing external definitions without pretending their columns or keys are known', () => {
  const external: SqlTable = {
    version: 1,
    name: 'customers',
    qualifiedName: ['external', 'customers'],
    columns: [],
    primaryKey: [],
    uniqueKeys: [],
    external: true,
  };
  const { rerender } = render(<SqlTableSummary node={node(external)} />);
  expect(screen.getByText('External table · definition missing')).toBeVisible();
  expect(screen.queryByRole('table')).toBeNull();
  rerender(<SqlTableDetails node={node(external)} />);
  expect(screen.getByText(/columns and keys were not supplied/)).toBeVisible();
  expect(screen.queryByText('None declared')).toBeNull();
});

it('pages a large schema without mounting every column and resets the page for another table', () => {
  const schema = table();
  schema.columns = Array.from({ length: 250 }, (_, index) => ({
    ...schema.columns[0],
    name: `column_${index + 1}`,
  }));
  const value = node(schema);
  const { rerender } = render(<SqlTableDetails node={value} />);
  const columns = () => screen.getByRole('table', { name: 'All SQL columns' });
  expect(within(columns()).getAllByRole('row')).toHaveLength(101);
  expect(screen.getByLabelText('SQL column range')).toHaveTextContent('Columns 1–100 of 250');
  expect(within(columns()).getByText('column_1')).toBeVisible();
  expect(within(columns()).queryByText('column_250')).toBeNull();
  expect(screen.getByRole('button', { name: 'Previous columns' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next columns' }));
  expect(screen.getByLabelText('SQL column range')).toHaveTextContent('Columns 101–200 of 250');
  fireEvent.click(screen.getByRole('button', { name: 'Next columns' }));
  expect(within(columns()).getAllByRole('row')).toHaveLength(51);
  expect(within(columns()).getByText('column_250')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next columns' })).toBeDisabled();
  expect(value.metadata.sqlTable).toBe(schema);
  expect(schema.columns).toHaveLength(250);
  rerender(<SqlTableDetails node={node({ ...schema, name: 'other' })} />);
  expect(screen.getByLabelText('SQL column range')).toHaveTextContent('Columns 1–100 of 250');
  rerender(
    <SqlTableDetails
      node={node({ ...schema, external: true, columns: [], primaryKey: [], uniqueKeys: [] })}
    />,
  );
  expect(screen.getByText(/definition missing/)).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'SQL column pages' })).toBeNull();
});

it.each([null, 'custom SQL note', {}, { ...table(), columns: [{ name: 'broken' }] }])(
  'ignores malformed reserved metadata %j without crashing',
  (sqlTable) => {
    const { container } = render(
      <>
        <SqlTableSummary node={node(sqlTable)} />
        <SqlTableDetails node={node(sqlTable)} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  },
);

it('shows FK column pairs and referential actions while retaining ordinary connection controls', () => {
  const graph = blankGraph('Schema');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Child' }),
    newNode(graph.diagram.id, { title: 'Parent' }),
  ];
  const edge = newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
    edgeType: 'foreign-key',
    metadata: {
      sqlRelationship: {
        version: 1,
        name: 'fk_tenant_account',
        columns: ['tenant_id', 'account_id'],
        referencedColumns: ['tenant', 'id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    },
  });
  graph.edges.push(edge);
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([], [edge.id]);
  render(<Properties />);
  const section = screen.getByRole('region', { name: 'SQL foreign key' });
  expect(within(section).getByText('tenant_id → tenant')).toBeVisible();
  expect(within(section).getByText('account_id → id')).toBeVisible();
  expect(within(section).getByText('CASCADE')).toBeVisible();
  expect(within(section).getByText('NO ACTION')).toBeVisible();
  expect(
    within(section).getByText(/child table \(source\) to the parent table \(target\)/),
  ).toBeVisible();
  expect(screen.getByLabelText('Relationship type')).toHaveValue('foreign-key');
  expect(screen.getByLabelText('Connection source')).toHaveValue(graph.nodes[0].id);
  expect(screen.getByLabelText('Connection target')).toHaveValue(graph.nodes[1].id);
  expect(useEditor.getState().graph).toBe(graph);
});

it('labels unresolved external foreign-key columns as unknown rather than real question-mark identifiers', () => {
  const edge = newEdge('diagram', 'child', 'parent', {
    edgeType: 'foreign-key',
    metadata: {
      sqlRelationship: {
        version: 1,
        columns: ['account_id'],
        referencedColumns: ['?'],
        unresolved: true,
      },
    },
  });
  render(<SqlRelationshipDetails edge={edge} />);
  expect(screen.getByText(/Referenced columns unknown/)).toBeVisible();
  expect(screen.getByText('account_id → Unknown referenced column')).toBeVisible();
  expect(screen.queryByText('account_id → ?')).toBeNull();
});
