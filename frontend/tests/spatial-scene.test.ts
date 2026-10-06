import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import {
  boundedSpatialProjection,
  createSpatialBatches,
  selectSpatialBatches,
  spatialIntersectionIdentity,
  disposeSpatialScene,
  SPATIAL_EDGE_LIMIT,
  SPATIAL_NODE_LIMIT,
  spatialEdgePoints,
  spatialNodeDimensions,
  spatialNodeAppearance,
  spatialTextPlane,
  spatialFaceSurfaces,
  setSpatialFaceIdentity,
  setSpatialFaceOpacity,
  setSpatialNodeFaceCaptured,
} from '../src/spatial/scene';

it('bounds a large scene while retaining selected objects and relationship endpoints', () => {
  const graph = blankGraph('Large scene');
  const nodeCount = SPATIAL_NODE_LIMIT + 100,
    edgeCount = SPATIAL_EDGE_LIMIT + 100;
  const chosen = `n${nodeCount - 3}`,
    source = `n${nodeCount - 2}`,
    target = `n${nodeCount - 1}`;
  graph.nodes = Array.from({ length: nodeCount }, (_, index) =>
    newNode(graph.diagram.id, { id: `n${index}`, title: `Object ${index}` }),
  );
  graph.edges = Array.from({ length: edgeCount }, (_, index) =>
    newEdge(graph.diagram.id, source, target, { id: `e${index}` }),
  );
  const projection = projectGraph(graph, []);
  const result = boundedSpatialProjection(
    projection.nodes,
    projection.edges,
    [chosen],
    [`e${edgeCount - 1}`],
  );
  expect(result.nodes).toHaveLength(SPATIAL_NODE_LIMIT);
  expect(result.nodes.slice(0, 3).map((node) => node.id)).toEqual([chosen, source, target]);
  expect(result.edges).toHaveLength(SPATIAL_EDGE_LIMIT);
  expect(result.edges[0].id).toBe(`e${edgeCount - 1}`);
  expect(result).toMatchObject({ totalNodes: nodeCount, totalEdges: edgeCount, truncated: true });
  const ids = new Set(result.nodes.map((node) => node.id));
  expect(result.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
});

it('uses the existing 2D projection visibility for collapsed groups and hidden filters', () => {
  const graph = blankGraph('Visibility');
  const parent = newNode(graph.diagram.id, { title: 'Group', nodeType: 'group', collapsed: true });
  const child = newNode(graph.diagram.id, { title: 'Hidden child', parentId: parent.id });
  const visible = newNode(graph.diagram.id, { title: 'Visible' });
  graph.nodes = [parent, child, visible];
  graph.edges = [
    newEdge(graph.diagram.id, child.id, visible.id),
    newEdge(graph.diagram.id, parent.id, visible.id),
  ];
  const projection = projectGraph(graph, []);
  const result = boundedSpatialProjection(projection.nodes, projection.edges, [child.id], []);
  expect(result.nodes.map((node) => node.id)).toEqual([parent.id, visible.id]);
  expect(result.edges.map((edge) => edge.id)).toEqual([graph.edges[1].id]);
  expect(result.truncated).toBe(false);
});

it('routes self loops visibly and produces finite directional link points', () => {
  const position = { x: -2, y: 1, z: 3 };
  const loop = spatialEdgePoints(position, position, true);
  expect(loop).toHaveLength(49);
  expect(loop[0].distanceTo(loop.at(-1)!)).toBeLessThan(0.000001);
  expect(loop.some((point) => point.distanceTo(new THREE.Vector3(-2, 1, 3)) > 0.7)).toBe(true);
  const link = spatialEdgePoints(position, { x: 4, y: -1, z: 3 }, false);
  expect(link[0].toArray()).toEqual([-2, 1, 3]);
  expect(link.at(-1)!.toArray()).toEqual([4, -1, 3]);
  expect(link[12].z).toBeGreaterThan(3);
  expect(link.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
  expect(spatialEdgePoints(position, position, false)).toEqual([]);
});

it('disposes shared geometries, materials and textures exactly once', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const geometryDisposal = vi.spyOn(geometry, 'dispose');
  const materialDisposal = vi.spyOn(material, 'dispose');
  const textureDisposal = vi.spyOn(texture, 'dispose');
  disposeSpatialScene(root);
  expect(geometryDisposal).toHaveBeenCalledOnce();
  expect(materialDisposal).toHaveBeenCalledOnce();
  expect(textureDisposal).toHaveBeenCalledOnce();
  expect(root.children).toEqual([]);
});

it('releases a removed text label without disposing Three.js shared sprite geometry', () => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.Texture() }));
  const geometry = vi.spyOn(sprite.geometry, 'dispose');
  const material = vi.spyOn(sprite.material, 'dispose');
  const texture = vi.spyOn(sprite.material.map!, 'dispose');
  disposeSpatialScene(sprite);
  expect(geometry).not.toHaveBeenCalled();
  expect(material).toHaveBeenCalledOnce();
  expect(texture).toHaveBeenCalledOnce();
  geometry.mockRestore();
});

it('keeps a mind map hierarchy as diagram links without changing the canonical 2D layout', () => {
  const graph = blankGraph('Release mind map', 'mindmap');
  const parent = newNode(graph.diagram.id, { title: 'Release', x: 100, y: 200 });
  const child = newNode(graph.diagram.id, { title: 'Plan', parentId: parent.id, x: 400, y: 250 });
  graph.nodes = [parent, child];
  const projection = projectGraph(graph, []);
  const scene = boundedSpatialProjection(projection.nodes, projection.edges, [], []);
  expect(scene.edges).toHaveLength(1);
  expect(scene.edges[0]).toMatchObject({
    id: `hierarchy:${child.id}`,
    source: parent.id,
    target: child.id,
  });
  expect(graph.nodes[0]).toMatchObject({ x: 100, y: 200 });
  expect(graph.nodes[1]).toMatchObject({ x: 400, y: 250, parentId: parent.id });
  expect(graph.edges).toEqual([]);
});

it('extrudes the actual 2D card dimensions and retains its footprint when selected', () => {
  const graph = blankGraph('Relief');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'card', width: 320, height: 120, status: 'done' }),
  ];
  const projection = projectGraph(graph, []);
  const dimensions = spatialNodeDimensions(projection.nodes[0]);
  expect(dimensions).toMatchObject({ width: 3.2, height: 1.2, depth: 0.14 });
  expect(spatialNodeDimensions(projection.nodes[0], 0.25)).toEqual({
    width: 0.8,
    height: 0.3,
    depth: 0.035,
  });
  const batches = createSpatialBatches(
    projection.nodes,
    [],
    new Map([['card', { x: 4, y: -2, z: 1 }]]),
  );
  const card = batches.nodes.get('card')!;
  expect(card.mesh.geometry).toBeInstanceOf(THREE.ExtrudeGeometry);
  card.mesh.geometry.computeBoundingBox();
  expect(card.mesh.geometry.boundingBox!.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
  expect(card.mesh.geometry.boundingBox!.max.toArray()).toEqual([0.5, 0.5, 0.5]);
  const vertices = card.mesh.geometry.getAttribute('position');
  expect(
    Array.from(
      { length: vertices.count },
      (_, index) =>
        Math.abs(vertices.getX(index)) > 0.49999 && Math.abs(vertices.getY(index)) > 0.49999,
    ).some(Boolean),
  ).toBe(false);
  const before = new THREE.Matrix4();
  card.mesh.getMatrixAt(card.index, before);
  expect(new THREE.Vector3().setFromMatrixScale(before).toArray()).toEqual(
    expect.arrayContaining([
      expect.closeTo(3.2, 5),
      expect.closeTo(1.2, 5),
      expect.closeTo(0.14, 5),
    ]),
  );
  selectSpatialBatches(batches, new Set(['card']), new Set());
  const after = new THREE.Matrix4();
  card.mesh.getMatrixAt(card.index, after);
  expect(after.elements).toEqual(before.elements);
  selectSpatialBatches(batches, new Set(), new Set(), new Set(['card']));
  const frame = batches.frames.get('card')!;
  expect(frame).toHaveLength(4);
  const completed = new THREE.Color();
  frame[0].mesh.getColorAt(frame[0].index, completed);
  expect(completed.getHexString()).toBe('168251');
  expect(
    batches.group.children.some(
      (object) => (object as THREE.Mesh).geometry instanceof THREE.TorusGeometry,
    ),
  ).toBe(false);
  disposeSpatialScene(batches.group);
});

it('places group relief behind its children while retaining their 2D centers', () => {
  const graph = blankGraph('Grouped relief');
  const group = newNode(graph.diagram.id, {
    id: 'group',
    nodeType: 'group',
    width: 600,
    height: 400,
  });
  const child = newNode(graph.diagram.id, {
    id: 'child',
    parentId: group.id,
    width: 200,
    height: 86,
  });
  graph.nodes = [group, child];
  const positions = new Map(graph.nodes.map((node) => [node.id, { x: 2, y: 3, z: 0 }]));
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(projection.nodes, [], positions);
  expect(batches.nodes.get('group')!.position.toArray()).toEqual([2, 3, -0.16]);
  expect(batches.nodes.get('child')!.position.toArray()).toEqual([2, 3, 0]);
  expect(positions.get(group.id)).toEqual({ x: 2, y: 3, z: 0 });
  batches.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(2, 3, 4), new THREE.Vector3(0, 0, -1));
  expect(
    spatialIntersectionIdentity(ray.intersectObjects(batches.pickable, false)[0]),
  ).toMatchObject({ nodeId: child.id });
  disposeSpatialScene(batches.group);
});

it('keeps native translucent front textures blended through camera and selection refreshes', () => {
  const texture = new THREE.DataTexture(new Uint8Array([30, 80, 50, 8]), 1, 1);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 4),
    new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.01 }),
  );
  face.userData.faceSource = '2d-node';
  setSpatialFaceOpacity(face, 1);
  expect(face.material.transparent).toBe(true);
  const nativeVersion = face.material.version;
  setSpatialFaceOpacity(face, 0.2);
  setSpatialFaceOpacity(face, 1);
  expect(face.material.transparent).toBe(true);
  expect(face.material.opacity).toBe(1);
  expect(face.material.map).toBe(texture);
  expect(face.material.alphaTest).toBe(0.01);
  expect(face.material.version).toBe(nativeVersion);
  disposeSpatialScene(face);
});

it('restores the visible Done border when a native face leaves the bounded resident set', () => {
  const graph = blankGraph('Resident completion');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'done', status: 'done' }),
    newNode(graph.diagram.id, { id: 'ordinary' }),
  ];
  const projection = projectGraph(graph, []);
  const positions = new Map([
    ['done', { x: 0, y: 0, z: 0 }],
    ['ordinary', { x: 3, y: 0, z: 0 }],
  ]);
  const batches = createSpatialBatches(projection.nodes, [], positions);
  const visibleFrameCount = (id: string) =>
    batches.frames.get(id)!.filter((frame) => {
      const matrix = new THREE.Matrix4();
      frame.mesh.getMatrixAt(frame.index, matrix);
      return new THREE.Vector3().setFromMatrixScale(matrix).lengthSq() > 0;
    }).length;
  expect(visibleFrameCount('done')).toBe(4);
  setSpatialNodeFaceCaptured(batches, 'done', true, false);
  expect(visibleFrameCount('done')).toBe(0);
  setSpatialNodeFaceCaptured(batches, 'done', false, false);
  expect(visibleFrameCount('done')).toBe(4);
  const borderColor = new THREE.Color();
  const first = batches.frames.get('done')![0];
  first.mesh.getColorAt(first.index, borderColor);
  expect(borderColor.getHexString()).toBe('168251');
  setSpatialNodeFaceCaptured(batches, 'ordinary', true, false);
  setSpatialNodeFaceCaptured(batches, 'ordinary', false, false);
  expect(visibleFrameCount('ordinary')).toBe(0);
  selectSpatialBatches(batches, new Set(['done']), new Set());
  setSpatialNodeFaceCaptured(batches, 'done', true, true);
  expect(visibleFrameCount('done')).toBe(4);
  first.mesh.getColorAt(first.index, borderColor);
  expect(borderColor.getHexString()).toBe('286cc6');
  selectSpatialBatches(batches, new Set(), new Set(), new Set(['done']));
  expect(visibleFrameCount('done')).toBe(0);
  setSpatialNodeFaceCaptured(batches, 'done', false, false);
  expect(visibleFrameCount('done')).toBe(4);
  disposeSpatialScene(batches.group);
});

it('matches native input/output skew silhouettes without filling their transparent corners', () => {
  const graph = blankGraph('Native I/O silhouettes');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'input', nodeType: 'input', width: 200, height: 100 }),
    newNode(graph.diagram.id, { id: 'output', nodeType: 'output', width: 400, height: 100 }),
  ];
  const projection = projectGraph(graph, []);
  const positions = new Map([
    ['input', { x: 0, y: 0, z: 0 }],
    ['output', { x: 6, y: 0, z: 0 }],
  ]);
  const batches = createSpatialBatches(projection.nodes, [], positions);
  batches.group.updateMatrixWorld(true);
  for (const [id, entry] of batches.nodes) {
    const { position, dimensions } = entry;
    const hitAt = (x: number, y: number) => {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(position.x + x, position.y + y, 1),
        new THREE.Vector3(0, 0, -1),
      );
      return spatialIntersectionIdentity(ray.intersectObject(entry.mesh, false)[0]).nodeId;
    };
    // At 35 px above/below the center, CSS skew(-4deg) cuts away 2.45 px
    // from opposite sides, independently of the original card width.
    expect(hitAt(-dimensions.x / 2 + 0.01, 0.35)).toBeUndefined();
    expect(hitAt(dimensions.x / 2 - 0.01, -0.35)).toBeUndefined();
    expect(hitAt(dimensions.x / 2 - 0.01, 0.35)).toBe(id);
    expect(hitAt(-dimensions.x / 2 + 0.01, -0.35)).toBe(id);
    entry.mesh.geometry.computeBoundingBox();
    expect(entry.mesh.geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-0.5);
    expect(entry.mesh.geometry.boundingBox!.max.x).toBeLessThanOrEqual(0.5);
    expect(entry.dimensions.toArray()).toEqual([id === 'input' ? 2 : 4, 1, 0.14]);
  }
  disposeSpatialScene(batches.group);
});

it('bounds rounded relief profiles when hundreds of cards have different sizes', () => {
  const graph = blankGraph('Many card footprints');
  graph.nodes = Array.from({ length: 800 }, (_, index) =>
    newNode(graph.diagram.id, {
      id: `card-${index}`,
      width: 80 + index,
      height: 40 + ((index * 7) % 200),
      nodeType: index % 7 === 0 ? 'input' : index % 5 === 0 ? 'start' : 'generic',
    }),
  );
  const projection = projectGraph(graph, []);
  const positions = new Map(graph.nodes.map((node, index) => [node.id, { x: index, y: 0, z: 0 }]));
  const batches = createSpatialBatches(projection.nodes, [], positions);
  const bodies = batches.group.children.filter(
    (object) => (object as THREE.Mesh).material instanceof THREE.MeshStandardMaterial,
  );
  expect(bodies.length).toBeLessThanOrEqual(32);
  expect(batches.nodes.size).toBe(800);
  expect(
    bodies.every((body) => (body as THREE.Mesh).geometry instanceof THREE.ExtrudeGeometry),
  ).toBe(true);
  disposeSpatialScene(batches.group);
});

it('paints wrapped title and status on a planar face that turns with the diagram', () => {
  const fillText = vi.fn();
  const context = {
    fillRect: vi.fn(),
    fillText,
    measureText: (text: string) => ({ width: text.length * 24 }),
  } as unknown as CanvasRenderingContext2D;
  const canvasContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context);
  try {
    const face = spatialTextPlane('Truck maintenance and lifecycle inspection', {
      width: 3,
      height: 1.2,
      status: 'done',
    })!;
    expect(face).toBeInstanceOf(THREE.Mesh);
    expect(face).not.toBeInstanceOf(THREE.Sprite);
    expect(face.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(face.geometry.parameters).toMatchObject({ width: 3, height: 1.2 });
    expect(face.material.depthTest).toBe(true);
    expect(face.material.side).toBe(THREE.FrontSide);
    expect(face.scale.toArray()).toEqual([1, 1, 1]);
    expect(fillText.mock.calls.some(([text]) => text === '✓ done')).toBe(true);
    expect(fillText.mock.calls.filter(([text]) => text !== '✓ done').length).toBeGreaterThan(1);
    const surface = new THREE.Group();
    surface.add(face);
    const normal = () => new THREE.Vector3(0, 0, 1).transformDirection(face.matrixWorld);
    surface.updateMatrixWorld(true);
    expect(normal().toArray()).toEqual([0, 0, 1]);
    surface.rotation.y = THREE.MathUtils.degToRad(10);
    surface.updateMatrixWorld(true);
    expect(normal().x).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(10)), 7);
    expect(normal().z).toBeCloseTo(Math.cos(THREE.MathUtils.degToRad(10)), 7);
    expect(face.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    disposeSpatialScene(surface);
  } finally {
    canvasContext.mockRestore();
  }
});

it('reads the same left-to-right texture UVs and canonical ID from both physical card sides', () => {
  const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 20 }),
  } as unknown as CanvasRenderingContext2D);
  try {
    const face = spatialTextPlane('Readable card', { width: 3, height: 1.2, depth: 0.14 })!;
    setSpatialFaceIdentity(face, { nodeId: 'card' });
    face.position.z = 0.14 / 2 + 0.002;
    const surfaces = spatialFaceSurfaces(face);
    expect(surfaces).toHaveLength(2);
    const [front, back] = surfaces;
    const card = new THREE.Group();
    card.add(face);
    // The card keeps its physical orientation while both viewing directions read it.
    card.rotation.y = Math.PI / 5;
    card.updateMatrixWorld(true);
    const frontNormal = new THREE.Vector3(0, 0, 1).transformDirection(front.matrixWorld);
    const backNormal = new THREE.Vector3(0, 0, 1).transformDirection(back.matrixWorld);
    expect(frontNormal.x).toBeCloseTo(Math.sin(Math.PI / 5), 8);
    expect(frontNormal.z).toBeCloseTo(Math.cos(Math.PI / 5), 8);
    expect(frontNormal.dot(backNormal)).toBeCloseTo(-1, 8);
    const frontCenter = new THREE.Vector3().setFromMatrixPosition(front.matrixWorld);
    const backCenter = new THREE.Vector3().setFromMatrixPosition(back.matrixWorld);
    expect(frontCenter.clone().sub(backCenter).dot(frontNormal)).toBeCloseTo(0.144, 8);
    for (const side of [1, -1]) {
      const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 20);
      camera.position.copy(frontNormal).multiplyScalar(side * 5);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const sample = (x: number) => {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, 0.15), camera);
        const intersections = raycaster.intersectObjects(surfaces, false);
        expect(intersections).toHaveLength(1);
        const hit = intersections[0];
        expect(hit.object).toBe(side === 1 ? front : back);
        expect(spatialIntersectionIdentity(hit)).toEqual({ nodeId: 'card', edgeId: undefined });
        return hit.uv!;
      };
      const left = sample(-0.25);
      const right = sample(0.25);
      // Texture coordinates increase from the viewer's left to right on BOTH faces.
      // A DoubleSide plane alone would reverse these samples on the back.
      expect(left.x).toBeCloseTo(1 / 3, 7);
      expect(right.x).toBeCloseTo(2 / 3, 7);
      expect(left.y).toBeCloseTo(0.625, 7);
      expect(right.y).toBeCloseTo(0.625, 7);
    }
    expect(front.material.side).toBe(THREE.FrontSide);
    expect(back.material.side).toBe(THREE.FrontSide);
    disposeSpatialScene(card);
  } finally {
    canvasContext.mockRestore();
  }
});

it('shares native capture replacement, opacity, status and GPU ownership across both card sides', () => {
  const fillText = vi.fn();
  const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    fillText,
    measureText: (text: string) => ({ width: text.length * 20 }),
  } as unknown as CanvasRenderingContext2D);
  try {
    const face = spatialTextPlane('Completed card', {
      width: 3,
      height: 1.2,
      depth: 0.14,
      status: 'done',
    })!;
    const [front, back] = spatialFaceSurfaces(face);
    expect(fillText.mock.calls.some(([text]) => text === '✓ done')).toBe(true);
    expect(back.geometry).toBe(front.geometry);
    expect(back.material).toBe(front.material);
    expect(back.material.map).toBe(front.material.map);
    const fallbackTexture = front.material.map!;
    const fallbackDisposal = vi.spyOn(fallbackTexture, 'dispose');
    const nativeCanvas = document.createElement('canvas');
    const nativeTexture = new THREE.CanvasTexture(nativeCanvas);
    // The native capture path replaces one shared map; both sides update together.
    front.material.map!.dispose();
    front.material.map = nativeTexture;
    front.material.alphaTest = 0.01;
    front.userData.faceSource = '2d-node';
    setSpatialFaceOpacity(front, 0.2);
    expect(back.material.map!.image).toBe(nativeCanvas);
    expect(back.userData.faceSource).toBe('2d-node');
    expect(back.material.opacity).toBe(0.2);
    setSpatialFaceOpacity(front, 1);
    expect(back.material.transparent).toBe(true);
    expect(back.material.alphaTest).toBe(0.01);
    const textureDisposal = vi.spyOn(nativeTexture, 'dispose');
    const materialDisposal = vi.spyOn(front.material, 'dispose');
    const geometryDisposal = vi.spyOn(front.geometry, 'dispose');
    disposeSpatialScene(face);
    expect(fallbackDisposal).toHaveBeenCalledOnce();
    expect(textureDisposal).toHaveBeenCalledOnce();
    expect(materialDisposal).toHaveBeenCalledOnce();
    expect(geometryDisposal).toHaveBeenCalledOnce();
    expect(face.children).toEqual([]);
  } finally {
    canvasContext.mockRestore();
  }
});

it('connects relief cards at their boundaries rather than through the title faces', () => {
  const graph = blankGraph('Card boundaries');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'source', width: 300, height: 100 }),
    newNode(graph.diagram.id, { id: 'target', width: 200, height: 100 }),
  ];
  graph.edges = [newEdge(graph.diagram.id, 'source', 'target', { id: 'connection' })];
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(
    projection.nodes,
    projection.edges,
    new Map([
      ['source', { x: 0, y: 0, z: 0 }],
      ['target', { x: 6, y: 0, z: 0 }],
    ]),
  );
  const points = batches.edgePoints.get('connection')!;
  expect(points[0].x).toBeCloseTo(1.5);
  expect(points.at(-1)!.x).toBeCloseTo(5);
  expect(points[0].y).toBe(0);
  expect(points[0].z).toBeGreaterThan(0);
  disposeSpatialScene(batches.group);
});

it('keeps the same 2D face colors and inherited branch borders in relief batches', () => {
  const graph = blankGraph('Lifecycle branches', 'mindmap');
  const root = newNode(graph.diagram.id, { title: 'Lifecycle' });
  const branch = newNode(graph.diagram.id, {
    title: 'Operations',
    parentId: root.id,
    color: '#123abc',
  });
  const inherited = newNode(graph.diagram.id, { title: 'Maintenance', parentId: branch.id });
  const overridden = newNode(graph.diagram.id, {
    title: 'Safety',
    parentId: branch.id,
    color: '#e74329',
  });
  graph.nodes = [root, branch, inherited, overridden];
  const positions = new Map(graph.nodes.map((node, index) => [node.id, { x: index, y: 0, z: 0 }]));
  const colorAt = (batches: ReturnType<typeof createSpatialBatches>, id: string, frame = false) => {
    const entry = frame ? batches.frames.get(id)![0] : batches.nodes.get(id)!;
    const color = new THREE.Color();
    entry.mesh.getColorAt(entry.index, color);
    return color.getHexString();
  };
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(projection.nodes, projection.edges, positions);
  expect(colorAt(batches, branch.id)).toBe('123abc');
  expect(colorAt(batches, inherited.id, true)).toBe('123abc');
  expect(colorAt(batches, overridden.id, true)).toBe('e74329');
  expect(colorAt(batches, inherited.id)).toBe(
    spatialNodeAppearance(
      projection.nodes.find((node) => node.id === inherited.id)!,
    ).background.slice(1),
  );
  selectSpatialBatches(batches, new Set([inherited.id]), new Set());
  selectSpatialBatches(batches, new Set(), new Set(), new Set([inherited.id]));
  expect(colorAt(batches, inherited.id, true)).toBe('123abc');
  disposeSpatialScene(batches.group);
  const changed = {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === branch.id ? { ...node, color: '#a67314' } : node,
    ),
  };
  const changedProjection = projectGraph(changed, []);
  const changedBatches = createSpatialBatches(
    changedProjection.nodes,
    changedProjection.edges,
    positions,
  );
  expect(colorAt(changedBatches, inherited.id, true)).toBe('a67314');
  expect(colorAt(changedBatches, overridden.id, true)).toBe('e74329');
  expect(inherited.color).toBeUndefined();
  disposeSpatialScene(changedBatches.group);
});

it('represents five thousand canonical objects and links in a handful of GPU batches', () => {
  const graph = blankGraph('Thousands of objects');
  graph.nodes = Array.from({ length: 5000 }, (_, index) =>
    newNode(graph.diagram.id, {
      id: `n${index}`,
      title: `Step ${index}`,
      status: index % 10 === 0 ? 'done' : '',
    }),
  );
  graph.edges = graph.nodes
    .slice(1)
    .map((node, index) => newEdge(graph.diagram.id, graph.nodes[index].id, node.id));
  const positions = new Map(
    graph.nodes.map((node, index) => [
      node.id,
      { x: index % 80, y: Math.floor(index / 80), z: index % 7 },
    ]),
  );
  const projection = projectGraph(graph, []);
  const bounded = boundedSpatialProjection(projection.nodes, projection.edges, [], []);
  const batches = createSpatialBatches(bounded.nodes, bounded.edges, positions);
  expect(bounded.truncated).toBe(false);
  expect(batches.nodes.size).toBe(5000);
  expect(batches.edges.size).toBe(4999);
  expect(batches.group.children.length).toBeLessThanOrEqual(4);
  expect(
    batches.group.children
      .filter((object) => object instanceof THREE.InstancedMesh)
      .map((object) => object.count)
      .sort((a, b) => a - b),
  ).toEqual([4999, 5000, 20000]);
  const instance = batches.nodes.get('n4999')!;
  const matrix = new THREE.Matrix4();
  instance.mesh.getMatrixAt(instance.index, matrix);
  expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([39, 62, 1]);
  disposeSpatialScene(batches.group);
});

it('raycasts actual node instances and distinct relationship segment offsets back to canonical IDs', () => {
  const graph = blankGraph('Raycast');
  graph.nodes = Array.from({ length: 4 }, (_, index) =>
    newNode(graph.diagram.id, { id: `n${index}` }),
  );
  graph.edges = [
    newEdge(graph.diagram.id, 'n0', 'n1', { id: 'edge0' }),
    newEdge(graph.diagram.id, 'n2', 'n3', { id: 'edge1', style: 'dashed' }),
  ];
  const positions = new Map([
    ['n0', { x: -2, y: 0, z: 0 }],
    ['n1', { x: 2, y: 0, z: 0 }],
    ['n2', { x: -2, y: -2, z: 0 }],
    ['n3', { x: 2, y: -2, z: 0 }],
  ]);
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(projection.nodes, projection.edges, positions);
  batches.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-2, 0, 3), new THREE.Vector3(0, 0, -1));
  ray.params.Line = { threshold: 0.02 };
  expect(
    spatialIntersectionIdentity(ray.intersectObjects(batches.pickable, false)[0]),
  ).toMatchObject({ nodeId: 'n0' });
  ray.ray.origin.set(0, -2, 3);
  expect(
    spatialIntersectionIdentity(ray.intersectObjects(batches.pickable, false)[0]),
  ).toMatchObject({ edgeId: 'edge1' });
  const second = batches.edges.get('edge1')!;
  expect(second.line.material).toBeInstanceOf(THREE.LineDashedMaterial);
  expect(batches.arrows.get('edge1')).toHaveLength(1);
  const nodeMatrix = batches.nodes.get('n0')!.mesh.instanceMatrix;
  const lineGeometry = second.line.geometry;
  selectSpatialBatches(batches, new Set(['n0']), new Set(['edge1']));
  const selected = new THREE.Color();
  batches.nodes.get('n0')!.mesh.getColorAt(0, selected);
  expect(selected.getHexString()).toBe('286cc6');
  expect(batches.nodes.get('n0')!.mesh.instanceMatrix).toBe(nodeMatrix);
  expect(second.line.geometry).toBe(lineGeometry);
  selectSpatialBatches(batches, new Set(), new Set(), new Set(['n0']), new Set(['edge1']));
  batches.nodes.get('n0')!.mesh.getColorAt(0, selected);
  expect(selected.getHexString()).toBe('ffffff');
  disposeSpatialScene(batches.group);
});

it('resolves multiple links sharing one line buffer and releases per-instance GPU resources', () => {
  const graph = blankGraph('Shared buffers');
  graph.nodes = Array.from({ length: 3 }, (_, index) =>
    newNode(graph.diagram.id, { id: `n${index}` }),
  );
  graph.edges = [
    newEdge(graph.diagram.id, 'n0', 'n1', { id: 'edge0' }),
    newEdge(graph.diagram.id, 'n1', 'n2', { id: 'edge1' }),
  ];
  const positions = new Map(
    graph.nodes.map((node, index) => [node.id, { x: index * 2, y: 0, z: 0 }]),
  );
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(projection.nodes, projection.edges, positions);
  const first = batches.edges.get('edge0')!,
    second = batches.edges.get('edge1')!;
  expect(first.line).toBe(second.line);
  expect(
    spatialIntersectionIdentity({
      object: second.line,
      index: second.start,
      distance: 0,
      point: new THREE.Vector3(),
    }),
  ).toEqual({ edgeId: 'edge1' });
  expect(
    spatialIntersectionIdentity({
      object: second.line,
      index: first.start,
      distance: 0,
      point: new THREE.Vector3(),
    }),
  ).toEqual({ edgeId: 'edge0' });
  const mesh = batches.nodes.get('n0')!.mesh;
  const dispose = vi.spyOn(mesh, 'dispose');
  disposeSpatialScene(batches.group);
  expect(dispose).toHaveBeenCalledOnce();
});
