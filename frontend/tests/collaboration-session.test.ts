import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeviceIdentity,
  PendingJoin,
  RoomMember,
  SignedCommand,
  SignedRoomPolicy,
} from '../../collaboration-worker/src/protocol';
import { admissionInput, relayLimits } from '../../collaboration-worker/src/protocol';
import {
  CollaborationRelayError,
  CollaborationConnectionError,
  CollaborationPeerMessageError,
  type RoomTransportOptions,
} from '../src/collaboration/transport/room-transport';
import type {
  MlsDeviceCredential,
  MlsGroupInfo,
  MlsProcessResult,
} from '../src/collaboration/crypto-types';
import {
  createTransportIdentity,
  encodeBytes,
  type TransportIdentity,
} from '../src/collaboration/transport/identity';
import { leaseInput, policyLeaseLimits } from '../src/collaboration/transport/policy-lease';
import { proveInvitation } from '../src/collaboration/transport/invitation-authorization';
import { binaryHash } from '../src/collaboration/transport/policy';
import {
  CollaborationFramingError,
  CollaborationBufferBusyError,
  CollaborationMessageAssembler,
  CollaborationMessageFramer,
} from '../src/collaboration/sync/message-framing';
import {
  EncryptedRoom,
  type EncryptedRoomOptions,
} from '../src/collaboration/session/encrypted-room';

// These tests exercise session orchestration with real device/policy signatures.
// MLS is a lifecycle fixture here; real OpenMLS encryption has separate native tests.
const hooks = vi.hoisted(() => ({ create: vi.fn(), transports: [] as FakeTransport[] }));
vi.mock('../src/collaboration/crypto', () => ({
  MlsSession: { create: (input: unknown) => hooks.create(input) },
}));
vi.mock('../src/collaboration/transport/room-transport', async (original) => {
  const actual = await original<typeof import('../src/collaboration/transport/room-transport')>();
  return {
    ...actual,
    RoomTransport: class {
      created?: SignedRoomPolicy;
      send = vi.fn(async (_body: SignedCommand['body'], _epoch: number): Promise<unknown> => ({}));
      close = vi.fn();
      disconnect = vi.fn();
      create = vi.fn(async (policy: SignedRoomPolicy) => {
        this.created = policy;
      });
      connect = vi.fn(async () => {
        if (this.created)
          await this.options.onFrame({
            type: 'authenticated',
            protocol: 1,
            policy: this.created,
            role: 'owner',
          });
      });
      constructor(readonly options: RoomTransportOptions) {
        hooks.transports.push(this);
      }
    },
  };
});
interface FakeTransport {
  options: RoomTransportOptions;
  send: ReturnType<typeof vi.fn<(body: SignedCommand['body'], epoch: number) => Promise<unknown>>>;
  close: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}
class FakeMls {
  readonly key = encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
  state!: MlsGroupInfo;
  pending?: MlsGroupInfo;
  signaturePublicKey = vi.fn(async () => this.key);
  keyPackage = vi.fn(async () => encodeBytes(Uint8Array.of(11, 12, 13)));
  info = vi.fn(async () => structuredClone(this.state));
  dispose = vi.fn();
  encrypt = vi.fn(async (_bytes: Uint8Array) =>
    encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
  );
  process = vi.fn(
    async (_input: { ciphertext: string; expectedDeviceId: string }): Promise<MlsProcessResult> => {
      throw new Error('No MLS fixture payload.');
    },
  );
  join = vi.fn(async (_input: unknown) => {});
  createGroup = vi.fn(async (roomId: string) => {
    this.state = {
      roomId,
      epoch: 0,
      active: true,
      ownDeviceId: this.identity.deviceId,
      ownerDeviceId: this.identity.deviceId,
      members: [
        {
          deviceId: this.identity.deviceId,
          transportKeyFingerprint: this.identity.credentialId,
          signaturePublicKey: this.key,
          leafIndex: 0,
        },
      ],
    };
  });
  prepareAddMember = vi.fn(
    async (input: MlsDeviceCredential & { keyPackage: string; expectedSignatureKey: string }) => {
      this.pending = {
        ...structuredClone(this.state),
        epoch: this.state.epoch + 1,
        members: [
          ...this.state.members,
          {
            deviceId: input.deviceId,
            transportKeyFingerprint: input.credentialId,
            signaturePublicKey: input.expectedSignatureKey,
            leafIndex: this.state.members.length,
          },
        ],
      };
      return this.staged();
    },
  );
  prepareRemoveMember = vi.fn(async (deviceId: string) => {
    this.pending = {
      ...structuredClone(this.state),
      epoch: this.state.epoch + 1,
      members: this.state.members.filter((member) => member.deviceId !== deviceId),
    };
    return { ...this.staged(), welcome: null };
  });
  prepareRotate = vi.fn(async () => {
    this.pending = { ...structuredClone(this.state), epoch: this.state.epoch + 1 };
    return { ...this.staged(), welcome: null };
  });
  confirmPendingCommit = vi.fn(async () => {
    this.state = this.pending!;
    this.pending = undefined;
  });
  discardPendingCommit = vi.fn(async () => {
    this.pending = undefined;
  });
  constructor(readonly identity: MlsDeviceCredential) {}
  private staged() {
    return {
      commit: encodeBytes(Uint8Array.of(1, 2, 3)),
      welcome: encodeBytes(Uint8Array.of(4, 5, 6)),
      nextEpoch: this.pending!.epoch,
    };
  }
}
const rooms: EncryptedRoom[] = [];
const identities: TransportIdentity[] = [];
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  hooks.transports.length = 0;
  hooks.create.mockImplementation(async (input: MlsDeviceCredential) => new FakeMls(input));
});
afterEach(() => {
  rooms.forEach((room) => room.dispose());
  rooms.length = 0;
  identities.forEach((identity) => identity.destroy());
  identities.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function participant() {
  const identity = await createTransportIdentity();
  identities.push(identity);
  const device: DeviceIdentity = {
    ...identity.public,
    mlsSignatureKey: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
  };
  return { identity, device };
}
async function fixture(patch: Partial<EncryptedRoomOptions> = {}) {
  const abort = new AbortController();
  const options: EncryptedRoomOptions = {
    roomId: crypto.randomUUID(),
    diagramId: crypto.randomUUID(),
    relay: 'https://relay.example.test',
    signal: abort.signal,
    check: () => {
      if (abort.signal.aborted) throw new DOMException('Workspace locked.', 'AbortError');
    },
    onPolicy: vi.fn(),
    onJoin: vi.fn(),
    onReady: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    ...patch,
  };
  const room = await EncryptedRoom.open(options);
  rooms.push(room);
  const mls = (await hooks.create.mock.results.at(-1)!.value) as FakeMls;
  const transport = hooks.transports.at(-1)!;
  if (!patch.invitation) await room.create();
  return { room, mls, transport, options, abort };
}
async function admit(f: Awaited<ReturnType<typeof fixture>>, role: 'editor' | 'viewer' = 'editor') {
  const peer = await participant();
  const request = await admission(f.options.roomId, peer);
  await f.room.changeMembers(
    [...f.room.currentPolicy!.policy.members, { ...peer.device, role }],
    request,
  );
  return peer;
}
async function admission(
  roomId: string,
  peer: Awaited<ReturnType<typeof participant>>,
): Promise<PendingJoin> {
  const keyPackage = encodeBytes(Uint8Array.of(7, 8, 9));
  const expiresAt = Date.now() + relayLimits.pendingJoinMs;
  const owner = rooms.find(
    (room) => room.currentPolicy?.policy.roomId === roomId && room.role === 'owner',
  );
  if (!owner) throw new Error('No owner invitation fixture.');
  const issued = owner.createInvitationAuthorization(
    { shareMetadata: false, shareOwners: false, shareDatasets: false },
    expiresAt,
  );
  const authorization = await proveInvitation(roomId, peer.device, keyPackage, expiresAt, issued);
  return {
    ...peer.device,
    keyPackage,
    expiresAt,
    admission: {
      expiresAt,
      authorization,
      signature: await peer.identity.sign(
        'admission',
        admissionInput(roomId, peer.device, keyPackage, expiresAt, authorization),
      ),
    },
  };
}
async function relay(
  f: Awaited<ReturnType<typeof fixture>>,
  peer: Awaited<ReturnType<typeof participant>>,
  kind: 'update' | 'presence' | 'snapshot' | 'sync' = 'update',
  patch: Partial<Extract<SignedCommand['body'], { kind: 'relay' }>> = {},
) {
  const payload = new TextEncoder().encode('synthetic shared payload');
  const [frame] = await new CollaborationMessageFramer(f.options.diagramId).encode(kind, payload);
  f.mls.process.mockResolvedValue({
    kind: 'application',
    senderDeviceId: peer.device.deviceId,
    senderSignaturePublicKey: peer.device.mlsSignatureKey,
    epoch: f.room.epoch,
    payload: frame,
  });
  const wire = {
    update: 'application',
    snapshot: 'snapshot',
    sync: 'sync-request',
    presence: 'presence',
  } as const;
  const unsigned: Omit<SignedCommand, 'signature'> = {
    type: 'command',
    protocol: 1,
    roomId: f.options.roomId,
    connectionId: crypto.randomUUID(),
    deviceId: peer.device.deviceId,
    sequence: 1,
    epoch: f.room.epoch,
    body: {
      kind: 'relay',
      payloadKind: wire[kind],
      ciphertext: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
      ...patch,
    },
  };
  return {
    command: { ...unsigned, signature: await peer.identity.sign('command', unsigned) },
    payload,
    frame,
  };
}

async function grantLease(
  f: Awaited<ReturnType<typeof fixture>>,
  owner: Awaited<ReturnType<typeof participant>>,
  patch: Record<string, unknown> = {},
) {
  const challenge = (f.room as unknown as { leaseChallenge?: { nonce: string } }).leaseChallenge;
  if (!challenge) throw new Error('No freshness challenge.');
  const lease = {
    ...(await leaseInput(f.room.currentPolicy!, f.room.device.deviceId, challenge.nonce)),
    ...patch,
  };
  const signature = await owner.identity.sign('lease', lease);
  const [payload] = await new CollaborationMessageFramer(f.options.diagramId).encode(
    'lease',
    new TextEncoder().encode(JSON.stringify({ lease, signature })),
  );
  f.mls.process.mockResolvedValueOnce({
    kind: 'application',
    senderDeviceId: owner.device.deviceId,
    senderSignaturePublicKey: owner.device.mlsSignatureKey,
    epoch: f.room.epoch,
    payload,
  });
  const unsigned: Omit<SignedCommand, 'signature'> = {
    type: 'command',
    protocol: 1,
    roomId: f.options.roomId,
    connectionId: crypto.randomUUID(),
    deviceId: owner.device.deviceId,
    sequence: 1,
    epoch: f.room.epoch,
    body: {
      kind: 'relay',
      payloadKind: 'presence',
      recipient: f.room.device.deviceId,
      ciphertext: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
    },
  };
  await f.transport.options.onFrame({
    type: 'relay',
    protocol: 1,
    command: { ...unsigned, signature: await owner.identity.sign('command', unsigned) },
  });
}
async function joined(patch: Partial<EncryptedRoomOptions> = {}) {
  const owner = await participant();
  const f = await fixture({
    invitation: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
    ownerCredential: owner.device.credentialId,
    ownerDeviceId: owner.device.deviceId,
    ...patch,
  });
  const commit = encodeBytes(Uint8Array.of(1, 2, 3)),
    welcome = encodeBytes(Uint8Array.of(4, 5, 6));
  const policy = {
    protocol: 1 as const,
    roomId: f.options.roomId,
    ownerDeviceId: owner.device.deviceId,
    revision: 2,
    epoch: 1,
    members: [
      { ...owner.device, role: 'owner' as const },
      { ...f.room.device, role: 'editor' as const },
    ],
    transition: {
      previousEpoch: 0,
      commitHash: await binaryHash(Uint8Array.of(1, 2, 3)),
      welcomeHashes: [
        { deviceId: f.room.device.deviceId, hash: await binaryHash(Uint8Array.of(4, 5, 6)) },
      ],
    },
  };
  f.mls.join.mockImplementation(async () => {
    f.mls.state = {
      roomId: policy.roomId,
      epoch: 1,
      active: true,
      ownDeviceId: f.room.device.deviceId,
      ownerDeviceId: owner.device.deviceId,
      members: policy.members.map((member, leafIndex) => ({
        deviceId: member.deviceId,
        transportKeyFingerprint: member.credentialId,
        signaturePublicKey: member.mlsSignatureKey,
        leafIndex,
      })),
    };
  });
  await f.transport.options.onFrame({
    type: 'welcome',
    protocol: 1,
    policy: { policy, signature: await owner.identity.sign('policy', policy) },
    commit,
    ciphertext: welcome,
  });
  return { f, owner };
}

async function guestRoleTransition(
  f: Awaited<ReturnType<typeof fixture>>,
  owner: Awaited<ReturnType<typeof participant>>,
  role: 'editor' | 'viewer',
) {
  const commitBytes = Uint8Array.of(31, 32, 33);
  const previous = f.room.currentPolicy!.policy;
  const next = {
    ...previous,
    epoch: previous.epoch + 1,
    revision: previous.revision + 1,
    members: previous.members.map((member) =>
      member.deviceId === f.room.device.deviceId ? { ...member, role } : member,
    ),
    transition: {
      previousEpoch: previous.epoch,
      commitHash: await binaryHash(commitBytes),
      welcomeHashes: [],
    },
  };
  f.mls.process.mockImplementationOnce(async () => {
    f.mls.state = { ...f.mls.state, epoch: next.epoch };
    return {
      kind: 'commit',
      senderDeviceId: owner.device.deviceId,
      senderSignaturePublicKey: owner.device.mlsSignatureKey,
      epoch: next.epoch,
    };
  });
  await f.transport.options.onFrame({
    type: 'policy',
    protocol: 1,
    policy: { policy: next, signature: await owner.identity.sign('policy', next) },
    commit: encodeBytes(commitBytes),
  });
}

describe('encrypted room session authorization and lifecycle', () => {
  it('independently verifies a device-signed pending admission before showing an owner approval request', async () => {
    const f = await fixture(),
      peer = await participant();
    const request = await admission(f.options.roomId, peer);
    await f.transport.options.onFrame({ type: 'join-request', protocol: 1, request });
    expect(f.options.onJoin).toHaveBeenCalledWith(request);
    vi.mocked(f.options.onJoin).mockClear();
    await expect(
      f.transport.options.onFrame({
        type: 'join-request',
        protocol: 1,
        request: { ...request, credentialId: '0'.repeat(64) },
      }),
    ).rejects.toThrow(/identity|fingerprint|thumbprint/i);
    expect(f.options.onJoin).not.toHaveBeenCalled();
  });
  it('rejects a changed or missing admission proof before showing it or staging an MLS join', async () => {
    const f = await fixture(),
      peer = await participant();
    const request = await admission(f.options.roomId, peer);
    const noProof = structuredClone(request) as Partial<PendingJoin>;
    delete noProof.admission;
    for (const invalid of [
      { ...request, keyPackage: encodeBytes(Uint8Array.of(21, 22)) },
      { ...request, mlsSignatureKey: encodeBytes(crypto.getRandomValues(new Uint8Array(32))) },
      noProof,
    ]) {
      await expect(
        f.transport.options.onFrame({
          type: 'join-request',
          protocol: 1,
          request: invalid as PendingJoin,
        }),
      ).rejects.toThrow();
      await expect(
        f.room.changeMembers(
          [...f.room.currentPolicy!.policy.members, { ...peer.device, role: 'editor' }],
          invalid as PendingJoin,
        ),
      ).rejects.toThrow();
    }
    expect(f.options.onJoin).not.toHaveBeenCalled();
    expect(f.mls.prepareAddMember).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rechecks a displayed admission after mutation or expiry before staging membership', async () => {
    const f = await fixture(),
      peer = await participant();
    const request = await admission(f.options.roomId, peer);
    await f.transport.options.onFrame({ type: 'join-request', protocol: 1, request });
    const displayed = vi.mocked(f.options.onJoin).mock.calls[0][0];
    displayed.keyPackage = encodeBytes(Uint8Array.of(31, 32));
    await expect(
      f.room.changeMembers(
        [...f.room.currentPolicy!.policy.members, { ...peer.device, role: 'editor' }],
        displayed,
      ),
    ).rejects.toThrow(/admission/i);
    vi.spyOn(Date, 'now').mockReturnValue(request.expiresAt);
    await expect(
      f.room.changeMembers(
        [...f.room.currentPolicy!.policy.members, { ...peer.device, role: 'editor' }],
        request,
      ),
    ).rejects.toThrow(/EXPIRY/i);
    expect(f.mls.prepareAddMember).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('rechecks workspace cancellation after admission verification before showing or staging it', async () => {
    const f = await fixture(),
      peer = await participant();
    const request = await admission(f.options.roomId, peer);
    const verifying = f.transport.options.onFrame({ type: 'join-request', protocol: 1, request });
    f.abort.abort();
    await expect(verifying).rejects.toThrow(/locked|closed/);
    expect(f.options.onJoin).not.toHaveBeenCalled();
    expect(f.mls.prepareAddMember).not.toHaveBeenCalled();
  });
  it('creates a signed owner-only group and binds admitted KeyPackage to its approved MLS signature key', async () => {
    const f = await fixture();
    expect(f.room.role).toBe('owner');
    expect(f.room.epoch).toBe(0);
    const peer = await admit(f);
    expect(f.mls.prepareAddMember).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSignatureKey: peer.device.mlsSignatureKey }),
    );
    expect(f.mls.confirmPendingCommit).toHaveBeenCalledOnce();
    expect(f.room.epoch).toBe(1);
    expect(f.room.currentPolicy!.policy.members).toHaveLength(2);
  });
  it('checks authenticated MLS author, key and epoch before delivering a reassembled update', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command, payload, frame } = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command });
    expect(f.options.onMessage).toHaveBeenCalledOnce();
    expect(f.options.onMessage).toHaveBeenCalledWith(
      'update',
      expect.any(Uint8Array),
      expect.objectContaining({ deviceId: peer.device.deviceId }),
    );
    expect(frame.every((byte) => byte === 0)).toBe(true);
    expect(payload.some((byte) => byte !== 0)).toBe(true);
  });
  it('rejects a mismatch between transport author and authenticated MLS author', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command } = await relay(f, peer);
    const decrypted = Uint8Array.of(1);
    f.mls.process.mockResolvedValue({
      kind: 'application',
      senderDeviceId: f.room.device.deviceId,
      senderSignaturePublicKey: f.room.device.mlsSignatureKey,
      epoch: f.room.epoch,
      payload: decrypted,
    });
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow(/MLS author/);
    expect(f.options.onMessage).not.toHaveBeenCalled();
    expect(decrypted.every((byte) => byte === 0)).toBe(true);
  });
  it('suppresses an identical delivered ciphertext without reusing the MLS receiver generation', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command } = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command });
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command });
    expect(f.mls.process).toHaveBeenCalledOnce();
    expect(f.options.onMessage).toHaveBeenCalledOnce();
  });
  it('discards an authenticated old-epoch frame queued behind a membership removal and continues in the new epoch', async () => {
    const f = await fixture(),
      removed = await admit(f),
      remaining = await admit(f);
    const { command } = await relay(f, removed);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepareRemove = f.mls.prepareRemoveMember.getMockImplementation()!;
    f.mls.prepareRemoveMember.mockImplementation(async (deviceId) => {
      entered();
      await blocked;
      return prepareRemove(deviceId);
    });
    const changing = f.room.changeMembers(
      f.room.currentPolicy!.policy.members.filter(
        (member) => member.deviceId !== removed.device.deviceId,
      ),
    );
    await started;
    const queue = () => (f.room as unknown as { cryptoQueue: Promise<unknown> }).cryptoQueue;
    const before = queue();
    const receiving = Promise.resolve(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    );
    await vi.waitFor(() => expect(queue()).not.toBe(before));
    release();
    await changing;
    await receiving;
    expect(f.room.epoch).toBe(3);
    expect(f.mls.process).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    const fresh = await relay(f, remaining);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: fresh.command });
    expect(f.mls.process).toHaveBeenCalledOnce();
    expect(f.options.onMessage).toHaveBeenCalledOnce();
  });
  it('validates a new-epoch lease request only after the accepted owner commit finishes locally', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const confirm = f.mls.confirmPendingCommit.getMockImplementation()!;
    for (let i = 0; i < 10; ++i) {
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.mls.confirmPendingCommit.mockImplementationOnce(async () => {
        entered();
        await blocked;
        await confirm();
      });
      const previousEpoch = f.room.epoch;
      const changing = f.room.changeMembers(
        f.room.currentPolicy!.policy.members.map((member) =>
          member.deviceId === peer.device.deviceId
            ? { ...member, role: i % 2 === 0 ? ('viewer' as const) : ('editor' as const) }
            : member,
        ),
      );
      await started;
      expect(f.room.epoch).toBe(previousEpoch);
      const [payload] = await new CollaborationMessageFramer(f.options.diagramId).encode(
        'lease-request',
        new TextEncoder().encode(
          JSON.stringify({ nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))) }),
        ),
      );
      f.mls.process.mockResolvedValueOnce({
        kind: 'application',
        senderDeviceId: peer.device.deviceId,
        senderSignaturePublicKey: peer.device.mlsSignatureKey,
        epoch: previousEpoch + 1,
        payload,
      });
      const unsigned: Omit<SignedCommand, 'signature'> = {
        type: 'command',
        protocol: 1,
        roomId: f.options.roomId,
        connectionId: crypto.randomUUID(),
        deviceId: peer.device.deviceId,
        sequence: i + 1,
        epoch: previousEpoch + 1,
        body: {
          kind: 'relay',
          payloadKind: 'presence',
          recipient: f.room.device.deviceId,
          ciphertext: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
        },
      };
      const before = (f.room as unknown as { cryptoQueue: Promise<unknown> }).cryptoQueue;
      const receiving = Promise.resolve(
        f.transport.options.onFrame({
          type: 'relay',
          protocol: 1,
          command: { ...unsigned, signature: await peer.identity.sign('command', unsigned) },
        }),
      );
      await vi.waitFor(() =>
        expect((f.room as unknown as { cryptoQueue: Promise<unknown> }).cryptoQueue).not.toBe(
          before,
        ),
      );
      release();
      await changing;
      await receiving;
      expect(f.room.epoch).toBe(previousEpoch + 1);
      expect(f.options.onError).not.toHaveBeenCalled();
    }
    expect(f.mls.process).toHaveBeenCalledTimes(10);
    expect(f.options.onMessage).not.toHaveBeenCalled();
    expect(
      f.transport.send.mock.calls.filter(
        ([body]) => body.kind === 'relay' && body.payloadKind === 'presence',
      ),
    ).toHaveLength(10);
  });
  it('does not deliver old-epoch plaintext if membership changes during message assembly', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command, frame } = await relay(f, peer);
    let release!: () => void, entered!: () => void, assembled: Uint8Array | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const accept = CollaborationMessageAssembler.prototype.accept;
    const spy = vi
      .spyOn(CollaborationMessageAssembler.prototype, 'accept')
      .mockImplementation(async function (this: CollaborationMessageAssembler, ...args) {
        const completed = await accept.apply(this, args);
        assembled = completed!.payload;
        entered();
        await blocked;
        return completed;
      });
    try {
      const receiving = Promise.resolve(
        f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
      );
      await started;
      await f.room.changeMembers([f.room.currentPolicy!.policy.members[0]]);
      release();
      await receiving;
      expect(f.options.onMessage).not.toHaveBeenCalled();
      expect(frame.every((byte) => byte === 0)).toBe(true);
      expect(assembled!.every((byte) => byte === 0)).toBe(true);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it('discards earlier-epoch frames after removal without retaining old decryption keys', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command } = await relay(f, peer);
    await f.room.changeMembers([f.room.currentPolicy!.policy.members[0]]);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command });
    expect(f.room.epoch).toBe(2);
    expect(f.mls.process).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    await f.transport.options.onFrame({
      type: 'relay',
      protocol: 1,
      command: { ...command, signature: encodeBytes(crypto.getRandomValues(new Uint8Array(64))) },
    });
    // Discarding authorizes no action and needs no retained public policy history.
    await f.room.changeMembers(f.room.currentPolicy!.policy.members);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command });
    expect(f.mls.process).not.toHaveBeenCalled();
  });
  it('unblocks the ordered policy reader after a correlated stale-epoch send and waits for a verified transition', async () => {
    vi.useFakeTimers();
    const onEpochPending = vi.fn(),
      f = await fixture({ onEpochPending });
    f.transport.send.mockRejectedValueOnce(new CollaborationRelayError('STALE_EPOCH'));
    await expect(f.room.message('sync', new Uint8Array([0]))).resolves.toBeUndefined();
    expect(onEpochPending).toHaveBeenCalledOnce();
    expect(f.room.epoch).toBe(0);
    expect(f.options.onError).not.toHaveBeenCalled();
    expect(f.transport.close).not.toHaveBeenCalled();
    // A relay error never advances membership. Only a verified owner commit
    // clears the pending transition timeout and enables the new epoch.
    await f.room.changeMembers(f.room.currentPolicy!.policy.members);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(f.room.epoch).toBe(1);
    expect(f.options.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a missing signed transition and does not treat other rejections as stale recovery', async () => {
    vi.useFakeTimers();
    const f = await fixture({ onEpochPending: vi.fn() });
    f.transport.send.mockRejectedValueOnce(new CollaborationRelayError('STALE_EPOCH'));
    await f.room.message('presence', Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(30_001);
    expect(f.options.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('signed membership update') }),
    );
    expect(f.room.epoch).toBe(0);
    f.transport.send.mockRejectedValueOnce(new CollaborationRelayError('ROLE_FORBIDDEN'));
    await expect(f.room.message('update', Uint8Array.of(1))).rejects.toMatchObject({
      code: 'ROLE_FORBIDDEN',
    });
  });
  it('accepts same-epoch reconnection but rejects metadata that lacks its authenticated MLS transition', async () => {
    const f = await fixture();
    await admit(f);
    f.transport.connect.mockImplementation(async () => {
      await f.transport.options.onFrame({
        type: 'authenticated',
        protocol: 1,
        policy: f.room.currentPolicy!,
        role: 'owner',
      });
    });
    await f.room.reconnect();
    expect(f.transport.disconnect).toHaveBeenCalledOnce();
    const policy = {
      ...f.room.currentPolicy!.policy,
      epoch: 2,
      revision: 3,
      transition: { previousEpoch: 1, commitHash: 'a'.repeat(64), welcomeHashes: [] },
    };
    const signed = { policy, signature: await f.room.identity.sign('policy', policy) };
    await expect(
      f.transport.options.onFrame({
        type: 'authenticated',
        protocol: 1,
        policy: signed,
        role: 'owner',
      }),
    ).rejects.toThrow(/MLS state/);
    expect(f.room.epoch).toBe(1);
  });
  it('rejects a viewer masking an encrypted update as permitted outer presence', async () => {
    const f = await fixture(),
      peer = await admit(f, 'viewer');
    const { command } = await relay(f, peer, 'update', { payloadKind: 'presence' });
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow(CollaborationPeerMessageError);
    expect(f.options.onMessage).not.toHaveBeenCalled();
    const valid = await relay(f, peer, 'presence');
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: valid.command });
    expect(f.options.onMessage).toHaveBeenCalledWith(
      'presence',
      expect.any(Uint8Array),
      expect.objectContaining({ deviceId: peer.device.deviceId }),
    );
  });
  it('classifies malformed authenticated application framing without hiding crypto failures', async () => {
    const onPeerRejected = vi.fn();
    const f = await fixture({ onPeerRejected }),
      peer = await admit(f, 'viewer');
    const { command } = await relay(f, peer, 'presence');
    const plaintext = Uint8Array.of(1, 2, 3);
    f.mls.process.mockResolvedValueOnce({
      kind: 'application',
      senderDeviceId: peer.device.deviceId,
      senderSignaturePublicKey: peer.device.mlsSignatureKey,
      epoch: f.room.epoch,
      payload: plaintext,
    });
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow(CollaborationPeerMessageError);
    expect(plaintext.every((byte) => byte === 0)).toBe(true);
    expect(f.options.onMessage).not.toHaveBeenCalled();
    expect(onPeerRejected).toHaveBeenCalledOnce();
    const valid = await relay(f, peer, 'presence');
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: valid.command });
    expect(f.options.onMessage).toHaveBeenCalledOnce();
    const failed = await relay(f, peer, 'presence');
    f.mls.process.mockRejectedValueOnce(
      new Error('The collaboration encryption outcome is unknown.'),
    );
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command: failed.command }),
    ).rejects.toThrow(/outcome is unknown/);
  });
  it.each(['COLLABORATION_CLOSED', 'COLLABORATION_UNKNOWN_ASSEMBLY_FAILURE'])(
    'keeps %s fatal instead of silently dropping a possibly valid update',
    async (code) => {
      const f = await fixture(),
        peer = await admit(f);
      const { command, frame } = await relay(f, peer);
      const failure = new CollaborationFramingError(code, 'State synchronization is required.');
      const spy = vi
        .spyOn(CollaborationMessageAssembler.prototype, 'accept')
        .mockRejectedValueOnce(failure);
      try {
        await expect(
          f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
        ).rejects.toBe(failure);
        expect(failure).not.toBeInstanceOf(CollaborationPeerMessageError);
        expect(f.options.onMessage).not.toHaveBeenCalled();
        expect(frame.every((byte) => byte === 0)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it('independently rejects a valid targeted ciphertext sent by the relay to a different participant', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command } = await relay(f, peer, 'sync', { recipient: peer.device.deviceId });
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow(/different participant/);
    expect(f.mls.process).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
  });
  it('reconciles a lost membership ACK from the exact durable signed transition before merging once', async () => {
    const f = await fixture();
    let accepted: SignedRoomPolicy | undefined;
    f.transport.send.mockImplementation(async (body, epoch) => {
      if (body.kind === 'policy') {
        accepted = body.policy;
        expect(epoch).toBe(0);
        throw new Error('Write outcome unknown.');
      }
      expect(body.kind).toBe('inspect');
      expect(epoch).toBe(0);
      return { policy: accepted };
    });
    await admit(f);
    expect(f.mls.confirmPendingCommit).toHaveBeenCalledOnce();
    expect(f.mls.discardPendingCommit).not.toHaveBeenCalled();
    expect(f.room.epoch).toBe(1);
    expect(f.transport.send.mock.calls.filter(([body]) => body.kind === 'policy')).toHaveLength(1);
  });
  it('fails closed when a membership outcome cannot be reconciled instead of continuing with a stale ratchet', async () => {
    const f = await fixture();
    f.transport.send.mockRejectedValue(new Error('Unknown outcome: disconnected.'));
    await expect(admit(f)).rejects.toThrow();
    expect(f.mls.dispose).toHaveBeenCalledOnce();
    expect(f.transport.close).toHaveBeenCalledOnce();
    await expect(f.room.encrypt('update', Uint8Array.of(1))).rejects.toThrow(/closed/);
  });
  it('a definitively unaccepted transition never activates its proposed member or epoch', async () => {
    const f = await fixture(),
      original = f.room.currentPolicy!;
    f.transport.send.mockImplementation(async (body) => {
      if (body.kind === 'policy') throw new Error('Rejected transition.');
      return { policy: original };
    });
    await expect(admit(f)).rejects.toThrow(/Rejected/);
    expect(f.room.currentPolicy).toEqual(original);
    expect(f.mls.dispose).toHaveBeenCalledOnce();
    expect(f.mls.confirmPendingCommit).not.toHaveBeenCalled();
    expect(f.room.epoch).toBe(0);
  });
  it('clears pending messages and never delivers a late decrypted result after workspace lock', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command, frame } = await relay(f, peer);
    let finish!: (value: MlsProcessResult) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.mls.process.mockImplementation(async () => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const receiving = Promise.resolve(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    );
    await started;
    f.abort.abort();
    finish({
      kind: 'application',
      senderDeviceId: peer.device.deviceId,
      senderSignaturePublicKey: peer.device.mlsSignatureKey,
      epoch: 1,
      payload: frame,
    });
    await expect(receiving).rejects.toThrow();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    expect(f.mls.dispose).toHaveBeenCalledOnce();
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
  it('clears owned plaintext when lock occurs between the inner decrypt check and serialized continuation', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command, frame } = await relay(f, peer);
    f.mls.process.mockImplementation(async () => {
      const activeCheck = f.options.check;
      f.options.check = () => {
        activeCheck();
        f.options.check = activeCheck;
        // A competing lock completion can occupy this microtask position after
        // decryption resolves but before its serialized caller resumes.
        queueMicrotask(() => f.abort.abort());
      };
      return {
        kind: 'application',
        senderDeviceId: peer.device.deviceId,
        senderSignaturePublicKey: peer.device.mlsSignatureKey,
        epoch: 1,
        payload: frame,
      };
    });
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
  it('clears a decrypted application rejected as a membership commit', async () => {
    const f = await fixture();
    const plaintext = new TextEncoder().encode('synthetic private application');
    const commit = encodeBytes(Uint8Array.of(1, 2, 3));
    const policy = {
      ...f.room.currentPolicy!.policy,
      revision: 2,
      epoch: 1,
      transition: {
        previousEpoch: 0,
        commitHash: await binaryHash(Uint8Array.of(1, 2, 3)),
        welcomeHashes: [],
      },
    };
    f.mls.process.mockResolvedValue({
      kind: 'application',
      senderDeviceId: f.room.device.deviceId,
      senderSignaturePublicKey: f.room.device.mlsSignatureKey,
      epoch: 0,
      payload: plaintext,
    });
    await expect(
      f.transport.options.onFrame({
        type: 'policy',
        protocol: 1,
        commit,
        policy: { policy, signature: await f.room.identity.sign('policy', policy) },
      }),
    ).rejects.toThrow(/membership commit/);
    expect(plaintext.every((byte) => byte === 0)).toBe(true);
    expect(f.room.epoch).toBe(0);
    expect(f.options.onMessage).not.toHaveBeenCalled();
  });
  it('rejects delivery and clears both owned buffers when lock completes after message assembly', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command, frame } = await relay(f, peer);
    let assembled: Uint8Array | undefined;
    const accept = CollaborationMessageAssembler.prototype.accept;
    const spy = vi
      .spyOn(CollaborationMessageAssembler.prototype, 'accept')
      .mockImplementation(async function (this: CollaborationMessageAssembler, ...args) {
        const completed = await accept.apply(this, args);
        expect(completed!.payload.some((byte) => byte !== 0)).toBe(true);
        assembled = completed!.payload;
        f.abort.abort();
        return completed;
      });
    try {
      await expect(
        f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
      ).rejects.toThrow();
      expect(f.options.onMessage).not.toHaveBeenCalled();
      expect(frame.every((byte) => byte === 0)).toBe(true);
      expect(assembled!.every((byte) => byte === 0)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it('rejects oversized outgoing updates and stale-epoch prepared ciphertext', async () => {
    const f = await fixture();
    await expect(f.room.encrypt('update', new Uint8Array(3 * 1024 * 1024 + 1))).rejects.toThrow(
      /too large/,
    );
    const prepared = await f.room.encrypt('update', Uint8Array.of(1));
    await admit(f);
    f.transport.send.mockClear();
    await expect(f.room.send(prepared, 0)).rejects.toThrow(/earlier membership epoch/);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('reserves the entire outgoing batch before its first frame and cancels quota waiting on lock', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const packet = {
      payloadKind: 'presence' as const,
      ciphertext: encodeBytes(Uint8Array.of(1, 2, 3)),
    };
    await expect(f.room.send(new Array(351).fill(packet))).rejects.toThrow(/quota/);
    expect(f.transport.send).not.toHaveBeenCalled();
    await f.room.send(new Array(350).fill(packet));
    f.transport.send.mockClear();
    const waiting = f.room.send([packet]);
    const rejection = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.transport.send).not.toHaveBeenCalled();
    f.abort.abort();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not delay owner membership revocation behind a quota-waiting outgoing batch', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const packet = {
      payloadKind: 'presence' as const,
      ciphertext: encodeBytes(Uint8Array.of(1, 2, 3)),
    };
    await f.room.send(new Array(350).fill(packet));
    f.transport.send.mockClear();
    const waiting = f.room.send([packet]);
    const rejection = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    await f.room.changeMembers(f.room.currentPolicy!.policy.members);
    await rejection;
    expect(f.room.epoch).toBe(1);
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.transport.send.mock.calls[0][0].kind).toBe('policy');
  });
  it('verifies the pinned owner and detached Welcome/Commit hashes before joining', async () => {
    const owner = await participant();
    const f = await fixture({
      invitation: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
      ownerCredential: owner.device.credentialId,
      ownerDeviceId: owner.device.deviceId,
    });
    const commit = encodeBytes(Uint8Array.of(1, 2, 3)),
      welcome = encodeBytes(Uint8Array.of(4, 5, 6));
    const policy = {
      protocol: 1 as const,
      roomId: f.options.roomId,
      ownerDeviceId: owner.device.deviceId,
      revision: 2,
      epoch: 1,
      members: [
        { ...owner.device, role: 'owner' as const },
        { ...f.room.device, role: 'viewer' as const },
      ],
      transition: {
        previousEpoch: 0,
        commitHash: await binaryHash(Uint8Array.of(1, 2, 3)),
        welcomeHashes: [
          { deviceId: f.room.device.deviceId, hash: await binaryHash(Uint8Array.of(4, 5, 6)) },
        ],
      },
    };
    const signed = { policy, signature: await owner.identity.sign('policy', policy) };
    await expect(
      f.transport.options.onFrame({
        type: 'welcome',
        protocol: 1,
        policy: signed,
        commit,
        ciphertext: encodeBytes(Uint8Array.of(99)),
      }),
    ).rejects.toThrow(/pinned owner/);
    expect(f.mls.join).not.toHaveBeenCalled();
    f.mls.join.mockImplementation(async () => {
      f.mls.state = {
        roomId: policy.roomId,
        epoch: policy.epoch,
        active: true,
        ownDeviceId: f.room.device.deviceId,
        ownerDeviceId: owner.device.deviceId,
        members: policy.members.map((member, leafIndex) => ({
          deviceId: member.deviceId,
          transportKeyFingerprint: member.credentialId,
          signaturePublicKey: member.mlsSignatureKey,
          leafIndex,
        })),
      };
    });
    await f.transport.options.onFrame({
      type: 'welcome',
      protocol: 1,
      policy: signed,
      commit,
      ciphertext: welcome,
    });
    expect(f.mls.join).toHaveBeenCalledWith({
      welcome,
      roomId: policy.roomId,
      ownerDeviceId: owner.device.deviceId,
      ownerSignatureKey: owner.device.mlsSignatureKey,
    });
    expect(f.room.role).toBe('viewer');
    expect(f.room.policyFresh).toBe(false);
    expect(f.options.onReady).not.toHaveBeenCalled();
    await grantLease(f, owner);
    expect(f.room.policyFresh).toBe(true);
    await expect(f.room.encrypt('update', Uint8Array.of(1))).rejects.toThrow(/read only/);
  });
});

describe('owner invitation capability and bounded policy freshness', () => {
  it('treats aggregate receiver saturation as backpressure, then coalesces recovery without blaming the sender', async () => {
    const onPeerRejected = vi.fn(),
      onBufferAvailable = vi.fn(),
      f = await fixture({ onPeerRejected, onBufferAvailable }),
      peer = await admit(f);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const accept = vi
      .spyOn(CollaborationMessageAssembler.prototype, 'accept')
      .mockRejectedValueOnce(new CollaborationBufferBusyError())
      .mockRejectedValueOnce(new CollaborationBufferBusyError());
    const discard = vi.spyOn(CollaborationMessageAssembler.prototype, 'discardSender');
    for (let i = 0; i < 2; i++) {
      const message = await relay(f, peer);
      await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
    }
    expect(onPeerRejected).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onBufferAvailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onBufferAvailable).toHaveBeenCalledOnce();
    accept.mockRestore();
    const valid = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: valid.command });
    expect(f.options.onMessage).toHaveBeenCalledOnce();
    expect(f.options.onError).not.toHaveBeenCalled();
  });
  it.each(['dispose', 'cancelPendingSends'] as const)(
    'cancels deferred buffer recovery on %s',
    async (stop) => {
      const onBufferAvailable = vi.fn(),
        f = await fixture({ onBufferAvailable }),
        peer = await admit(f);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
        new CollaborationBufferBusyError(),
      );
      const message = await relay(f, peer);
      await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
      f.room[stop]();
      await vi.advanceTimersByTimeAsync(60_001);
      expect(onBufferAvailable).not.toHaveBeenCalled();
      expect(f.options.onError).not.toHaveBeenCalled();
    },
  );
  it('cancels aggregate recovery when the owner confirms a new membership epoch', async () => {
    const onBufferAvailable = vi.fn(),
      f = await fixture({ onBufferAvailable }),
      peer = await admit(f);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
      new CollaborationBufferBusyError(),
    );
    const message = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
    const epoch = f.room.epoch;
    await f.room.changeMembers(f.room.currentPolicy!.policy.members);
    expect(f.room.epoch).toBe(epoch + 1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(onBufferAvailable).not.toHaveBeenCalled();
    expect(f.options.onError).not.toHaveBeenCalled();
  });
  it('cancels old aggregate recovery after an incoming verified policy even when the new lease is fresh', async () => {
    vi.useFakeTimers();
    const onBufferAvailable = vi.fn(),
      { f, owner } = await joined({ onBufferAvailable });
    await grantLease(f, owner);
    vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
      new CollaborationBufferBusyError(),
    );
    const message = await relay(f, owner, 'snapshot');
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
    const epoch = f.room.epoch;
    await guestRoleTransition(f, owner, 'viewer');
    expect(f.room.epoch).toBe(epoch + 1);
    await grantLease(f, owner);
    // Renew genuinely signed leases throughout the old recovery deadline so
    // expiry cannot hide an obsolete timer firing in the new epoch.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(policyLeaseLimits.refreshMs);
      await vi.waitFor(() =>
        expect(
          (f.room as unknown as { leaseChallenge?: { nonce: string } }).leaseChallenge,
        ).toBeDefined(),
      );
      await grantLease(f, owner);
      expect(f.room.policyFresh).toBe(true);
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(onBufferAvailable).not.toHaveBeenCalled();
    expect(f.options.onError).not.toHaveBeenCalled();
    expect(f.mls.dispose).not.toHaveBeenCalled();
  });
  it('keeps an offline owner session recoverable when deferred recovery loses its connection', async () => {
    const onBufferAvailable = vi.fn(() => f.room.message('sync', Uint8Array.of(0))),
      f = await fixture({ onBufferAvailable }),
      peer = await admit(f);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
      new CollaborationBufferBusyError(),
    );
    const message = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
    f.transport.send.mockRejectedValueOnce(new CollaborationConnectionError('Connection lost.'));
    await vi.advanceTimersByTimeAsync(60_001);
    expect(onBufferAvailable).toHaveBeenCalledOnce();
    // Web Crypto runs outside fake timers; wait for the actual rejected send.
    await vi.waitFor(() => expect(f.options.onDisconnect).toHaveBeenCalledOnce());
    expect(f.options.onError).not.toHaveBeenCalled();
    expect(f.transport.close).not.toHaveBeenCalled();
    expect(f.mls.dispose).not.toHaveBeenCalled();
    await expect(f.room.message('sync', Uint8Array.of(0))).resolves.toBeUndefined();
  });
  it.each(['unknown local failure', 'connection lost'])(
    'ignores a superseded epoch recovery failure: %s',
    async (failure) => {
      let rejectRecovery!: (error: Error) => void;
      const onBufferAvailable = vi.fn(
          () => new Promise<void>((_resolve, reject) => (rejectRecovery = reject)),
        ),
        f = await fixture({ onBufferAvailable }),
        peer = await admit(f);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
        new CollaborationBufferBusyError(),
      );
      const message = await relay(f, peer);
      await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
      await vi.advanceTimersByTimeAsync(60_001);
      expect(onBufferAvailable).toHaveBeenCalledOnce();
      await f.room.changeMembers(f.room.currentPolicy!.policy.members);
      rejectRecovery(
        failure === 'connection lost'
          ? new CollaborationConnectionError('Connection lost.')
          : new Error(failure),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(f.options.onError).not.toHaveBeenCalled();
      expect(f.options.onDisconnect).not.toHaveBeenCalled();
    },
  );
  it('retains fatal handling for an unknown current-epoch recovery failure', async () => {
    const error = new Error('Unknown local recovery failure.'),
      onBufferAvailable = vi.fn(async () => {
        throw error;
      }),
      f = await fixture({ onBufferAvailable }),
      peer = await admit(f);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
      new CollaborationBufferBusyError(),
    );
    const message = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(f.options.onError).toHaveBeenCalledWith(error);
    expect(f.options.onDisconnect).not.toHaveBeenCalled();
  });
  it.each(['unknown local failure', 'connection lost'])(
    'ignores in-flight recovery failures after a same-epoch reconnect: %s',
    async (failure) => {
      let rejectRecovery!: (error: Error) => void;
      const onBufferAvailable = vi.fn(
          () => new Promise<void>((_resolve, reject) => (rejectRecovery = reject)),
        ),
        f = await fixture({ onBufferAvailable }),
        peer = await admit(f);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
        new CollaborationBufferBusyError(),
      );
      const message = await relay(f, peer);
      await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
      await vi.advanceTimersByTimeAsync(60_001);
      expect(onBufferAvailable).toHaveBeenCalledOnce();
      const epoch = f.room.epoch;
      f.transport.options.onDisconnect();
      f.transport.connect.mockImplementationOnce(async () => {
        await f.transport.options.onFrame({
          type: 'authenticated',
          protocol: 1,
          policy: f.room.currentPolicy!,
          role: 'owner',
        });
      });
      await f.room.reconnect();
      expect(f.room.epoch).toBe(epoch);
      expect(f.room.policyFresh).toBe(true);
      vi.mocked(f.options.onDisconnect).mockClear();
      rejectRecovery(
        failure === 'connection lost'
          ? new CollaborationConnectionError('Connection lost.')
          : new Error(failure),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(f.options.onError).not.toHaveBeenCalled();
      expect(f.options.onDisconnect).not.toHaveBeenCalled();
      expect(f.mls.dispose).not.toHaveBeenCalled();
    },
  );
  it('cancels an armed recovery timer on disconnect without disabling subsequent recovery', async () => {
    const onBufferAvailable = vi.fn(),
      f = await fixture({ onBufferAvailable }),
      peer = await admit(f);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(CollaborationMessageAssembler.prototype, 'accept')
      .mockRejectedValueOnce(new CollaborationBufferBusyError())
      .mockRejectedValueOnce(new CollaborationBufferBusyError());
    const message = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: message.command });
    f.transport.options.onDisconnect();
    f.transport.connect.mockImplementationOnce(async () => {
      await f.transport.options.onFrame({
        type: 'authenticated',
        protocol: 1,
        policy: f.room.currentPolicy!,
        role: 'owner',
      });
    });
    await f.room.connect();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(onBufferAvailable).not.toHaveBeenCalled();
    const fresh = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: fresh.command });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(onBufferAvailable).toHaveBeenCalledOnce();
    expect(f.options.onError).not.toHaveBeenCalled();
  });
  it('rejects relay-fabricated self-signed admission without owner invitation possession', async () => {
    const f = await fixture(),
      peer = await participant();
    const request = await admission(f.options.roomId, peer);
    request.admission.authorization = {
      ...request.admission.authorization,
      invitationId: crypto.randomUUID(),
      proof: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
    };
    request.admission.signature = await peer.identity.sign(
      'admission',
      admissionInput(
        f.options.roomId,
        peer.device,
        request.keyPackage,
        request.expiresAt,
        request.admission.authorization,
      ),
    );
    await expect(
      f.transport.options.onFrame({ type: 'join-request', protocol: 1, request }),
    ).rejects.toThrow(/owner invitation/);
    await expect(
      f.room.changeMembers(
        [...f.room.currentPolicy!.policy.members, { ...peer.device, role: 'viewer' }],
        request,
      ),
    ).rejects.toThrow(/owner invitation/);
    expect(f.options.onJoin).not.toHaveBeenCalled();
    expect(f.mls.prepareAddMember).not.toHaveBeenCalled();
  });
  it('binds the complete device, KeyPackage and disclosure scope and consumes an invitation once', async () => {
    const f = await fixture(),
      first = await participant(),
      second = await participant();
    const expiresAt = Date.now() + 60_000;
    const issued = f.room.createInvitationAuthorization(
      { shareMetadata: false, shareOwners: false, shareDatasets: false },
      expiresAt,
    );
    const make = async (peer: Awaited<ReturnType<typeof participant>>) => {
      const keyPackage = encodeBytes(Uint8Array.of(7, 8, 9));
      const authorization = await proveInvitation(
        f.options.roomId,
        peer.device,
        keyPackage,
        expiresAt,
        issued,
      );
      return {
        ...peer.device,
        keyPackage,
        expiresAt,
        admission: {
          expiresAt,
          authorization,
          signature: await peer.identity.sign(
            'admission',
            admissionInput(f.options.roomId, peer.device, keyPackage, expiresAt, authorization),
          ),
        },
      };
    };
    const request = await make(first),
      changed = await make(second);
    changed.admission.authorization = request.admission.authorization;
    changed.admission.signature = await second.identity.sign(
      'admission',
      admissionInput(
        f.options.roomId,
        second.device,
        changed.keyPackage,
        expiresAt,
        changed.admission.authorization,
      ),
    );
    await expect(
      f.transport.options.onFrame({ type: 'join-request', protocol: 1, request: changed }),
    ).rejects.toThrow(/owner invitation/);
    const scopeChanged = structuredClone(request);
    scopeChanged.admission.authorization.scope.shareDatasets = true;
    scopeChanged.admission.signature = await first.identity.sign(
      'admission',
      admissionInput(
        f.options.roomId,
        first.device,
        request.keyPackage,
        expiresAt,
        scopeChanged.admission.authorization,
      ),
    );
    await expect(
      f.transport.options.onFrame({ type: 'join-request', protocol: 1, request: scopeChanged }),
    ).rejects.toThrow(/owner invitation/);
    await f.transport.options.onFrame({ type: 'join-request', protocol: 1, request });
    await expect(
      f.transport.options.onFrame({
        type: 'join-request',
        protocol: 1,
        request: await make(second),
      }),
    ).rejects.toThrow(/owner invitation/);
    await f.room.changeMembers(
      [...f.room.currentPolicy!.policy.members, { ...first.device, role: 'viewer' }],
      request,
    );
    await expect(
      f.transport.options.onFrame({ type: 'join-request', protocol: 1, request }),
    ).rejects.toThrow(/owner invitation/);
  });
  it('requires nonce-bound owner confirmation before nonowner publication or application readiness', async () => {
    const { f, owner } = await joined();
    expect(f.room.policyFresh).toBe(false);
    expect(f.options.onReady).not.toHaveBeenCalled();
    await expect(f.room.encrypt('update', Uint8Array.of(1))).rejects.toThrow(/lease expired/);
    await expect(
      grantLease(f, owner, { nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))) }),
    ).rejects.toThrow(CollaborationPeerMessageError);
    expect(f.room.policyFresh).toBe(false);
    await grantLease(f, owner);
    expect(f.room.policyFresh).toBe(true);
    expect(f.options.onReady).toHaveBeenCalledOnce();
    await expect(f.room.encrypt('update', Uint8Array.of(1))).resolves.toHaveLength(1);
  });
  it('expires a withheld policy without trusting relay errors and cancels queued prepared publication', async () => {
    vi.useFakeTimers();
    const { f, owner } = await joined();
    await grantLease(f, owner);
    const packets = await f.room.encrypt('update', Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(policyLeaseLimits.lifetimeMs + 1);
    expect(f.options.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('owner membership lease expired'),
      }),
    );
    expect(f.mls.dispose).toHaveBeenCalledOnce();
    expect(f.transport.close).toHaveBeenCalledOnce();
    await expect(f.room.send(packets)).rejects.toThrow(/closed/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('revalidates freshness after async ratchet work instead of releasing expired ciphertext', async () => {
    const { f, owner } = await joined();
    await grantLease(f, owner);
    const start = Date.now();
    f.mls.encrypt.mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(start + 31_000);
      return encodeBytes(Uint8Array.of(1, 2, 3));
    });
    await expect(f.room.encrypt('update', Uint8Array.of(1))).rejects.toThrow(/lease expired/);
    expect(
      f.transport.send.mock.calls.filter(
        ([body]) => body.kind === 'relay' && body.payloadKind === 'application',
      ),
    ).toHaveLength(0);
  });
  it.each(['COLLABORATION_MESSAGE_LIMIT', 'COLLABORATION_MESSAGE_EXPIRED'])(
    'isolates %s to its sender and requests visible recovery',
    async (code) => {
      const onPeerRejected = vi.fn(),
        f = await fixture({ onPeerRejected }),
        peer = await admit(f),
        remaining = await admit(f);
      const { command } = await relay(f, peer);
      vi.spyOn(CollaborationMessageAssembler.prototype, 'accept').mockRejectedValueOnce(
        new CollaborationFramingError(code, 'Recovery required'),
      );
      await expect(
        f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
      ).rejects.toThrow(CollaborationPeerMessageError);
      expect(onPeerRejected).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: peer.device.deviceId }),
        expect.objectContaining({ code }),
      );
      const next = await relay(f, remaining);
      await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: next.command });
      expect(f.options.onMessage).toHaveBeenCalledOnce();
      expect(f.mls.dispose).not.toHaveBeenCalled();
    },
  );
  it('does not apply plaintext when the owner lease expires during asynchronous decryption', async () => {
    const { f, owner } = await joined();
    await grantLease(f, owner);
    const { command, frame } = await relay(f, owner),
      start = Date.now();
    f.mls.process.mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(start + 31_000);
      return {
        kind: 'application',
        senderDeviceId: owner.device.deviceId,
        senderSignaturePublicKey: owner.device.mlsSignatureKey,
        epoch: f.room.epoch,
        payload: frame,
      };
    });
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow(/lease expired/);
    expect(f.options.onMessage).not.toHaveBeenCalled();
    expect(frame.every((byte) => byte === 0)).toBe(true);
  });
  it('isolates a product peer rejection while preserving subsequent valid deliveries and fatal storage failures', async () => {
    const onPeerRejected = vi.fn(),
      f = await fixture({ onPeerRejected }),
      peer = await admit(f);
    vi.mocked(f.options.onMessage).mockRejectedValueOnce(
      new CollaborationPeerMessageError('Invalid shared document'),
    );
    const invalid = await relay(f, peer);
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command: invalid.command }),
    ).rejects.toThrow(CollaborationPeerMessageError);
    expect(onPeerRejected).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: peer.device.deviceId }),
      expect.objectContaining({ message: 'Invalid shared document' }),
    );
    const valid = await relay(f, peer);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: valid.command });
    vi.mocked(f.options.onMessage).mockRejectedValueOnce(
      new Error('Encrypted vault commit failed'),
    );
    const failed = await relay(f, peer);
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command: failed.command }),
    ).rejects.toThrow(/vault commit failed/);
    expect(onPeerRejected).toHaveBeenCalledOnce();
  });
  it('answers bounded lease controls without waiting behind a document quota reservation', async () => {
    vi.useFakeTimers();
    const f = await fixture(),
      viewer = await admit(f, 'viewer');
    const packet = {
      payloadKind: 'presence' as const,
      ciphertext: encodeBytes(Uint8Array.of(1, 2, 3)),
    };
    await f.room.send(new Array(350).fill(packet));
    f.transport.send.mockClear();
    const waiting = f.room.send([packet]);
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    const [payload] = await new CollaborationMessageFramer(f.options.diagramId).encode(
      'lease-request',
      new TextEncoder().encode(
        JSON.stringify({ nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))) }),
      ),
    );
    f.mls.process.mockResolvedValueOnce({
      kind: 'application',
      senderDeviceId: viewer.device.deviceId,
      senderSignaturePublicKey: viewer.device.mlsSignatureKey,
      epoch: f.room.epoch,
      payload,
    });
    const unsigned: Omit<SignedCommand, 'signature'> = {
      type: 'command',
      protocol: 1,
      roomId: f.options.roomId,
      connectionId: crypto.randomUUID(),
      deviceId: viewer.device.deviceId,
      sequence: 1,
      epoch: f.room.epoch,
      body: {
        kind: 'relay',
        payloadKind: 'presence',
        recipient: f.room.device.deviceId,
        ciphertext: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
      },
    };
    await f.transport.options.onFrame({
      type: 'relay',
      protocol: 1,
      command: { ...unsigned, signature: await viewer.identity.sign('command', unsigned) },
    });
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.transport.send.mock.calls[0][0]).toMatchObject({
      kind: 'relay',
      payloadKind: 'presence',
      recipient: viewer.device.deviceId,
    });
    f.abort.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('discards delayed application and lease frames across several role changes before current ACL checks', async () => {
    const f = await fixture(),
      peer = await admit(f),
      remaining = await admit(f);
    const update = await relay(f, peer);
    const control = await relay(f, peer, 'presence');
    for (let i = 0; i < 5; ++i)
      await f.room.changeMembers(
        f.room.currentPolicy!.policy.members.map((member) =>
          member.deviceId === peer.device.deviceId
            ? { ...member, role: i % 2 === 0 ? ('viewer' as const) : ('editor' as const) }
            : member,
        ),
      );
    expect(f.room.epoch).toBeGreaterThan(update.command.epoch + 1);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: update.command });
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: control.command });
    expect(f.mls.process).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    const fresh = await relay(f, remaining);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command: fresh.command });
    expect(f.options.onMessage).toHaveBeenCalledOnce();
    // Current-epoch Viewer writes still fail, even after legitimate stale drops.
    const unauthorized = await relay(f, peer);
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command: unauthorized.command }),
    ).rejects.toThrow(/read-only/);
  });
  it('rejects malformed and future-epoch frames instead of treating them as harmless stale traffic', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const old = await relay(f, peer);
    await f.room.changeMembers(f.room.currentPolicy!.policy.members);
    for (const command of [
      { ...old.command, epoch: -1 },
      { ...old.command, epoch: '0' },
      { ...old.command, roomId: crypto.randomUUID() },
      { ...old.command, body: { ...old.command.body, ciphertext: '%%%' } },
      { ...old.command, body: { ...old.command.body, payloadKind: ['presence'] } },
      { ...old.command, epoch: f.room.epoch + 1 },
    ])
      await expect(
        f.transport.options.onFrame({
          type: 'relay',
          protocol: 1,
          command: command as SignedCommand,
        }),
      ).rejects.toThrow();
    expect(f.mls.process).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    const current = await relay(f, peer);
    await expect(
      f.transport.options.onFrame({
        type: 'relay',
        protocol: 1,
        command: {
          ...current.command,
          signature: encodeBytes(crypto.getRandomValues(new Uint8Array(64))),
        },
      }),
    ).rejects.toThrow(/signature/);
    expect(f.mls.process).not.toHaveBeenCalled();
  });
  it('starts a fresh lease challenge for every rapid policy transition and tolerates correlated stale sends', async () => {
    vi.useFakeTimers();
    const { f, owner } = await joined();
    const challenge = () =>
      (f.room as unknown as { leaseChallenge?: { nonce: string } }).leaseChallenge?.nonce;
    const seen = new Set([challenge()]);
    for (let i = 0; i < 5; ++i) {
      // The honest relay may already have accepted a later owner policy while
      // this recipient's ordered reader is still processing the intermediate one.
      f.transport.send.mockRejectedValueOnce(new CollaborationRelayError('STALE_EPOCH'));
      await guestRoleTransition(f, owner, i % 2 === 0 ? 'viewer' : 'editor');
      expect(challenge()).toBeTruthy();
      expect(seen.has(challenge())).toBe(false);
      seen.add(challenge());
      expect(f.options.onError).not.toHaveBeenCalled();
      expect(f.room.policyFresh).toBe(false);
    }
    expect(f.options.onReady).not.toHaveBeenCalled();
    await grantLease(f, owner);
    expect(f.room.policyFresh).toBe(true);
    expect(f.options.onReady).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.options.onError).not.toHaveBeenCalled();
  });
  it('renews a fresh owner lease after fourteen immediate role transitions in one minute', async () => {
    vi.useFakeTimers();
    const { f, owner } = await joined();
    await grantLease(f, owner);
    for (let i = 0; i < 14; ++i) {
      await guestRoleTransition(f, owner, i % 2 === 0 ? 'viewer' : 'editor');
      expect(f.room.policyFresh).toBe(false);
      await grantLease(f, owner);
      expect(f.room.policyFresh).toBe(true);
    }
    expect(f.transport.send).toHaveBeenCalledTimes(15);
    await vi.advanceTimersByTimeAsync(policyLeaseLimits.refreshMs);
    await vi.waitFor(() => expect(f.transport.send).toHaveBeenCalledTimes(16));
    await grantLease(f, owner);
    expect(f.room.policyFresh).toBe(true);
    expect(f.options.onError).not.toHaveBeenCalled();
  });
  it('retries an unanswered challenge without extending its authorization deadline', async () => {
    vi.useFakeTimers();
    const { f, owner } = await joined();
    const challenge = () =>
      (f.room as unknown as { leaseChallenge?: { nonce: string; wall: number } }).leaseChallenge;
    const initial = { ...challenge()! };
    await vi.advanceTimersByTimeAsync(policyLeaseLimits.refreshMs);
    await vi.waitFor(() => expect(f.transport.send).toHaveBeenCalledTimes(2));
    expect(challenge()).toMatchObject(initial);
    await grantLease(f, owner);
    expect(f.room.policyFresh).toBe(true);
    await vi.advanceTimersByTimeAsync(initial.wall + policyLeaseLimits.lifetimeMs - Date.now());
    expect(f.options.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('owner membership lease expired'),
      }),
    );
    expect(f.mls.dispose).toHaveBeenCalledOnce();
  });
  it('keeps the bounded control burst from spending current members renewal shares', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const peers = await Promise.all(Array.from({ length: 31 }, () => participant()));
    const state = f.room as unknown as {
      policy: SignedRoomPolicy;
      reserveLeaseControl: (peer: string, bytes: number) => boolean;
      controlBudget: { messages: number; bytes: number };
    };
    state.policy = {
      policy: {
        ...f.room.currentPolicy!.policy,
        members: [
          ...f.room.currentPolicy!.policy.members,
          ...peers.map((peer) => ({ ...peer.device, role: 'viewer' as const })),
        ],
      },
      signature: f.room.currentPolicy!.signature,
    };
    // Exercise the queue reservation before transport publication: one sender
    // tries to spend the whole minute before any other member renews.
    const burst = peers[0].device.deviceId;
    let reserved = 0;
    while (state.reserveLeaseControl(burst, 4096)) ++reserved;
    expect(reserved).toBeGreaterThan(12);
    expect(reserved).toBeLessThanOrEqual(32);
    for (const peer of peers.slice(1))
      for (let i = 0; i < 7; ++i)
        expect(state.reserveLeaseControl(peer.device.deviceId, 4096)).toBe(true);
    expect(state.controlBudget.messages).toBe(224);
    expect(state.controlBudget.bytes).toBeLessThanOrEqual(1024 * 1024);
    expect(state.reserveLeaseControl(peers[1].device.deviceId, 4096)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.reserveLeaseControl(burst, 4096)).toBe(true);
  });
});
