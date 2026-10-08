import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultRecordCodec, normalizeVaultValue } from '../src/security/vault-record-codec';
import {
  VaultRecordStorage,
  defaultVaultSessionPolicy,
  validateVaultSessionPolicy,
  type VaultLease,
} from '../src/security/vault-storage';

const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
const codec = new VaultRecordCodec(cipher);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let storage: VaultRecordStorage, lease: VaultLease, now: number;
let name: string;

beforeAll(async () => {
  vault = await cipher.createVault('correct horse battery staple');
});
beforeEach(async () => {
  now = 100_000;
  name = `vault-storage-${crypto.randomUUID()}`;
  storage = new VaultRecordStorage(name, indexedDB, () => now);
  await storage.create(vault.header);
  lease = await storage.beginSession(vault.header);
});
afterEach(async () => {
  storage.close();
  await new Promise<void>((resolve, reject) => {
    const remove = indexedDB.deleteDatabase(name);
    remove.onsuccess = () => resolve();
    remove.onerror = () => reject(remove.error);
  });
});

async function record(id: string, revision = 1, value: unknown = { name: 'Private Assembly' }) {
  return codec.encode(vault.keys, 'nodes', id, value, revision, [
    { index: 'diagramId', value: 'private-project-id' },
  ]);
}

async function inspectRaw() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const result = await new Promise<unknown[]>((resolve, reject) => {
    const read = db.transaction('records').objectStore('records').getAll();
    read.onsuccess = () => resolve(read.result);
    read.onerror = () => reject(read.error);
  });
  db.close();
  return result;
}

describe('encrypted physical record storage', () => {
  it('guards authorized locking against a newer permission/content revision', async () => {
    const before = (await storage.control())!;
    const prepared = await codec.encode(vault.keys, 'settings', 'mcp-access', { value: 'off' }, 1);
    await storage.commit(lease, [{ kind: 'put', record: prepared, expectedRevision: 0 }]);
    const changed = await storage.control();
    await expect(storage.lock(lease, before.revision)).rejects.toMatchObject({
      status: 409,
      code: 'VAULT_CONFLICT',
    });
    expect(await storage.control()).toEqual(changed);
    expect((await storage.check(lease)).locked).toBe(false);
  });

  it('never applies an old authorized lock to a later session', async () => {
    const before = (await storage.control())!;
    await storage.lock(lease);
    const later = await storage.beginSession(vault.header);
    const current = await storage.check(later);
    await expect(storage.lock(lease, before.revision)).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    expect(await storage.control()).toEqual(current);
    expect((await storage.check(later)).locked).toBe(false);
  });

  it('applies a current guarded lock atomically and rejects malformed guards', async () => {
    const before = (await storage.control())!;
    await expect(storage.lock(undefined, before.revision)).rejects.toMatchObject({ status: 422 });
    await expect(storage.lock(lease, -1)).rejects.toMatchObject({ status: 422 });
    expect(await storage.control()).toEqual(before);
    const updated = await storage.lock(lease, before.revision);
    expect(updated).toMatchObject({
      locked: true,
      epoch: before.epoch + 1,
      revision: before.revision + 1,
    });
    await expect(storage.read(lease, [])).rejects.toMatchObject({ status: 423 });
  });

  it('stores ciphertext and keyed indexes without logical names, IDs, cells or fingerprints', async () => {
    const value = {
      name: 'Private Assembly',
      description: 'sensitive SQL literal',
      rows: [['Client Secret', '91000']],
    };
    const prepared = await record('sensitive-node-id', 1, value);
    await storage.commit(lease, [{ kind: 'put', record: prepared, expectedRevision: 0 }]);
    const raw = JSON.stringify(await inspectRaw());
    for (const canary of [
      'Private Assembly',
      'sensitive SQL literal',
      'Client Secret',
      '91000',
      'sensitive-node-id',
      'private-project-id',
    ])
      expect(raw).not.toContain(canary);
    const [stored] = await storage.read(lease, [prepared.id]);
    expect(await codec.decode(vault.keys, stored!, 'sensitive-node-id')).toEqual(value);
    const token = await codec.partition(vault.keys, 'nodes', {
      index: 'diagramId',
      value: 'private-project-id',
    });
    expect(await storage.select(lease, { partition: token })).toHaveLength(1);
    expect(await storage.select(lease, { store: 'owners' })).toEqual([]);
  });

  it('rejects stale writes atomically across the entire batch', async () => {
    const a = await record('a'),
      b = await record('b');
    await storage.commit(lease, [{ kind: 'put', record: a, expectedRevision: 0 }]);
    const second = await record('a', 2, { name: 'new value' });
    await expect(
      storage.commit(lease, [
        { kind: 'put', record: b, expectedRevision: 0 },
        { kind: 'put', record: second, expectedRevision: 0 },
      ]),
    ).rejects.toMatchObject({ status: 409, code: 'VAULT_CONFLICT' });
    expect(await storage.read(lease, [b.id])).toEqual([undefined]);
    const [stored] = await storage.read(lease, [a.id]);
    expect(await codec.decode(vault.keys, stored!)).toEqual({ name: 'Private Assembly' });
  });

  it('fences a transaction when a separately read setting changes before commit', async () => {
    const before = await storage.check(lease);
    const node = await record('node');
    const grant = await codec.encode(vault.keys, 'settings', 'mcp-access', { value: 'off' }, 1);
    await storage.commit(lease, [{ kind: 'put', record: grant, expectedRevision: 0 }]);
    await expect(
      storage.commit(lease, [{ kind: 'put', record: node, expectedRevision: 0 }], before.revision),
    ).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    expect(await storage.read(lease, [node.id])).toEqual([undefined]);
  });

  it('does not rewrite unrelated large sources during a geometry-only update', async () => {
    const source = await codec.encode(
      vault.keys,
      'datasets',
      'dataset-secret',
      { rows: Array.from({ length: 100_000 }, (_, i) => [`Private ${i}`]) },
      1,
    );
    const node = await record('node');
    await storage.commit(
      lease,
      [source, node].map((record) => ({ kind: 'put' as const, record, expectedRevision: 0 })),
    );
    const originalSource = (await storage.read(lease, [source.id]))[0];
    const moved = await record('node', 2, { name: 'Private Assembly', x: 200, y: 300 });
    await storage.commit(lease, [{ kind: 'put', record: moved, expectedRevision: 1 }]);
    expect((await storage.read(lease, [source.id]))[0]).toEqual(originalSource);
  });

  it('rejects a modified physical identity, record version or query partition', async () => {
    const prepared = await record('a');
    await expect(
      storage.commit(lease, [
        { kind: 'put', record: { ...prepared, revision: 2 }, expectedRevision: 0 },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_VAULT_STORAGE' });
    const token = await codec.partition(vault.keys, 'nodes', {
      index: 'diagramId',
      value: 'different-secret-project',
    });
    await expect(
      codec.decode(vault.keys, { ...prepared, partitions: [token] }),
    ).rejects.toMatchObject({ code: 'VAULT_INTEGRITY_FAILED' });
    await expect(codec.decode(vault.keys, prepared, 'another-logical-id')).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
  });

  it('preserves committed data but fences pre-encrypted writes after cross-tab locking', async () => {
    const saved = await record('saved'),
      pending = await record('pending');
    await storage.commit(lease, [{ kind: 'put', record: saved, expectedRevision: 0 }]);
    const other = new VaultRecordStorage(name, indexedDB, () => now);
    await other.lock(lease);
    await expect(
      storage.commit(lease, [{ kind: 'put', record: pending, expectedRevision: 0 }]),
    ).rejects.toMatchObject({ status: 423, code: 'WORKSPACE_LOCKED' });
    await expect(storage.read(lease, [saved.id])).rejects.toMatchObject({ status: 423 });
    const unlocked = await other.beginSession(vault.header);
    expect(await other.read(unlocked, [saved.id, pending.id])).toEqual([saved, undefined]);
    other.close();
  });

  it('rechecks deadlines on operations even when timers did not run during sleep', async () => {
    now += defaultVaultSessionPolicy.idleTimeoutMs;
    await expect(storage.check(lease)).rejects.toMatchObject({ status: 423 });
    await expect(storage.activity(lease)).rejects.toMatchObject({ status: 423 });
    await expect(storage.commit(lease, [])).rejects.toMatchObject({ status: 423 });
  });

  it('shares human activity across tabs without resetting the absolute deadline', async () => {
    const other = new VaultRecordStorage(name, indexedDB, () => now);
    now += 10 * 60_000;
    const secondLease = await other.beginSession(vault.header);
    expect(secondLease.epoch).toBe(lease.epoch);
    await other.activity(secondLease);
    now += 10 * 60_000;
    expect((await storage.check(lease)).startedAt).toBe(100_000);
    const absoluteEnd = 100_000 + defaultVaultSessionPolicy.absoluteTimeoutMs;
    while (now + 10 * 60_000 < absoluteEnd) {
      await other.activity(secondLease);
      now += 10 * 60_000;
    }
    await other.activity(secondLease);
    now = absoluteEnd;
    await expect(storage.check(lease)).rejects.toMatchObject({ status: 423 });
    other.close();
  });

  it('prevents a delayed lock callback from revoking a newer authenticated session', async () => {
    await storage.lock(lease);
    const fresh = await storage.beginSession(vault.header);
    await storage.lock(lease);
    expect((await storage.check(fresh)).locked).toBe(false);
  });

  it('authenticates the latest header and revokes other leases after a password change', async () => {
    const control = await storage.check(lease);
    const replacement = await cipher.changePassword(
      vault.header,
      vault.keys,
      'new correct horse battery staple',
    );
    await storage.replaceHeader(lease, replacement, control.revision);
    await expect(storage.beginSession(vault.header)).rejects.toMatchObject({
      code: 'VAULT_CONFLICT',
    });
    await expect(storage.check(lease)).rejects.toMatchObject({ status: 423 });
    await expect(
      cipher.unlockWithPassword(replacement, 'correct horse battery staple'),
    ).rejects.toBeDefined();
    const keys = await cipher.unlockWithPassword(replacement, 'new correct horse battery staple');
    expect(keys.vaultId).toBe(vault.keys.vaultId);
    cipher.destroyKeys(keys);
  });

  it('rejects invalid configuration and leaves the existing control record unchanged', async () => {
    const before = await storage.control();
    for (const policy of [
      { idleTimeoutMs: -1, absoluteTimeoutMs: 1000 },
      { idleTimeoutMs: 60_000, absoluteTimeoutMs: 30_000 },
      { idleTimeoutMs: 60_000, absoluteTimeoutMs: 25 * 60 * 60_000 },
    ])
      expect(() => validateVaultSessionPolicy(policy)).toThrow();
    await expect(storage.create(vault.header)).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    expect(await storage.control()).toEqual(before);
  });

  it('normalizes optional object fields safely but rejects unsupported data', () => {
    expect(normalizeVaultValue({ optional: undefined, value: 10 })).toEqual({ value: 10 });
    for (const unsupported of [undefined, NaN, [undefined], () => 'secret', new Date()])
      expect(() => normalizeVaultValue(unsupported)).toThrow();
    const original = JSON.parse('{"__proto__":{"sensitive":"content"}}');
    const normalized = normalizeVaultValue(original) as Record<string, unknown>;
    expect(Object.prototype).not.toHaveProperty('sensitive');
    expect(Object.prototype.hasOwnProperty.call(normalized, '__proto__')).toBe(true);
  });
});
