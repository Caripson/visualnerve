import { afterEach, expect, it, vi } from 'vitest';
import { MOUSE } from 'three';
import { SpatialPanShortcut } from '../src/spatial/pan-shortcut';

let shortcut: SpatialPanShortcut | undefined;
afterEach(() => {
  shortcut?.destroy();
  shortcut = undefined;
  document.body.replaceChildren();
});

function setup() {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.append(canvas);
  let controls = { mouseButtons: { LEFT: MOUSE.ROTATE } };
  const available = vi.fn(() => true);
  const busy = vi.fn(() => false);
  shortcut = new SpatialPanShortcut(canvas, () => controls, available, busy);
  return {
    canvas,
    available,
    busy,
    controls: () => controls,
    recreateControls: () => {
      controls = { mouseButtons: { LEFT: MOUSE.ROTATE } };
      shortcut!.syncControls();
    },
  };
}
function space(target: EventTarget = window, type = 'keydown', init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent(type, {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

it('temporarily pans from a focused canvas or body, survives camera roll and restores rotation', () => {
  const f = setup();
  f.canvas.focus();
  expect(space(f.canvas).defaultPrevented).toBe(true);
  expect(f.controls().mouseButtons.LEFT).toBe(MOUSE.PAN);
  f.recreateControls();
  expect(f.controls().mouseButtons.LEFT).toBe(MOUSE.PAN);
  space(window, 'keyup');
  expect(f.controls().mouseButtons.LEFT).toBe(MOUSE.ROTATE);
  f.canvas.blur();
  space(document.body);
  expect(shortcut!.active).toBe(true);
});

it.each(['input', 'textarea', 'select', 'button', 'a', 'summary', 'contenteditable'])(
  'leaves Space available to %s controls and cancels a held shortcut when they gain focus',
  (tag) => {
    const f = setup();
    const field = document.createElement(tag === 'contenteditable' ? 'div' : tag);
    field.tabIndex = 0;
    if (tag === 'contenteditable') field.setAttribute('contenteditable', '');
    document.body.append(field);
    expect(space(field).defaultPrevented).toBe(false);
    expect(shortcut!.active).toBe(false);
    space();
    expect(shortcut!.active).toBe(true);
    field.focus();
    expect(shortcut!.active).toBe(false);
    expect(f.controls().mouseButtons.LEFT).toBe(MOUSE.ROTATE);
  },
);

it('does not start while editing, dragging, in a modal, or with another keyboard shortcut', () => {
  const f = setup();
  f.available.mockReturnValue(false);
  expect(space().defaultPrevented).toBe(false);
  f.available.mockReturnValue(true);
  f.busy.mockReturnValue(true);
  expect(space().defaultPrevented).toBe(false);
  f.busy.mockReturnValue(false);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])
    expect(space(window, 'keydown', { [modifier]: true }).defaultPrevented).toBe(false);
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.append(modal);
  expect(space().defaultPrevented).toBe(false);
  expect(shortcut!.active).toBe(false);
});

it.each(['blur', 'escape', 'hidden', 'destroy'])(
  'ends a captured camera gesture on %s so a missed keyup cannot leave navigation stuck',
  (cause) => {
    const f = setup();
    const cancel = vi.fn();
    f.canvas.addEventListener('pointercancel', cancel);
    space();
    f.canvas.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'mouse', button: 0 }),
    );
    expect(f.canvas.dataset.panDragging).toBe('true');
    if (cause === 'blur') window.dispatchEvent(new Event('blur'));
    if (cause === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (cause === 'hidden') {
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      hidden.mockRestore();
    }
    if (cause === 'destroy') shortcut!.destroy();
    expect(shortcut!.active).toBe(false);
    expect(f.canvas.dataset.panDragging).toBe('false');
    expect(f.controls().mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel.mock.calls[0][0].pointerId).toBe(7);
  },
);
