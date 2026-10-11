import { CollaborationRelayQuota } from './relay-quota';
import { StorageError } from '../../model/errors';
import type {
  DeviceIdentity,
  PendingJoin,
  RelayPayloadKind,
  RoomMember,
  SignedRoomPolicy,
  ServerFrame,
  InvitationShareScope,
} from '../../../../collaboration-worker/src/protocol';
import { relayLimits } from '../../../../collaboration-worker/src/protocol';
import {
  CollaborationAdmissionRejectedError,
  verifyInvitation,
  type InvitationAuthorization,
} from '../transport/invitation-authorization';
import { leaseInput, verifyPolicyLease, policyLeaseLimits } from '../transport/policy-lease';
import { sameIdentity, record, decode } from '../../../../collaboration-worker/src/validation';
import { MlsSession } from '../crypto';
import { assertMlsPolicy, type MlsProcessResult } from '../crypto-types';
import {
  type TransportIdentity,
  createTransportIdentity,
  decodeBytes,
  encodeBytes,
} from '../transport/identity';
import {
  RoomTransport,
  CollaborationRelayError,
  CollaborationPeerMessageError,
} from '../transport/room-transport';
import {
  binaryHash,
  verifyPeerCommand,
  validatePeerCommand,
  verifyPendingJoin,
  verifyRoomPolicy,
} from '../transport/policy';
import {
  CollaborationMessageAssembler,
  CollaborationMessageFramer,
  CollaborationFramingError,
  CollaborationBufferBusyError,
  collaborationFrameLimits,
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
  invitationAuthorization?: InvitationAuthorization;
  signal: AbortSignal;
  check(): void;
  onPolicy(policy: SignedRoomPolicy): void;
  onJoin(request: PendingJoin): void;
  onReady(): Promise<void> | void;
  onMessage(kind: CollaborationPayloadKind, payload: Uint8Array, sender: RoomMember): Promise<void>;
  onDisconnect(): void;
  onEpochPending?(): void;
  onPeerRejected?(sender: RoomMember, error: Error): Promise<void> | void;
  onBufferAvailable?(): Promise<void> | void;
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
  'lease-request': 'presence',
  lease: 'presence',
  'workflow-request': 'application',
  'workflow-state': 'application',
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
  /** Ephemeral, owner-announced associations; never credentials or persisted room access. */
  profileBindings: Record<string, string> = {};
  private transport: RoomTransport;
  private policy?: SignedRoomPolicy;
  private epochTimer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private stopped = false;
  private cryptoQueue: Promise<unknown> = Promise.resolve();
  private assembler: CollaborationMessageAssembler;
  private framer: CollaborationMessageFramer;
  private outgoing = Promise.resolve();
  private quota = new CollaborationRelayQuota(Date.now, 350);
  private sendEpoch = new AbortController();
  private sent = new Map<string, number>();
  private pinnedOwner: string;
  private invitations = new Map<
    string,
    { authorization: InvitationAuthorization; expiresAt: number; reserved?: string }
  >();
  private leaseChallenge?: { nonce: string; wall: number; monotonic: number };
  private leaseGranted?: { wall: number; monotonic: number; epoch: number; revision: number };
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private leaseRefresh?: ReturnType<typeof setInterval>;
  private leaseBoot?: { wall: number; monotonic: number };
  private leaseReady = false;
  private bufferRecoveryTimer?: ReturnType<typeof setTimeout>;
  private controlBudget = { at: Date.now(), messages: 0, bytes: 0 };
  private peerControls = new Map<string, { at: number; messages: number }>();
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
      ...(options.invitation
        ? {
            invitation: options.invitation,
            keyPackage,
            invitationAuthorization: options.invitationAuthorization,
          }
        : {}),
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
  /** Publishing, projection and local live writes must all check the owner lease. */
  assertAuthorized() {
    this.check();
    if (!this.ready || !this.policy)
      throw new StorageError(423, 'The collaboration membership is not ready.');
    if (this.role !== 'owner' && !this.policyFresh) {
      throw new StorageError(
        423,
        'The owner membership lease expired. End this local session and request a fresh invitation. Your saved diagram is preserved.',
      );
    }
  }
  get policyFresh() {
    return (
      this.role === 'owner' ||
      (!!this.leaseGranted &&
        this.leaseGranted.epoch === this.policy?.policy.epoch &&
        this.leaseGranted.revision === this.policy?.policy.revision &&
        !this.elapsed(this.leaseGranted))
    );
  }
  private elapsed(start: { wall: number; monotonic: number }) {
    return (
      Date.now() < start.wall ||
      Date.now() - start.wall >= policyLeaseLimits.lifetimeMs ||
      performance.now() - start.monotonic >= policyLeaseLimits.lifetimeMs
    );
  }
  createInvitationAuthorization(
    scope: InvitationShareScope,
    expiresAt: number,
  ): InvitationAuthorization {
    this.assertAuthorized();
    if (this.role !== 'owner') throw new Error('Only the owner issues invitations.');
    for (const [id, invitation] of this.invitations)
      if (invitation.expiresAt <= Date.now()) this.invitations.delete(id);
    if (this.invitations.size >= relayLimits.invitations)
      throw new Error('Too many owner invitations. Revoke outstanding invitations first.');
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + relayLimits.invitationMs + 10_000 ||
      Object.values(scope).some((value) => typeof value !== 'boolean') ||
      Object.keys(scope).length !== 3 ||
      !['shareMetadata', 'shareOwners', 'shareDatasets'].every((field) => field in scope)
    )
      throw new Error('The owner invitation scope or expiry is invalid.');
    const authorization = {
      invitationId: crypto.randomUUID(),
      secret: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
      expiresAt,
      scope: { ...scope },
    };
    this.invitations.set(authorization.invitationId, {
      authorization: structuredClone(authorization),
      expiresAt,
    });
    return authorization;
  }
  async createInvitation(scope: InvitationShareScope) {
    const result = (await this.control('invite')) as {
      invitation: string;
      expiresAt: number;
      roomId: string;
    };
    this.assertAuthorized();
    if (result.roomId !== this.options.roomId)
      throw new Error('The invitation belongs to another room.');
    decode(result.invitation, 32, 32);
    return {
      ...result,
      authorization: this.createInvitationAuthorization(scope, result.expiresAt),
    };
  }
  private async verifyOwnerInvitation(request: PendingJoin) {
    this.check();
    const invitation = this.invitations.get(request.admission.authorization.invitationId);
    if (
      !invitation ||
      invitation.expiresAt <= Date.now() ||
      (invitation.reserved && invitation.reserved !== request.deviceId) ||
      request.expiresAt > invitation.expiresAt + 10_000 ||
      !(await verifyInvitation(
        this.options.roomId,
        request,
        request.keyPackage,
        request.expiresAt,
        request.admission.authorization,
        invitation.authorization,
      ))
    )
      throw new CollaborationAdmissionRejectedError(
        'This admission does not prove possession of an active owner invitation.',
      );
    this.check();
    if (
      this.invitations.get(request.admission.authorization.invitationId) !== invitation ||
      invitation.expiresAt <= Date.now()
    )
      throw new CollaborationAdmissionRejectedError('The owner invitation expired or was revoked.');
    return invitation;
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
  private armLeaseDeadline() {
    clearTimeout(this.leaseTimer);
    const start = this.leaseGranted ?? this.leaseBoot;
    if (!start || this.role === 'owner') return;
    const remaining = Math.max(
      0,
      policyLeaseLimits.lifetimeMs -
        Math.max(Date.now() - start.wall, performance.now() - start.monotonic),
    );
    this.leaseTimer = setTimeout(() => {
      if (this.stopped) return;
      if (!this.policyFresh) {
        const error = new Error(
          'The owner membership lease expired. End this local session and request a fresh invitation. Your saved diagram is preserved.',
        );
        this.dispose();
        this.options.onError(error);
      } else this.armLeaseDeadline();
    }, remaining);
  }
  private async membershipReady() {
    if (this.role === 'owner') {
      await this.options.onReady();
      return;
    }
    this.leaseGranted = undefined;
    this.leaseChallenge = undefined;
    this.leaseReady = false;
    this.leaseBoot = { wall: Date.now(), monotonic: performance.now() };
    this.options.onEpochPending?.();
    this.armLeaseDeadline();
    clearInterval(this.leaseRefresh);
    this.leaseRefresh = setInterval(() => {
      void this.requestLease().catch(() => {
        /* The bounded lease deadline remains authoritative. */
      });
    }, policyLeaseLimits.refreshMs);
    await this.requestLease();
  }
  private reserveLeaseControl(peer: string, bytes: number) {
    const now = Date.now();
    if (now < this.controlBudget.at) return false;
    if (now - this.controlBudget.at >= 60_000)
      this.controlBudget = { at: now, messages: 0, bytes: 0 };
    for (const [id, budget] of this.peerControls)
      if (now - budget.at >= 60_000) this.peerControls.delete(id);
    const budget = this.peerControls.get(peer);
    if (
      (!budget && this.peerControls.size >= 64) ||
      (budget?.messages ?? 0) >= 32 ||
      this.controlBudget.messages >= 224 ||
      this.controlBudget.bytes + bytes > 1024 * 1024
    )
      return false;
    // Every current member retains a bootstrap plus six ten-second renewals.
    // Burst transitions may use spare capacity, never another member's base share.
    const eligible =
      this.role === 'owner'
        ? this.policy!.policy.members.filter(
            (member) => member.deviceId !== this.device.deviceId,
          ).map((member) => member.deviceId)
        : [this.policy!.policy.ownerDeviceId];
    const reserved = eligible
      .filter((id) => id !== peer)
      .reduce((sum, id) => sum + Math.max(0, 7 - (this.peerControls.get(id)?.messages ?? 0)), 0);
    if (
      (budget?.messages ?? 0) >= 7 &&
      (this.controlBudget.messages + 1 + reserved > 224 ||
        this.controlBudget.bytes + bytes + reserved * 4096 > 1024 * 1024)
    )
      return false;
    this.peerControls.set(peer, { at: budget?.at ?? now, messages: (budget?.messages ?? 0) + 1 });
    ++this.controlBudget.messages;
    this.controlBudget.bytes += bytes;
    return true;
  }
  private async internalMessage(
    kind: 'lease-request' | 'lease',
    payload: Uint8Array,
    recipient: string,
  ): Promise<boolean> {
    if (payload.byteLength > 2048) throw new Error('The lease control payload exceeds its bound.');
    const epoch = this.epoch;
    const packets = await this.encrypt(kind, payload, recipient);
    if (packets.length !== 1) throw new Error('The lease control must use one frame.');
    const bytes = new TextEncoder().encode(JSON.stringify(packets[0])).byteLength + 1000;
    if (bytes > 4096) throw new Error('The lease control frame exceeds its reserved capacity.');
    if (!this.reserveLeaseControl(recipient, bytes)) return false;
    for (const packet of packets) {
      this.check();
      if (epoch !== this.epoch) return false;
      // Reserved small liveness frames must not wait behind a document quota batch.
      try {
        await this.transport.send({ kind: 'relay', ...packet }, epoch);
      } catch (error) {
        this.check();
        if (error instanceof CollaborationRelayError && error.code === 'STALE_EPOCH') {
          if (epoch === this.epoch) this.waitForEpoch(epoch);
          return false;
        }
        throw error;
      }
    }
    return true;
  }
  private async requestLease() {
    this.check();
    if (!this.ready || this.role === 'owner') return;
    if (
      (this.leaseGranted && this.elapsed(this.leaseGranted)) ||
      (this.leaseBoot && this.elapsed(this.leaseBoot))
    ) {
      this.assertAuthorized();
      return;
    }
    if (!this.leaseChallenge || this.elapsed(this.leaseChallenge))
      this.leaseChallenge = {
        nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
        wall: Date.now(),
        monotonic: performance.now(),
      };
    // Retries reuse the original challenge deadline; neither a delayed response
    // nor a resource-denied request can create a fresh authorization window.
    await this.internalMessage(
      'lease-request',
      new TextEncoder().encode(JSON.stringify({ nonce: this.leaseChallenge.nonce })),
      this.policy!.policy.ownerDeviceId,
    );
  }
  private async receiveLease(
    kind: 'lease-request' | 'lease',
    payload: Uint8Array,
    member: RoomMember,
  ) {
    if (payload.byteLength > 2048)
      throw new CollaborationPeerMessageError('Invalid owner membership lease.');
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    } catch {
      throw new CollaborationPeerMessageError('Invalid owner membership lease.');
    }
    if (kind === 'lease-request') {
      if (this.role !== 'owner')
        throw new CollaborationPeerMessageError('Only the owner answers policy lease requests.');
      let request: Record<string, unknown>;
      try {
        request = record(value, ['nonce']);
        decode(request.nonce, 32, 32);
      } catch {
        throw new CollaborationPeerMessageError('Invalid owner membership lease request.');
      }
      const epoch = this.epoch;
      const lease = await leaseInput(this.policy!, member.deviceId, request.nonce as string);
      const signature = await this.identity.sign('lease', lease);
      this.assertAuthorized();
      if (epoch !== this.epoch) return;
      await this.internalMessage(
        'lease',
        new TextEncoder().encode(JSON.stringify({ lease, signature })),
        member.deviceId,
      );
      return;
    }
    if (member.role !== 'owner')
      throw new CollaborationPeerMessageError('A membership lease must be signed by the owner.');
    const challenge = this.leaseChallenge;
    if (!challenge || this.elapsed(challenge))
      throw new CollaborationPeerMessageError('The owner membership lease challenge expired.');
    const epoch = this.epoch;
    try {
      await verifyPolicyLease(value, this.policy!, this.device.deviceId, challenge.nonce);
    } catch {
      throw new CollaborationPeerMessageError('Invalid owner membership lease response.');
    }
    this.check();
    if (epoch !== this.epoch || challenge !== this.leaseChallenge || this.elapsed(challenge))
      return;
    this.leaseGranted = {
      wall: challenge.wall,
      monotonic: challenge.monotonic,
      epoch,
      revision: this.policy!.policy.revision,
    };
    this.leaseChallenge = undefined;
    this.leaseBoot = undefined;
    this.armLeaseDeadline();
    if (!this.leaseReady) {
      this.leaseReady = true;
      await this.options.onReady();
      this.assertAuthorized();
    }
  }
  private async receive(frame: ServerFrame) {
    this.check();
    if (frame.type === 'pending') return;
    if (frame.type === 'join-request') {
      if (this.role !== 'owner') throw new Error('Unexpected admission request.');
      const request = await verifyPendingJoin(frame.request, this.options.roomId);
      const invitation = await this.verifyOwnerInvitation(request);
      invitation.reserved = request.deviceId;
      this.check();
      this.options.onJoin(request);
      return;
    }
    if (frame.type === 'authenticated') {
      await this.serialized(async () => {
        const policy = await verifyRoomPolicy(
          frame.policy,
          this.options.roomId,
          this.pinnedOwner,
          this.policy,
        );
        // Reconnecting metadata cannot substitute for the missing MLS transcript.
        assertMlsPolicy(await this.mls.info(), policy.policy);
        this.policy = policy;
        this.ready = true;
        this.options.onPolicy(policy);
      });
      await this.membershipReady();
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
      await this.membershipReady();
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
          this.policy = next;
          this.clearEpochWait();
          this.sent.clear();
          this.options.onPolicy(next);
        } finally {
          result.payload?.fill(0);
        }
      });
      await this.membershipReady();
      return;
    }
    if (frame.type === 'relay') {
      if (!this.ready || !this.policy)
        throw new Error('The group is not ready for document messages.');
      const command = frame.command;
      validatePeerCommand(command, this.options.roomId);
      // Rapid membership changes can leave any number of earlier-epoch frames
      // in flight. Their metadata must be well formed, but they authorize nothing:
      // discard them before role checks or touching the current MLS ratchet.
      if (command.epoch < this.epoch) return;
      const recipient = (command.body as EncryptedPacket).recipient;
      if (recipient !== undefined && recipient !== this.device.deviceId)
        throw new Error('The relay delivered a message addressed to a different participant.');
      let message: MlsProcessResult | undefined;
      let completed: CollaborationReassembledMessage | undefined;
      try {
        const accepted = await this.serialized(async () => {
          // The relay can deliver a new-epoch peer response after accepting an
          // owner commit but before this browser finishes confirming it. Capture
          // policy and verify ACL only after that serialized transition completes.
          // Frames superseded while queued authorize nothing and never decrypt.
          if (command.epoch < this.epoch) return undefined;
          const approvedPolicy = this.policy!;
          const member = await verifyPeerCommand(command, approvedPolicy);
          if ((command.body as EncryptedPacket).payloadKind !== 'presence') {
            if (!this.policyFresh && !this.leaseReady) return undefined;
            this.assertAuthorized();
          }
          const key = await binaryHash(
            decodeBytes((command.body as EncryptedPacket).ciphertext, 128 * 1024),
          );
          if (this.sent.has(key)) return undefined;
          message = await this.mls.process({
            ciphertext: (command.body as EncryptedPacket).ciphertext,
            expectedDeviceId: member.deviceId,
          });
          if ((command.body as EncryptedPacket).payloadKind !== 'presence') this.assertAuthorized();
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
          return { message, member, approvedEpoch: approvedPolicy.policy.epoch };
        });
        if (!accepted?.message.payload) return;
        const { message: result, member, approvedEpoch } = accepted;
        try {
          completed = await this.assembler.accept(member.deviceId, approvedEpoch, result.payload!, {
            role: member.role,
            wireKind: (command.body as EncryptedPacket).payloadKind,
          });
        } catch (error) {
          // Other senders may have filled the aggregate receiver budget. This
          // backpressure is not evidence of abuse by the arriving participant.
          if (error instanceof CollaborationBufferBusyError) {
            this.recoverBufferPressure();
            return;
          }
          // The MLS application was authenticated and its receiver generation is
          // consumed. Invalid inner framing cannot change membership or a document.
          // Resource pressure retires only the authenticated sender and asks
          // the controller to show recovery instead of disconnecting all peers.
          // Lock/epoch cancellation and unknown failures also remain fatal.
          if (
            error instanceof CollaborationFramingError &&
            [
              'COLLABORATION_INVALID_FRAME',
              'COLLABORATION_FRAME_CONFLICT',
              'COLLABORATION_HASH_MISMATCH',
              'COLLABORATION_MESSAGE_LIMIT',
              'COLLABORATION_MESSAGE_EXPIRED',
            ].includes(error.code)
          ) {
            this.assembler.discardSender(member.deviceId);
            await this.options.onPeerRejected?.(member, error);
            throw new CollaborationPeerMessageError(error.message);
          }
          throw error;
        }
        if (!completed) return;
        this.check();
        if (approvedEpoch !== this.epoch) return;
        if (
          wireKinds[completed.kind] !== (command.body as EncryptedPacket).payloadKind ||
          (member.role === 'viewer' &&
            !['presence', 'sync', 'lease-request'].includes(completed.kind))
        )
          throw new CollaborationPeerMessageError(
            'The encrypted operation exceeds the participant permission.',
          );
        if (completed.kind === 'lease-request' || completed.kind === 'lease') {
          await this.receiveLease(completed.kind, completed.payload, member);
          return;
        }
        if (!this.policyFresh) return; // Startup/transition content is recovered after a fresh owner response.
        this.assertAuthorized();
        try {
          await this.options.onMessage(completed.kind, completed.payload, member);
        } catch (error) {
          if (error instanceof CollaborationPeerMessageError) {
            this.assembler.discardSender(member.deviceId);
            await this.options.onPeerRejected?.(member, error);
          }
          throw error;
        }
        this.assertAuthorized();
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
      if (!['lease-request', 'lease'].includes(kind)) this.assertAuthorized();
      if (this.role === 'viewer' && !['presence', 'sync', 'lease-request'].includes(kind))
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
      if (!['lease-request', 'lease'].includes(kind)) this.assertAuthorized();
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
        this.assertAuthorized();
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
    clearTimeout(this.bufferRecoveryTimer);
    this.bufferRecoveryTimer = undefined;
    this.sendEpoch.abort();
    this.sendEpoch = new AbortController();
  }
  private recoverBufferPressure() {
    if (this.bufferRecoveryTimer || !this.options.onBufferAvailable) return;
    // Coalesce recovery outside the ordered receive loop, after incomplete
    // assemblies expire. A lost bootstrap must not leave a recipient stranded.
    this.bufferRecoveryTimer = setTimeout(() => {
      this.bufferRecoveryTimer = undefined;
      if (this.stopped || !this.ready || !this.policyFresh) return;
      void Promise.resolve()
        .then(() => {
          this.assertAuthorized();
          return this.options.onBufferAvailable?.();
        })
        .catch((error) => {
          if (!this.stopped) this.options.onError(error);
        });
    }, collaborationFrameLimits.timeoutMs + 1);
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
      for (const [id, invitation] of this.invitations)
        if (invitation.reserved === deviceId) this.invitations.delete(id);
      if (!deviceId) throw new Error('Select a device.');
      return this.transport.send({ kind, deviceId }, this.epoch);
    }
    if (kind === 'revoke-invitations' || kind === 'delete-room') this.invitations.clear();
    return this.transport.send({ kind }, this.epoch);
  }
  async changeMembers(members: RoomMember[], admission?: PendingJoin) {
    members = structuredClone(members);
    this.cancelPendingSends();
    await this.serialized(async () => {
      if (this.role !== 'owner' || !this.policy)
        throw new Error('Only the room owner can change access.');
      const previous = this.policy;
      const added = members.filter(
        (member) => !previous.policy.members.some((prior) => prior.deviceId === member.deviceId),
      );
      if (admission) {
        admission = await verifyPendingJoin(admission, this.options.roomId);
        const invitation = await this.verifyOwnerInvitation(admission);
        invitation.reserved = admission.deviceId;
        this.check();
        if (added.length !== 1 || !sameIdentity(added[0], admission))
          throw new Error('The new participant differs from the verified admission.');
      } else if (added.length) {
        throw new Error('A device-signed admission is required for a new participant.');
      }
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
        this.policy = signed;
        this.invitations.clear();
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
    clearTimeout(this.leaseTimer);
    clearInterval(this.leaseRefresh);
    clearTimeout(this.bufferRecoveryTimer);
    this.bufferRecoveryTimer = undefined;
    this.leaseChallenge = undefined;
    this.leaseGranted = undefined;
    this.invitations.clear();
    this.peerControls.clear();
    this.sendEpoch.abort();
    this.quota.clear();
    this.transport.close();
    this.assembler.dispose();
    this.mls.dispose();
    this.identity.destroy();
    this.sent.clear();
  }
}
