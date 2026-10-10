import {
  collaborationProtocol,
  relayLimits,
  type Authentication,
  type Challenge,
  type DeviceIdentity,
  type ServerFrame,
  type SignedCommand,
  type SignedRoomPolicy,
} from '../../../../collaboration-worker/src/protocol';
import {
  record,
  roomId as validRoomId,
  decode,
} from '../../../../collaboration-worker/src/validation';
import type { TransportIdentity } from './identity';

export interface RoomTransportOptions {
  relayUrl: string;
  roomId: string;
  identity: TransportIdentity;
  device: DeviceIdentity;
  invitation?: string;
  keyPackage?: string;
  onFrame(frame: ServerFrame): Promise<void> | void;
  onDisconnect(): void;
  onError(error: Error): void;
  socket?: (url: string) => WebSocket;
}
interface PendingCommand {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
/** A correlated relay rejection has a known outcome, unlike a timeout. */
export class CollaborationRelayError extends Error {
  constructor(readonly code: string) {
    super(`Collaboration request rejected: ${code}.`);
    this.name = 'CollaborationRelayError';
  }
}

export function relayOrigin(input: string): string {
  const url = new URL(input);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('The collaboration relay must be an HTTPS origin.');
  return url.origin;
}

/** Only signed public control metadata and opaque MLS bytes cross this boundary. */
export class RoomTransport {
  private socket?: WebSocket;
  private connectionId = '';
  private sequence = 0;
  private generation = 0;
  private closed = false;
  private admissionPending: boolean;
  private reader = Promise.resolve();
  private writer = Promise.resolve();
  private pending = new Map<number, PendingCommand>();
  private connecting?: {
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };
  readonly origin: string;

  constructor(private readonly options: RoomTransportOptions) {
    this.origin = relayOrigin(options.relayUrl);
    this.admissionPending = !!options.invitation;
    validRoomId(options.roomId);
    if (options.identity.public.deviceId !== options.device.deviceId)
      throw new Error('The collaboration device identity does not match.');
  }

  async create(policy: SignedRoomPolicy): Promise<void> {
    if (policy.policy.roomId !== this.options.roomId) throw new Error('Room identifier mismatch.');
    const response = await fetch(`${this.origin}/v1/rooms`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy }),
    });
    if (!response.ok)
      throw new Error(`The collaboration room could not be created (${response.status}).`);
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('This collaboration room has been closed.'));
    if (this.socket)
      return Promise.reject(new Error('The collaboration room is already connecting.'));
    const generation = ++this.generation;
    this.sequence = 0;
    this.connectionId = '';
    this.reader = Promise.resolve();
    const url = new URL(`/v1/rooms/${this.options.roomId}/socket`, this.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = (this.options.socket ?? ((url) => new WebSocket(url)))(url.href);
    this.socket = socket;
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error('The collaboration connection timed out.')),
        relayLimits.challengeMs + 5000,
      );
      this.connecting = { resolve, reject, timer };
    });
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      if (
        typeof event.data !== 'string' ||
        new TextEncoder().encode(event.data).length > relayLimits.envelopeBytes
      ) {
        this.fail(new Error('The collaboration relay sent an oversized or invalid message.'));
        return;
      }
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
        if (!frame || frame.protocol !== collaborationProtocol)
          throw new Error('Unsupported collaboration relay protocol.');
        // ACKs must bypass the ordered application reader. A peer callback can
        // send a snapshot/response and await its ACK while this reader is busy.
        if (frame.type === 'ack') {
          const pending = this.pending.get(frame.sequence);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(frame.sequence);
            pending.resolve(frame.result);
          }
          return;
        }
        if (frame.type === 'error') {
          const error = new CollaborationRelayError(String(frame.code).slice(0, 80));
          const pending =
            frame.sequence === undefined ? undefined : this.pending.get(frame.sequence);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(frame.sequence!);
            pending.reject(error);
          } else throw error;
          return;
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('Invalid collaboration message.'));
        return;
      }
      this.reader = this.reader
        .then(async () => {
          if (generation !== this.generation) return;
          if (frame.type === 'challenge') {
            await this.authenticate(frame, generation);
            return;
          }
          if (
            !['authenticated', 'pending', 'join-request', 'relay', 'policy', 'welcome'].includes(
              frame.type,
            )
          )
            throw new Error('The collaboration relay sent an unexpected message.');
          await this.options.onFrame(frame);
          if (generation !== this.generation) return;
          if (frame.type === 'authenticated' || frame.type === 'welcome')
            this.admissionPending = false;
          if ((frame.type === 'authenticated' || frame.type === 'pending') && this.connecting) {
            clearTimeout(this.connecting.timer);
            this.connecting.resolve();
            this.connecting = undefined;
          }
        })
        .catch((error) => {
          if (generation === this.generation)
            this.fail(
              error instanceof Error ? error : new Error('The collaboration message failed.'),
            );
        });
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      this.disconnect(
        new Error(
          'The collaboration connection closed; a pending write may already have been delivered.',
        ),
      );
      this.options.onDisconnect();
    };
    socket.onerror = () => {
      if (generation === this.generation)
        this.fail(new Error('The collaboration relay could not be reached.'));
    };
    return connected;
  }

  private async authenticate(challenge: Challenge, generation: number): Promise<void> {
    record(challenge, ['type', 'protocol', 'roomId', 'connectionId', 'nonce', 'expiresAt']);
    if (
      challenge.roomId !== this.options.roomId ||
      this.connectionId ||
      typeof challenge.connectionId !== 'string' ||
      challenge.connectionId.length > 128 ||
      !Number.isSafeInteger(challenge.expiresAt) ||
      challenge.expiresAt <= Date.now() ||
      challenge.expiresAt > Date.now() + relayLimits.challengeMs + 5000
    )
      throw new Error('The collaboration challenge is invalid or expired. Check the device clock.');
    decode(challenge.nonce, 32, 32);
    this.connectionId = challenge.connectionId;
    const unsigned: Omit<Authentication, 'signature'> = {
      type: 'authenticate',
      protocol: collaborationProtocol,
      roomId: this.options.roomId,
      connectionId: challenge.connectionId,
      nonce: challenge.nonce,
      device: this.options.device,
      ...(this.admissionPending && this.options.invitation
        ? { invitation: this.options.invitation }
        : {}),
      ...(this.admissionPending && this.options.keyPackage
        ? { keyPackage: this.options.keyPackage }
        : {}),
    };
    const signature = await this.options.identity.sign('authenticate', unsigned);
    if (generation !== this.generation) throw new Error('The collaboration connection changed.');
    this.socket!.send(JSON.stringify({ ...unsigned, signature }));
  }

  send(body: SignedCommand['body'], epoch: number): Promise<unknown> {
    let result!: Promise<unknown>;
    const write = this.writer.then(async () => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connectionId)
        throw new Error('Reconnect to the collaboration room before sending changes.');
      if (this.pending.size >= 64) throw new Error('The collaboration relay is busy.');
      const generation = this.generation;
      const sequence = this.sequence + 1;
      const unsigned: Omit<SignedCommand, 'signature'> = {
        type: 'command',
        protocol: collaborationProtocol,
        roomId: this.options.roomId,
        connectionId: this.connectionId,
        deviceId: this.options.device.deviceId,
        sequence,
        epoch,
        body,
      };
      const signature = await this.options.identity.sign('command', unsigned);
      if (generation !== this.generation) throw new Error('The collaboration connection changed.');
      const encoded = JSON.stringify({ ...unsigned, signature });
      if (new TextEncoder().encode(encoded).length > relayLimits.envelopeBytes)
        throw new Error('The collaboration message exceeds the relay limit.');
      result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(sequence);
          reject(
            new Error(
              'The collaboration write outcome is unknown. Reconcile room state before retrying.',
            ),
          );
        }, 15_000);
        this.pending.set(sequence, { resolve, reject, timer });
      });
      // Attach a handler before a disconnected socket can reject the pending outcome.
      void result.catch(() => undefined);
      this.sequence = sequence;
      try {
        this.socket.send(encoded);
      } catch {
        this.disconnect(
          new Error('The collaboration write outcome is unknown. Reconcile before retrying.'),
        );
        throw new Error('The collaboration message could not be sent. Reconnect before retrying.');
      }
    });
    this.writer = write.catch(() => {});
    return write.then(() => result);
  }

  disconnect(error = new Error('The collaboration connection was closed.')): void {
    ++this.generation;
    const socket = this.socket;
    this.socket = undefined;
    this.connectionId = '';
    socket?.close();
    if (this.connecting) {
      clearTimeout(this.connecting.timer);
      this.connecting.reject(error);
      this.connecting = undefined;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close(): void {
    this.closed = true;
    this.disconnect();
  }
  private fail(error: Error): void {
    this.disconnect(error);
    this.options.onError(error);
  }
}
