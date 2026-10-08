import { webcrypto } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { logicalJsonChunks, parseLogicalJson } from '../src/security/vault-logical-json';
import {
  VaultLogicalRecordCodec,
  logicalJsonLimits,
  type VaultLogicalBundle,
} from '../src/security/vault-logical-record';
import type { VaultPhysicalRecord } from '../src/security/vault-storage';

const nativeCrypto = webcrypto as unknown as Crypto;
const cipher = new VaultCrypto(nativeCrypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let codec: VaultLogicalRecordCodec;
beforeAll(async () => {
  vault = await cipher.createVault('correct horse battery staple');
});
beforeEach(() => {
  codec = new VaultLogicalRecordCodec(cipher, nativeCrypto);
});

const content = {
  id: 'private-source',
  name: 'Secret customer list',
  rows: [['Secret customer', '1,250']],
};
const large = () => ({ id: 'source', name: 'Customers', rows: [['A'.repeat(180_000)]] });
async function encode(value: unknown = content, options = {}) {
  return codec.encode(
    vault.keys,
    'datasets',
    'private-source',
    value,
    1,
    [{ index: 'ownerId', value: 'private-diagram' }],
    options,
  );
}
function physical(bundle: VaultLogicalBundle, previous: VaultPhysicalRecord[] = []) {
  const records = new Map([...previous, ...bundle.records].map((record) => [record.id, record]));
  for (const id of bundle.obsoleteIds) records.delete(id);
  return {
    records,
    read: vi.fn(async (ids: readonly string[]) => ids.map((id) => records.get(id))),
  };
}
async function manifestRoot(
  bundle: VaultLogicalBundle,
  modify: (manifest: any, wrapper: any) => void,
) {
  const root = bundle.root;
  const context = { store: root.store, recordId: root.id, recordVersion: root.revision };
  const wrapper = await cipher.decryptRecord<any>(vault.keys, context, root.encrypted);
  modify(wrapper.value, wrapper);
  return { ...root, encrypted: await cipher.encryptRecord(vault.keys, context, wrapper) };
}

describe('encrypted logical records', () => {
  it('keeps small data and its metadata encrypted with a root-only query partition', async () => {
    const bundle = await encode(content, { projection: { id: content.id, name: content.name } });
    expect(bundle.records).toHaveLength(1);
    expect(Object.isFrozen(bundle.root)).toBe(true);
    expect(Object.isFrozen(bundle.root.partitions)).toBe(true);
    expect(Object.isFrozen(bundle.records)).toBe(true);
    const store = physical(bundle);
    expect(await codec.decode(vault.keys, bundle.root, store.read, 'private-source')).toEqual(
      content,
    );
    expect(store.read).not.toHaveBeenCalled();
    expect(bundle.root.partitions).toContain(await codec.rootPartition(vault.keys, 'datasets'));
    expect(bundle.root.partitions).toContain(
      await codec.partition(vault.keys, 'datasets', { index: 'ownerId', value: 'private-diagram' }),
    );
    expect(await codec.rootPartition(vault.keys, 'datasets')).not.toBe(
      await codec.partition(vault.keys, 'datasets', { index: 'logical-root', value: 'root' }),
    );
    const raw = JSON.stringify(bundle.records);
    for (const canary of ['private-source', 'private-diagram', 'Secret customer', '1,250'])
      expect(raw).not.toContain(canary);
  });

  it('projects history metadata without fetching/decrypting its row payload', async () => {
    const value = { id: 'history-row', diagramId: 'd', bytes: 180_000, rows: large().rows };
    const bundle = await codec.encode(vault.keys, 'historyRows', value.id, value, 1, [], {
      payloadFields: ['rows'],
      projection: { id: value.id, diagramId: value.diagramId, bytes: value.bytes },
    });
    const projected = await codec.project(vault.keys, bundle.root, value.id);
    expect(projected.projection).toEqual({ id: 'history-row', diagramId: 'd', bytes: 180_000 });
    expect(projected.chunkIds.length).toBeGreaterThan(0);
    expect(bundle.records.slice(1).every((record) => record.partitions.length === 0)).toBe(true);
    const read = physical(bundle).read;
    expect(await codec.decode(vault.keys, bundle.root, read, value.id)).toEqual(value);
  });

  it('roundtrips UTF-8 split between chunks and batching boundaries', async () => {
    const value = { text: 'a'.repeat(32_763) + '🧠漢'.repeat(35_000) };
    const bundle = await encode(value, { chunkBytes: logicalJsonLimits.minimumChunkBytes });
    expect(bundle.records.length).toBeGreaterThan(2);
    expect(await codec.decode(vault.keys, bundle.root, physical(bundle).read)).toEqual(value);
  });

  it('accepts exactly one minimum-size chunk without mixing inline and chunked data', async () => {
    const value = 'x'.repeat(logicalJsonLimits.minimumChunkBytes - 2);
    const bundle = await encode(value, { chunkBytes: logicalJsonLimits.minimumChunkBytes });
    expect(bundle.records).toHaveLength(2);
    expect(await codec.decode(vault.keys, bundle.root, physical(bundle).read)).toBe(value);
  });

  it('preserves canonical optional object fields and __proto__ as data', async () => {
    const value = Object.fromEntries([
      ['__proto__', { retained: true }],
      ['optional', undefined],
      ['rows', [['1']]],
    ]);
    const bundle = await encode(value, { payloadFields: ['rows'] });
    const decoded = await codec.decode<Record<string, unknown>>(
      vault.keys,
      bundle.root,
      physical(bundle).read,
    );
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
    expect(decoded.__proto__).toEqual({ retained: true });
    expect(Object.hasOwn(decoded, 'optional')).toBe(false);
  });

  it('reuses unchanged chunks on metadata updates without trusting mutable array identity', async () => {
    const value = large();
    const first = await encode(value, { payloadFields: ['rows'] });
    const previous = await codec.project(vault.keys, first.root);
    const renamed = await codec.encode(
      vault.keys,
      'datasets',
      'private-source',
      { ...value, name: 'Renamed' },
      2,
      [],
      { payloadFields: ['rows'], previous: previous.snapshot, projection: { name: 'Renamed' } },
    );
    expect(renamed.records).toHaveLength(1);
    expect(renamed.obsoleteIds).toEqual([]);
    expect(renamed.snapshot.chunkIds).toEqual(first.snapshot.chunkIds);
    expect(
      await codec.decode(vault.keys, renamed.root, physical(renamed, [...first.records]).read),
    ).toEqual({ ...value, name: 'Renamed' });
    value.rows[0][0] = 'B'.repeat(180_000);
    const changed = await codec.encode(vault.keys, 'datasets', 'private-source', value, 3, [], {
      payloadFields: ['rows'],
      previous: renamed.snapshot,
    });
    expect(changed.records.length).toBeGreaterThan(1);
    expect(changed.obsoleteIds).toEqual(renamed.snapshot.chunkIds);
    expect(
      await codec.decode(
        vault.keys,
        changed.root,
        physical(changed, [...first.records, ...renamed.records]).read,
      ),
    ).toEqual(value);
  });

  it('reuses unchanged adjacent chunks while replacing only edited content', async () => {
    const value = 'A'.repeat(210_000);
    const first = await encode(value, { chunkBytes: 65_536 });
    const next = await codec.encode(
      vault.keys,
      'datasets',
      'private-source',
      'B' + value.slice(1),
      2,
      [],
      { chunkBytes: 65_536, previous: first.snapshot },
    );
    expect(next.records).toHaveLength(2); // root + changed first chunk
    expect(next.obsoleteIds).toEqual([first.snapshot.chunkIds[0]]);
    expect(next.snapshot.chunkIds.slice(1)).toEqual(first.snapshot.chunkIds.slice(1));
    expect(await codec.decode(vault.keys, next.root, physical(next, [...first.records]).read)).toBe(
      'B' + value.slice(1),
    );
  });

  it('returns all previous chunks for deletion when a record shrinks to inline', async () => {
    const first = await encode(large());
    const next = await codec.encode(
      vault.keys,
      'datasets',
      'private-source',
      { name: 'Small' },
      2,
      [],
      { previous: first.snapshot },
    );
    expect(next.records).toHaveLength(1);
    expect(next.obsoleteIds).toEqual(first.snapshot.chunkIds);
    expect(next.snapshot.chunkIds).toEqual([]);
  });

  it('rejects forged, cross-key/store/ID and stale reuse snapshots', async () => {
    const first = await encode(large());
    for (const [store, id, revision, previous] of [
      ['datasets', 'private-source', 2, { ...first.snapshot }],
      ['nodes', 'private-source', 2, first.snapshot],
      ['datasets', 'other-source', 2, first.snapshot],
      ['datasets', 'private-source', 3, first.snapshot],
    ] as const) {
      await expect(
        codec.encode(vault.keys, store, id, large(), revision, [], { previous }),
      ).rejects.toMatchObject({ code: 'VAULT_INTEGRITY_FAILED' });
    }
  });

  it('rejects cross-vault reuse snapshots', async () => {
    const first = await encode(large());
    const other = await cipher.createVault('another correct password');
    try {
      await expect(
        codec.encode(other.keys, 'datasets', 'private-source', large(), 2, [], {
          previous: first.snapshot,
        }),
      ).rejects.toMatchObject({ code: 'VAULT_INTEGRITY_FAILED' });
    } finally {
      cipher.destroyKeys(other.keys);
    }
  });

  it('rejects changed query partitions, root IDs, revisions and reserved-root removal', async () => {
    const bundle = await encode(large());
    const read = physical(bundle).read;
    for (const root of [
      { ...bundle.root, partitions: [] },
      { ...bundle.root, id: await codec.id(vault.keys, 'datasets', 'other') },
      { ...bundle.root, revision: 2 },
      { ...bundle.root, store: 'nodes' as const },
    ])
      await expect(codec.decode(vault.keys, root, read)).rejects.toBeInstanceOf(Error);
    const removed = await manifestRoot(bundle, (_m, wrapper) => {
      wrapper.partitions = [];
    });
    await expect(codec.project(vault.keys, { ...removed, partitions: [] })).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
  });

  it('rejects missing, reordered, ciphertext-tampered and foreign chunks without a value', async () => {
    const bundle = await encode('A'.repeat(210_000), { chunkBytes: 65_536 });
    const store = physical(bundle);
    const missing = async (ids: readonly string[]) => ids.map(() => undefined);
    await expect(codec.decode(vault.keys, bundle.root, missing)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
    const reordered = async (ids: readonly string[]) => (await store.read(ids)).reverse();
    await expect(codec.decode(vault.keys, bundle.root, reordered)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
    const first = bundle.records[1];
    store.records.set(first.id, {
      ...first,
      encrypted: {
        ...first.encrypted,
        ciphertext: first.encrypted.ciphertext.replace(
          /^./,
          first.encrypted.ciphertext[0] === 'A' ? 'B' : 'A',
        ),
      },
    });
    await expect(codec.decode(vault.keys, bundle.root, store.read)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
    store.records.set(first.id, {
      ...first,
      partitions: [await codec.rootPartition(vault.keys, 'datasets')],
    });
    await expect(codec.decode(vault.keys, bundle.root, store.read)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
  });

  it('validates an authenticated ordered manifest before requesting any payload', async () => {
    const bundle = await encode('A'.repeat(210_000), { chunkBytes: 65_536 });
    const read = physical(bundle).read;
    for (const change of [
      (m: any) => {
        m.payloads[0].chunks.reverse();
      },
      (m: any) => {
        m.payloads[0].chunks[1].id = m.payloads[0].chunks[0].id;
      },
      (m: any) => {
        m.payloads[0].chunks[0].tag = 'A'.repeat(22);
      },
      (m: any) => {
        m.bytes++;
      },
      (m: any) => {
        m.bytes = logicalJsonLimits.bytes + 1;
      },
      (m: any) => {
        m.values = logicalJsonLimits.values + 1;
      },
    ]) {
      const root = await manifestRoot(bundle, change);
      await expect(codec.decode(vault.keys, root, read)).rejects.toBeInstanceOf(Error);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('authenticates bytes and actual value counts rather than trusting declared metadata', async () => {
    const bundle = await encode(large());
    const root = await manifestRoot(bundle, (m) => {
      m.values++;
      m.payloads[0].values++;
    });
    await expect(codec.decode(vault.keys, root, physical(bundle).read)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
  });

  it('rejects a validly encrypted chunk whose contextual logical fields were substituted', async () => {
    const bundle = await encode(large());
    const first = bundle.records[1];
    const context = { store: first.store, recordId: first.id, recordVersion: first.revision };
    const value = await cipher.decryptRecord<any>(vault.keys, context, first.encrypted);
    value.logicalId = 'foreign-source';
    const encrypted = await cipher.encryptRecord(vault.keys, context, value);
    const replaced = { ...first, encrypted };
    const ciphertextHash = await cipher.indexToken(
      vault.keys,
      `logical-ciphertext:${first.store}`,
      JSON.stringify([encrypted.iv, encrypted.ciphertext]),
    );
    const root = await manifestRoot(bundle, (m) => {
      m.payloads[0].chunks[0].ciphertextHash = ciphertextHash;
    });
    const store = physical(bundle);
    store.records.set(first.id, replaced);
    await expect(codec.decode(vault.keys, root, store.read)).rejects.toMatchObject({
      code: 'VAULT_INTEGRITY_FAILED',
    });
  });

  it('rejects numeric overflow and excess depth inside authenticated inline bytes', async () => {
    const bundle = await encode(0);
    let deep: unknown = 0;
    for (let i = 0; i < 65; i++) deep = [deep];
    for (const text of ['1e400', JSON.stringify(deep)]) {
      const encoded = btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const root = await manifestRoot(bundle, (m) => {
        m.bytes = text.length;
        m.payloads[0].bytes = text.length;
        m.payloads[0].inline = encoded;
      });
      await expect(codec.decode(vault.keys, root, physical(bundle).read)).rejects.toBeInstanceOf(
        Error,
      );
    }
  });

  it('fences key destruction while a physical read is pending', async () => {
    const keys = await cipher.unlockWithPassword(vault.header, 'correct horse battery staple');
    const bundle = await codec.encode(keys, 'datasets', 'd', large(), 1);
    let resume!: () => void;
    let requested = false;
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const store = physical(bundle);
    const pending = codec.decode(keys, bundle.root, async (ids) => {
      requested = true;
      await waiting;
      return store.read(ids);
    });
    await vi.waitFor(() => expect(requested).toBe(true));
    cipher.destroyKeys(keys);
    resume();
    await expect(pending).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
  });

  it('retains a supported 100000×100 CSV despite 16MiB and 2M-value physical limits', async () => {
    const row = Array<string>(100).fill('');
    const rows = Array<string[]>(100_000).fill(row);
    const value = { id: 'source', name: 'Large CSV', rows };
    const bundle = await encode(value, {
      payloadFields: ['rows'],
      projection: { id: value.id, rowCount: rows.length },
    });
    expect(bundle.records.length).toBeGreaterThan(17);
    const decoded = await codec.decode<typeof value>(
      vault.keys,
      bundle.root,
      physical(bundle).read,
    );
    expect(decoded.name).toBe(value.name);
    expect(decoded.rows).toHaveLength(100_000);
    expect(decoded.rows[99_999]).toHaveLength(100);
    expect(decoded.rows[99_999][99]).toBe('');
    expect(logicalJsonLimits.bytes).toBeGreaterThanOrEqual(256 * 1024 * 1024);
  }, 90_000);

  it('rejects excessive partitions and payload/schema/projection resources', async () => {
    await expect(
      codec.encode(
        vault.keys,
        'datasets',
        'd',
        {},
        1,
        Array.from({ length: 64 }, (_, i) => ({ index: 'owner', value: String(i) })),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(
      encode({}, { projection: { text: 'x'.repeat(logicalJsonLimits.projectionBytes) } }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(encode({}, { payloadFields: ['rows', 'rows'] })).rejects.toMatchObject({
      code: 'INVALID_SCHEMA',
    });
    await expect(encode({}, { chunkBytes: 1 })).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
  });
});

describe('bounded logical JSON serialization', () => {
  it.each([
    undefined,
    NaN,
    Infinity,
    [undefined],
    [, 'hole'],
    new Date(),
    {
      get password() {
        throw Error('must not execute');
      },
    },
  ])('rejects non-JSON input without executing accessors', (value) => {
    expect(() => [
      ...logicalJsonChunks(value, { chunkBytes: 1024, budget: { bytes: 0, values: 0 } }),
    ]).toThrow();
  });
  it('rejects cycles and encode/decode depth, numeric overflow and value-limit violations', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => [
      ...logicalJsonChunks(cycle, { chunkBytes: 1024, budget: { bytes: 0, values: 0 } }),
    ]).toThrow();
    let deep: unknown = 0;
    for (let index = 0; index < 65; index++) deep = [deep];
    expect(() => [
      ...logicalJsonChunks(deep, { chunkBytes: 1024, budget: { bytes: 0, values: 0 } }),
    ]).toThrow();
    expect(() => parseLogicalJson(JSON.stringify(deep), { bytes: 0, values: 0 })).toThrow();
    expect(() => parseLogicalJson('1e400', { bytes: 0, values: 0 })).toThrow();
    expect(() =>
      parseLogicalJson('[0]', { bytes: 0, values: logicalJsonLimits.values - 1 }),
    ).toThrow();
    expect(() => [
      ...logicalJsonChunks('large', {
        chunkBytes: 1024,
        budget: { bytes: 0, values: 0 },
        bytesLimit: 3,
      }),
    ]).toThrow();
  });
});
