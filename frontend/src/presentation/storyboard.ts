import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { validateSpatialCamera, type SpatialCamera } from '../spatial/types';

export type PresentationSource = 'nodes' | 'storyboard';
export type StoryboardView =
  | { mode: '2d'; viewport: { x: number; y: number; zoom: number } }
  | { mode: '3d'; camera: SpatialCamera };
export interface StoryboardScene {
  id: string;
  name: string;
  nodeIds: string[];
  edgeIds: string[];
  narration: string;
  seconds: number;
  transitionMs: number;
  view?: StoryboardView;
}
export interface StoryboardDefinition {
  version: 1;
  scenes: StoryboardScene[];
}
export const STORYBOARD_SCENE_LIMIT = 1000;
export const STORYBOARD_NARRATION_LIMIT = 12000;
export const STORYBOARD_REFERENCE_LIMIT = 100000;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
function fail(message: string): never {
  throw new StorageError(422, message);
}
export function validateStoryboardView(value: unknown): asserts value is StoryboardView {
  if (!object(value)) fail('A storyboard view must be a saved 2D viewport or 3D camera.');
  if (value.mode === '2d') {
    const viewport = value.viewport;
    if (
      !exact(value, ['mode', 'viewport']) ||
      !object(viewport) ||
      !exact(viewport, ['x', 'y', 'zoom']) ||
      !['x', 'y', 'zoom'].every(
        (key) => typeof viewport[key] === 'number' && Number.isFinite(viewport[key]),
      ) ||
      Math.abs(viewport.x as number) > 10000000 ||
      Math.abs(viewport.y as number) > 10000000 ||
      (viewport.zoom as number) < 0.01 ||
      (viewport.zoom as number) > 100
    )
      fail('Storyboard viewport needs finite x/y within ±10,000,000 and zoom from 0.01 to 100.');
  } else if (value.mode === '3d') {
    if (!exact(value, ['mode', 'camera'])) fail('Unsupported storyboard camera fields.');
    try {
      validateSpatialCamera(value.camera);
    } catch (error) {
      fail((error as Error).message);
    }
  } else fail('Storyboard view mode must be 2d or 3d.');
}
export function validateStoryboard(
  value: unknown,
  graph?: Pick<Graph, 'nodes' | 'edges'>,
): asserts value is StoryboardDefinition {
  if (
    !object(value) ||
    !exact(value, ['version', 'scenes']) ||
    value.version !== 1 ||
    !Array.isArray(value.scenes) ||
    value.scenes.length > STORYBOARD_SCENE_LIMIT
  )
    fail('Storyboard version 1 supports at most 1,000 scenes.');
  const sceneIds = new Set<string>(),
    nodes = graph && new Set(graph.nodes.map((node) => node.id)),
    edges = graph && new Set(graph.edges.map((edge) => edge.id));
  let references = 0;
  for (const valueScene of value.scenes) {
    if (
      !object(valueScene) ||
      !exact(valueScene, [
        'id',
        'name',
        'nodeIds',
        'edgeIds',
        'narration',
        'seconds',
        'transitionMs',
        'view',
      ])
    )
      fail('Unsupported storyboard scene fields.');
    const scene = valueScene as unknown as StoryboardScene;
    if (typeof scene.id !== 'string' || !uuid.test(scene.id) || sceneIds.has(scene.id))
      fail('Storyboard scenes need stable unique UUIDs.');
    sceneIds.add(scene.id);
    if (typeof scene.name !== 'string' || !scene.name.trim() || scene.name.length > 200)
      fail('Scene name must contain 1 to 200 characters.');
    if (typeof scene.narration !== 'string' || scene.narration.length > STORYBOARD_NARRATION_LIMIT)
      fail('Scene narration supports at most 12,000 characters.');
    for (const [field, existing] of [
      ['nodeIds', nodes],
      ['edgeIds', edges],
    ] as const) {
      const ids = scene[field];
      if (
        !Array.isArray(ids) ||
        (field === 'nodeIds' && !ids.length) ||
        ids.length > 20000 ||
        ids.some(
          (id) => typeof id !== 'string' || !uuid.test(id) || (existing && !existing.has(id)),
        ) ||
        new Set(ids).size !== ids.length
      )
        fail(
          `Scene ${field} must contain unique existing UUIDs (at most 20,000); each scene needs a node.`,
        );
      references += ids.length;
    }
    if (references > STORYBOARD_REFERENCE_LIMIT)
      fail('Storyboard supports at most 100,000 object references.');
    if (!Number.isFinite(scene.seconds) || scene.seconds < 2 || scene.seconds > 600)
      fail('Scene duration must be between 2 and 600 seconds.');
    if (
      !Number.isFinite(scene.transitionMs) ||
      scene.transitionMs < 0 ||
      scene.transitionMs > 10000
    )
      fail('Scene transition must be between 0 and 10,000 milliseconds.');
    if (scene.view !== undefined) validateStoryboardView(scene.view);
  }
}
export function getStoryboard(graph: Graph): StoryboardDefinition {
  const value = graph.diagram.settings.storyboard;
  if (value === undefined) return { version: 1, scenes: [] };
  validateStoryboard(value);
  return structuredClone(value);
}
export function setStoryboard(graph: Graph, value: StoryboardDefinition): Graph {
  validateStoryboard(value, graph);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, storyboard: structuredClone(value) },
    },
  };
}
export function pruneStoryboard(graph: Graph): Graph {
  if (graph.diagram.settings.storyboard === undefined) return graph;
  const definition = getStoryboard(graph),
    nodes = new Set(graph.nodes.map((node) => node.id)),
    edges = new Set(graph.edges.map((edge) => edge.id));
  const scenes = definition.scenes.flatMap((scene) => {
    const nodeIds = scene.nodeIds.filter((id) => nodes.has(id));
    return nodeIds.length
      ? [{ ...scene, nodeIds, edgeIds: scene.edgeIds.filter((id) => edges.has(id)) }]
      : [];
  });
  return JSON.stringify(scenes) === JSON.stringify(definition.scenes)
    ? graph
    : setStoryboard(graph, { ...definition, scenes });
}
/** Clones/imports remap canonical references and scene identities without changing camera/layout. */
export function remapStoryboard(
  graph: Graph,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
): Graph {
  if (graph.diagram.settings.storyboard === undefined) return graph;
  const definition = getStoryboard(graph);
  return setStoryboard(graph, {
    ...definition,
    scenes: definition.scenes.flatMap((scene) => {
      const mapped = scene.nodeIds.flatMap((id) => (nodeIds.has(id) ? [nodeIds.get(id)!] : []));
      return mapped.length
        ? [
            {
              ...scene,
              id: crypto.randomUUID(),
              nodeIds: mapped,
              edgeIds: scene.edgeIds.flatMap((id) => (edgeIds.has(id) ? [edgeIds.get(id)!] : [])),
            },
          ]
        : [];
    }),
  });
}
export function addStoryboardScene(
  graph: Graph,
  nodeIds: string[],
  edgeIds: string[],
  view?: StoryboardView,
): Graph {
  const definition = getStoryboard(graph),
    edges = graph.edges.filter((edge) => edgeIds.includes(edge.id));
  const selected = [
    ...new Set([...nodeIds, ...edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId])]),
  ];
  if (!selected.length) fail('Select one or more diagram objects to create a scene.');
  const scene: StoryboardScene = {
    id: crypto.randomUUID(),
    name: `Scene ${definition.scenes.length + 1}`,
    nodeIds: selected,
    edgeIds: [...new Set(edgeIds)],
    narration: '',
    seconds: 8,
    transitionMs: 1200,
    ...(view ? { view: structuredClone(view) } : {}),
  };
  return setStoryboard(graph, { ...definition, scenes: [...definition.scenes, scene] });
}
export function updateStoryboardScene(
  graph: Graph,
  id: string,
  patch: Partial<Omit<StoryboardScene, 'id'>>,
): Graph {
  const definition = getStoryboard(graph);
  if (!definition.scenes.some((scene) => scene.id === id))
    fail('This storyboard scene no longer exists.');
  return setStoryboard(graph, {
    ...definition,
    scenes: definition.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
  });
}
export function removeStoryboardScene(graph: Graph, id: string): Graph {
  const definition = getStoryboard(graph);
  return setStoryboard(graph, {
    ...definition,
    scenes: definition.scenes.filter((scene) => scene.id !== id),
  });
}
export function moveStoryboardScene(graph: Graph, id: string, direction: -1 | 1): Graph {
  const definition = getStoryboard(graph),
    index = definition.scenes.findIndex((scene) => scene.id === id),
    next = index + direction;
  if (index < 0 || next < 0 || next >= definition.scenes.length) return graph;
  const scenes = [...definition.scenes];
  [scenes[index], scenes[next]] = [scenes[next], scenes[index]];
  return setStoryboard(graph, { ...definition, scenes });
}
