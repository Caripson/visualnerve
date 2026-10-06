import type { Graph } from '../model/types';
import { spatialPlanarGeometry, spatialPositions } from './layout';
import { getSpatialNode, setSpatialNode, spatialLimits, type SpatialPoint } from './types';

const samePoint = (a: SpatialPoint, b: SpatialPoint) => a.x === b.x && a.y === b.y && a.z === b.z;
const clamp = (value: number) =>
  Math.max(-spatialLimits.coordinate, Math.min(spatialLimits.coordinate, value));

/** Follow canonical 2D movement while retaining an existing independent depth/layout offset.
 * Explicit 3D edits in the same command take precedence. The old uniform scale converts
 * the movement, without turning graph recentering or unrelated size changes into movement.
 */
export function syncSpatialPositions(before: Graph, after: Graph): Graph {
  if (before.diagram.id !== after.diagram.id || before.nodes === after.nodes) return after;
  const previous = spatialPlanarGeometry(before);
  const oldFaces = new Map(previous.faces.map((face) => [face.node.id, face]));
  const next = spatialPlanarGeometry(after);
  const nextFaces = new Map(next.faces.map((face) => [face.node.id, face]));
  // Timeline dates share the old origin. Moving the earliest item must not shift
  // unrelated explicit positions just because the displayed time axis rebases.
  const timelineOffset =
    previous.timeline && next.timeline
      ? ((next.timeline.origin - previous.timeline.origin) / 86_400_000) *
        previous.timeline.pixelsPerDay
      : 0;
  let changed = false;
  const nodes = after.nodes.map((node) => {
    const oldFace = oldFaces.get(node.id),
      nextFace = nextFaces.get(node.id);
    const oldPosition = oldFace && getSpatialNode(oldFace.node)?.position;
    const position = getSpatialNode(node)?.position;
    if (!oldFace || !nextFace || !oldPosition || !position || !samePoint(oldPosition, position))
      return node;
    const dx =
      (nextFace.x + timelineOffset + nextFace.width / 2 - oldFace.x - oldFace.width / 2) / 100;
    const dy = (oldFace.y + oldFace.height / 2 - nextFace.y - nextFace.height / 2) / 100;
    if (!dx && !dy) return node;
    changed = true;
    return setSpatialNode(node, {
      version: 1,
      position: {
        x: clamp(position.x + dx * previous.scale),
        y: clamp(position.y + dy * previous.scale),
        z: position.z,
      },
    });
  });
  return changed ? { ...after, nodes } : after;
}

/** Moving a group includes nested descendants once; topic hierarchy is not a group. */
export function spatialMovementIds(graph: Graph, selected: Iterable<string>): Set<string> {
  const ids = new Set(selected);
  const children = new Map<string, string[]>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if (node.parentId) {
      const siblings = children.get(node.parentId);
      if (siblings) siblings.push(node.id);
      else children.set(node.parentId, [node.id]);
    }
    if (ids.has(node.id) && node.nodeType === 'group') queue.push(node.id);
  }
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of children.get(id) ?? []) {
      ids.add(child);
      queue.push(child);
    }
  }
  return ids;
}

/** One gesture writes one canonical command, with the existing 2D document intact. */
export function moveSpatialObjects(
  graph: Graph,
  ids: Iterable<string>,
  delta: SpatialPoint,
): Graph {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || (!delta.x && !delta.y))
    return graph;
  const chosen = spatialMovementIds(graph, ids);
  const positions = spatialPositions(graph);
  const bounded = boundedSpatialMovement(
    [...chosen].flatMap((id) => (positions.has(id) ? [positions.get(id)!] : [])),
    delta,
  );
  const nodes = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!chosen.has(node.id) || !position) return node;
    return setSpatialNode(node, {
      version: 1,
      position: {
        x: clamp(position.x + bounded.x),
        y: clamp(position.y + bounded.y),
        z: position.z,
      },
    });
  });
  return { ...graph, nodes };
}

/** Clamp the shared delta, retaining group spacing even at world-coordinate limits. */
export function boundedSpatialMovement(positions: Iterable<SpatialPoint>, delta: SpatialPoint) {
  const result = { x: delta.x, y: delta.y, z: 0 };
  let minX = -Infinity,
    maxX = Infinity,
    minY = -Infinity,
    maxY = Infinity;
  for (const point of positions) {
    minX = Math.max(minX, -spatialLimits.coordinate - point.x);
    maxX = Math.min(maxX, spatialLimits.coordinate - point.x);
    minY = Math.max(minY, -spatialLimits.coordinate - point.y);
    maxY = Math.min(maxY, spatialLimits.coordinate - point.y);
  }
  result.x = Math.max(minX, Math.min(maxX, result.x));
  result.y = Math.max(minY, Math.min(maxY, result.y));
  return result;
}
