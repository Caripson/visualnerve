import { MOUSE } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const keyboardControls =
  'input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable="false"]),' +
  '[role="textbox"],[role="button"],[role="slider"],[role="dialog"],[data-node-scroll]';

/** A temporary camera gesture shared by orbit and object-movement modes. */
export class SpatialPanShortcut {
  active = false;
  private pointer?: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly controls: () => Pick<OrbitControls, 'mouseButtons'>,
    private readonly available: () => boolean,
    private readonly pointerBusy: () => boolean,
  ) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('focusin', this.focus);
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    canvas.addEventListener('pointerup', this.pointerEnd, true);
    canvas.addEventListener('pointercancel', this.pointerEnd, true);
    canvas.addEventListener('lostpointercapture', this.pointerEnd);
  }

  syncControls(): void {
    // Camera roll recreates OrbitControls. Retain the held shortcut on the new instance.
    this.controls().mouseButtons.LEFT = this.active ? MOUSE.PAN : MOUSE.ROTATE;
    this.canvas.dataset.panHeld = String(this.active);
  }

  reset = (): void => {
    this.active = false;
    this.syncControls();
    const pointerId = this.pointer;
    this.pointer = undefined;
    this.canvas.dataset.panDragging = 'false';
    // End OrbitControls' captured gesture when the tab loses focus, even if no mouseup arrives.
    if (pointerId !== undefined)
      this.canvas.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId, pointerType: 'mouse', bubbles: true }),
      );
  };

  destroy(): void {
    this.reset();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('focusin', this.focus);
    this.canvas.removeEventListener('pointerdown', this.pointerDown, true);
    this.canvas.removeEventListener('pointerup', this.pointerEnd, true);
    this.canvas.removeEventListener('pointercancel', this.pointerEnd, true);
    this.canvas.removeEventListener('lostpointercapture', this.pointerEnd);
  }

  private blocked(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(keyboardControls);
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (this.active || this.pointer !== undefined)) {
      event.preventDefault();
      this.reset();
      return;
    }
    if (
      event.code !== 'Space' ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this.blocked(event.target) ||
      document.querySelector('[role="dialog"][aria-modal="true"]') ||
      !this.available() ||
      (!this.active && this.pointerBusy())
    )
      return;
    event.preventDefault();
    this.active = true;
    this.syncControls();
  };

  private keyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || !this.active) return;
    this.active = false;
    this.syncControls();
  };

  private pointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0 || event.pointerType === 'touch') return;
    // OrbitControls reverses pan/rotate for modifiers added after Space was pressed.
    this.controls().mouseButtons.LEFT =
      event.ctrlKey || event.metaKey || event.shiftKey ? MOUSE.ROTATE : MOUSE.PAN;
    this.pointer = event.pointerId;
    this.canvas.dataset.panDragging = 'true';
    this.canvas.focus({ preventScroll: true });
  };

  private pointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    this.pointer = undefined;
    this.canvas.dataset.panDragging = 'false';
    this.syncControls();
  };

  private visibility = (): void => {
    if (document.hidden) this.reset();
  };

  private focus = (event: FocusEvent): void => {
    if (this.blocked(event.target)) this.reset();
  };
}
