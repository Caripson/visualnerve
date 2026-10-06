import { expect, it } from 'vitest';
import * as THREE from 'three';
import { blankGraph, newNode } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import {
  boundedSpatialProjection,
  createSpatialBatches,
  disposeSpatialScene,
} from '../src/spatial/scene';
import {
  spatialPresentationGeometryKey,
  spatialPresentationObstacles,
} from '../src/presentation/spatial-obstacles';
import {
  planPresentationFlight,
  presentationObstacle,
  presentationPathClear,
} from '../src/presentation/camera';

it('avoids a visible blocker beyond the 8,000-card render cap', () => {
  const graph = blankGraph('Complete collision geometry');
  graph.nodes = Array.from({ length: 8000 }, (_, index) =>
    newNode(graph.diagram.id, { id: `resident-${index}`, width: 200, height: 80 }),
  );
  graph.nodes.push(
    newNode(graph.diagram.id, { id: 'nonresident-blocker', width: 1000, height: 1000 }),
  );
  const projection = projectGraph(graph, []);
  const resident = boundedSpatialProjection(projection.nodes, [], [], []);
  expect(resident.nodes).toHaveLength(8000);
  expect(resident.nodes.some((node) => node.id === 'nonresident-blocker')).toBe(false);
  const positions = new Map(
    graph.nodes.map((node, index) => [
      node.id,
      index === 8000
        ? { x: 0, y: 0, z: 0 }
        : { x: 10 + (index % 100) * 4, y: 10 + Math.floor(index / 100) * 3, z: 0 },
    ]),
  );
  const world = new THREE.Matrix4().elements;
  const residentObstacles = spatialPresentationObstacles(resident.nodes, positions, 1, world);
  const all = spatialPresentationObstacles(projection.nodes, positions, 1, world);
  expect(all).toHaveLength(8001);
  const from = { x: 0, y: 0, z: -8 },
    to = { x: 0, y: 0, z: 8 };
  expect(planPresentationFlight(from, to, residentObstacles)).toHaveLength(2);
  const path = planPresentationFlight(from, to, all);
  expect(path.length).toBeGreaterThan(2);
  expect(presentationPathClear(path, all, 0.08)).toBe(true);
});

it('excludes hidden cards and places group relief behind its children', () => {
  const graph = blankGraph('Visible geometry');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'card', width: 400, height: 200 }),
    newNode(graph.diagram.id, { id: 'group', nodeType: 'group', width: 800, height: 400 }),
    newNode(graph.diagram.id, { id: 'hidden', width: 2000, height: 2000 }),
  ];
  const nodes = projectGraph(graph, []).nodes;
  nodes.find((node) => node.id === 'hidden')!.hidden = true;
  const positions = new Map(graph.nodes.map((node) => [node.id, { x: 1, y: 2, z: 7 }]));
  const obstacles = spatialPresentationObstacles(
    nodes,
    positions,
    0.5,
    new THREE.Matrix4().elements,
  );
  expect(obstacles.map((obstacle) => obstacle.id)).toEqual(['card', 'group']);
  const card = obstacles[0],
    group = obstacles[1];
  expect(card.max.x - card.min.x).toBeCloseTo(2);
  expect(card.max.y - card.min.y).toBeCloseTo(1);
  expect(card.max.z - card.min.z).toBeCloseTo(0.07);
  expect((group.min.z + group.max.z) / 2).toBeCloseTo(7 - 0.16 * 0.5);
});

it('matches rendered card bounds after complete root rotation and nonuniform scaling', () => {
  const graph = blankGraph('Transformed geometry');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'card', width: 400, height: 200 }),
    newNode(graph.diagram.id, { id: 'group', nodeType: 'group', width: 800, height: 400 }),
  ];
  const nodes = projectGraph(graph, []).nodes;
  const positions = new Map([
    ['card', { x: 1, y: 2, z: 3 }],
    ['group', { x: -1, y: -2, z: 5 }],
  ]);
  const batches = createSpatialBatches(nodes, [], positions, 0.5);
  const root = new THREE.Group();
  root.position.set(12, -4, 8);
  root.rotation.set(0.3, Math.PI / 2, 0.5);
  root.scale.set(2, 3, 0.5);
  root.add(batches.group);
  root.updateMatrixWorld(true);
  try {
    const all = spatialPresentationObstacles(nodes, positions, 0.5, root.matrixWorld.elements);
    for (const [id, node] of batches.nodes) {
      const rendered = presentationObstacle(
        id,
        node.position,
        node.dimensions,
        node.mesh.matrixWorld.elements,
      );
      expect(all.find((obstacle) => obstacle.id === id)).toEqual(rendered);
    }
  } finally {
    disposeSpatialScene(root);
  }
});

it('invalidates a flight when nonresident collision geometry changes, without invalidating selection or labels', () => {
  const graph = blankGraph('Geometry lifecycle');
  graph.nodes = [
    newNode(graph.diagram.id, { id: 'visible', width: 400, height: 200 }),
    newNode(graph.diagram.id, { id: 'hidden', width: 600, height: 300 }),
  ];
  const nodes = projectGraph(graph, []).nodes;
  nodes[1].hidden = true;
  const positions = new Map(graph.nodes.map((node) => [node.id, { x: 1, y: 2, z: 3 }]));
  const initial = spatialPresentationGeometryKey(nodes, positions, 1);
  nodes[0].selected = true;
  nodes[0].data.presentationNumber = 9;
  nodes[0].data.node.description = 'A different narration';
  nodes[1].width = 900;
  expect(spatialPresentationGeometryKey(nodes, positions, 1)).toBe(initial);
  nodes[1].hidden = false;
  const revealed = spatialPresentationGeometryKey(nodes, positions, 1);
  expect(revealed).not.toBe(initial);
  positions.set('hidden', { x: 40, y: 2, z: 3 });
  expect(spatialPresentationGeometryKey(nodes, positions, 1)).not.toBe(revealed);
  expect(spatialPresentationGeometryKey(nodes, positions, 0.5)).not.toBe(revealed);
});
