import * as THREE from 'three';
import type { Edge } from '@xyflow/react';
import type { SpatialPoint } from './types';
import { cardConnectionPoint, spatialEdgePoints, type SpatialBatches } from './scene';

/** Reversible GPU-only preview. It never writes the editor graph or creates new textures. */
export function spatialMovementPreview(
  batches: SpatialBatches,
  labels: THREE.Group,
  ids: Set<string>,
  edges: Edge[],
  scale: number,
) {
  const matrices = new Map<THREE.InstancedMesh, Map<number, THREE.Matrix4>>();
  const remember = (mesh: THREE.InstancedMesh, index: number) => {
    let entries = matrices.get(mesh);
    if (!entries) matrices.set(mesh, (entries = new Map()));
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    entries.set(index, matrix);
  };
  const positions = new Map<string, THREE.Vector3>();
  const frames = new Map<THREE.Matrix4, THREE.Matrix4>();
  for (const id of ids) {
    const instance = batches.nodes.get(id);
    if (!instance) continue;
    positions.set(id, instance.position.clone());
    remember(instance.mesh, instance.index);
    for (const frame of batches.frames.get(id) ?? []) {
      remember(frame.mesh, frame.index);
      frames.set(frame.matrix, frame.matrix.clone());
    }
  }
  const affected = edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target));
  const originalPoints = new Map(
    affected.map((edge) => [edge.id, batches.edgePoints.get(edge.id)]),
  );
  const edgeGeometries = new Set<THREE.BufferGeometry>();
  const originals = new Map<THREE.BufferAttribute, Float32Array>();
  for (const edge of affected) {
    const range = batches.edges.get(edge.id);
    if (!range) continue;
    edgeGeometries.add(range.line.geometry);
    for (const name of ['position', 'lineDistance']) {
      const attribute = range.line.geometry.getAttribute(name) as THREE.BufferAttribute;
      if (!originals.has(attribute)) originals.set(attribute, new Float32Array(attribute.array));
    }
    for (const arrow of batches.arrows.get(edge.id) ?? []) remember(arrow.mesh, arrow.index);
  }
  const translate = (matrix: THREE.Matrix4, original: THREE.Matrix4, delta: THREE.Vector3) => {
    matrix.copy(original);
    matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(original).add(delta));
  };
  const updateBounds = () => {
    for (const mesh of matrices.keys()) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    for (const geometry of edgeGeometries) geometry.computeBoundingSphere();
  };
  const updateLabels = () => {
    for (const face of labels.children) {
      const node = ids.has(face.userData.nodeId)
        ? batches.nodes.get(face.userData.nodeId)
        : undefined;
      if (node) {
        face.position.x = node.position.x;
        face.position.y = node.position.y;
      }
      if (originalPoints.has(face.userData.edgeId)) {
        const points = batches.edgePoints.get(face.userData.edgeId);
        if (points?.length)
          face.position
            .copy(points[Math.floor(points.length / 2)])
            .add(new THREE.Vector3(0, 0.13 * scale, 0.003));
      }
    }
  };
  return {
    update(delta: SpatialPoint) {
      const offset = new THREE.Vector3(delta.x, delta.y, 0);
      const matrix = new THREE.Matrix4();
      for (const [mesh, entries] of matrices)
        for (const [index, original] of entries) {
          translate(matrix, original, offset);
          mesh.setMatrixAt(index, matrix);
        }
      for (const [id, original] of positions)
        batches.nodes.get(id)!.position.copy(original).add(offset);
      for (const [frame, original] of frames) translate(frame, original, offset);
      for (const edge of affected) {
        const source = batches.nodes.get(edge.source),
          target = batches.nodes.get(edge.target);
        const range = batches.edges.get(edge.id);
        if (!source || !target || !range) continue;
        const selfLoop = edge.source === edge.target;
        let points = selfLoop
          ? spatialEdgePoints(
              {
                x: source.position.x,
                y: source.position.y + source.dimensions.y / 2,
                z: source.position.z + source.dimensions.z / 2,
              },
              target.position,
              true,
              Math.max(source.dimensions.x, source.dimensions.y) * 0.8,
            )
          : spatialEdgePoints(
              cardConnectionPoint(source.position, target.position, source.dimensions, scale),
              cardConnectionPoint(target.position, source.position, target.dimensions, scale),
              false,
              scale,
            );
        if (points.length < 2)
          points = spatialEdgePoints(source.position, target.position, true, scale);
        batches.edgePoints.set(edge.id, points);
        // Preserve the existing buffer's range and relationship identity if endpoints coincide.
        const segments = range.count / 2;
        const pointAt = (index: number) => {
          const at = (index / segments) * (points.length - 1);
          const lower = Math.floor(at);
          return points[lower]
            .clone()
            .lerp(points[Math.min(lower + 1, points.length - 1)], at - lower);
        };
        const attribute = range.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        const distanceAttribute = range.line.geometry.getAttribute(
          'lineDistance',
        ) as THREE.BufferAttribute;
        let distance = 0;
        for (let index = 0; index < segments; index++) {
          const a = pointAt(index),
            b = pointAt(index + 1),
            at = range.start + index * 2;
          attribute.setXYZ(at, a.x, a.y, a.z);
          attribute.setXYZ(at + 1, b.x, b.y, b.z);
          distanceAttribute.setX(at, distance);
          distance += a.distanceTo(b);
          distanceAttribute.setX(at + 1, distance);
        }
        attribute.addUpdateRange(range.start * 3, range.count * 3);
        attribute.needsUpdate = true;
        distanceAttribute.addUpdateRange(range.start, range.count);
        distanceAttribute.needsUpdate = true;
        const arrows = batches.arrows.get(edge.id) ?? [];
        let arrowIndex = 0;
        for (const atEnd of [true, false]) {
          if (atEnd ? !edge.markerEnd : !edge.markerStart) continue;
          const arrow = arrows[arrowIndex++];
          if (!arrow) continue;
          const at = atEnd ? points.length - 4 : 3;
          const direction = (atEnd ? points[at + 1] : points[at - 1])
            .clone()
            .sub(points[at])
            .normalize();
          matrix.compose(
            points[at],
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
            new THREE.Vector3(1, 1, 1),
          );
          arrow.mesh.setMatrixAt(arrow.index, matrix);
        }
      }
      updateLabels();
      updateBounds();
    },
    restore() {
      for (const [mesh, entries] of matrices)
        for (const [index, matrix] of entries) mesh.setMatrixAt(index, matrix);
      for (const [id, position] of positions) batches.nodes.get(id)!.position.copy(position);
      for (const [frame, original] of frames) frame.copy(original);
      for (const [attribute, original] of originals) {
        attribute.array.set(original);
        attribute.needsUpdate = true;
      }
      for (const [id, points] of originalPoints) if (points) batches.edgePoints.set(id, points);
      updateLabels();
      updateBounds();
    },
  };
}
