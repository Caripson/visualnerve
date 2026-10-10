import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaborationRelayQuota } from '../src/collaboration/session/relay-quota';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());
describe('complete-message relay budget reservations', () => {
  it('rejects impossible or noninteger batches without admitting their first frame', async () => {
    const quota = new CollaborationRelayQuota(),
      signal = new AbortController().signal;
    for (const [messages, bytes] of [
      [0, 1],
      [-1, 1],
      [501, 1],
      [1.5, 1],
      [1, -1],
      [1, 6 * 1024 * 1024 + 1],
      [1, NaN],
    ])
      await expect(quota.reserve(messages, bytes, signal)).rejects.toThrow(/quota/);
    await expect(quota.reserve(500, 6 * 1024 * 1024, signal)).resolves.toBeUndefined();
  });
  it('reserves a full batch atomically and waits for the actual rolling message/byte budget', async () => {
    const quota = new CollaborationRelayQuota(),
      signal = new AbortController().signal;
    await quota.reserve(500, 6 * 1024 * 1024, signal);
    let admitted = false;
    const next = quota.reserve(1, 1, signal).then(() => {
      admitted = true;
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(admitted).toBe(true);
  });
  it('retains younger reservations when the oldest batch expires', async () => {
    const quota = new CollaborationRelayQuota(),
      signal = new AbortController().signal;
    await quota.reserve(400, 4 * 1024 * 1024, signal);
    await vi.advanceTimersByTimeAsync(30_000);
    await quota.reserve(100, 2 * 1024 * 1024, signal);
    let admitted = false;
    const waiting = quota.reserve(401, 4 * 1024 * 1024, signal).then(() => {
      admitted = true;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(admitted).toBe(true);
  });
  it('does not overreserve when concurrent waiters wake at the same deadline', async () => {
    const quota = new CollaborationRelayQuota(),
      signal = new AbortController().signal;
    await quota.reserve(500, 1, signal);
    const accepted: number[] = [];
    const first = quota.reserve(500, 1, signal).then(() => {
      accepted.push(1);
    });
    const second = quota.reserve(500, 1, signal).then(() => {
      accepted.push(2);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await first;
    expect(accepted).toEqual([1]);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;
    expect(accepted).toEqual([1, 2]);
  });
  it('revocation cancels a waiting reservation and removes its timer', async () => {
    const quota = new CollaborationRelayQuota(),
      controller = new AbortController();
    await quota.reserve(500, 1, controller.signal);
    const waiting = quota.reserve(1, 1, controller.signal);
    const rejection = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    await expect(quota.reserve(1, 1, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
