import { describe, expect, it } from 'vitest';
import { createSpatialExample } from '../src/spatial/examples';
import {
  defaultSpatialCamera,
  orientationCamera,
  projectSpatialGraph,
  spatialBounds,
  spatialPositions,
} from '../src/spatial/layout';
import {
  getSpatialNode,
  getSpatialView,
  offsetSpatialNode,
  setSpatialNode,
  setSpatialView,
  spatialLimits,
  validateSpatialCamera,
} from '../src/spatial/types';
import { blankGraph, diagramTypes, newEdge, newNode } from '../src/model/types';
import { projectGraph, projectedBounds } from '../src/canvas/projection';
import { validateGraph } from '../src/model/validation';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { parseImport } from '../src/export/semantic';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

describe('one diagram with shared 2D layout and 3D relief', () => {
  it.each(diagramTypes.filter((type) => type !== 'timeline'))(
    'preserves the visible 2D node centers and relationships for %s diagrams',
    (type) => {
      const graph = blankGraph('Same diagram', type);
      const root = newNode(graph.diagram.id, { x: 300, y: 100, width: 240, height: 120 });
      const child = newNode(graph.diagram.id, {
        parentId: root.id,
        x: 650,
        y: 420,
        width: 300,
        height: 80,
      });
      const leaf = newNode(graph.diagram.id, {
        parentId: child.id,
        x: -100,
        y: 320,
        width: 200,
        height: 100,
      });
      graph.nodes = [root, child, leaf];
      graph.edges = [
        newEdge(graph.diagram.id, root.id, child.id),
        newEdge(graph.diagram.id, child.id, leaf.id),
      ];
      const before = structuredClone(graph);
      const views = projectGraph(graph, []);
      const rectangle = projectedBounds(views.nodes);
      const projection = projectSpatialGraph(graph);
      expect(projection.scale).toBe(1);
      for (const view of views.nodes) {
        expect(projection.positions.get(view.id)).toEqual({
          x: (view.position.x + view.width! / 2 - rectangle.x - rectangle.width / 2) / 100,
          y: (rectangle.y + rectangle.height / 2 - view.position.y - view.height! / 2) / 100,
          z: 0,
        });
      }
      expect(spatialPositions({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual(
        projection.positions,
      );
      const toggled = setSpatialView(setSpatialView(graph, { mode: '3d' }), { mode: '2d' });
      expect(toggled.nodes).toBe(graph.nodes);
      expect(toggled.edges).toBe(graph.edges);
      expect(graph).toEqual(before);
    },
  );

  it('uses the displayed 2D timeline geometry, including date-dependent node widths', () => {
    const graph = blankGraph('Delivery schedule', 'timeline');
    graph.diagram.settings.timelineScale = 'day';
    graph.nodes = [
      newNode(graph.diagram.id, {
        x: 12_000,
        y: 40,
        startDate: '2026-01-01',
        endDate: '2026-01-03',
      }),
      newNode(graph.diagram.id, {
        x: -7_000,
        y: 220,
        startDate: '2026-01-05',
        endDate: '2026-01-05',
      }),
    ];
    const views = projectGraph(graph, []).nodes;
    const rectangle = projectedBounds(views);
    const projection = projectSpatialGraph(graph);
    expect(projection.scale).toBe(1);
    expect(views[0].width).toBe(300);
    for (const view of views)
      expect(projection.positions.get(view.id)).toEqual({
        x: (view.position.x + view.width! / 2 - rectangle.x - rectangle.width / 2) / 100,
        y: (rectangle.y + rectangle.height / 2 - view.position.y - view.height! / 2) / 100,
        z: 0,
      });
  });

  it('matches absolute React Flow node faces inside nested groups without adding offsets twice', () => {
    const graph = blankGraph('Nested frames');
    const outer = newNode(graph.diagram.id, {
      nodeType: 'group',
      x: 1200,
      y: 700,
      width: 500,
      height: 300,
    });
    const inner = newNode(graph.diagram.id, {
      nodeType: 'group',
      parentId: outer.id,
      x: 1300,
      y: 800,
      width: 250,
      height: 150,
    });
    const child = newNode(graph.diagram.id, {
      parentId: inner.id,
      x: 1500,
      y: 900,
      width: 240,
      height: 120,
    });
    graph.nodes = [child, inner, outer];
    const views = projectGraph(graph, []).nodes;
    const rectangle = projectedBounds(views);
    const byId = new Map(views.map((view) => [view.id, view]));
    const absolute = (id: string): { x: number; y: number } => {
      const view = byId.get(id)!;
      const parent = view.parentId ? absolute(view.parentId) : { x: 0, y: 0 };
      return { x: parent.x + view.position.x, y: parent.y + view.position.y };
    };
    const positions = spatialPositions(graph);
    for (const view of views) {
      const origin = absolute(view.id);
      expect(positions.get(view.id)).toEqual({
        x: (origin.x + view.width! / 2 - rectangle.x - rectangle.width / 2) / 100,
        y: (rectangle.y + rectangle.height / 2 - origin.y - view.height! / 2) / 100,
        z: 0,
      });
    }
    expect(positions.get(child.id)!.x - positions.get(inner.id)!.x).toBeCloseTo(1.95);
  });

  it('preserves all 5,000 node positions rather than inventing a hierarchy arrangement', () => {
    const graph = blankGraph('Large lifecycle', 'mindmap');
    graph.nodes = Array.from({ length: 5_000 }, (_, index) =>
      newNode(graph.diagram.id, {
        x: (index % 100) * 160,
        y: Math.floor(index / 100) * 130,
        width: 120,
        height: 80,
      }),
    );
    const root = graph.nodes[0];
    for (const node of graph.nodes.slice(1)) node.parentId = root.id;
    graph.edges = graph.nodes
      .slice(1)
      .map((node) => newEdge(graph.diagram.id, root.id, node.id, { edgeType: 'hierarchy' }));
    const before = structuredClone(graph);
    const projection = projectSpatialGraph(graph);
    expect(projection.scale).toBe(1);
    expect(projection.positions.size).toBe(5_000);
    expect(
      new Set([...projection.positions.values()].map((point) => JSON.stringify(point))).size,
    ).toBe(5_000);
    expect(
      [...projection.positions.values()].every(
        (point) => point.z === 0 && Object.values(point).every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      projection.positions.get(graph.nodes[99].id)!.x - projection.positions.get(root.id)!.x,
    ).toBeCloseTo(158.4);
    expect(
      projection.positions.get(graph.nodes[100].id)!.y - projection.positions.get(root.id)!.y,
    ).toBeCloseTo(-1.3);
    expect(spatialPositions({ ...graph, nodes: [...graph.nodes].reverse(), edges: [] })).toEqual(
      projection.positions,
    );
    expect(graph).toEqual(before);
  });

  it('does not traverse deep, cyclic or missing parent references to calculate planar relief', () => {
    const graph = blankGraph('Malformed preview', 'mindmap');
    for (let index = 0; index < 12_000; index++)
      graph.nodes.push(
        newNode(graph.diagram.id, {
          parentId: graph.nodes.at(-1)?.id,
          x: index * 2000,
          y: (index % 17) * 120,
        }),
      );
    graph.nodes[0].parentId = graph.nodes.at(-1)!.id;
    graph.nodes.push(newNode(graph.diagram.id, { parentId: 'missing-parent' }));
    const positions = spatialPositions(graph);
    const bounds = spatialBounds(positions.values());
    expect(positions.size).toBe(12_001);
    expect(
      [...positions.values()].every(
        (point) => point.z === 0 && Object.values(point).every(Number.isFinite),
      ),
    ).toBe(true);
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(spatialLimits.derivedExtent);
    expect(spatialPositions({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual(positions);
    validateSpatialCamera(defaultSpatialCamera(bounds));
  });

  it('shrinks extreme extents uniformly while preserving angles, relative centers and dimension scale', () => {
    const graph = blankGraph('Extreme canvas', 'process');
    graph.nodes = [
      newNode(graph.diagram.id, { x: -1e8, y: -5e7, width: 200, height: 100 }),
      newNode(graph.diagram.id, { x: 1e8, y: 5e7, width: 200, height: 100 }),
    ];
    const projection = projectSpatialGraph(graph);
    const first = projection.positions.get(graph.nodes[0].id)!;
    const last = projection.positions.get(graph.nodes[1].id)!;
    expect(projection.scale).toBeGreaterThan(0);
    expect(projection.scale).toBeLessThan(1);
    expect(last.x - first.x).toBeCloseTo((2e8 / 100) * projection.scale);
    expect(last.y - first.y).toBeCloseTo((-1e8 / 100) * projection.scale);
    expect((last.y - first.y) / (last.x - first.x)).toBeCloseTo(-0.5);
    expect(last.x - first.x + (200 / 100) * projection.scale).toBeCloseTo(
      spatialLimits.derivedExtent,
    );
    expect(first.z).toBe(0);
    expect(last.z).toBe(0);
    validateSpatialCamera(projection.camera);
  });

  it('is invariant under a large common canvas translation and starts directly in front', () => {
    const graph = createSpatialExample();
    const projection = projectSpatialGraph(graph);
    const moved = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        x: node.x + 90_000_000,
        y: node.y - 90_000_000,
      })),
    };
    expect(projectSpatialGraph(moved).positions).toEqual(projection.positions);
    expect(projection.camera.position.x).toBe(projection.camera.target.x);
    expect(projection.camera.position.y).toBe(projection.camera.target.y);
    expect(projection.camera.position.z).toBeGreaterThan(projection.camera.target.z);
  });

  it('respects independent explicit 3D positions without changing ordinary node placement', () => {
    const graph = blankGraph('Positions');
    const explicit = newNode(graph.diagram.id, { x: 700, y: 500 });
    const ordinary = newNode(graph.diagram.id, { x: 0, y: 0 });
    graph.nodes = [explicit, ordinary];
    const before = spatialPositions(graph);
    graph.nodes[0] = setSpatialNode(explicit, { version: 1, position: { x: 4, y: 5, z: -3 } });
    const positions = spatialPositions(graph);
    expect(positions.get(explicit.id)).toEqual({ x: 4, y: 5, z: -3 });
    expect(positions.get(ordinary.id)).toEqual(before.get(ordinary.id));
    expect(getSpatialNode(graph.nodes[0])?.position).not.toBe(positions.get(explicit.id));
  });

  it('fits the front view according to both face dimensions and the viewport aspect', () => {
    const bounds = spatialBounds([
      { x: -20, y: -3, z: 0 },
      { x: 20, y: 3, z: 0.3 },
    ]);
    const landscape = defaultSpatialCamera(bounds, 2);
    const phone = defaultSpatialCamera(bounds, 0.5);
    const tangent = Math.tan((21 * Math.PI) / 180);
    for (const [camera, aspect] of [
      [landscape, 2],
      [phone, 0.5],
    ] as const) {
      expect(camera.position.x).toBe(camera.target.x);
      expect(camera.position.y).toBe(camera.target.y);
      const closestFaceDistance = camera.position.z - bounds.max.z;
      expect(closestFaceDistance * tangent * aspect).toBeGreaterThan(20);
      expect(closestFaceDistance * tangent).toBeGreaterThan(3);
      validateSpatialCamera(camera);
    }
    expect(phone.position.z).toBeGreaterThan(landscape.position.z);
    expect(defaultSpatialCamera(bounds, NaN)).toEqual(defaultSpatialCamera(bounds));
  });

  it('retains the camera when toggling and rejects a camera looking at itself', () => {
    const graph = createSpatialExample();
    const camera = orientationCamera('back');
    const spatial = setSpatialView(graph, { camera });
    const planar = setSpatialView(spatial, { mode: '2d' });
    expect(getSpatialView(planar)).toEqual({ version: 1, mode: '2d', camera });
    expect(projectSpatialGraph(setSpatialView(planar, { mode: '3d' })).camera).toEqual(camera);
    expect(camera.position.z).toBeLessThan(camera.target.z);
    expect(orientationCamera('front').position.z).toBeGreaterThan(0);
    expect(orientationCamera('top').position.y).toBeGreaterThan(0);
    expect(() =>
      setSpatialView(graph, {
        camera: { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } },
      }),
    ).toThrow(/must differ/);
    const edgePoint = {
      x: spatialLimits.coordinate,
      y: spatialLimits.coordinate,
      z: spatialLimits.coordinate,
    };
    validateSpatialCamera(defaultSpatialCamera(spatialBounds([edgePoint])));
  });

  it('illustrates a truck lifecycle using its readable 2D branches in the 3D relief', () => {
    const graph = createSpatialExample();
    validateGraph(graph);
    expect(graph.diagram.name).toBe('Truck lifecycle');
    expect(graph.nodes).toHaveLength(25);
    expect(graph.edges).toHaveLength(24);
    expect(getSpatialView(graph)).toMatchObject({ mode: '3d' });
    expect(graph.nodes[0].title).toBe('Truck lifecycle');
    const stages = graph.nodes.filter((node) => node.parentId === graph.nodes[0].id);
    expect(stages.map((node) => node.title)).toEqual([
      'Manufacturing',
      'Delivery',
      'Operation',
      'Maintenance',
      'Second life',
      'Recycling',
    ]);
    expect(graph.nodes.every((node) => !!node.description && !getSpatialNode(node)?.position)).toBe(
      true,
    );
    const positions = spatialPositions(graph);
    expect(new Set([...positions.values()].map((position) => JSON.stringify(position))).size).toBe(
      25,
    );
    expect([...positions.values()].every((position) => position.z === 0)).toBe(true);
    expect(new Set(graph.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(25);
    expect(
      graph.edges.every(
        (edge) =>
          edge.edgeType === 'hierarchy' &&
          graph.nodes.find((node) => node.id === edge.targetNodeId)?.parentId === edge.sourceNodeId,
      ),
    ).toBe(true);
    expect(graph.nodes.filter((node) => node.status === 'done')).toHaveLength(2);
    for (const stage of stages) {
      const children = graph.nodes.filter((node) => node.parentId === stage.id);
      expect(children).toHaveLength(3);
    }
    for (const [index, node] of graph.nodes.entries()) {
      for (const other of graph.nodes.slice(index + 1)) {
        const overlap =
          node.x < other.x + other.width &&
          node.x + node.width > other.x &&
          node.y < other.y + other.height &&
          node.y + node.height > other.y;
        expect(overlap).toBe(false);
      }
    }
    expect(parseImport('json', JSON.stringify(graph))).toEqual(graph);
  });

  it('fits the entire allowed node world with a separately bounded camera', () => {
    const graph = blankGraph('Extreme 3D extents');
    graph.nodes = [-1, 1].map((sign) =>
      newNode(graph.diagram.id, {
        metadata: {
          spatial: {
            version: 1,
            position: {
              x: sign * spatialLimits.coordinate,
              y: sign * spatialLimits.coordinate,
              z: sign * spatialLimits.coordinate,
            },
          },
        },
      }),
    );
    const projection = projectSpatialGraph(graph);
    const { position, target } = projection.camera;
    const distance = Math.hypot(
      position.x - target.x,
      position.y - target.y,
      position.z - target.z,
    );
    expect(distance - spatialLimits.coordinate).toBeGreaterThan(
      spatialLimits.coordinate / Math.tan((21 * Math.PI) / 180),
    );
    expect(
      Object.values(position).every((value) => Math.abs(value) <= spatialLimits.cameraCoordinate),
    ).toBe(true);
    expect(position.z).toBeGreaterThan(spatialLimits.coordinate);
    validateSpatialCamera(projection.camera);
    validateSpatialCamera(orientationCamera('back', projection.bounds.center, distance));
    validateGraph(setSpatialView(graph, { mode: '3d', camera: projection.camera }));
  });

  it('copies annotations and relationships with independent offset 3D positions', () => {
    const graph = createSpatialExample();
    graph.nodes[0] = setSpatialNode(graph.nodes[0], { version: 1, position: { x: 0, y: 0, z: 0 } });
    graph.nodes[1] = setSpatialNode(graph.nodes[1], {
      version: 1,
      position: { x: -3, y: 2, z: -2 },
    });
    graph.nodes[1].notes = 'Explain this work area';
    graph.nodes[1].status = 'done';
    const clip = copySelection(graph, [graph.nodes[0].id, graph.nodes[1].id]);
    const pasted = pasteSelection(clip, graph);
    expect(pasted.nodes[1].id).not.toBe(graph.nodes[1].id);
    expect(pasted.nodes[1].parentId).toBe(pasted.nodes[0].id);
    expect(pasted.nodes[1].notes).toBe('Explain this work area');
    expect(pasted.nodes[1].status).toBe('done');
    const original = getSpatialNode(graph.nodes[1])!;
    const position = getSpatialNode(pasted.nodes[1])!.position!;
    expect(pasted.edges[0].sourceNodeId).toBe(pasted.nodes[0].id);
    expect(pasted.edges[0].targetNodeId).toBe(pasted.nodes[1].id);
    expect(position.x).toBeCloseTo(original.position!.x + 40 / 120);
    expect(position.y).toBeCloseTo(original.position!.y - 40 / 120);
    expect(getSpatialNode(offsetSpatialNode(graph.nodes[1]))?.position?.x).toBeCloseTo(
      original.position!.x + 0.4,
    );
    expect(getSpatialNode(setSpatialNode(graph.nodes[1], undefined))).toBeUndefined();
    expect(getSpatialNode(graph.nodes[1])).toEqual(original);
    const automatic = setSpatialNode(graph.nodes[1], { version: 1 });
    expect(offsetSpatialNode(automatic)).toBe(automatic);
  });
});

describe('reserved spatial fields reject malformed payloads before committing', () => {
  it.each([
    null,
    [],
    { version: 2, mode: '3d' },
    { version: 1, mode: '4d' },
    { version: 1, mode: '3d', scene: 'unknown' },
    { version: 1, mode: '3d', meshUrl: 'https://example.com/executable' },
    {
      version: 1,
      mode: '3d',
      camera: { position: { x: 0, y: 0, z: Infinity }, target: { x: 0, y: 0, z: 0 } },
    },
  ])('rejects unsupported view payload %j while the getter safely offers 2D', (value) => {
    const graph = blankGraph('Invalid view');
    graph.diagram.settings.spatialView = value as never;
    expect(() => validateGraph(graph)).toThrow();
    expect(getSpatialView(graph)).toEqual({ version: 1, mode: '2d' });
  });

  it.each([
    null,
    { version: 2, position: { x: 0, y: 0, z: 1 } },
    { version: 1, meshUrl: 'https://example.com/model' },
    { version: 1, position: { x: 0, y: 0, z: NaN } },
    { version: 1, position: { x: 0, y: 0 } },
    { version: 1, position: { x: 0, y: 0, z: spatialLimits.coordinate + 1 } },
    { version: 1, position: { x: 0, y: 0, z: 1, w: 2 } },
    { version: 1, nodeIds: ['unremapped identity'] },
  ])('rejects unsupported node payload %j', (value) => {
    const graph = blankGraph('Invalid node');
    graph.nodes = [
      newNode(graph.diagram.id, { metadata: { spatial: value, custom: { keep: true } } }),
    ];
    expect(() => validateGraph(graph)).toThrow();
    expect(getSpatialNode(graph.nodes[0])).toBeUndefined();
  });

  it('preserves spatial identities across duplicate imports and rolls back a malformed spatial update atomically', async () => {
    const database = new WorkspaceDatabase(`spatial-${crypto.randomUUID()}`);
    const repo = new Repository(database);
    await database.initialize();
    try {
      const source = createSpatialExample();
      source.nodes[1] = setSpatialNode(source.nodes[1], {
        version: 1,
        position: { x: -3, y: 2, z: -2 },
      });
      source.nodes[1].notes = 'Saved explanation';
      const saved = await repo.importGraph(source);
      const duplicate = await repo.importGraph(source);
      expect(duplicate.diagram.id).not.toBe(saved.diagram.id);
      expect(getSpatialNode(duplicate.nodes[1])).toEqual(getSpatialNode(saved.nodes[1]));
      expect(duplicate.nodes[1].parentId).toBe(duplicate.nodes[0].id);
      const invalid = structuredClone(saved);
      invalid.nodes[1].metadata.spatial = { version: 1, position: { x: 2, y: 3, z: Infinity } };
      invalid.nodes[1].notes = 'Must never save';
      await expect(repo.saveGraph(invalid, saved.diagram.version)).rejects.toMatchObject({
        status: 422,
      });
      expect(await repo.getGraph(saved.diagram.id)).toEqual(saved);
    } finally {
      await database.delete();
    }
  });
});
