import type { Graph, GraphNode } from '../model/types';

/** World axes: +Y is up, +Z is toward the front, and +X is right. */
export interface SpatialPoint {
  x: number;
  y: number;
  z: number;
}
export interface SpatialCamera {
  position: SpatialPoint;
  target: SpatialPoint;
  /** Optional camera up direction preserves rotation around the viewing axis. */
  up?: SpatialPoint;
}
export interface SpatialView {
  version: 1;
  mode: '2d' | '3d';
  camera?: SpatialCamera;
}
export interface SpatialNode {
  version: 1;
  position?: SpatialPoint;
}
export const spatialLimits = {
  coordinate: 1_000_000,
  cameraCoordinate: 10_000_000,
  derivedExtent: 200,
  depth: 64,
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const keys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

export function validateSpatialPoint(
  value: unknown,
  limit = spatialLimits.coordinate,
): asserts value is SpatialPoint {
  check(
    object(value) &&
      keys(value, ['x', 'y', 'z']) &&
      ['x', 'y', 'z'].every(
        (key) =>
          typeof value[key] === 'number' &&
          Number.isFinite(value[key]) &&
          Math.abs(value[key] as number) <= limit,
      ),
    `3D positions must contain finite x, y and z coordinates within ±${limit.toLocaleString('en-US')}.`,
  );
}
export function validateSpatialCamera(value: unknown): asserts value is SpatialCamera {
  check(object(value) && keys(value, ['position', 'target', 'up']), 'Invalid 3D camera.');
  const camera = value as SpatialCamera;
  validateSpatialPoint(camera.position, spatialLimits.cameraCoordinate);
  validateSpatialPoint(camera.target, spatialLimits.cameraCoordinate);
  check(
    Math.hypot(
      camera.position.x - camera.target.x,
      camera.position.y - camera.target.y,
      camera.position.z - camera.target.z,
    ) > 0.000001,
    'The 3D camera position must differ from its target.',
  );
  if (camera.up !== undefined) {
    validateSpatialPoint(camera.up, 1);
    const length = Math.hypot(camera.up.x, camera.up.y, camera.up.z);
    check(Math.abs(length - 1) < 0.0001, 'The 3D camera up direction must be a unit vector.');
    const direction = {
      x: camera.position.x - camera.target.x,
      y: camera.position.y - camera.target.y,
      z: camera.position.z - camera.target.z,
    };
    const distance = Math.hypot(direction.x, direction.y, direction.z);
    const parallel =
      (direction.x * camera.up.x + direction.y * camera.up.y + direction.z * camera.up.z) /
      (distance * length);
    check(
      Math.abs(parallel) < 0.999999,
      'The 3D camera up direction must differ from its viewing axis.',
    );
  }
}
export function validateSpatialView(value: unknown): asserts value is SpatialView {
  check(object(value), 'Invalid 3D view settings.');
  const view = value as SpatialView;
  check(
    view.version === 1 &&
      ['2d', '3d'].includes(view.mode) &&
      keys(view, ['version', 'mode', 'camera']),
    'Invalid or unsupported 3D view settings.',
  );
  if (view.camera !== undefined) validateSpatialCamera(view.camera);
}
export function validateSpatialNode(value: unknown): asserts value is SpatialNode {
  check(object(value), 'Invalid node 3D settings.');
  const node = value as SpatialNode;
  check(
    node.version === 1 && keys(node, ['version', 'position']),
    'Invalid or unsupported node 3D settings.',
  );
  if (node.position !== undefined) validateSpatialPoint(node.position);
}

export function getSpatialView(graph: Graph): SpatialView {
  const value = graph.diagram.settings.spatialView;
  if (value !== undefined) {
    try {
      validateSpatialView(value);
      return value;
    } catch {
      // A malformed in-memory preview cannot prevent returning to the 2D canvas.
    }
  }
  return { version: 1, mode: '2d' };
}
export function getSpatialNode(node: GraphNode): SpatialNode | undefined {
  const value = node.metadata?.spatial;
  if (value === undefined) return undefined;
  try {
    validateSpatialNode(value);
    return value;
  } catch {
    return undefined;
  }
}
export function setSpatialView(graph: Graph, patch: Partial<SpatialView>): Graph {
  const view = { ...getSpatialView(graph), ...patch };
  validateSpatialView(view);
  return {
    ...graph,
    diagram: {
      ...graph.diagram,
      settings: { ...graph.diagram.settings, spatialView: structuredClone(view) },
    },
  };
}
export function validateSpatialGraph(graph: Graph): void {
  if (graph.diagram.settings.spatialView !== undefined)
    validateSpatialView(graph.diagram.settings.spatialView);
  for (const node of graph.nodes)
    if (node.metadata?.spatial !== undefined) validateSpatialNode(node.metadata.spatial);
}
/** Duplicates retain their own 3D layout rather than occupying the original marker. */
export function offsetSpatialNode(node: GraphNode, offset = 0.4): GraphNode {
  const spatial = getSpatialNode(node);
  if (!spatial || !Number.isFinite(offset)) return node;
  const position = spatial.position;
  if (!position) return node;
  const clamp = (value: number) =>
    Math.max(-spatialLimits.coordinate, Math.min(spatialLimits.coordinate, value));
  return setSpatialNode(node, {
    ...spatial,
    position: {
      x: clamp(position.x + offset),
      y: clamp(position.y - offset),
      z: position.z,
    },
  });
}
export function setSpatialNode(node: GraphNode, value: SpatialNode | undefined): GraphNode {
  if (value !== undefined) validateSpatialNode(value);
  const { spatial: _previous, ...metadata } = node.metadata;
  return {
    ...node,
    metadata: value === undefined ? metadata : { ...metadata, spatial: structuredClone(value) },
  };
}
