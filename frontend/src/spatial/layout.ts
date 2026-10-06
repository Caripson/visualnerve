import type { Graph } from '../model/types';
import { timelineGeometry } from '../layouts/layout';
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

/** The relief uses the same absolute node faces as the 2D canvas, without a new layout. */
function planarProjection(graph: Graph): { positions: Map<string, SpatialPoint>; scale: number } {
  const positions = new Map<string, SpatialPoint>();
  if (!graph.nodes.length) return { positions, scale: 1 };
  const timeline =
    graph.diagram.type === 'timeline'
      ? timelineGeometry(graph.nodes, graph.diagram.settings.timelineScale ?? 'month')
      : undefined;
  const faces = graph.nodes.map((node) => {
    const geometry = timeline?.positions.get(node.id) ?? node;
    return {
      node,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width ?? node.width,
      height: geometry.height ?? node.height,
    };
  });
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const face of faces) {
    left = Math.min(left, face.x);
    right = Math.max(right, face.x + face.width);
    top = Math.min(top, face.y);
    bottom = Math.max(bottom, face.y + face.height);
  }
  const centerX = (left + right) / 2,
    centerY = (top + bottom) / 2;
  // Ordinary diagrams use one world unit per 100 canvas pixels. Only extreme extents
  // shrink uniformly; the renderer applies the same factor to node faces and relief.
  const scale = Math.min(
    1,
    spatialLimits.derivedExtent / Math.max(1, (right - left) / 100, (bottom - top) / 100),
  );
  for (const { node, x, y, width, height } of faces) {
    const explicit = getSpatialNode(node)?.position;
    positions.set(
      node.id,
      explicit
        ? { ...explicit }
        : {
            x: ((x + width / 2 - centerX) / 100) * scale,
            y: ((centerY - y - height / 2) / 100) * scale,
            z: 0,
          },
    );
  }
  return { positions, scale };
}

export function spatialPositions(graph: Graph): Map<string, SpatialPoint> {
  return planarProjection(graph).positions;
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
export function defaultSpatialCamera(
  bounds: SpatialBounds = spatialBounds([]),
  aspect = 1,
): SpatialCamera {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const tangent = Math.tan((21 * Math.PI) / 180);
  const halfWidth = (bounds.max.x - bounds.min.x) / 2;
  const halfHeight = (bounds.max.y - bounds.min.y) / 2;
  const halfDepth = (bounds.max.z - bounds.min.z) / 2;
  const distance = Math.max(
    7,
    Math.min(
      8_000_000,
      Math.max(halfHeight / tangent, halfWidth / (tangent * ratio), 1) * 1.2 + halfDepth,
    ),
  );
  return orientationCamera('front', bounds.center, distance);
}
export function projectSpatialGraph(graph: Graph): {
  positions: Map<string, SpatialPoint>;
  bounds: SpatialBounds;
  camera: SpatialCamera;
  /** Uniform dimension factor relative to the ordinary 100-pixel world unit. */
  scale: number;
} {
  const { positions, scale } = planarProjection(graph);
  const bounds = spatialBounds(positions.values());
  return {
    positions,
    bounds,
    scale,
    camera: getSpatialView(graph).camera ?? defaultSpatialCamera(bounds),
  };
}
