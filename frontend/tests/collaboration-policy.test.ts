import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeviceIdentity,
  RoomPolicy,
  SignedCommand,
  SignedRoomPolicy,
} from '../../collaboration-worker/src/protocol';
import {
  createTransportIdentity,
  encodeBytes,
  type TransportIdentity,
} from '../src/collaboration/transport/identity';
import { verifyPeerCommand, verifyRoomPolicy } from '../src/collaboration/transport/policy';

const devices: TransportIdentity[] = [];
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  devices.forEach((device) => device.destroy());
  devices.length = 0;
  vi.unstubAllGlobals();
});
async function device() {
  const identity = await createTransportIdentity();
  devices.push(identity);
  const value: DeviceIdentity = {
    ...identity.public,
    mlsSignatureKey: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
  };
  return { identity, value };
}
async function fixture() {
  const owner = await device(),
    editor = await device(),
    viewer = await device();
  const policy: RoomPolicy = {
    protocol: 1,
    roomId: crypto.randomUUID(),
    ownerDeviceId: owner.value.deviceId,
    revision: 1,
    epoch: 0,
    transition: null,
    members: [
      { ...owner.value, role: 'owner' },
      { ...editor.value, role: 'editor' },
      { ...viewer.value, role: 'viewer' },
    ],
  };
  const signed = { policy, signature: await owner.identity.sign('policy', policy) };
  return { owner, editor, viewer, signed };
}
async function resign(policy: RoomPolicy, identity: TransportIdentity): Promise<SignedRoomPolicy> {
  return { policy, signature: await identity.sign('policy', policy) };
}
async function message(
  signed: SignedRoomPolicy,
  participant: Awaited<ReturnType<typeof device>>,
  payloadKind: 'application' | 'presence' | 'snapshot' | 'sync-request' = 'application',
): Promise<SignedCommand> {
  const unsigned: Omit<SignedCommand, 'signature'> = {
    type: 'command',
    protocol: 1,
    roomId: signed.policy.roomId,
    connectionId: crypto.randomUUID(),
    deviceId: participant.value.deviceId,
    sequence: 1,
    epoch: signed.policy.epoch,
    body: { kind: 'relay', payloadKind, ciphertext: encodeBytes(Uint8Array.from([1, 2, 3, 4])) },
  };
  return { ...unsigned, signature: await participant.identity.sign('command', unsigned) };
}
describe('independent owner-signed collaboration policy verification', () => {
  it('accepts valid policy and its identical repeated observation with the pinned owner', async () => {
    const { owner, signed } = await fixture();
    expect(await verifyRoomPolicy(signed, signed.policy.roomId, owner.value.credentialId)).toEqual(
      signed,
    );
    expect(
      await verifyRoomPolicy(signed, signed.policy.roomId, owner.value.credentialId, signed),
    ).toEqual(signed);
  });
  it('rejects relay-invented roles, another room, unpinned owner and invalid device fingerprints', async () => {
    const { owner, signed } = await fixture();
    const forged = structuredClone(signed);
    forged.policy.members[1].role = 'viewer';
    await expect(
      verifyRoomPolicy(forged, signed.policy.roomId, owner.value.credentialId),
    ).rejects.toThrow(/owner identity/);
    await expect(
      verifyRoomPolicy(signed, crypto.randomUUID(), owner.value.credentialId),
    ).rejects.toThrow(/another room/);
    await expect(verifyRoomPolicy(signed, signed.policy.roomId, '0'.repeat(64))).rejects.toThrow(
      /owner identity/,
    );
    const invalid = structuredClone(signed.policy);
    invalid.members[1].credentialId = '0'.repeat(64);
    await expect(
      verifyRoomPolicy(
        await resign(invalid, owner.identity),
        signed.policy.roomId,
        owner.value.credentialId,
      ),
    ).rejects.toThrow(/participant identity/);
  });
  it('rejects downgrade replay and a same-revision signed policy change', async () => {
    const { owner, signed } = await fixture();
    const advanced = await resign(
      {
        ...signed.policy,
        revision: 2,
        epoch: 1,
        transition: { previousEpoch: 0, commitHash: 'a'.repeat(64), welcomeHashes: [] },
      },
      owner.identity,
    );
    expect(
      await verifyRoomPolicy(advanced, signed.policy.roomId, owner.value.credentialId, signed),
    ).toEqual(advanced);
    await expect(
      verifyRoomPolicy(signed, signed.policy.roomId, owner.value.credentialId, advanced),
    ).rejects.toThrow(/replayed/);
    const changed = structuredClone(signed.policy);
    changed.members[1].role = 'viewer';
    await expect(
      verifyRoomPolicy(
        await resign(changed, owner.identity),
        signed.policy.roomId,
        owner.value.credentialId,
        signed,
      ),
    ).rejects.toThrow(/replayed/);
  });
  it('rejects a signed transition whose epoch and revision disagree or do not bind the prior epoch', async () => {
    const { owner, signed } = await fixture();
    for (const invalid of [
      { ...signed.policy, revision: 2, epoch: 0, transition: null },
      { ...signed.policy, revision: 2, epoch: 1, transition: null },
      {
        ...signed.policy,
        revision: 2,
        epoch: 1,
        transition: { previousEpoch: 99, commitHash: 'a'.repeat(64), welcomeHashes: [] },
      },
    ])
      await expect(
        verifyRoomPolicy(
          await resign(invalid, owner.identity),
          signed.policy.roomId,
          owner.value.credentialId,
          signed,
        ),
      ).rejects.toThrow();
  });
  it('rejects owner/member cryptographic identity substitution even if owner signs the replacement', async () => {
    const { owner, editor, signed } = await fixture();
    for (const id of [owner.value.deviceId, editor.value.deviceId]) {
      const changed = {
        ...structuredClone(signed.policy),
        revision: 2,
        epoch: 1,
        transition: { previousEpoch: 0, commitHash: 'a'.repeat(64), welcomeHashes: [] },
      };
      changed.members.find((member) => member.deviceId === id)!.mlsSignatureKey = encodeBytes(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      await expect(
        verifyRoomPolicy(
          await resign(changed, owner.identity),
          signed.policy.roomId,
          owner.value.credentialId,
          signed,
        ),
      ).rejects.toThrow();
    }
  });
});
describe('peer authority independent of the relay', () => {
  it('accepts approved editor signature and read-only presence/sync, but denies viewer updates/snapshots', async () => {
    const { editor, viewer, signed } = await fixture();
    expect(await verifyPeerCommand(await message(signed, editor), signed)).toMatchObject(
      editor.value,
    );
    for (const kind of ['presence', 'sync-request'] as const)
      expect(await verifyPeerCommand(await message(signed, viewer, kind), signed)).toMatchObject(
        viewer.value,
      );
    for (const kind of ['application', 'snapshot'] as const)
      await expect(verifyPeerCommand(await message(signed, viewer, kind), signed)).rejects.toThrow(
        /read-only/,
      );
  });
  it('rejects unknown devices, changed signed bodies, another room and stale epochs', async () => {
    const { editor, signed } = await fixture(),
      stranger = await device();
    await expect(verifyPeerCommand(await message(signed, stranger), signed)).rejects.toThrow(
      /approved/,
    );
    const valid = await message(signed, editor);
    for (const invalid of [
      { ...valid, roomId: crypto.randomUUID() },
      { ...valid, epoch: 1 },
      { ...valid, sequence: 0 },
    ])
      await expect(verifyPeerCommand(invalid, signed)).rejects.toThrow(/approved/);
    await expect(
      verifyPeerCommand(
        { ...valid, body: { kind: 'relay', payloadKind: 'presence', ciphertext: 'AA' } },
        signed,
      ),
    ).rejects.toThrow(/signature/);
  });
  it('rejects malformed signed relay payloads before the decryption boundary', async () => {
    const { editor, signed } = await fixture();
    const good = await message(signed, editor);
    for (const body of [
      { kind: 'relay', payloadKind: 'unknown', ciphertext: 'AA' },
      { kind: 'relay', payloadKind: 'application', ciphertext: 'not+base64' },
      {
        kind: 'relay',
        payloadKind: 'application',
        ciphertext: 'AA',
        title: 'unexpected plaintext',
      },
    ]) {
      const { signature: _signature, ...unsigned } = { ...good, body };
      const invalid = {
        ...unsigned,
        signature: await editor.identity.sign('command', unsigned),
      } as SignedCommand;
      await expect(verifyPeerCommand(invalid, signed)).rejects.toThrow();
    }
  });
});
