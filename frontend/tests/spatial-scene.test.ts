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

it('keeps inherited mind map branch colors and explicit child overrides in 3D batches', () => {
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
  const colorAt = (batches: ReturnType<typeof createSpatialBatches>, id: string) => {
    const entry = batches.nodes.get(id)!;
    const color = new THREE.Color();
    entry.mesh.getColorAt(entry.index, color);
    return color.getHexString();
  };
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(projection.nodes, projection.edges, positions);
  expect(colorAt(batches, branch.id)).toBe('123abc');
  expect(colorAt(batches, inherited.id)).toBe('123abc');
  expect(colorAt(batches, overridden.id)).toBe('e74329');
  selectSpatialBatches(batches, new Set([inherited.id]), new Set());
  selectSpatialBatches(batches, new Set(), new Set(), new Set([inherited.id]));
  expect(colorAt(batches, inherited.id)).toBe('123abc');
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
  expect(colorAt(changedBatches, inherited.id)).toBe('a67314');
  expect(colorAt(changedBatches, overridden.id)).toBe('e74329');
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
  ).toEqual([500, 4999, 5000]);
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
    ['n0', { x: -1, y: 0, z: 0 }],
    ['n1', { x: 1, y: 0, z: 0 }],
    ['n2', { x: -1, y: -1, z: 0 }],
    ['n3', { x: 1, y: -1, z: 0 }],
  ]);
  const projection = projectGraph(graph, []);
  const batches = createSpatialBatches(projection.nodes, projection.edges, positions);
  batches.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-1, 0, 3), new THREE.Vector3(0, 0, -1));
  ray.params.Line = { threshold: 0.02 };
  expect(
    spatialIntersectionIdentity(ray.intersectObjects(batches.pickable, false)[0]),
  ).toMatchObject({ nodeId: 'n0' });
  ray.ray.origin.set(0, -1, 3);
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
  expect(selected.getHexString()).toBe('538971');
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
