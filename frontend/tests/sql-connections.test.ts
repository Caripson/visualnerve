import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildLovablePrompt } from '../src/export/lovable';
import { blankGraph, newEdge, newNode, type Graph, type GraphEdge } from '../src/model/types';
import { reconnectedSqlEdge } from '../src/sql/relationships';
import { getSqlRelationship, getSqlTable, type SqlTable } from '../src/sql/schema';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

let db: WorkspaceDatabase;
let repo: Repository;
beforeEach(async () => {
  db = new WorkspaceDatabase(`sql-connections-${crypto.randomUUID()}`);
  repo = new Repository(db);
  await db.initialize();
  useEditor.getState().setGraph(null);
});
afterEach(async () => {
  await db.delete();
});

function table(name: string): SqlTable {
  return {
    version: 1,
    name,
    qualifiedName: ['app', name],
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        nullable: false,
        primaryKey: true,
        foreignKey: false,
        unique: false,
      },
    ],
    primaryKey: ['id'],
    uniqueKeys: [],
  };
}

function fixture(): Graph {
  const graph = blankGraph('Relational schema');
  graph.nodes = ['orders', 'accounts', 'contacts'].map((name) =>
    newNode(graph.diagram.id, {
      title: name,
      nodeType: 'database',
      externalId: name,
      metadata: { sqlTable: table(name), customTable: { retain: true } },
    }),
  );
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      edgeType: 'foreign-key',
      externalId: 'order-account',
      label: 'Account for order',
      description: 'Keep this explanation.',
      direction: 'both',
      style: 'dashed',
      metadata: {
        sqlRelationship: {
          version: 1,
          columns: ['account_id'],
          referencedColumns: ['id'],
          name: 'fk_order_account',
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        custom: { reviewed: true },
      },
    }),
  ];
  return graph;
}

function preserved(previous: GraphEdge, next: GraphEdge) {
  for (const field of [
    'id',
    'externalId',
    'label',
    'description',
    'direction',
    'style',
    'createdAt',
  ] as const)
    expect(next[field]).toEqual(previous[field]);
  expect(next.metadata.custom).toEqual(previous.metadata.custom);
}

it.each(['sourceNodeId', 'targetNodeId'] as const)(
  'turns a UI FK %s reconnect into a user relationship and restores the original constraint with undo/redo',
  (endpoint) => {
    const original = fixture();
    const edge = original.edges[0];
    useEditor.getState().setGraph(original);
    useEditor.getState().updateEdge(edge.id, {
      [endpoint]: original.nodes[2].id,
      metadata: { userNote: 'Preserve this new annotation too.' },
    });
    const reconnected = useEditor.getState().graph!;
    const changed = reconnected.edges[0];
    expect(changed[endpoint]).toBe(original.nodes[2].id);
    expect(changed.edgeType).toBe('relationship');
    expect(getSqlRelationship(changed)).toBeUndefined();
    expect(changed.metadata).not.toHaveProperty('sqlRelationship');
    expect(changed.metadata.userNote).toBe('Preserve this new annotation too.');
    preserved(edge, changed);
    expect(reconnected.nodes).toBe(original.nodes);
    expect(buildLovablePrompt(reconnected, '', { scope: 'diagram' }).text).not.toContain(
      '"sqlForeignKey":',
    );
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(original);
    expect(getSqlRelationship(useEditor.getState().graph!.edges[0])).toEqual(
      getSqlRelationship(edge),
    );
    useEditor.getState().redo();
    expect(useEditor.getState().graph).toEqual(reconnected);
  },
);

it('keeps parsed SQL metadata for a label edit or unchanged endpoints and preserves an explicit custom type on reconnect', () => {
  const original = fixture();
  const edge = original.edges[0];
  useEditor.getState().setGraph(original);
  useEditor.getState().updateEdge(edge.id, {
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    label: 'A clearer constraint label',
  });
  expect(getSqlRelationship(useEditor.getState().graph!.edges[0])).toEqual(
    getSqlRelationship(edge),
  );
  expect(useEditor.getState().graph!.edges[0].edgeType).toBe('foreign-key');
  useEditor.getState().setGraph(original);
  useEditor
    .getState()
    .updateEdge(edge.id, { targetNodeId: original.nodes[2].id, edgeType: 'integration' });
  const changed = useEditor.getState().graph!.edges[0];
  expect(changed.edgeType).toBe('integration');
  expect(changed.metadata).toEqual({ custom: { reviewed: true } });
});

it('leaves ordinary custom metadata under an unrecognized SQL key untouched', () => {
  const original = fixture().edges[0];
  const previous = {
    ...original,
    metadata: { sqlRelationship: { custom: 'unrecognized metadata' } },
  };
  const next = { ...previous, targetNodeId: 'another-target' };
  expect(reconnectedSqlEdge(previous, next)).toBe(next);
});

it.each(['sourceNodeId', 'targetNodeId'] as const)(
  'removes stale constraint metadata through repository PATCH %s without losing schema or user presentation',
  async (endpoint) => {
    const original = await repo.importGraph(fixture());
    const edge = original.edges[0];
    await expect(
      repo.request(`/edges/${edge.id}`, 'PATCH', {
        version: edge.version,
        [endpoint]: 'missing-node',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
    const changed = await repo.request<GraphEdge>(`/edges/${edge.id}`, 'PATCH', {
      version: edge.version,
      [endpoint]: original.nodes[2].id,
      metadata: { userNote: 'API annotation' },
    });
    expect(changed[endpoint]).toBe(original.nodes[2].id);
    expect(changed.edgeType).toBe('relationship');
    expect(changed.metadata).toEqual({ custom: { reviewed: true }, userNote: 'API annotation' });
    preserved(edge, changed);
    const stored = await repo.getGraph(original.diagram.id);
    expect(stored.nodes).toEqual(original.nodes);
    expect(getSqlTable(stored.nodes[0])).toEqual(getSqlTable(original.nodes[0]));
  },
);

it.each(['sourceExternalId', 'targetExternalId'] as const)(
  'handles external-id bulk %s reconnects while retaining same-endpoint constraints',
  async (endpoint) => {
    const original = await repo.importGraph(fixture());
    const edge = original.edges[0];
    const same = await repo.bulk(original.diagram.id, {
      upsert: true,
      edges: [
        {
          externalId: edge.externalId,
          sourceExternalId: 'orders',
          targetExternalId: 'accounts',
          label: 'Edited label',
        },
      ],
    });
    expect(getSqlRelationship(same.edges[0])).toEqual(getSqlRelationship(edge));
    expect(same.edges[0].edgeType).toBe('foreign-key');
    const saved = await repo.bulk(original.diagram.id, {
      upsert: true,
      edges: [
        {
          externalId: edge.externalId,
          [endpoint]: 'contacts',
          metadata: { userNote: 'Bulk annotation' },
          ...(endpoint === 'targetExternalId' ? { edgeType: 'dependency' } : {}),
        },
      ],
    });
    const changed = saved.edges[0];
    expect(changed[endpoint === 'sourceExternalId' ? 'sourceNodeId' : 'targetNodeId']).toBe(
      original.nodes[2].id,
    );
    expect(changed.edgeType).toBe(endpoint === 'targetExternalId' ? 'dependency' : 'relationship');
    expect(changed.metadata).toEqual({ custom: { reviewed: true }, userNote: 'Bulk annotation' });
    preserved(same.edges[0], changed);
    expect(saved.nodes).toEqual(original.nodes);
  },
);

it('rolls back an invalid bulk batch after a proposed reconnect without dropping the saved SQL constraint', async () => {
  const original = await repo.importGraph(fixture());
  await expect(
    repo.bulk(original.diagram.id, {
      upsert: true,
      edges: [
        { externalId: 'order-account', targetExternalId: 'contacts' },
        { sourceExternalId: 'missing', targetExternalId: 'accounts' },
      ],
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(await repo.getGraph(original.diagram.id)).toEqual(original);
});

it('round-trips table and FK metadata losslessly through JSON and a workspace backup', async () => {
  const original = await repo.importGraph(fixture());
  const json = JSON.parse(JSON.stringify(original)) as Graph;
  expect(getSqlTable(json.nodes[0])).toEqual(getSqlTable(original.nodes[0]));
  expect(getSqlRelationship(json.edges[0])).toEqual(getSqlRelationship(original.edges[0]));
  const restoredDb = new WorkspaceDatabase(`sql-restore-${crypto.randomUUID()}`);
  try {
    await restoredDb.initialize();
    const restoredRepo = new Repository(restoredDb);
    const jsonImported = await restoredRepo.importGraph(json);
    expect(jsonImported.nodes.map((node) => node.metadata)).toEqual(
      original.nodes.map((node) => node.metadata),
    );
    expect(jsonImported.edges[0].metadata).toEqual(original.edges[0].metadata);
    await restoredRepo.restore(await db.backup(), 'replace');
    const restored = await restoredRepo.getGraph(original.diagram.id);
    expect(restored.nodes).toEqual(original.nodes);
    expect(restored.edges).toEqual(original.edges);
  } finally {
    await restoredDb.delete();
  }
});
