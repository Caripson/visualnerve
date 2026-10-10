import type {
  DeviceIdentity,
  SignedCommand,
  SignedRoomPolicy,
  RoomMember,
} from '../../../../collaboration-worker/src/protocol';
import { canonical } from '../../../../collaboration-worker/src/protocol';
import {
  signedPolicy,
  sameIdentity,
  record,
  decode,
  deviceId,
} from '../../../../collaboration-worker/src/validation';
import { relayLimits } from '../../../../collaboration-worker/src/protocol';
import { credentialId, verifyTransportSignature } from './identity';

/** Server admission is not proof of identity. Every browser verifies the pinned owner. */
export async function verifyRoomPolicy(
  input: unknown,
  roomId: string,
  pinnedOwnerCredential: string,
  previous?: SignedRoomPolicy,
): Promise<SignedRoomPolicy> {
  const value = signedPolicy(input);
  if (value.policy.roomId !== roomId) throw new Error('The room policy belongs to another room.');
  const owner = value.policy.members.find((member) => member.role === 'owner')!;
  if (
    value.policy.revision !== value.policy.epoch + 1 ||
    (value.policy.epoch === 0 && value.policy.transition !== null) ||
    (value.policy.epoch > 0 && value.policy.transition?.previousEpoch !== value.policy.epoch - 1)
  )
    throw new Error('The room policy has an invalid group transition.');
  if (
    owner.credentialId !== pinnedOwnerCredential ||
    !(await verifyTransportSignature(owner, 'policy', value.policy, value.signature))
  )
    throw new Error('The room owner identity could not be verified.');
  for (const member of value.policy.members)
    if ((await credentialId(member.signingKey)) !== member.credentialId)
      throw new Error('A participant identity is invalid.');
  if (
    new Set(value.policy.members.map((member) => member.credentialId)).size !==
      value.policy.members.length ||
    new Set(value.policy.members.map((member) => member.mlsSignatureKey)).size !==
      value.policy.members.length
  )
    throw new Error('Participant devices must have distinct cryptographic identities.');
  if (previous) {
    const before = previous.policy;
    if (
      value.policy.ownerDeviceId !== before.ownerDeviceId ||
      value.policy.revision < before.revision ||
      value.policy.epoch < before.epoch ||
      (value.policy.revision === before.revision && canonical(value.policy) !== canonical(before))
    )
      throw new Error('The room policy was replayed or changed without a new revision.');
    for (const member of value.policy.members) {
      const retained = before.members.find((prior) => prior.deviceId === member.deviceId);
      if (retained && !sameIdentity(retained, member))
        throw new Error('A participant cryptographic identity changed without a fresh admission.');
    }
  }
  return value;
}

export async function verifyPeerCommand(
  command: SignedCommand,
  policy: SignedRoomPolicy,
): Promise<RoomMember> {
  const member = policy.policy.members.find((value) => value.deviceId === command.deviceId);
  if (
    !member ||
    command.type !== 'command' ||
    command.protocol !== 1 ||
    command.roomId !== policy.policy.roomId ||
    command.epoch !== policy.policy.epoch ||
    !Number.isSafeInteger(command.sequence) ||
    command.sequence < 1 ||
    typeof command.connectionId !== 'string' ||
    command.connectionId.length > 128
  )
    throw new Error('The collaboration message is not from an approved participant.');
  record(command, [
    'type',
    'protocol',
    'roomId',
    'connectionId',
    'deviceId',
    'sequence',
    'epoch',
    'body',
    'signature',
  ]);
  const body = record(command.body, ['kind', 'payloadKind', 'ciphertext'], ['recipient']);
  if (
    body.kind !== 'relay' ||
    !['application', 'presence', 'snapshot', 'sync-request'].includes(String(body.payloadKind))
  )
    throw new Error('Unexpected peer command.');
  decode(body.ciphertext, relayLimits.ciphertextBytes);
  if (body.recipient !== undefined) deviceId(body.recipient);
  if (member.role === 'viewer' && !['presence', 'sync-request'].includes(String(body.payloadKind)))
    throw new Error('A read-only participant attempted to change the shared document.');
  const { signature, ...unsigned } = command;
  if (!(await verifyTransportSignature(member, 'command', unsigned, signature)))
    throw new Error('The collaboration message signature is invalid.');
  return member;
}

export async function binaryHash(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
