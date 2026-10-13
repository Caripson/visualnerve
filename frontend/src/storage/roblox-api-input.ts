import { RobloxError } from '../roblox/errors';

export function gameObject(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new RobloxError(422, 'Provide a JSON game object.', 'ROBLOX_INVALID_REQUEST');
  if (
    Object.keys(value).some(
      (key) =>
        ['__proto__', 'constructor', 'prototype'].includes(key) || (keys && !keys.includes(key)),
    )
  )
    throw new RobloxError(
      422,
      `Unexpected game field${keys ? `; accepted fields: ${keys.join(', ')}` : ''}.`,
      'ROBLOX_INVALID_REQUEST',
    );
  return value as Record<string, unknown>;
}
export function gameVersion(value: unknown): number {
  if (value === undefined)
    throw new RobloxError(428, 'Provide the current baseVersion.', 'VERSION_REQUIRED');
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new RobloxError(422, 'baseVersion must be a positive integer.', 'ROBLOX_INVALID_REQUEST');
  return value as number;
}
export function gameQuery(url: URL, keys: string[] = []) {
  if (
    url.hash ||
    [...url.searchParams.keys()].some((key) => !keys.includes(key)) ||
    keys.some((key) => url.searchParams.getAll(key).length > 1)
  )
    throw new RobloxError(
      422,
      'Unknown or repeated game query parameter.',
      'ROBLOX_INVALID_REQUEST',
    );
}
export function gameInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new RobloxError(
      422,
      `Provide an integer between ${min} and ${max}.`,
      'ROBLOX_INVALID_REQUEST',
    );
  return Number(value);
}
/** Arrays replace as complete values. Partial objects may clear optional fields with null. */
export function mergeGameValue(
  previous: unknown,
  patch: unknown,
  options: { preserveNulls?: boolean } = {},
  depth = 0,
): unknown {
  if (depth > 20)
    throw new RobloxError(422, 'The game patch is too deeply nested.', 'ROBLOX_INVALID_REQUEST');
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === 'object') {
    const object = gameObject(patch);
    const output =
      previous && typeof previous === 'object' && !Array.isArray(previous)
        ? { ...gameObject(previous) }
        : {};
    for (const [key, value] of Object.entries(object)) {
      if (value === null && !options.preserveNulls) delete output[key];
      else output[key] = mergeGameValue(output[key], value, options, depth + 1);
    }
    return output;
  }
  return patch;
}
export function boundedGameResponse<T>(value: T): T {
  if (value === undefined) return value;
  if (new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024)
    throw new RobloxError(
      413,
      'This game response exceeds 512 KiB. Read paginated collections or artifact chunks.',
      'ROBLOX_TRANSPORT_LIMIT',
    );
  return value;
}
