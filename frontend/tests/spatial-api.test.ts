import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankGraph, newNode, type Graph } from '../src/model/types';
import {
  getSpatialNode,
  getSpatialView,
  setSpatialView,
  type SpatialCamera,
} from '../src/spatial/types';
import { orientationCamera } from '../src/spatial/layout';
import { createSpatialExample } from '../src/spatial/examples';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';

let db: WorkspaceDatabase;
let repo: Repository;
const controllers: Workspace[] = [];
beforeEach(async () => {
  db = new WorkspaceDatabase(`spatial-api-${crypto.randomUUID()}`);
  repo = new Repository(db);
  useEditor.getState().setGraph(null);
  useEditor.setState({ mcpAccess: 'off', status: 'saved', message: '', owners: [], diagrams: [] });
  await db.initialize();
});
afterEach(async () => {
  for (const workspace of controllers) workspace.stop();
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
async function controller(consent = true) {
  const workspace = new Workspace(repo);
  controllers.push(workspace);
  if (consent) await db.settings.put({ key: 'storage-consent', value: true });
  await workspace.start();
  return workspace;
}

function pendingCamera(diagramId: string, camera: SpatialCamera) {
  let pending = true;
  let flushes = 0;
  const flush = () => {
    flushes++;
    const state = useEditor.getState();
    if (!pending || state.graph?.diagram.id !== diagramId) return;
    pending = false;
    state.command('Pending renderer camera', (graph) => setSpatialView(graph, { camera }), true);
  };
  window.addEventListener('visualnerve:spatial-camera-flush', flush);
  return {
    flushes: () => flushes,
    remove: () => window.removeEventListener('visualnerve:spatial-camera-flush', flush),
  };
}

describe('transactional spatial diagram API', () => {
  it('creates a persisted 3D mind map and lets MCP add and annotate ordinary canonical objects', async () => {
    const graph = await repo.request<Graph>('/spatial-diagrams', 'POST', {
      name: 'Explore a project',
    });
    expect(graph.diagram.name).toBe('Explore a project');
    expect(graph.diagram.type).toBe('mindmap');
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(getSpatialView(graph)).toEqual({ version: 1, mode: '3d' });
    expect(await repo.getGraph(graph.diagram.id)).toEqual(graph);
    const node = await repo.request<Graph['nodes'][number]>(
      `/diagrams/${graph.diagram.id}/nodes`,
      'POST',
      {
        title: 'Work area',
        x: 390,
        y: 40,
        metadata: { spatial: { version: 1, position: { x: -2, y: 1, z: 3 } } },
      },
    );
    const edited = await repo.request<Graph['nodes'][number]>(`/nodes/${node.id}`, 'PATCH', {
      version: node.version,
      notes: 'Explain this topic from the front',
      status: 'done',
      metadata: { spatial: { ...getSpatialNode(node), position: { x: 2, y: 1, z: 3 } } },
    });
    expect(edited.x).toBe(node.x);
    expect(edited.y).toBe(node.y);
    expect(edited.metadata.spatial).toEqual({
      ...getSpatialNode(node),
      position: { x: 2, y: 1, z: 3 },
    });
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].notes).toBe(
      'Explain this topic from the front',
    );
  });

  it('creates a blank 3D graph through the API prefix and supports existing bulk object and connection creation', async () => {
    const graph = await repo.request<Graph>('/api/v1/spatial-diagrams', 'POST', {
      name: 'Workflow in space',
      type: 'process',
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.diagram.type).toBe('process');
    expect(getSpatialView(graph)).toMatchObject({ mode: '3d' });
    const linked = await repo.bulk(graph.diagram.id, {
      nodes: [
        {
          externalId: 'idea',
          title: 'Idea',
          x: 50,
          y: 100,
          metadata: { spatial: { version: 1, position: { x: 0, y: 1, z: 2 } } },
        },
        {
          externalId: 'build',
          title: 'Build',
          x: 350,
          y: 100,
          metadata: { spatial: { version: 1, position: { x: 2, y: 1, z: 2 } } },
        },
      ],
      edges: [{ sourceExternalId: 'idea', targetExternalId: 'build', label: 'next' }],
    });
    expect(linked.edges[0].sourceNodeId).toBe(linked.nodes[0].id);
    expect(getSpatialNode(linked.nodes[1])?.position).toEqual({ x: 2, y: 1, z: 2 });
    expect(linked.nodes.map((node) => [node.x, node.y])).toEqual([
      [50, 100],
      [350, 100],
    ]);
  });

  it.each([
    { name: '' },
    { name: '  ' },
    { name: 'x'.repeat(501) },
    { name: 4 },
    { type: 'mindmap' },
    { name: 'Unexpected scene', scene: 'graph' },
    { name: 'Unknown type', type: 'unsupported' },
    { name: 'Unexpected payload', camera: { x: 0, y: 0, z: 0 } },
    { name: 'Injected identity', id: crypto.randomUUID() },
    null,
    [],
  ])('rejects invalid creation payloads without writing any workspace records', async (payload) => {
    const before = await snapshot();
    await expect(repo.request('/spatial-diagrams', 'POST', payload)).rejects.toMatchObject({
      status: payload && !Array.isArray(payload) ? 422 : 400,
    });
    expect(await snapshot()).toEqual(before);
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])(
    'rejects %s at the creation endpoint without writes',
    async (method) => {
      const before = await snapshot();
      await expect(
        repo.request('/spatial-diagrams', method, { name: 'Denied' }),
      ).rejects.toMatchObject({ status: 405 });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    '/spatial-diagrams/extra',
    '/spatial-diagrams/extra/deeper',
    '/spatial-diagrams/',
    '/spatial-diagrams?extra=true',
    '/api/v1spatial-diagrams',
    '/spatial-diagrams#ignored',
  ])('rejects unsupported endpoint %s without writes', async (path) => {
    const before = await snapshot();
    await expect(repo.request(path, 'POST', { name: 'Denied' })).rejects.toMatchObject({
      status: 404,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('preserves both layouts, camera and explanations through backup merge and replacement, rejecting malformed backups atomically', async () => {
    const graph = await repo.importGraph(createSpatialExample('Portable project'));
    const camera = orientationCamera('back', { x: 0, y: 0.5, z: 0 });
    graph.diagram.settings.spatialView = { ...getSpatialView(graph), mode: '2d', camera };
    graph.nodes[1].notes = 'Current explanation';
    graph.nodes[1].status = 'done';
    await repo.saveGraph(graph, graph.diagram.version);
    const backup = await db.backup();
    const merged = await repo.restore(backup, 'merge');
    expect(merged[0].diagram.id).not.toBe(graph.diagram.id);
    expect(merged[0].nodes[1].parentId).toBe(merged[0].nodes[0].id);
    expect(merged[0].diagram.settings.spatialView).toEqual(graph.diagram.settings.spatialView);
    expect(merged[0].nodes[1].metadata.spatial).toEqual(graph.nodes[1].metadata.spatial);
    expect(merged[0].nodes[1].notes).toBe('Current explanation');
    expect(merged[0].nodes.map((node) => [node.x, node.y])).toEqual(
      graph.nodes.map((node) => [node.x, node.y]),
    );
    const before = await snapshot();
    const invalid = structuredClone(backup);
    invalid.nodes[1].metadata.spatial = { version: 1, position: { x: 0, y: 0, z: Infinity } };
    await expect(repo.restore(invalid, 'replace')).rejects.toMatchObject({ status: 422 });
    expect(await snapshot()).toEqual(before);
    const restored = await repo.restore(backup, 'replace');
    expect(await db.diagrams.count()).toBe(1);
    expect(restored[0].diagram.id).toBe(graph.diagram.id);
    expect(getSpatialView(await repo.getGraph(graph.diagram.id))).toMatchObject({
      mode: '2d',
      camera,
    });
    db.close();
    await db.open();
    expect((await repo.getGraph(graph.diagram.id)).nodes[1].status).toBe('done');
  });
});

describe('browser-owned spatial MCP capability', () => {
  it('commits a pending renderer camera into an immediate backup without changing the 2D diagram', async () => {
    const workspace = await controller();
    const graph = createSpatialExample('Immediate portable view');
    graph.diagram.settings.viewport = { x: 41, y: -28, zoom: 0.75 };
    graph.diagram.settings.drawing = {
      version: 1,
      visible: true,
      strokes: [
        {
          id: crypto.randomUUID(),
          color: '#e85d3f',
          width: 3,
          points: [
            [10, 20],
            [30, 40],
          ],
        },
      ],
    };
    await workspace.create(graph);
    const stored = await repo.getGraph(graph.diagram.id);
    const camera = orientationCamera('right');
    const pending = pendingCamera(graph.diagram.id, camera);
    try {
      expect(getSpatialView(stored).camera).toBeUndefined();
      const backup = await workspace.backup();
      const portable = backup.diagrams.find((diagram) => diagram.id === graph.diagram.id)!;
      expect(pending.flushes()).toBe(1);
      expect(portable.settings.spatialView).toEqual({ version: 1, mode: '3d', camera });
      expect(portable.settings.viewport).toEqual(stored.diagram.settings.viewport);
      expect(portable.settings.drawing).toEqual(stored.diagram.settings.drawing);
      for (const node of stored.nodes)
        expect(backup.nodes.find((entry) => entry.id === node.id)).toEqual(node);
      for (const edge of stored.edges)
        expect(backup.edges.find((entry) => entry.id === edge.id)).toEqual(edge);
      expect(getSpatialView(await repo.getGraph(graph.diagram.id)).camera).toEqual(camera);
      expect(useEditor.getState().status).toBe('saved');
    } finally {
      pending.remove();
    }
  });

  it('preserves the current project pending camera when merging an older backup and opening its imported copy', async () => {
    const workspace = await controller();
    const oldCamera = orientationCamera('front');
    const graph = setSpatialView(createSpatialExample('Rotate before merge'), {
      camera: oldCamera,
    });
    await workspace.create(graph);
    const stored = await repo.getGraph(graph.diagram.id);
    const backup = await db.backup();
    const camera = orientationCamera('left');
    const pending = pendingCamera(graph.diagram.id, camera);
    try {
      await workspace.restoreBackup(backup, 'merge');
      const original = await repo.getGraph(graph.diagram.id);
      const imported = useEditor.getState().graph!;
      expect(pending.flushes()).toBeGreaterThanOrEqual(1);
      expect(getSpatialView(original).camera).toEqual(camera);
      expect(original.nodes).toEqual(stored.nodes);
      expect(original.edges).toEqual(stored.edges);
      expect(imported.diagram.id).not.toBe(graph.diagram.id);
      expect(getSpatialView(imported).camera).toEqual(oldCamera);
      expect(getSpatialView(await repo.getGraph(imported.diagram.id)).camera).toEqual(oldCamera);
      expect(await db.diagrams.count()).toBe(2);
      expect(useEditor.getState().status).toBe('saved');
    } finally {
      pending.remove();
    }
  });

  it('keeps a read-only MCP GET non-mutating while a renderer camera is pending', async () => {
    const workspace = await controller();
    await workspace.create(createSpatialExample('Read without camera writes'));
    await workspace.setPreference('mcp-access', 'read');
    const graph = useEditor.getState().graph!;
    const before = await snapshot();
    const history = useEditor.getState().history;
    const pending = pendingCamera(graph.diagram.id, orientationCamera('back'));
    try {
      const result = await workspace.external<Graph>(`/diagrams/${graph.diagram.id}`, 'GET');
      expect(pending.flushes()).toBe(0);
      expect(getSpatialView(result).camera).toBeUndefined();
      expect(getSpatialView(useEditor.getState().graph!).camera).toBeUndefined();
      expect(useEditor.getState().history).toBe(history);
      expect(await snapshot()).toEqual(before);
    } finally {
      pending.remove();
    }
  });

  it('flushes the last camera before ordinary project navigation and preserves inline edits when creating a local project', async () => {
    const workspace = await controller();
    const first = blankGraph('Existing project');
    first.nodes = [newNode(first.diagram.id, { title: 'Original inline title' })];
    await workspace.create(first);
    useEditor.getState().beginEditing(first.nodes[0].id);
    useEditor.setState({ editingTitle: 'Preserved when creating' });
    await workspace.create(blankGraph('Local new project'));
    expect((await repo.getGraph(first.diagram.id)).nodes[0].title).toBe('Preserved when creating');
    await workspace.setPreference('mcp-access', 'write');
    const spatial = await workspace.external<Graph>('/spatial-diagrams', 'POST', {
      name: 'Rotate then navigate',
    });
    const camera = orientationCamera('left');
    let flushed = 0;
    const flush = () => {
      flushed++;
      useEditor.getState().command('Final navigation camera', (graph) => ({
        ...graph,
        diagram: {
          ...graph.diagram,
          settings: {
            ...graph.diagram.settings,
            spatialView: { ...getSpatialView(graph), camera },
          },
        },
      }));
    };
    window.addEventListener('visualnerve:spatial-camera-flush', flush);
    try {
      await workspace.open(first.diagram.id);
      expect(flushed).toBe(1);
      expect(getSpatialView(await repo.getGraph(spatial.diagram.id)).camera).toEqual(camera);
      expect(useEditor.getState().graph?.diagram.id).toBe(first.diagram.id);
      expect(getSpatialView(useEditor.getState().graph!).mode).toBe('2d');
      await workspace.open(spatial.diagram.id);
      expect(flushed).toBe(1);
      expect(getSpatialView(useEditor.getState().graph!).camera).toEqual(camera);
    } finally {
      window.removeEventListener('visualnerve:spatial-camera-flush', flush);
    }
  });

  it('settles inline titles before a mode change and rejects an outdated version instead of overwriting the title', async () => {
    const workspace = await controller();
    const graph = blankGraph('Editing during MCP mode change');
    graph.nodes = [newNode(graph.diagram.id, { title: 'Original title', x: 140, y: 230 })];
    await workspace.create(graph);
    await workspace.setPreference('mcp-access', 'write');
    const original = useEditor.getState().graph!;
    useEditor.getState().beginEditing(original.nodes[0].id);
    useEditor.setState({ editingTitle: 'Unsaved inline explanation' });
    const settings = {
      ...original.diagram.settings,
      spatialView: { version: 1, mode: '3d' },
    };
    await expect(
      workspace.external(`/diagrams/${graph.diagram.id}`, 'PATCH', {
        version: original.diagram.version,
        settings,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(useEditor.getState().editingNode).toBeNull();
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe(
      'Unsaved inline explanation',
    );
    const saved = await repo.getGraph(graph.diagram.id);
    await workspace.external(`/diagrams/${graph.diagram.id}`, 'PATCH', {
      version: saved.diagram.version,
      settings,
    });
    expect(getSpatialView(useEditor.getState().graph!).mode).toBe('3d');
    expect(useEditor.getState().graph!.nodes[0]).toMatchObject({
      title: 'Unsaved inline explanation',
      x: 140,
      y: 230,
    });
  });

  it('disables the pen before a versioned whole-graph mode change while preserving existing ink', async () => {
    const workspace = await controller();
    await workspace.create(blankGraph('Drawing during MCP mode change'));
    await workspace.setPreference('mcp-access', 'write');
    useEditor.getState().setDrawingTool('pen');
    useEditor.getState().addDrawingStroke({
      id: crypto.randomUUID(),
      color: '#e85d3f',
      width: 3,
      points: [
        [10, 20],
        [30, 40],
      ],
    });
    await workspace.settled();
    const current = structuredClone(useEditor.getState().graph!);
    const drawing = structuredClone(current.diagram.settings.drawing);
    current.diagram.settings.spatialView = { version: 1, mode: '3d' };
    await workspace.external(`/diagrams/${current.diagram.id}/graph`, 'PUT', {
      graph: current,
      baseVersion: current.diagram.version,
    });
    expect(useEditor.getState().drawingTool).toBe('none');
    expect(getSpatialView(useEditor.getState().graph!).mode).toBe('3d');
    expect(useEditor.getState().graph!.diagram.settings.drawing).toEqual(drawing);
    expect((await repo.getGraph(current.diagram.id)).diagram.settings.drawing).toEqual(drawing);
  });

  it('leaves the inline draft untouched when MCP lacks permission to change views', async () => {
    const workspace = await controller();
    const graph = blankGraph('Permission protects editing');
    graph.nodes = [newNode(graph.diagram.id, { title: 'Original' })];
    await workspace.create(graph);
    await workspace.setPreference('mcp-access', 'read');
    useEditor.getState().beginEditing(graph.nodes[0].id);
    useEditor.setState({ editingTitle: 'Still editing' });
    const current = useEditor.getState().graph!;
    await expect(
      workspace.external(`/diagrams/${graph.diagram.id}`, 'PATCH', {
        version: current.diagram.version,
        settings: {
          ...current.diagram.settings,
          spatialView: { version: 1, mode: '3d' },
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(useEditor.getState().editingTitle).toBe('Still editing');
    expect(useEditor.getState().editingNode).toBe(graph.nodes[0].id);
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
  });

  it('flushes a pending 3D camera before external creation opens the next diagram', async () => {
    const workspace = await controller();
    await workspace.setPreference('mcp-access', 'write');
    const old = await workspace.external<Graph>('/spatial-diagrams', 'POST', {
      name: 'Old spatial view',
    });
    const camera = orientationCamera('back');
    const flush = () =>
      useEditor.getState().command('Pending camera position', (graph) => ({
        ...graph,
        diagram: {
          ...graph.diagram,
          settings: {
            ...graph.diagram.settings,
            spatialView: { ...getSpatialView(graph), camera },
          },
        },
      }));
    window.addEventListener('visualnerve:spatial-camera-flush', flush);
    try {
      const next = await workspace.external<Graph>('/spatial-diagrams', 'POST', {
        name: 'New spatial view',
      });
      expect(useEditor.getState().graph?.diagram.id).toBe(next.diagram.id);
      expect(getSpatialView(await repo.getGraph(old.diagram.id)).camera).toEqual(camera);
    } finally {
      window.removeEventListener('visualnerve:spatial-camera-flush', flush);
    }
  });

  it('blocks creation before local storage consent even if an in-memory MCP grant was set', async () => {
    const workspace = await controller(false);
    await db.settings.put({ key: 'mcp-access', value: 'write' });
    useEditor.setState({ mcpAccess: 'write' });
    await expect(
      workspace.external('/spatial-diagrams', 'POST', { name: 'Denied' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.diagrams.count()).toBe(0);
    expect(useEditor.getState().graph).toBeNull();
  });

  it('requires both current and committed write grants and automatically opens a successfully created 3D diagram', async () => {
    const workspace = await controller();
    await expect(
      workspace.external('/spatial-diagrams', 'POST', { name: 'Denied' }),
    ).rejects.toMatchObject({ status: 403 });
    await workspace.setPreference('mcp-access', 'read');
    await expect(
      workspace.external('/spatial-diagrams', 'POST', { name: 'Read only' }),
    ).rejects.toMatchObject({ status: 403 });
    await workspace.setPreference('mcp-access', 'write');
    await db.settings.put({ key: 'mcp-access', value: 'off' });
    useEditor.setState({ mcpAccess: 'write' });
    await expect(
      workspace.external('/spatial-diagrams', 'POST', { name: 'Revoked' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.diagrams.count()).toBe(0);
    await workspace.setPreference('mcp-access', 'write');
    const created = await workspace.external<Graph>('/spatial-diagrams', 'POST', {
      name: 'Allowed diagram',
    });
    expect(useEditor.getState().graph?.diagram.id).toBe(created.diagram.id);
    expect(getSpatialView(useEditor.getState().graph!)).toMatchObject({
      mode: '3d',
    });
    expect(useEditor.getState().status).toBe('saved');
    expect((await db.settings.get('last-diagram'))?.value).toBe(created.diagram.id);
  });

  it('settles previous edits before opening a new 3D graph and saves subsequent spatial edits through the same editor history', async () => {
    const workspace = await controller();
    const old = blankGraph('Existing 2D diagram');
    old.nodes = [newNode(old.diagram.id, { title: 'Keep this object' })];
    await workspace.create(old);
    await workspace.setPreference('mcp-access', 'write');
    useEditor.getState().updateNode(old.nodes[0].id, { notes: 'Pending edit before MCP creation' });
    useEditor.getState().beginEditing(old.nodes[0].id);
    useEditor.setState({ editingTitle: 'Pending inline title' });
    const created = await workspace.external<Graph>('/api/v1/spatial-diagrams', 'POST', {
      name: 'New 3D work',
      type: 'mindmap',
    });
    expect((await repo.getGraph(old.diagram.id)).nodes[0].notes).toBe(
      'Pending edit before MCP creation',
    );
    expect((await repo.getGraph(old.diagram.id)).nodes[0].title).toBe('Pending inline title');
    expect(useEditor.getState().editingNode).toBeNull();
    expect(useEditor.getState().graph?.diagram.id).toBe(created.diagram.id);
    useEditor.getState().command('Switch to 2D', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: {
          ...graph.diagram.settings,
          spatialView: {
            ...getSpatialView(graph),
            mode: '2d',
            camera: orientationCamera('front'),
          },
        },
      },
    }));
    await workspace.settled();
    expect(getSpatialView(await repo.getGraph(created.diagram.id)).mode).toBe('2d');
    useEditor.getState().undo();
    await workspace.settled();
    expect(getSpatialView(await repo.getGraph(created.diagram.id)).mode).toBe('3d');
    await workspace.open(old.diagram.id);
    expect(getSpatialView(useEditor.getState().graph!).mode).toBe('2d');
  });
});
