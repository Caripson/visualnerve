import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { notationGeometry } from './geometry';
import { getNotationSymbol } from './registry';
import type { NodeNotation } from './types';
import { notationGuard, notationPrefix } from './labels';

/** Closed silhouettes become relief; containers/open shapes remain thin frames. */
export function notationReliefGeometry(value: NodeNotation): THREE.BufferGeometry {
  const geometry = notationGeometry(value),
    descriptor = getNotationSymbol(value.collection, value.symbol)!;
  if (geometry.reliefContours?.length) {
    const pieces = geometry.reliefContours.map(
      (points) =>
        new THREE.ExtrudeGeometry(
          new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x - 0.5, 0.5 - y))),
          { depth: 1, steps: 1, bevelEnabled: false, curveSegments: 4 },
        ),
    );
    const result = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    result.translate(0, 0, -0.5);
    result.userData.notation = value;
    return result;
  }
  const contour = geometry.outline.map(([x, y]) => new THREE.Vector2(x - 0.5, 0.5 - y));
  const shape = new THREE.Shape(contour);
  if (descriptor.container || geometry.outlineFill === 'none') {
    // A package's concave tab needs an interior kernel point for a valid inset hole.
    const center =
      descriptor.geometry === 'package'
        ? new THREE.Vector2(-0.25, 0)
        : contour
            .reduce((sum, point) => sum.add(point), new THREE.Vector2())
            .divideScalar(contour.length);
    const inner = contour.map((point) =>
      point.clone().sub(center).multiplyScalar(0.97).add(center),
    );
    shape.holes.push(new THREE.Path(inner.reverse()));
  }
  const result = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 4,
  });
  result.translate(0, 0, -0.5);
  result.userData.notation = value;
  return result;
}
export function notationConnectionFraction(value: NodeNotation, dx: number, dy: number) {
  const points = notationGeometry(value).outline;
  let nearest = Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length];
    const ax = a[0] - 0.5,
      ay = 0.5 - a[1],
      sx = b[0] - a[0],
      sy = a[1] - b[1],
      cross = dx * sy - dy * sx;
    if (Math.abs(cross) < 1e-12) continue;
    const ray = (ax * sy - ay * sx) / cross,
      segment = (ax * dy - ay * dx) / cross;
    if (ray > 1e-8 && segment >= -1e-8 && segment <= 1 + 1e-8) nearest = Math.min(nearest, ray);
  }
  return Number.isFinite(nearest) ? nearest : undefined;
}
/** Temporary face before the bounded native 2D capture finishes. */
export function paintNotationFace(
  context: CanvasRenderingContext2D,
  value: NodeNotation,
  title: string,
  options: { background?: string; color?: string },
  back = false,
) {
  const geometry = notationGeometry(value),
    descriptor = getNotationSymbol(value.collection, value.symbol)!;
  const { width, height } = context.canvas;
  context.save();
  context.scale(width / 100, height / 100);
  if (back) {
    context.translate(100, 0);
    context.scale(-1, 1);
  }
  context.lineWidth = geometry.strokeWidth ?? 1.5;
  context.strokeStyle = options.color ?? '#31766c';
  context.fillStyle =
    geometry.outlineFill === 'foreground'
      ? (options.color ?? '#31766c')
      : (options.background ?? '#ffffff');
  if (geometry.stroke === 'dashed') context.setLineDash([5, 3]);
  const outline = new Path2D(geometry.outlinePath);
  if (geometry.outlineFill !== 'none' && !descriptor.container) context.fill(outline);
  context.save();
  context.globalAlpha *= 0.12;
  context.fillStyle = options.color ?? '#31766c';
  for (const path of geometry.shadedPaths ?? []) context.fill(new Path2D(path));
  context.restore();
  context.stroke(outline);
  context.setLineDash([]);
  for (const path of geometry.detailPaths) context.stroke(new Path2D(path));
  context.fillStyle = options.color ?? '#31766c';
  context.setLineDash([2, 1]);
  for (const path of geometry.dashedPaths ?? []) context.stroke(new Path2D(path));
  context.setLineDash([]);
  for (const path of geometry.filledPaths) context.fill(new Path2D(path));
  context.strokeStyle = options.background ?? '#ffffff';
  for (const path of geometry.contrastPaths ?? []) context.stroke(new Path2D(path));
  context.restore();
  const prefix = notationPrefix(value);
  if (prefix != null && geometry.prefixBox) {
    const box = geometry.prefixBox;
    context.font = `${Math.min(24, Math.max(10, (box.height * height) / 2))}px system-ui, sans-serif`;
    context.fillStyle = options.color ?? '#182c25';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      String(prefix),
      (back ? 1 - box.x - box.width / 2 : box.x + box.width / 2) * width,
      (box.y + box.height / 2) * height,
      box.width * width,
    );
  }
  const guard = notationGuard(value);
  if (guard && geometry.guardBox) {
    const box = geometry.guardBox;
    context.font = `${Math.min(24, Math.max(10, (box.height * height) / 2))}px system-ui, sans-serif`;
    context.fillStyle = options.color ?? '#182c25';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      guard,
      (back ? 1 - box.x - box.width / 2 : box.x + box.width / 2) * width,
      (box.y + box.height / 2) * height,
      box.width * width,
    );
  }
  if (geometry.titleStyle === 'hidden') return;
  const box = geometry.contentBox,
    x = (back ? 1 - box.x - box.width : box.x) * width,
    y = box.y * height;
  const prefixHeight = prefix && !geometry.prefixBox ? Math.min(16, (box.height * height) / 3) : 0;
  if (prefixHeight) {
    context.font = `${Math.max(9, prefixHeight * 0.8)}px system-ui, sans-serif`;
    context.fillStyle = options.color ?? '#182c25';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(prefix!, x + (box.width * width) / 2, y + prefixHeight / 2, box.width * width);
  }
  const font = Math.min(32, Math.max(12, (box.height * height) / 3));
  context.font = `600 ${font}px system-ui, sans-serif`;
  context.fillStyle = options.color ?? '#182c25';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (geometry.titleRotation) {
    context.save();
    context.translate(x + (box.width * width) / 2, y + (box.height * height) / 2);
    context.rotate((geometry.titleRotation * Math.PI) / 180);
    context.fillText(title, 0, 0, box.height * height);
    context.restore();
    return;
  }
  context.fillText(
    title,
    x + (box.width * width) / 2,
    y + prefixHeight + Math.min((box.height * height - prefixHeight) / 2, font),
    box.width * width,
  );
}
