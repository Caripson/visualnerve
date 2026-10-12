import type { EdgeNotation, NodeNotation, NotationDecoration } from './types';
import { getNotationEdgeSymbol } from './registry';

/** Shared vector marker geometry; origin is the connector endpoint at (10, 5). */
export function notationDecoration(
  decoration: NotationDecoration,
  hatched = false,
  ribbon = hatched,
) {
  const path: Record<NotationDecoration, string> = {
    none: '',
    'open-arrow': 'M 0 0 L 10 5 L 0 10',
    'filled-arrow': 'M 0 0 L 10 5 L 0 10 Z',
    'hollow-triangle': 'M 0 0 L 10 5 L 0 10 Z',
    'filled-triangle': 'M 0 0 L 10 5 L 0 10 Z',
    'hollow-diamond': 'M 0 5 L 5 0 L 10 5 L 5 10 Z',
    'filled-diamond': 'M 0 5 L 5 0 L 10 5 L 5 10 Z',
    circle: 'M 10 5 A 5 5 0 1 1 0 5 A 5 5 0 1 1 10 5 Z',
    cross: 'M 0 0 L 10 10 M 10 0 L 0 10',
  };
  return {
    path: ribbon ? 'M 0 2 L 2 2 L 2 0 L 10 5 L 2 10 L 2 8 L 0 8 Z' : path[decoration],
    detailPaths: hatched ? notationHatchedArrow().hatches.map(notationLinePath) : [],
    fill: ribbon
      ? 'background'
      : decoration.startsWith('filled')
        ? 'foreground'
        : decoration.startsWith('hollow') || decoration === 'circle'
          ? 'background'
          : 'none',
  } as const;
}
export interface NotationEdgeContext {
  sourceIsGateway?: boolean;
}
export const notationSourceIsGateway = (value?: NodeNotation) =>
  value?.collection === 'bpmn' && value.symbol.endsWith('-gateway');
export function notationEdgeAppearance(value: EdgeNotation, context: NotationEdgeContext = {}) {
  const definition = getNotationEdgeSymbol(value.collection, value.symbol)!;
  const sequence = value.collection === 'bpmn' && value.symbol === 'sequence-flow';
  const conditional = sequence && !context.sourceIsGateway && !!value.properties?.condition?.trim();
  const heavy = value.collection === 'hipo' && value.symbol === 'action-flow';
  const hatch = value.collection === 'hipo' && value.symbol === 'alteration-flow';
  return {
    ...definition,
    sourceDecoration: conditional ? ('hollow-diamond' as const) : definition.sourceDecoration,
    line: hatch ? ('solid' as const) : definition.line,
    double: value.collection === 'bpmn' && value.symbol === 'conversation-link',
    defaultFlow: sequence && value.properties?.default === true,
    conditional,
    heavy,
    hatch,
    ribbon: value.collection === 'hipo' && ['data-flow', 'alteration-flow'].includes(value.symbol),
    zigzag:
      value.collection === 'uml' && ['exception-flow', 'interrupting-flow'].includes(value.symbol),
  };
}
export interface NotationLinePoint {
  x: number;
  y: number;
  z?: number;
}
export interface NotationLineLayout {
  samples: number;
  hatches: number;
  preserveVertices?: boolean;
}
export type NotationLineSegment = readonly [NotationLinePoint, NotationLinePoint];
const length = (a: NotationLinePoint, b: NotationLinePoint) =>
  Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
const lerp = (a: NotationLinePoint, b: NotationLinePoint, t: number): NotationLinePoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
});
function sampler(points: readonly NotationLinePoint[]) {
  const distances = [0];
  for (let index = 1; index < points.length; index++)
    distances.push(distances.at(-1)! + length(points[index - 1], points[index]));
  const total = distances.at(-1) ?? 0;
  const at = (distance: number) => {
    let index = 1;
    while (index < points.length - 1 && distances[index] < distance) index++;
    const a = points[Math.max(0, index - 1)] ?? { x: 0, y: 0 },
      b = points[index] ?? a;
    return lerp(
      a,
      b,
      Math.max(
        0,
        Math.min(
          1,
          (distance - (distances[index - 1] ?? 0)) /
            Math.max(1e-12, (distances[index] ?? 0) - (distances[index - 1] ?? 0)),
        ),
      ),
    );
  };
  const frame = (distance: number) => {
    const p = at(distance),
      a = at(Math.max(0, distance - Math.max(total * 0.0001, 1e-6))),
      b = at(Math.min(total, distance + Math.max(total * 0.0001, 1e-6)));
    const size = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {
      p,
      tx: (b.x - a.x) / size,
      ty: (b.y - a.y) / size,
      nx: -(b.y - a.y) / size,
      ny: (b.x - a.x) / size,
    };
  };
  return { total, at, frame };
}
const offset = (p: NotationLinePoint, x: number, y: number): NotationLinePoint => ({
  ...p,
  x: p.x + x,
  y: p.y + y,
});
const segments = (points: readonly NotationLinePoint[]): NotationLineSegment[] =>
  points.slice(1).map((point, index) => [points[index], point]);
/** Actual connector strokes in sheet coordinates. A saved layout keeps GPU ranges stable during dragging. */
export function notationConnectorGeometry(
  value: EdgeNotation,
  points: readonly NotationLinePoint[],
  unit = 1,
  saved?: NotationLineLayout,
  context: NotationEdgeContext = {},
) {
  const appearance = notationEdgeAppearance(value, context),
    sample = sampler(points);
  const layout = saved ?? {
    samples: Math.max(appearance.zigzag ? 24 : 2, points.length - 1),
    hatches: Math.max(1, Math.min(128, Math.floor(sample.total / (8 * unit)))),
    preserveVertices: !!value.waypoints?.length,
  };
  const route = layout.preserveVertices
    ? points.map((point) => ({ ...point }))
    : Array.from({ length: layout.samples + 1 }, (_, index) =>
        sample.at((sample.total * index) / layout.samples),
      );
  if (appearance.zigzag && layout.preserveVertices) {
    let at = 0;
    for (let index = 1; index < route.length - 1; index++)
      if (length(route[index], route[index + 1]) > length(route[at], route[at + 1])) at = index;
    const a = route[at],
      b = route[at + 1],
      size = Math.hypot(b.x - a.x, b.y - a.y) || 1,
      amplitude = Math.min(8 * unit, size * 0.08);
    const bends = [0.38, 0.44, 0.5, 0.56, 0.62].map((t, index) => {
      const p = lerp(a, b, t),
        amount = index % 2 === 0 ? amplitude : -amplitude;
      return offset(p, (-(b.y - a.y) / size) * amount, ((b.x - a.x) / size) * amount);
    });
    route.splice(at + 1, 0, ...bends);
  } else if (appearance.zigzag) {
    const middle = Math.floor(layout.samples / 2),
      amplitude = Math.min(8 * unit, sample.total * 0.08);
    for (
      let index = Math.max(1, middle - 2);
      index <= Math.min(layout.samples - 1, middle + 2);
      index++
    ) {
      const frame = sample.frame((sample.total * index) / layout.samples),
        direction = (index - middle) % 2 === 0 ? 1 : -1;
      route[index] = offset(
        route[index],
        frame.nx * amplitude * direction,
        frame.ny * amplitude * direction,
      );
    }
  }
  const strokeRoute =
    appearance.ribbon && layout.preserveVertices
      ? [...route.slice(0, -1), sample.at(Math.max(0, sample.total - 10 * unit))]
      : appearance.ribbon
        ? Array.from({ length: layout.samples + 1 }, (_, index) =>
            sample.at((Math.max(0, sample.total - 10 * unit) * index) / layout.samples),
          )
        : route;
  const rails = (amount: number) =>
    strokeRoute.map((point, index) => {
      const before = strokeRoute[Math.max(0, index - 1)],
        after = strokeRoute[Math.min(strokeRoute.length - 1, index + 1)],
        size = Math.hypot(after.x - before.x, after.y - before.y) || 1;
      return offset(
        point,
        (-(after.y - before.y) / size) * amount,
        ((after.x - before.x) / size) * amount,
      );
    });
  const strokes =
    appearance.double || appearance.ribbon
      ? [rails((appearance.ribbon ? 3 : 2) * unit), rails(-(appearance.ribbon ? 3 : 2) * unit)]
      : [route];
  const details: NotationLineSegment[] = [];
  if (appearance.hatch)
    for (let index = 0; index < layout.hatches; index++) {
      const frame = sample.frame(
          (Math.max(0, sample.total - 10 * unit) * (index + 0.5)) / layout.hatches,
        ),
        half = Math.min(3 * unit, Math.max(0, sample.total - 10 * unit) / (layout.hatches * 2));
      details.push([
        offset(
          frame.p,
          frame.nx * 3 * unit - frame.tx * half,
          frame.ny * 3 * unit - frame.ty * half,
        ),
        offset(
          frame.p,
          -frame.nx * 3 * unit + frame.tx * half,
          -frame.ny * 3 * unit + frame.ty * half,
        ),
      ]);
    }
  if (appearance.defaultFlow) {
    const frame = sample.frame(Math.min(12 * unit, sample.total * 0.25));
    details.push([
      offset(
        frame.p,
        frame.nx * 7 * unit - frame.tx * 4 * unit,
        frame.ny * 7 * unit - frame.ty * 4 * unit,
      ),
      offset(
        frame.p,
        -frame.nx * 7 * unit + frame.tx * 4 * unit,
        -frame.ny * 7 * unit + frame.ty * 4 * unit,
      ),
    ]);
  }
  return {
    route,
    strokes,
    details,
    segments: [...strokes.flatMap(segments), ...details],
    layout,
    strokeWidth: appearance.heavy ? 3.5 : 1.6,
  };
}
export function notationLinePath(points: readonly NotationLinePoint[]) {
  return points.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}
/** Samples only trusted generated connector paths, without browser SVG APIs in workers. */
export function notationPathPoints(path: string): NotationLinePoint[] {
  const tokens = path.match(/[MLHVQC]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? [];
  const points: NotationLinePoint[] = [],
    number = () => Number(tokens[index++]);
  let index = 0,
    current = { x: 0, y: 0 },
    command = 'M';
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++].toUpperCase();
    const from = current;
    if (command === 'M' || command === 'L') {
      current = { x: number(), y: number() };
      points.push(current);
      if (command === 'M') command = 'L';
    } else if (command === 'H') {
      current = { x: number(), y: current.y };
      points.push(current);
    } else if (command === 'V') {
      current = { x: current.x, y: number() };
      points.push(current);
    } else if (command === 'Q' || command === 'C') {
      const first = { x: number(), y: number() },
        second = command === 'C' ? { x: number(), y: number() } : first,
        end = { x: number(), y: number() };
      for (let step = 1; step <= 8; step++) {
        const t = step / 8,
          s = 1 - t;
        points.push(
          command === 'Q'
            ? {
                x: s * s * from.x + 2 * s * t * first.x + t * t * end.x,
                y: s * s * from.y + 2 * s * t * first.y + t * t * end.y,
              }
            : {
                x:
                  s * s * s * from.x +
                  3 * s * s * t * first.x +
                  3 * s * t * t * second.x +
                  t * t * t * end.x,
                y:
                  s * s * s * from.y +
                  3 * s * s * t * first.y +
                  3 * s * t * t * second.y +
                  t * t * t * end.y,
              },
        );
      }
      current = end;
    } else break;
  }
  return points;
}
export function notationConnectorPaths(
  value: EdgeNotation,
  path: string,
  context: NotationEdgeContext = {},
) {
  const appearance = notationEdgeAppearance(value, context),
    points = notationPathPoints(path),
    geometry = notationConnectorGeometry(
      value,
      points,
      1,
      {
        samples: Math.max(24, points.length - 1),
        hatches: Math.max(1, Math.min(128, Math.floor(sampler(points).total / 8))),
        preserveVertices: !!value.waypoints?.length,
      },
      context,
    );
  return {
    ...geometry,
    path: appearance.zigzag ? notationLinePath(geometry.route) : path,
    strokePaths:
      appearance.double || appearance.ribbon
        ? geometry.strokes.map(notationLinePath)
        : [appearance.zigzag ? notationLinePath(geometry.route) : path],
    detailPaths: geometry.details.map(notationLinePath),
  };
}

/** HIPO's outlined alteration arrowhead carries the same diagonal hatch as its shaft. */
export function notationHatchedArrow() {
  const outline: NotationLinePoint[] = [
    { x: 0, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 0 },
    { x: 10, y: 5 },
    { x: 2, y: 10 },
    { x: 2, y: 8 },
    { x: 0, y: 8 },
  ];
  const hatches: NotationLineSegment[] = [];
  for (let intercept = 3; intercept < 18; intercept += 3) {
    const intersections: NotationLinePoint[] = [];
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index],
        b = outline[(index + 1) % outline.length],
        av = a.x + a.y,
        bv = b.x + b.y;
      if ((av <= intercept && bv > intercept) || (bv <= intercept && av > intercept))
        intersections.push(lerp(a, b, (intercept - av) / (bv - av)));
    }
    intersections.sort((a, b) => a.x - b.x);
    for (let index = 1; index < intersections.length; index += 2)
      hatches.push([intersections[index - 1], intersections[index]]);
  }
  return { outline, hatches };
}
