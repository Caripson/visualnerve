import { CollaborationRelayQuota } from './relay-quota';
import type {
  DeviceIdentity,
  PendingJoin,
  RelayPayloadKind,
  RoomMember,
  SignedRoomPolicy,
  ServerFrame,
} from '../../../../collaboration-worker/src/protocol';
import { identity as validateIdentity } from '../../../../collaboration-worker/src/validation';
import { MlsSession } from '../crypto';
import { assertMlsPolicy, type MlsProcessResult } from '../crypto-types';
import {
  type TransportIdentity,
  createTransportIdentity,
  credentialId,
  decodeBytes,
} from '../transport/identity';
import { RoomTransport, CollaborationRelayError } from '../transport/room-transport';
import { binaryHash, verifyPeerCommand, verifyRoomPolicy } from '../transport/policy';
import {
  CollaborationMessageAssembler,
  CollaborationMessageFramer,
  type CollaborationPayloadKind,
  type CollaborationReassembledMessage,
} from '../sync/message-framing';
export interface EncryptedRoomOptions {
  roomId: string;
  diagramId: string;
  relay: string;
  ownerCredential?: string;
  ownerDeviceId?: string;
  invitation?: string;
  signal: AbortSignal;
  check(): void;
  onPolicy(policy: SignedRoomPolicy): void;
  onJoin(request: PendingJoin): void;
  onReady(): Promise<void> | void;
  onMessage(kind: CollaborationPayloadKind, payload: Uint8Array, sender: RoomMember): Promise<void>;
  onDisconnect(): void;
  onEpochPending?(): void;
  onError(error: Error): void;
}
export interface EncryptedPacket {
  payloadKind: RelayPayloadKind;
  ciphertext: string;
  recipient?: string;
}
const wireKinds = {
  update: 'application',
  snapshot: 'snapshot',
  sync: 'sync-request',
  presence: 'presence',
} as const;
class CollaborationSendSupersededError extends Error {
  constructor() {
    super('The message belongs to an earlier membership epoch. Resynchronize the document.');
    this.name = 'AbortError';
  }
}
/** Owns one ephemeral MLS group. No private key or ratchet leaves its worker. */
export class EncryptedRoom {
  readonly identity: TransportIdentity;
  readonly device: DeviceIdentity;
  private transport: RoomTransport;
  private policy?: SignedRoomPolicy;
  private previousPolicy?: SignedRoomPolicy;
  private epochTimer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private stopped = false;
  private cryptoQueue: Promise<unknown> = Promise.resolve();
  private assembler: CollaborationMessageAssembler;
  private framer: CollaborationMessageFramer;
  private outgoing = Promise.resolve();
  private quota = new CollaborationRelayQuota();
  private sendEpoch = new AbortController();
  private sent = new Map<string, number>();
  private pinnedOwner: string;
  private constructor(
    private options: EncryptedRoomOptions,
    private mls: MlsSession,
    identity: TransportIdentity,
    device: DeviceIdentity,
    keyPackage?: string,
  ) {
    this.identity = identity;
    this.device = device;
    this.pinnedOwner = options.ownerCredential ?? device.credentialId;
    this.assembler = new CollaborationMessageAssembler(options.diagramId);
    this.framer = new CollaborationMessageFramer(options.diagramId);
    this.transport = new RoomTransport({
      relayUrl: options.relay,
      roomId: options.roomId,
      identity,
      device,
      ...(options.invitation ? { invitation: options.invitation, keyPackage } : {}),
      onFrame: (frame) => this.receive(frame),
      onDisconnect: () => {
        if (!this.stopped) options.onDisconnect();
      },
      onError: (error) => options.onError(error),
    });
    options.signal.addEventListener('abort', () => this.dispose(), { once: true });
  }
  static async open(options: EncryptedRoomOptions): Promise<EncryptedRoom> {
    options.check();
    const identity = await createTransportIdentity();
    let mls: MlsSession | undefined;
    try {
      options.check();
      mls = await MlsSession.create({
        deviceId: identity.public.deviceId,
        credentialId: identity.public.credentialId,
      });
      options.check();
      const device = { ...identity.public, mlsSignatureKey: await mls.signaturePublicKey() };
      const keyPackage = options.invitation ? await mls.keyPackage() : undefined;
      options.check();
      return new EncryptedRoom(options, mls, identity, device, keyPackage);
    } catch (error) {
      identity.destroy();
      mls?.dispose();
      throw error;
    }
  }
  private check() {
    this.options.check();
    if (this.stopped) throw new Error('The collaboration session has closed.');
  }
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.cryptoQueue.then(async () => {
      this.check();
      const value = await task();
      try {
        this.check();
      } catch (error) {
        (value as { payload?: Uint8Array } | undefined)?.payload?.fill(0);
        throw error;
      }
      return value;
    });
    this.cryptoQueue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  get currentPolicy() {
    return this.policy;
  }
  get role() {
    return this.policy?.policy.members.find((member) => member.deviceId === this.device.deviceId)
      ?.role;
  }
  get epoch() {
    if (!this.policy) throw new Error('The group is not approved yet.');
    return this.policy.policy.epoch;
  }
  async create() {
    await this.serialized(async () => {
      await this.mls.createGroup(this.options.roomId);
      const policy = {
        protocol: 1 as const,
        roomId: this.options.roomId,
        ownerDeviceId: this.device.deviceId,
        revision: 1,
        epoch: 0,
        members: [{ ...this.device, role: 'owner' as const }],
        transition: null,
      };
      this.policy = { policy, signature: await this.identity.sign('policy', policy) };
      assertMlsPolicy(await this.mls.info(), policy);
      await this.transport.create(this.policy);
      this.options.onPolicy(this.policy);
    });
    await this.transport.connect();
  }
  async connect() {
    this.check();
    await this.transport.connect();
  }
  async reconnect() {
    this.check();
    this.transport.disconnect();
    await this.transport.connect();
  }
  private async receive(frame: ServerFrame) {
    this.check();
    if (frame.type === 'pending') return;
    if (frame.type === 'join-request') {
      if (this.role !== 'owner') throw new Error('Unexpected admission request.');
      validateIdentity({
        deviceId: frame.request.deviceId,
        signingKey: frame.request.signingKey,
        credentialId: frame.request.credentialId,
        mlsSignatureKey: frame.request.mlsSignatureKey,
      });
      if ((await credentialId(frame.request.signingKey)) !== frame.request.credentialId)
        throw new Error('The admission fingerprint does not match the supplied device key.');
      decodeBytes(frame.request.keyPackage, 32 * 1024);
      if (
        !Number.isSafeInteger(frame.request.expiresAt) ||
        frame.request.expiresAt <= Date.now() ||
        frame.request.expiresAt > Date.now() + 610_000
      )
        throw new Error('Invalid admission expiry.');
      this.options.onJoin(frame.request);
      return;
    }
    if (frame.type === 'authenticated') {
      const policy = await verifyRoomPolicy(
        frame.policy,
        this.options.roomId,
        this.pinnedOwner,
        this.policy,
      );
      this.check();
      // Reconnecting metadata cannot substitute for the missing MLS transcript.
      assertMlsPolicy(await this.serialized(() => this.mls.info()), policy.policy);
      this.policy = policy;
      this.ready = true;
      this.options.onPolicy(policy);
      await this.options.onReady();
      return;
    }
    if (frame.type === 'welcome') {
      await this.serialized(async () => {
        if (this.ready) throw new Error('Unexpected group Welcome.');
        const policy = await verifyRoomPolicy(
          frame.policy,
          this.options.roomId,
          this.pinnedOwner,
          this.policy,
        );
        const own = policy.policy.members.find(
          (member) => member.deviceId === this.device.deviceId,
        );
        const owner = policy.policy.members.find((member) => member.role === 'owner')!;
        const transition = policy.policy.transition;
        if (
          !own ||
          owner.deviceId !== this.options.ownerDeviceId ||
          !transition ||
          transition.commitHash !== (await binaryHash(decodeBytes(frame.commit, 128 * 1024))) ||
          transition.welcomeHashes.find((item) => item.deviceId === this.device.deviceId)?.hash !==
            (await binaryHash(decodeBytes(frame.ciphertext, 128 * 1024)))
        )
          throw new Error('The Welcome was not approved by the pinned owner.');
        await this.mls.join({
          welcome: frame.ciphertext,
          roomId: this.options.roomId,
          ownerDeviceId: owner.deviceId,
          ownerSignatureKey: owner.mlsSignatureKey,
        });
        assertMlsPolicy(await this.mls.info(), policy.policy);
        this.policy = policy;
        this.ready = true;
        this.options.onPolicy(policy);
      });
      return;
    }
    if (frame.type === 'policy') {
      await this.serialized(async () => {
        if (!this.policy || !this.ready) throw new Error('Unexpected membership transition.');
        const next = await verifyRoomPolicy(
          frame.policy,
          this.options.roomId,
          this.pinnedOwner,
          this.policy,
        );
        if (
          next.policy.epoch !== this.epoch + 1 ||
          next.policy.transition?.previousEpoch !== this.epoch ||
          next.policy.transition.commitHash !==
            (await binaryHash(decodeBytes(frame.commit, 128 * 1024)))
        )
          throw new Error(
            'A membership change was missed. Ask the owner for a new approved invitation.',
          );
        const result = await this.mls.process({
          ciphertext: frame.commit,
          expectedDeviceId: next.policy.ownerDeviceId,
        });
        try {
          if (result.kind !== 'commit') throw new Error('Invalid membership commit.');
          assertMlsPolicy(await this.mls.info(), next.policy);
          this.assembler.clear();
          this.previousPolicy = this.policy;
          this.policy = next;
          this.clearEpochWait();
          this.sent.clear();
          this.options.onPolicy(next);
        } finally {
          result.payload?.fill(0);
        }
      });
      await this.options.onReady();
      return;
    }
    if (frame.type === 'relay') {
      if (!this.ready || !this.policy)
        throw new Error('The group is not ready for document messages.');
      const command = frame.command;
      // A frame accepted by the relay just before a commit can arrive just
      // after the owner's ACK. Retain one public policy solely to authenticate
      // and discard those in-flight frames, never to decrypt or apply them.
      const approvedPolicy =
        this.previousPolicy?.policy.epoch === command.epoch && command.epoch + 1 === this.epoch
          ? this.previousPolicy
          : this.policy;
      const approvedEpoch = approvedPolicy.policy.epoch;
      const member = await verifyPeerCommand(command, approvedPolicy);
      const recipient = (command.body as EncryptedPacket).recipient;
      if (recipient !== undefined && recipient !== this.device.deviceId)
        throw new Error('The relay delivered a message addressed to a different participant.');
      let message: MlsProcessResult | undefined;
      let completed: CollaborationReassembledMessage | undefined;
      try {
        const result = await this.serialized(async () => {
          // An owner commit can advance the group while this authenticated
          // frame waits for the crypto queue. Old-epoch ciphertext must never
          // enter the new ratchet. The epoch transition triggers a complete
          // CRDT resynchronization, including any unsent local edits.
          if (approvedEpoch !== this.epoch) return undefined;
          const key = await binaryHash(
            decodeBytes((command.body as EncryptedPacket).ciphertext, 128 * 1024),
          );
          if (this.sent.has(key)) return undefined;
          message = await this.mls.process({
            ciphertext: (command.body as EncryptedPacket).ciphertext,
            expectedDeviceId: member.deviceId,
          });
          if (
            message.kind !== 'application' ||
            !message.payload ||
            message.senderDeviceId !== member.deviceId ||
            message.senderSignaturePublicKey !== member.mlsSignatureKey ||
            message.epoch !== this.epoch
          )
            throw new Error('The authenticated MLS author differs from the approved participant.');
          this.sent.set(key, Date.now());
          while (this.sent.size > 4096) this.sent.delete(this.sent.keys().next().value!);
          this.check();
          return message;
        });
        if (!result?.payload) return;
        completed = await this.assembler.accept(member.deviceId, approvedEpoch, result.payload);
        if (!completed) return;
        this.check();
        if (approvedEpoch !== this.epoch) return;
        if (
          wireKinds[completed.kind] !== (command.body as EncryptedPacket).payloadKind ||
          (member.role === 'viewer' && !['presence', 'sync'].includes(completed.kind))
        )
          throw new Error('The encrypted operation exceeds the participant permission.');
        await this.options.onMessage(completed.kind, completed.payload, member);
      } finally {
        message?.payload?.fill(0);
        completed?.payload.fill(0);
      }
    }
  }
  async encrypt(
    kind: CollaborationPayloadKind,
    payload: Uint8Array,
    recipient?: string,
  ): Promise<EncryptedPacket[]> {
    // Bounds keep a complete message below the relay's minute/assembly limits.
    if (payload.byteLength > 3 * 1024 * 1024)
      throw new Error(
        'This shared update is too large. Share a smaller diagram or reduce its data scope.',
      );
    return this.serialized(async () => {
      if (!this.ready) throw new Error('The collaboration room is not ready.');
      if (this.role === 'viewer' && !['presence', 'sync'].includes(kind))
        throw new Error('This participant is read only.');
      const result: EncryptedPacket[] = [];
      for await (const frame of this.framer.frames(kind, payload, this.options.signal)) {
        try {
          result.push({
            payloadKind: wireKinds[kind],
            ciphertext: await this.mls.encrypt(frame),
            ...(recipient ? { recipient } : {}),
          });
        } finally {
          frame.fill(0);
        }
      }
      return result;
    });
  }
  send(packets: readonly EncryptedPacket[], epoch = this.epoch): Promise<void> {
    const signal = this.sendEpoch.signal;
    const bytes = packets.reduce(
      (sum, packet) => sum + new TextEncoder().encode(JSON.stringify(packet)).length + 1000,
      0,
    );
    const pending = this.outgoing.then(async () => {
      this.check();
      try {
        await this.quota.reserve(packets.length, bytes, signal);
      } catch (error) {
        this.check();
        if (signal.aborted) throw new CollaborationSendSupersededError();
        throw error;
      }
      for (const packet of packets) {
        this.check();
        if (signal.aborted || epoch !== this.epoch) throw new CollaborationSendSupersededError();
        await this.transport.send({ kind: 'relay', ...packet }, epoch);
      }
    });
    this.outgoing = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  cancelPendingSends() {
    this.sendEpoch.abort();
    this.sendEpoch = new AbortController();
  }
  async message(kind: CollaborationPayloadKind, payload: Uint8Array, recipient?: string) {
    const epoch = this.epoch;
    try {
      const packets = await this.encrypt(kind, payload, recipient);
      await this.send(packets, epoch);
    } catch (error) {
      this.check();
      if (error instanceof CollaborationRelayError && error.code === 'STALE_EPOCH') {
        // The relay can reject an old send before this ordered reader has
        // consumed the owner's queued, signed commit. Do not block that commit
        // behind a fatal callback or retry old ciphertext in a new epoch.
        if (epoch === this.epoch) this.waitForEpoch(epoch);
        return;
      }
      // A locally verified commit can also supersede a queued send. Its ready
      // callback resynchronizes the complete, durably saved document.
      if (error instanceof CollaborationSendSupersededError) return;
      throw error;
    }
  }
  private waitForEpoch(epoch: number) {
    if (this.epochTimer) return;
    this.options.onEpochPending?.();
    this.epochTimer = setTimeout(() => {
      this.epochTimer = undefined;
      if (!this.stopped && this.epoch === epoch)
        this.options.onError(
          new Error(
            'The signed membership update did not arrive. Leave the room and request a fresh invitation.',
          ),
        );
    }, 30_000);
  }
  private clearEpochWait() {
    clearTimeout(this.epochTimer);
    this.epochTimer = undefined;
  }
  async control(
    kind: 'invite' | 'reject' | 'inspect' | 'leave' | 'delete-room' | 'revoke-invitations',
    deviceId?: string,
  ): Promise<unknown> {
    this.check();
    if (kind === 'reject') {
      if (!deviceId) throw new Error('Select a device.');
      return this.transport.send({ kind, deviceId }, this.epoch);
    }
    return this.transport.send({ kind }, this.epoch);
  }
  async changeMembers(members: RoomMember[], admission?: PendingJoin) {
    this.cancelPendingSends();
    await this.serialized(async () => {
      if (this.role !== 'owner' || !this.policy)
        throw new Error('Only the room owner can change access.');
      const previous = this.policy;
      const removed = previous.policy.members.find(
        (member) => !members.some((next) => next.deviceId === member.deviceId),
      );
      const staged = admission
        ? await this.mls.prepareAddMember({
            deviceId: admission.deviceId,
            credentialId: admission.credentialId,
            keyPackage: admission.keyPackage,
            expectedSignatureKey: admission.mlsSignatureKey,
          })
        : removed
          ? await this.mls.prepareRemoveMember(removed.deviceId)
          : await this.mls.prepareRotate();
      const transition = {
        previousEpoch: previous.policy.epoch,
        commitHash: await binaryHash(decodeBytes(staged.commit, 128 * 1024)),
        welcomeHashes:
          admission && staged.welcome
            ? [
                {
                  deviceId: admission.deviceId,
                  hash: await binaryHash(decodeBytes(staged.welcome, 128 * 1024)),
                },
              ]
            : [],
      };
      const policy = {
        ...previous.policy,
        members,
        epoch: staged.nextEpoch,
        revision: previous.policy.revision + 1,
        transition,
      };
      const signed = { policy, signature: await this.identity.sign('policy', policy) };
      await verifyRoomPolicy(signed, this.options.roomId, this.pinnedOwner, previous);
      let committed = false;
      try {
        try {
          await this.transport.send(
            {
              kind: 'policy',
              policy: signed,
              commit: staged.commit,
              welcomes:
                admission && staged.welcome
                  ? [{ deviceId: admission.deviceId, ciphertext: staged.welcome }]
                  : [],
            },
            previous.policy.epoch,
          );
          committed = true;
        } catch (error) {
          // A timeout is an unknown outcome. Inspect the owner's durable policy.
          const result = (await this.transport.send(
            { kind: 'inspect' },
            previous.policy.epoch,
          )) as { policy?: SignedRoomPolicy };
          const actual = await verifyRoomPolicy(
            result.policy,
            this.options.roomId,
            this.pinnedOwner,
            previous,
          );
          committed = actual.policy.transition?.commitHash === transition.commitHash;
          if (!committed) throw error;
        }
        await this.mls.confirmPendingCommit();
        assertMlsPolicy(await this.mls.info(), policy);
        this.previousPolicy = previous;
        this.policy = signed;
        this.clearEpochWait();
        this.assembler.clear();
        this.sent.clear();
        this.options.onPolicy(signed);
      } catch (error) {
        // An unavailable inspection leaves an unknown durable outcome. Never
        // discard-and-continue a group whose ratchet/ACL may already have moved.
        this.dispose();
        throw error;
      }
    });
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.clearEpochWait();
    this.sendEpoch.abort();
    this.quota.clear();
    this.transport.close();
    this.assembler.dispose();
    this.mls.dispose();
    this.identity.destroy();
    this.previousPolicy = undefined;
    this.sent.clear();
  }
}
