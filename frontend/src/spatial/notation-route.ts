import * as THREE from 'three';
import type { SpatialPoint } from './types';

export interface SpatialSheetOrigin {
  centerX: number;
  centerY: number;
}
/** Saved bends stay on their canonical sheet; only endpoint depths interpolate in 3D. */
export function spatialNotationWaypoints(
  waypoints: readonly (readonly [number, number])[],
  source: SpatialPoint,
  target: SpatialPoint,
  origin: SpatialSheetOrigin,
  scale: number,
) {
  const points = [
    new THREE.Vector3(source.x, source.y, source.z),
    ...waypoints.map(
      ([x, y]) =>
        new THREE.Vector3(
          ((x - origin.centerX) / 100) * scale,
          ((origin.centerY - y) / 100) * scale,
          0,
        ),
    ),
    new THREE.Vector3(target.x, target.y, target.z),
  ];
  const distances = [0];
  for (let index = 1; index < points.length; index++)
    distances.push(
      distances.at(-1)! +
        Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y),
    );
  const total = distances.at(-1)!;
  for (let index = 1; index < points.length - 1; index++)
    points[index].z =
      source.z +
      (target.z - source.z) * (total ? distances[index] / total : index / (points.length - 1));
  return points;
}
