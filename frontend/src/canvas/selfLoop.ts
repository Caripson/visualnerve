import { Position } from '@xyflow/react';

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type Endpoint = Point & { position: Position };

/** Route around the node perimeter; built-in paths otherwise cross the same card. */
export function selfLoopPath(source: Endpoint, target: Endpoint, bounds: Bounds) {
  const gap = 32;
  const left = bounds.x - gap;
  const right = bounds.x + bounds.width + gap;
  const top = bounds.y - gap;
  const bottom = bounds.y + bounds.height + gap;
  const width = right - left;
  const height = bottom - top;
  const perimeter = 2 * (width + height);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const escape = ({ x, y, position }: Endpoint): Point => {
    if (position === Position.Top) return { x: clamp(x, left, right), y: top };
    if (position === Position.Bottom) return { x: clamp(x, left, right), y: bottom };
    if (position === Position.Left) return { x: left, y: clamp(y, top, bottom) };
    return { x: right, y: clamp(y, top, bottom) };
  };
  const coordinate = (point: Point, position: Position) => {
    if (position === Position.Top) return point.x - left;
    if (position === Position.Right) return width + point.y - top;
    if (position === Position.Bottom) return width + height + right - point.x;
    return 2 * width + height + bottom - point.y;
  };
  const start = escape(source);
  const end = escape(target);
  const from = coordinate(start, source.position);
  const to = coordinate(end, target.position);
  const clockwise = (to - from + perimeter) % perimeter;
  const counterclockwise = (from - to + perimeter) % perimeter;
  const direction = clockwise > 0 && clockwise < counterclockwise ? 1 : -1;
  const distance = direction === 1 ? clockwise : counterclockwise || perimeter;
  const finish = from + direction * distance;
  const corners = [
    { coordinate: 0, point: { x: left, y: top } },
    { coordinate: width, point: { x: right, y: top } },
    { coordinate: width + height, point: { x: right, y: bottom } },
    { coordinate: 2 * width + height, point: { x: left, y: bottom } },
  ];
  const turns = [-1, 0, 1, 2]
    .flatMap((cycle) =>
      corners.map((corner) => ({ ...corner, coordinate: corner.coordinate + cycle * perimeter })),
    )
    .filter((corner) =>
      direction === 1
        ? corner.coordinate > from && corner.coordinate < finish
        : corner.coordinate < from && corner.coordinate > finish,
    )
    .sort((a, b) => direction * (a.coordinate - b.coordinate));
  const points = [source, start, ...turns.map((corner) => corner.point), end, target].filter(
    (point, index, all) => !index || point.x !== all[index - 1].x || point.y !== all[index - 1].y,
  );
  let label = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  let labelLength = -1;
  for (let index = 1; index < points.length - 2; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (a.y === b.y && Math.abs(a.x - b.x) > labelLength) {
      labelLength = Math.abs(a.x - b.x);
      label = { x: (a.x + b.x) / 2, y: a.y };
    }
  }
  return { path: roundedPath(points), labelX: label.x, labelY: label.y };
}

function roundedPath(points: Point[]) {
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const before = Math.hypot(previous.x - corner.x, previous.y - corner.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(12, before / 2, after / 2);
    const a = {
      x: corner.x + ((previous.x - corner.x) * radius) / before,
      y: corner.y + ((previous.y - corner.y) * radius) / before,
    };
    const b = {
      x: corner.x + ((next.x - corner.x) * radius) / after,
      y: corner.y + ((next.y - corner.y) * radius) / after,
    };
    path += ` L${a.x},${a.y} Q${corner.x},${corner.y} ${b.x},${b.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L${end.x},${end.y}`;
}
