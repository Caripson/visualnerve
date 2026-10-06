import type { DrawingStroke } from './types';

export type DrawingPoint = readonly [number, number];
export interface DrawingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Segment =
  | { from: DrawingPoint; to: DrawingPoint; control?: undefined }
  | { from: DrawingPoint; to: DrawingPoint; control: DrawingPoint };
const midpoint = (a: DrawingPoint, b: DrawingPoint): DrawingPoint => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
];

function segments(points: readonly DrawingPoint[]): Segment[] {
  if (points.length < 2) return [];
  const result: Segment[] = [];
  let from = points[0];
  for (let index = 1; index < points.length - 1; index++) {
    const to = midpoint(points[index], points[index + 1]);
    result.push({ from, control: points[index], to });
    from = to;
  }
  result.push({ from, to: points.at(-1)! });
  return result;
}

/** Midpoint quadratics stay inside the original points' bounds and join smoothly. */
export function strokePath(points: readonly DrawingPoint[]): string {
  if (!points.length) return '';
  const start = `M ${points[0][0]} ${points[0][1]}`;
  return [
    start,
    ...segments(points).map(({ control, to }) =>
      control ? `Q ${control[0]} ${control[1]} ${to[0]} ${to[1]}` : `L ${to[0]} ${to[1]}`,
    ),
  ].join(' ');
}

export function strokeBounds(stroke: DrawingStroke): DrawingBounds | undefined {
  if (!stroke.points.length) return;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [x, y] of stroke.points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const radius = stroke.width / 2;
  return {
    x: left - radius,
    y: top - radius,
    width: right - left + stroke.width,
    height: bottom - top + stroke.width,
  };
}

export function unionBounds(
  ...rectangles: (DrawingBounds | undefined)[]
): DrawingBounds | undefined {
  const bounds = rectangles.filter((value): value is DrawingBounds => value !== undefined);
  if (!bounds.length) return;
  const left = Math.min(...bounds.map((bounds) => bounds.x));
  const top = Math.min(...bounds.map((bounds) => bounds.y));
  const right = Math.max(...bounds.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...bounds.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function drawingBounds(strokes: readonly DrawingStroke[]): DrawingBounds | undefined {
  return unionBounds(...strokes.map(strokeBounds));
}

function segmentDistanceSquared(point: DrawingPoint, from: DrawingPoint, to: DrawingPoint) {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length))
    : 0;
  return (point[0] - from[0] - t * dx) ** 2 + (point[1] - from[1] - t * dy) ** 2;
}

function hitSegment(
  segment: Segment,
  point: DrawingPoint,
  radiusSquared: number,
  depth = 0,
): boolean {
  const radius = Math.sqrt(radiusSquared);
  const control = segment.control ?? segment.from;
  if (
    point[0] < Math.min(segment.from[0], control[0], segment.to[0]) - radius ||
    point[0] > Math.max(segment.from[0], control[0], segment.to[0]) + radius ||
    point[1] < Math.min(segment.from[1], control[1], segment.to[1]) - radius ||
    point[1] > Math.max(segment.from[1], control[1], segment.to[1]) + radius
  )
    return false;
  if (
    !segment.control ||
    depth >= 14 ||
    segmentDistanceSquared(segment.control, segment.from, segment.to) <= 0.0625
  )
    return segmentDistanceSquared(point, segment.from, segment.to) <= radiusSquared;
  const fromControl = midpoint(segment.from, segment.control);
  const controlTo = midpoint(segment.control, segment.to);
  const middle = midpoint(fromControl, controlTo);
  return (
    hitSegment(
      { from: segment.from, control: fromControl, to: middle },
      point,
      radiusSquared,
      depth + 1,
    ) ||
    hitSegment(
      { from: middle, control: controlTo, to: segment.to },
      point,
      radiusSquared,
      depth + 1,
    )
  );
}

/** Hit the same smoothed curve as the SVG, with an additional world-coordinate eraser radius. */
export function strokeHitTest(stroke: DrawingStroke, point: DrawingPoint, radius = 0): boolean {
  const bounds = strokeBounds(stroke);
  if (
    !bounds ||
    point[0] < bounds.x - radius ||
    point[1] < bounds.y - radius ||
    point[0] > bounds.x + bounds.width + radius ||
    point[1] > bounds.y + bounds.height + radius
  )
    return false;
  const radiusSquared = (stroke.width / 2 + radius) ** 2;
  if (stroke.points.length === 1)
    return segmentDistanceSquared(point, stroke.points[0], stroke.points[0]) <= radiusSquared;
  return segments(stroke.points).some((segment) => hitSegment(segment, point, radiusSquared));
}
