import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { projectGraph } from '../src/canvas/projection';
import { spatialPlanarGeometry, spatialPositions } from '../src/spatial/layout';
import {
  boundedSpatialMovement,
  moveSpatialObjects,
  spatialMovementIds,
  syncSpatialPositions,
} from '../src/spatial/movement';
import { spatialDragPoint } from '../src/spatial/drag';
import { spatialMovementPreview } from '../src/spatial/movementScene';
import { createSpatialBatches, disposeSpatialScene } from '../src/spatial/scene';
import { getSpatialNode, spatialLimits } from '../src/spatial/types';
import { useEditor } from '../src/state/editor';

beforeEach(() => useEditor.getState().setGraph(null));
function fixture() {
  const graph = blankGraph('Movement');
  graph.nodes = [
    newNode(graph.diagram.id, {
      id: 'outer',
      nodeType: 'group',
      x: 1000,
      y: 600,
      metadata: { spatial: { version: 1, position: { x: 4, y: 5, z: 2 } }, integration: 'keep' },
    }),
    newNode(graph.diagram.id, {
      id: 'inner',
      nodeType: 'group',
      parentId: 'outer',
      x: 1100,
      y: 700,
    }),
    newNode(graph.diagram.id, {
      id: 'child',
      parentId: 'inner',
      x: 1150,
      y: 750,
      metadata: { spatial: { version: 1, position: { x: 7, y: 3, z: -2 } } },
    }),
    newNode(graph.diagram.id, { id: 'other', x: 1800, y: 600 }),
  ];
  graph.edges = [
    newEdge(graph.diagram.id, 'child', 'other', { label: 'Retained', direction: 'both' }),
  ];
  return graph;
}

describe('2D movement follows existing 3D positions', () => {
  it('converts absolute nested placements once, preserves Z and unrelated metadata, and undoes atomically', () => {
    const graph = fixture();
    useEditor.getState().setGraph(graph);
    useEditor.getState().command('2D group movement', (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === 'other' ? node : { ...node, x: node.x + 120, y: node.y - 40 },
      ),
    }));
    const changed = useEditor.getState().graph!;
    expect(getSpatialNode(changed.nodes[0])?.position).toEqual({ x: 5.2, y: 5.4, z: 2 });
    expect(getSpatialNode(changed.nodes[2])?.position).toEqual({ x: 8.2, y: 3.4, z: -2 });
    expect(changed.nodes[0].metadata.integration).toBe('keep');
    expect(getSpatialNode(changed.nodes[1])).toBeUndefined();
    expect(changed.edges).toBe(graph.edges);
    expect(useEditor.getState().history).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    useEditor.getState().redo();
    expect(useEditor.getState().graph).toEqual(changed);
  });
  it('lets a simultaneous explicit XYZ patch win, and skips unchanged placement', () => {
    const graph = fixture();
    const after = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id !== 'outer'
          ? node
          : {
              ...node,
              x: node.x + 200,
              metadata: { spatial: { version: 1, position: { x: 99, y: 22, z: 8 } } },
            },
      ),
    };
    expect(syncSpatialPositions(graph, after)).toBe(after);
    expect(syncSpatialPositions(graph, { ...graph, edges: [] })).toEqual({ ...graph, edges: [] });
  });
  it('converts displayed timeline movement rather than unused canonical X', () => {
    const graph = blankGraph('Timeline', 'timeline');
    graph.diagram.settings.timelineScale = 'day';
    graph.nodes = [
      newNode(graph.diagram.id, {
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        y: 100,
        metadata: { spatial: { version: 1, position: { x: 8, y: 9, z: 7 } } },
      }),
      newNode(graph.diagram.id, { startDate: '2026-01-01', endDate: '2026-01-01', y: 500 }),
    ];
    const after = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index ? node : { ...node, startDate: '2026-01-03', endDate: '2026-01-05', y: 140 },
      ),
    };
    expect(getSpatialNode(syncSpatialPositions(graph, after).nodes[0])?.position).toEqual({
      x: 10,
      y: 8.6,
      z: 7,
    });
  });
  it('uses the existing uniform scale for extreme extents without applying recentering', () => {
    const graph = fixture();
    graph.nodes[3].x = 1_000_000;
    const scale = spatialPlanarGeometry(graph).scale;
    expect(scale).toBeLessThan(1);
    const after = {
      ...graph,
      nodes: graph.nodes.map((node, index) => (index ? node : { ...node, x: node.x + 100 })),
    };
    expect(getSpatialNode(syncSpatialPositions(graph, after).nodes[0])?.position?.x).toBeCloseTo(
      4 + scale,
    );
    expect(getSpatialNode(syncSpatialPositions(graph, after).nodes[2])?.position).toEqual({
      x: 7,
      y: 3,
      z: -2,
    });
  });
  it('moves the earliest timeline item in the old time axis without moving unrelated explicit cards', () => {
    const graph = blankGraph('Rebased timeline', 'timeline');
    graph.diagram.settings.timelineScale = 'day';
    graph.nodes = [
      newNode(graph.diagram.id, {
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        metadata: { spatial: { version: 1, position: { x: 4, y: 2, z: 8 } } },
      }),
      newNode(graph.diagram.id, {
        startDate: '2026-01-10',
        endDate: '2026-01-10',
        metadata: { spatial: { version: 1, position: { x: 14, y: 5, z: 3 } } },
      }),
    ];
    const after = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index ? node : { ...node, startDate: '2026-01-03', endDate: '2026-01-03' },
      ),
    };
    const next = syncSpatialPositions(graph, after);
    expect(getSpatialNode(next.nodes[0])?.position).toEqual({ x: 6, y: 2, z: 8 });
    expect(next.nodes[1]).toBe(graph.nodes[1]);
  });
});

describe('3D gesture placement', () => {
  it('moves nested descendants once, keeps their depths, 2D geometry and relationships, and creates one history command', () => {
    const graph = fixture(),
      before = spatialPositions(graph);
    expect(spatialMovementIds(graph, ['outer', 'inner', 'child'])).toEqual(
      new Set(['outer', 'inner', 'child']),
    );
    useEditor.getState().setGraph(graph);
    useEditor
      .getState()
      .command('Move 3D objects', (current) =>
        moveSpatialObjects(current, ['outer', 'child'], { x: 2, y: -1, z: 999 }),
      );
    const next = useEditor.getState().graph!;
    for (const node of next.nodes) {
      const original = graph.nodes.find((value) => value.id === node.id)!;
      expect([node.x, node.y, node.width, node.height, node.parentId]).toEqual([
        original.x,
        original.y,
        original.width,
        original.height,
        original.parentId,
      ]);
      if (node.id === 'other') expect(node).toBe(original);
      else
        expect(getSpatialNode(node)?.position).toEqual({
          x: before.get(node.id)!.x + 2,
          y: before.get(node.id)!.y - 1,
          z: before.get(node.id)!.z,
        });
    }
    expect(next.edges).toBe(graph.edges);
    expect(useEditor.getState().history).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().graph).toEqual(graph);
    useEditor.getState().redo();
    expect(useEditor.getState().graph).toEqual(next);
  });
  it('intersects the saved XY depth plane from front and back and rejects an edge-on ray', () => {
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const front = spatialDragPoint(camera, new THREE.Vector2(0.4, -0.2), 3)!;
    expect(front.z).toBeCloseTo(3);
    expect(front.x).toBeGreaterThan(0);
    camera.position.set(0, 0, -10);
    camera.lookAt(0, 0, 0);
    const back = spatialDragPoint(camera, new THREE.Vector2(0.4, -0.2), 3)!;
    expect(back.z).toBeCloseTo(3);
    expect(back.x).toBeLessThan(0);
    camera.position.set(10, 0, 0);
    camera.lookAt(0, 0, 0);
    expect(spatialDragPoint(camera, new THREE.Vector2(0, 0), 3)).toBeUndefined();
  });
  it('clamps a shared group delta rather than collapsing members onto the coordinate boundary', () => {
    expect(
      boundedSpatialMovement(
        [
          { x: spatialLimits.coordinate - 3, y: 0, z: 2 },
          { x: spatialLimits.coordinate - 10, y: 0, z: 1 },
        ],
        { x: 20, y: 2, z: 99 },
      ),
    ).toEqual({ x: 3, y: 2, z: 0 });
  });
  it('previews actual nodes and directed relationships without writing graph data, and fully restores after cancellation', () => {
    const graph = fixture();
    graph.edges.push(newEdge(graph.diagram.id, 'child', 'outer', { direction: 'forward' }));
    const views = projectGraph(graph, []),
      before = structuredClone(graph);
    const batches = createSpatialBatches(views.nodes, views.edges, spatialPositions(graph));
    const instance = batches.nodes.get('child')!,
      oldPosition = instance.position.clone();
    const edge = batches.edges.get(graph.edges[0].id)!,
      original = new Float32Array(edge.line.geometry.getAttribute('position').array);
    expect(batches.edges.get(graph.edges[1].id)!.line.geometry).toBe(edge.line.geometry);
    const computeBounds = vi.spyOn(edge.line.geometry, 'computeBoundingSphere');
    const labels = new THREE.Group();
    const preview = spatialMovementPreview(batches, labels, new Set(['child']), views.edges, 1);
    // A selected native face can become resident after pointerdown/capture completion.
    const lateFace = new THREE.Object3D();
    lateFace.userData.nodeId = 'child';
    lateFace.position.copy(oldPosition);
    labels.add(lateFace);
    const edgeLabel = new THREE.Object3D();
    edgeLabel.userData.edgeId = graph.edges[0].id;
    labels.add(edgeLabel);
    preview.update({ x: 2, y: -1, z: 10 });
    expect(computeBounds).toHaveBeenCalledTimes(1);
    expect(instance.position.toArray()).toEqual(
      oldPosition
        .clone()
        .add(new THREE.Vector3(2, -1, 0))
        .toArray(),
    );
    expect(edge.line.geometry.getAttribute('position').array).not.toEqual(original);
    expect(lateFace.position).toEqual(oldPosition.clone().add(new THREE.Vector3(2, -1, 0)));
    const middle = batches.edgePoints.get(graph.edges[0].id)!;
    expect(edgeLabel.position).toEqual(
      middle[Math.floor(middle.length / 2)].clone().add(new THREE.Vector3(0, 0.13, 0.003)),
    );
    expect(graph).toEqual(before);
    preview.restore();
    expect(instance.position).toEqual(oldPosition);
    expect(lateFace.position).toEqual(oldPosition);
    expect(edge.line.geometry.getAttribute('position').array).toEqual(original);
    expect(graph).toEqual(before);
    disposeSpatialScene(batches.group);
  });
});
