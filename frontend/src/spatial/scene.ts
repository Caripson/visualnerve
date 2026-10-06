import * as THREE from 'three';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import type { SpatialPoint } from './types';

export const SPATIAL_NODE_LIMIT = 8000;
export const SPATIAL_EDGE_LIMIT = 16000;
export const SPATIAL_LABEL_LIMIT = 120;
export const spatialGlyphScale = (radius: number) => Math.max(1, radius / 60);

/** Keep selection visible without letting a large imported graph overwhelm WebGL. */
export function boundedSpatialProjection(
  nodes: CanvasNode[],
  edges: Edge[],
  selectedNodes: string[],
  selectedEdges: string[],
) {
  const visible = nodes.filter((node) => !node.hidden);
  const selected = new Set(selectedNodes);
  const selectedRelationships = new Set(selectedEdges);
  const incident = new Set(
    edges
      .filter((edge) => !edge.hidden && selectedRelationships.has(edge.id))
      .flatMap((edge) => [edge.source, edge.target]),
  );
  const priority = visible.filter((node) => selected.has(node.id) || incident.has(node.id));
  const chosen = [
    ...priority,
    ...visible.filter((node) => !selected.has(node.id) && !incident.has(node.id)),
  ].slice(0, SPATIAL_NODE_LIMIT);
  const ids = new Set(chosen.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => !edge.hidden);
  const eligible = visibleEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const chosenEdges = [
    ...eligible.filter((edge) => selectedRelationships.has(edge.id)),
    ...eligible.filter((edge) => !selectedRelationships.has(edge.id)),
  ].slice(0, SPATIAL_EDGE_LIMIT);
  return {
    nodes: chosen,
    edges: chosenEdges,
    totalNodes: visible.length,
    totalEdges: visibleEdges.length,
    truncated: chosen.length < visible.length || chosenEdges.length < visibleEdges.length,
  };
}

export function spatialEdgePoints(
  source: SpatialPoint,
  target: SpatialPoint,
  selfLoop: boolean,
  scale = 1,
) {
  const a = new THREE.Vector3(source.x, source.y, source.z);
  const b = new THREE.Vector3(target.x, target.y, target.z);
  if (selfLoop) {
    const center = a.clone().add(new THREE.Vector3(0, 0.5 * scale, 0));
    return Array.from({ length: 49 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2 - Math.PI / 2;
      return center
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * 0.52 * scale,
            Math.sin(angle) * 0.5 * scale,
            0.08 * scale,
          ),
        );
    });
  }
  const direction = b.clone().sub(a);
  if (direction.lengthSq() < 0.000001) return [];
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  // A shallow arch makes links easier to pick and separates them from the object faces.
  midpoint.z += Math.min(0.28 * scale, direction.length() * 0.08);
  return new THREE.QuadraticBezierCurve3(a, midpoint, b).getPoints(24);
}

/** Release every owned GPU resource, including canvas-backed text labels. */
export function disposeSpatialScene(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instances = new Set<THREE.InstancedMesh>();
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) instances.add(object);
    const renderable = object as THREE.Mesh;
    // Sprite's quad is shared by Three.js; each label only owns its texture and material.
    if (renderable.geometry && !(object instanceof THREE.Sprite))
      geometries.add(renderable.geometry);
    if (!renderable.material) return;
    for (const material of Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const instance of instances) instance.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  group.clear();
}

export function spatialTextSprite(
  text: string,
  options: { color?: string; background?: string; width?: number } = {},
) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = options.background ?? '#ffffff';
  context.beginPath();
  context.roundRect(4, 8, 504, 96, 16);
  context.fill();
  context.strokeStyle = '#d2dad5';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = options.color ?? '#182c25';
  context.font = '600 38px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let title = text;
  while (title.length > 1 && context.measureText(title).width > 472) title = title.slice(0, -1);
  if (title !== text) title = `${title.slice(0, -1)}…`;
  context.fillText(title, 256, 56);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  const width = options.width ?? 1.75;
  sprite.scale.set(width, (width * 112) / 512, 1);
  sprite.renderOrder = 5;
  sprite.userData.labelPixelWidth = options.width ? 130 : 155;
  return sprite;
}

export function isCompletedStatus(status: string | undefined) {
  return ['done', 'complete', 'completed', 'klart', 'klar', 'finished'].includes(
    status?.toLowerCase().trim() ?? '',
  );
}

export interface SpatialNodeInstance {
  mesh: THREE.InstancedMesh;
  index: number;
  position: THREE.Vector3;
  color: THREE.Color;
}
export interface SpatialEdgeBatchRange {
  line: THREE.LineSegments;
  start: number;
  count: number;
  color: THREE.Color;
}
export interface SpatialArrowInstance {
  mesh: THREE.InstancedMesh;
  index: number;
  color: THREE.Color;
}
export interface SpatialBatches {
  group: THREE.Group;
  pickable: THREE.Object3D[];
  nodes: Map<string, SpatialNodeInstance>;
  edges: Map<string, SpatialEdgeBatchRange>;
  arrows: Map<string, SpatialArrowInstance[]>;
  edgePoints: Map<string, THREE.Vector3[]>;
}
const batchColor = (value: unknown, fallback: string) =>
  new THREE.Color(typeof value === 'string' && !value.includes('var(') ? value : fallback);

/** Thousands of canonical objects share a handful of meshes and line buffers. */
export function createSpatialBatches(
  nodes: CanvasNode[],
  edges: Edge[],
  positions: Map<string, SpatialPoint>,
  scale = 1,
): SpatialBatches {
  const result: SpatialBatches = {
    group: new THREE.Group(),
    pickable: [],
    nodes: new Map(),
    edges: new Map(),
    arrows: new Map(),
    edgePoints: new Map(),
  };
  const nodeGroups = new Map<string, CanvasNode[]>();
  for (const view of nodes) {
    if (!positions.has(view.id)) continue;
    const key = `${view.data.node.nodeType === 'group' ? 'group' : 'object'}:${Number(view.style?.opacity ?? 1)}`;
    const group = nodeGroups.get(key);
    if (group) group.push(view);
    else nodeGroups.set(key, [view]);
  }
  const matrix = new THREE.Matrix4();
  for (const [key, views] of nodeGroups) {
    const [shape, opacityText] = key.split(':');
    const opacity = Number(opacityText);
    const geometry =
      shape === 'group'
        ? new THREE.BoxGeometry(0.36 * scale, 0.3 * scale, 0.22 * scale)
        : new THREE.IcosahedronGeometry(0.17 * scale, 1);
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.52,
      transparent: opacity < 1,
      opacity,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, views.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.nodeIds = views.map((view) => view.id);
    views.forEach((view, index) => {
      const point = positions.get(view.id)!;
      const position = new THREE.Vector3(point.x, point.y, point.z);
      const color = batchColor(view.data.mindmap?.color || view.data.node.color, '#538971');
      mesh.setMatrixAt(index, matrix.makeTranslation(point.x, point.y, point.z));
      mesh.setColorAt(index, color);
      result.nodes.set(view.id, { mesh, index, position, color });
    });
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.2 * scale;
    result.group.add(mesh);
    result.pickable.push(mesh);
    const complete = views.filter((view) => isCompletedStatus(view.data.node.status));
    if (complete.length) {
      const rings = new THREE.InstancedMesh(
        new THREE.TorusGeometry(0.23 * scale, 0.035 * scale, 6, 12),
        new THREE.MeshBasicMaterial({ color: '#168251', transparent: opacity < 1, opacity }),
        complete.length,
      );
      rings.userData.nodeIds = complete.map((view) => view.id);
      complete.forEach((view, index) => {
        const point = positions.get(view.id)!;
        rings.setMatrixAt(index, matrix.makeTranslation(point.x, point.y, point.z));
      });
      rings.computeBoundingSphere();
      result.group.add(rings);
      result.pickable.push(rings);
    }
  }
  type LineData = {
    positions: number[];
    colors: number[];
    distances: number[];
    ids: string[];
    ranges: Array<{ edge: Edge; start: number; count: number; color: THREE.Color }>;
  };
  const lineGroups = new Map<string, LineData>();
  const arrowEntries: Array<{
    edgeId: string;
    point: THREE.Vector3;
    direction: THREE.Vector3;
    color: THREE.Color;
  }> = [];
  for (const edge of edges) {
    const source = positions.get(edge.source),
      target = positions.get(edge.target);
    if (!source || !target) continue;
    let points = spatialEdgePoints(source, target, edge.source === edge.target, scale);
    // Explicitly colocated objects still have a real, pickable relationship.
    if (points.length < 2) points = spatialEdgePoints(source, target, true, scale);
    result.edgePoints.set(edge.id, points);
    const style = edge.style?.strokeDasharray
      ? String(edge.style.strokeDasharray).startsWith('2')
        ? 'dotted'
        : 'dashed'
      : 'solid';
    let data = lineGroups.get(style);
    if (!data) {
      data = { positions: [], colors: [], distances: [], ids: [], ranges: [] };
      lineGroups.set(style, data);
    }
    const color = batchColor(edge.style?.stroke, '#879c92');
    const start = data.positions.length / 3;
    let distance = 0;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1],
        b = points[index];
      data.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      data.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      const nextDistance = distance + a.distanceTo(b);
      data.distances.push(distance, nextDistance);
      data.ids.push(edge.id);
      distance = nextDistance;
    }
    data.ranges.push({ edge, start, count: data.positions.length / 3 - start, color });
    const arrow = (atEnd: boolean) => {
      const at = atEnd ? points.length - 4 : 3;
      arrowEntries.push({
        edgeId: edge.id,
        point: points[at],
        direction: atEnd
          ? points[at + 1].clone().sub(points[at]).normalize()
          : points[at - 1].clone().sub(points[at]).normalize(),
        color,
      });
    };
    if (edge.markerEnd) arrow(true);
    if (edge.markerStart) arrow(false);
  }
  for (const [style, data] of lineGroups) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(data.colors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute(data.distances, 1));
    const material =
      style === 'solid'
        ? new THREE.LineBasicMaterial({ vertexColors: true })
        : new THREE.LineDashedMaterial({
            vertexColors: true,
            dashSize: (style === 'dotted' ? 0.035 : 0.15) * scale,
            gapSize: 0.09 * scale,
          });
    const line = new THREE.LineSegments(geometry, material);
    line.userData.segmentEdgeIds = data.ids;
    for (const range of data.ranges)
      result.edges.set(range.edge.id, {
        line,
        start: range.start,
        count: range.count,
        color: range.color,
      });
    result.group.add(line);
    result.pickable.push(line);
  }
  if (arrowEntries.length) {
    const mesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.075 * scale, 0.22 * scale, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      arrowEntries.length,
    );
    mesh.userData.edgeIds = arrowEntries.map((entry) => entry.edgeId);
    arrowEntries.forEach((entry, index) => {
      matrix.compose(
        entry.point,
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), entry.direction),
        new THREE.Vector3(1, 1, 1),
      );
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, entry.color);
      result.arrows.set(entry.edgeId, [
        ...(result.arrows.get(entry.edgeId) ?? []),
        { mesh, index, color: entry.color },
      ]);
    });
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
    result.group.add(mesh);
    result.pickable.push(mesh);
  }
  return result;
}

export function spatialIntersectionIdentity(hit: THREE.Intersection | undefined): {
  nodeId?: string;
  edgeId?: string;
} {
  if (!hit) return {};
  if (hit.instanceId !== undefined)
    return {
      nodeId: hit.object.userData.nodeIds?.[hit.instanceId],
      edgeId: hit.object.userData.edgeIds?.[hit.instanceId],
    };
  if (hit.index !== undefined && hit.object.userData.segmentEdgeIds)
    return { edgeId: hit.object.userData.segmentEdgeIds[Math.floor(hit.index / 2)] };
  return { nodeId: hit.object.userData.nodeId, edgeId: hit.object.userData.edgeId };
}

/** Update only the affected instances and buffer ranges, leaving geometry and textures intact. */
export function selectSpatialBatches(
  batches: SpatialBatches,
  selectedNodes: Set<string>,
  selectedEdges: Set<string>,
  previousNodes = new Set<string>(),
  previousEdges = new Set<string>(),
) {
  const matrix = new THREE.Matrix4(),
    color = new THREE.Color('#286cc6');
  for (const id of new Set([...previousNodes, ...selectedNodes])) {
    const entry = batches.nodes.get(id);
    if (!entry) continue;
    const scale = selectedNodes.has(id) ? 1.45 : 1;
    matrix.makeScale(scale, scale, scale).setPosition(entry.position);
    entry.mesh.setMatrixAt(entry.index, matrix);
    entry.mesh.setColorAt(entry.index, selectedNodes.has(id) ? color : entry.color);
    entry.mesh.instanceMatrix.addUpdateRange(entry.index * 16, 16);
    entry.mesh.instanceMatrix.needsUpdate = true;
    entry.mesh.instanceColor?.addUpdateRange(entry.index * 3, 3);
    if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
  }
  for (const id of new Set([...previousEdges, ...selectedEdges])) {
    const entry = batches.edges.get(id);
    if (!entry) continue;
    const chosen = selectedEdges.has(id) ? color : entry.color;
    const attribute = entry.line.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let index = entry.start; index < entry.start + entry.count; index++)
      attribute.setXYZ(index, chosen.r, chosen.g, chosen.b);
    attribute.addUpdateRange(entry.start * 3, entry.count * 3);
    attribute.needsUpdate = true;
    for (const arrow of batches.arrows.get(id) ?? []) {
      arrow.mesh.setColorAt(arrow.index, chosen);
      arrow.mesh.instanceColor?.addUpdateRange(arrow.index * 3, 3);
      if (arrow.mesh.instanceColor) arrow.mesh.instanceColor.needsUpdate = true;
    }
  }
}
