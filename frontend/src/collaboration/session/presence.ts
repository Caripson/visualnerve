import { record } from '../../../../collaboration-worker/src/validation';
export interface PresenceMessage {
  name: string;
  selectedNodeIds: string[];
  pointer?: { x: number; y: number };
  actor: 'human' | 'mcp';
  /** Only the approved owner may announce these ephemeral device/profile associations. */
  profileBindings?: Record<string, string>;
}
export function displayName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error('Enter a display name of 1–80 characters.');
  return name;
}
export function presenceMessage(bytes: Uint8Array): PresenceMessage {
  if (bytes.length > 8192) throw new Error('The presence message exceeds its limit.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  record(value, ['name', 'selectedNodeIds', 'actor'], ['pointer', 'profileBindings']);
  displayName(value.name);
  if (
    !Array.isArray(value.selectedNodeIds) ||
    value.selectedNodeIds.length > 100 ||
    value.selectedNodeIds.some((id: unknown) => typeof id !== 'string' || id.length > 128) ||
    !['human', 'mcp'].includes(value.actor)
  )
    throw new Error('Invalid collaboration presence.');
  if (value.pointer !== undefined) {
    record(value.pointer, ['x', 'y']);
    if (
      ![value.pointer.x, value.pointer.y].every(
        (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e8,
      )
    )
      throw new Error('Invalid collaboration pointer.');
  }
  if (value.profileBindings !== undefined) {
    const bindings = value.profileBindings;
    const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
    if (
      !bindings ||
      typeof bindings !== 'object' ||
      Array.isArray(bindings) ||
      Object.keys(bindings).length > 32 ||
      Object.entries(bindings).some(
        ([device, profile]) =>
          !uuid.test(device) || typeof profile !== 'string' || !uuid.test(profile),
      )
    )
      throw new Error('Invalid document profile associations.');
  }
  return value as PresenceMessage;
}
