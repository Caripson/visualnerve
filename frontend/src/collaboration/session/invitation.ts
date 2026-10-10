import { record, roomId, deviceId, decode } from '../../../../collaboration-worker/src/validation';
import { decodeBytes, encodeBytes } from '../transport/identity';
import { relayOrigin } from '../transport/room-transport';
import type { CollaborationShareScope } from '../document/scope';
export interface CollaborationInvitation {
  version: 1;
  roomId: string;
  diagramId: string;
  relay: string;
  ownerDeviceId: string;
  ownerCredential: string;
  ticket: string;
  expiresAt: number;
  scope: CollaborationShareScope;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** The fragment is never an HTTP URL parameter or a relay bearer credential. */
export function invitationUrl(invitation: CollaborationInvitation, origin: string): string {
  const url = new URL('/', origin);
  url.hash = `collaboration=${encodeBytes(new TextEncoder().encode(JSON.stringify(invitation)))}`;
  return url.href;
}
export function readInvitation(
  input: string,
  origin: string,
  configuredRelay: string,
): CollaborationInvitation {
  if (input.length > 8192) throw new Error('The invitation is invalid.');
  const url = new URL(input);
  if (
    url.origin !== origin ||
    url.pathname !== '/' ||
    url.search ||
    !url.hash.startsWith('#collaboration=')
  )
    throw new Error('Use an invitation for this workspace.');
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(decodeBytes(url.hash.slice(15), 4096)),
  );
  record(value, [
    'version',
    'roomId',
    'diagramId',
    'relay',
    'ownerDeviceId',
    'ownerCredential',
    'ticket',
    'expiresAt',
    'scope',
  ]);
  roomId(value.roomId);
  deviceId(value.ownerDeviceId);
  decode(value.ticket, 32, 32);
  record(value.scope, ['shareMetadata', 'shareOwners', 'shareDatasets']);
  if (
    value.version !== 1 ||
    !uuid.test(value.diagramId) ||
    !/^[a-f0-9]{64}$/.test(value.ownerCredential) ||
    relayOrigin(value.relay) !== relayOrigin(configuredRelay) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    value.expiresAt > Date.now() + 10 * 60_000 + 10_000 ||
    Object.values(value.scope).some((flag) => typeof flag !== 'boolean')
  )
    throw new Error('The invitation is expired or does not match the configured relay.');
  return value as CollaborationInvitation;
}
