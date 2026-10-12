import type { CSSProperties } from 'react';
import { topicInk } from '../ui/colors';

/** Only a saved solid color replaces the node's theme or mind-map branch fill. */
export function nodeBackgroundColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : undefined;
}

export function nodeBackgroundStyle(value: unknown): CSSProperties {
  const background = nodeBackgroundColor(value);
  if (!background) return {};
  const ink = topicInk(background);
  return {
    '--node-bg': background,
    '--text': ink,
    '--muted': ink,
    '--subtle': ink,
    // Embedded table headers and custom status badges share the same contrast.
    '--surface': background,
    '--surface-alt': `color-mix(in srgb, ${ink} 8%, ${background})`,
  } as CSSProperties;
}
