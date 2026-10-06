import { Quaternion, Vector3 } from 'three';
import { spatialLimits, type SpatialCamera, type SpatialPoint } from './types';

export type SpatialNavigationMode = 'move' | 'rotate' | 'scale';
export type SpatialNavigationAxis = 'x' | 'y' | 'z' | 'free';
const axes = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};
const vector = (point: SpatialPoint) => new Vector3(point.x, point.y, point.z);
const point = (value: Vector3): SpatialPoint => ({ x: value.x, y: value.y, z: value.z });

/** Navigate the whole view; object geometry and diagram layout never enter this operation. */
export function navigateSpatialCamera(
  camera: SpatialCamera,
  mode: SpatialNavigationMode,
  axis: SpatialNavigationAxis,
  delta: { x: number; y: number },
  viewportHeight = 768,
): SpatialCamera {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || (!delta.x && !delta.y))
    return camera;
  // Bound one event without limiting a sustained gesture.
  const dx = Math.max(-400, Math.min(400, delta.x));
  const dy = Math.max(-400, Math.min(400, delta.y));
  const target = vector(camera.target);
  const position = vector(camera.position);
  const offset = position.clone().sub(target);
  const distance = offset.length();
  const up = vector(camera.up ?? { x: 0, y: 1, z: 0 }).normalize();
  const normal = offset.clone().normalize();
  const right = new Vector3().crossVectors(up, normal).normalize();
  const screenUp = new Vector3().crossVectors(normal, right).normalize();

  if (mode === 'rotate') {
    // The visible up direction is the projection onto the camera plane.
    // Named Top views can have a preferred up almost parallel to the sight line.
    // Carry their actual viewing frame through a turn, rather than that preference.
    up.copy(screenUp);
    const rotation = new Quaternion();
    if (axis === 'free') {
      const yaw = new Quaternion().setFromAxisAngle(screenUp, dx * 0.012);
      const pitch = new Quaternion().setFromAxisAngle(right, dy * 0.012);
      rotation.copy(yaw).multiply(pitch);
    } else {
      // A ring can be dragged horizontally or vertically, including end-on axes.
      const pixels = Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
      rotation.setFromAxisAngle(axes[axis], pixels * 0.012);
    }
    offset.applyQuaternion(rotation);
    up.applyQuaternion(rotation).normalize();
    position.copy(target).add(offset);
  } else if (mode === 'move') {
    const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 768;
    const worldPerPixel = (2 * distance * Math.tan((21 * Math.PI) / 180)) / height;
    const translation = new Vector3();
    if (axis === 'free') {
      translation.addScaledVector(right, -dx * worldPerPixel);
      translation.addScaledVector(screenUp, dy * worldPerPixel);
    } else {
      const direction = axes[axis];
      const screenX = direction.dot(right);
      const screenY = -direction.dot(screenUp);
      const length = Math.hypot(screenX, screenY);
      const pixels = length > 0.08 ? (dx * screenX + dy * screenY) / length : dx - dy;
      translation.copy(direction).multiplyScalar(-pixels * worldPerPixel);
    }
    // Clamp a translation as a whole so position-target and its rotation survive.
    let amount = 1;
    for (const coordinate of ['x', 'y', 'z'] as const) {
      const movement = translation[coordinate];
      if (!movement) continue;
      for (const source of [target[coordinate], position[coordinate]]) {
        const available =
          movement > 0
            ? spatialLimits.cameraCoordinate - source
            : -spatialLimits.cameraCoordinate - source;
        amount = Math.min(amount, Math.max(0, available / movement));
      }
    }
    translation.multiplyScalar(amount);
    target.add(translation);
    position.add(translation);
  } else {
    const pixels = Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
    let maximumDistance = spatialLimits.cameraCoordinate;
    for (const coordinate of ['x', 'y', 'z'] as const) {
      const direction = normal[coordinate];
      if (!direction) continue;
      maximumDistance = Math.min(
        maximumDistance,
        (direction > 0
          ? spatialLimits.cameraCoordinate - target[coordinate]
          : -spatialLimits.cameraCoordinate - target[coordinate]) / direction,
      );
    }
    if (maximumDistance < 0.2) return camera;
    const nextDistance = Math.max(
      0.2,
      Math.min(maximumDistance, distance * Math.exp(-pixels * 0.012)),
    );
    position.copy(target).addScaledVector(normal, nextDistance);
  }

  // Rotations near the coordinate boundary are limited without changing the orbit target.
  if (mode === 'rotate') {
    const normal = position.clone().sub(target).normalize();
    let extent = distance;
    for (const coordinate of ['x', 'y', 'z'] as const) {
      const direction = normal[coordinate];
      if (!direction) continue;
      extent = Math.min(
        extent,
        (direction > 0
          ? spatialLimits.cameraCoordinate - target[coordinate]
          : -spatialLimits.cameraCoordinate - target[coordinate]) / direction,
      );
    }
    // At the exact boundary an outward turn cannot produce a valid camera.
    if (extent < 0.2) return camera;
    position.copy(target).addScaledVector(normal, extent);
  }
  const result: SpatialCamera = { position: point(position), target: point(target) };
  if (camera.up || up.distanceToSquared(axes.y) > 0.0000000001) result.up = point(up);
  return result;
}
