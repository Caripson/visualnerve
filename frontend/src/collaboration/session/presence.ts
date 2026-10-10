import { record } from '../../../../collaboration-worker/src/validation';
export interface PresenceMessage {
  name: string;
  selectedNodeIds: string[];
  pointer?: { x: number; y: number };
  actor: 'human' | 'mcp';
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
  record(value, ['name', 'selectedNodeIds', 'actor'], ['pointer']);
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
  return value as PresenceMessage;
}
