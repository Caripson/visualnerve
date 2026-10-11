import { canonical, type SignedRoomPolicy } from '../../../../collaboration-worker/src/protocol';
import {
  record,
  decode,
  integer,
  deviceId,
  roomId,
} from '../../../../collaboration-worker/src/validation';
import { binaryHash } from './policy';
import { verifyTransportSignature } from './identity';

export const policyLeaseLimits = Object.freeze({ lifetimeMs: 30_000, refreshMs: 10_000 });
export interface PolicyLease {
  roomId: string;
  requesterDeviceId: string;
  nonce: string;
  epoch: number;
  revision: number;
  policyHash: string;
  lifetimeMs: number;
}
export interface SignedPolicyLease {
  lease: PolicyLease;
  signature: string;
}
export async function leaseInput(
  policy: SignedRoomPolicy,
  requesterDeviceId: string,
  nonce: string,
): Promise<PolicyLease> {
  return {
    roomId: policy.policy.roomId,
    requesterDeviceId,
    nonce,
    epoch: policy.policy.epoch,
    revision: policy.policy.revision,
    policyHash: await binaryHash(new TextEncoder().encode(canonical(policy.policy))),
    lifetimeMs: policyLeaseLimits.lifetimeMs,
  };
}
export async function verifyPolicyLease(
  value: unknown,
  policy: SignedRoomPolicy,
  requester: string,
  nonce: string,
): Promise<void> {
  const signed = record(value, ['lease', 'signature']);
  const lease = record(signed.lease, [
    'roomId',
    'requesterDeviceId',
    'nonce',
    'epoch',
    'revision',
    'policyHash',
    'lifetimeMs',
  ]);
  roomId(lease.roomId);
  deviceId(lease.requesterDeviceId);
  decode(lease.nonce, 32, 32);
  integer(lease.epoch);
  integer(lease.revision, 1);
  decode(signed.signature, 64, 64);
  if (canonical(lease) !== canonical(await leaseInput(policy, requester, nonce)))
    throw new Error('The owner policy lease does not match the requested current membership.');
  const owner = policy.policy.members.find((member) => member.role === 'owner')!;
  if (!(await verifyTransportSignature(owner, 'lease', lease, signed.signature as string)))
    throw new Error('The owner policy lease signature is invalid.');
}
