import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64url, unbase64url } from '../src/security/vault-codec';
import {
  CollaborationMessageFramer,
  CollaborationMessageAssembler,
  collaborationFrameLimits,
} from '../src/collaboration/sync/message-framing';

let diagramId: string, framer: CollaborationMessageFramer, assembler: CollaborationMessageAssembler;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (value: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(value)) as Record<string, unknown>;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  diagramId = crypto.randomUUID();
  framer = new CollaborationMessageFramer(diagramId);
  assembler = new CollaborationMessageAssembler(diagramId);
});
afterEach(() => {
  assembler.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authenticated application message framing', () => {
  it('round-trips out-of-order chunks larger than one MLS payload with exact duplicate suppression', async () => {
    const payload = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const large = new Uint8Array(100_000);
    large.set(payload);
    large.set(payload.subarray(0, 34_464), 65_536);
    const frames = await framer.encode('update', large);
    expect(frames.length).toBe(4);
    expect(frames.every((frame) => frame.byteLength <= 64 * 1024)).toBe(true);
    expect(await assembler.accept('device-12345', 3, frames[2])).toBeUndefined();
    expect(await assembler.accept('device-12345', 3, frames[2])).toBeUndefined();
    expect(await assembler.accept('device-12345', 3, frames[0])).toBeUndefined();
    expect(await assembler.accept('device-12345', 3, frames[3])).toBeUndefined();
    const result = await assembler.accept('device-12345', 3, frames[1]);
    expect(result?.kind).toBe('update');
    expect([...result!.payload]).toEqual([...large]);
    expect(assembler.bufferedBytes).toBe(0);
    expect(assembler.activeMessages).toBe(0);
    expect(await assembler.accept('device-12345', 3, frames[0])).toBeUndefined();
  });
  it('binds all chunks to the exact sender, epoch and diagram without destroying the valid pending message', async () => {
    const frames = await framer.encode('snapshot', new Uint8Array(40_000));
    await assembler.accept('device-12345', 3, frames[0]);
    await expect(assembler.accept('device-98765', 3, frames[1])).rejects.toMatchObject({
      code: 'COLLABORATION_FRAME_CONFLICT',
    });
    await expect(assembler.accept('device-12345', 4, frames[1])).rejects.toMatchObject({
      code: 'COLLABORATION_FRAME_CONFLICT',
    });
    await expect(
      assembler.accept(
        'device-12345',
        3,
        encode({ ...decode(frames[1]), diagramId: crypto.randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: 'COLLABORATION_INVALID_FRAME' });
    expect((await assembler.accept('device-12345', 3, frames[1]))?.payload.byteLength).toBe(40_000);
  });
  it('rejects conflicting duplicate parts and validates the complete hash before exposing bytes', async () => {
    const frames = await framer.encode('update', new Uint8Array(40_000));
    await assembler.accept('device-12345', 1, frames[0]);
    const modified = decode(frames[0]);
    const data = unbase64url(modified.data, 32 * 1024);
    data[0] = 1;
    modified.data = base64url(data);
    await expect(assembler.accept('device-12345', 1, encode(modified))).rejects.toMatchObject({
      code: 'COLLABORATION_FRAME_CONFLICT',
    });
    assembler.clear();
    const wrongHash = 'A'.repeat(43);
    await assembler.accept('device-12345', 1, encode({ ...decode(frames[0]), hash: wrongHash }));
    await expect(
      assembler.accept('device-12345', 1, encode({ ...decode(frames[1]), hash: wrongHash })),
    ).rejects.toMatchObject({ code: 'COLLABORATION_HASH_MISMATCH' });
    expect(assembler.bufferedBytes).toBe(0);
  });
  it('allocates only received chunks and enforces the total global 32 MiB budget across clients', async () => {
    const data = base64url(new Uint8Array(collaborationFrameLimits.chunkBytes));
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    const frame = (messageId: string, part: number) =>
      encode({
        format: 'visualnerve-collaboration-chunk',
        version: 1,
        messageId,
        kind: 'snapshot',
        diagramId,
        part,
        total: 1024,
        bytes: 32 * 1024 * 1024,
        hash: 'A'.repeat(43),
        data,
      });
    await assembler.accept('device-12345', 1, frame(first, 0));
    expect(assembler.bufferedBytes).toBe(32 * 1024);
    for (let part = 1; part < 1023; part++)
      await assembler.accept('device-12345', 1, frame(first, part));
    await assembler.accept('device-98765', 1, frame(second, 0));
    expect(assembler.bufferedBytes).toBe(32 * 1024 * 1024);
    await expect(assembler.accept('device-98765', 1, frame(second, 1))).rejects.toMatchObject({
      code: 'COLLABORATION_MESSAGE_LIMIT',
      status: 429,
    });
    assembler.clear();
    expect(assembler.bufferedBytes).toBe(0);
  });
  it('limits active incomplete messages independently of their advertised size', async () => {
    const frame = (await framer.encode('sync', new Uint8Array(40_000)))[0];
    for (let i = 0; i < 8; i++)
      await assembler.accept(
        'device-12345',
        0,
        encode({ ...decode(frame), messageId: crypto.randomUUID() }),
      );
    expect(assembler.activeMessages).toBe(8);
    await expect(
      assembler.accept(
        'device-12345',
        0,
        encode({ ...decode(frame), messageId: crypto.randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: 'COLLABORATION_MESSAGE_LIMIT' });
  });
  it('expires pending chunks automatically at 60 seconds and rejects late continuation', async () => {
    const frames = await framer.encode('snapshot', new Uint8Array(40_000));
    vi.useFakeTimers();
    assembler.dispose();
    assembler = new CollaborationMessageAssembler(diagramId);
    await assembler.accept('device-12345', 0, frames[0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(assembler.activeMessages).toBe(0);
    expect(assembler.bufferedBytes).toBe(0);
    await expect(assembler.accept('device-12345', 0, frames[1])).rejects.toMatchObject({
      code: 'COLLABORATION_MESSAGE_EXPIRED',
    });
  });
  it('rejects unknown/prototype fields, malformed lengths and oversize frames without retaining data', async () => {
    const frame = decode((await framer.encode('presence', new Uint8Array(32)))[0]);
    for (const value of [
      { ...frame, arbitrary: true },
      { ...frame, ['__proto__']: { polluted: true } },
      { ...frame, part: -1 },
      { ...frame, total: 2049 },
      { ...frame, bytes: 33 * 1024 * 1024 },
      { ...frame, data: 'not base64!' },
      { ...frame, version: 2 },
      { ...frame, kind: 'execute' },
    ])
      await expect(assembler.accept('device-12345', 0, encode(value))).rejects.toMatchObject({
        code: 'COLLABORATION_INVALID_FRAME',
      });
    await expect(assembler.accept('device-12345', 0, new Uint8Array(65537))).rejects.toMatchObject({
      code: 'COLLABORATION_INVALID_FRAME',
    });
    expect(assembler.activeMessages).toBe(0);
    expect(assembler.bufferedBytes).toBe(0);
  });
  it('never publishes completed bytes if lock clears state during asynchronous hashing', async () => {
    const frame = (await framer.encode('update', new Uint8Array([1, 2, 3])))[0];
    const digest = unbase64url(decode(frame).hash, 32);
    let resolve!: (value: ArrayBuffer) => void;
    const waiting = new Promise<ArrayBuffer>((done) => {
      resolve = done;
    });
    const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => waiting);
    const result = assembler.accept('device-12345', 0, frame);
    const outcome = expect(result).rejects.toMatchObject({
      code: 'COLLABORATION_CLOSED',
      status: 423,
    });
    const input = hashing.mock.calls[0][1] as Uint8Array;
    assembler.clear();
    expect([...input]).toEqual([0, 0, 0]);
    resolve(digest.buffer as ArrayBuffer);
    await outcome;
    expect(assembler.activeMessages).toBe(0);
    expect(assembler.bufferedBytes).toBe(0);
  });
  it('owns producer input before any await and cancels safely on the original session signal', async () => {
    const source = new Uint8Array([11, 12, 13]);
    const producing = framer.encode('sync', source);
    source.fill(0);
    const frames = await producing;
    const result = await assembler.accept('device-12345', 0, frames[0]);
    expect([...result!.payload]).toEqual([11, 12, 13]);
    const controller = new AbortController();
    const iter = framer.frames('snapshot', new Uint8Array(40_000), controller.signal);
    await iter.next();
    controller.abort();
    await expect(iter.next()).rejects.toMatchObject({ code: 'COLLABORATION_CLOSED' });
  });
  it('supports empty messages and makes dispose a permanent lock boundary', async () => {
    const frames = await framer.encode('sync', new Uint8Array());
    expect((await assembler.accept('device-12345', 0, frames[0]))?.payload.byteLength).toBe(0);
    assembler.dispose();
    await expect(assembler.accept('device-12345', 0, frames[0])).rejects.toMatchObject({
      code: 'COLLABORATION_CLOSED',
    });
  });
});
