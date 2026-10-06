import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NavigationGizmo } from '../src/spatial/NavigationGizmo';

function pointer(element: Element, type: string, x: number, y: number, pointerId = 4) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}

it('offers keyboard navigation for each mode and axis with precise and faster increments', () => {
  const navigate = vi.fn();
  const finish = vi.fn();
  render(<NavigationGizmo onNavigate={navigate} onGestureEnd={finish} />);
  expect(screen.getByRole('button', { name: 'Rotate view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const rotateY = screen.getByRole('button', { name: 'Rotate view around Y axis' });
  fireEvent.keyDown(rotateY, { key: 'ArrowRight' });
  fireEvent.keyDown(rotateY, { key: 'ArrowUp', shiftKey: true });
  expect(navigate.mock.calls).toEqual([
    ['rotate', 'y', { x: 8, y: 0 }],
    ['rotate', 'y', { x: 0, y: -24 }],
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Move view' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move view along X axis' }), {
    key: 'ArrowLeft',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Scale view' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Scale view freely' }), { key: 'Enter' });
  expect(navigate.mock.calls.slice(2)).toEqual([
    ['move', 'x', { x: -8, y: 0 }],
    ['scale', 'free', { x: 8, y: 0 }],
  ]);
  expect(finish).toHaveBeenCalledTimes(4);
  expect(screen.getByText('Drag to zoom the view')).toBeVisible();
});

it('captures an axis drag, sends incremental movement and flushes once on cancellation', () => {
  const navigate = vi.fn();
  const finish = vi.fn();
  render(<NavigationGizmo onNavigate={navigate} onGestureEnd={finish} />);
  const control = screen.getByRole('button', { name: 'Rotate view around Y axis' });
  const capture = vi.fn();
  const release = vi.fn();
  Object.assign(control, {
    focus: vi.fn(),
    setPointerCapture: capture,
    hasPointerCapture: () => true,
    releasePointerCapture: release,
  });
  pointer(control, 'pointerdown', 120, 90);
  pointer(control, 'pointermove', 132, 94);
  pointer(control, 'pointermove', 129, 99);
  pointer(control, 'pointermove', 500, 500, 7);
  expect(capture).toHaveBeenCalledWith(4);
  expect(navigate.mock.calls).toEqual([
    ['rotate', 'y', { x: 12, y: 4 }],
    ['rotate', 'y', { x: -3, y: 5 }],
  ]);
  pointer(control, 'pointercancel', 129, 99);
  fireEvent.lostPointerCapture(control);
  pointer(control, 'pointermove', 135, 100);
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith(4);
});

it('projects the colored handles with camera orientation, including saved roll', () => {
  const navigate = vi.fn();
  const camera = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } };
  const { rerender } = render(<NavigationGizmo camera={camera} onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move view' }));
  const x = screen.getByTestId('spatial-gizmo-grab-x');
  const y = screen.getByTestId('spatial-gizmo-grab-y');
  expect(Number(x.getAttribute('cx'))).toBeCloseTo(121);
  expect(Number(y.getAttribute('cy'))).toBeCloseTo(19);
  const rolledCamera = { ...camera, up: { x: 1, y: 0, z: 0 } };
  rerender(<NavigationGizmo camera={rolledCamera} onNavigate={navigate} />);
  expect(Number(x.getAttribute('cx'))).toBeCloseTo(78);
  expect(Number(x.getAttribute('cy'))).toBeCloseTo(19);
  expect(Number(y.getAttribute('cx'))).toBeCloseTo(35);
  expect(navigate).not.toHaveBeenCalled();
});

it('prevents interactions while 3D is unavailable and closes an active gesture when disabled', () => {
  const navigate = vi.fn();
  const finish = vi.fn();
  const { rerender } = render(<NavigationGizmo onNavigate={navigate} onGestureEnd={finish} />);
  const control = screen.getByRole('button', { name: 'Rotate view around X axis' });
  Object.assign(control, { focus: vi.fn(), setPointerCapture: vi.fn() });
  pointer(control, 'pointerdown', 10, 10);
  rerender(<NavigationGizmo disabled onNavigate={navigate} onGestureEnd={finish} />);
  fireEvent.keyDown(control, { key: 'ArrowRight' });
  pointer(control, 'pointermove', 20, 10);
  expect(screen.getByRole('button', { name: 'Move view' })).toBeDisabled();
  expect(control).toHaveAttribute('aria-disabled', 'true');
  expect(control).toHaveAttribute('tabindex', '-1');
  expect(navigate).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledTimes(1);
});
