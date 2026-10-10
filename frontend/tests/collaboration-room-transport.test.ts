import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeviceIdentity,
  ServerFrame,
  SignedRoomPolicy,
} from '../../collaboration-worker/src/protocol';
import { relayLimits } from '../../collaboration-worker/src/protocol';
import {
  createTransportIdentity,
  encodeBytes,
  verifyTransportSignature,
  type TransportIdentity,
} from '../src/collaboration/transport/identity';
import { relayOrigin, RoomTransport } from '../src/collaboration/transport/room-transport';

/** Deterministic transport peer; protocol signatures still use native WebCrypto. */
class Socket {
  static OPEN = 1;
  readyState = Socket.OPEN;
  onmessage?: (event: MessageEvent) => void;
  onclose?: () => void;
  onerror?: () => void;
  readonly frames: any[] = [];
  onSend?: (frame: any) => void;
  private watchers: { type: string; resolve(value: any): void }[] = [];
  send(text: string) {
    if (this.readyState !== Socket.OPEN) throw new Error('Closed socket');
    const frame = JSON.parse(text);
    this.frames.push(frame);
    const watcher = this.watchers.findIndex((value) => value.type === frame.type);
    if (watcher >= 0) this.watchers.splice(watcher, 1)[0].resolve(frame);
    this.onSend?.(frame);
  }
  next(type: string): Promise<any> {
    const frame = this.frames.find((frame) => frame.type === type);
    return frame
      ? Promise.resolve(frame)
      : new Promise((resolve) => this.watchers.push({ type, resolve }));
  }
  emit(frame: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('WebSocket', Socket);
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function fixture(
  overrides: {
    onFrame?: (frame: ServerFrame) => Promise<void> | void;
    identity?: TransportIdentity;
  } = {},
) {
  const identity = overrides.identity ?? (await createTransportIdentity());
  const device: DeviceIdentity = {
    ...identity.public,
    mlsSignatureKey: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
  };
  const roomId = crypto.randomUUID();
  const policy = {
    protocol: 1 as const,
    roomId,
    ownerDeviceId: device.deviceId,
    epoch: 0,
    revision: 1,
    transition: null,
    members: [{ ...device, role: 'owner' as const }],
  };
  const signed: SignedRoomPolicy = { policy, signature: await identity.sign('policy', policy) };
  const sockets: Socket[] = [],
    urls: string[] = [],
    onError = vi.fn(),
    onDisconnect = vi.fn(),
    onFrame = overrides.onFrame ?? vi.fn();
  const transport = new RoomTransport({
    relayUrl: 'https://relay.test',
    roomId,
    identity,
    device,
    onFrame,
    onError,
    onDisconnect,
    socket(url) {
      urls.push(url);
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  cleanup.push(() => {
    transport.close();
    identity.destroy();
  });
  async function connect() {
    const connected = transport.connect();
    const socket = sockets.at(-1)!;
    const challenge = {
      type: 'challenge',
      protocol: 1,
      roomId,
      connectionId: crypto.randomUUID(),
      nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
      expiresAt: Date.now() + relayLimits.challengeMs,
    };
    socket.emit(challenge);
    const auth = await socket.next('authenticate');
    socket.emit({ type: 'authenticated', protocol: 1, policy: signed, role: 'owner' });
    await connected;
    return { socket, auth, challenge };
  }
  return {
    transport,
    identity,
    device,
    roomId,
    signed,
    sockets,
    urls,
    onError,
    onDisconnect,
    connect,
  };
}
describe('collaboration browser transport', () => {
  it('uses an HTTPS relay origin and rejects URL secrets, credentials, paths or external plaintext HTTP', () => {
    expect(relayOrigin('https://relay.test')).toBe('https://relay.test');
    expect(relayOrigin('http://127.0.0.1:4357')).toBe('http://127.0.0.1:4357');
    for (const url of [
      'http://relay.test',
      'wss://relay.test',
      'https://user:secret@relay.test',
      'https://relay.test/?token=secret',
      'https://relay.test/#key',
      'https://relay.test/path',
    ])
      expect(() => relayOrigin(url)).toThrow(/HTTPS origin/);
  });
  it('signs a challenge-bound authentication packet while keeping all URL credentials empty', async () => {
    const value = await fixture(),
      { auth, challenge } = await value.connect();
    expect(value.urls).toEqual([`wss://relay.test/v1/rooms/${value.roomId}/socket`]);
    const { signature, ...unsigned } = auth;
    expect(await verifyTransportSignature(value.device, 'authenticate', unsigned, signature)).toBe(
      true,
    );
    expect(auth).toMatchObject({
      roomId: value.roomId,
      connectionId: challenge.connectionId,
      nonce: challenge.nonce,
      device: value.device,
    });
    expect(auth).not.toHaveProperty('invitation');
  });
  it('creates only the owner-signed public policy and omits credentials/cache/redirects', async () => {
    const value = await fixture();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    await value.transport.create(value.signed);
    expect(fetch).toHaveBeenCalledWith(
      'https://relay.test/v1/rooms',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ policy: value.signed });
    await expect(
      value.transport.create({
        ...value.signed,
        policy: { ...value.signed.policy, roomId: crypto.randomUUID() },
      }),
    ).rejects.toThrow(/identifier mismatch/);
  });
  it('does not deadlock ACK handling while an ordered peer callback awaits its own response', async () => {
    let transport!: RoomTransport, response!: Promise<unknown>;
    const callback = vi.fn(async (frame: ServerFrame) => {
      if (frame.type === 'relay') response = transport.send({ kind: 'inspect' }, 0);
      if (response) await response;
    });
    const value = await fixture({ onFrame: callback });
    transport = value.transport;
    const { socket } = await value.connect();
    socket.onSend = (frame) => {
      if (frame.type === 'command')
        socket.emit({ type: 'ack', protocol: 1, sequence: frame.sequence, result: 'round-trip' });
    };
    socket.emit({ type: 'relay', protocol: 1, command: {} });
    await socket.next('command');
    await expect(response).resolves.toBe('round-trip');
    expect(value.onError).not.toHaveBeenCalled();
  });
  it('uses a fresh challenge and resets sequence after reconnect, rejecting old connection callbacks', async () => {
    const value = await fixture(),
      first = await value.connect();
    first.socket.onSend = (frame) => {
      if (frame.type === 'command')
        first.socket.emit({ type: 'ack', protocol: 1, sequence: frame.sequence });
    };
    await value.transport.send({ kind: 'inspect' }, 0);
    const oldCallback = first.socket.onmessage!;
    first.socket.close();
    expect(value.onDisconnect).toHaveBeenCalledTimes(1);
    const second = await value.connect();
    expect(second.auth.connectionId).not.toBe(first.auth.connectionId);
    expect(second.auth.nonce).not.toBe(first.auth.nonce);
    oldCallback(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'error', protocol: 1, code: 'STALE' }),
      }),
    );
    second.socket.onSend = (frame) => {
      if (frame.type === 'command')
        second.socket.emit({ type: 'ack', protocol: 1, sequence: frame.sequence });
    };
    await value.transport.send({ kind: 'inspect' }, 0);
    expect(second.socket.frames.find((frame) => frame.type === 'command').sequence).toBe(1);
    expect(value.onError).not.toHaveBeenCalled();
  });
  it('labels a missing ACK as unknown outcome and never automatically redispatches the mutation', async () => {
    const value = await fixture(),
      { socket } = await value.connect();
    vi.useFakeTimers();
    const result = value.transport.send(
      { kind: 'relay', payloadKind: 'application', ciphertext: 'AA' },
      0,
    );
    const rejected = expect(result).rejects.toThrow(/outcome is unknown.*Reconcile/);
    await socket.next('command');
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    expect(socket.frames.filter((frame) => frame.type === 'command')).toHaveLength(1);
  });
  it('rejects pending ACKs on close and cannot reconnect a permanently closed transport', async () => {
    const value = await fixture(),
      { socket } = await value.connect();
    const pending = value.transport.send({ kind: 'inspect' }, 0),
      rejected = expect(pending).rejects.toThrow(/closed/);
    await socket.next('command');
    value.transport.close();
    await rejected;
    await expect(value.transport.connect()).rejects.toThrow(/closed/);
  });
  it('rejects a connection still waiting for a challenge when user closes', async () => {
    const value = await fixture();
    const connected = value.transport.connect(),
      rejected = expect(connected).rejects.toThrow(/closed/);
    value.transport.close();
    await rejected;
  });
  it.each([
    { type: 'unknown', protocol: 1 },
    { type: 'ack', protocol: 99, sequence: 1 },
    { type: 'relay', protocol: 1, padding: 'a'.repeat(relayLimits.envelopeBytes) },
  ])('disconnects on unknown/oversized/protocol-invalid server frames', async (frame) => {
    const value = await fixture(),
      { socket } = await value.connect();
    socket.emit(frame);
    await vi.waitFor(() => expect(value.onError).toHaveBeenCalledTimes(1));
    expect(socket.readyState).toBe(3);
  });
  it('returns structured rejection to the matching pending command without dropping another ACK', async () => {
    const value = await fixture(),
      { socket } = await value.connect();
    socket.onSend = (frame) => {
      if (frame.type === 'command')
        socket.emit({
          type: 'error',
          protocol: 1,
          sequence: frame.sequence,
          code: 'WELCOME_MISMATCH',
        });
    };
    await expect(value.transport.send({ kind: 'inspect' }, 0)).rejects.toThrow(/WELCOME_MISMATCH/);
    socket.onSend = (frame) => {
      if (frame.type === 'command')
        socket.emit({ type: 'ack', protocol: 1, sequence: frame.sequence, result: 'valid' });
    };
    await expect(value.transport.send({ kind: 'inspect' }, 0)).resolves.toBe('valid');
    expect(value.onError).not.toHaveBeenCalled();
  });
  it('does not consume a command sequence when signing or local size validation fails before dispatch', async () => {
    const value = await fixture(),
      { socket } = await value.connect();
    await expect(
      value.transport.send(
        {
          kind: 'relay',
          payloadKind: 'application',
          ciphertext: 'a'.repeat(relayLimits.envelopeBytes),
        },
        0,
      ),
    ).rejects.toThrow(/limit/);
    socket.onSend = (frame) => {
      if (frame.type === 'command')
        socket.emit({ type: 'ack', protocol: 1, sequence: frame.sequence });
    };
    await value.transport.send({ kind: 'inspect' }, 0);
    expect(socket.frames.find((frame) => frame.type === 'command').sequence).toBe(1);
  });
  it('cannot publish a signed packet after close occurs during native signing', async () => {
    const identity = await createTransportIdentity(),
      nativeSign = identity.sign.bind(identity);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = {
      ...identity,
      async sign(domain: 'policy' | 'authenticate' | 'command', payload: unknown) {
        if (domain === 'command') await barrier;
        return nativeSign(domain, payload);
      },
    };
    const value = await fixture({ identity: blocked }),
      { socket } = await value.connect();
    const sending = value.transport.send({ kind: 'inspect' }, 0),
      rejected = expect(sending).rejects.toThrow(/changed|closed|Reconnect/);
    await Promise.resolve();
    value.transport.close();
    release();
    await rejected;
    expect(socket.frames.some((frame) => frame.type === 'command')).toBe(false);
  });
});
