import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { navigateSpatialCamera } from '../src/spatial/navigation';
import { orientationCamera } from '../src/spatial/layout';
import {
  setSpatialView,
  getSpatialView,
  validateSpatialCamera,
  spatialLimits,
  type SpatialCamera,
} from '../src/spatial/types';
import { blankGraph, newNode } from '../src/model/types';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';

const front: SpatialCamera = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } };
const vector = (point: { x: number; y: number; z: number }) =>
  new Vector3(point.x, point.y, point.z);
const distance = (camera: SpatialCamera) =>
  vector(camera.position).distanceTo(vector(camera.target));

describe('view navigation preserves the diagram coordinate system', () => {
  it('keeps a full quarter-turn after Z roll valid and carries the up frame with the view', () => {
    let camera = navigateSpatialCamera(front, 'rotate', 'z', { x: Math.PI / (2 * 0.012), y: 0 });
    for (let step = 0; step < 9; step++) {
      camera = navigateSpatialCamera(camera, 'rotate', 'y', { x: Math.PI / (18 * 0.012), y: 0 });
      validateSpatialCamera(camera);
    }
    expect(camera.position.x).toBeCloseTo(10, 8);
    expect(camera.position.z).toBeCloseTo(0, 8);
    const direction = vector(camera.position).sub(vector(camera.target)).normalize();
    expect(Math.abs(direction.dot(vector(camera.up!)))).toBeLessThan(1e-12);
  });

  it('rotates a named Top view with an orthogonal, portable up frame', () => {
    const top = orientationCamera('top');
    for (const axis of ['x', 'y', 'z', 'free'] as const) {
      const camera = navigateSpatialCamera(top, 'rotate', axis, { x: 18, y: 10 });
      validateSpatialCamera(camera);
      const direction = vector(camera.position).sub(vector(camera.target)).normalize();
      expect(Math.abs(direction.dot(vector(camera.up!)))).toBeLessThan(1e-12);
      expect(distance(camera)).toBeCloseTo(distance(top), 8);
    }
  });
  it.each(['x', 'y', 'z'] as const)(
    'rotates around the %s axis at a fixed target and distance',
    (axis) => {
      const before = structuredClone(front);
      const result = navigateSpatialCamera(front, 'rotate', axis, {
        x: Math.PI / (2 * 0.012),
        y: 0,
      });
      expect(front).toEqual(before);
      expect(result.target).toEqual(front.target);
      expect(distance(result)).toBeCloseTo(10, 10);
      validateSpatialCamera(result);
      if (axis === 'z') {
        expect(result.position).toEqual(front.position);
        expect(result.up!.x).toBeCloseTo(-1, 10);
        expect(result.up!.y).toBeCloseTo(0, 10);
      } else {
        expect(vector(result.position).distanceTo(vector(front.position))).toBeGreaterThan(10);
      }
    },
  );

  it('keeps a rolled view coherent through free rotation, pan and zoom', () => {
    const rolled = navigateSpatialCamera(front, 'rotate', 'z', { x: 32, y: 0 });
    const turned = navigateSpatialCamera(rolled, 'rotate', 'free', { x: 45, y: 21 });
    const moved = navigateSpatialCamera(turned, 'move', 'free', { x: -31, y: 18 }, 600);
    const scaled = navigateSpatialCamera(moved, 'scale', 'free', { x: 0, y: -42 });
    for (const camera of [rolled, turned, moved, scaled]) validateSpatialCamera(camera);
    expect(distance(turned)).toBeCloseTo(distance(front), 10);
    const positionOffset = vector(moved.position).sub(vector(turned.position));
    const targetOffset = vector(moved.target).sub(vector(turned.target));
    expect(positionOffset.distanceTo(targetOffset)).toBeLessThan(1e-12);
    expect(vector(moved.up!).distanceTo(vector(turned.up!))).toBeLessThan(1e-12);
    expect(vector(scaled.up!).distanceTo(vector(moved.up!))).toBeLessThan(1e-12);
    expect(scaled.target).toEqual(moved.target);
    expect(distance(scaled)).toBeLessThan(distance(moved));
    expect(
      vector(scaled.position)
        .sub(vector(scaled.target))
        .normalize()
        .distanceTo(vector(moved.position).sub(vector(moved.target)).normalize()),
    ).toBeLessThan(1e-12);
  });

  it('constrains axis pan to its world axis and keeps position-target unchanged', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const result = navigateSpatialCamera(front, 'move', axis, { x: 25, y: 13 });
      expect(Math.abs(result.target[axis])).toBeGreaterThan(0);
      for (const other of ['x', 'y', 'z'] as const)
        if (axis !== other) expect(result.target[other]).toBe(front.target[other]);
      expect(vector(result.position).sub(vector(result.target)).toArray()).toEqual([0, 0, 10]);
    }
  });

  it('bounds pan and zoom at the coordinate edge without deforming the camera direction', () => {
    const edge: SpatialCamera = {
      position: { x: spatialLimits.cameraCoordinate - 1, y: 0, z: 10 },
      target: { x: spatialLimits.cameraCoordinate - 1, y: 0, z: 0 },
    };
    const moved = navigateSpatialCamera(edge, 'move', 'x', { x: -400, y: 0 }, 320);
    expect(moved.target.x).toBe(spatialLimits.cameraCoordinate);
    expect(moved.position.x).toBe(spatialLimits.cameraCoordinate);
    expect(distance(moved)).toBeCloseTo(10, 10);
    for (const [mode, axis] of [
      ['rotate', 'y'],
      ['scale', 'free'],
      ['move', 'free'],
    ] as const) {
      const result = navigateSpatialCamera(moved, mode, axis, { x: -400, y: -400 }, 320);
      validateSpatialCamera(result);
    }
    let close = front;
    for (let index = 0; index < 6; index++)
      close = navigateSpatialCamera(close, 'scale', 'free', { x: 400, y: 0 });
    expect(distance(close)).toBeCloseTo(0.2, 10);
  });

  it('ignores invalid and empty gesture events', () => {
    for (const delta of [
      { x: 0, y: 0 },
      { x: NaN, y: 1 },
      { x: 0, y: Infinity },
    ])
      expect(navigateSpatialCamera(front, 'rotate', 'free', delta)).toBe(front);
  });
});

describe('camera roll is portable and validated', () => {
  it.each([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: NaN, y: 1, z: 0 },
  ])('rejects an invalid up vector %j', (up) => {
    expect(() => validateSpatialCamera({ ...front, up })).toThrow();
  });

  it('retains roll in JSON imports, database reload and complete backups, rejecting invalid writes atomically', async () => {
    const db = new WorkspaceDatabase(`spatial-navigation-${crypto.randomUUID()}`);
    const repo = new Repository(db);
    await db.initialize();
    try {
      let graph = blankGraph('Camera roll');
      graph.nodes = [
        newNode(graph.diagram.id, { title: 'Original card', x: 230, y: 120, color: '#d7e7ec' }),
      ];
      const camera = navigateSpatialCamera(front, 'rotate', 'z', { x: 25, y: 0 });
      graph = setSpatialView(graph, { mode: '3d', camera });
      const stored = await repo.importGraph(JSON.parse(JSON.stringify(graph)));
      expect(getSpatialView(stored).camera).toEqual(camera);
      const backup = await db.backup();
      db.close();
      await db.open();
      expect(getSpatialView(await repo.getGraph(stored.diagram.id)).camera).toEqual(camera);
      const before = await repo.getGraph(stored.diagram.id);
      await expect(
        repo.request(`/diagrams/${stored.diagram.id}`, 'PATCH', {
          version: before.diagram.version,
          settings: {
            spatialView: {
              version: 1,
              mode: '3d',
              camera: { ...camera, up: { x: 0, y: 0, z: 0 } },
            },
          },
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(await repo.getGraph(stored.diagram.id)).toEqual(before);
      const restored = await repo.restore(backup, 'replace');
      expect(getSpatialView(restored[0]).camera).toEqual(camera);
      expect(restored[0].nodes).toEqual(stored.nodes);
    } finally {
      await db.delete();
    }
  });
});
