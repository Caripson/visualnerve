import { afterEach, expect, it, vi } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { autoNumber } from '../src/presentation/definition';
import {
  addStoryboardScene,
  getStoryboard,
  setStoryboard,
  updateStoryboardScene,
} from '../src/presentation/storyboard';
import { PresentationPlayer, type PlayerDependencies } from '../src/presentation/runtime';
function setup() {
  let graph = blankGraph('Truck');
  graph.nodes = [
    newNode(graph.diagram.id, { description: 'Original node description' }),
    newNode(graph.diagram.id),
    newNode(graph.diagram.id),
  ];
  graph.edges = [newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id)];
  graph = autoNumber(graph);
  graph = addStoryboardScene(graph, [graph.nodes[0].id, graph.nodes[1].id], [graph.edges[0].id], {
    mode: '3d',
    camera: { position: { x: 2, y: 3, z: 10 }, target: { x: 0, y: 0, z: 0 } },
  });
  graph = addStoryboardScene(graph, [graph.nodes[2].id], []);
  let scenes = getStoryboard(graph).scenes;
  graph = updateStoryboardScene(graph, scenes[0].id, {
    name: 'Overview',
    narration: 'Authored scene narration',
    seconds: 2,
    transitionMs: 500,
  });
  graph = updateStoryboardScene(graph, scenes[1].id, { narration: 'Service story', seconds: 7 });
  scenes = getStoryboard(graph).scenes;
  const deps: PlayerDependencies = {
    graph: () => graph,
    voice: async () => 'en_US-ljspeech-high',
    prepare: vi.fn(async () => new Blob(['wav'])),
    preloadVoice: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    focusStep: vi.fn(async () => undefined),
    cancelCamera: vi.fn(),
    releaseHighlight: vi.fn(),
    narration: {
      unlock: vi.fn(async () => undefined),
      play: vi.fn(async () => 4),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    },
  };
  return {
    graph,
    scenes,
    deps,
    player: new PresentationPlayer(deps),
    change: (g: typeof graph) => {
      graph = g;
    },
  };
}
async function settle() {
  for (let i = 0; i < 48; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());
it('plays authored multi-object scene narration, saved camera, and scene duration without editing descriptions', async () => {
  vi.useFakeTimers();
  const { player, deps, graph, scenes } = setup(),
    before = JSON.stringify(graph);
  player.open('storyboard');
  player.options({ audio: true });
  await player.play();
  await settle();
  expect(player.getState()).toMatchObject({
    source: 'storyboard',
    sceneId: scenes[0].id,
    nodeId: graph.nodes[0].id,
    nodeIds: scenes[0].nodeIds,
    edgeIds: scenes[0].edgeIds,
    title: 'Overview',
    narration: 'Authored scene narration',
    status: 'playing',
  });
  expect(deps.prepare).toHaveBeenCalledWith(
    'Authored scene narration',
    'en_US-ljspeech-high',
    expect.any(AbortSignal),
    expect.any(Function),
    { priority: 'foreground' },
  );
  expect(deps.focusStep).toHaveBeenCalledWith(scenes[0], expect.any(AbortSignal));
  expect(deps.focus).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3999);
  expect(player.getState().sceneId).toBe(scenes[0].id);
  await vi.advanceTimersByTimeAsync(1);
  expect(player.getState().sceneId).toBe(scenes[1].id);
  expect(JSON.stringify(graph)).toBe(before);
  player.close();
  expect(deps.releaseHighlight).toHaveBeenCalled();
});
it('preloads the complete authored storyboard narration', async () => {
  const { player, deps } = setup();
  player.open('storyboard');
  await player.preload();
  await settle();
  expect(player.getState().message).toBe('Preload 100% · 2/2 steps ready.');
  expect(deps.prepare).toHaveBeenCalledTimes(2);
  expect(vi.mocked(deps.prepare).mock.calls.map((args) => args[0])).toEqual([
    'Authored scene narration',
    'Service story',
  ]);
  player.close();
});
it('preserves scene identity through reordering, cancels stale audio and clears temporary highlights on edits', async () => {
  const { player, deps, graph, scenes, change } = setup();
  player.open('storyboard');
  player.seek(1);
  await settle();
  expect(player.getState().sceneId).toBe(scenes[1].id);
  change(setStoryboard(graph, { version: 1, scenes: [scenes[1], scenes[0]] }));
  player.changed();
  expect(player.getState()).toMatchObject({ index: 0, sceneId: scenes[1].id, total: 2 });
  expect(deps.releaseHighlight).toHaveBeenCalled();
  player.close();
});
it('keeps the legacy numbered source as the default and validates scene seek bounds', async () => {
  const { player, graph } = setup();
  player.open();
  expect(player.getState()).toMatchObject({
    source: 'nodes',
    sceneId: null,
    nodeId: graph.nodes[0].id,
    total: 3,
  });
  expect(() => player.seek(-1)).toThrow(/index/);
  expect(() => player.seek(3)).toThrow(/index/);
  player.open('storyboard');
  expect(player.getState().total).toBe(2);
  player.close();
});
