import * as THREE from 'three';
import { getIbmSymbol, type IBMSymbolId } from '../flowchart/ibm-symbols';

/** Extrude the same normalized outline used by 2D and vector export. */
export function ibmReliefGeometry(id: IBMSymbolId): THREE.ExtrudeGeometry {
  const symbol = getIbmSymbol(id)!;
  const contour = symbol.outline.map(([x, y]) => new THREE.Vector2(x - 0.5, 0.5 - y));
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(contour), {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  geometry.userData.flowchartSymbol = id;
  return geometry;
}

/** A ray from the logical centre terminates at the actual symbol silhouette. */
export function ibmConnectionFraction(id: IBMSymbolId, dx: number, dy: number): number | undefined {
  const points = getIbmSymbol(id)!.outline;
  let nearest = Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length];
    const ax = a[0] - 0.5,
      ay = 0.5 - a[1];
    const sx = b[0] - a[0],
      sy = a[1] - b[1];
    const cross = dx * sy - dy * sx;
    if (Math.abs(cross) < 1e-12) continue;
    const alongRay = (ax * sy - ay * sx) / cross;
    const alongSegment = (ax * dy - ay * dx) / cross;
    if (alongRay > 1e-8 && alongSegment >= -1e-8 && alongSegment <= 1 + 1e-8)
      nearest = Math.min(nearest, alongRay);
  }
  return Number.isFinite(nearest) ? nearest : undefined;
}
