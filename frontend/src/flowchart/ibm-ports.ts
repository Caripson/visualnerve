import type { GraphNode } from '../model/types';
import { getIbmSymbol, type IBMPoint, type IBMSymbolId } from './ibm-symbols';

export type IBMPortSide = 'left' | 'right' | 'top' | 'bottom';
const directions: Record<IBMPortSide, IBMPoint> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

/** A cardinal ray from the logical center ends at the actual normalized outline. */
export function ibmPortPoint(id: IBMSymbolId, side: IBMPortSide): IBMPoint {
  const points = getIbmSymbol(id)!.outline,
    [dx, dy] = directions[side];
  let nearest = Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length],
      ax = a[0] - 0.5,
      ay = a[1] - 0.5,
      sx = b[0] - a[0],
      sy = b[1] - a[1],
      cross = dx * sy - dy * sx;
    if (Math.abs(cross) < 1e-12) continue;
    const alongRay = (ax * sy - ay * sx) / cross,
      alongSegment = (ax * dy - ay * dx) / cross;
    if (alongRay > 1e-8 && alongSegment >= -1e-8 && alongSegment <= 1 + 1e-8)
      nearest = Math.min(nearest, alongRay);
  }
  const fraction = Number.isFinite(nearest) ? nearest : 0.5;
  return [
    Math.max(0, Math.min(1, 0.5 + dx * fraction)),
    Math.max(0, Math.min(1, 0.5 + dy * fraction)),
  ];
}

/** Accept only port IDs that the existing IBM node renderer actually exposes. */
export function ibmSavedHandle(
  node: GraphNode | undefined,
  role: 'source' | 'target',
  value: unknown,
): string | undefined {
  if (!getIbmSymbol(node?.flowchartSymbol)) return;
  if (role === 'source') {
    if (value === 'out' || value === 'out-bottom') return value;
    if (value === 'out-top' && node?.metadata.simulationLayoutProjected === true) return value;
  } else {
    if (value === 'in' || value === 'in-top') return value;
    if (value === 'in-bottom' && node?.metadata.simulationLayoutProjected === true) return value;
  }
}
