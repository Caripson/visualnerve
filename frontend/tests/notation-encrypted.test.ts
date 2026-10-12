import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import {
  blankGraph,
  newEdge,
  newNode,
  type Diagram,
  type Graph,
  type GraphNode,
} from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { notationSymbols, notationEdgeSymbols } from '../src/notation/registry';
import type { NodeNotation, EdgeNotation } from '../src/notation/types';
import { instantiate } from '../src/templates/templates';
import { parseImport } from '../src/export/semantic';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { useEditor } from '../src/state/editor';

const password = 'Synthetic notation acceptance passphrase';
const secret = 'PRIVATE_NOTATION_SENTINEL_864209';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage,
  session: VaultSession,
  db: EncryptedWorkspaceDatabase,
  repo: Repository;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  physical = new VaultRecordStorage(`notation-encrypted-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(
    session,
    new VaultLogicalRecordCodec(cipher, webcrypto as unknown as Crypto),
  );
  repo = new Repository(db);
});
afterEach(async () => {
  useEditor.getState().setGraph(null);
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

async function rawRecords() {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(physical.name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = connection.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    connection.close();
  }
}

/** Fixed IDs deliberately collide on reimport; notation references must follow the remap. */
function referenceGraph(): Graph {
  const graph = blankGraph(secret, 'freeform');
  graph.diagram.notation = { schemaVersion: 1, collection: 'uml', diagramKind: 'class' };
  const host = newNode(graph.diagram.id, {
    id: '11111111-1111-4111-8111-111111111111',
    externalId: 'host',
    title: `${secret}-host`,
    nodeType: 'system',
    color: '#112233',
    backgroundColor: '#c0ffee',
    notation: {
      collection: 'uml',
      symbol: 'class',
      properties: { abstract: true },
      compartments: [{ id: 'attributes', title: 'Attributes', lines: [`+ private: ${secret}`] }],
      ports: [{ id: 'outbound', side: 'right', offset: 0.75, direction: 'out', label: secret }],
    },
  });
  const port = newNode(graph.diagram.id, {
    id: '22222222-2222-4222-8222-222222222222',
    title: `${secret}-port`,
    notation: { collection: 'uml', symbol: 'port', attachmentId: host.id },
  });
  const linked = newNode(graph.diagram.id, {
    id: '33333333-3333-4333-8333-333333333333',
    title: `${secret}-linked`,
    notation: { collection: 'uml', symbol: 'object', relatedNodeId: host.id },
  });
  const task = newNode(graph.diagram.id, {
    id: '44444444-4444-4444-8444-444444444444',
    title: `${secret}-task`,
    notation: { collection: 'bpmn', symbol: 'task', properties: { taskType: 'user' } },
  });
  const boundary = newNode(graph.diagram.id, {
    id: '55555555-5555-4555-8555-555555555555',
    title: `${secret}-boundary`,
    notation: {
      collection: 'bpmn',
      symbol: 'boundary-event',
      attachmentId: task.id,
      properties: { eventDefinition: 'timer', nonInterrupting: true },
    },
  });
  const timing = newNode(graph.diagram.id, {
    id: '66666666-6666-4666-8666-666666666666',
    title: `${secret}-timing`,
    notation: {
      collection: 'uml',
      symbol: 'timing-lifeline',
      properties: {
        timeStart: 0,
        timeEnd: 10,
        timingStates: [
          { time: 0, state: `${secret}-idle` },
          { time: 5, state: `${secret}-busy` },
        ],
      },
    },
  });
  graph.nodes = [host, port, linked, task, boundary, timing];
  graph.edges = [
    newEdge(graph.diagram.id, host.id, linked.id, {
      id: '77777777-7777-4777-8777-777777777777',
      notation: {
        collection: 'uml',
        symbol: 'association',
        sourcePort: 'outbound',
        targetPort: 'left',
        sourceLabel: secret,
        targetLabel: 'instances',
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
        waypoints: [
          [-20, 30],
          [420, 80],
        ],
      },
    }),
  ];
  validateGraph(graph);
  return graph;
}

function expectReferences(graph: Graph) {
  validateGraph(graph);
  const byTitle = new Map(graph.nodes.map((node) => [node.title, node]));
  const host = byTitle.get(`${secret}-host`),
    task = byTitle.get(`${secret}-task`);
  if (host) {
    const port = byTitle.get(`${secret}-port`),
      linked = byTitle.get(`${secret}-linked`);
    if (port) expect(port.notation?.attachmentId).toBe(host.id);
    if (linked) expect(linked.notation?.relatedNodeId).toBe(host.id);
  }
  if (task) expect(byTitle.get(`${secret}-boundary`)?.notation?.attachmentId).toBe(task.id);
  for (const node of graph.nodes)
    for (const key of ['attachmentId', 'relatedNodeId'] as const) {
      const id = node.notation?.[key];
      if (id) expect(graph.nodes.some((candidate) => candidate.id === id)).toBe(true);
    }
}

function movementGraph(): Graph {
  const graph = referenceGraph();
  const group = newNode(graph.diagram.id, {
    id: '88888888-8888-4888-8888-888888888888',
    externalId: 'group',
    title: `${secret}-group`,
    nodeType: 'group',
    x: 50,
    y: 50,
  });
  graph.nodes.forEach((node, index) => {
    node.externalId ??= ['host', 'port', 'linked', 'task', 'boundary', 'timing'][index];
    [node.x, node.y] = [
      [100, 100],
      [350, 130],
      [650, 180],
      [500, 300],
      [500, 360],
      [900, 420],
    ][index];
  });
  graph.nodes[0].parentId = group.id;
  graph.nodes[1].parentId = graph.nodes[0].id; // Native membership and attachment overlap.
  graph.nodes[3].parentId = group.id;
  graph.nodes[4].parentId = graph.nodes[3].id;
  const lifeline = newNode(graph.diagram.id, {
    id: '99999999-9999-4999-8999-999999999999',
    externalId: 'lifeline',
    title: `${secret}-lifeline`,
    parentId: group.id,
    x: 800,
    y: 600,
    notation: { collection: 'uml', symbol: 'lifeline' },
  });
  const activation = newNode(graph.diagram.id, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    externalId: 'activation',
    title: `${secret}-activation`,
    parentId: lifeline.id,
    x: 790,
    y: 655,
    notation: { collection: 'uml', symbol: 'activation', attachmentId: lifeline.id },
  });
  graph.nodes.push(group, lifeline, activation);
  validateGraph(graph);
  return graph;
}

const positions = (graph: Graph) =>
  Object.fromEntries(graph.nodes.map((node) => [node.externalId!, [node.x, node.y]]));

it('matches UI host-relative PATCH moves for ports, boundary events, executions and overlapping native group contents', async () => {
  const saved = await repo.saveGraph(movementGraph(), 0),
    group = saved.nodes.find((node) => node.externalId === 'group')!;
  useEditor.getState().setGraph(saved);
  useEditor.getState().updateNode(group.id, { x: group.x + 200, y: group.y + 50 });
  await repo.request(`/nodes/${group.id}`, 'PATCH', {
    version: group.version,
    x: group.x + 200,
    y: group.y + 50,
  });
  let graph = await repo.getGraph(saved.diagram.id);
  expect(positions(graph)).toEqual(positions(useEditor.getState().graph!));
  expect(positions(graph)).toMatchObject({
    host: [300, 150],
    port: [550, 180],
    task: [700, 350],
    boundary: [700, 410],
    lifeline: [1000, 650],
    activation: [990, 705],
    linked: [650, 180],
    timing: [900, 420],
  });
  const host = graph.nodes.find((node) => node.externalId === 'host')!;
  await repo.request(`/nodes/${host.id}`, 'PATCH', { version: host.version, x: host.x + 25 });
  graph = await repo.getGraph(saved.diagram.id);
  expect(positions(graph)).toMatchObject({
    host: [325, 150],
    port: [575, 180],
    linked: [650, 180],
  });
  const task = graph.nodes.find((node) => node.externalId === 'task')!;
  await repo.request(`/nodes/${task.id}`, 'PATCH', { version: task.version, y: task.y + 40 });
  graph = await repo.getGraph(saved.diagram.id);
  expect(positions(graph)).toMatchObject({ task: [700, 390], boundary: [700, 450] });
  db.close();
  await db.open();
  expect(await repo.getGraph(saved.diagram.id)).toEqual(graph);
  expectReferences(graph);
});

it('makes bulk attachment/group translation independent of entry order while retaining explicit child coordinates', async () => {
  for (const explicitPort of [false, true]) {
    const results: ReturnType<typeof positions>[] = [];
    for (const reversed of [false, true]) {
      const saved = await repo.importGraph(movementGraph());
      const entries = [
        { externalId: 'group', x: 250, y: 100 },
        { externalId: 'host', x: 777, y: 888 },
        { externalId: 'task', title: 'Changed without authored coordinates' },
        ...(explicitPort ? [{ externalId: 'port', x: 42, y: 43 }] : []),
      ];
      const updated = await repo.request<Graph>(`/diagrams/${saved.diagram.id}/bulk`, 'POST', {
        baseVersion: saved.diagram.version,
        upsert: true,
        nodes: reversed ? entries.reverse() : entries,
      });
      results.push(positions(updated));
      expect(positions(updated)).toMatchObject({
        group: [250, 100],
        host: [777, 888],
        port: explicitPort ? [42, 43] : [1027, 918],
        task: [700, 350],
        boundary: [700, 410],
        lifeline: [1000, 650],
        activation: [990, 705],
        linked: [650, 180],
      });
      expect(updated.nodes.find((node) => node.externalId === 'task')?.title).toBe(
        'Changed without authored coordinates',
      );
      expectReferences(updated);
      expect(await repo.getGraph(saved.diagram.id)).toEqual(updated);
    }
    expect(results[0]).toEqual(results[1]);
  }
});

it('encrypts every catalog symbol/connector and preserves native, history, backup and vault reloads', async () => {
  const graph = blankGraph(secret, 'freeform');
  graph.diagram.notation = { schemaVersion: 1, collection: 'uml', diagramKind: 'class' };
  graph.nodes = notationSymbols.map((symbol) =>
    newNode(graph.diagram.id, {
      title: `${secret}-${symbol.collection}-${symbol.id}`,
      width: symbol.defaultSize.width,
      height: symbol.defaultSize.height,
      color: '#135724',
      backgroundColor: '#fFeEdD',
      notation: {
        collection: symbol.collection,
        symbol: symbol.id,
        diagramKind: symbol.diagramKinds[0],
      } as NodeNotation,
    }),
  );
  graph.edges = notationEdgeSymbols.map((symbol) =>
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, {
      notation: {
        collection: symbol.collection,
        symbol: symbol.id,
        sourcePort: 'right',
        targetPort: 'left',
        sourceLabel: secret,
        targetLabel: secret,
        waypoints: [
          [-10, 20],
          [35, 40],
        ],
      } as EdgeNotation,
    }),
  );
  expect(graph.nodes).toHaveLength(134);
  expect(graph.edges).toHaveLength(42);
  const saved = await repo.saveGraph(graph, 0);
  const snapshot = await repo.history.create(saved.diagram.id, {
    name: secret,
    baseVersion: saved.diagram.version,
  });
  const backup = await db.backup();
  const imported = await repo.importGraph(parseImport('json', JSON.stringify(saved)));
  expect(imported.nodes.map((node) => node.notation)).toEqual(
    saved.nodes.map((node) => node.notation),
  );
  expect(imported.edges.map((edge) => edge.notation)).toEqual(
    saved.edges.map((edge) => edge.notation),
  );
  await repo.restore(backup, 'replace');
  expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
  const [restoredSnapshot] = await repo.history.list(saved.diagram.id);
  expect(restoredSnapshot.name).toBe(snapshot.name);
  expect((await repo.history.read(saved.diagram.id, restoredSnapshot.id)).graph.nodes).toEqual(
    saved.nodes,
  );
  db.close();
  await db.open();
  expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
  await session.lock();
  await expect(repo.getGraph(saved.diagram.id)).rejects.toMatchObject({ status: 423 });
  await session.unlock(password);
  expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
  const encrypted = JSON.stringify(await rawRecords());
  expect(encrypted).not.toContain(secret);
  expect(encrypted).not.toContain(saved.diagram.id);
  expect(encrypted).not.toContain(saved.nodes[0].id);
}, 30000);

it('remaps fixed native IDs, attached hosts and related references through import, duplication and clipboard', async () => {
  const saved = await repo.saveGraph(referenceGraph(), 0);
  const imported = await repo.importGraph(parseImport('json', JSON.stringify(saved)));
  expect(imported.diagram.id).not.toBe(saved.diagram.id);
  expect(
    imported.nodes.every((node) => saved.nodes.every((original) => original.id !== node.id)),
  ).toBe(true);
  expectReferences(imported);
  expect(imported.edges[0].notation).toEqual(saved.edges[0].notation);
  expect(imported.edges[0].sourceNodeId).toBe(imported.nodes[0].id);
  expect(imported.nodes[0].notation?.compartments).toEqual(saved.nodes[0].notation?.compartments);
  expect(imported.nodes[5].notation?.properties).toEqual(saved.nodes[5].notation?.properties);
  const duplicate = instantiate('blank', 'Duplicate', saved);
  expectReferences(duplicate);
  expect(duplicate.diagram.notation).toEqual(saved.diagram.notation);
  const clipboard = copySelection(saved, [saved.nodes[1].id]);
  const target = blankGraph('Target');
  const pasted = { ...target, ...pasteSelection(clipboard, target) };
  expect(pasted.nodes).toHaveLength(2);
  expectReferences(pasted);
  expect(
    pasted.nodes.every((node) => saved.nodes.every((original) => original.id !== node.id)),
  ).toBe(true);
  const linkedOnly = {
    ...target,
    ...pasteSelection(copySelection(saved, [saved.nodes[2].id]), target),
  };
  expect(linkedOnly.nodes[0].notation?.relatedNodeId).toBeUndefined();
  validateGraph(linkedOnly);
});

it('remaps retained history-only attachments on full-backup merge and restores their canonical IDs', async () => {
  const saved = await repo.saveGraph(referenceGraph(), 0);
  const snapshot = await repo.history.create(saved.diagram.id, {
    name: 'Before host removal',
    baseVersion: saved.diagram.version,
  });
  await repo.request(`/nodes/${saved.nodes[0].id}`, 'DELETE', { version: saved.nodes[0].version });
  const current = await repo.getGraph(saved.diagram.id);
  expect(
    current.nodes.some((node) => node.id === saved.nodes[0].id || node.id === saved.nodes[1].id),
  ).toBe(false);
  expect(
    current.nodes.find((node) => node.id === saved.nodes[2].id)?.notation?.relatedNodeId,
  ).toBeUndefined();
  const backup = await db.backup();
  const [merged] = await repo.restore(backup, 'merge');
  expect(merged.diagram.id).not.toBe(saved.diagram.id);
  expectReferences(merged);
  const snapshots = await repo.history.list(merged.diagram.id);
  expect(snapshots).toHaveLength(1);
  const archived = (await repo.history.read(merged.diagram.id, snapshots[0].id)).graph;
  expectReferences(archived);
  expect(archived.nodes).toHaveLength(saved.nodes.length);
  expect(
    archived.nodes.every((node) => saved.nodes.every((original) => original.id !== node.id)),
  ).toBe(true);
  const restored = await repo.history.restore(merged.diagram.id, snapshots[0].id, {
    baseVersion: merged.diagram.version,
  });
  expectReferences(restored.graph);
  expect(restored.graph.nodes.map((node) => node.id)).toEqual(
    archived.nodes.map((node) => node.id),
  );
  expect((await repo.getGraph(saved.diagram.id)).nodes).toEqual(current.nodes);
  await repo.restore(backup, 'replace');
  const [replacementSnapshot] = await repo.history.list(saved.diagram.id);
  expect(replacementSnapshot.name).toBe(snapshot.name);
  const originalArchive = (await repo.history.read(saved.diagram.id, replacementSnapshot.id)).graph;
  expect(originalArchive.nodes.map((node) => node.id)).toEqual(saved.nodes.map((node) => node.id));
  expectReferences(originalArchive);
});

it('switches appearance with explicit clearing and rejects invalid partial/bulk/import edits atomically', async () => {
  const graph = blankGraph('Appearance parity');
  graph.nodes = [
    newNode(graph.diagram.id, {
      title: secret,
      nodeType: 'team',
      externalId: 'appearance',
      flowchartSymbol: 'ibm-process',
      color: '#112233',
      backgroundColor: '#c0ffee',
    }),
  ];
  const saved = await repo.saveGraph(graph, 0),
    node = saved.nodes[0];
  const notation = { collection: 'uml', symbol: 'class', properties: { abstract: true } } as const;
  const invalid = { ...node, notation };
  expect(() => validateGraph({ ...saved, nodes: [invalid] })).toThrow(
    'cannot be set on the same node',
  );
  await expect(
    repo.request(`/nodes/${node.id}`, 'PATCH', { version: node.version, notation }),
  ).rejects.toMatchObject({ status: 422, code: 'INVALID_NOTATION' });
  expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
  useEditor.getState().setGraph(saved);
  useEditor.getState().updateNode(node.id, { notation, flowchartSymbol: undefined });
  const ui = useEditor.getState().graph!.nodes[0];
  const changed = await repo.request<GraphNode>(`/nodes/${node.id}`, 'PATCH', {
    version: node.version,
    notation,
    flowchartSymbol: null,
  });
  expect(changed.notation).toEqual(ui.notation);
  expect(changed).toMatchObject({
    title: node.title,
    nodeType: node.nodeType,
    color: node.color,
    backgroundColor: node.backgroundColor,
  });
  expect(changed.flowchartSymbol).toBeUndefined();
  const baseline = await repo.getGraph(saved.diagram.id),
    encrypted = await rawRecords();
  await expect(
    repo.request(`/diagrams/${saved.diagram.id}/bulk`, 'POST', {
      baseVersion: baseline.diagram.version,
      upsert: true,
      nodes: [
        { externalId: 'new-valid', title: 'Would save' },
        {
          externalId: 'appearance',
          notation: {
            collection: 'uml',
            symbol: 'class',
            relatedNodeId: '99999999-9999-4999-8999-999999999999',
          },
        },
      ],
    }),
  ).rejects.toMatchObject({ status: 422, code: 'INVALID_NOTATION' });
  const invalidImport = structuredClone(baseline);
  invalidImport.nodes[0].flowchartSymbol = 'ibm-decision';
  await expect(repo.importGraph(invalidImport)).rejects.toMatchObject({
    status: 422,
    code: 'INVALID_NOTATION',
  });
  await expect(repo.saveGraph(invalidImport, baseline.diagram.version)).rejects.toMatchObject({
    status: 422,
    code: 'INVALID_NOTATION',
  });
  expect(await repo.getGraph(saved.diagram.id)).toEqual(baseline);
  expect(await rawRecords()).toEqual(encrypted);
  const replaced = await repo.request<GraphNode>(`/nodes/${node.id}`, 'PATCH', {
    version: changed.version,
    notation: { collection: 'uml', symbol: 'class' },
  });
  expect(replaced.notation).toEqual({ collection: 'uml', symbol: 'class' });
  const switched = await repo.request<GraphNode>(`/nodes/${node.id}`, 'PATCH', {
    version: replaced.version,
    notation: null,
    flowchartSymbol: 'ibm-decision',
  });
  expect(switched.notation).toBeUndefined();
  expect(switched.flowchartSymbol).toBe('ibm-decision');
  expect(switched.backgroundColor).toBe(node.backgroundColor);
  const beforeBulk = await repo.getGraph(saved.diagram.id);
  const bulk = await repo.request<Graph>(`/diagrams/${saved.diagram.id}/bulk`, 'POST', {
    baseVersion: beforeBulk.diagram.version,
    upsert: true,
    nodes: [{ externalId: 'appearance', notation, flowchartSymbol: null }],
  });
  expect(bulk.nodes[0]).toMatchObject({
    id: node.id,
    title: node.title,
    nodeType: node.nodeType,
    notation,
    color: node.color,
    backgroundColor: node.backgroundColor,
  });
  expect(bulk.nodes[0].flowchartSymbol).toBeUndefined();
  const cleared = await repo.request<Graph>(`/diagrams/${saved.diagram.id}/bulk`, 'POST', {
    baseVersion: bulk.diagram.version,
    upsert: true,
    nodes: [{ externalId: 'appearance', notation: null }],
  });
  expect(cleared.nodes[0].notation).toBeUndefined();
  expect(cleared.nodes[0].backgroundColor).toBe(node.backgroundColor);
});

it('matches UI/API host deletion while keeping independent linked nodes and undo/redo semantics', async () => {
  const saved = await repo.saveGraph(referenceGraph(), 0),
    host = saved.nodes[0];
  useEditor.getState().setGraph(saved);
  useEditor.getState().select([host.id]);
  useEditor.getState().remove();
  const removed = useEditor.getState().graph!;
  validateGraph(removed);
  expect(
    removed.nodes.find((node) => node.id === saved.nodes[2].id)?.notation?.relatedNodeId,
  ).toBeUndefined();
  useEditor.getState().undo();
  expectReferences(useEditor.getState().graph!);
  useEditor.getState().redo();
  expect(useEditor.getState().graph!.nodes).toEqual(removed.nodes);
  await repo.request(`/nodes/${host.id}`, 'DELETE', { version: host.version });
  const api = await repo.getGraph(saved.diagram.id);
  expect(api.nodes.map((node) => [node.id, node.notation])).toEqual(
    removed.nodes.map((node) => [node.id, node.notation]),
  );
  expect(api.edges.map((edge) => edge.id)).toEqual(removed.edges.map((edge) => edge.id));
  validateGraph(api);
});

it('rejects stale encrypted API authority even if the vault is unlocked again before a queued edit resumes', async () => {
  const saved = await repo.saveGraph(referenceGraph(), 0);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    started = new Promise<void>((resolve) => (entered = resolve));
  const pending = repo.request(
    `/nodes/${saved.nodes[0].id}`,
    'PATCH',
    { version: saved.nodes[0].version, title: 'Revoked private edit' },
    {
      beforeRequest: async () => {
        entered();
        await gate;
      },
    },
  );
  const rejected = expect(pending).rejects.toMatchObject({ status: 423 });
  await started;
  await session.lock();
  await session.unlock(password);
  release();
  await rejected;
  expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
});

it('accepts a matching notation-template profile and rejects null/invalid/conflicting profiles before writes', async () => {
  const matching = await repo.request<Diagram>('/diagrams', 'POST', {
    name: 'Matching class profile',
    template: 'uml-class',
    notation: { diagramKind: 'class', collection: 'uml', schemaVersion: 1 },
  });
  expect(matching.notation).toEqual({ schemaVersion: 1, collection: 'uml', diagramKind: 'class' });
  const before = await db.diagrams.toArray(),
    encrypted = await rawRecords();
  for (const notation of [
    null,
    { schemaVersion: 1, collection: 'uml', diagramKind: 'object' },
    { schemaVersion: 1, collection: 'hipo', diagramKind: 'vtoc' },
    { schemaVersion: 1, collection: 'uml', diagramKind: 'class', extra: true },
  ]) {
    await expect(
      repo.request('/diagrams', 'POST', {
        name: 'Rejected conflict',
        template: 'uml-class',
        notation,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_NOTATION' });
    expect(await db.diagrams.toArray()).toEqual(before);
    expect(await rawRecords()).toEqual(encrypted);
  }
});
