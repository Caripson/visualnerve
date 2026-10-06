import type { Graph, GraphNode } from '../model/types';
import {
  getSpatialNode,
  getSpatialView,
  spatialLimits,
  type SpatialCamera,
  type SpatialPoint,
} from './types';

export interface SpatialBounds {
  min: SpatialPoint;
  max: SpatialPoint;
  center: SpatialPoint;
  radius: number;
}
export type SpatialOrientation = 'front' | 'back' | 'left' | 'right' | 'top';

function sphereDirection(index: number, count: number): SpatialPoint {
  if (count === 1) return { x: 0, y: 0, z: 1 };
  const y = 1 - (2 * (index + 0.5)) / count;
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(angle) * horizontal, y, z: Math.sin(angle) * horizontal };
}

/** Iterative weighted branch clusters give a large mind map useful depth without moving its 2D layout. */
function mindmapPositions(graph: Graph): Map<string, SpatialPoint> {
  const ordered = graph.nodes.map((node) => node.id).sort();
  const ids = new Set(ordered);
  const parent = new Map<string, string>();
  for (const node of graph.nodes)
    if (node.parentId && node.parentId !== node.id && ids.has(node.parentId))
      parent.set(node.id, node.parentId);
  for (const edge of graph.edges) {
    if (edge.edgeType !== 'hierarchy') continue;
    const source = edge.direction === 'backward' ? edge.targetNodeId : edge.sourceNodeId;
    const target = edge.direction === 'backward' ? edge.sourceNodeId : edge.targetNodeId;
    if (source !== target && ids.has(source) && ids.has(target) && !parent.has(target))
      parent.set(target, source);
  }
  const children = new Map<string, string[]>();
  for (const id of ordered) {
    const source = parent.get(id);
    if (!source) continue;
    const siblings = children.get(source);
    if (siblings) siblings.push(id);
    else children.set(source, [id]);
  }
  const traversal: string[] = [];
  const roots: string[] = [];
  const visited = new Set<string>();
  const actualParent = new Map<string, string>();
  const append = (id: string) => {
    roots.push(id);
    visited.add(id);
    traversal.push(id);
  };
  const drain = (start: number) => {
    for (let cursor = start; cursor < traversal.length; cursor++) {
      const source = traversal[cursor];
      for (const target of children.get(source) ?? []) {
        if (visited.has(target)) continue;
        visited.add(target);
        actualParent.set(target, source);
        traversal.push(target);
      }
    }
  };
  for (const id of ordered) if (!parent.has(id)) append(id);
  drain(0);
  // Cyclic or incomplete in-memory previews form a stable forest rather than recursing forever.
  for (const id of ordered)
    if (!visited.has(id)) {
      const start = traversal.length;
      append(id);
      drain(start);
    }
  const sizes = new Map(ordered.map((id) => [id, 1]));
  const branches = new Map<string, string[]>();
  for (const id of traversal) {
    const source = actualParent.get(id);
    if (!source) continue;
    const siblings = branches.get(source);
    if (siblings) siblings.push(id);
    else branches.set(source, [id]);
  }
  for (let index = traversal.length - 1; index >= 0; index--) {
    const id = traversal[index],
      source = actualParent.get(id);
    if (source) sizes.set(source, sizes.get(source)! + sizes.get(id)!);
  }
  const positions = new Map<string, SpatialPoint>();
  const radii = new Map<string, number>();
  const extent = Math.min(
    spatialLimits.derivedExtent * 0.4,
    Math.max(6, Math.cbrt(ordered.length) * 1.6),
  );
  for (const [index, id] of roots.entries()) {
    const direction = sphereDirection(index, roots.length);
    const distance = roots.length === 1 ? 0 : extent * 0.5;
    positions.set(id, {
      x: direction.x * distance,
      y: direction.y * distance,
      z: direction.z * distance,
    });
    radii.set(
      id,
      roots.length === 1
        ? extent
        : extent * 0.4 * Math.cbrt(sizes.get(id)! / Math.max(1, ordered.length)),
    );
  }
  for (const source of traversal) {
    const siblings = branches.get(source) ?? [];
    const center = positions.get(source)!;
    const radius = radii.get(source)!;
    for (const [index, id] of siblings.entries()) {
      const childRadius = Math.max(
        0.00001,
        radius * 0.62 * Math.cbrt(sizes.get(id)! / sizes.get(source)!),
      );
      const distance = Math.max(0.0001, radius - childRadius);
      const direction = sphereDirection(index, siblings.length);
      positions.set(id, {
        x: center.x + direction.x * distance,
        y: center.y + direction.y * distance,
        z: center.z + direction.z * distance,
      });
      radii.set(id, childRadius);
    }
  }
  // Deterministic tie breaking also keeps pathological deep branches selectable.
  const occupied = new Set<string>();
  let ordinal = 0;
  for (const id of traversal) {
    const point = positions.get(id)!;
    let key = JSON.stringify(point);
    if (occupied.has(key)) {
      point.x += ++ordinal * 0.000001;
      key = JSON.stringify(point);
    }
    occupied.add(key);
  }
  const bounds = spatialBounds(positions.values());
  const scale = Math.min(
    1,
    spatialLimits.derivedExtent /
      Math.max(
        1,
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      ),
  );
  if (scale < 1)
    for (const point of positions.values()) {
      point.x = (point.x - bounds.center.x) * scale;
      point.y = (point.y - bounds.center.y) * scale;
      point.z = (point.z - bounds.center.z) * scale;
    }
  for (const node of graph.nodes) {
    const explicit = getSpatialNode(node)?.position;
    if (explicit) positions.set(node.id, { ...explicit });
  }
  return positions;
}

function cameraPosition(target: SpatialPoint, offset: SpatialPoint): SpatialPoint {
  const position = { ...target };
  for (const axis of ['x', 'y', 'z'] as const) {
    const candidate = target[axis] + offset[axis];
    // At the edge of the allowed world, view the point from the other side.
    position[axis] =
      Math.abs(candidate) <= spatialLimits.cameraCoordinate
        ? candidate
        : target[axis] - offset[axis];
  }
  return position;
}

export function spatialBounds(points: Iterable<SpatialPoint>): SpatialBounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let count = 0;
  for (const point of points) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
    count++;
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  if (!count)
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
    };
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  return {
    min,
    max,
    center,
    radius: Math.max(1, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2),
  };
}

/** Breadth-first layers give directed diagrams depth; explicit parent hierarchies take precedence. */
function depths(graph: Graph): Map<string, number> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  const connect = (source: string, target: string) => {
    if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) return;
    const neighbors = outgoing.get(source);
    if (neighbors) neighbors.push(target);
    else outgoing.set(source, [target]);
    incoming.add(target);
  };
  for (const edge of graph.edges) {
    if (edge.direction === 'backward') connect(edge.targetNodeId, edge.sourceNodeId);
    else if (edge.direction === 'forward' || edge.edgeType === 'hierarchy')
      connect(edge.sourceNodeId, edge.targetNodeId);
  }
  const ordered = graph.nodes.map((node) => node.id).sort();
  const result = new Map<string, number>();
  const queue: string[] = [];
  const drain = () => {
    for (let i = 0; i < queue.length; i++) {
      const source = queue[i];
      for (const target of outgoing.get(source) ?? []) {
        if (result.has(target)) continue;
        result.set(target, Math.min(spatialLimits.depth, result.get(source)! + 1));
        queue.push(target);
      }
    }
    queue.length = 0;
  };
  for (const id of ordered)
    if (!incoming.has(id)) {
      result.set(id, 0);
      queue.push(id);
    }
  drain();
  // Directed cycles and disconnected components still receive stable, bounded layers.
  for (const id of ordered)
    if (!result.has(id)) {
      result.set(id, 0);
      queue.push(id);
      drain();
    }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentDepth = new Map<string, number>();
  for (const node of graph.nodes) {
    if (parentDepth.has(node.id)) continue;
    const path: GraphNode[] = [];
    const visited = new Set<string>();
    let cursor: GraphNode | undefined = node;
    while (cursor && !parentDepth.has(cursor.id) && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      path.push(cursor);
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    let depth = cursor ? (parentDepth.get(cursor.id) ?? 0) : -1;
    for (let index = path.length - 1; index >= 0; index--) {
      depth = Math.min(spatialLimits.depth, depth + 1);
      parentDepth.set(path[index].id, depth);
    }
  }
  for (const node of graph.nodes)
    if (node.parentId) result.set(node.id, parentDepth.get(node.id) ?? 0);
  return result;
}

export function spatialPositions(graph: Graph): Map<string, SpatialPoint> {
  const positions = new Map<string, SpatialPoint>();
  if (!graph.nodes.length) return positions;
  if (graph.diagram.type === 'mindmap') return mindmapPositions(graph);
  // Canonical geometry keeps the layout stable while filters, collapse and exploration change.
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const node of graph.nodes) {
    left = Math.min(left, node.x);
    right = Math.max(right, node.x + node.width);
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + node.height);
  }
  const centerX = (left + right) / 2,
    centerY = (top + bottom) / 2;
  const scale = Math.min(
    1 / 120,
    spatialLimits.derivedExtent / Math.max(1, right - left, bottom - top),
  );
  const layers = depths(graph);
  for (const node of graph.nodes) {
    const spatial = getSpatialNode(node);
    if (spatial?.position) positions.set(node.id, { ...spatial.position });
    else
      positions.set(node.id, {
        x: (node.x + node.width / 2 - centerX) * scale,
        y: (centerY - node.y - node.height / 2) * scale,
        z: (layers.get(node.id) ?? 0) * 1.4,
      });
  }
  return positions;
}

export function orientationCamera(
  orientation: SpatialOrientation,
  target: SpatialPoint = { x: 0, y: 0, z: 0 },
  distance = 8,
): SpatialCamera {
  const extent = Number.isFinite(distance) ? Math.max(0.1, Math.min(8_000_000, distance)) : 8;
  const offsets: Record<SpatialOrientation, SpatialPoint> = {
    front: { x: 0, y: 0, z: extent },
    back: { x: 0, y: 0, z: -extent },
    left: { x: -extent, y: 0, z: 0 },
    right: { x: extent, y: 0, z: 0 },
    // A tiny front offset avoids a singular look-at basis with a +Y camera up axis.
    top: { x: 0, y: extent, z: extent * 0.001 },
  };
  const offset = offsets[orientation];
  return { position: cameraPosition(target, offset), target: { ...target } };
}
export function defaultSpatialCamera(bounds: SpatialBounds = spatialBounds([])): SpatialCamera {
  const distance = Math.max(7, Math.min(8_000_000, bounds.radius * 3.2));
  return {
    position: cameraPosition(bounds.center, { x: distance * 0.45, y: distance * 0.3, z: distance }),
    target: { ...bounds.center },
  };
}
export function projectSpatialGraph(graph: Graph): {
  positions: Map<string, SpatialPoint>;
  bounds: SpatialBounds;
  camera: SpatialCamera;
} {
  const positions = spatialPositions(graph);
  const bounds = spatialBounds(positions.values());
  return {
    positions,
    bounds,
    camera: getSpatialView(graph).camera ?? defaultSpatialCamera(bounds),
  };
}
