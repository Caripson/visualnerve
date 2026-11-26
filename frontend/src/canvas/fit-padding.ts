import type { FitViewOptions } from '@xyflow/react';

/** Keep the fitted diagram clear of the floating tools and fixed rulers. */
export function canvasFitPadding(
  padding: number,
  host?: HTMLElement | null,
): NonNullable<FitViewOptions['padding']> {
  if (!host) return padding;
  const canvas = host.getBoundingClientRect();
  if (canvas.width <= 0 || canvas.height <= 0) return padding;
  const panel = host.querySelector('.canvas-tools-panel')?.getBoundingClientRect();
  const topRuler = host
    .querySelector('.canvas-ruler[data-axis="horizontal"]')
    ?.getBoundingClientRect();
  const leftRuler = host
    .querySelector('.canvas-ruler[data-axis="vertical"]')
    ?.getBoundingClientRect();
  const selection = topRuler?.height
    ? host.querySelector('.selection-panel.top')?.getBoundingClientRect()
    : undefined;
  const bottom =
    panel &&
    panel.width > 0 &&
    panel.height > 0 &&
    panel.top < canvas.bottom &&
    panel.bottom > canvas.top &&
    panel.left < canvas.right &&
    panel.right > canvas.left
      ? canvas.bottom - panel.top + 8
      : 0;
  const top = Math.max(
    topRuler?.height ? topRuler.height + 8 : 0,
    selection?.height && selection.top >= canvas.top && selection.bottom < canvas.bottom
      ? selection.bottom - canvas.top + 8
      : 0,
  );
  const left = leftRuler?.width ? leftRuler.width + 8 : 0;
  // XYFlow interprets numbers as ratios; explicit pixels retain their size
  // regardless of canvas size. Keep a ratio where it already leaves enough space.
  const space = (size: number, minimum: number): number | `${number}px` =>
    minimum > Math.floor((size - size / (1 + padding)) / 2) ? `${Math.ceil(minimum)}px` : padding;
  const fitted = {
    top: space(canvas.height, top),
    right: padding,
    bottom: space(canvas.height, bottom),
    left: space(canvas.width, left),
  };
  return fitted.top === padding && fitted.bottom === padding && fitted.left === padding
    ? padding
    : fitted;
}
