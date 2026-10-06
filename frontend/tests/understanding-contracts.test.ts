import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { blankGraph, newEdge, newNode, type Graph } from '../src/model/types';
import { assertMcpAccess } from '../src/integration/access';

let db: WorkspaceDatabase, repo: Repository, graph: Graph;
beforeEach(async () => {
  db = new WorkspaceDatabase(`understanding-${crypto.randomUUID()}`);
  repo = new Repository(db);
  graph = blankGraph('Truck lifecycle', 'dependency');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build', tags: ['factory'] }),
    newNode(graph.diagram.id, { title: 'Operate', tags: ['fleet'] }),
    newNode(graph.diagram.id, { title: 'Service', tags: ['fleet'] }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id),
    newEdge(graph.diagram.id, graph.nodes[1].id, graph.nodes[2].id),
  ];
  graph = await repo.saveGraph(graph, 0);
});
afterEach(async () => {
  db.close();
  await db.delete();
});
const endpoint = (action: string) => `/diagrams/${graph.diagram.id}/${action}`;
describe('Unified understanding API contracts', () => {
  it('allows only exact read-only question/brief previews, keeping mutations protected', () => {
    for (const action of ['questions', 'build-brief']) {
      expect(() => assertMcpAccess('read', endpoint(action), 'POST')).not.toThrow();
      expect(() => assertMcpAccess('read', `${endpoint(action)}/extra`, 'POST')).toThrow();
      expect(() => assertMcpAccess('read', `${endpoint(action)}?save=true`, 'POST')).toThrow();
    }
    for (const action of ['overview', 'storyboard', 'build-specification', 'history'])
      expect(() => assertMcpAccess('read', endpoint(action), 'PUT')).toThrow();
    expect(() => assertMcpAccess('off', endpoint('questions'), 'POST')).toThrow();
  });
  it('reads complete multi-level answers without writing the graph', async () => {
    const result = await repo.request<{ total: number; answers: { edgeIds: string[] }[] }>(
      endpoint('questions'),
      'POST',
      { startId: graph.nodes[0].id, kind: 'downstream', maxDepth: 8 },
    );
    expect(result.total).toBe(2);
    expect(result.answers[1].edgeIds).toEqual(graph.edges.map((edge) => edge.id));
    expect((await repo.getGraph(graph.diagram.id)).diagram.version).toBe(graph.diagram.version);
  });
  it('updates overview transactionally and returns view-only mappings at the same version', async () => {
    const config = { version: 1, enabled: true, grouping: 'tags', expanded: [] };
    const saved = await repo.request<Graph>(endpoint('overview'), 'PUT', {
      baseVersion: graph.diagram.version,
      overview: config,
    });
    expect(saved.nodes).toEqual(graph.nodes);
    expect(saved.edges).toEqual(graph.edges);
    const projection = await repo.request<{
      nodeMap: Record<string, string>;
      counts: { originalNodes: number };
    }>(`${endpoint('overview')}/projection?zoom=0.1`);
    expect(projection.counts.originalNodes).toBe(3);
    expect(Object.keys(projection.nodeMap)).toHaveLength(3);
    await expect(
      repo.request(endpoint('overview'), 'PUT', {
        baseVersion: graph.diagram.version,
        overview: config,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(repo.request(`${endpoint('overview')}/projection?zoom=0`)).rejects.toThrow();
  });
  it('keeps scene references and reviewed answers linked after importing a colliding graph', async () => {
    const scene = {
      id: crypto.randomUUID(),
      name: 'Truck lifecycle overview',
      nodeIds: graph.nodes.map((node) => node.id),
      edgeIds: graph.edges.map((edge) => edge.id),
      narration: 'From manufacture to service.',
      seconds: 8,
      transitionMs: 1200,
    };
    graph = await repo.request<Graph>(endpoint('storyboard'), 'PUT', {
      baseVersion: graph.diagram.version,
      storyboard: { version: 1, scenes: [scene] },
    });
    graph = await repo.request<Graph>(endpoint('build-specification'), 'PUT', {
      baseVersion: graph.diagram.version,
      specification: {
        version: 1,
        sections: { screens: 'Show fleet status.' },
        answers: { [`screen:${graph.nodes[0].id}`]: 'Factory dashboard' },
      },
    });
    const copy = await repo.importGraph(graph);
    const copiedScene = (copy.diagram.settings.storyboard as { scenes: (typeof scene)[] })
      .scenes[0];
    expect(copiedScene.nodeIds).toEqual(copy.nodes.map((node) => node.id));
    expect(copiedScene.edgeIds).toEqual(copy.edges.map((edge) => edge.id));
    expect(copiedScene.id).not.toBe(scene.id);
    const answers = (
      copy.diagram.settings.buildSpecification as { answers: Record<string, string> }
    ).answers;
    expect(answers[`screen:${copy.nodes[0].id}`]).toBe('Factory dashboard');
    expect(answers[`screen:${graph.nodes[0].id}`]).toBeUndefined();
  });
  it('preserves current work during a version-checked restore and portable backup', async () => {
    const snapshot = await repo.request<{ id: string }>(endpoint('history'), 'POST', {
      name: 'Initial lifecycle',
      baseVersion: graph.diagram.version,
    });
    const initialTitle = graph.nodes[0].title;
    graph = await repo.saveGraph(
      {
        ...graph,
        nodes: graph.nodes.map((node, index) =>
          index === 0 ? { ...node, title: 'Changed factory step' } : node,
        ),
      },
      graph.diagram.version,
    );
    const comparison = await repo.request<{
      counts: { node: { changed: number } };
      currentVersion: number;
    }>(`${endpoint('history')}/${snapshot.id}/compare`);
    expect(comparison.counts.node.changed).toBe(1);
    const restored = await repo.request<{ graph: Graph; safetySnapshot: { id: string } }>(
      `${endpoint('history')}/${snapshot.id}/restore`,
      'POST',
      { baseVersion: comparison.currentVersion },
    );
    expect(restored.graph.nodes[0].title).toBe(initialTitle);
    const savedCurrent = await repo.history.read(graph.diagram.id, restored.safetySnapshot.id);
    expect(savedCurrent.graph.nodes[0].title).toBe('Changed factory step');
    const backup = await db.backup();
    const imported = await repo.restore(backup, 'merge');
    const copied = imported.find((item) => item.diagram.id !== graph.diagram.id)!;
    expect(await repo.history.list(copied.diagram.id)).toHaveLength(2);
    await repo.removeDiagram(copied.diagram.id);
    expect(await db.historySnapshots.where('diagramId').equals(copied.diagram.id).count()).toBe(0);
  });
  it('previews a complete build brief without sending or persisting it', async () => {
    const response = await repo.request<{ text: string; specification: { unresolved: number } }>(
      endpoint('build-brief'),
      'POST',
      { scope: 'diagram', instructions: 'Build a fleet workflow.' },
    );
    expect(response.text).toContain('Build a fleet workflow.');
    expect(response.specification.unresolved).toBeGreaterThan(0);
    expect((await repo.getGraph(graph.diagram.id)).diagram.version).toBe(graph.diagram.version);
    await expect(
      repo.request(endpoint('build-brief'), 'POST', { scope: 'selected' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
