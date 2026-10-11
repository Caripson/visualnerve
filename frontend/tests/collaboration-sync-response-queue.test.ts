import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaborationSyncResponseQueue } from '../src/collaboration/session/sync-response-queue';

const MiB = 1024 * 1024;
let queue: CollaborationSyncResponseQueue;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  queue.dispose();
  vi.useRealTimers();
});
function fixture(bytes = MiB) {
  let epoch = 0;
  const allowed = new Set(['viewer-a', 'viewer-b']);
  const received: Array<{ recipient: string; vector: number[]; at: number }> = [];
  const send = vi.fn(
    async (vector: Uint8Array, recipient: string, charge: (bytes: number) => void) => {
      received.push({ recipient, vector: [...vector], at: Date.now() });
      charge(bytes);
    },
  );
  const failure = vi.fn();
  queue = new CollaborationSyncResponseQueue({
    check: () => {},
    epoch: () => epoch,
    allowed: (recipient, originalEpoch) => allowed.has(recipient) && originalEpoch === epoch,
    send,
    failure,
  });
  return { send, received, failure, allowed, nextEpoch: () => epoch++ };
}
describe('bounded remote snapshot/diff recovery responses', () => {
  it('coalesces repeated requests before expensive compression and preserves a later recovery slot', async () => {
    const f = fixture();
    queue.request(new Uint8Array([0]), 'viewer-a');
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      queue.request(new Uint8Array([i]), 'viewer-a');
    }
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.failure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(f.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.received).toEqual([
      { recipient: 'viewer-a', vector: [0], at: 0 },
      { recipient: 'viewer-a', vector: [5], at: 60_000 },
    ]);
  });
  it('shares the global recovery allowance fairly instead of giving each requester a fresh byte budget', async () => {
    const f = fixture();
    queue.request(new Uint8Array([0]), 'viewer-a');
    queue.request(new Uint8Array([0]), 'viewer-b');
    await vi.advanceTimersByTimeAsync(0);
    queue.request(new Uint8Array([1]), 'viewer-a');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.received.map((item) => item.recipient)).toEqual(['viewer-a', 'viewer-b']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.received.map((item) => item.recipient)).toEqual(['viewer-a', 'viewer-b', 'viewer-a']);
  });
  it('allows a full large refresh and defers its legitimate retry according to actual compressed cost', async () => {
    const f = fixture(3 * MiB);
    queue.request(new Uint8Array([0]), 'viewer-a');
    await vi.advanceTimersByTimeAsync(0);
    queue.request(new Uint8Array([0]), 'viewer-a');
    await vi.advanceTimersByTimeAsync(179_999);
    expect(f.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.received[1].at).toBe(180_000);
  });
  it('drops queued requests after membership or epoch changes and zeroes in-flight input on disposal', async () => {
    const f = fixture();
    queue.request(new Uint8Array([0]), 'viewer-a');
    await vi.advanceTimersByTimeAsync(0);
    queue.request(new Uint8Array([2]), 'viewer-b');
    f.allowed.delete('viewer-b');
    f.nextEpoch();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    let owned!: Uint8Array;
    f.send.mockImplementation(async (vector) => {
      owned = vector;
      await new Promise(() => {});
    });
    queue.request(new Uint8Array([3]), 'viewer-a');
    await vi.advanceTimersByTimeAsync(0);
    expect([...owned]).toEqual([3]);
    queue.dispose();
    expect([...owned]).toEqual([0]);
  });
});
