import { StorageError } from './errors';

export const nodeBackgroundColorPattern = /^#[\da-f]{6}$/i;

/** The saved fill is independent of the accent; omission keeps the current theme. */
export function validateNodeBackgroundColor(value: unknown, path: string) {
  if (value === undefined || (typeof value === 'string' && nodeBackgroundColorPattern.test(value)))
    return;
  const message = 'Node backgroundColor must be a six-digit hex color (#RRGGBB).';
  throw Object.assign(new StorageError(422, message), {
    code: 'INVALID_NODE_BACKGROUND_COLOR',
    issues: [{ path, code: 'INVALID_NODE_BACKGROUND_COLOR', message }],
  });
}
