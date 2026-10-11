import type {
  DeviceIdentity,
  SignedCommand,
  SignedRoomPolicy,
  RoomMember,
  PendingJoin,
} from '../../../../collaboration-worker/src/protocol';
import { admissionInput, canonical } from '../../../../collaboration-worker/src/protocol';
import {
  RelayError,
  signedPolicy,
  sameIdentity,
  record,
  decode,
  deviceId,
  relayPayloadKind,
  pendingJoin,
} from '../../../../collaboration-worker/src/validation';
import { relayLimits } from '../../../../collaboration-worker/src/protocol';
import { credentialId, verifyTransportSignature } from './identity';
import { CollaborationAdmissionRejectedError } from './invitation-authorization';

/** Verify device authorship; owner invitation possession is checked separately. */
export async function verifyPendingJoin(input: unknown, roomId: string): Promise<PendingJoin> {
  const snapshot = (value: unknown) => {
    try {
      return pendingJoin(value);
    } catch (error) {
      if (error instanceof RelayError)
        throw new CollaborationAdmissionRejectedError(
          `The admission is invalid or expired (${error.code}).`,
        );
      throw error;
    }
  };
  const request = snapshot(input);
  if (
    !(await verifyTransportSignature(
      request,
      'admission',
      admissionInput(
        roomId,
        request,
        request.keyPackage,
        request.expiresAt,
        request.admission.authorization,
      ),
      request.admission.signature,
    ))
  )
    throw new CollaborationAdmissionRejectedError(
      'The admission device identity or signature could not be verified.',
    );
  // Expiry may pass while WebCrypto is verifying the immutable snapshot.
  return snapshot(request);
}

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

/** Validate even discarded old frames without needing historical identities or keys. */
export function validatePeerCommand(command: SignedCommand, expectedRoomId: string): void {
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
  if (
    command.type !== 'command' ||
    command.protocol !== 1 ||
    command.roomId !== expectedRoomId ||
    typeof command.connectionId !== 'string' ||
    command.connectionId.length > 128 ||
    !Number.isSafeInteger(command.sequence) ||
    command.sequence < 1 ||
    !Number.isSafeInteger(command.epoch) ||
    command.epoch < 0
  )
    throw new Error('The collaboration message is not from an approved participant.');
  deviceId(command.deviceId);
  decode(command.signature, 64, 64);
  const body = record(command.body, ['kind', 'payloadKind', 'ciphertext'], ['recipient']);
  if (body.kind !== 'relay') throw new Error('Unexpected peer command.');
  relayPayloadKind(body.payloadKind);
  decode(body.ciphertext, relayLimits.ciphertextBytes);
  if (body.recipient !== undefined) deviceId(body.recipient);
}

export async function verifyPeerCommand(
  command: SignedCommand,
  policy: SignedRoomPolicy,
): Promise<RoomMember> {
  validatePeerCommand(command, policy.policy.roomId);
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
  if (body.kind !== 'relay') throw new Error('Unexpected peer command.');
  const payloadKind = relayPayloadKind(body.payloadKind);
  decode(body.ciphertext, relayLimits.ciphertextBytes);
  if (body.recipient !== undefined) deviceId(body.recipient);
  if (member.role === 'viewer' && !['presence', 'sync-request'].includes(payloadKind))
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
