import { binaryHash, verify, verifyIdentity } from "./auth";
import {
  relayLimits,
  type PendingJoin,
  type PolicyCommand,
  type RoomPolicy,
  type SignedRoomPolicy,
} from "./protocol";
import {
  decode,
  deviceId,
  record,
  RelayError,
  sameIdentity,
  signedPolicy,
} from "./validation";

/** Validates public ACL plus detached MLS payload hashes, with no durable writes.
 * The Durable Object calls this only within its serialized owner command boundary.
 */
export class MembershipTransition {
  constructor(
    private readonly current: {
      policy: SignedRoomPolicy;
      pending: readonly PendingJoin[];
    },
    private readonly now: number,
  ) {}
  async validate(input: unknown): Promise<{
    body: PolicyCommand;
    next: SignedRoomPolicy;
    after: RoomPolicy;
    added: string[];
  }> {
    const body = record(input, [
      "kind",
      "policy",
      "commit",
      "welcomes",
    ]) as unknown as PolicyCommand;
    const next = signedPolicy(body.policy),
      before = this.current.policy.policy,
      after = next.policy;
    if (
      after.roomId !== before.roomId ||
      after.ownerDeviceId !== before.ownerDeviceId ||
      after.revision !== before.revision + 1 ||
      after.epoch !== before.epoch + 1 ||
      after.transition?.previousEpoch !== before.epoch
    )
      throw new RelayError("INVALID_TRANSITION", 409);
    const owner = before.members.find((member) => member.role === "owner")!;
    if (
      !sameIdentity(
        owner,
        after.members.find((member) => member.role === "owner")!,
      )
    )
      throw new RelayError("OWNER_IMMUTABLE");
    await verify(owner.signingKey, "policy", after, next.signature);
    const commitHash = await binaryHash(
      decode(body.commit, relayLimits.ciphertextBytes),
    );
    if (commitHash !== after.transition.commitHash)
      throw new RelayError("COMMIT_MISMATCH");
    if (
      !Array.isArray(body.welcomes) ||
      body.welcomes.length > relayLimits.members
    )
      throw new RelayError("INVALID_WELCOME");
    const added: string[] = [];
    for (const member of after.members) {
      await verifyIdentity(member);
      const old = before.members.find(
        (old) => old.deviceId === member.deviceId,
      );
      if (old && !sameIdentity(old, member))
        throw new RelayError("IDENTITY_IMMUTABLE");
      if (!old) {
        const pending = this.current.pending.find(
          (pending) =>
            pending.deviceId === member.deviceId &&
            sameIdentity(pending, member),
        );
        if (!pending || pending.expiresAt <= this.now)
          throw new RelayError("OWNER_APPROVAL_REQUIRED", 403);
        added.push(member.deviceId);
      }
    }
    if (
      body.welcomes.length !== added.length ||
      after.transition.welcomeHashes.length !== added.length
    )
      throw new RelayError("INVALID_WELCOME");
    const recipients = new Set<string>();
    for (const value of body.welcomes) {
      const welcome = record(value, ["deviceId", "ciphertext"]);
      const recipient = deviceId(welcome.deviceId);
      const hash = await binaryHash(
        decode(welcome.ciphertext, relayLimits.ciphertextBytes),
      );
      if (
        !added.includes(recipient) ||
        recipients.has(recipient) ||
        !after.transition.welcomeHashes.some(
          (entry) => entry.deviceId === recipient && entry.hash === hash,
        )
      )
        throw new RelayError("WELCOME_MISMATCH");
      recipients.add(recipient);
    }
    return { body, next, after, added };
  }
}
