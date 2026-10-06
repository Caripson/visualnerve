import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SpatialCamera } from '../src/spatial/types';
import { attachSpatialPresentationCamera } from '../src/presentation/spatial-camera';
import {
  PRESENTATION_ARRIVED,
  PRESENTATION_FOCUS,
  presentationObstacle,
  presentationPathClear,
} from '../src/presentation/camera';

let clock = 0;
let frameId = 0;
let frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  clock = frameId = 0;
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function tick(ms: number) {
  clock += ms;
  const current = [...frames.values()];
  frames.clear();
  current.forEach((callback) => callback(clock));
}
function setup() {
  const root = new THREE.Group();
  const card = (id: string, position: THREE.Vector3, dimensions: THREE.Vector3) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    root.add(mesh);
    return [id, { mesh, position, dimensions, color: new THREE.Color(), index: 0 }] as const;
  };
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.01, 1000);
  camera.position.set(0, 0, 8);
  const controls = { target: new THREE.Vector3(), enabled: true } as OrbitControls;
  const canvas = document.createElement('canvas');
  const positions: { x: number; y: number; z: number }[] = [];
  const runtime = {
    camera,
    controls,
    root,
    renderer: { domElement: canvas } as THREE.WebGLRenderer,
    batches: { nodes: new Map([card('one', new THREE.Vector3(), new THREE.Vector3(2, 1, 0.14))]) },
    glyphScale: 1,
    bounds: { radius: 8 },
    presentationActive: false,
    cancelPresentation: (_reason?: string, _manual?: boolean) => {},
    abortMovement: vi.fn(),
    flushCamera: vi.fn(),
    refreshFaces: vi.fn(),
    draw: vi.fn(() =>
      positions.push({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
    ),
    setCamera: vi.fn((value: SpatialCamera, _persist?: boolean, _presentation?: boolean) => {
      camera.position.set(value.position.x, value.position.y, value.position.z);
      controls.target.set(value.target.x, value.target.y, value.target.z);
      if (value.up) camera.up.set(value.up.x, value.up.y, value.up.z);
    }),
  };
  const options = {
    unavailable: () => false,
    visible: (id: string) => runtime.batches.nodes.has(id),
    select: vi.fn(),
    syncCameraAttributes: vi.fn(),
    obstacles: vi.fn(() =>
      [...runtime.batches.nodes].map(([nodeId, node]) =>
        presentationObstacle(
          nodeId,
          node.position,
          node.dimensions,
          node.mesh.matrixWorld.elements,
        ),
      ),
    ),
  };
  const arrived = vi.fn();
  window.addEventListener(PRESENTATION_ARRIVED, arrived);
  const detach = attachSpatialPresentationCamera(runtime, options);
  const dispose = () => {
    detach();
    window.removeEventListener(PRESENTATION_ARRIVED, arrived);
    for (const node of runtime.batches.nodes.values()) {
      node.mesh.geometry.dispose();
      (node.mesh.material as THREE.Material).dispose();
      node.mesh.dispose();
    }
  };
  const focus = (requestId = 1, nodeId = 'one') =>
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, { detail: { nodeId, transitionMs: 800, requestId } }),
    );
  return { runtime, canvas, positions, options, arrived, dispose, focus, card };
}

it('completes after the final camera frame and keeps the tour transient without a persisted camera', () => {
  const { runtime, canvas, options, arrived, dispose, focus } = setup();
  try {
    focus();
    expect(options.select).toHaveBeenCalledWith('one');
    expect(runtime.flushCamera).toHaveBeenCalledOnce();
    expect(arrived).not.toHaveBeenCalled();
    tick(0);
    expect(options.obstacles).toHaveBeenCalledOnce();
    expect(runtime.presentationActive).toBe(true);
    expect(runtime.controls.enabled).toBe(false);
    tick(400);
    expect(runtime.camera.position.z).toBeLessThan(8);
    expect(arrived).not.toHaveBeenCalled();
    tick(400);
    expect(arrived).not.toHaveBeenCalled();
    tick(16);
    expect(arrived).toHaveBeenCalledOnce();
    expect(arrived.mock.calls[0][0].detail).toEqual({ nodeId: 'one', requestId: 1 });
    expect(runtime.controls.enabled).toBe(true);
    expect(runtime.presentationActive).toBe(true);
    expect(canvas.dataset.presentationMoving).toBe('false');
    expect(runtime.setCamera).toHaveBeenLastCalledWith(expect.anything(), false, true);
    expect(runtime.refreshFaces).toHaveBeenCalledOnce();
    expect(runtime.setCamera.mock.calls.every(([, persist]) => persist !== true)).toBe(true);
  } finally {
    dispose();
  }
});

it('replacement and explicit cancellation stop earlier requests and leave a frozen camera pose', () => {
  const { runtime, arrived, dispose, focus } = setup();
  try {
    focus(1);
    tick(0);
    tick(300);
    const paused = runtime.camera.position.clone();
    focus(2);
    expect(arrived.mock.calls[0][0].detail).toMatchObject({
      requestId: 1,
      error: 'Camera movement replaced.',
    });
    runtime.cancelPresentation();
    expect(arrived.mock.calls[1][0].detail).toMatchObject({
      requestId: 2,
      error: 'Camera movement cancelled.',
    });
    tick(2000);
    expect(arrived).toHaveBeenCalledTimes(2);
    expect(runtime.camera.position.distanceTo(paused)).toBeLessThan(1e-9);
    expect(runtime.controls.enabled).toBe(true);
    expect(runtime.presentationActive).toBe(false);
  } finally {
    dispose();
  }
});

it('reports hidden nodes and unsafe starting cameras without changing camera coordinates', () => {
  const { runtime, arrived, dispose, focus } = setup();
  try {
    focus(1, 'missing');
    expect(arrived.mock.calls[0][0].detail.error).toMatch(/hidden or unavailable/);
    runtime.camera.position.set(0, 0, 0.01);
    const original = runtime.camera.position.clone();
    focus(2);
    tick(0);
    expect(arrived.mock.calls[1][0].detail.error).toMatch(/too close/);
    expect(runtime.camera.position.equals(original)).toBe(true);
    expect(runtime.draw).not.toHaveBeenCalled();
    expect(runtime.controls.enabled).toBe(true);
  } finally {
    dispose();
  }
});

it('follows validated swept segments around intervening relief even after dropped frames', () => {
  const { runtime, positions, arrived, dispose, focus, card } = setup();
  try {
    const [id, wall] = card('wall', new THREE.Vector3(0, 0, -3), new THREE.Vector3(6, 5, 0.14));
    runtime.batches.nodes.set(id, wall);
    runtime.camera.position.set(0, 0, -8);
    runtime.controls.target.set(0, 0, -20);
    positions.push({ x: 0, y: 0, z: -8 });
    focus();
    tick(0);
    for (let attempts = 0; !arrived.mock.calls.length && attempts < 12; attempts++) tick(1000);
    expect(arrived.mock.calls[0][0].detail.error).toBeUndefined();
    const obstacles = [...runtime.batches.nodes].map(([nodeId, node]) =>
      presentationObstacle(nodeId, node.position, node.dimensions),
    );
    expect(presentationPathClear(positions, obstacles, 0.08)).toBe(true);
    expect(positions.length).toBeGreaterThan(3);
    expect(runtime.camera.position.z).toBeGreaterThan(0);
  } finally {
    dispose();
  }
});

it('checks complete collision geometry once, including obstacles that are not resident meshes', () => {
  const { runtime, positions, options, arrived, dispose, focus } = setup();
  try {
    const complete = [
      presentationObstacle('one', { x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 0.14 }),
      presentationObstacle('nonresident-blocker', { x: 0, y: 0, z: -3 }, { x: 6, y: 5, z: 0.14 }),
    ];
    options.obstacles.mockReturnValue(complete);
    runtime.camera.position.set(0, 0, -8);
    runtime.controls.target.set(0, 0, -20);
    positions.push({ x: 0, y: 0, z: -8 });
    focus();
    tick(0);
    for (let attempts = 0; !arrived.mock.calls.length && attempts < 12; attempts++) tick(1000);
    expect(arrived.mock.calls[0][0].detail.error).toBeUndefined();
    expect(options.obstacles).toHaveBeenCalledOnce();
    expect(runtime.batches.nodes.has('nonresident-blocker')).toBe(false);
    expect(presentationPathClear(positions, complete, 0.08)).toBe(true);
  } finally {
    dispose();
  }
});

it('fits a multi-node storyboard scene and highlights its selected links', () => {
  const { runtime, options, dispose, card, arrived } = setup();
  const selection = options as typeof options & { selectMany?: ReturnType<typeof vi.fn> };
  selection.selectMany = vi.fn();
  const entry = card('two', new THREE.Vector3(8, 3, 0), new THREE.Vector3(2, 1, 0.14));
  runtime.batches.nodes.set(...entry);
  try {
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, {
        detail: {
          nodeId: 'one',
          nodeIds: ['one', 'two'],
          edgeIds: ['link'],
          requestId: 90,
          transitionMs: 800,
        },
      }),
    );
    expect(selection.selectMany).toHaveBeenCalledWith(['one', 'two'], ['link']);
    tick(0);
    tick(800);
    tick(16);
    expect(runtime.controls.target.x).toBeCloseTo(4);
    expect(runtime.controls.target.y).toBeCloseTo(1.5);
    expect(arrived.mock.calls.at(-1)![0].detail.error).toBeUndefined();
    expect(runtime.setCamera.mock.calls.every(([, persist]) => persist !== true)).toBe(true);
  } finally {
    dispose();
  }
});

it('captures and flies to a saved 3D storyboard camera without writing the canonical camera', async () => {
  const { runtime, dispose, arrived } = setup();
  const { capturePresentationView } = await import('../src/presentation/camera');
  try {
    expect(await capturePresentationView()).toMatchObject({
      mode: '3d',
      camera: { position: { x: 0, y: 0, z: 8 }, target: { x: 0, y: 0, z: 0 } },
    });
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, {
        detail: {
          nodeId: 'one',
          requestId: 91,
          transitionMs: 800,
          view: {
            mode: '3d',
            camera: {
              position: { x: 4, y: 3, z: 7 },
              target: { x: 0.2, y: 0.1, z: 0 },
              up: { x: 1, y: 0, z: 0 },
            },
          },
        },
      }),
    );
    tick(0);
    tick(800);
    tick(16);
    expect(runtime.camera.position.toArray()).toEqual([4, 3, 7]);
    expect(runtime.controls.target.x).toBeCloseTo(0.2);
    expect(runtime.controls.target.y).toBeCloseTo(0.1);
    expect(arrived.mock.calls.at(-1)![0].detail.error).toBeUndefined();
    expect(runtime.setCamera.mock.calls.every(([, persist]) => persist !== true)).toBe(true);
  } finally {
    dispose();
  }
});
