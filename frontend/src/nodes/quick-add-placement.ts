import { useLayoutEffect, useRef, useState } from 'react';

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Offset {
  x: number;
  y: number;
  occluded?: true;
}

const floatingPanels = '.react-flow__panel, .react-flow__minimap, .selection-tools';

/** A NodeToolbar uses screen pixels, independently of its node's canvas zoom. */
export class QuickAddPlacement {
  readonly margin = 8;

  offset(trigger: Bounds, canvas: Bounds, panels: Bounds[] = []): Offset {
    const left = canvas.left + this.margin,
      top = canvas.top + this.margin;
    const right = canvas.left + canvas.width - this.margin - trigger.width,
      bottom = canvas.top + canvas.height - this.margin - trigger.height;
    const clampX = (value: number) => Math.max(left, Math.min(value, right)),
      clampY = (value: number) => Math.max(top, Math.min(value, bottom));
    const obstacles = panels.filter((panel) => panel.width > 0 && panel.height > 0);
    const xs = new Set([clampX(trigger.left), left, clampX(right)]),
      ys = new Set([clampY(trigger.top), top, clampY(bottom)]);
    for (const panel of obstacles) {
      xs.add(clampX(panel.left - this.margin - trigger.width));
      xs.add(clampX(panel.left + panel.width + this.margin));
      ys.add(clampY(panel.top - this.margin - trigger.height));
      ys.add(clampY(panel.top + panel.height + this.margin));
    }
    let best: { x: number; y: number; overlap: number; distance: number } | undefined;
    for (const x of xs)
      for (const y of ys) {
        const overlap = obstacles.reduce(
          (sum, panel) =>
            sum +
            Math.max(
              0,
              Math.min(x + trigger.width, panel.left + panel.width + this.margin) -
                Math.max(x, panel.left - this.margin),
            ) *
              Math.max(
                0,
                Math.min(y + trigger.height, panel.top + panel.height + this.margin) -
                  Math.max(y, panel.top - this.margin),
              ),
          0,
        );
        const distance = (x - trigger.left) ** 2 + (y - trigger.top) ** 2;
        const candidate = { x, y, overlap: overlap < 1e-6 ? 0 : overlap, distance };
        if (
          !best ||
          candidate.overlap < best.overlap ||
          (candidate.overlap === best.overlap && candidate.distance < best.distance)
        )
          best = candidate;
      }
    return {
      x: best!.x - trigger.left,
      y: best!.y - trigger.top,
      ...(best!.overlap > 0 ? { occluded: true as const } : {}),
    };
  }
}

interface FloatingPlacement extends Bounds {
  maxWidth: number;
}

/** Correct only the control; XYFlow retains an untransformed node anchor. */
export function useQuickAddPlacement(enabled: boolean, id: string, above: boolean) {
  const anchor = useRef<HTMLDivElement>(null);
  const [control, setControl] = useState<HTMLDivElement | null>(null);
  const [floating, setFloating] = useState<FloatingPlacement | null>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    const toolbar = element?.closest<HTMLElement>('.react-flow__node-toolbar');
    const canvas = element?.closest<HTMLElement>('.react-flow');
    if (!enabled || !element || !control || !toolbar || !canvas) return;
    const placement = new QuickAddPlacement();
    const observedPanels = new Set<Element>();
    const resize =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => place());
    const place = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const maxWidth = Math.max(1, bounds.width - placement.margin * 2);
      control.style.maxWidth = `${maxWidth}px`;
      const current = control.getBoundingClientRect();
      if (current.width <= 0 || current.height <= 0) return;
      const inline = element.contains(control);
      if (!inline) {
        // Keep NodeToolbar's percentage transform and above/below anchor intact
        // when only its control is portaled out of the renderer stacking context.
        element.style.width = `${current.width}px`;
        element.style.height = `${current.height}px`;
      }
      const origin = element.getBoundingClientRect();
      const panels = new Set(
        [...canvas.querySelectorAll<HTMLElement>(floatingPanels)].filter(
          (panel) => !panel.parentElement?.closest(floatingPanels),
        ),
      );
      for (const panel of observedPanels)
        if (!panels.has(panel as HTMLElement)) {
          resize?.unobserve(panel);
          observedPanels.delete(panel);
        }
      for (const panel of panels)
        if (!observedPanels.has(panel)) {
          resize?.observe(panel);
          observedPanels.add(panel);
        }
      const offset = placement.offset(
        {
          left: origin.left,
          top: origin.top,
          width: current.width,
          height: current.height,
        },
        bounds,
        [...panels].map((panel) => panel.getBoundingClientRect()),
      );
      if (inline) control.style.translate = `${offset.x}px ${offset.y}px`;
      const next = offset.occluded
        ? {
            left: origin.left + offset.x,
            top: origin.top + offset.y,
            width: current.width,
            height: current.height,
            maxWidth,
          }
        : null;
      setFloating((previous) =>
        previous?.left === next?.left &&
        previous?.top === next?.top &&
        previous?.width === next?.width &&
        previous?.height === next?.height &&
        previous?.maxWidth === next?.maxWidth
          ? previous
          : next,
      );
    };
    place();
    // Panels can appear/move without resizing the canvas. Ignore unrelated
    // per-particle/node mutations; panel measurements remain in screen pixels.
    const movement = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.target === toolbar ||
            (record.target instanceof Element && !!record.target.closest(floatingPanels)) ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(floatingPanels) || node.querySelector(floatingPanels)),
            ),
        )
      )
        place();
    });
    movement.observe(canvas, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      childList: true,
      subtree: true,
    });
    resize?.observe(canvas);
    resize?.observe(element);
    resize?.observe(control);
    window.addEventListener('resize', place);
    return () => {
      movement.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', place);
      control.style.translate = '';
      control.style.maxWidth = '';
      element.style.width = '';
      element.style.height = '';
    };
  }, [enabled, id, above, control]);
  return { anchor, control: setControl, floating };
}
