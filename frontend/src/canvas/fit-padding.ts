import type { FitViewOptions } from '@xyflow/react';

/** Ratio padding alone can leave short canvases underneath their floating tools. */
export function canvasFitPadding(
  padding: number,
  host?: HTMLElement | null,
): NonNullable<FitViewOptions['padding']> {
  if (!host) return padding;
  const tools = host.querySelector<HTMLElement>('.canvas-tools-panel');
  if (!tools) return padding;
  const canvas = host.getBoundingClientRect(),
    panel = tools.getBoundingClientRect();
  if (
    canvas.width <= 0 ||
    canvas.height <= 0 ||
    panel.width <= 0 ||
    panel.height <= 0 ||
    panel.top >= canvas.bottom ||
    panel.bottom <= canvas.top ||
    panel.left >= canvas.right ||
    panel.right <= canvas.left
  )
    return padding;
  // XYFlow interprets numbers as ratios; explicit pixels retain their size
  // regardless of canvas height. Keep all other sides and sufficient margins.
  const normalBottom = Math.floor((canvas.height - canvas.height / (1 + padding)) / 2);
  const safeBottom = Math.ceil(canvas.bottom - panel.top + 8);
  return safeBottom > normalBottom
    ? { top: padding, right: padding, bottom: `${safeBottom}px`, left: padding }
    : padding;
}
