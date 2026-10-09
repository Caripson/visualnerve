import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultSession } from '../src/security/vault-session';
import {
  defaultVaultSessionPolicy,
  validateVaultSessionPolicy,
  VaultRecordStorage,
} from '../src/security/vault-storage';

const password = 'test-only automatic lock choice password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let name: string, now: number, storage: VaultRecordStorage;
let session: VaultSession, sibling: VaultSession;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  now = 100_000;
  name = `vault-timer-${crypto.randomUUID()}`;
  storage = new VaultRecordStorage(name, indexedDB, () => now);
  await storage.create(created.header);
  session = new VaultSession(storage, cipher, () => now);
  sibling = new VaultSession(new VaultRecordStorage(name, indexedDB, () => now), cipher, () => now);
  await session.initialize();
  await session.unlock(password);
  await sibling.initialize();
  await sibling.unlock(password);
});
afterEach(async () => {
  await session.dispose();
  await sibling.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('explicit human automatic session-lock choice', () => {
  it('keeps old policies enabled, accepts an explicit false and rejects malformed choices', () => {
    expect(validateVaultSessionPolicy(defaultVaultSessionPolicy)).toEqual(
      defaultVaultSessionPolicy,
    );
    expect(
      validateVaultSessionPolicy({ ...defaultVaultSessionPolicy, sessionTimerEnabled: true }),
    ).toEqual(defaultVaultSessionPolicy);
    expect(
      validateVaultSessionPolicy({ ...defaultVaultSessionPolicy, sessionTimerEnabled: false })
        .sessionTimerEnabled,
    ).toBe(false);
    for (const value of ['false', 0, null, {}])
      expect(() =>
        validateVaultSessionPolicy({
          ...defaultVaultSessionPolicy,
          sessionTimerEnabled: value as boolean,
        }),
      ).toThrow();
  });

  it('disables both automatic deadlines without extending clocks or disabling durable revocation', async () => {
    const before = (await storage.control())!;
    const operation = await sibling.captureOperation();
    await session.setPolicy({ ...defaultVaultSessionPolicy, sessionTimerEnabled: false });
    now += 3 * 24 * 3_600_000;
    await operation.check();
    expect(await session.withUnlocked(async () => 'private operation')).toBe('private operation');
    expect(session.getSnapshot()).toMatchObject({ status: 'unlocked', sessionTimerEnabled: false });
    expect(session.getSnapshot()).not.toHaveProperty('idleExpiresAt');
    expect(session.getSnapshot()).not.toHaveProperty('absoluteExpiresAt');
    const after = (await storage.control())!;
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    await session.lock();
    await expect(operation.check()).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    expect(sibling.getSnapshot().status).toBe('locked');
    operation.dispose();
  });

  it('allows an authenticated startup choice and restores it on another visit without persisting keys', async () => {
    await session.lock();
    await session.unlock(password, false);
    expect(await session.getStartupTimerEnabled()).toBe(false);
    await session.dispose();
    session = new VaultSession(storage, cipher, () => now);
    await session.initialize();
    expect(session.getSnapshot().status).toBe('locked');
    expect(await session.getStartupTimerEnabled()).toBe(false);
    await expect(session.captureOperation()).rejects.toMatchObject({ status: 423 });
    await session.unlock(password, false);
    expect(session.getSnapshot().sessionTimerEnabled).toBe(false);
  });

  it('does not apply an unauthenticated startup change', async () => {
    await session.lock();
    const before = (await storage.control())!;
    await expect(session.unlock('an incorrect workspace password', false)).rejects.toThrow();
    expect((await storage.control())!.policy).toEqual(before.policy);
    expect((await storage.control())!.revision).toBe(before.revision);
    expect(session.getSnapshot().status).toBe('locked');
  });

  it('immediately locks all leases when timed locking is reenabled after an elapsed limit', async () => {
    const operation = await sibling.captureOperation();
    await session.setPolicy({ ...defaultVaultSessionPolicy, sessionTimerEnabled: false });
    now += 16 * 60_000;
    await session.setPolicy(defaultVaultSessionPolicy);
    expect(session.getSnapshot().status).toBe('locked');
    expect(session.getSnapshot().sessionTimerEnabled).toBe(true);
    expect((await storage.control())!.locked).toBe(true);
    await expect(operation.check()).rejects.toMatchObject({ status: 423 });
    operation.dispose();
  });

  it('does not reset a live sibling clock when a new human unlock reenables an expired timer', async () => {
    const broadcast = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage = broadcast;
        close() {}
      },
    );
    await session.setPolicy({ ...defaultVaultSessionPolicy, sessionTimerEnabled: false });
    const before = (await storage.control())!;
    await sibling.dispose();
    sibling = new VaultSession(
      new VaultRecordStorage(name, indexedDB, () => now),
      cipher,
      () => now,
    );
    await sibling.initialize();
    now += 9 * 3_600_000;
    await expect(sibling.unlock(password, true)).rejects.toMatchObject({ status: 423 });
    expect(sibling.getSnapshot().sessionTimerEnabled).toBe(true);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'revoked',
      vaultId: created.header.vaultId,
      epoch: (await storage.control())!.epoch,
    });
    expect((await storage.control())!.startedAt).toBe(before.startedAt);
    expect((await storage.control())!.policy).toEqual(defaultVaultSessionPolicy);
    await expect(session.verify()).rejects.toMatchObject({ status: 423 });
    await sibling.unlock(password, true);
    expect(sibling.getSnapshot().sessionTimerEnabled).toBe(true);
    expect((await storage.control())!.startedAt).toBe(now);
  });

  it('still clears a static sibling through its scheduled durable check when broadcasts are unavailable', async () => {
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    await session.setPolicy({ ...defaultVaultSessionPolicy, sessionTimerEnabled: false });
    await sibling.verify();
    const checks = schedule.mock.calls.filter((call) => call[1] === 30_000);
    expect(checks.length).toBeGreaterThan(0);
    const check = checks.at(-1)![0];
    expect(typeof check).toBe('function');
    await session.lock();
    expect(sibling.getSnapshot().status).toBe('unlocked');
    (check as () => void)();
    await vi.waitFor(() => expect(sibling.getSnapshot().status).toBe('locked'));
  });
});
