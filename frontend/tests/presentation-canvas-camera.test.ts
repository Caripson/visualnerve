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
    fitView: vi.fn(
      () => new Promise<boolean>((resolve, reject) => transitions.push({ resolve, reject })),
    ),
    getViewport: vi.fn(() => viewport),
    setViewport: vi.fn(() => Promise.resolve(true)),
  };
  const options = { transient: vi.fn(), select: vi.fn(), ignoreViewport: vi.fn() };
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
    expect(flow.fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: 'one' }], duration: 800, interpolate: 'linear' }),
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
    flow.setViewport.mockImplementation(() => {
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
