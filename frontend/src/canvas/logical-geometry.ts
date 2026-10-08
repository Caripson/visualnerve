import type { GraphNode } from '../model/types';
import type { Geometry } from '../layouts/layout';

/** Extra capacity slots and compact scope layouts are views of the model, not editable shapes. */
export function isReadonlyCanvasNode(node: GraphNode): boolean {
  const metadata = node.metadata;
  if (metadata.simulationLayoutProjected === true) return true;
  if (metadata.simulationProjected !== true) return false;
  return (
    metadata.simulationLogicalNodeId !== node.id ||
    metadata.simulationPoolSummary === true ||
    typeof metadata.simulationProcessId === 'string'
  );
}

/** Commit the user's displacement without saving automatic packing offsets as model coordinates. */
export function canonicalGeometry(
  native: GraphNode,
  rendered: GraphNode | undefined,
  geometry: Geometry,
): Geometry {
  const origin = rendered ?? native;
  return {
    x: native.x + geometry.x - origin.x,
    y: native.y + geometry.y - origin.y,
    ...(geometry.width !== undefined ? { width: geometry.width } : {}),
    ...(geometry.height !== undefined ? { height: geometry.height } : {}),
  };
}

/** React Flow reports grouped positions relative to their parent, including moved parents. */
export function absoluteCanvasMoves(
  nodes: ReadonlyMap<string, GraphNode>,
  moves: ReadonlyMap<string, Geometry>,
): Map<string, Geometry> {
  const absolute = new Map<string, Geometry>();
  for (const id of moves.keys()) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current && !absolute.has(current) && moves.has(current)) {
      if (seen.has(current)) throw new Error('Canvas group hierarchy contains a cycle.');
      seen.add(current);
      path.push(current);
      const node = nodes.get(current);
      const parent = node?.parentId ? nodes.get(node.parentId) : undefined;
      current = parent?.nodeType === 'group' ? parent.id : undefined;
    }
    for (let index = path.length - 1; index >= 0; index--) {
      const entry = path[index];
      const node = nodes.get(entry);
      const parent = node?.parentId ? nodes.get(node.parentId) : undefined;
      const origin =
        parent?.nodeType === 'group' ? (absolute.get(parent.id) ?? parent) : { x: 0, y: 0 };
      const position = moves.get(entry)!;
      absolute.set(entry, { ...position, x: position.x + origin.x, y: position.y + origin.y });
    }
  }
  return absolute;
}
