import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeviceIdentity,
  PendingJoin,
  RoomMember,
  SignedCommand,
  SignedRoomPolicy,
} from '../../collaboration-worker/src/protocol';
import {
  CollaborationRelayError,
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
import { binaryHash } from '../src/collaboration/transport/policy';
import {
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
  const request: PendingJoin = {
    ...peer.device,
    keyPackage: encodeBytes(Uint8Array.of(7, 8, 9)),
    expiresAt: Date.now() + 600_000,
  };
  await f.room.changeMembers(
    [...f.room.currentPolicy!.policy.members, { ...peer.device, role }],
    request,
  );
  return peer;
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
describe('encrypted room session authorization and lifecycle', () => {
  it('independently verifies a pending device thumbprint before showing an owner approval request', async () => {
    const f = await fixture(),
      peer = await participant();
    const request: PendingJoin = {
      ...peer.device,
      keyPackage: encodeBytes(Uint8Array.of(7, 8, 9)),
      expiresAt: Date.now() + 600_000,
    };
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
  it('authenticates and discards an adjacent old-epoch frame arriving after removal without retaining old decryption keys', async () => {
    const f = await fixture(),
      peer = await admit(f);
    const { command } = await relay(f, peer);
    await f.room.changeMembers([f.room.currentPolicy!.policy.members[0]]);
    await f.transport.options.onFrame({ type: 'relay', protocol: 1, command });
    expect(f.room.epoch).toBe(2);
    expect(f.mls.process).not.toHaveBeenCalled();
    expect(f.options.onMessage).not.toHaveBeenCalled();
    await expect(
      f.transport.options.onFrame({
        type: 'relay',
        protocol: 1,
        command: { ...command, signature: encodeBytes(crypto.getRandomValues(new Uint8Array(64))) },
      }),
    ).rejects.toThrow(/signature/);
    // Only the immediately preceding public policy is retained. Older frames
    // cannot extend a membership history or authorize a later epoch.
    await f.room.changeMembers(f.room.currentPolicy!.policy.members);
    await expect(
      f.transport.options.onFrame({ type: 'relay', protocol: 1, command }),
    ).rejects.toThrow(/approved participant/);
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
    ).rejects.toThrow(/permission/);
    expect(f.options.onMessage).not.toHaveBeenCalled();
  });
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
    await expect(f.room.send(new Array(501).fill(packet))).rejects.toThrow(/quota/);
    expect(f.transport.send).not.toHaveBeenCalled();
    await f.room.send(new Array(500).fill(packet));
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
    await f.room.send(new Array(500).fill(packet));
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
    await expect(f.room.encrypt('update', Uint8Array.of(1))).rejects.toThrow(/read only/);
  });
});
