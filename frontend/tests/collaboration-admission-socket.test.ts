import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admissionInput,
  relayLimits,
  type PendingJoin,
  type SignedRoomPolicy,
} from '../../collaboration-worker/src/protocol';
import {
  createTransportIdentity,
  encodeBytes,
  type TransportIdentity,
} from '../src/collaboration/transport/identity';
import {
  proveInvitation,
  type InvitationAuthorization,
} from '../src/collaboration/transport/invitation-authorization';
import {
  EncryptedRoom,
  type EncryptedRoomOptions,
} from '../src/collaboration/session/encrypted-room';
import type { MlsGroupInfo } from '../src/collaboration/crypto-types';

// Only MLS lifecycle is a fixture: admission uses real WebCrypto and the real
// ordered RoomTransport socket reader, which direct onFrame tests do not cover.
const hooks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/collaboration/crypto', () => ({
  MlsSession: { create: (input: unknown) => hooks.create(input) },
}));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  static policy: SignedRoomPolicy;
  readyState = Socket.OPEN;
  onmessage?: (event: MessageEvent) => void;
  onclose?: () => void;
  onerror?: () => void;
  frames: any[] = [];
  constructor() {
    Socket.instances.push(this);
    queueMicrotask(() =>
      this.emit({
        type: 'challenge',
        protocol: 1,
        roomId: Socket.policy.policy.roomId,
        connectionId: crypto.randomUUID(),
        nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
        expiresAt: Date.now() + relayLimits.challengeMs,
      }),
    );
  }
  emit(frame: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }
  send(text: string) {
    const frame = JSON.parse(text);
    this.frames.push(frame);
    if (frame.type === 'authenticate')
      this.emit({ type: 'authenticated', protocol: 1, policy: Socket.policy, role: 'owner' });
    if (frame.type === 'command')
      this.emit({ type: 'ack', protocol: 1, sequence: frame.sequence, result: { live: true } });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const rooms: EncryptedRoom[] = [];
const identities: TransportIdentity[] = [];
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      Socket.policy = JSON.parse(options.body as string).policy;
      return { ok: true };
    }),
  );
  hooks.create.mockImplementation(async (device: { deviceId: string; credentialId: string }) => {
    const key = encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
    let state: MlsGroupInfo;
    return {
      signaturePublicKey: async () => key,
      createGroup: async (roomId: string) => {
        state = {
          roomId,
          epoch: 0,
          active: true,
          ownDeviceId: device.deviceId,
          ownerDeviceId: device.deviceId,
          members: [
            {
              deviceId: device.deviceId,
              transportKeyFingerprint: device.credentialId,
              signaturePublicKey: key,
              leafIndex: 0,
            },
          ],
        };
      },
      info: async () => structuredClone(state),
      dispose: vi.fn(),
    };
  });
});
afterEach(() => {
  rooms.splice(0).forEach((room) => room.dispose());
  identities.splice(0).forEach((identity) => identity.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const options: EncryptedRoomOptions = {
    roomId: crypto.randomUUID(),
    diagramId: crypto.randomUUID(),
    relay: 'https://relay.example.test',
    signal: new AbortController().signal,
    check: () => {},
    onPolicy: vi.fn(),
    onJoin: vi.fn(),
    onReady: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
  };
  const room = await EncryptedRoom.open(options);
  rooms.push(room);
  await room.create();
  const socket = Socket.instances.at(-1)!;
  const identity = await createTransportIdentity();
  identities.push(identity);
  const device = {
    ...identity.public,
    mlsSignatureKey: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
  };
  async function request(issued?: InvitationAuthorization): Promise<PendingJoin> {
    issued ??= room.createInvitationAuthorization(
      { shareMetadata: false, shareOwners: false, shareDatasets: false },
      Date.now() + 60_000,
    );
    const keyPackage = encodeBytes(Uint8Array.of(7, 8, 9));
    const authorization = await proveInvitation(
      options.roomId,
      device,
      keyPackage,
      issued.expiresAt,
      issued,
    );
    const value = {
      ...device,
      keyPackage,
      expiresAt: issued.expiresAt,
      admission: { expiresAt: issued.expiresAt, authorization, signature: '' },
    };
    await sign(value);
    return value;
  }
  async function sign(value: PendingJoin) {
    value.admission.signature = await identity.sign(
      'admission',
      admissionInput(
        options.roomId,
        value,
        value.keyPackage,
        value.expiresAt,
        value.admission.authorization,
      ),
    );
  }
  return { room, options, socket, request, sign };
}

describe('owner admission through the real socket reader', () => {
  it.each(['proof', 'scope', 'signature', 'malformed', 'expired', 'revoked'] as const)(
    'rejects %s admission without failing the room or suppressing a later valid request',
    async (failure) => {
      const f = await fixture();
      const bad = await f.request();
      if (failure === 'proof') {
        bad.admission.authorization.proof = encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
        await f.sign(bad);
      }
      if (failure === 'scope') {
        bad.admission.authorization.scope.shareDatasets = true;
        await f.sign(bad);
      }
      if (failure === 'signature')
        bad.admission.signature = encodeBytes(crypto.getRandomValues(new Uint8Array(64)));
      if (failure === 'expired') {
        const now = bad.expiresAt + 1;
        vi.spyOn(Date, 'now').mockReturnValue(now);
      }
      if (failure === 'revoked') await f.room.control('revoke-invitations');
      const good = await f.request();
      const policy = structuredClone(f.room.currentPolicy);
      f.socket.emit({
        type: 'join-request',
        protocol: 1,
        request: failure === 'malformed' ? { deviceId: 'invalid' } : bad,
      });
      f.socket.emit({ type: 'join-request', protocol: 1, request: good });
      await vi.waitFor(() => expect(f.options.onJoin).toHaveBeenCalledExactlyOnceWith(good));
      expect(f.options.onError).not.toHaveBeenCalled();
      expect(f.options.onDisconnect).not.toHaveBeenCalled();
      expect(f.socket.readyState).toBe(Socket.OPEN);
      expect(f.room.currentPolicy).toEqual(policy);
      expect(f.room.currentPolicy!.policy.members).toHaveLength(1);
      f.room.assertAuthorized();
      await expect(f.room.control('inspect')).resolves.toEqual({ live: true });
    },
  );

  it('rejects expiry during signature verification while keeping the next admission usable', async () => {
    const f = await fixture();
    const bad = await f.request();
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    let reached!: () => void;
    const advanced = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.spyOn(crypto.subtle, 'verify').mockImplementationOnce(async (...args) => {
      const valid = await verify(...args);
      vi.spyOn(Date, 'now').mockReturnValue(bad.expiresAt + 1);
      reached();
      return valid;
    });
    f.socket.emit({ type: 'join-request', protocol: 1, request: bad });
    await advanced;
    const good = await f.request();
    f.socket.emit({ type: 'join-request', protocol: 1, request: good });
    await vi.waitFor(() => expect(f.options.onJoin).toHaveBeenCalledExactlyOnceWith(good));
    expect(f.options.onError).not.toHaveBeenCalled();
    expect(f.socket.readyState).toBe(Socket.OPEN);
    expect(f.room.currentPolicy!.policy.members).toHaveLength(1);
  });

  it('keeps an unexpected failure after valid admission fatal', async () => {
    const f = await fixture();
    vi.mocked(f.options.onJoin).mockImplementation(() => {
      throw new Error('Unexpected local state failure.');
    });
    f.socket.emit({ type: 'join-request', protocol: 1, request: await f.request() });
    await vi.waitFor(() => expect(f.options.onError).toHaveBeenCalledOnce());
    expect(f.options.onError).toHaveBeenCalledWith(new Error('Unexpected local state failure.'));
    expect(f.socket.readyState).toBe(3);
  });
});
