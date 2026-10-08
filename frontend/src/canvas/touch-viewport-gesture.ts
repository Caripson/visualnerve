import type { Viewport } from '@xyflow/react';

export const canvasZoomRange = { min: 0.05, max: 3 } as const;

type Point = { x: number; y: number };
type Frame = {
  ids: [number, number];
  distance: number;
  anchor: Point;
  viewport: Viewport;
};
type ViewportAccess = {
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport) => void;
};

const fixedControls =
  'button,a,input,textarea,select,[contenteditable="true"],[role="dialog"],' +
  '.react-flow__panel,.react-flow__controls,.react-flow__minimap,' +
  '.react-flow__node-toolbar,.react-flow__handle,.drawing-surface';

function midpoint(first: Touch, second: Touch, bounds: DOMRect): Point {
  return {
    x: (first.clientX + second.clientX) / 2 - bounds.left,
    y: (first.clientY + second.clientY) / 2 - bounds.top,
  };
}

function distance(first: Touch, second: Touch): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

/** Two fingers own the viewport, even when React Flow's node drag/nopan consumes one finger. */
export class CanvasTouchViewportGesture {
  private owned = false;
  private cancelling = false;
  private frame: Frame | null = null;

  constructor(
    private readonly surface: HTMLElement,
    private readonly viewport: ViewportAccess,
  ) {
    const options = { capture: true, passive: false };
    surface.addEventListener('touchstart', this.start, options);
    surface.addEventListener('touchmove', this.move, options);
    surface.addEventListener('touchend', this.end, options);
    surface.addEventListener('touchcancel', this.end, options);
  }

  destroy(): void {
    this.surface.removeEventListener('touchstart', this.start, true);
    this.surface.removeEventListener('touchmove', this.move, true);
    this.surface.removeEventListener('touchend', this.end, true);
    this.surface.removeEventListener('touchcancel', this.end, true);
    this.owned = false;
    this.frame = null;
  }

  private consume(event: TouchEvent): void {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  private eligible(touch: Touch): boolean {
    const target = touch.target;
    return (
      target instanceof Element && this.surface.contains(target) && !target.closest(fixedControls)
    );
  }

  private cancelSingleTouch(touches: Touch[]): void {
    // End the existing d3 drag/resize/pan before changing the camera. In particular,
    // do not send a multi-touch move: XYDrag aborts it without stopping its auto-pan.
    const targets = new Map<EventTarget, Touch[]>();
    for (const touch of touches) {
      const group = targets.get(touch.target) ?? [];
      group.push(touch);
      targets.set(touch.target, group);
    }
    this.cancelling = true;
    try {
      for (const [target, changedTouches] of targets) {
        // Event + read-only touch lists also works in browsers without Touch constructors.
        const cancel = new Event('touchcancel', { bubbles: true, cancelable: true });
        Object.defineProperties(cancel, {
          touches: { value: [] },
          targetTouches: { value: [] },
          changedTouches: { value: changedTouches },
        });
        target.dispatchEvent(cancel);
      }
    } finally {
      this.cancelling = false;
    }
  }

  private start = (event: TouchEvent): void => {
    if (this.cancelling) return;
    if (this.owned) {
      this.consume(event);
      return;
    }
    const touches = Array.from(event.touches);
    if (touches.length < 2 || !touches.every((touch) => this.eligible(touch))) return;
    this.owned = true;
    this.consume(event);
    this.cancelSingleTouch(touches);
    const [first, second] = touches;
    const viewport = this.viewport.getViewport();
    const center = midpoint(first, second, this.surface.getBoundingClientRect());
    this.frame = {
      ids: [first.identifier, second.identifier],
      distance: Math.max(1, distance(first, second)),
      anchor: {
        x: (center.x - viewport.x) / viewport.zoom,
        y: (center.y - viewport.y) / viewport.zoom,
      },
      viewport,
    };
  };

  private move = (event: TouchEvent): void => {
    if (this.cancelling || !this.owned) return;
    this.consume(event);
    const frame = this.frame;
    if (!frame || event.touches.length < 2) return;
    const touches = Array.from(event.touches);
    const first = touches.find((touch) => touch.identifier === frame.ids[0]);
    const second = touches.find((touch) => touch.identifier === frame.ids[1]);
    if (!first || !second) return;
    const zoom = Math.max(
      canvasZoomRange.min,
      Math.min(
        canvasZoomRange.max,
        (frame.viewport.zoom * distance(first, second)) / frame.distance,
      ),
    );
    const center = midpoint(first, second, this.surface.getBoundingClientRect());
    this.viewport.setViewport({
      x: center.x - frame.anchor.x * zoom,
      y: center.y - frame.anchor.y * zoom,
      zoom,
    });
  };

  private end = (event: TouchEvent): void => {
    if (this.cancelling || !this.owned) return;
    this.consume(event);
    // The remaining finger must not resume a node drag/scroll with stale coordinates.
    if (event.touches.length < 2) this.frame = null;
    if (event.touches.length === 0) {
      this.owned = false;
    }
  };
}
