import { expect, it, vi } from 'vitest';
import type { ReactFlowInstance } from '@xyflow/react';
import type { CanvasNode } from '../src/canvas/projection';
import { attachCanvasPresentationCamera } from '../src/presentation/canvas-camera';
import {
  PRESENTATION_ARRIVED,
  PRESENTATION_FOCUS,
  presentationViewportKey,
} from '../src/presentation/camera';

function setup() {
  const transitions: { resolve: (value: boolean) => void; reject: (error: Error) => void }[] = [];
  const viewport = { x: 42, y: -88, zoom: 0.8 };
  const flow = {
    getNode: vi.fn((id: string) =>
      id === 'hidden' ? { hidden: true } : id === 'missing' ? undefined : { id },
    ),
    fitView: vi.fn(),
    getNodesBounds: vi.fn(() => ({ x: 100, y: 20, width: 200, height: 80 })),
    getViewport: vi.fn(() => viewport),
    setViewport: vi.fn((_viewport: typeof viewport, options?: { duration?: number }) =>
      options?.duration
        ? new Promise<boolean>((resolve, reject) => transitions.push({ resolve, reject }))
        : Promise.resolve(true),
    ),
  };
  const options = {
    transient: vi.fn(),
    select: vi.fn(),
    ignoreViewport: vi.fn(),
    viewportSize: vi.fn(() => ({ width: 800, height: 600 })),
  };
  const arrived = vi.fn();
  window.addEventListener(PRESENTATION_ARRIVED, arrived);
  const controller = attachCanvasPresentationCamera(
    flow as unknown as ReactFlowInstance<CanvasNode>,
    options,
  );
  const focus = (requestId = 1, nodeId = 'one') =>
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, { detail: { nodeId, transitionMs: 800, requestId } }),
    );
  const dispose = () => {
    controller.dispose();
    window.removeEventListener(PRESENTATION_ARRIVED, arrived);
  };
  return { flow, options, arrived, transitions, controller, viewport, focus, dispose };
}

it('waits for React Flow to complete before arrival and keeps viewport persistence suppressed', async () => {
  const { flow, options, arrived, transitions, controller, viewport, focus, dispose } = setup();
  try {
    focus();
    expect(options.select).toHaveBeenCalledWith('one');
    expect(options.transient).toHaveBeenLastCalledWith(true);
    expect(flow.getNodesBounds).toHaveBeenCalledWith(['one']);
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.setViewport).toHaveBeenCalledWith(
      { x: expect.closeTo(170, 6), y: 231, zoom: 1.15 },
      expect.objectContaining({ duration: 800, interpolate: 'linear' }),
    );
    expect(arrived).not.toHaveBeenCalled();
    transitions[0].resolve(true);
    await Promise.resolve();
    expect(arrived.mock.calls[0][0].detail).toEqual({ requestId: 1, nodeId: 'one' });
    expect(options.transient).toHaveBeenLastCalledWith(true);
    controller.cancel();
    expect(flow.setViewport).toHaveBeenLastCalledWith(viewport, { duration: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(options.transient).toHaveBeenLastCalledWith(false);
  } finally {
    dispose();
  }
});

it('remembers frozen tour provenance through a move-end deferred after cancellation', async () => {
  vi.useFakeTimers();
  const { flow, options, transitions, controller, viewport, focus, dispose } = setup();
  try {
    let transient = false;
    let saved = 0;
    const ignored = new Set<string>();
    options.transient.mockImplementation((value: boolean) => {
      transient = value;
    });
    options.ignoreViewport.mockImplementation((value: typeof viewport) =>
      ignored.add(presentationViewportKey(value)),
    );
    // React Flow queues its programmatic move-end on a later task, after setViewport resolves.
    flow.setViewport.mockImplementation((_viewport, options) => {
      if (options?.duration)
        return new Promise<boolean>((resolve, reject) => transitions.push({ resolve, reject }));
      setTimeout(() => {
        if (!transient && !ignored.has(presentationViewportKey(viewport))) saved++;
      }, 0);
      return Promise.resolve(true);
    });
    focus();
    transitions[0].resolve(true);
    await Promise.resolve();
    controller.cancel();
    await Promise.resolve();
    await Promise.resolve();
    expect(transient).toBe(false);
    expect(ignored.has(presentationViewportKey(viewport))).toBe(true);
    vi.runAllTimers();
    expect(saved).toBe(0);
    // The marker is retained even when workspace acknowledgements replace the controller.
    controller.dispose();
    await Promise.resolve();
    await Promise.resolve();
    vi.runAllTimers();
    expect(saved).toBe(0);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});
it('cancels before animation start without leaving a queued fit that can move or persist later', async () => {
  vi.useFakeTimers();
  const { flow, options, controller, viewport, focus, dispose } = setup();
  let live = { ...viewport },
    transient = false,
    saved = 0,
    animation: ReturnType<typeof setTimeout> | undefined,
    finish: ((value: boolean) => void) | undefined;
  const ignored = new Set<string>();
  const moveEnd = (target: typeof viewport) => {
    live = target;
    if (!transient && !ignored.has(presentationViewportKey(target))) saved++;
  };
  flow.getViewport.mockImplementation(() => live);
  options.transient.mockImplementation((value) => (transient = value));
  options.ignoreViewport.mockImplementation((target) =>
    ignored.add(presentationViewportKey(target)),
  );
  // React Flow's queued fit is independent of the current pan/zoom animation.
  // A zero-duration setViewport can cancel that animation, but not a queued fit.
  flow.fitView.mockImplementation(() => {
    setTimeout(() => moveEnd({ x: -482, y: 17.75, zoom: 1.15 }), 100);
    return Promise.resolve(true);
  });
  flow.setViewport.mockImplementation((target, options) => {
    clearTimeout(animation);
    finish?.(false);
    finish = undefined;
    if (options?.duration)
      return new Promise<boolean>((resolve) => {
        finish = resolve;
        animation = setTimeout(() => {
          moveEnd(target);
          finish = undefined;
          resolve(true);
        }, 100);
      });
    live = target;
    setTimeout(() => moveEnd(target), 0);
    return Promise.resolve(true);
  });
  try {
    focus();
    controller.cancel();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(transient).toBe(false);
    vi.runAllTimers();
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(live).toEqual(viewport);
    expect(saved).toBe(0);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});

it('replacement ignores stale completion and lets the newer camera request complete', async () => {
  const { arrived, transitions, focus, dispose } = setup();
  try {
    focus(1);
    focus(2, 'two');
    expect(arrived.mock.calls[0][0].detail).toMatchObject({
      requestId: 1,
      error: 'Camera movement replaced.',
    });
    transitions[0].resolve(true);
    await Promise.resolve();
    expect(arrived).toHaveBeenCalledOnce();
    transitions[1].resolve(true);
    await Promise.resolve();
    expect(arrived.mock.calls[1][0].detail).toEqual({ requestId: 2, nodeId: 'two' });
  } finally {
    dispose();
  }
});

it('hidden and missing objects report errors without changing the viewport or selection', () => {
  const { flow, options, arrived, focus, dispose } = setup();
  try {
    focus(1, 'hidden');
    focus(2, 'missing');
    expect(arrived).toHaveBeenCalledTimes(2);
    expect(
      arrived.mock.calls.every(([event]) => /hidden or unavailable/.test(event.detail.error)),
    ).toBe(true);
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.setViewport).not.toHaveBeenCalled();
    expect(options.select).not.toHaveBeenCalled();
    expect(options.transient).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it('cancelled and failed animations return an error and never announce a false arrival', async () => {
  const { arrived, transitions, controller, focus, dispose } = setup();
  try {
    focus(1);
    controller.cancel('Manual camera movement.', true);
    transitions[0].resolve(true);
    await Promise.resolve();
    expect(arrived).toHaveBeenCalledOnce();
    expect(arrived.mock.calls[0][0].detail.error).toBe('Manual camera movement.');
    focus(2);
    transitions[1].reject(new Error('Renderer gone.'));
    await Promise.resolve();
    await Promise.resolve();
    expect(arrived.mock.calls[1][0].detail.error).toBe('Renderer gone.');
  } finally {
    dispose();
  }
});

it('fits multiple canonical scene objects and selected links only after the reveal hook resolves', async () => {
  let visible = false,
    ready!: () => void;
  const flow = {
    getNode: vi.fn((id: string) => ({ id, hidden: !visible })),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    getNodesBounds: vi.fn(() => ({ x: 100, y: 20, width: 200, height: 80 })),
    setViewport: vi.fn(async () => true),
    fitView: vi.fn(async () => true),
  };
  const selectMany = vi.fn(),
    reveal = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          ready = () => {
            visible = true;
            resolve();
          };
        }),
    );
  const controller = attachCanvasPresentationCamera(
    flow as unknown as ReactFlowInstance<CanvasNode>,
    {
      transient: vi.fn(),
      select: vi.fn(),
      selectMany,
      reveal,
      viewportSize: () => ({ width: 800, height: 600 }),
    },
  );
  try {
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, {
        detail: {
          nodeId: 'one',
          nodeIds: ['one', 'two'],
          edgeIds: ['link'],
          requestId: 44,
          transitionMs: 500,
        },
      }),
    );
    expect(selectMany).toHaveBeenCalledWith(['one', 'two'], ['link']);
    expect(flow.fitView).not.toHaveBeenCalled();
    ready();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(flow.getNodesBounds).toHaveBeenCalledWith(['one', 'two']);
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.setViewport).toHaveBeenCalledWith(
      { x: expect.closeTo(170, 6), y: 231, zoom: 1.15 },
      expect.objectContaining({ duration: 500 }),
    );
  } finally {
    controller.dispose();
  }
});
it('fits absolute parent/child bounds supplied by React Flow and rejects an unmounted viewport', async () => {
  const { flow, options, transitions, arrived, focus, dispose } = setup();
  flow.getNodesBounds.mockReturnValue({ x: 1500, y: -20, width: 600, height: 200 });
  try {
    focus(1, 'nested-child');
    const target = flow.setViewport.mock.calls[0][0];
    expect(flow.getNodesBounds).toHaveBeenCalledWith(['nested-child']);
    expect(target.x + 1800 * target.zoom).toBeCloseTo(400);
    expect(target.y + 80 * target.zoom).toBeCloseTo(300);
    expect(target.zoom).toBeGreaterThanOrEqual(0.05);
    expect(target.zoom).toBeLessThanOrEqual(1.15);
    transitions[0].resolve(true);
    await Promise.resolve();
    options.viewportSize.mockReturnValue({ width: 0, height: 600 });
    focus(2, 'another-child');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(arrived.mock.calls.at(-1)![0].detail.error).toContain('viewport is not ready');
    expect(flow.fitView).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it('captures and restores an exact saved 2D storyboard view transiently', async () => {
  const { flow, options, arrived, transitions, dispose } = setup();
  const { capturePresentationView } = await import('../src/presentation/camera');
  try {
    expect(await capturePresentationView()).toEqual({
      mode: '2d',
      viewport: { x: 42, y: -88, zoom: 0.8 },
    });
    const viewport = { x: 230, y: -50, zoom: 0.55 };
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, {
        detail: {
          nodeId: 'one',
          nodeIds: ['one', 'two'],
          requestId: 45,
          transitionMs: 500,
          view: { mode: '2d', viewport },
        },
      }),
    );
    transitions[0].resolve(true);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.setViewport).toHaveBeenCalledWith(
      viewport,
      expect.objectContaining({ duration: 500 }),
    );
    expect(options.ignoreViewport).toHaveBeenCalled();
    expect(arrived.mock.calls.at(-1)![0].detail).toEqual({ nodeId: 'one', requestId: 45 });
  } finally {
    dispose();
  }
});

it('rejects a saved 3D view on a 2D renderer without moving it', () => {
  const { flow, arrived, dispose } = setup();
  try {
    window.dispatchEvent(
      new CustomEvent(PRESENTATION_FOCUS, {
        detail: {
          nodeId: 'one',
          requestId: 46,
          transitionMs: 100,
          view: {
            mode: '3d',
            camera: { position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 } },
          },
        },
      }),
    );
    expect(arrived.mock.calls[0][0].detail.error).toMatch(/Switch to 3D/);
    expect(flow.fitView).not.toHaveBeenCalled();
    expect(flow.setViewport).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
