import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordCodec } from '../src/security/vault-record-codec';
import { VaultRecordStorage } from '../src/security/vault-storage';

const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let storage: VaultRecordStorage, session: VaultSession, name: string, now: number;
const sessions: VaultSession[] = [];
beforeAll(async () => {
  vault = await cipher.createVault('correct horse battery staple');
});
beforeEach(async () => {
  now = 100_000;
  name = `vault-session-${crypto.randomUUID()}`;
  storage = new VaultRecordStorage(name, indexedDB, () => now);
  await storage.create(vault.header);
  session = new VaultSession(storage, cipher, () => now);
  sessions.push(session);
  await session.initialize();
});
afterEach(async () => {
  for (const value of sessions.splice(0)) await value.dispose();
  await new Promise<void>((resolve, reject) => {
    const remove = indexedDB.deleteDatabase(name);
    remove.onsuccess = () => resolve();
    remove.onerror = () => reject(remove.error);
  });
  vi.restoreAllMocks();
});

describe('browser-only vault session boundary', () => {
  it('keeps local keys usable when a guarded integration lock loses to a grant change', async () => {
    await session.unlock('correct horse battery staple');
    const operation = await session.captureOperation();
    const before = await session.verify();
    const record = await new VaultRecordCodec(cipher).encode(
      vault.keys,
      'settings',
      'mcp-access',
      { value: 'off' },
      1,
    );
    await storage.commit(
      { vaultId: before.header.vaultId, keyVersion: before.header.keyVersion, epoch: before.epoch },
      [{ kind: 'put', record, expectedRevision: 0 }],
    );
    await expect(session.lockAuthorized(before.revision, operation.signal)).rejects.toMatchObject({
      status: 409,
    });
    expect(session.getSnapshot().status).toBe('unlocked');
    expect(operation.signal.aborted).toBe(false);
    await operation.check();
    expect(await session.withUnlocked(async () => 'still unlocked')).toBe('still unlocked');
    operation.dispose();
  });

  it('revokes captured local work after a current guarded integration lock commits', async () => {
    await session.unlock('correct horse battery staple');
    const operation = await session.captureOperation();
    const control = await session.verify();
    await session.lockAuthorized(control.revision, operation.signal);
    expect(session.getSnapshot().status).toBe('locked');
    expect(operation.signal.aborted).toBe(true);
    await expect(operation.check()).rejects.toMatchObject({ status: 423 });
    expect((await storage.control())?.locked).toBe(true);
    operation.dispose();
  });

  it('starts locked after initialization and exposes only non-sensitive status', async () => {
    expect(session.getSnapshot()).toMatchObject({
      status: 'locked',
      vaultId: vault.header.vaultId,
    });
    expect(JSON.stringify(session.getSnapshot())).not.toContain('correct horse');
    await expect(session.withUnlocked(async () => 'private')).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await session.unlock('correct horse battery staple');
    expect(session.getSnapshot().status).toBe('unlocked');
    expect(await session.withUnlocked(async () => 'permitted private result')).toBe(
      'permitted private result',
    );
  });

  it('rejects a wrong password without changing the existing vault', async () => {
    const before = await storage.control();
    await expect(session.unlock('wrong password but long enough')).rejects.toBeDefined();
    expect(session.getSnapshot().status).toBe('locked');
    expect(await storage.control()).toEqual(before);
  });

  it('fences a private result and aborts its context when the user locks during work', async () => {
    await session.unlock('correct horse battery staple');
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let signal: AbortSignal;
    const result = session.withUnlocked(async (context) => {
      signal = context.signal;
      entered();
      await waiting;
      return 'secret received after locking';
    });
    await started;
    await session.lock();
    expect(signal!.aborted).toBe(true);
    release();
    await expect(result).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
  });

  it('maps a cancelled private operation to the shared structured locked response', async () => {
    await session.unlock('correct horse battery staple');
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const operation = session.withUnlocked(async ({ signal }) => {
      entered();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    const rejected = expect(operation).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await started;
    await session.lock();
    await rejected;
  });

  it('revokes capabilities before synchronous abort handlers can verify another operation', async () => {
    await session.unlock('correct horse battery staple');
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let checkedDuringAbort: Promise<string> | undefined;
    const operation = session.withUnlocked(async ({ signal }) => {
      entered();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            checkedDuringAbort = session.verify().then(
              () => 'unexpectedly unlocked',
              (error: { code: string }) => error.code,
            );
            reject(new DOMException('Cancelled', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const rejected = expect(operation).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await started;
    await session.lock();
    await rejected;
    expect(await checkedDuringAbort).toBe('WORKSPACE_LOCKED');
    expect(session.getSnapshot().status).toBe('locked');
  });

  it('clears all registered runtime owners even when one cleanup fails', async () => {
    await session.unlock('correct horse battery staple');
    const first = vi.fn(() => {
      throw new Error('worker cleanup failed');
    });
    const second = vi.fn(async () => undefined);
    session.onLock(first);
    session.onLock(second);
    await session.lock();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(session.getSnapshot().status).toBe('locked');
  });

  it('cannot be kept alive by repeated private operations', async () => {
    await session.unlock('correct horse battery staple');
    const deadline = session.getSnapshot().idleExpiresAt!;
    for (let i = 0; i < 10; i++) {
      now += 60_000;
      await session.withUnlocked(async () => 1);
      expect(session.getSnapshot().idleExpiresAt).toBe(deadline);
    }
    now = deadline;
    await expect(session.withUnlocked(async () => 'private')).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    expect((await storage.control())?.locked).toBe(true);
  });

  it('detects missed cross-tab revocation before private work begins', async () => {
    await session.unlock('correct horse battery staple');
    const other = new VaultRecordStorage(name, indexedDB, () => now);
    await other.lock();
    const operation = vi.fn(async () => 'must not execute');
    await expect(session.withUnlocked(operation)).rejects.toMatchObject({
      code: 'WORKSPACE_LOCKED',
    });
    expect(operation).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe('locked');
    other.close();
  });

  it('requires separate unlocking in a second tab while sharing activity deadlines', async () => {
    await session.unlock('correct horse battery staple');
    const tab = new VaultSession(
      new VaultRecordStorage(name, indexedDB, () => now),
      cipher,
      () => now,
    );
    sessions.push(tab);
    await tab.initialize();
    expect(tab.getSnapshot().status).toBe('locked');
    await expect(tab.withUnlocked(async () => 'private')).rejects.toMatchObject({ status: 423 });
    await tab.unlock('correct horse battery staple');
    now += 10 * 60_000;
    await tab.recordHumanActivity();
    now += 10 * 60_000;
    await session.verify();
    expect(session.getSnapshot().idleExpiresAt).toBe(tab.getSnapshot().idleExpiresAt);
    expect(session.getSnapshot().absoluteExpiresAt).toBe(tab.getSnapshot().absoluteExpiresAt);
  });

  it('does not publish a late successful password derivation after cancellation', async () => {
    const original = cipher.unlockWithPassword.bind(cipher);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(cipher, 'unlockWithPassword').mockImplementation(async (...args) => {
      const keys = await original(...args);
      entered();
      await wait;
      return keys;
    });
    const unlock = session.unlock('correct horse battery staple');
    await started;
    await session.lock();
    release();
    await expect(unlock).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(session.getSnapshot().status).toBe('locked');
    expect((await storage.control())?.locked).toBe(true);
  });

  it('does not report password change success when the session is already locked', async () => {
    const before = await storage.control();
    await expect(session.changePassword('replacement password')).rejects.toMatchObject({
      status: 423,
    });
    expect(await storage.control()).toEqual(before);
  });

  it('rewraps the canonical password and invalidates the current session', async () => {
    await session.unlock('correct horse battery staple');
    await session.changePassword('replacement password for this workspace');
    expect(session.getSnapshot().status).toBe('locked');
    await expect(session.unlock('correct horse battery staple')).rejects.toBeDefined();
    await session.unlock('replacement password for this workspace');
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('recovers locally with a new password and a rotated recovery envelope', async () => {
    const recovered = await session.recover(vault.recoveryKey, 'recovered workspace password');
    expect(recovered.recoveryKey).not.toBe(vault.recoveryKey);
    const control = (await storage.control())!;
    await expect(
      cipher.unlockWithRecovery(control.header, vault.recoveryKey),
    ).rejects.toBeDefined();
    await expect(session.unlock('correct horse battery staple')).rejects.toBeDefined();
    await session.unlock('recovered workspace password');
    expect(session.getSnapshot().status).toBe('unlocked');
  });

  it('does not publish a newly rotated recovery secret after a late lock', async () => {
    const original = storage.replaceHeader.bind(storage);
    let release!: () => void, committed!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      committed = resolve;
    });
    vi.spyOn(storage, 'replaceHeader').mockImplementation(async (...args) => {
      const result = await original(...args);
      committed();
      await waiting;
      return result;
    });
    const recovery = session.recover(vault.recoveryKey, 'recovered workspace password');
    await started;
    await session.lock();
    release();
    await expect(recovery).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(session.getSnapshot().status).toBe('locked');
  });

  it('does not let a late password-change continuation revoke a newer unlock', async () => {
    await session.unlock('correct horse battery staple');
    const original = storage.replaceHeader.bind(storage);
    let release!: () => void, committed!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      committed = resolve;
    });
    vi.spyOn(storage, 'replaceHeader').mockImplementation(async (...args) => {
      const result = await original(...args);
      committed();
      await waiting;
      return result;
    });
    const change = session.changePassword('updated password for this workspace');
    await started;
    await session.lock();
    await session.unlock('updated password for this workspace');
    const newEpoch = session.getSnapshot().epoch;
    release();
    await expect(change).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(session.getSnapshot()).toMatchObject({ status: 'unlocked', epoch: newEpoch });
    expect(await session.withUnlocked(async () => 'new session remains valid')).toBe(
      'new session remains valid',
    );
  });

  it('waits for runtime cleanup before allowing another local unlock', async () => {
    await session.unlock('correct horse battery staple');
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const remove = session.onLock(async () => {
      entered();
      await waiting;
    });
    const lock = session.lock();
    await started;
    const unlock = session.unlock('correct horse battery staple');
    await Promise.resolve();
    expect(session.getSnapshot().status).toBe('locked');
    release();
    await lock;
    remove();
    await unlock;
    expect(session.getSnapshot().status).toBe('unlocked');
  });
});

describe('browser session settings', () => {
  it('updates deadlines without renewing inactivity or absolute clocks', async () => {
    await session.unlock('correct horse battery staple');
    const before = (await storage.control())!;
    now += 5 * 60_000;
    await session.setPolicy({ idleTimeoutMs: 30 * 60_000, absoluteTimeoutMs: 2 * 3_600_000 });
    const after = (await storage.control())!;
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(session.getSnapshot()).toMatchObject({
      status: 'unlocked',
      idleExpiresAt: before.lastActivityAt + 30 * 60_000,
      absoluteExpiresAt: before.startedAt + 2 * 3_600_000,
    });
  });
  it('shorter elapsed limits revoke captured jobs and all joined tabs', async () => {
    await session.unlock('correct horse battery staple');
    const second = new VaultSession(
      new VaultRecordStorage(name, indexedDB, () => now),
      cipher,
      () => now,
    );
    sessions.push(second);
    await second.initialize();
    await second.unlock('correct horse battery staple');
    const job = await session.captureOperation();
    const otherJob = await second.captureOperation();
    now += 5 * 60_000;
    await session.setPolicy({ idleTimeoutMs: 60_000, absoluteTimeoutMs: 3_600_000 });
    expect(session.getSnapshot().status).toBe('locked');
    expect(job.signal.aborted).toBe(true);
    await expect(otherJob.check()).rejects.toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    expect(second.getSnapshot().status).toBe('locked');
    await session.unlock('correct horse battery staple');
    await expect(job.run(async () => 'private')).rejects.toMatchObject({ status: 423 });
    job.dispose();
    otherJob.dispose();
  });
  it('rejects invalid settings without changing durable policy or renewing activity', async () => {
    await session.unlock('correct horse battery staple');
    const before = await storage.control();
    await expect(
      session.setPolicy({ idleTimeoutMs: -1, absoluteTimeoutMs: 3_600_000 }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await storage.control()).toEqual(before);
    expect(session.getSnapshot().status).toBe('unlocked');
  });
  it('disposes a parent capability before its child can finish a deferred result', async () => {
    await session.unlock('correct horse battery staple');
    const parent = await session.captureOperation();
    const child = await session.captureOperation(parent.signal);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = child.run(async () => {
      await waiting;
      return 'private result';
    });
    // Observe rejection before completing the deferred work.
    const assertion = expect(result).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    parent.dispose();
    release();
    await assertion;
    expect(child.signal.aborted).toBe(true);
    child.dispose();
  });
});

describe('password change form reauthentication', () => {
  it('does not rewrap the vault when the supplied current password is incorrect', async () => {
    await session.unlock('correct horse battery staple');
    const before = await storage.control();
    await expect(
      session.changePassword('replacement password phrase', 'incorrect old password phrase'),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(await storage.control()).toEqual(before);
    expect(session.getSnapshot().status).toBe('unlocked');
    await session.changePassword('replacement password phrase', 'correct horse battery staple');
    expect(session.getSnapshot().status).toBe('locked');
    await session.unlock('replacement password phrase');
    expect(session.getSnapshot().status).toBe('unlocked');
  });
});
