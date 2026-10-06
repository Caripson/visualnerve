import * as THREE from 'three';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from '../canvas/projection';
import type { SpatialPoint } from './types';
import { topicInk } from '../ui/colors';

export const SPATIAL_NODE_LIMIT = 8000;
export const SPATIAL_EDGE_LIMIT = 16000;
export const SPATIAL_LABEL_LIMIT = 120;

/** The same card footprint as the 2D diagram, with a shallow physical relief. */
export function spatialNodeDimensions(view: CanvasNode, scale = 1) {
  const dimension = (value: number | undefined, fallback: number) =>
    Math.max(0.01, (Number.isFinite(value) && value! > 0 ? value! : fallback) / 100);
  const width = dimension(view.width ?? view.data.node.width, 200);
  const height = dimension(view.height ?? view.data.node.height, 86);
  return {
    width: width * scale,
    height: height * scale,
    depth: 0.14 * scale,
  };
}

/** Match the inherited branch colors and foreground contrast of the 2D cards. */
export function spatialNodeAppearance(view: CanvasNode) {
  const accent = view.data.mindmap?.color || view.data.node.color || '#538971';
  const depth = view.data.mindmap?.depth;
  if (depth === 1) return { background: accent, color: topicInk(accent), accent };
  const background = new THREE.Color('#ffffff');
  if (depth !== undefined) background.lerp(new THREE.Color(accent), depth === 0 ? 0.07 : 0.14);
  return { background: `#${background.getHexString()}`, color: '#182c25', accent };
}

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

/** Canvas text is painted onto the physical card face; it never faces the camera. */
export function spatialTextPlane(
  text: string,
  options: {
    color?: string;
    background?: string;
    width?: number;
    height?: number;
    status?: string;
    kind?: string;
    fontSize?: number;
  } = {},
) {
  const width = options.width ?? 1.75;
  const height = options.height ?? (width * 112) / 512;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(96, Math.min(1024, Math.round((512 * height) / width)));
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = options.background ?? '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.color ?? '#182c25';
  const fontSize = options.fontSize ?? Math.min(44, Math.max(22, canvas.height * 0.18));
  const lineHeight = fontSize * 1.26;
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines: string[] = [];
  // Wrapping preserves useful titles on a card instead of placing a separate billboard above it.
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > 456) {
        lines.push(line);
        line = word;
      } else line = candidate;
      while (context.measureText(line).width > 456 && line.length > 1) {
        let length = line.length - 1;
        while (length > 1 && context.measureText(line.slice(0, length)).width > 456) length--;
        lines.push(line.slice(0, length));
        line = line.slice(length);
      }
    }
    lines.push(line);
  }
  const statusSpace = options.status ? Math.min(38, canvas.height * 0.17) : 0;
  const maxLines = Math.max(1, Math.floor((canvas.height - 28 - statusSpace) / lineHeight));
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = visible.at(-1)!;
    while (last.length > 1 && context.measureText(`${last}…`).width > 456) last = last.slice(0, -1);
    visible[visible.length - 1] = `${last}…`;
  }
  const titleCenter = (canvas.height - statusSpace) / 2;
  visible.forEach((line, index) =>
    context.fillText(line, 256, titleCenter + (index - (visible.length - 1) / 2) * lineHeight),
  );
  if (options.status) {
    context.font = `600 ${Math.min(24, fontSize * 0.65)}px system-ui, sans-serif`;
    const label = `${isCompletedStatus(options.status) ? '✓ ' : ''}${options.status}`;
    context.fillText(label, 256, canvas.height - statusSpace / 2 - 5, 456);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide }),
  );
  face.userData.faceWidth = width;
  face.userData.faceHeight = height;
  return face;
}

/** Native front textures contain translucent fills and antialiased edges. */
export function setSpatialFaceOpacity(
  face: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  opacity: number,
) {
  const transparent = face.userData.faceSource === '2d-node' || opacity < 1;
  if (face.material.transparent !== transparent) {
    face.material.transparent = transparent;
    face.material.needsUpdate = true;
  }
  face.material.opacity = opacity;
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
  dimensions: THREE.Vector3;
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
export interface SpatialFrameInstance extends SpatialArrowInstance {
  matrix: THREE.Matrix4;
  completed: boolean;
  captured?: boolean;
}
export interface SpatialBatches {
  group: THREE.Group;
  pickable: THREE.Object3D[];
  nodes: Map<string, SpatialNodeInstance>;
  edges: Map<string, SpatialEdgeBatchRange>;
  arrows: Map<string, SpatialArrowInstance[]>;
  frames: Map<string, SpatialFrameInstance[]>;
  edgePoints: Map<string, THREE.Vector3[]>;
}
const batchColor = (value: unknown, fallback: string) =>
  new THREE.Color(typeof value === 'string' && !value.includes('var(') ? value : fallback);

interface ReliefProfile {
  opacity: number;
  radiusX: number;
  radiusY: number;
  skew: number;
  inset: number;
}

function reliefProfile(view: CanvasNode): ReliefProfile {
  const kind = view.data.node.nodeType;
  const topicDepth = view.data.mindmap?.depth;
  const radius =
    topicDepth !== undefined
      ? topicDepth === 0
        ? 24
        : topicDepth === 1
          ? 14
          : 12
      : kind === 'start' || kind === 'end'
        ? 44
        : kind === 'decision' || kind === 'document'
          ? 14
          : kind === 'note'
            ? 13
            : kind === 'input' || kind === 'output'
              ? 2
              : kind === 'group'
                ? 7
                : kind === 'database'
                  ? 20
                  : 6;
  const dimensions = spatialNodeDimensions(view);
  // Quantize outwards so the relief cannot fill a transparent rounded face corner.
  const quantize = (value: number) => Math.min(0.5, Math.ceil(value * 512) / 512);
  return {
    opacity: Number(view.style?.opacity ?? 1) * (kind === 'group' ? 0.03 : 1),
    radiusX: quantize(radius / (dimensions.width * 100)),
    radiusY: quantize((kind === 'database' ? 8 : radius) / (dimensions.height * 100)),
    // CSS skew(-4deg) uses downward Y; world Y points up. Normalize the
    // shear for the card aspect ratio before instance dimensions are applied.
    skew:
      topicDepth === undefined && (kind === 'input' || kind === 'output')
        ? Math.tan((4 * Math.PI) / 180) * (dimensions.height / dimensions.width)
        : 0,
    inset: 1,
  };
}

function clipReliefContour(points: THREE.Vector2[], boundary: number, keepLeft: boolean) {
  const result: THREE.Vector2[] = [];
  const inside = (point: THREE.Vector2) => (keepLeft ? point.x <= boundary : point.x >= boundary);
  let previous = points.at(-1)!;
  for (const point of points) {
    if (inside(previous) !== inside(point)) {
      const amount = (boundary - previous.x) / (point.x - previous.x);
      result.push(new THREE.Vector2(boundary, previous.y + (point.y - previous.y) * amount));
    }
    if (inside(point)) result.push(point);
    previous = point;
  }
  return result;
}

function reliefGeometry(profile: ReliefProfile) {
  const { radiusX: x, radiusY: y } = profile;
  const shape = new THREE.Shape();
  shape.moveTo(-0.5 + x, -0.5);
  shape.lineTo(0.5 - x, -0.5);
  shape.absellipse(0.5 - x, -0.5 + y, x, y, -Math.PI / 2, 0, false);
  shape.lineTo(0.5, 0.5 - y);
  shape.absellipse(0.5 - x, 0.5 - y, x, y, 0, Math.PI / 2, false);
  shape.lineTo(-0.5 + x, 0.5);
  shape.absellipse(-0.5 + x, 0.5 - y, x, y, Math.PI / 2, Math.PI, false);
  shape.lineTo(-0.5, -0.5 + y);
  shape.absellipse(-0.5 + x, -0.5 + y, x, y, Math.PI, (Math.PI * 3) / 2, false);
  shape.closePath();
  let contour = shape
    .getPoints(4)
    .map(
      (point) =>
        new THREE.Vector2(
          (point.x + profile.skew * point.y) * profile.inset,
          point.y * profile.inset,
        ),
    );
  if (profile.skew) {
    // Native face capture has the original SVG width, clipping CSS overflow.
    contour = clipReliefContour(clipReliefContour(contour, 0.5, true), -0.5, false);
  }
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(contour), {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -0.5);
  return geometry;
}

function cardConnectionPoint(
  point: SpatialPoint,
  destination: SpatialPoint,
  dimensions: THREE.Vector3,
  scale: number,
) {
  const direction = new THREE.Vector2(destination.x - point.x, destination.y - point.y);
  const distance = Math.min(
    direction.x ? dimensions.x / (2 * Math.abs(direction.x)) : Infinity,
    direction.y ? dimensions.y / (2 * Math.abs(direction.y)) : Infinity,
    0.48,
  );
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
    z: point.z + dimensions.z / 2 + 0.004 * scale,
  };
}

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
    frames: new Map(),
    edgePoints: new Map(),
  };
  const nodeGroups = new Map<string, CanvasNode[]>();
  const profiles = new Map<string, ReliefProfile>();
  const profileKey = (profile: ReliefProfile) =>
    `${profile.opacity}:${profile.radiusX}:${profile.radiusY}:${profile.skew}:${profile.inset}`;
  const fallbacks = new Map<number, string>();
  // Reserve a conservative fallback for each projection opacity (normally 1 and 0.2).
  const requestedProfiles = new Map(nodes.map((view) => [view.id, reliefProfile(view)]));
  for (const opacity of new Set(
    [...requestedProfiles.values()].map((profile) => profile.opacity),
  )) {
    const largestSkew = Math.max(
      0,
      ...[...requestedProfiles.values()]
        .filter((profile) => profile.opacity === opacity)
        .map((profile) => Math.abs(profile.skew)),
    );
    // An inset ellipse fits even the most skewed face if the profile budget is full.
    const fallback = {
      opacity,
      radiusX: 0.5,
      radiusY: 0.5,
      skew: 0,
      inset: 1 / (1 + largestSkew),
    };
    const key = profileKey(fallback);
    profiles.set(key, fallback);
    fallbacks.set(opacity, key);
  }
  for (const view of nodes) {
    if (!positions.has(view.id)) continue;
    const requested = requestedProfiles.get(view.id)!;
    let key = profileKey(requested);
    if (!profiles.has(key)) {
      if (profiles.size < 32) profiles.set(key, requested);
      else {
        const suitable = [...profiles].filter(
          ([, profile]) =>
            profile.opacity === requested.opacity &&
            profile.skew === requested.skew &&
            profile.radiusX >= requested.radiusX &&
            profile.radiusY >= requested.radiusY,
        );
        suitable.sort(([, a], [, b]) => a.radiusX + a.radiusY - (b.radiusX + b.radiusY));
        key = suitable[0]?.[0] ?? fallbacks.get(requested.opacity)!;
      }
    }
    const group = nodeGroups.get(key);
    if (group) group.push(view);
    else nodeGroups.set(key, [view]);
  }
  const matrix = new THREE.Matrix4();
  for (const [key, views] of nodeGroups) {
    const profile = profiles.get(key)!;
    const opacity = profile.opacity;
    const geometry = reliefGeometry(profile);
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.52,
      transparent: opacity < 1,
      depthWrite: opacity === 1,
      opacity,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, views.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.nodeIds = views.map((view) => view.id);
    views.forEach((view, index) => {
      const point = positions.get(view.id)!;
      const position = new THREE.Vector3(
        point.x,
        point.y,
        point.z - (view.data.node.nodeType === 'group' ? 0.16 * scale : 0),
      );
      const appearance = spatialNodeAppearance(view);
      const color = batchColor(appearance.background, '#ffffff');
      const { width, height, depth } = spatialNodeDimensions(view, scale);
      const dimensions = new THREE.Vector3(width, height, depth);
      matrix.makeScale(width, height, depth).setPosition(position);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color);
      result.nodes.set(view.id, { mesh, index, position, color, dimensions });
    });
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
    result.group.add(mesh);
    result.pickable.push(mesh);
    // Original borders are part of the captured 2D face. Separate strips only
    // indicate completion or selection; they do not restyle an ordinary card.
    const frames = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: opacity < 1, opacity }),
      views.length * 4,
    );
    frames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    frames.userData.nodeIds = views.flatMap((view) => Array(4).fill(view.id));
    views.forEach((view, viewIndex) => {
      const point = result.nodes.get(view.id)!.position;
      const { width, height, depth } = spatialNodeDimensions(view, scale);
      const completed = isCompletedStatus(view.data.node.status);
      const thickness = Math.min(width / 8, height / 8, (completed ? 0.025 : 0.012) * scale);
      const color = batchColor(
        completed ? '#168251' : spatialNodeAppearance(view).accent,
        '#538971',
      );
      const strips = [
        [width, thickness, 0, (height - thickness) / 2],
        [width, thickness, 0, -(height - thickness) / 2],
        [thickness, height, (width - thickness) / 2, 0],
        [thickness, height, -(width - thickness) / 2, 0],
      ];
      const entries: SpatialFrameInstance[] = [];
      strips.forEach(([stripWidth, stripHeight, x, y], stripIndex) => {
        const index = viewIndex * 4 + stripIndex;
        matrix.makeScale(stripWidth, stripHeight, Math.min(depth / 8, 0.012 * scale));
        matrix.setPosition(point.x + x, point.y + y, point.z + depth / 2 + 0.006 * scale);
        const visibleMatrix = matrix.clone();
        frames.setMatrixAt(
          index,
          completed
            ? matrix
            : new THREE.Matrix4()
                .makeScale(0, 0, 0)
                .setPosition(point.x + x, point.y + y, point.z + depth / 2),
        );
        frames.setColorAt(index, color);
        entries.push({ mesh: frames, index, color, matrix: visibleMatrix, completed });
      });
      result.frames.set(view.id, entries);
    });
    frames.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    frames.computeBoundingSphere();
    if (frames.boundingSphere)
      frames.boundingSphere.radius += Math.max(
        ...views.map((view) => {
          const dimensions = spatialNodeDimensions(view, scale);
          return Math.hypot(dimensions.width, dimensions.height);
        }),
      );
    result.group.add(frames);
    result.pickable.push(frames);
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
    const source = result.nodes.get(edge.source)?.position,
      target = result.nodes.get(edge.target)?.position;
    if (!source || !target) continue;
    const sourceDimensions = result.nodes.get(edge.source)?.dimensions;
    const targetDimensions = result.nodes.get(edge.target)?.dimensions;
    const selfLoop = edge.source === edge.target;
    let points =
      !selfLoop && sourceDimensions && targetDimensions
        ? spatialEdgePoints(
            cardConnectionPoint(source, target, sourceDimensions, scale),
            cardConnectionPoint(target, source, targetDimensions, scale),
            false,
            scale,
          )
        : spatialEdgePoints(source, target, selfLoop, scale);
    if (selfLoop && sourceDimensions) {
      const loopScale = Math.max(sourceDimensions.x, sourceDimensions.y) * 0.8;
      points = spatialEdgePoints(
        { x: source.x, y: source.y + sourceDimensions.y / 2, z: source.z + sourceDimensions.z / 2 },
        target,
        true,
        loopScale,
      );
    }
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

function updateSpatialFrameVisibility(
  frames: SpatialFrameInstance[],
  position: THREE.Vector3,
  selected: boolean,
) {
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(position);
  for (const frame of frames) {
    frame.mesh.setMatrixAt(
      frame.index,
      (frame.completed && !frame.captured) || selected ? frame.matrix : hidden,
    );
    frame.mesh.instanceMatrix.addUpdateRange(frame.index * 16, 16);
    frame.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** The native Done border replaces its fallback only while its texture is resident. */
export function setSpatialNodeFaceCaptured(
  batches: SpatialBatches,
  id: string,
  captured: boolean,
  selected: boolean,
) {
  const entry = batches.nodes.get(id);
  if (!entry) return;
  const frames = batches.frames.get(id) ?? [];
  for (const frame of frames) frame.captured = captured;
  updateSpatialFrameVisibility(frames, entry.position, selected);
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
    matrix
      .makeScale(entry.dimensions.x, entry.dimensions.y, entry.dimensions.z)
      .setPosition(entry.position);
    entry.mesh.setMatrixAt(entry.index, matrix);
    entry.mesh.setColorAt(entry.index, selectedNodes.has(id) ? color : entry.color);
    entry.mesh.instanceMatrix.addUpdateRange(entry.index * 16, 16);
    entry.mesh.instanceMatrix.needsUpdate = true;
    entry.mesh.instanceColor?.addUpdateRange(entry.index * 3, 3);
    if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    const frames = batches.frames.get(id) ?? [];
    updateSpatialFrameVisibility(frames, entry.position, selectedNodes.has(id));
    for (const frame of frames) {
      frame.mesh.setColorAt(frame.index, selectedNodes.has(id) ? color : frame.color);
      frame.mesh.instanceColor?.addUpdateRange(frame.index * 3, 3);
      if (frame.mesh.instanceColor) frame.mesh.instanceColor.needsUpdate = true;
    }
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
