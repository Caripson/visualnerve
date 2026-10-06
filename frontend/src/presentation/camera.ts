import type { SpatialPoint } from '../spatial/types';

export const PRESENTATION_FOCUS = 'visualnerve:presentation-focus';
export const PRESENTATION_ARRIVED = 'visualnerve:presentation-arrived';
export const PRESENTATION_CAMERA_CANCEL = 'visualnerve:presentation-camera-cancel';
export const PRESENTATION_INTERRUPTED = 'visualnerve:presentation-interrupted';

export interface PresentationFocus {
  nodeId: string;
  transitionMs: number;
  requestId: number;
}

export function presentationViewportKey(viewport: { x: number; y: number; zoom: number }) {
  return JSON.stringify([viewport.x, viewport.y, viewport.zoom]);
}

export function presentationFocus(event: Event): PresentationFocus | undefined {
  const value = (event as CustomEvent<PresentationFocus>).detail;
  if (
    !value ||
    typeof value.nodeId !== 'string' ||
    !value.nodeId ||
    !Number.isSafeInteger(value.requestId) ||
    !Number.isFinite(value.transitionMs) ||
    value.transitionMs < 0 ||
    value.transitionMs > 30_000
  )
    return undefined;
  return value;
}

export function presentationArrived(request: PresentationFocus, error?: string) {
  window.dispatchEvent(
    new CustomEvent(PRESENTATION_ARRIVED, {
      detail: { requestId: request.requestId, nodeId: request.nodeId, ...(error ? { error } : {}) },
    }),
  );
}

export function presentationInterrupted(request: PresentationFocus, reason: string) {
  window.dispatchEvent(
    new CustomEvent(PRESENTATION_INTERRUPTED, {
      detail: { requestId: request.requestId, nodeId: request.nodeId, reason },
    }),
  );
}

/** Conservative world-space bounds include the actual card width, height and relief. */
export interface PresentationObstacle {
  id: string;
  min: SpatialPoint;
  max: SpatialPoint;
}
const axes = ['x', 'y', 'z'] as const;
const distance = (a: SpatialPoint, b: SpatialPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Transform all eight corners; a rotated/nonuniformly scaled card must not shrink its bounds. */
export function presentationObstacle(
  id: string,
  center: SpatialPoint,
  dimensions: SpatialPoint,
  matrix?: readonly number[],
): PresentationObstacle {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  if (matrix && (matrix.length !== 16 || !matrix.every(Number.isFinite)))
    throw new Error('The diagram world transform is invalid.');
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const point = {
          x: center.x + (x * dimensions.x) / 2,
          y: center.y + (y * dimensions.y) / 2,
          z: center.z + (z * dimensions.z) / 2,
        };
        const transformed = matrix
          ? {
              x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
              y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
              z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
            }
          : point;
        for (const axis of axes) {
          min[axis] = Math.min(min[axis], transformed[axis]);
          max[axis] = Math.max(max[axis], transformed[axis]);
        }
      }
  if (axes.some((axis) => !Number.isFinite(min[axis]) || !Number.isFinite(max[axis])))
    throw new Error('A diagram object has invalid camera bounds.');
  return { id, min, max };
}

export function pointInsideObstacle(point: SpatialPoint, box: PresentationObstacle, clearance = 0) {
  return axes.every(
    (axis) => point[axis] >= box.min[axis] - clearance && point[axis] <= box.max[axis] + clearance,
  );
}

/** Slab intersection checks the entire swept segment, including both endpoints. */
export function segmentIntersectsObstacle(
  from: SpatialPoint,
  to: SpatialPoint,
  box: PresentationObstacle,
  clearance = 0,
) {
  let enter = 0;
  let leave = 1;
  for (const axis of axes) {
    const delta = to[axis] - from[axis];
    const low = box.min[axis] - clearance;
    const high = box.max[axis] + clearance;
    if (Math.abs(delta) < 1e-12) {
      if (from[axis] < low || from[axis] > high) return false;
      continue;
    }
    const a = (low - from[axis]) / delta;
    const b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}

export function presentationPathClear(
  path: readonly SpatialPoint[],
  obstacles: readonly PresentationObstacle[],
  clearance: number,
) {
  if (path.length < 2) return false;
  for (let index = 1; index < path.length; index++)
    if (
      obstacles.some((box) =>
        segmentIntersectsObstacle(path[index - 1], path[index], box, clearance),
      )
    )
      return false;
  return true;
}

/**
 * At most six tested exit rays on each side, then a route on the outside of the
 * complete envelope. Complexity is linear in the number of cards, not a graph
 * of every card pair. A blocked start/corridor produces an error without moving.
 */
export function planPresentationFlight(
  from: SpatialPoint,
  to: SpatialPoint,
  obstacles: readonly PresentationObstacle[],
  clearance = 0.08,
): SpatialPoint[] {
  if (
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    axes.some((axis) => !Number.isFinite(from[axis]) || !Number.isFinite(to[axis]))
  )
    throw new Error('The presentation camera route is invalid.');
  if (obstacles.some((box) => pointInsideObstacle(from, box, clearance)))
    throw new Error('The camera is too close to an object. Move it clear before playing.');
  if (obstacles.some((box) => pointInsideObstacle(to, box, clearance)))
    throw new Error('There is no clear camera position for this object.');
  const direct = [{ ...from }, { ...to }];
  if (presentationPathClear(direct, obstacles, clearance)) return direct;
  const envelope = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  const margin = Math.max(clearance * 2, 0.01);
  for (const box of obstacles)
    for (const axis of axes) {
      envelope.min[axis] = Math.min(envelope.min[axis], box.min[axis] - clearance - margin);
      envelope.max[axis] = Math.max(envelope.max[axis], box.max[axis] + clearance + margin);
    }
  const portals = (point: SpatialPoint) =>
    axes.flatMap((axis) =>
      (['min', 'max'] as const).flatMap((side) => {
        const portal = { ...point, [axis]: envelope[side][axis] };
        return presentationPathClear([point, portal], obstacles, clearance)
          ? [{ point: portal, axis, side }]
          : [];
      }),
    );
  const exits = portals(from);
  const entrances = portals(to);
  const corner = (portal: (typeof exits)[number]): SpatialPoint => {
    const result = { ...portal.point };
    for (const axis of axes)
      if (axis !== portal.axis)
        result[axis] =
          portal.point[axis] <= (envelope.min[axis] + envelope.max[axis]) / 2
            ? envelope.min[axis]
            : envelope.max[axis];
    return result;
  };
  let shortest: SpatialPoint[] | undefined;
  let shortestLength = Infinity;
  for (const exit of exits)
    for (const entrance of entrances) {
      const a = corner(exit);
      const b = corner(entrance);
      const path = [{ ...from }, exit.point, a];
      let cursor = a;
      for (const axis of axes) {
        if (cursor[axis] === b[axis]) continue;
        cursor = { ...cursor, [axis]: b[axis] };
        path.push(cursor);
      }
      path.push(entrance.point, { ...to });
      const compact = path.filter(
        (point, index) => !index || distance(point, path[index - 1]) > 1e-9,
      );
      const length = compact.reduce(
        (sum, point, index) => sum + (index ? distance(point, compact[index - 1]) : 0),
        0,
      );
      if (length < shortestLength) {
        shortest = compact;
        shortestLength = length;
      }
    }
  if (!shortest || !presentationPathClear(shortest, obstacles, clearance))
    throw new Error('No safe camera route was found. Rotate or move the view, then try again.');
  return shortest;
}

/** Zero velocity/acceleration at endpoints keeps verified straight segments safe at corners. */
export function presentationEase(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function samplePresentationFlight(
  path: readonly SpatialPoint[],
  progress: number,
): SpatialPoint {
  if (!path.length) throw new Error('A presentation route needs a camera position.');
  if (path.length === 1 || progress <= 0) return { ...path[0] };
  if (progress >= 1) return { ...path[path.length - 1] };
  const lengths = path.slice(1).map((point, index) => distance(path[index], point));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (!total) return { ...path[0] };
  let traveled = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (traveled > length && index < lengths.length - 1) {
      traveled -= length;
      continue;
    }
    const ratio = presentationEase(length ? traveled / length : 1);
    const a = path[index],
      b = path[index + 1];
    return {
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
      z: a.z + (b.z - a.z) * ratio,
    };
  }
  return { ...path[path.length - 1] };
}

/** A dropped animation frame still visits each safe corner instead of cutting across it. */
export function presentationFlightFrames(path: readonly SpatialPoint[]) {
  if (path.length < 2) throw new Error('A presentation route needs two camera positions.');
  let length = 0;
  const ends = path.slice(1).map((point, index) => {
    length += distance(path[index], point);
    return length;
  });
  let segment = 0;
  let previousProgress = 0;
  return (requestedProgress: number) => {
    const progress = Math.max(previousProgress, Math.max(0, Math.min(1, requestedProgress)));
    previousProgress = progress;
    if (segment < path.length - 2 && progress * length >= ends[segment]) {
      const position = { ...path[++segment] };
      return { position, arrived: false };
    }
    return { position: samplePresentationFlight(path, progress), arrived: progress >= 1 };
  };
}
