import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewport } from '@xyflow/react';
import { CanvasTouchViewportGesture } from '../src/canvas/touch-viewport-gesture';

const gestures: CanvasTouchViewportGesture[] = [];
afterEach(() => {
  gestures.splice(0).forEach((gesture) => gesture.destroy());
  document.body.replaceChildren();
});

function fixture() {
  const surface = document.createElement('div');
  surface.innerHTML = '<div class="vn-node nopan"><span class="node-title">Node</span></div>';
  document.body.append(surface);
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
    left: 30,
    top: 70,
    width: 400,
    height: 600,
  } as DOMRect);
  let camera: Viewport = { x: -20, y: 10, zoom: 0.8 };
  const setViewport = vi.fn((viewport: Viewport) => {
    camera = viewport;
  });
  const gesture = new CanvasTouchViewportGesture(surface, {
    getViewport: () => camera,
    setViewport,
  });
  gestures.push(gesture);
  const node = surface.querySelector<HTMLElement>('.vn-node')!;
  const title = surface.querySelector<HTMLElement>('.node-title')!;
  const point = (identifier: number, x: number, y = 170, target: Element = title) =>
    ({
      identifier,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 1,
      target,
    }) satisfies Touch;
  return { surface, node, title, point, setViewport, camera: () => camera, gesture };
}

function dispatch(
  target: Element,
  type: string,
  touches: Touch[],
  changedTouches: Touch[] = touches,
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperties(event, {
    touches: { value: touches },
    targetTouches: { value: touches },
    changedTouches: { value: changedTouches },
  });
  target.dispatchEvent(event);
  return event;
}

describe('2D canvas touch ownership', () => {
  it('zooms around the moving midpoint in canvas coordinates, accounting for the top bar', () => {
    const f = fixture();
    const first = f.point(1, 80),
      second = f.point(2, 180);
    dispatch(f.title, 'touchstart', [first, second]);
    const initial = f.camera();
    const world = {
      x: (130 - 30 - initial.x) / initial.zoom,
      y: (170 - 70 - initial.y) / initial.zoom,
    };
    dispatch(f.title, 'touchmove', [f.point(1, 70, 190), f.point(2, 230, 190)]);
    const zoomed = f.camera();
    expect(zoomed.zoom).toBeCloseTo(initial.zoom * 1.6);
    expect((150 - 30 - zoomed.x) / zoomed.zoom).toBeCloseTo(world.x);
    expect((190 - 70 - zoomed.y) / zoomed.zoom).toBeCloseTo(world.y);
    // Native movement is based on the start frame rather than compounding scale per event.
    dispatch(f.title, 'touchmove', [f.point(1, 70, 190), f.point(2, 230, 190)]);
    expect(f.camera()).toEqual(zoomed);
  });

  it('ends an existing one-finger drag before takeover and suppresses the remaining finger', () => {
    const f = fixture();
    const start = vi.fn(),
      move = vi.fn(),
      cancel = vi.fn();
    f.node.addEventListener('touchstart', (event) => {
      start();
      event.stopImmediatePropagation();
    });
    f.node.addEventListener('touchmove', move);
    f.node.addEventListener('touchcancel', cancel);
    const first = f.point(1, 80),
      second = f.point(2, 180);
    expect(dispatch(f.title, 'touchstart', [first]).defaultPrevented).toBe(false);
    dispatch(f.title, 'touchstart', [first, second], [second]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((cancel.mock.calls[0][0] as TouchEvent).touches).toHaveLength(0);
    dispatch(f.title, 'touchmove', [f.point(1, 60), f.point(2, 200)]);
    expect(move).not.toHaveBeenCalled();
    const camera = f.camera();
    dispatch(f.title, 'touchend', [first], [second]);
    expect(dispatch(f.title, 'touchmove', [f.point(1, 300)]).defaultPrevented).toBe(true);
    expect(f.camera()).toEqual(camera);
    dispatch(f.title, 'touchend', [], [first]);
    expect(dispatch(f.title, 'touchstart', [first]).defaultPrevented).toBe(false);
    dispatch(f.title, 'touchmove', [f.point(1, 90)]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('preserves native one-finger reading and takes over a pinch on scrollable node content', () => {
    const f = fixture();
    const scroll = document.createElement('div');
    scroll.className = 'code-object-scroll nodrag nopan nowheel';
    scroll.dataset.nodeScroll = '';
    f.node.append(scroll);
    const reading = vi.fn();
    scroll.addEventListener('touchmove', reading);
    const first = f.point(1, 80, 170, scroll),
      second = f.point(2, 180, 170, scroll);
    expect(dispatch(scroll, 'touchstart', [first]).defaultPrevented).toBe(false);
    expect(dispatch(scroll, 'touchmove', [first]).defaultPrevented).toBe(false);
    expect(reading).toHaveBeenCalledTimes(1);
    expect(f.setViewport).not.toHaveBeenCalled();
    dispatch(scroll, 'touchstart', [first, second], [second]);
    dispatch(scroll, 'touchmove', [f.point(1, 50, 170, scroll), f.point(2, 210, 170, scroll)]);
    expect(f.camera().zoom).toBeGreaterThan(0.8);
    expect(reading).toHaveBeenCalledTimes(1);
  });

  it('cancels a resize handle before viewport movement without a synthetic multi-touch drag', () => {
    const f = fixture();
    const handle = document.createElement('div');
    handle.className = 'react-flow__resize-control handle';
    f.node.append(handle);
    const cancel = vi.fn(),
      move = vi.fn();
    handle.addEventListener('touchcancel', cancel);
    handle.addEventListener('touchmove', move);
    const first = f.point(1, 80, 170, handle),
      second = f.point(2, 180);
    dispatch(handle, 'touchstart', [first]);
    dispatch(f.title, 'touchstart', [first, second], [second]);
    expect(cancel).toHaveBeenCalledTimes(1);
    dispatch(handle, 'touchmove', [f.point(1, 50, 170, handle), f.point(2, 210)]);
    expect(move).not.toHaveBeenCalled();
    expect(f.camera().zoom).toBeGreaterThan(0.8);
  });

  it('clamps zoom and keeps the midpoint anchor stable at both limits', () => {
    const f = fixture();
    dispatch(f.title, 'touchstart', [f.point(1, 80), f.point(2, 180)]);
    for (const [spread, expected] of [
      [10000, 3],
      [0.001, 0.05],
    ]) {
      dispatch(f.title, 'touchmove', [f.point(1, 130 - spread / 2), f.point(2, 130 + spread / 2)]);
      expect(f.camera().zoom).toBe(expected);
      expect((100 - f.camera().x) / f.camera().zoom).toBeCloseTo(150);
      expect((100 - f.camera().y) / f.camera().zoom).toBeCloseTo(112.5);
    }
  });

  it('does not resume a pinch if a new finger reuses a released identifier before all fingers lift', () => {
    const f = fixture();
    const first = f.point(1, 80),
      second = f.point(2, 180);
    dispatch(f.title, 'touchstart', [first, second]);
    dispatch(f.title, 'touchmove', [f.point(1, 50), f.point(2, 210)]);
    const camera = f.camera();
    dispatch(f.title, 'touchend', [first], [second]);
    expect(dispatch(f.title, 'touchstart', [first, second], [second]).defaultPrevented).toBe(true);
    dispatch(f.title, 'touchmove', [f.point(1, 30), f.point(2, 230)]);
    expect(f.camera()).toEqual(camera);
    dispatch(f.title, 'touchend', [], [first, second]);
    dispatch(f.title, 'touchstart', [first, second]);
    dispatch(f.title, 'touchmove', [f.point(1, 70), f.point(2, 190)]);
    expect(f.camera().zoom).toBeCloseTo(camera.zoom * 1.2);
  });

  it.each(['button', 'input', '.react-flow__panel', '.react-flow__handle', '.drawing-surface'])(
    'does not intercept a gesture touching %s or an unrelated surface',
    (selector) => {
      const f = fixture();
      const control = document.createElement(selector.startsWith('.') ? 'div' : selector);
      if (selector.startsWith('.')) control.className = selector.slice(1);
      f.surface.append(control);
      expect(
        dispatch(f.title, 'touchstart', [f.point(1, 80), f.point(2, 180, 170, control)])
          .defaultPrevented,
      ).toBe(false);
      const outside = document.createElement('div');
      document.body.append(outside);
      expect(
        dispatch(f.title, 'touchstart', [f.point(1, 80), f.point(2, 180, 170, outside)])
          .defaultPrevented,
      ).toBe(false);
      expect(f.setViewport).not.toHaveBeenCalled();
    },
  );

  it('releases listeners and touch ownership when a document or 3D view replaces the canvas', () => {
    const f = fixture();
    dispatch(f.title, 'touchstart', [f.point(1, 80), f.point(2, 180)]);
    f.gesture.destroy();
    expect(dispatch(f.title, 'touchmove', [f.point(1, 50), f.point(2, 210)]).defaultPrevented).toBe(
      false,
    );
    expect(f.setViewport).not.toHaveBeenCalled();
  });
});
