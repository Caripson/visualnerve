import { afterEach, expect, it } from 'vitest';
import { blankGraph, newNode, newEdge, base, type Graph, type Owner } from '../src/model/types';
import { StorageError, validateGraph } from '../src/model/validation';
import { parseImport } from '../src/export/semantic';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

function graph() {
  const value = blankGraph('Validated import');
  value.nodes = [newNode(value.diagram.id), newNode(value.diagram.id)];
  value.edges = [newEdge(value.diagram.id, value.nodes[0].id, value.nodes[1].id)];
  value.owners = [{ ...base(), name: 'Reviewer', kind: 'person', color: '#31766c', metadata: {} }];
  return value;
}

it.each([
  ['node tags', (g: Graph) => Object.assign(g.nodes[0], { tags: null })],
  ['diagram tags', (g: Graph) => Object.assign(g.diagram, { tags: ['ok', 12] })],
  ['node metadata', (g: Graph) => Object.assign(g.nodes[0], { metadata: null })],
  ['edge metadata', (g: Graph) => Object.assign(g.edges[0], { metadata: [] })],
  ['owner metadata', (g: Graph) => Object.assign(g.owners[0], { metadata: null })],
  ['node description', (g: Graph) => Object.assign(g.nodes[0], { description: 42 })],
  ['edge label', (g: Graph) => Object.assign(g.edges[0], { label: { invalid: true } })],
  ['diagram folder', (g: Graph) => Object.assign(g.diagram, { folder: [] })],
  ['owner email', (g: Graph) => Object.assign(g.owners[0], { email: 123 })],
  [
    'null node',
    (g: Graph) => {
      g.nodes[0] = null as unknown as Graph['nodes'][number];
    },
  ],
  [
    'null edge',
    (g: Graph) => {
      g.edges[0] = null as unknown as Graph['edges'][number];
    },
  ],
  [
    'null owner',
    (g: Graph) => {
      g.owners[0] = null as unknown as Owner;
    },
  ],
] as const)(
  'rejects malformed %s with a validation error before rendering or persistence',
  (_, corrupt) => {
    const value = graph();
    corrupt(value);
    expect(() => validateGraph(value)).toThrow(StorageError);
  },
);

it('preserves custom metadata and valid optional empty text', () => {
  const value = graph();
  value.diagram.metadata = { custom: { values: [null, 1, 'a'] } };
  value.nodes[0].metadata = { integration: { nested: { enabled: true } } };
  value.nodes[0].description = '';
  value.edges[0].label = '';
  const original = structuredClone(value);
  validateGraph(value);
  expect(value).toEqual(original);
});

it.each(['null', '[]', 'false'])(
  'explains the native JSON format for %s instead of a property access error',
  (text) => {
    expect(() => parseImport('json', text)).toThrow('Choose a Visual Nerve JSON export');
  },
);

const databases: WorkspaceDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});
it('rolls back invalid native imports and API patches without corrupting the saved graph', async () => {
  const db = new WorkspaceDatabase(`validation-${crypto.randomUUID()}`);
  databases.push(db);
  const repo = new Repository(db);
  await db.initialize();
  const saved = await repo.saveGraph(graph(), 0);
  const before = await db.diagrams.toArray();
  const malformed = graph();
  Object.assign(malformed.nodes[0], { tags: null });
  await expect(repo.importGraph(malformed)).rejects.toMatchObject({ status: 422 });
  expect(await db.diagrams.toArray()).toEqual(before);
  await expect(
    repo.request(`/nodes/${saved.nodes[0].id}`, 'PATCH', {
      version: saved.nodes[0].version,
      description: 123,
    }),
  ).rejects.toMatchObject({ status: 422 });
  for (const metadata of [null, [], 123])
    await expect(
      repo.request(`/nodes/${saved.nodes[0].id}`, 'PATCH', {
        version: saved.nodes[0].version,
        metadata,
      }),
    ).rejects.toMatchObject({ status: 422 });
  await expect(
    repo.request(`/nodes/${saved.nodes[0].id}`, 'PATCH', {
      version: saved.nodes[0].version,
      ownerIds: null,
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    repo.request(`/diagrams/${saved.diagram.id}/graph`, 'PUT', {
      baseVersion: saved.diagram.version,
      graph: null,
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
});
