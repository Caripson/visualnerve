import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EdgeNotation, NotationDecoration } from './types';
import {
  notationConnectorGeometry,
  notationEdgeAppearance,
  notationHatchedArrow,
  type NotationLineLayout,
  type NotationEdgeContext,
} from './edge-geometry';

/** Planar relationship decorations preserve UML/BPMN meaning when the sheet rotates. */
export function notationMarkerGeometry(
  value: NotationDecoration,
  scale: number,
  hatched = false,
  ribbon = hatched,
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const polygon = (points: [number, number][], hole = false) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    if (hole) {
      const center = points
        .reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0])
        .map((value) => value / points.length);
      shape.holes.push(
        new THREE.Path(
          points
            .map(
              ([x, y]) =>
                new THREE.Vector2(
                  center[0] + (x - center[0]) * 0.68,
                  center[1] + (y - center[1]) * 0.68,
                ),
            )
            .reverse(),
        ),
      );
    }
    pieces.push(new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false, steps: 1 }));
  };
  const line = (a: [number, number], b: [number, number]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      nx = (-(b[1] - a[1]) / length) * 0.009,
      ny = ((b[0] - a[0]) / length) * 0.009;
    polygon([
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ]);
  };
  if (ribbon) {
    const head = notationHatchedArrow(),
      point = (p: { x: number; y: number }): [number, number] => [
        (p.x - 10) * 0.01,
        (5 - p.y) * 0.01,
      ];
    head.outline.forEach((p, index) =>
      line(point(p), point(head.outline[(index + 1) % head.outline.length])),
    );
    if (hatched) for (const [a, b] of head.hatches) line(point(a), point(b));
  } else if (value.includes('diamond'))
    polygon(
      [
        [0, 0],
        [-0.12, 0.075],
        [-0.24, 0],
        [-0.12, -0.075],
      ],
      value.startsWith('hollow'),
    );
  else if (value.includes('triangle') || value === 'filled-arrow')
    polygon(
      [
        [0, 0],
        [-0.22, 0.09],
        [-0.22, -0.09],
      ],
      value.startsWith('hollow'),
    );
  else if (value === 'open-arrow') {
    line([-0.18, 0.08], [0, 0]);
    line([0, 0], [-0.18, -0.08]);
  } else if (value === 'circle') {
    const points: [number, number][] = [];
    for (let index = 0; index < 32; index++) {
      const angle = (index / 32) * Math.PI * 2;
      points.push([-0.07 + Math.cos(angle) * 0.07, Math.sin(angle) * 0.07]);
    }
    polygon(points, true);
  } else if (value === 'cross') {
    line([-0.12, -0.075], [0, 0.075]);
    line([-0.12, 0.075], [0, -0.075]);
  }
  const merged = pieces.length ? mergeGeometries(pieces) : new THREE.BufferGeometry();
  for (const piece of pieces) piece.dispose();
  merged.scale(scale, scale, scale);
  merged.userData.notationDecoration = value;
  merged.userData.forwardAxis = 'x';
  merged.userData.hatched = hatched;
  merged.userData.ribbon = ribbon;
  return merged;
}

/** Convert world Y-up coordinates into the shared sheet convention, then back. */
export function notationSpatialSegments(
  value: EdgeNotation,
  points: readonly THREE.Vector3[],
  scale: number,
  layout?: NotationLineLayout,
  context: NotationEdgeContext = {},
) {
  const appearance = notationEdgeAppearance(value, context);
  const inset = (decoration: NotationDecoration) =>
    decoration === 'hollow-diamond'
      ? 0.24
      : decoration === 'hollow-triangle'
        ? 0.22
        : decoration === 'circle'
          ? 0.14
          : 0;
  const start = inset(appearance.sourceDecoration) * scale,
    end = inset(appearance.targetDecoration) * scale;
  const distances = [0];
  for (let index = 1; index < points.length; index++)
    distances.push(distances.at(-1)! + points[index - 1].distanceTo(points[index]));
  const total = distances.at(-1) ?? 0,
    from = Math.min(start, total * 0.45),
    to = Math.max(from, total - Math.min(end, total * 0.45));
  const pointAt = (distance: number) => {
    let at = 1;
    while (at < points.length - 1 && distances[at] < distance) at++;
    const a = points[Math.max(0, at - 1)] ?? new THREE.Vector3(),
      b = points[at] ?? a;
    return a
      .clone()
      .lerp(
        b,
        (distance - (distances[at - 1] ?? 0)) /
          Math.max(1e-12, (distances[at] ?? 0) - (distances[at - 1] ?? 0)),
      );
  };
  const trimmed =
    start || end
      ? value.waypoints?.length
        ? [pointAt(from), ...points.slice(1, -1), pointAt(to)]
        : points.map((_, index) =>
            pointAt(from + ((to - from) * index) / Math.max(1, points.length - 1)),
          )
      : points;
  const shape = notationConnectorGeometry(
    value,
    trimmed.map((point) => ({ x: point.x, y: -point.y, z: point.z })),
    0.01 * scale,
    layout,
    context,
  );
  return {
    segments: shape.segments.map(
      ([a, b]) =>
        [new THREE.Vector3(a.x, -a.y, a.z ?? 0), new THREE.Vector3(b.x, -b.y, b.z ?? 0)] as const,
    ),
    layout: shape.layout,
  };
}
/** WebGL's native lines cannot reliably become thicker, so heavy HIPO actions own real ribbons. */
export function notationRibbonPositions(
  segments: readonly (readonly [THREE.Vector3, THREE.Vector3])[],
  width: number,
) {
  const vertices: number[] = [];
  for (const [a, b] of segments) {
    const size = Math.hypot(b.x - a.x, b.y - a.y) || 1,
      nx = ((-(b.y - a.y) / size) * width) / 2,
      ny = (((b.x - a.x) / size) * width) / 2;
    const leftA = [a.x + nx, a.y + ny, a.z],
      rightA = [a.x - nx, a.y - ny, a.z],
      leftB = [b.x + nx, b.y + ny, b.z],
      rightB = [b.x - nx, b.y - ny, b.z];
    vertices.push(...leftA, ...leftB, ...rightA, ...rightA, ...leftB, ...rightB);
  }
  return vertices;
}
