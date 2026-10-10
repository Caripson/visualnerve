import type { RoomPolicy } from '../../../collaboration-worker/src/protocol';
import { decodeBytes } from './transport/identity';

export interface MlsDeviceCredential {
  deviceId: string;
  credentialId: string;
}
export interface MlsMemberInfo {
  deviceId: string;
  transportKeyFingerprint: string;
  signaturePublicKey: string;
  leafIndex: number;
}
export interface MlsGroupInfo {
  roomId: string;
  epoch: number;
  active: boolean;
  ownDeviceId: string;
  ownerDeviceId: string;
  members: MlsMemberInfo[];
}
export interface MlsCommit {
  commit: string;
  welcome: string | null;
  nextEpoch: number;
}
export interface MlsProcessResult {
  kind: 'application' | 'commit';
  senderDeviceId: string;
  senderSignaturePublicKey: string;
  epoch: number;
  payload?: Uint8Array;
  members?: MlsMemberInfo[];
}
export interface MlsWireProcessResult extends Omit<MlsProcessResult, 'payload' | 'members'> {
  payload: string | null;
  members: MlsMemberInfo[] | null;
}

/** Match authenticated MLS membership to an already verified owner-signed policy.
 * Transport authors and roles alone cannot establish the author of encrypted data.
 */
export function assertMlsPolicy(info: MlsGroupInfo, policy: RoomPolicy): void {
  if (
    !info.active ||
    info.roomId !== policy.roomId ||
    info.epoch !== policy.epoch ||
    info.ownerDeviceId !== policy.ownerDeviceId ||
    info.members.length !== policy.members.length ||
    policy.members.length > 32 ||
    policy.members.filter((member) => member.role === 'owner').length !== 1
  )
    throw new Error('The signed room policy does not match authenticated MLS state.');
  const ids = new Set<string>();
  for (const actual of info.members) {
    const approved = policy.members.find((member) => member.deviceId === actual.deviceId);
    if (
      ids.has(actual.deviceId) ||
      !approved ||
      approved.credentialId !== actual.transportKeyFingerprint ||
      approved.mlsSignatureKey !== actual.signaturePublicKey ||
      (approved.role === 'owner') !== (approved.deviceId === policy.ownerDeviceId) ||
      decodeBytes(actual.signaturePublicKey, 32).length !== 32
    )
      throw new Error('An MLS participant differs from the approved device identity.');
    ids.add(actual.deviceId);
  }
}

export function decodeMlsResult(result: MlsWireProcessResult): MlsProcessResult {
  if (
    !result ||
    !['application', 'commit'].includes(result.kind) ||
    !Number.isSafeInteger(result.epoch) ||
    result.epoch < 0 ||
    decodeBytes(result.senderSignaturePublicKey, 32).length !== 32
  )
    throw new Error('Invalid authenticated MLS result.');
  return {
    kind: result.kind,
    senderDeviceId: result.senderDeviceId,
    senderSignaturePublicKey: result.senderSignaturePublicKey,
    epoch: result.epoch,
    ...(result.payload !== null
      ? {
          payload:
            result.payload === '' ? new Uint8Array() : decodeBytes(result.payload, 64 * 1024),
        }
      : {}),
    ...(result.members ? { members: result.members } : {}),
  };
}
