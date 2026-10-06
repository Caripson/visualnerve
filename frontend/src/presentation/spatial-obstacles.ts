import type { CanvasNode } from '../canvas/projection';
import { spatialNodeDimensions } from '../spatial/scene';
import type { SpatialPoint } from '../spatial/types';
import { presentationObstacle, type PresentationObstacle } from './camera';

/** Selection, labels and styles do not invalidate a flight; visible physical geometry does. */
export function spatialPresentationGeometryKey(
  nodes: readonly CanvasNode[],
  positions: ReadonlyMap<string, SpatialPoint>,
  scale: number,
) {
  return JSON.stringify(
    nodes.flatMap((node) => {
      const point = positions.get(node.id);
      if (node.hidden || !point) return [];
      const { width, height, depth } = spatialNodeDimensions(node, scale);
      return [
        [
          node.id,
          point.x,
          point.y,
          point.z - (node.data.node.nodeType === 'group' ? 0.16 * scale : 0),
          width,
          height,
          depth,
        ],
      ];
    }),
  );
}

/** Collision geometry covers every visible card, independently of WebGL residency. */
export function spatialPresentationObstacles(
  nodes: readonly CanvasNode[],
  positions: ReadonlyMap<string, SpatialPoint>,
  scale: number,
  worldMatrix: readonly number[],
): PresentationObstacle[] {
  const obstacles: PresentationObstacle[] = [];
  for (const node of nodes) {
    if (node.hidden) continue;
    const point = positions.get(node.id);
    if (!point) continue;
    const { width, height, depth } = spatialNodeDimensions(node, scale);
    obstacles.push(
      presentationObstacle(
        node.id,
        {
          ...point,
          // Group cards sit behind their children, as in createSpatialBatches.
          z: point.z - (node.data.node.nodeType === 'group' ? 0.16 * scale : 0),
        },
        { x: width, y: height, z: depth },
        worldMatrix,
      ),
    );
  }
  return obstacles;
}
