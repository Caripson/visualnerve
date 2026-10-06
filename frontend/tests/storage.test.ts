import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { base, blankGraph, newNode, newEdge, type Graph, type Owner } from '../src/model/types';
import { useEditor } from '../src/state/editor';

let db: WorkspaceDatabase, repo: Repository;
const controllers: Workspace[] = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`test-${crypto.randomUUID()}`);
  repo = new Repository(db);
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  await db.initialize();
});
afterEach(async () => {
  controllers.forEach((controller) => controller.stop());
  controllers.length = 0;
  await db.delete();
});
async function snapshot() {
  return db.transaction('r', db.tables, async () =>
    Object.fromEntries(
      await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])),
    ),
  );
}
function graph(name = 'Mind map') {
  const graph = blankGraph(name, 'mindmap');
  const root = newNode(graph.diagram.id, { title: 'Root', metadata: { unknown: { keep: true } } });
  const child = newNode(graph.diagram.id, { title: 'Child', parentId: root.id });
  graph.nodes = [root, child];
  graph.edges = [newEdge(graph.diagram.id, root.id, child.id, { edgeType: 'hierarchy' })];
  return graph;
}
describe('authoritative IndexedDB repository', () => {
  it('opens the authoritative workspace and history stores and seeds templates once', async () => {
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'datasets',
      'diagrams',
      'edges',
      'historyContents',
      'historyRows',
      'historySnapshots',
      'historySources',
      'nodes',
      'owners',
      'settings',
      'templates',
    ]);
    const templates = await db.templates.toArray();
    await db.initialize();
    expect(await db.templates.toArray()).toEqual(templates);
    expect(db.nodes.schema.indexes.map((index) => index.name)).toContain('[diagramId+externalId]');
  });
  it('upgrades existing browser graphs including pending edits and removes obsolete stores', async () => {
    const name = `upgrade-${crypto.randomUUID()}`,
      old = new Dexie(name),
      source = graph('Pending edit');
    old.version(1).stores({
      diagrams: 'id,updatedAt,name,folder,*tags',
      graphs: 'id',
      owners: 'id,name,team',
      state: 'id',
    });
    await old.table('diagrams').put({ ...source.diagram, name: 'Old saved title' });
    await old
      .table('graphs')
      .put({ id: source.diagram.id, graph: source, dirty: true, generation: 4, baseVersion: 1 });
    await old.table('state').put({ id: 'last-diagram', value: source.diagram.id });
    old.close();
    const upgraded = new WorkspaceDatabase(name);
    try {
      await upgraded.initialize();
      const saved = (await upgraded.graph(source.diagram.id))!;
      expect(saved.diagram.name).toBe('Pending edit');
      expect(saved.nodes).toEqual(source.nodes);
      expect((await upgraded.settings.get('last-diagram'))?.value).toBe(source.diagram.id);
      expect(upgraded.tables.map((table) => table.name)).not.toContain('graphs');
    } finally {
      await upgraded.delete();
    }
  });
  it('persists ordered graphs, nested metadata and viewport across reopen', async () => {
    const source = graph();
    source.nodes.reverse();
    source.diagram.settings.viewport = { x: 12, y: 18, zoom: 0.5 };
    await repo.importGraph(source);
    db.close();
    await db.open();
    const restored = await repo.getGraph(source.diagram.id);
    expect(restored.nodes).toEqual(source.nodes);
    expect(restored.edges).toEqual(source.edges);
    expect(restored.diagram.settings.viewport).toEqual(source.diagram.settings.viewport);
  });
  it('rejects stale diagram replacements without losing either writer’s data', async () => {
    const original = await repo.importGraph(graph());
    const first = structuredClone(original),
      second = structuredClone(original);
    first.nodes[0].title = 'First writer';
    second.nodes[0].title = 'Second writer';
    const saved = await repo.saveGraph(first, original.diagram.version);
    await expect(repo.saveGraph(second, original.diagram.version)).rejects.toMatchObject({
      status: 409,
    });
    expect((await repo.getGraph(saved.diagram.id)).nodes[0].title).toBe('First writer');
    expect(second.nodes[0].title).toBe('Second writer');
  });
  it('rolls back owners, nodes and edges when bulk references are invalid', async () => {
    const original = await repo.importGraph(graph());
    const before = await snapshot();
    await expect(
      repo.bulk(original.diagram.id, {
        owners: [{ name: 'Temporary', externalId: 'temp' }],
        nodes: [{ title: 'Temporary', externalId: 'new', ownerExternalId: 'temp' }],
        edges: [{ sourceExternalId: 'new', targetExternalId: 'missing' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
  });
  it('upserts scoped external identities with parent and owner references atomically', async () => {
    const source = await repo.importGraph(blankGraph('Bulk'));
    const data = {
      upsert: true,
      owners: [{ name: 'Team', externalId: 'team', kind: 'team' }],
      nodes: [
        { title: 'Root', externalId: 'root' },
        { title: 'Child', externalId: 'child', parentExternalId: 'root', ownerExternalId: 'team' },
      ],
      edges: [{ externalId: 'edge', sourceExternalId: 'root', targetExternalId: 'child' }],
    };
    const first = await repo.bulk(source.diagram.id, data),
      second = await repo.bulk(source.diagram.id, data);
    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.edges[0].id).toBe(first.edges[0].id);
    expect(second.nodes[1].parentId).toBe(second.nodes[0].id);
    expect(second.nodes[1].ownerIds).toEqual([second.owners[0].id]);
    expect(second.nodes[1]).not.toHaveProperty('parentExternalId');
  });
  it('validates entity versions and graph invariants before writing', async () => {
    const original = await repo.importGraph(graph()),
      node = original.nodes[0];
    await expect(
      repo.request(`/nodes/${node.id}`, 'PATCH', { title: 'Bad' }),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      repo.request(`/nodes/${node.id}`, 'PATCH', {
        version: node.version,
        parentId: original.nodes[1].id,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      repo.request(`/nodes/${node.id}`, 'PATCH', {
        version: node.version,
        url: 'javascript:alert(1)',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
  });
  it('deletes an entire subtree and incident edges in one transaction', async () => {
    const source = graph(),
      leaf = newNode(source.diagram.id, { parentId: source.nodes[1].id });
    source.nodes.push(leaf);
    source.edges.push(newEdge(source.diagram.id, source.nodes[1].id, leaf.id));
    await repo.importGraph(source);
    await repo.request(`/nodes/${source.nodes[1].id}?branch=true`, 'DELETE');
    const saved = await repo.getGraph(source.diagram.id);
    expect(saved.nodes.map((node) => node.id)).toEqual([source.nodes[0].id]);
    expect(saved.edges).toEqual([]);
  });
  it('deletes a single parent without removing children', async () => {
    const source = await repo.importGraph(graph());
    await repo.request(`/nodes/${source.nodes[0].id}`, 'DELETE');
    const saved = await repo.getGraph(source.diagram.id);
    expect(saved.nodes).toHaveLength(1);
    expect(saved.nodes[0].parentId).toBeUndefined();
    expect(saved.edges).toEqual([]);
  });
  it('moves nested groups and deletes all group descendants together', async () => {
    const source = graph();
    source.nodes[0].nodeType = 'group';
    const saved = await repo.importGraph(source),
      root = saved.nodes[0];
    await repo.request(`/nodes/${root.id}`, 'PATCH', {
      version: root.version,
      x: root.x + 50,
      y: root.y + 30,
    });
    const moved = await repo.getGraph(source.diagram.id);
    expect(moved.nodes[1].x).toBe(saved.nodes[1].x + 50);
    await repo.request(`/nodes/${root.id}`, 'DELETE');
    expect((await repo.getGraph(source.diagram.id)).nodes).toEqual([]);
  });
  it('reassigns and removes global owners across diagrams atomically', async () => {
    const owner = await repo.owner({ name: 'Johan', kind: 'person' }),
      one = graph('One'),
      two = graph('Two');
    for (const source of [one, two]) {
      source.owners = [owner];
      source.nodes[0].ownerIds = [owner.id];
      await repo.importGraph(source);
    }
    await repo.request(`/owners/${owner.id}`, 'DELETE');
    for (const source of [one, two]) {
      const saved = await repo.getGraph(source.diagram.id);
      expect(saved.nodes[0].ownerIds).toEqual([]);
      expect(saved.diagram.version).toBe(2);
    }
  });
  it('deletes diagrams and indexed graph entities while retaining global owners', async () => {
    const source = graph(),
      owner = await repo.owner({ name: 'Unassigned' });
    await repo.importGraph(source);
    await repo.removeDiagram(source.diagram.id);
    expect(await db.nodes.count()).toBe(0);
    expect(await db.edges.count()).toBe(0);
    expect(await db.owners.get(owner.id)).toBeDefined();
  });
  it('restores the complete workspace including unassigned owners, preferences and templates', async () => {
    const source = await repo.importGraph(graph()),
      owner = await repo.owner({ name: 'Unassigned' });
    await db.settings.put({ key: 'theme', value: 'dark' });
    await db.templates.put({ id: 'custom', name: 'Custom', builtin: false, graph: source });
    const backup = await db.backup();
    await db.diagrams.clear();
    await db.nodes.clear();
    await db.edges.clear();
    await db.owners.clear();
    await db.settings.delete('theme');
    await db.templates.delete('custom');
    await repo.restore(backup);
    expect((await repo.getGraph(source.diagram.id)).nodes).toEqual(source.nodes);
    expect(await db.owners.get(owner.id)).toEqual(owner);
    expect((await db.settings.get('theme'))?.value).toBe('dark');
    expect(await db.templates.get('custom')).toEqual(
      backup.templates.find((template) => template.id === 'custom'),
    );
  });
  it('rolls back the entire workspace restore when a later graph is invalid', async () => {
    const source = await repo.importGraph(graph()),
      backup = await db.backup(),
      bad = graph('Bad');
    bad.edges[0].targetNodeId = crypto.randomUUID();
    backup.diagrams.push(bad.diagram);
    backup.nodes.push(...bad.nodes);
    backup.edges.push(...bad.edges);
    const before = await snapshot();
    await expect(repo.restore(backup)).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
    expect(await repo.getGraph(source.diagram.id)).toEqual(source);
  });
  it('remaps collisions consistently and shares restored owners between projects', async () => {
    const owner: Owner = {
        ...base(),
        name: 'Original',
        kind: 'team',
        color: '#23664d',
        metadata: {},
      },
      first = graph('One'),
      second = graph('Two');
    for (const source of [first, second]) {
      source.owners = [owner];
      source.nodes[0].ownerIds = [owner.id];
      await repo.importGraph(source);
    }
    const backup = await db.backup();
    backup.owners[0].name = 'Imported';
    const restored = await repo.restore(backup);
    expect(
      restored.every((copy) => ![first.diagram.id, second.diagram.id].includes(copy.diagram.id)),
    ).toBe(true);
    expect(restored[0].nodes[0].ownerIds).toEqual(restored[1].nodes[0].ownerIds);
    expect(restored[0].nodes[0].ownerIds[0]).not.toBe(owner.id);
    expect((await db.owners.get(owner.id))?.name).toBe('Original');
  });
  it('retains shared group movement when a descendant has a partial bulk upsert', async () => {
    const source = graph();
    source.nodes[0].nodeType = 'group';
    source.nodes[0].externalId = 'group';
    source.nodes[1].externalId = 'child';
    await repo.importGraph(source);
    const saved = await repo.bulk(source.diagram.id, {
      upsert: true,
      nodes: [
        { externalId: 'group', x: 80, y: 40 },
        { externalId: 'child', title: 'Partial child update' },
      ],
    });
    expect(saved.nodes[1].x).toBe(source.nodes[1].x + 80);
    expect(saved.nodes[1].y).toBe(source.nodes[1].y + 40);
    expect(saved.nodes[1].title).toBe('Partial child update');
  });
  it('rejects colliding owner identities without changing existing assignments', async () => {
    const owner = await repo.owner({ name: 'Existing', externalId: 'existing' });
    await expect(repo.owner({ id: owner.id, name: 'Replacement' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(repo.owner({ externalId: 'existing', name: 'Duplicate' })).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.owners.get(owner.id)).toEqual(owner);
  });
  it('normalizes primary owner aliases for child creation and partial upserts', async () => {
    const source = await repo.importGraph(graph()),
      owner = await repo.owner({ name: 'Primary' });
    const child = await repo.request<Graph['nodes'][number]>(
      `/nodes/${source.nodes[0].id}/children`,
      'POST',
      { title: 'Assigned child', externalId: 'child', ownerId: owner.id },
    );
    expect(child.ownerIds).toEqual([owner.id]);
    expect(child.ownerId).toBe(owner.id);
    const saved = await repo.bulk(source.diagram.id, {
      upsert: true,
      nodes: [{ externalId: 'child', ownerId: null }],
    });
    expect(saved.nodes.find((node) => node.id === child.id)!.ownerIds).toEqual([]);
  });
  it('exports schema/date and portable preferences without connection or consent settings', async () => {
    await repo.importGraph(graph());
    await db.settings.bulkPut([
      { key: 'theme', value: 'dark' },
      { key: 'mcp-access', value: 'write' },
      { key: 'bridge-url', value: 'ws://localhost:4317/bridge' },
      { key: 'privacy-acknowledged', value: true },
    ]);
    const backup = await db.backup();
    expect(backup.schemaVersion).toBe(7);
    expect(Number.isFinite(Date.parse(backup.exportedAt!))).toBe(true);
    expect(backup.settings).toEqual([{ key: 'theme', value: 'dark' }]);
  });
  it('replaces all data atomically and leaves MCP off with a new workspace identity', async () => {
    const original = await repo.importGraph(graph('Original')),
      backup = await db.backup();
    await repo.importGraph(graph('Later'));
    await db.settings.put({ key: 'mcp-access', value: 'write' });
    const identity = (await db.settings.get('workspace-id'))!.value;
    await repo.restore(backup, 'replace');
    expect((await db.diagrams.toArray()).map((diagram) => diagram.id)).toEqual([
      original.diagram.id,
    ]);
    expect((await db.settings.get('workspace-id'))!.value).not.toBe(identity);
    expect(await db.settings.get('mcp-access')).toBeUndefined();
  });
  it('rolls back destructive replacement including all settings if imported data is invalid', async () => {
    await repo.importGraph(graph());
    await db.settings.put({ key: 'mcp-access', value: 'read' });
    const backup = await db.backup();
    const root = backup.nodes.find((node) => !node.parentId)!;
    root.parentId = root.id;
    const before = await snapshot();
    await expect(repo.restore(backup, 'replace')).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
  });
  it('deletes every user record and preference while reseeding only built-in templates', async () => {
    const source = await repo.importGraph(graph());
    await repo.owner({ name: 'Unassigned' });
    await db.templates.put({ id: 'custom', graph: source, name: 'Custom', builtin: false });
    await db.settings.put({ key: 'privacy-acknowledged', value: true });
    await repo.clearAll();
    expect(await db.diagrams.count()).toBe(0);
    expect(await db.nodes.count()).toBe(0);
    expect(await db.edges.count()).toBe(0);
    expect(await db.owners.count()).toBe(0);
    expect((await db.settings.toArray()).map((setting) => setting.key)).toEqual(['workspace-id']);
    expect(await db.templates.count()).toBe(9);
    expect(await db.templates.get('custom')).toBeUndefined();
  });
  it('upgrades version 3 without graph loss and requires new explicit MCP permission', async () => {
    const name = `upgrade-v3-${crypto.randomUUID()}`,
      old = new Dexie(name),
      source = graph('Previous version');
    old.version(3).stores({
      diagrams: 'id,name,type,updatedAt,folder,*tags',
      nodes: 'id,diagramId,&[diagramId+externalId],updatedAt,nodeType,status,parentId,*ownerIds',
      edges: 'id,diagramId,&[diagramId+externalId],sourceNodeId,targetNodeId,updatedAt',
      owners: 'id,&externalId,name,kind,team,updatedAt',
      settings: 'key',
      templates: 'id,name',
    });
    await old.table('diagrams').put(source.diagram);
    await old.table('nodes').bulkPut(source.nodes);
    await old.table('edges').bulkPut(source.edges);
    await old.table('settings').bulkPut([
      { key: 'integration-enabled', value: true },
      { key: 'theme', value: 'dark' },
    ]);
    old.close();
    const upgraded = new WorkspaceDatabase(name);
    try {
      await upgraded.initialize();
      expect((await upgraded.graph(source.diagram.id))!.nodes).toHaveLength(2);
      expect((await upgraded.settings.get('theme'))!.value).toBe('dark');
      expect(await upgraded.settings.get('integration-enabled')).toBeUndefined();
      expect(await upgraded.settings.get('mcp-access')).toBeUndefined();
    } finally {
      await upgraded.delete();
    }
  });
  it('searches IndexedDB node metadata and owner names', async () => {
    const source = graph(),
      owner = await repo.owner({ name: 'Research department' });
    source.owners = [owner];
    source.nodes[0].ownerIds = [owner.id];
    await repo.importGraph(source);
    expect((await repo.search('research department')).map((result) => result.nodeId)).toContain(
      source.nodes[0].id,
    );
    expect((await repo.search('unknown')).map((result) => result.nodeId)).toContain(
      source.nodes[0].id,
    );
  });
  it('stores a 5,000-node graph with bulk writes and indexed retrieval', async () => {
    const source = blankGraph('Large');
    source.nodes = Array.from({ length: 5000 }, (_, index) =>
      newNode(source.diagram.id, { title: `Node ${index}`, externalId: `node-${index}` }),
    );
    await repo.importGraph(source);
    expect((await repo.getGraph(source.diagram.id)).nodes).toHaveLength(5000);
    expect(
      (
        await db.nodes
          .where('[diagramId+externalId]')
          .equals([source.diagram.id, 'node-4999'])
          .first()
      )?.title,
    ).toBe('Node 4999');
  }, 20000);
});
describe('browser workspace controller', () => {
  it('requires explicit storage consent and keeps a new workspace empty before acceptance', async () => {
    const fresh = new WorkspaceDatabase(`consent-${crypto.randomUUID()}`),
      workspace = new Workspace(new Repository(fresh));
    controllers.push(workspace);
    try {
      await workspace.start();
      expect(useEditor.getState().privacyAcknowledged).toBe(false);
      for (const table of fresh.tables) expect(await table.count()).toBe(0);
      await expect(workspace.create(graph())).rejects.toMatchObject({ status: 403 });
      await expect(
        workspace.execute('/diagrams', 'POST', { name: 'Blocked' }),
      ).rejects.toMatchObject({ status: 403 });
      await workspace.acceptStorage();
      await workspace.create(graph('Accepted'));
      expect((await fresh.settings.get('storage-consent'))!.value).toBe(true);
      workspace.stop();
      await workspace.start();
      expect(useEditor.getState().privacyAcknowledged).toBe(true);
      expect(useEditor.getState().graph!.diagram.name).toBe('Accepted');
    } finally {
      workspace.stop();
      await fresh.delete();
    }
  });
  it('does not treat an old informational acknowledgement or imported backup as storage consent', async () => {
    await repo.importGraph(graph('Existing private work'));
    await db.settings.put({ key: 'privacy-acknowledged', value: true });
    const workspace = new Workspace(repo);
    controllers.push(workspace);
    await workspace.start();
    expect(useEditor.getState().privacyAcknowledged).toBe(false);
    expect(useEditor.getState().diagrams).toEqual([]);
    expect(await db.diagrams.count()).toBe(1);
    await workspace.acceptStorage();
    const backup = await workspace.backup();
    expect(
      backup.settings.some((setting) =>
        ['storage-consent', 'privacy-acknowledged'].includes(setting.key),
      ),
    ).toBe(false);
    expect(useEditor.getState().diagrams).toHaveLength(1);
  });
  async function controller() {
    const controller = new Workspace(repo);
    controllers.push(controller);
    await controller.acceptStorage();
    return controller;
  }
  it('loads and saves editor state without any network transport', async () => {
    const workspace = await controller();
    await workspace.create(graph());
    const state = useEditor.getState();
    state.updateNode(state.graph!.nodes[0].id, { title: 'Offline saved' });
    await workspace.settled();
    expect(useEditor.getState().status).toBe('saved');
    expect((await repo.getGraph(state.graph!.diagram.id)).nodes[0].title).toBe('Offline saved');
    workspace.stop();
    const reopened = await controller();
    expect(useEditor.getState().graph!.nodes[0].title).toBe('Offline saved');
    await reopened.settled();
  });
  it('commits an active inline topic draft before opening another diagram', async () => {
    const workspace = await controller();
    await workspace.create(graph('First map'));
    const original = useEditor.getState().graph!;
    const second = await repo.importGraph(graph('Second map'));
    useEditor.getState().beginEditing(original.nodes[0].id);
    useEditor.setState({ editingTitle: 'Saved before navigation' });
    await workspace.open(second.diagram.id);
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe(
      'Saved before navigation',
    );
    expect(useEditor.getState().graph!.diagram.id).toBe(second.diagram.id);
    expect(useEditor.getState().editingNode).toBeNull();
    expect(useEditor.getState().status).toBe('saved');
  });
  it('includes an active inline topic draft in a workspace backup and committed storage', async () => {
    const workspace = await controller();
    await workspace.create(graph('Backup map'));
    const original = useEditor.getState().graph!;
    useEditor.getState().beginEditing(original.nodes[0].id);
    useEditor.setState({ editingTitle: 'Included in backup' });
    const backup = await workspace.backup();
    expect(backup.nodes.find((node) => node.id === original.nodes[0].id)?.title).toBe(
      'Included in backup',
    );
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Included in backup');
    expect(useEditor.getState().editingNode).toBeNull();
    expect(useEditor.getState().status).toBe('saved');
  });
  it('queues edits during an in-flight transaction and preserves unchanged references', async () => {
    const workspace = await controller();
    await workspace.create(graph());
    const original = useEditor.getState().graph!,
      child = original.nodes[1];
    for (let index = 0; index < 5; index++)
      useEditor.getState().updateNode(original.nodes[0].id, { title: `Edit ${index}` });
    await workspace.settled();
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Edit 4');
    expect(useEditor.getState().graph!.nodes[1]).toBe(child);
    expect(useEditor.getState().status).toBe('saved');
  });
  it('preserves both writers and resolves a stale local edit as a copy', async () => {
    const workspace = await controller();
    await workspace.create(graph());
    const original = useEditor.getState().graph!;
    const external = structuredClone(original);
    external.nodes[0].title = 'Other tab';
    await repo.saveGraph(external, original.diagram.version);
    useEditor.getState().updateNode(original.nodes[0].id, { title: 'Local tab' });
    await expect(workspace.settled()).rejects.toMatchObject({ status: 409 });
    expect(useEditor.getState().graph!.nodes[0].title).toBe('Local tab');
    await workspace.resolve('copy');
    expect(useEditor.getState().graph!.nodes[0].title).toBe('Local tab');
    expect((await repo.getGraph(original.diagram.id)).nodes[0].title).toBe('Other tab');
  });
  it('enforces Off and read-only permissions before invoking the shared repository', async () => {
    const workspace = await controller();
    await workspace.create(graph());
    await expect(workspace.external('/diagrams', 'GET')).rejects.toMatchObject({ status: 403 });
    await workspace.setPreference('mcp-access', 'read');
    expect(await workspace.external('/diagrams', 'GET')).toHaveLength(1);
    const before = await snapshot();
    await expect(workspace.external('/diagrams', 'POST', { name: 'Denied' })).rejects.toMatchObject(
      { status: 403 },
    );
    expect(await snapshot()).toEqual(before);
    await workspace.setPreference('mcp-access', 'write');
    await workspace.external('/diagrams', 'POST', { name: 'Allowed' });
    expect(await db.diagrams.count()).toBe(2);
    await workspace.setPreference('mcp-access', 'off');
    await expect(
      workspace.external('/diagrams', 'POST', { name: 'Denied again' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('reveals every collapsed ancestor of a deep search result', async () => {
    const source = graph();
    source.nodes[0].collapsed = true;
    const saved = await repo.importGraph(source),
      workspace = await controller();
    await workspace.open(saved.diagram.id, saved.nodes[1].id);
    await workspace.settled();
    expect(useEditor.getState().graph!.nodes[0].collapsed).toBe(false);
    expect(useEditor.getState().selectedNodes).toEqual([saved.nodes[1].id]);
  });
});
