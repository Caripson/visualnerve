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
import { blankGraph, newEdge, newNode } from '../src/model/types';
import { validateGraph } from '../src/model/validation';
import { copySelection, pasteSelection } from '../src/state/clipboard';
import { parseImport } from '../src/export/semantic';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';

describe('one diagram with independent 2D and 3D geometry', () => {
  it('packs more than 5,000 topics into distinct hierarchy clusters in three dimensions', () => {
    const graph = blankGraph('Large compact mind map', 'mindmap');
    const root = newNode(graph.diagram.id, { x: 1_000_000, y: 500_000 });
    graph.nodes.push(root);
    const branches = Array.from({ length: 10 }, (_, index) =>
      newNode(graph.diagram.id, { parentId: root.id, x: index * 10_000, y: index * 20_000 }),
    );
    graph.nodes.push(...branches);
    for (const branch of branches)
      for (let index = 0; index < 500; index++)
        graph.nodes.push(
          newNode(graph.diagram.id, { parentId: branch.id, x: index * 1000, y: index * 1000 }),
        );
    const original = graph.nodes.map((node) => [node.x, node.y]);
    const positions = spatialPositions(graph);
    const bounds = spatialBounds(positions.values());
    const distance = (a: string, b: string) => {
      const first = positions.get(a)!,
        second = positions.get(b)!;
      return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
    };
    expect(positions.size).toBe(5_011);
    expect(new Set([...positions.values()].map((point) => JSON.stringify(point))).size).toBe(5_011);
    expect(
      [...positions.values()].every((point) => Object.values(point).every(Number.isFinite)),
    ).toBe(true);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(bounds.max[axis] - bounds.min[axis]).toBeGreaterThan(10);
      expect(bounds.max[axis] - bounds.min[axis]).toBeLessThanOrEqual(spatialLimits.derivedExtent);
    }
    for (const branch of branches) {
      const child = graph.nodes.find((node) => node.parentId === branch.id)!;
      expect(distance(child.id, branch.id)).toBeLessThan(distance(branch.id, root.id));
    }
    expect(new Set(branches.map((node) => JSON.stringify(positions.get(node.id)))).size).toBe(10);
    expect(spatialPositions(graph)).toEqual(positions);
    expect(spatialPositions({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual(positions);
    expect(graph.nodes.map((node) => [node.x, node.y])).toEqual(original);
    const explicit = { x: 150_000, y: -200_000, z: 300_000 };
    const mixed = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === branches[0].id
          ? setSpatialNode(node, { version: 1, position: explicit })
          : node,
      ),
    };
    expect(spatialPositions(mixed).get(branches[0].id)).toEqual(explicit);
  });

  it('handles deep chains, cycles, disconnected roots and missing hierarchy references without recursion', () => {
    const graph = blankGraph('Malformed preview', 'mindmap');
    for (let index = 0; index < 5_000; index++)
      graph.nodes.push(
        newNode(graph.diagram.id, { parentId: graph.nodes.at(-1)?.id, x: index * 1000 }),
      );
    graph.nodes[0].parentId = graph.nodes.at(-1)!.id;
    graph.nodes.push(
      newNode(graph.diagram.id, { parentId: 'missing-parent' }),
      newNode(graph.diagram.id),
    );
    const positions = spatialPositions(graph);
    expect(positions.size).toBe(5_002);
    expect(new Set([...positions.values()].map((point) => JSON.stringify(point))).size).toBe(5_002);
    expect(
      [...positions.values()].every((point) => Object.values(point).every(Number.isFinite)),
    ).toBe(true);
    const bounds = spatialBounds(positions.values());
    expect(
      Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      ),
    ).toBeLessThanOrEqual(spatialLimits.derivedExtent);
    expect(spatialPositions(graph)).toEqual(positions);
  });

  it('uses hierarchy relationships when imported mindmap topics omit explicit parent references', () => {
    const graph = blankGraph('Imported topics', 'mindmap');
    graph.nodes = Array.from({ length: 2_502 }, () => newNode(graph.diagram.id));
    const root = graph.nodes[0];
    graph.edges = graph.nodes
      .slice(1)
      .map((node) =>
        newEdge(graph.diagram.id, root.id, node.id, { edgeType: 'hierarchy', direction: 'none' }),
      );
    const positions = spatialPositions(graph);
    expect(new Set([...positions.values()].map((point) => JSON.stringify(point))).size).toBe(2_502);
    expect(spatialBounds(positions.values()).max.z).toBeGreaterThan(1);
    expect(spatialBounds(positions.values()).min.z).toBeLessThan(-1);
    expect(graph.nodes.every((node) => node.x === 0 && node.y === 0 && !node.parentId)).toBe(true);
  });

  it('derives deterministic bounded hierarchy depth without modifying the canonical graph', () => {
    const graph = blankGraph('Hierarchy', 'mindmap');
    const root = newNode(graph.diagram.id, { title: 'Root', x: 300, y: 100 });
    const child = newNode(graph.diagram.id, { title: 'Child', parentId: root.id, x: 560, y: 400 });
    const leaf = newNode(graph.diagram.id, { title: 'Leaf', parentId: child.id, x: 820, y: 300 });
    graph.nodes = [root, child, leaf];
    const before = structuredClone(graph);
    const positions = spatialPositions(graph);
    expect(positions.get(root.id)?.z).toBe(0);
    expect(positions.get(child.id)!.z).toBeGreaterThan(positions.get(root.id)!.z);
    expect(positions.get(leaf.id)!.z).toBeGreaterThan(positions.get(child.id)!.z);
    expect(spatialPositions({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual(positions);
    expect(graph).toEqual(before);
    const toggled = setSpatialView(setSpatialView(graph, { mode: '3d' }), { mode: '2d' });
    expect(toggled.nodes).toBe(graph.nodes);
    expect(toggled.nodes).toEqual(before.nodes);
    expect(toggled.diagram.settings.viewport).toEqual(before.diagram.settings.viewport);
  });

  it('respects independent explicit 3D positions regardless of 2D placement', () => {
    const graph = blankGraph('Positions');
    const explicit = newNode(graph.diagram.id, {
      x: 1e8,
      y: -1e8,
      metadata: { spatial: { version: 1, position: { x: 4, y: 5, z: -3 } } },
    });
    const unplaced = newNode(graph.diagram.id, { x: 0, y: 0 });
    graph.nodes = [explicit, unplaced];
    const positions = spatialPositions(graph);
    expect(positions.get(explicit.id)).toEqual({ x: 4, y: 5, z: -3 });
    expect(Object.values(positions.get(unplaced.id)!).every(Number.isFinite)).toBe(true);
    expect(getSpatialNode(explicit)?.position).not.toBe(positions.get(explicit.id));
  });

  it('gives directed diagrams stable depth including cycles and disconnected objects', () => {
    const graph = blankGraph('Dependencies', 'dependency');
    graph.nodes = Array.from({ length: 5 }, (_, i) =>
      newNode(graph.diagram.id, { title: `N${i}`, x: i * 300 }),
    );
    const [a, b, c, d, e] = graph.nodes;
    graph.edges = [
      newEdge(graph.diagram.id, a.id, b.id),
      newEdge(graph.diagram.id, c.id, b.id, { direction: 'backward' }),
      newEdge(graph.diagram.id, d.id, e.id),
      newEdge(graph.diagram.id, e.id, d.id),
    ];
    const positions = spatialPositions(graph);
    expect(positions.get(a.id)?.z).toBe(0);
    expect(positions.get(b.id)?.z).toBe(1.4);
    expect(positions.get(c.id)?.z).toBe(2.8);
    expect(
      [...positions.values()].every((point) => Object.values(point).every(Number.isFinite)),
    ).toBe(true);
    expect(
      spatialPositions({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(positions);
  });

  it('handles 12,000 deeply nested objects without recursion or unbounded depth', () => {
    const graph = blankGraph('Large hierarchy', 'dependency');
    for (let i = 0; i < 12_000; i++)
      graph.nodes.push(
        newNode(graph.diagram.id, {
          x: i * 2000,
          y: (i % 17) * 120,
          parentId: graph.nodes.at(-1)?.id,
        }),
      );
    const positions = spatialPositions(graph);
    const bounds = spatialBounds(positions.values());
    expect(positions.size).toBe(12_000);
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(spatialLimits.derivedExtent);
    expect(bounds.max.z).toBeCloseTo(spatialLimits.depth * 1.4);
    expect(
      [...positions.values()].every((point) => Object.values(point).every(Number.isFinite)),
    ).toBe(true);
    validateSpatialCamera(defaultSpatialCamera(bounds));
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

  it('illustrates a truck lifecycle with readable 2D branches and compact 3D stage clusters', () => {
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
    expect(
      graph.nodes.every((node) => !!node.description && !!getSpatialNode(node)?.position),
    ).toBe(true);
    expect(
      new Set(graph.nodes.map((node) => JSON.stringify(getSpatialNode(node)?.position))).size,
    ).toBe(25);
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
      expect(
        children.every(
          (node) => getSpatialNode(node)!.position!.z > getSpatialNode(stage)!.position!.z,
        ),
      ).toBe(true);
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
    expect(distance).toBeGreaterThan(projection.bounds.radius / Math.sin((21 * Math.PI) / 180));
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
