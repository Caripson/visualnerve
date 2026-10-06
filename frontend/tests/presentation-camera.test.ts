import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  planPresentationFlight,
  pointInsideObstacle,
  presentationEase,
  presentationFlightFrames,
  presentationFocus,
  presentationObstacle,
  presentationPathClear,
  samplePresentationFlight,
  segmentIntersectsObstacle,
} from '../src/presentation/camera';

const box = (id = 'wall') =>
  presentationObstacle(id, { x: 0, y: 0, z: 0 }, { x: 6, y: 5, z: 0.14 });

describe('presentation camera collision routes', () => {
  it('tests the whole swept segment, including thin relief, grazing and endpoints', () => {
    const obstacle = box();
    expect(segmentIntersectsObstacle({ x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }, obstacle)).toBe(
      true,
    );
    expect(segmentIntersectsObstacle({ x: 3, y: -10, z: 0 }, { x: 3, y: 10, z: 0 }, obstacle)).toBe(
      true,
    );
    expect(segmentIntersectsObstacle({ x: 5, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, obstacle)).toBe(
      true,
    );
    expect(
      segmentIntersectsObstacle({ x: 3.05, y: -10, z: 0 }, { x: 3.05, y: 10, z: 0 }, obstacle, 0.1),
    ).toBe(true);
    expect(
      segmentIntersectsObstacle({ x: 4, y: -10, z: 0 }, { x: 4, y: 10, z: 0 }, obstacle, 0.1),
    ).toBe(false);
  });

  it('uses a direct safe segment without changing either endpoint or obstacles', () => {
    const from = { x: -8, y: 0, z: 4 },
      to = { x: 8, y: 0, z: 4 };
    const obstacles = [box()];
    const original = structuredClone({ from, to, obstacles });
    const path = planPresentationFlight(from, to, obstacles);
    expect(path).toEqual([from, to]);
    expect({ from, to, obstacles }).toEqual(original);
    expect(path[0]).not.toBe(from);
    expect(path[1]).not.toBe(to);
  });

  it('flies around the entire relief when travelling from the back to the front', () => {
    const from = { x: 0, y: 0, z: -8 },
      to = { x: 0, y: 0, z: 8 };
    const obstacles = [
      box(),
      presentationObstacle('behind', { x: 0, y: 1, z: -3 }, { x: 2, y: 2, z: 0.3 }),
    ];
    const path = planPresentationFlight(from, to, obstacles, 0.1);
    expect(path.length).toBeGreaterThan(2);
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    expect(presentationPathClear(path, obstacles, 0.1)).toBe(true);
    for (let index = 0; index <= 500; index++) {
      const sample = samplePresentationFlight(path, index / 500);
      expect(obstacles.some((obstacle) => pointInsideObstacle(sample, obstacle, 0.1))).toBe(false);
    }
  });

  it('does not skip safe corners when the browser drops most animation frames', () => {
    const obstacles = [box()];
    const from = { x: 0, y: 0, z: -8 },
      to = { x: 0, y: 0, z: 8 };
    const path = planPresentationFlight(from, to, obstacles, 0.1);
    const next = presentationFlightFrames(path);
    const frames = [from];
    let result = next(0.02);
    frames.push(result.position);
    for (let attempts = 0; !result.arrived && attempts < path.length + 2; attempts++) {
      result = next(1);
      frames.push(result.position);
    }
    expect(result.arrived).toBe(true);
    expect(result.position).toEqual(to);
    expect(presentationPathClear(frames, obstacles, 0.1)).toBe(true);
    for (const waypoint of path.slice(1, -1)) expect(frames).toContainEqual(waypoint);
  });

  it('includes complete world rotation, translation, nonuniform scale and relief depth', () => {
    const center = { x: 1, y: -2, z: 3 },
      dimensions = { x: 4, y: 2, z: 0.14 };
    const matrix = new Matrix4().compose(
      new Vector3(10, -4, 2),
      new Quaternion().setFromEuler(new Euler(0.3, Math.PI / 2, 0.5)),
      new Vector3(2, 0.5, 3),
    );
    const transformed = presentationObstacle('rotated', center, dimensions, matrix.elements);
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const point = new Vector3(
            center.x + (x * dimensions.x) / 2,
            center.y + (y * dimensions.y) / 2,
            center.z + (z * dimensions.z) / 2,
          ).applyMatrix4(matrix);
          expect(pointInsideObstacle(point, transformed, 1e-10)).toBe(true);
        }
    expect(transformed.max.z - transformed.min.z).toBeGreaterThan(6);
    const midpoint = new Vector3(center.x, center.y, center.z).applyMatrix4(matrix);
    const from = { x: midpoint.x, y: midpoint.y, z: transformed.min.z - 3 };
    const to = { x: midpoint.x, y: midpoint.y, z: transformed.max.z + 3 };
    const path = planPresentationFlight(from, to, [transformed], 0.1);
    expect(path.length).toBeGreaterThan(2);
    expect(presentationPathClear(path, [transformed], 0.1)).toBe(true);
  });

  it('refuses an unsafe starting camera or blocked destination instead of teleporting', () => {
    expect(() =>
      planPresentationFlight({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }, [box()]),
    ).toThrow(/Move it clear/);
    expect(() =>
      planPresentationFlight({ x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: 0 }, [box()]),
    ).toThrow(/no clear camera position/);
    expect(() =>
      planPresentationFlight({ x: NaN, y: 0, z: 8 }, { x: 0, y: 0, z: 8 }, [box()]),
    ).toThrow(/invalid/);
  });

  it('refuses a sealed cavity when no validated exit exists', () => {
    const walls = [
      presentationObstacle('left', { x: -3, y: 0, z: 0 }, { x: 0.2, y: 7, z: 7 }),
      presentationObstacle('right', { x: 3, y: 0, z: 0 }, { x: 0.2, y: 7, z: 7 }),
      presentationObstacle('top', { x: 0, y: 3, z: 0 }, { x: 7, y: 0.2, z: 7 }),
      presentationObstacle('bottom', { x: 0, y: -3, z: 0 }, { x: 7, y: 0.2, z: 7 }),
      presentationObstacle('front', { x: 0, y: 0, z: 3 }, { x: 7, y: 7, z: 0.2 }),
      presentationObstacle('back', { x: 0, y: 0, z: -3 }, { x: 7, y: 7, z: 0.2 }),
    ];
    expect(() => planPresentationFlight({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }, walls)).toThrow(
      /No safe camera route/,
    );
  });

  it('checks thousands of cards with a bounded number of route waypoints', () => {
    const obstacles = Array.from({ length: 8000 }, (_, index) =>
      presentationObstacle(
        `card-${index}`,
        { x: (index % 100) * 4, y: Math.floor(index / 100) * 3, z: 0 },
        { x: 2, y: 1, z: 0.14 },
      ),
    );
    const path = planPresentationFlight({ x: 0, y: 0, z: -5 }, { x: 396, y: 237, z: 5 }, obstacles);
    expect(path.length).toBeLessThanOrEqual(8);
    expect(presentationPathClear(path, obstacles, 0.08)).toBe(true);
  });

  it('clamps easing and has zero endpoint velocity without cutting around corners', () => {
    expect(presentationEase(-2)).toBe(0);
    expect(presentationEase(2)).toBe(1);
    expect(presentationEase(0.5)).toBeCloseTo(0.5);
    expect(presentationEase(0.0001) / 0.0001).toBeLessThan(0.000001);
    expect((1 - presentationEase(0.9999)) / 0.0001).toBeLessThan(0.000001);
  });

  it('accepts only bounded finite presentation camera requests', () => {
    const valid = { nodeId: 'one', transitionMs: 800, requestId: 4 };
    expect(presentationFocus(new CustomEvent('focus', { detail: valid }))).toEqual(valid);
    for (const patch of [
      { nodeId: '' },
      { transitionMs: NaN },
      { transitionMs: 30_001 },
      { transitionMs: -1 },
      { requestId: 1.2 },
    ])
      expect(
        presentationFocus(new CustomEvent('focus', { detail: { ...valid, ...patch } })),
      ).toBeUndefined();
  });
});
