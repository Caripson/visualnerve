import { describe, expect, it } from 'vitest';
import {
  assertMlsPolicy,
  decodeMlsResult,
  type MlsGroupInfo,
} from '../src/collaboration/crypto-types';
import { encodeBytes } from '../src/collaboration/transport/identity';
import type { RoomPolicy } from '../../collaboration-worker/src/protocol';

const publicKey = encodeBytes(new Uint8Array(32).fill(7));
const identity = {
  deviceId: 'owner-device',
  credentialId: 'a'.repeat(64),
  mlsSignatureKey: publicKey,
  signingKey: { kty: 'EC' as const, crv: 'P-256' as const, x: 'x', y: 'y' },
};
function fixture(): { info: MlsGroupInfo; policy: RoomPolicy } {
  return {
    info: {
      roomId: 'room-test',
      epoch: 3,
      active: true,
      ownDeviceId: 'owner-device',
      ownerDeviceId: 'owner-device',
      members: [
        {
          deviceId: identity.deviceId,
          transportKeyFingerprint: identity.credentialId,
          signaturePublicKey: publicKey,
          leafIndex: 0,
        },
      ],
    },
    policy: {
      protocol: 1,
      roomId: 'room-test',
      ownerDeviceId: 'owner-device',
      revision: 4,
      epoch: 3,
      transition: null,
      members: [{ ...identity, role: 'owner' }],
    },
  };
}
describe('authenticated MLS membership matches approved room policy', () => {
  it('accepts the matching owner device and public keys', () => {
    const { info, policy } = fixture();
    expect(() => assertMlsPolicy(info, policy)).not.toThrow();
  });
  it.each(['roomId', 'epoch', 'ownerDeviceId', 'active'] as const)(
    'rejects altered group %s',
    (field) => {
      const { info, policy } = fixture();
      const bad = {
        ...info,
        [field]: field === 'epoch' ? 2 : field === 'active' ? false : 'forged-value',
      } as MlsGroupInfo;
      expect(() => assertMlsPolicy(bad, policy)).toThrow();
    },
  );
  it.each(['credentialId', 'mlsSignatureKey', 'deviceId'] as const)(
    'rejects substituted approved identity %s',
    (field) => {
      const { info, policy } = fixture();
      policy.members[0] = {
        ...policy.members[0],
        [field]:
          field === 'mlsSignatureKey' ? encodeBytes(new Uint8Array(32).fill(8)) : 'forged-value',
      };
      expect(() => assertMlsPolicy(info, policy)).toThrow();
    },
  );
  it('rejects duplicate device identities even when member counts match', () => {
    const { info, policy } = fixture();
    info.members.push({ ...info.members[0], leafIndex: 1 });
    policy.members.push({ ...policy.members[0], role: 'editor' });
    expect(() => assertMlsPolicy(info, policy)).toThrow();
  });
  it('rejects an unapproved MLS group member', () => {
    const { info, policy } = fixture();
    info.members.push({
      deviceId: 'unknown-device',
      transportKeyFingerprint: 'b'.repeat(64),
      signaturePublicKey: publicKey,
      leafIndex: 1,
    });
    expect(() => assertMlsPolicy(info, policy)).toThrow();
  });
  it('rejects ownership reassignment through a forged role', () => {
    const { info, policy } = fixture();
    policy.members[0].role = 'viewer';
    expect(() => assertMlsPolicy(info, policy)).toThrow();
  });
});
describe('MLS worker result boundary', () => {
  it('decodes authenticated binary payloads without treating them as visible text', () => {
    const result = decodeMlsResult({
      kind: 'application',
      senderDeviceId: 'owner-device',
      senderSignaturePublicKey: publicKey,
      epoch: 3,
      payload: encodeBytes(new Uint8Array([0, 128, 255])),
      members: null,
    });
    expect(result.payload).toEqual(new Uint8Array([0, 128, 255]));
    expect(result.senderDeviceId).toBe('owner-device');
  });
  it('rejects invalid authenticated author keys and negative epochs', () => {
    const base = {
      kind: 'application' as const,
      senderDeviceId: 'owner-device',
      senderSignaturePublicKey: publicKey,
      epoch: 3,
      payload: 'AA',
      members: null,
    };
    expect(() => decodeMlsResult({ ...base, senderSignaturePublicKey: 'AA' })).toThrow();
    expect(() => decodeMlsResult({ ...base, epoch: -1 })).toThrow();
    expect(() => decodeMlsResult({ ...base, payload: '***' })).toThrow();
  });
});
