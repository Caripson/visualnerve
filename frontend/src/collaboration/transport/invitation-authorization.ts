import {
  canonical,
  type AdmissionAuthorization,
  type DeviceIdentity,
  type InvitationShareScope,
} from '../../../../collaboration-worker/src/protocol';
import { decodeBytes, encodeBytes } from './identity';

/** RAM/fragment-only invitation capability; never pass this object to the relay. */
export interface InvitationAuthorization {
  invitationId: string;
  secret: string;
  expiresAt: number;
  scope: InvitationShareScope;
}

function input(
  roomId: string,
  device: DeviceIdentity,
  keyPackage: string,
  expiresAt: number,
  authorization: Pick<InvitationAuthorization, 'invitationId' | 'scope'>,
) {
  return new TextEncoder().encode(
    `visual-nerve/collaboration/owner-invitation/v2\n${canonical({
      roomId,
      device: {
        deviceId: device.deviceId,
        credentialId: device.credentialId,
        signingKey: device.signingKey,
        mlsSignatureKey: device.mlsSignatureKey,
      },
      keyPackage,
      expiresAt,
      invitationId: authorization.invitationId,
      scope: authorization.scope,
    })}`,
  );
}

async function key(secret: string, usage: 'sign' | 'verify') {
  const bytes = decodeBytes(secret, 32);
  if (bytes.length !== 32) throw new Error('The owner invitation secret is invalid.');
  try {
    return await crypto.subtle.importKey(
      'raw',
      bytes as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      [usage],
    );
  } finally {
    bytes.fill(0);
  }
}

export async function proveInvitation(
  roomId: string,
  device: DeviceIdentity,
  keyPackage: string,
  expiresAt: number,
  authorization: InvitationAuthorization,
): Promise<AdmissionAuthorization> {
  const proof = await crypto.subtle.sign(
    'HMAC',
    await key(authorization.secret, 'sign'),
    input(roomId, device, keyPackage, expiresAt, authorization) as BufferSource,
  );
  return {
    invitationId: authorization.invitationId,
    scope: { ...authorization.scope },
    proof: encodeBytes(new Uint8Array(proof)),
  };
}

export async function verifyInvitation(
  roomId: string,
  device: DeviceIdentity,
  keyPackage: string,
  expiresAt: number,
  authorization: AdmissionAuthorization,
  expected: InvitationAuthorization,
): Promise<boolean> {
  if (
    authorization.invitationId !== expected.invitationId ||
    canonical(authorization.scope) !== canonical(expected.scope)
  )
    return false;
  const proof = decodeBytes(authorization.proof, 32);
  return (
    proof.length === 32 &&
    (await crypto.subtle.verify(
      'HMAC',
      await key(expected.secret, 'verify'),
      proof as BufferSource,
      input(roomId, device, keyPackage, expiresAt, expected) as BufferSource,
    ))
  );
}
