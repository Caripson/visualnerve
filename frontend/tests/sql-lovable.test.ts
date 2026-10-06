import { expect, it } from 'vitest';
import { buildLovablePrompt } from '../src/export/lovable';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import type { SqlTable } from '../src/sql/schema';

function records(text: string): Record<string, any>[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function schema(name: string): SqlTable {
  return {
    version: 1,
    name,
    qualifiedName: ['app', name],
    columns: [
      {
        name: 'tenant',
        dataType: 'bigint',
        nullable: false,
        primaryKey: true,
        foreignKey: true,
        unique: false,
      },
      {
        name: 'id',
        dataType: 'uuid',
        nullable: false,
        primaryKey: true,
        foreignKey: false,
        unique: false,
      },
      {
        name: 'email',
        dataType: 'varchar(255)',
        nullable: true,
        primaryKey: false,
        foreignKey: false,
        unique: true,
      },
    ],
    primaryKey: ['tenant', 'id'],
    uniqueKeys: [['tenant', 'email'], ['email']],
  };
}

function fixture() {
  const graph = blankGraph('Application data model');
  const parent = newNode(graph.diagram.id, {
    title: 'accounts',
    nodeType: 'database',
    metadata: { sqlTable: schema('accounts'), arbitrary: 'secret-parent-metadata' },
  });
  const childTable = schema('orders');
  const child = newNode(graph.diagram.id, {
    title: 'orders',
    nodeType: 'database',
    metadata: {
      sqlTable: {
        ...childTable,
        columns: childTable.columns.map((column) => ({
          ...column,
          defaultLiteral: 'secret-default',
        })),
        rawSql: 'secret-create-table-script',
        rows: [['secret-inserted-data']],
      },
      connectionString: 'secret-database-credentials',
    },
  });
  graph.nodes = [child, parent];
  graph.edges = [
    newEdge(graph.diagram.id, child.id, parent.id, {
      edgeType: 'foreign-key',
      direction: 'forward',
      label: 'Order account',
      metadata: {
        sqlRelationship: {
          version: 1,
          columns: ['tenant', 'account_id'],
          referencedColumns: ['tenant', 'id'],
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
          name: 'fk_order_account',
          rawSql: 'secret-alter-table-script',
        },
        secret: 'secret-edge-metadata',
      },
    }),
  ];
  return { graph, child, parent };
}

it('includes whitelisted columns/composite keys and exact FK pairs/actions without SQL data or secret metadata', () => {
  const { graph } = fixture();
  const result = buildLovablePrompt(graph, 'Build an order management app.', { scope: 'diagram' });
  const items = records(result.text);
  const table = items.find((record) => record.ref === 'n1')!.sqlTable;
  expect(table).toEqual({
    name: 'orders',
    qualifiedName: ['app', 'orders'],
    columns: schema('orders').columns,
    primaryKey: ['tenant', 'id'],
    uniqueKeys: [['tenant', 'email'], ['email']],
    external: false,
  });
  expect(items.find((record) => record.ref === 'e1')).toMatchObject({
    source: 'n1',
    target: 'n2',
    type: 'foreign-key',
    direction: 'forward',
    sqlForeignKey: {
      columns: ['tenant', 'account_id'],
      referencedColumns: ['tenant', 'id'],
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      name: 'fk_order_account',
    },
  });
  expect(result.text).toContain('not workflow execution order');
  expect(result.text).not.toContain('secret-');
  expect(result.text).not.toContain(graph.nodes[0].id);
});

it('retains selected FK boundary schema as external context without expanding the requested app scope', () => {
  const { graph, child } = fixture();
  const result = buildLovablePrompt(graph, '', { scope: 'selected', selectedIds: [child.id] });
  const items = records(result.text);
  expect(result.nodeCount).toBe(1);
  expect(result.edgeCount).toBe(0);
  expect(result.boundaryCount).toBe(1);
  expect(items.find((record) => record.ref === 'x1')!.sqlTable).toMatchObject({
    name: 'accounts',
    primaryKey: ['tenant', 'id'],
  });
  expect(items.find((record) => record.ref === 'b1')).toMatchObject({
    source: 'n1',
    target: 'x1',
    sqlForeignKey: { referencedColumns: ['tenant', 'id'] },
  });
  expect(result.text).not.toContain('secret-');
});

it('distinguishes missing external table definitions and ignores malformed SQL metadata', () => {
  const graph = blankGraph('Partial schema');
  const external = newNode(graph.diagram.id, {
    title: 'outside',
    nodeType: 'database',
    metadata: {
      sqlTable: {
        version: 1,
        name: 'outside',
        qualifiedName: ['external', 'outside'],
        columns: [],
        primaryKey: [],
        uniqueKeys: [],
        external: true,
      },
    },
  });
  const malformed = newNode(graph.diagram.id, {
    title: 'Notes',
    metadata: { sqlTable: { columns: 'secret-malformed-metadata' } },
  });
  graph.nodes = [external, malformed];
  const result = buildLovablePrompt(graph, '', { scope: 'diagram' });
  const items = records(result.text);
  expect(items.find((record) => record.ref === 'n1')!.sqlTable).toMatchObject({
    external: true,
    columns: [],
    primaryKey: [],
    uniqueKeys: [],
  });
  expect(items.find((record) => record.ref === 'n2')).not.toHaveProperty('sqlTable');
  expect(result.text).toContain('Their columns and keys are unknown');
  expect(result.text).not.toContain('secret-');
});

it('exports unresolved external FK targets as unknown without promoting placeholder question marks to schema', () => {
  const { graph } = fixture();
  graph.nodes[1].metadata.sqlTable = {
    ...schema('accounts'),
    columns: [],
    primaryKey: [],
    uniqueKeys: [],
    external: true,
  };
  graph.edges[0].metadata.sqlRelationship = {
    version: 1,
    columns: ['tenant', 'account_id'],
    referencedColumns: ['?', '?'],
    unresolved: true,
    onDelete: 'CASCADE',
  };
  const result = buildLovablePrompt(graph, '', { scope: 'diagram' });
  const relationship = records(result.text).find((record) => record.ref === 'e1')!.sqlForeignKey;
  expect(relationship).toEqual({
    columns: ['tenant', 'account_id'],
    referencedColumns: null,
    unresolved: true,
    onDelete: 'CASCADE',
  });
  expect(result.text).toContain('Do not treat placeholder question marks as column names');
});
