import { StorageError } from '../../model/errors';
import { base64url, unbase64url } from '../../security/vault-codec';
import { isCollaborationBytes } from '../document/bytes';

export const collaborationFrameLimits = Object.freeze({
  frameBytes: 64 * 1024,
  chunkBytes: 32 * 1024,
  messageBytes: 32 * 1024 * 1024,
  activeMessages: 8,
  totalBufferedBytes: 32 * 1024 * 1024,
  parts: 2048,
  timeoutMs: 60_000,
  replayIds: 256,
});
export type CollaborationPayloadKind = 'update' | 'snapshot' | 'sync' | 'presence';
const kinds = new Set<CollaborationPayloadKind>(['update', 'snapshot', 'sync', 'presence']);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
interface Frame {
  format: 'visualnerve-collaboration-chunk';
  version: 1;
  messageId: string;
  kind: CollaborationPayloadKind;
  diagramId: string;
  part: number;
  total: number;
  bytes: number;
  hash: string;
  data: string;
}
interface Pending {
  sender: string;
  epoch: number;
  frame: Omit<Frame, 'part' | 'data'>;
  chunks: Map<number, Uint8Array>;
  receivedBytes: number;
  expires: number;
  assembled?: Uint8Array;
}
interface Retired {
  sender: string;
  epoch: number;
  hash: string;
  expires: number;
  failed: boolean;
}
export interface CollaborationReassembledMessage {
  messageId: string;
  kind: CollaborationPayloadKind;
  payload: Uint8Array;
}
export class CollaborationFramingError extends StorageError {
  constructor(
    public code: string,
    message: string,
    status = 422,
  ) {
    super(status, message);
  }
}
const fail = (code: string, message: string, status = 422): never => {
  throw new CollaborationFramingError(code, message, status);
};
const invalid = (): never =>
  fail('COLLABORATION_INVALID_FRAME', 'Invalid collaboration message frame.');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const fields = new Set([
  'format',
  'version',
  'messageId',
  'kind',
  'diagramId',
  'part',
  'total',
  'bytes',
  'hash',
  'data',
]);
async function hash(payload: Uint8Array): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', payload as BufferSource)));
}
function parse(bytes: Uint8Array, diagramId: string): Frame {
  if (!isCollaborationBytes(bytes) || bytes.byteLength > collaborationFrameLimits.frameBytes)
    invalid();
  let frame: Frame;
  try {
    frame = JSON.parse(decoder.decode(bytes)) as Frame;
  } catch {
    return invalid();
  }
  if (
    !frame ||
    Object.getPrototypeOf(frame) !== Object.prototype ||
    Object.keys(frame).length !== fields.size ||
    Object.keys(frame).some((key) => !fields.has(key)) ||
    frame.format !== 'visualnerve-collaboration-chunk' ||
    frame.version !== 1 ||
    typeof frame.messageId !== 'string' ||
    !uuid.test(frame.messageId) ||
    frame.diagramId !== diagramId ||
    !kinds.has(frame.kind) ||
    !Number.isSafeInteger(frame.bytes) ||
    frame.bytes < 0 ||
    frame.bytes > collaborationFrameLimits.messageBytes ||
    !Number.isSafeInteger(frame.total) ||
    frame.total < 1 ||
    frame.total > collaborationFrameLimits.parts ||
    frame.total !== Math.max(1, Math.ceil(frame.bytes / collaborationFrameLimits.chunkBytes)) ||
    !Number.isSafeInteger(frame.part) ||
    frame.part < 0 ||
    frame.part >= frame.total ||
    typeof frame.hash !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(frame.hash) ||
    typeof frame.data !== 'string'
  )
    invalid();
  return frame;
}
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) fail('COLLABORATION_CLOSED', 'The collaboration session has closed.', 423);
}

/** Produces individual MLS application payloads, never unauthenticated transport data. */
export class CollaborationMessageFramer {
  constructor(readonly diagramId: string) {
    if (!uuid.test(diagramId)) invalid();
  }
  frames(
    kind: CollaborationPayloadKind,
    payload: Uint8Array,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    checkSignal(signal);
    if (
      !kinds.has(kind) ||
      !isCollaborationBytes(payload) ||
      payload.byteLength > collaborationFrameLimits.messageBytes
    )
      invalid();
    // Take ownership synchronously, even though the generator is consumed later.
    const source = new Uint8Array(payload);
    const abort = () => source.fill(0);
    signal?.addEventListener('abort', abort, { once: true });
    return this.generate(kind, source, signal, abort);
  }
  private async *generate(
    kind: CollaborationPayloadKind,
    source: Uint8Array,
    signal?: AbortSignal,
    abort?: () => void,
  ): AsyncGenerator<Uint8Array> {
    try {
      const digest = await hash(source);
      checkSignal(signal);
      const messageId = crypto.randomUUID();
      const total = Math.max(1, Math.ceil(source.byteLength / collaborationFrameLimits.chunkBytes));
      for (let part = 0; part < total; part++) {
        checkSignal(signal);
        const frame: Frame = {
          format: 'visualnerve-collaboration-chunk',
          version: 1,
          messageId,
          kind,
          diagramId: this.diagramId,
          part,
          total,
          bytes: source.byteLength,
          hash: digest,
          data: base64url(
            source.subarray(
              part * collaborationFrameLimits.chunkBytes,
              (part + 1) * collaborationFrameLimits.chunkBytes,
            ),
          ),
        };
        const result = encoder.encode(JSON.stringify(frame));
        if (result.byteLength > collaborationFrameLimits.frameBytes) invalid();
        yield result;
      }
    } finally {
      source.fill(0);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }
  async encode(
    kind: CollaborationPayloadKind,
    payload: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Uint8Array[]> {
    const result: Uint8Array[] = [];
    try {
      for await (const frame of this.frames(kind, payload, signal)) result.push(frame);
      return result;
    } catch (error) {
      for (const frame of result) frame.fill(0);
      throw error;
    }
  }
}

/**
 * Call accept only after validating the MLS sender, current epoch and signed ACL
 * role. No raw network frame may bypass that boundary. Allocation follows bytes
 * actually received; advertised message size never allocates a full buffer.
 */
export class CollaborationMessageAssembler {
  private pending = new Map<string, Pending>();
  private retired = new Map<string, Retired>();
  private buffered = 0;
  private generation = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private now: () => number;
  constructor(
    readonly diagramId: string,
    options: { now?: () => number } = {},
  ) {
    if (!uuid.test(diagramId)) invalid();
    this.now = options.now ?? Date.now;
  }
  get bufferedBytes() {
    this.expire();
    return this.buffered;
  }
  get activeMessages() {
    this.expire();
    return this.pending.size;
  }
  private retire(messageId: string, entry: Pending, failed: boolean) {
    this.retired.set(messageId, {
      sender: entry.sender,
      epoch: entry.epoch,
      hash: entry.frame.hash,
      expires: this.now() + collaborationFrameLimits.timeoutMs,
      failed,
    });
    while (this.retired.size > collaborationFrameLimits.replayIds)
      this.retired.delete(this.retired.keys().next().value!);
  }
  private discard(messageId: string, entry: Pending) {
    if (this.pending.get(messageId) !== entry) return;
    this.pending.delete(messageId);
    this.buffered -= entry.receivedBytes;
    for (const chunk of entry.chunks.values()) chunk.fill(0);
    entry.chunks.clear();
    entry.assembled?.fill(0);
  }
  private expire() {
    const now = this.now();
    for (const [id, entry] of this.pending)
      if (entry.expires <= now) {
        this.retire(id, entry, true);
        this.discard(id, entry);
      }
    for (const [id, entry] of this.retired) if (entry.expires <= now) this.retired.delete(id);
  }
  private scheduleExpiry() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || (!this.pending.size && !this.retired.size)) return;
    const expires = Math.min(
      ...[...this.pending.values(), ...this.retired.values()].map((entry) => entry.expires),
    );
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.expire();
        this.scheduleExpiry();
      },
      Math.max(1, expires - this.now()),
    );
  }
  async accept(
    senderDeviceId: string,
    epoch: number,
    bytes: Uint8Array,
  ): Promise<CollaborationReassembledMessage | undefined> {
    if (this.disposed) fail('COLLABORATION_CLOSED', 'The collaboration session has closed.', 423);
    if (
      typeof senderDeviceId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(senderDeviceId) ||
      !Number.isSafeInteger(epoch) ||
      epoch < 0
    )
      invalid();
    this.expire();
    const frame = parse(bytes, this.diagramId);
    const retired = this.retired.get(frame.messageId);
    if (retired) {
      if (
        retired.sender !== senderDeviceId ||
        retired.epoch !== epoch ||
        retired.hash !== frame.hash
      )
        fail(
          'COLLABORATION_FRAME_CONFLICT',
          'The message identity conflicts with an earlier message.',
        );
      if (retired.failed)
        fail(
          'COLLABORATION_MESSAGE_EXPIRED',
          'This message expired or failed. Request state synchronization.',
          409,
        );
      return undefined;
    }
    let entry = this.pending.get(frame.messageId);
    if (
      entry &&
      (entry.sender !== senderDeviceId ||
        entry.epoch !== epoch ||
        entry.frame.hash !== frame.hash ||
        entry.frame.total !== frame.total ||
        entry.frame.bytes !== frame.bytes ||
        entry.frame.kind !== frame.kind)
    )
      fail(
        'COLLABORATION_FRAME_CONFLICT',
        'Chunks belong to different senders, epochs or messages.',
      );
    let chunk: Uint8Array;
    const expectedLength =
      frame.part === frame.total - 1
        ? frame.bytes - frame.part * collaborationFrameLimits.chunkBytes
        : collaborationFrameLimits.chunkBytes;
    try {
      chunk = unbase64url(frame.data, expectedLength, expectedLength);
    } catch {
      return invalid();
    }
    if (entry?.assembled) {
      chunk.fill(0);
      return undefined;
    }
    const existing = entry?.chunks.get(frame.part);
    if (existing) {
      const same =
        chunk.length === existing.length && chunk.every((byte, index) => byte === existing[index]);
      chunk.fill(0);
      if (!same)
        fail('COLLABORATION_FRAME_CONFLICT', 'A chunk was repeated with different content.');
      return undefined;
    }
    if (
      (!entry && this.pending.size >= collaborationFrameLimits.activeMessages) ||
      this.buffered + chunk.byteLength > collaborationFrameLimits.totalBufferedBytes
    ) {
      chunk.fill(0);
      fail(
        'COLLABORATION_MESSAGE_LIMIT',
        'Too many pending collaboration messages. Request state synchronization.',
        429,
      );
    }
    if (!entry) {
      const { part: _part, data: _data, ...identity } = frame;
      entry = {
        sender: senderDeviceId,
        epoch,
        frame: identity,
        chunks: new Map(),
        receivedBytes: 0,
        expires: this.now() + collaborationFrameLimits.timeoutMs,
      };
      this.pending.set(frame.messageId, entry);
      this.scheduleExpiry();
    }
    entry.chunks.set(frame.part, chunk);
    entry.receivedBytes += chunk.byteLength;
    this.buffered += chunk.byteLength;
    if (entry.chunks.size !== frame.total) return undefined;
    const generation = this.generation;
    const payload = new Uint8Array(entry.receivedBytes);
    let offset = 0;
    for (let i = 0; i < frame.total; i++) {
      const value = entry.chunks.get(i)!;
      payload.set(value, offset);
      offset += value.byteLength;
      value.fill(0);
    }
    entry.chunks.clear();
    entry.assembled = payload;
    try {
      const actual = await hash(payload);
      if (
        this.disposed ||
        generation !== this.generation ||
        this.pending.get(frame.messageId) !== entry
      )
        fail(
          'COLLABORATION_CLOSED',
          'The collaboration session changed while assembling this message.',
          423,
        );
      if (this.now() >= entry.expires)
        fail(
          'COLLABORATION_MESSAGE_EXPIRED',
          'This message expired. Request state synchronization.',
          409,
        );
      if (actual !== frame.hash)
        fail(
          'COLLABORATION_HASH_MISMATCH',
          'The complete collaboration message failed its integrity check.',
        );
      this.pending.delete(frame.messageId);
      this.buffered -= entry.receivedBytes;
      entry.assembled = undefined;
      this.retire(frame.messageId, entry, false);
      this.scheduleExpiry();
      return { messageId: frame.messageId, kind: frame.kind, payload };
    } catch (error) {
      if (generation === this.generation) this.retire(frame.messageId, entry, true);
      this.discard(frame.messageId, entry);
      payload.fill(0);
      this.scheduleExpiry();
      throw error;
    }
  }
  /** Lock, a new MLS epoch or leaving the room invalidates in-flight hash work. */
  clear() {
    this.generation++;
    for (const [id, entry] of this.pending) this.discard(id, entry);
    this.retired.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
}
