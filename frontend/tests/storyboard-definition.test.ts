import { describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { autoNumber, getPresentation } from '../src/presentation/definition';
import { presentationSteps } from '../src/presentation/sequence';
import {
  addStoryboardScene,
  getStoryboard,
  moveStoryboardScene,
  pruneStoryboard,
  remapStoryboard,
  removeStoryboardScene,
  setStoryboard,
  updateStoryboardScene,
  validateStoryboard,
  validateStoryboardView,
  type StoryboardScene,
} from '../src/presentation/storyboard';
function fixture() {
  let graph = blankGraph('Truck');
  graph.nodes = [
    newNode(graph.diagram.id, { title: 'Build', description: 'Original build description' }),
    newNode(graph.diagram.id, { title: 'Delivery', x: 700 }),
    newNode(graph.diagram.id, { title: 'Service', x: 1400 }),
  ];
  graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id)];
  graph = autoNumber(graph);
  graph = addStoryboardScene(graph, [graph.nodes[0].id], [graph.edges[0].id], {
    mode: '2d',
    viewport: { x: 20, y: 40, zoom: 0.8 },
  });
  return graph;
}
describe('independent storyboard scenes', () => {
  it('groups selected edge endpoints with stable identity, independent narration and no node/layout changes', () => {
    const graph = fixture(),
      scene = getStoryboard(graph).scenes[0],
      beforeNodes = structuredClone(graph.nodes),
      beforeNumbering = getPresentation(graph);
    expect(scene.nodeIds).toEqual(graph.nodes.slice(0, 2).map((n) => n.id));
    const changed = updateStoryboardScene(graph, scene.id, {
      name: 'Assembly and delivery',
      narration: 'A separately authored story',
      seconds: 17,
    });
    expect(changed.nodes).toEqual(beforeNodes);
    expect(getPresentation(changed)).toEqual(beforeNumbering);
    expect(getStoryboard(changed).scenes[0]).toMatchObject({
      id: scene.id,
      narration: 'A separately authored story',
      seconds: 17,
    });
    expect(graph.nodes[0].description).toBe('Original build description');
    expect(getStoryboard(graph).scenes[0].narration).toBe('');
  });
  it('returns isolated scene/viewport copies so draft edits cannot mutate canonical data', () => {
    const graph = fixture(),
      copy = getStoryboard(graph);
    copy.scenes[0].nodeIds.pop();
    copy.scenes[0].name = 'Unsaved';
    if (copy.scenes[0].view?.mode === '2d') copy.scenes[0].view.viewport.zoom = 2;
    expect(getStoryboard(graph).scenes[0]).toMatchObject({
      name: 'Scene 1',
      view: { mode: '2d', viewport: { zoom: 0.8 } },
    });
  });
  it('moves and deletes stable scenes without changing the numbered player', () => {
    let graph = fixture();
    graph = addStoryboardScene(graph, [graph.nodes[2].id], []);
    const [first, second] = getStoryboard(graph).scenes;
    graph = moveStoryboardScene(graph, second.id, -1);
    expect(getStoryboard(graph).scenes.map((s) => s.id)).toEqual([second.id, first.id]);
    graph = removeStoryboardScene(graph, first.id);
    expect(getStoryboard(graph).scenes.map((s) => s.id)).toEqual([second.id]);
    expect(getPresentation(graph).nodeIds).toHaveLength(3);
  });
  it('prunes deleted nodes/links, removing an empty scene and retaining names/narration/camera', () => {
    let graph = fixture();
    graph = addStoryboardScene(graph, [graph.nodes[2].id], []);
    const first = getStoryboard(graph).scenes[0];
    graph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] };
    graph = pruneStoryboard(graph);
    expect(getStoryboard(graph).scenes).toEqual([
      { ...first, nodeIds: [graph.nodes[0].id], edgeIds: [] },
    ]);
    expect(pruneStoryboard(graph)).toBe(graph);
  });
  it('remaps clone/import object identities and scene IDs while preserving authored text and camera', () => {
    const original = fixture(),
      oldScene = getStoryboard(original).scenes[0],
      nodeMap = new Map(original.nodes.map((n) => [n.id, crypto.randomUUID()])),
      edgeMap = new Map(original.edges.map((e) => [e.id, crypto.randomUUID()]));
    const clone = {
      ...original,
      nodes: original.nodes.map((n) => ({ ...n, id: nodeMap.get(n.id)! })),
      edges: original.edges.map((e) => ({
        ...e,
        id: edgeMap.get(e.id)!,
        sourceNodeId: nodeMap.get(e.sourceNodeId)!,
        targetNodeId: nodeMap.get(e.targetNodeId)!,
      })),
    };
    const mapped = getStoryboard(remapStoryboard(clone, nodeMap, edgeMap)).scenes[0];
    expect(mapped.id).not.toBe(oldScene.id);
    expect(mapped.nodeIds).toEqual(oldScene.nodeIds.map((id) => nodeMap.get(id)));
    expect(mapped.edgeIds).toEqual(oldScene.edgeIds.map((id) => edgeMap.get(id)));
    expect(mapped.view).toEqual(oldScene.view);
  });
  it('keeps default numbered steps and authored scenes as distinct playback sources', () => {
    const graph = fixture();
    expect(presentationSteps(graph, 'nodes')[0]).toMatchObject({
      name: 'Build',
      narration: 'Original build description',
      nodeIds: [graph.nodes[0].id],
    });
    expect(presentationSteps(graph, 'storyboard')[0]).toMatchObject({
      name: 'Scene 1',
      narration: '',
      nodeIds: graph.nodes.slice(0, 2).map((n) => n.id),
    });
  });
  it.each([
    ['unknown field', { surprise: true }],
    ['missing name', { name: '' }],
    ['long narration', { narration: 'x'.repeat(12001) }],
    ['no objects', { nodeIds: [] }],
    ['foreign node', { nodeIds: [crypto.randomUUID()] }],
    ['duplicate node', { nodeIds: ['duplicate', 'duplicate'] }],
    ['invalid duration', { seconds: 1 }],
    ['NaN transition', { transitionMs: NaN }],
    ['unknown view', { view: { mode: '4d' } }],
  ])('rejects %s before persistence', (_label, patch) => {
    const graph = fixture(),
      definition = getStoryboard(graph);
    definition.scenes[0] = { ...definition.scenes[0], ...patch } as StoryboardScene;
    expect(() => setStoryboard(graph, definition)).toThrow();
  });
  it('rejects duplicate scene IDs, foreign links and excessive references', () => {
    const graph = fixture(),
      scene = getStoryboard(graph).scenes[0];
    expect(() => validateStoryboard({ version: 1, scenes: [scene, scene] }, graph)).toThrow(
      /unique UUID/,
    );
    expect(() =>
      validateStoryboard(
        { version: 1, scenes: [{ ...scene, edgeIds: [crypto.randomUUID()] }] },
        graph,
      ),
    ).toThrow(/edgeIds/);
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    expect(() =>
      validateStoryboard({
        version: 1,
        scenes: Array.from({ length: 1000 }, () => ({
          ...scene,
          id: crypto.randomUUID(),
          nodeIds: ids,
          edgeIds: [],
        })),
      }),
    ).toThrow(/100,000/);
  });
  it('validates saved view bounds, 3D roll and camera/target separation', () => {
    expect(() =>
      validateStoryboardView({ mode: '2d', viewport: { x: 0, y: 0, zoom: 0 } }),
    ).toThrow();
    expect(() =>
      validateStoryboardView({ mode: '2d', viewport: { x: Infinity, y: 0, zoom: 1 } }),
    ).toThrow();
    expect(() =>
      validateStoryboardView({
        mode: '3d',
        camera: {
          position: { x: 0, y: 0, z: 3 },
          target: { x: 0, y: 0, z: 0 },
          up: { x: 1, y: 0, z: 0 },
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateStoryboardView({
        mode: '3d',
        camera: { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } },
      }),
    ).toThrow();
  });
});
