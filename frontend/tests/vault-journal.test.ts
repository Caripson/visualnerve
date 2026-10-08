import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultJournal, type VaultJournalScope } from '../src/security/vault-journal';
import { VaultRecordCodec } from '../src/security/vault-record-codec';
import { VaultSession } from '../src/security/vault-session';
import { VaultRecordStorage } from '../src/security/vault-storage';
import type { VaultStore } from '../src/security/vault-schema';

const password = 'test-only journal password phrase';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
const codec = new VaultRecordCodec(cipher);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let storage: VaultRecordStorage, session: VaultSession, journal: VaultJournal, name: string;

beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  name = `vault-journal-${crypto.randomUUID()}`;
  storage = new VaultRecordStorage(name);
  await storage.create(created.header);
  session = new VaultSession(storage, cipher);
  await session.initialize();
  await session.unlock(password);
  journal = new VaultJournal(session);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterAll(() => cipher.destroyKeys(created.keys));

async function put(scope: VaultJournalScope, store: VaultStore, id: string, value: unknown) {
  const physicalId = await codec.id(scope.context.keys, store, id);
  const revision = await scope.nextRevision(store, physicalId);
  const record = await codec.encode(scope.context.keys, store, id, value, revision, [
    { index: 'diagramId', value: 'private-project' },
  ]);
  await scope.put(record);
  return record;
}
async function rawCount() {
  return session.withUnlocked(
    async ({ lease }) => (await storage.select(lease, { store: 'nodes' })).length,
  );
}

describe('revocable encrypted workspace transactions', () => {
  it('serializes disjoint prepared writes without retrying either callback', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const callbacks: string[] = [];
    const first = journal.atomic('rw', ['nodes'], async (scope) => {
      callbacks.push('node');
      await put(scope, 'nodes', 'n', { title: 'saved once' });
      entered();
      await waiting;
    });
    await started;
    const anotherJournal = new VaultJournal(session);
    const next = anotherJournal.atomic('rw', ['settings'], async (scope) => {
      callbacks.push('setting');
      await put(scope, 'settings', 'last-diagram', { value: 'n' });
    });
    release();
    await Promise.all([first, next]);
    expect(callbacks).toEqual(['node', 'setting']);
    expect(await rawCount()).toBe(1);
    await journal.atomic('r', ['settings'], async (scope) => {
      expect(await scope.select({ store: 'settings' })).toHaveLength(1);
    });
  });

  it('keeps an official reader on one snapshot while another journal waits', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const read = journal.atomic('r', ['nodes'], async (scope) => {
      expect(await scope.select({ store: 'nodes' })).toEqual([]);
      entered();
      await waiting;
      expect(await scope.select({ store: 'nodes' })).toEqual([]);
      return 'consistent';
    });
    await started;
    const write = journal.atomic('rw', ['nodes'], (scope) => put(scope, 'nodes', 'later', {}));
    release();
    expect(await read).toBe('consistent');
    await write;
    expect(await rawCount()).toBe(1);
  });

  it('revokes queued work before it can enter, even after a later unlock', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = journal.atomic('r', ['nodes'], async () => {
      entered();
      await waiting;
    });
    const firstRejected = expect(first).rejects.toMatchObject({ status: 423 });
    await started;
    const capability = await session.captureOperation();
    const work = vi.fn(async (scope: VaultJournalScope) => put(scope, 'nodes', 'stale', {}));
    const queued = journal.atomic('rw', ['nodes'], work, capability);
    const queuedRejected = expect(queued).rejects.toMatchObject({ status: 423 });
    await session.lock();
    await queuedRejected;
    await session.unlock(password);
    release();
    await firstRejected;
    capability.dispose();
    expect(work).not.toHaveBeenCalled();
    expect(await rawCount()).toBe(0);
  });

  it('rolls back every staged store when validation rejects, without publishing caches', async () => {
    const published = vi.fn();
    await expect(
      journal.atomic('rw', ['nodes', 'settings'], async (scope) => {
        await put(scope, 'nodes', 'node-private', { title: 'Secret customer' });
        await put(scope, 'settings', 'mcp-access', { value: 'write' });
        scope.afterCommit(published);
        throw new Error('A later domain check rejected this operation.');
      }),
    ).rejects.toThrow('later domain check');
    expect(await rawCount()).toBe(0);
    expect(published).not.toHaveBeenCalled();
    await session.withUnlocked(async ({ lease }) => {
      expect(await storage.select(lease, { store: 'settings' })).toEqual([]);
    });
  });

  it('reads staged changes and coalesces updates into one durable revision', async () => {
    const first = await journal.atomic('rw', ['nodes'], (scope) =>
      put(scope, 'nodes', 'n', { title: 'first' }),
    );
    const before = (await storage.control())!.revision;
    const published = vi.fn();
    await journal.atomic('rw', ['nodes'], async (scope) => {
      const second = await put(scope, 'nodes', 'n', { title: 'second' });
      expect(second.revision).toBe(2);
      expect(await codec.decode(scope.context.keys, (await scope.get('nodes', first.id))!)).toEqual(
        {
          title: 'second',
        },
      );
      const partition = await codec.partition(scope.context.keys, 'nodes', {
        index: 'diagramId',
        value: 'private-project',
      });
      expect(await scope.select({ store: 'nodes', partition })).toHaveLength(1);
      const third = await put(scope, 'nodes', 'n', { title: 'third' });
      expect(third.revision).toBe(2);
      scope.afterCommit(published);
    });
    expect((await storage.control())!.revision).toBe(before + 1);
    expect(published).toHaveBeenCalledOnce();
    await journal.atomic('r', ['nodes'], async (scope) => {
      const current = (await scope.get('nodes', first.id))!;
      expect(current.revision).toBe(2);
      expect(await codec.decode(scope.context.keys, current)).toEqual({ title: 'third' });
    });
  });

  it('cancels a newly staged put followed by delete without leaving a record', async () => {
    const before = (await storage.control())!.revision;
    await journal.atomic('rw', ['nodes'], async (scope) => {
      const record = await put(scope, 'nodes', 'transient', { title: 'transient' });
      await scope.delete('nodes', record.id);
      expect(await scope.get('nodes', record.id)).toBeUndefined();
      expect(await scope.select({ store: 'nodes' })).toEqual([]);
    });
    expect(await rawCount()).toBe(0);
    expect((await storage.control())!.revision).toBe(before);
  });

  it('rejects mixed-version read results when another writer changes any store', async () => {
    await expect(
      journal.atomic('r', ['nodes'], async (scope) => {
        await scope.select({ store: 'nodes' });
        const other = await codec.encode(
          scope.context.keys,
          'settings',
          'mcp-access',
          { value: 'off' },
          1,
        );
        await storage.commit(scope.context.lease, [
          { kind: 'put', record: other, expectedRevision: 0 },
        ]);
        return { obsoleteRead: true };
      }),
    ).rejects.toMatchObject({ status: 409, code: 'VAULT_CONFLICT' });
  });

  it('does not publish or persist a staged node when a concurrent permission write wins', async () => {
    const published = vi.fn();
    await expect(
      journal.atomic('rw', ['nodes'], async (scope) => {
        await put(scope, 'nodes', 'private-node', { title: 'must not commit' });
        scope.afterCommit(published);
        const grant = await codec.encode(scope.context.keys, 'settings', 'mcp-access', 'off', 1);
        await storage.commit(scope.context.lease, [
          { kind: 'put', record: grant, expectedRevision: 0 },
        ]);
      }),
    ).rejects.toMatchObject({ status: 409, code: 'VAULT_CONFLICT' });
    expect(await rawCount()).toBe(0);
    expect(published).not.toHaveBeenCalled();
  });

  it('shares nested writes while enforcing read-only and store boundaries', async () => {
    await journal.atomic('rw', ['nodes', 'settings'], async (scope) => {
      await scope.atomic('rw', ['nodes'], async (child) => {
        await put(child, 'nodes', 'nested', { title: 'nested' });
        await expect(child.select({ store: 'settings' })).rejects.toMatchObject({
          code: 'INVALID_VAULT_TRANSACTION',
        });
      });
      await scope.atomic('r', ['nodes'], async (child) => {
        expect(await child.select({ store: 'nodes' })).toHaveLength(1);
        await expect(put(child, 'nodes', 'other', {})).rejects.toMatchObject({
          code: 'INVALID_VAULT_TRANSACTION',
        });
        await expect(child.atomic('rw', ['nodes'], async () => undefined)).rejects.toMatchObject({
          code: 'INVALID_VAULT_TRANSACTION',
        });
      });
      await expect(scope.atomic('r', ['owners'], async () => undefined)).rejects.toMatchObject({
        code: 'INVALID_VAULT_TRANSACTION',
      });
    });
    expect(await rawCount()).toBe(1);
  });

  it('locks every in-flight staged operation before a durable commit or callback', async () => {
    const published = vi.fn();
    await expect(
      journal.atomic('rw', ['nodes'], async (scope) => {
        await put(scope, 'nodes', 'before-lock', { title: 'private' });
        scope.afterCommit(published);
        await session.lock();
        expect(scope.context.signal.aborted).toBe(true);
      }),
    ).rejects.toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    expect(published).not.toHaveBeenCalled();
    await session.unlock(password);
    expect(await rawCount()).toBe(0);
  });

  it('aborts the outer journal even when the parent catches a rejected nested write', async () => {
    const published = vi.fn();
    await expect(
      journal.atomic('rw', ['nodes'], async (scope) => {
        await scope
          .atomic('rw', ['nodes'], async (child) => {
            await put(child, 'nodes', 'failed-child', { title: 'must not persist' });
            child.afterCommit(published);
            throw new Error('Nested domain validation failed.');
          })
          .catch(() => undefined);
      }),
    ).rejects.toMatchObject({ code: 'INVALID_VAULT_TRANSACTION' });
    expect(await rawCount()).toBe(0);
    expect(published).not.toHaveBeenCalled();
  });

  it('returns a structured locked error instead of using a new session for old work', async () => {
    let continueWork!: () => void;
    const waiting = new Promise<void>((resolve) => {
      continueWork = resolve;
    });
    let staged!: () => void;
    const started = new Promise<void>((resolve) => {
      staged = resolve;
    });
    const operation = journal.atomic('rw', ['nodes'], async (scope) => {
      await put(scope, 'nodes', 'old-session', { title: 'discarded old work' });
      staged();
      await waiting;
    });
    const rejected = expect(operation).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await started;
    await session.lock();
    await session.unlock(password);
    continueWork();
    await rejected;
    expect(session.getSnapshot().status).toBe('unlocked');
    expect(await rawCount()).toBe(0);
  });

  it('does not allow a retained scope to read after its callback completed', async () => {
    let retained!: VaultJournalScope;
    await journal.atomic('r', ['nodes'], async (scope) => {
      retained = scope;
    });
    await expect(retained.select({ store: 'nodes' })).rejects.toMatchObject({
      code: 'INVALID_VAULT_TRANSACTION',
    });
  });

  it('does not commit or publish while an unawaited nested callback is still running', async () => {
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const published = vi.fn();
    let childWork!: Promise<unknown>;
    await expect(
      journal.atomic('rw', ['nodes'], async (scope) => {
        childWork = scope.atomic('rw', ['nodes'], async (child) => {
          child.afterCommit(published);
          await waiting;
        });
        void childWork.catch(() => undefined);
      }),
    ).rejects.toMatchObject({ code: 'INVALID_VAULT_TRANSACTION' });
    expect(published).not.toHaveBeenCalled();
    resume();
    await expect(childWork).rejects.toMatchObject({ code: 'INVALID_VAULT_TRANSACTION' });
    expect(await rawCount()).toBe(0);
  });

  it('expires a child scope even while its parent transaction remains active', async () => {
    await journal.atomic('r', ['nodes'], async (scope) => {
      let retained!: VaultJournalScope;
      await scope.atomic('r', ['nodes'], async (child) => {
        retained = child;
      });
      await expect(retained.select({ store: 'nodes' })).rejects.toMatchObject({
        code: 'INVALID_VAULT_TRANSACTION',
      });
      expect(await scope.select({ store: 'nodes' })).toEqual([]);
    });
  });

  it('owns snapshots of staged ciphertext and read metadata', async () => {
    const record = await journal.atomic('rw', ['nodes'], async (scope) => {
      const prepared = await put(scope, 'nodes', 'immutable-metadata', { title: 'safe' });
      prepared.revision = 123;
      prepared.partitions.length = 0;
      return prepared;
    });
    await journal.atomic('r', ['nodes'], async (scope) => {
      const read = (await scope.get('nodes', record.id))!;
      read.revision = 999;
      Object.assign(read.encrypted, { ciphertext: 'tampered' });
      const original = (await scope.get('nodes', record.id))!;
      expect(original.revision).toBe(1);
      expect(await codec.decode(scope.context.keys, original)).toEqual({ title: 'safe' });
    });
  });
});
