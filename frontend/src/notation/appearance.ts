import type { CSSProperties } from 'react';
import { nodeBackgroundColor, nodeBackgroundStyle } from '../nodes/appearance';
import type { NotationGeometry } from './types';

/** Labels on open frames or outside a filled glyph use the canvas's text contrast. */
export function notationTitleHasFill(geometry: NotationGeometry, container = false): boolean {
  if (container || geometry.outlineFill !== 'background') return false;
  const x = geometry.contentBox.x + geometry.contentBox.width / 2;
  const y = geometry.contentBox.y + geometry.contentBox.height / 2;
  let inside = false;
  const outline = geometry.outline;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function notationBackgroundStyle(value: unknown, titleHasFill: boolean): CSSProperties {
  if (titleHasFill) return nodeBackgroundStyle(value);
  // Keep the saved paint for the glyph while inheriting readable canvas text and editing surfaces.
  const background = nodeBackgroundColor(value);
  return (background ? { '--node-bg': background } : {}) as CSSProperties;
}
