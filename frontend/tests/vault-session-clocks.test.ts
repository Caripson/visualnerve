import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordStorage } from '../src/security/vault-storage';

const password = 'test-only shared session clock password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let name: string, now: number, storage: VaultRecordStorage;
let hidden: VaultSession, active: VaultSession;
const minute = 60_000;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  // A suspended/closed transport can miss broadcasts. Durable checks must work independently.
  vi.stubGlobal('BroadcastChannel', undefined);
  now = 100_000;
  name = `vault-clocks-${crypto.randomUUID()}`;
  storage = new VaultRecordStorage(name, indexedDB, () => now);
  await storage.create(created.header);
  hidden = new VaultSession(storage, cipher, () => now);
  active = new VaultSession(new VaultRecordStorage(name, indexedDB, () => now), cipher, () => now);
  await hidden.initialize();
  await hidden.unlock(password);
  await active.initialize();
  await active.unlock(password);
});
afterEach(async () => {
  await hidden.dispose();
  await active.dispose();
  vi.unstubAllGlobals();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('authoritative workspace-wide session clocks', () => {
  it('does not globally revoke an active sibling from a suspended tab stale idle snapshot', async () => {
    const epoch = hidden.getSnapshot().epoch;
    const absolute = hidden.getSnapshot().absoluteExpiresAt;
    now += 14 * minute;
    await active.recordHumanActivity();
    now += 2 * minute;
    expect(hidden.getSnapshot().idleExpiresAt).toBeLessThan(now);
    const durable = (await storage.control())!;
    expect(durable.lastActivityAt + durable.policy.idleTimeoutMs).toBeGreaterThan(now);
    const operation = await hidden.captureOperation();
    try {
      await operation.check();
      expect(hidden.getSnapshot()).toMatchObject({
        status: 'unlocked',
        epoch,
        absoluteExpiresAt: absolute,
      });
      expect(hidden.getSnapshot().idleExpiresAt).toBe(active.getSnapshot().idleExpiresAt);
      expect((await storage.control())!.locked).toBe(false);
      expect(await active.withUnlocked(async () => 'still active')).toBe('still active');
    } finally {
      operation.dispose();
    }
  });

  it('still revokes both tabs when the actual shared inactivity deadline expires', async () => {
    const operation = await active.captureOperation();
    now += 15 * minute;
    await expect(hidden.captureOperation()).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await expect(operation.check()).rejects.toMatchObject({ status: 423 });
    expect(hidden.getSnapshot().status).toBe('locked');
    expect(active.getSnapshot().status).toBe('locked');
    expect((await storage.control())!.locked).toBe(true);
    operation.dispose();
  });

  it('never lets sibling human activity or additional unlocking extend the absolute session deadline', async () => {
    const initial = (await storage.control())!;
    for (let i = 0; i < 47; i++) {
      now += 10 * minute;
      await active.recordHumanActivity();
    }
    await hidden.verify();
    expect((await storage.control())!.startedAt).toBe(initial.startedAt);
    expect(hidden.getSnapshot().absoluteExpiresAt).toBe(
      initial.startedAt + initial.policy.absoluteTimeoutMs,
    );
    now += 10 * minute;
    const durable = (await storage.control())!;
    expect(durable.lastActivityAt + durable.policy.idleTimeoutMs).toBeGreaterThan(now);
    await expect(hidden.captureOperation()).rejects.toMatchObject({ status: 423 });
    expect((await storage.control())!.locked).toBe(true);
    await expect(active.verify()).rejects.toMatchObject({ status: 423 });
  });

  it('reads a missed policy extension before applying a cached idle deadline', async () => {
    const before = (await storage.control())!;
    now += 10 * minute;
    await active.setPolicy({ idleTimeoutMs: 30 * minute, absoluteTimeoutMs: 8 * 60 * minute });
    now += 6 * minute;
    expect(hidden.getSnapshot().idleExpiresAt).toBeLessThan(now);
    const operation = await hidden.captureOperation();
    try {
      expect(hidden.getSnapshot().idleExpiresAt).toBe(before.lastActivityAt + 30 * minute);
      expect(hidden.getSnapshot().absoluteExpiresAt).toBe(
        before.startedAt + before.policy.absoluteTimeoutMs,
      );
      expect((await storage.control())!.locked).toBe(false);
    } finally {
      operation.dispose();
    }
  });
});
