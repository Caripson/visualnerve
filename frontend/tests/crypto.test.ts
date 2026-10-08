import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VaultCrypto, VaultCryptoError, type CreatedVault } from '../src/security/vault-crypto';
import { base64url, jsonBytes, parseJson, unbase64url, utf8 } from '../src/security/vault-codec';
import {
  MAX_PASSWORD_KDF_ITERATIONS,
  MIN_BACKUP_CHUNK_BYTES,
  PASSWORD_KDF_ITERATIONS,
  parseEncryptedVaultBackup,
  parseEncryptedVaultRecord,
  parseVaultHeader,
  type EncryptedVaultRecord,
  type VaultRecordContext,
} from '../src/security/vault-schema';

const PASSWORD = 'A long correct local passphrase 🌳';
const NEW_PASSWORD = 'A different local passphrase 🦉';
const context: VaultRecordContext = {
  store: 'nodes',
  recordId: 'opaque-record-key',
  recordVersion: 1,
};
const content = {
  title: 'Private customer AAA',
  metadata: { amount: 1293.4 },
  description: 'Svenska åäö 日本語',
};
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
const mutable = <T>(value: T) => structuredClone(value) as Mutable<T>;
function altered(value: string) {
  const bytes = unbase64url(value, 1, 16 * 1024 * 1024 + 16);
  bytes[bytes.length - 1] ^= 1;
  return base64url(bytes);
}
let crypto: VaultCrypto, vault: CreatedVault, other: CreatedVault;
beforeAll(async () => {
  crypto = new VaultCrypto(webcrypto as unknown as Crypto);
  vault = await crypto.createVault(PASSWORD);
  other = await crypto.createVault(PASSWORD);
});
afterEach(() => vi.restoreAllMocks());

describe('versioned browser-native vault keys', () => {
  it('creates only frozen opaque capabilities and encrypted key envelopes', () => {
    expect(vault.header).toMatchObject({
      format: 'visualnerve-vault',
      version: 1,
      keyVersion: 1,
      password: { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 } },
    });
    expect(Object.keys(vault.keys)).toEqual(['vaultId', 'keyVersion']);
    expect(Object.isFrozen(vault.keys)).toBe(true);
    expect(Object.isFrozen(vault.header.password.kdf)).toBe(true);
    expect(JSON.stringify(vault.header)).not.toContain(PASSWORD);
    expect(JSON.stringify(vault.header)).not.toContain(vault.recoveryKey);
    expect(JSON.stringify(vault)).not.toContain(vault.recoveryKey);
    expect(unbase64url(vault.header.password.iv, 12)).toHaveLength(12);
    expect(unbase64url(vault.header.password.ciphertext, 48)).toHaveLength(48);
  });
  it('unlocks by password and by independent random recovery key', async () => {
    const record = await crypto.encryptRecord(vault.keys, context, content);
    const byPassword = await crypto.unlockWithPassword(vault.header, PASSWORD);
    const byRecovery = await crypto.unlockWithRecovery(vault.header, vault.recoveryKey);
    expect(await crypto.decryptRecord(byPassword, context, record)).toEqual(content);
    expect(await crypto.decryptRecord(byRecovery, context, record)).toEqual(content);
    crypto.destroyKeys(byPassword);
    crypto.destroyKeys(byRecovery);
  });
  it('rejects a wrong password and a valid-format but wrong recovery key', async () => {
    await expect(crypto.unlockWithPassword(vault.header, NEW_PASSWORD)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    await expect(crypto.unlockWithRecovery(vault.header, other.recoveryKey)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });
  it.each(['', 'secret', 'a'.repeat(1025), 'a'.repeat(11) + '\ud800'])(
    'rejects unsupported password input before derivation (%#)',
    async (password) => {
      const derive = vi.spyOn(webcrypto.subtle, 'deriveKey');
      await expect(crypto.createVault(password)).rejects.toMatchObject({
        code: 'INVALID_PASSWORD',
      });
      expect(derive).not.toHaveBeenCalled();
    },
  );
  it('does not trim or normalize the supplied password', async () => {
    const spaced = await crypto.createVault(`  ${PASSWORD}  `);
    await expect(crypto.unlockWithPassword(spaced.header, PASSWORD)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    const unlocked = await crypto.unlockWithPassword(spaced.header, `  ${PASSWORD}  `);
    crypto.destroyKeys(unlocked);
    crypto.destroyKeys(spaced.keys);
  });
  it.each(['', 'VNREC1-invalid', 'VNREC2-' + 'A'.repeat(43), 'VNREC1-' + 'A'.repeat(42) + 'B'])(
    'rejects malformed recovery material (%#)',
    async (key) => {
      await expect(crypto.unlockWithRecovery(vault.header, key)).rejects.toMatchObject({
        code: 'INVALID_RECOVERY_KEY',
      });
    },
  );
  it('derives nonextractable AES and separated nonextractable HMAC keys', async () => {
    const imports = vi.spyOn(webcrypto.subtle, 'importKey');
    const derives = vi.spyOn(webcrypto.subtle, 'deriveKey');
    const keys = await crypto.unlockWithRecovery(vault.header, vault.recoveryKey);
    const captured = await Promise.all(
      [...imports.mock.results, ...derives.mock.results].map(
        (result) => result.value as Promise<webcrypto.CryptoKey>,
      ),
    );
    expect(captured.filter((key) => key.algorithm.name === 'HMAC')).toHaveLength(2);
    for (const key of captured) {
      expect(key.extractable).toBe(false);
      await expect(webcrypto.subtle.exportKey('raw', key)).rejects.toBeInstanceOf(Error);
    }
    crypto.destroyKeys(keys);
  });
  it('changes the current password envelope without changing ciphertext/index identity', async () => {
    const record = await crypto.encryptRecord(vault.keys, context, content);
    const token = await crypto.indexToken(vault.keys, 'owner-name', content.title);
    const changed = await crypto.changePassword(vault.header, vault.keys, NEW_PASSWORD);
    expect(changed.keyVersion).toBe(vault.header.keyVersion);
    expect(changed.recovery).toEqual(vault.header.recovery);
    expect(changed.password.kdf.salt).not.toBe(vault.header.password.kdf.salt);
    await expect(crypto.unlockWithPassword(changed, PASSWORD)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    const keys = await crypto.unlockWithPassword(changed, NEW_PASSWORD);
    expect(await crypto.decryptRecord(keys, context, record)).toEqual(content);
    expect(await crypto.indexToken(keys, 'owner-name', content.title)).toBe(token);
    crypto.destroyKeys(keys);
    // A saved old envelope remains recoverable; a password change cannot revoke old backups.
    const oldKeys = await crypto.unlockWithPassword(vault.header, PASSWORD);
    expect(await crypto.decryptRecord(oldKeys, context, record)).toEqual(content);
    crypto.destroyKeys(oldKeys);
  });
  it('replaces recovery material and can change the password after recovery unlock', async () => {
    const recovered = await crypto.unlockWithRecovery(vault.header, vault.recoveryKey);
    const replaced = await crypto.changeRecovery(vault.header, recovered);
    await expect(
      crypto.unlockWithRecovery(replaced.header, vault.recoveryKey),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    const next = await crypto.unlockWithRecovery(replaced.header, replaced.recoveryKey);
    const changed = await crypto.changePassword(replaced.header, next, NEW_PASSWORD);
    const final = await crypto.unlockWithPassword(changed, NEW_PASSWORD);
    crypto.destroyKeys(recovered);
    crypto.destroyKeys(next);
    crypto.destroyKeys(final);
  });
  it('prepares a genuine content-key rotation; old data is not silently made unreadable', async () => {
    const record = await crypto.encryptRecord(vault.keys, context, content);
    const rotated = await crypto.rotateContentKey(vault.header, vault.keys, NEW_PASSWORD);
    expect(rotated.header.vaultId).toBe(vault.header.vaultId);
    expect(rotated.header.keyVersion).toBe(2);
    expect(await crypto.indexToken(rotated.keys, 'owner-name', content.title)).not.toBe(
      await crypto.indexToken(vault.keys, 'owner-name', content.title),
    );
    await expect(crypto.decryptRecord(rotated.keys, context, record)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    const value = await crypto.decryptRecord(vault.keys, context, record);
    const reencrypted = await crypto.encryptRecord(rotated.keys, context, value);
    expect(await crypto.decryptRecord(rotated.keys, context, reencrypted)).toEqual(content);
    await expect(crypto.decryptRecord(vault.keys, context, reencrypted)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    const reopened = await crypto.unlockWithPassword(rotated.header, NEW_PASSWORD);
    expect(await crypto.decryptRecord(reopened, context, reencrypted)).toEqual(content);
    crypto.destroyKeys(reopened);
    crypto.destroyKeys(rotated.keys);
  });
  it('fails header authentication even when password unwrap succeeds after recovery tampering', async () => {
    const header = mutable(vault.header);
    header.recovery.ciphertext = altered(header.recovery.ciphertext);
    await expect(crypto.unlockWithPassword(header, PASSWORD)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });
  it('does not accept a header or key capability from another vault/crypto owner', async () => {
    await expect(
      crypto.changePassword(other.header, vault.keys, NEW_PASSWORD),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    const record = await crypto.encryptRecord(vault.keys, context, content);
    await expect(
      new VaultCrypto(webcrypto as unknown as Crypto).decryptRecord(vault.keys, context, record),
    ).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
  });
  it('rejects destroyed keys, including after async encryption has already started', async () => {
    const keys = await crypto.unlockWithRecovery(vault.header, vault.recoveryKey);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = webcrypto.subtle.encrypt.bind(webcrypto.subtle);
    vi.spyOn(webcrypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      entered();
      await held;
      return result;
    });
    const operation = crypto.encryptRecord(keys, context, content);
    await started;
    crypto.destroyKeys(keys);
    release();
    await expect(operation).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
    await expect(crypto.indexToken(keys, 'owner', 'AAA')).rejects.toMatchObject({
      code: 'KEY_DESTROYED',
    });
    crypto.destroyKeys(keys);
  });
  it('supports injected deterministic random bytes without reducing KDF work factors', async () => {
    const provider = () => {
      let counter = 0;
      return {
        subtle: webcrypto.subtle,
        getRandomValues: (bytes: Uint8Array) => {
          for (let i = 0; i < bytes.length; i++) bytes[i] = ++counter % 256;
          return bytes;
        },
      } as unknown as Crypto;
    };
    const first = new VaultCrypto(provider()),
      second = new VaultCrypto(provider());
    const a = await first.createVault(PASSWORD),
      b = await second.createVault(PASSWORD);
    expect(a.header).toEqual(b.header);
    expect(a.recoveryKey).toBe(b.recoveryKey);
    first.destroyKeys(a.keys);
    second.destroyKeys(b.keys);
  });
});

describe('strict encrypted formats and resource bounds', () => {
  it('requires the complete native cryptographic interface', () => {
    expect(() => new VaultCrypto({ subtle: {} } as Crypto)).toThrowError(
      new VaultCryptoError('UNSUPPORTED_CRYPTO'),
    );
  });
  it.each([
    0,
    PASSWORD_KDF_ITERATIONS - 1,
    MAX_PASSWORD_KDF_ITERATIONS + 1,
    600000.5,
    '600000',
    NaN,
  ])('rejects unsafe KDF parameters before executing them (%#)', async (iterations) => {
    const derive = vi.spyOn(webcrypto.subtle, 'deriveKey');
    const header = mutable(vault.header) as unknown as {
      password: { kdf: { iterations: unknown } };
    };
    header.password.kdf.iterations = iterations;
    await expect(crypto.unlockWithPassword(header, PASSWORD)).rejects.toMatchObject({
      code: 'UNSAFE_KDF',
    });
    expect(derive).not.toHaveBeenCalled();
  });
  it('rejects unknown versions/fields/algorithms and noncanonical binary encodings', () => {
    expect(() => parseVaultHeader({ ...vault.header, version: 2 })).toThrow(VaultCryptoError);
    expect(() => parseVaultHeader({ ...vault.header, unexpected: true })).toThrow(VaultCryptoError);
    const wrongHash = mutable(vault.header);
    wrongHash.password.kdf.hash = 'SHA-1' as 'SHA-256';
    expect(() => parseVaultHeader(wrongHash)).toThrowError(new VaultCryptoError('UNSAFE_KDF'));
    const padded = mutable(vault.header);
    padded.authentication += '=';
    expect(() => parseVaultHeader(padded)).toThrow(VaultCryptoError);
    expect(() => unbase64url('A'.repeat(42) + 'B', 32)).toThrow(VaultCryptoError);
  });
  it('rejects accessor fields without executing attacker-controlled getters', () => {
    const getter = vi.fn(() => vault.header.password);
    const header = { ...vault.header };
    Object.defineProperty(header, 'password', { enumerable: true, get: getter });
    expect(() => parseVaultHeader(header)).toThrow(VaultCryptoError);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([undefined, NaN, Infinity, 1n, () => 1, new Date(), [undefined], Array(1)])(
    'rejects non-JSON data instead of silently losing it (%#)',
    async (value) => {
      await expect(crypto.encryptRecord(vault.keys, context, value)).rejects.toMatchObject({
        code: 'INVALID_SCHEMA',
      });
    },
  );
  it('rejects cyclic, overdeep and oversized plaintext', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(crypto.encryptRecord(vault.keys, context, circular)).rejects.toMatchObject({
      code: 'INVALID_SCHEMA',
    });
    let deep: unknown = null;
    for (let i = 0; i < 70; i++) deep = [deep];
    await expect(crypto.encryptRecord(vault.keys, context, deep)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    await expect(
      crypto.encryptRecord(vault.keys, context, 'x'.repeat(16 * 1024 * 1024)),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });
  it('round trips null-prototype objects, Unicode and literal __proto__ data safely', async () => {
    const value = Object.assign(
      Object.create(null),
      JSON.parse('{"__proto__":{"safe":"private"},"value":"åäö","unpaired":"\\ud800"}'),
    );
    const record = await crypto.encryptRecord(vault.keys, context, value);
    const result = await crypto.decryptRecord<Record<string, unknown>>(vault.keys, context, record);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result).toEqual(value);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('authenticated records and protected equality tokens', () => {
  it.each(['{"amount":1e400}', '['.repeat(65) + '0' + ']'.repeat(65)])(
    'rejects independently authored, authenticated JSON outside the finite/depth contract (%#)',
    async (json) => {
      // Use only this test vault's recovery material to author a valid GCM record
      // independently of encryptRecord(), reproducing imported writer/version input.
      const wrapping = await webcrypto.subtle.importKey(
        'raw',
        unbase64url(vault.recoveryKey.slice(7), 32),
        'AES-GCM',
        false,
        ['decrypt'],
      );
      const raw = new Uint8Array(
        await webcrypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: unbase64url(vault.header.recovery.iv, 12),
            additionalData: utf8(
              JSON.stringify([
                'visualnerve-vault-key-envelope',
                1,
                vault.header.vaultId,
                vault.header.keyVersion,
                'recovery',
              ]),
            ),
            tagLength: 128,
          },
          wrapping,
          unbase64url(vault.header.recovery.ciphertext, 48),
        ),
      );
      try {
        const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
        const iv = webcrypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await webcrypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv,
            tagLength: 128,
            additionalData: utf8(
              JSON.stringify([
                'visualnerve-record',
                1,
                vault.keys.vaultId,
                vault.keys.keyVersion,
                context.store,
                context.recordId,
                context.recordVersion,
              ]),
            ),
          },
          key,
          utf8(json),
        );
        const record: EncryptedVaultRecord = {
          format: 'visualnerve-record',
          version: 1,
          vaultId: vault.keys.vaultId,
          keyVersion: vault.keys.keyVersion,
          ...context,
          iv: base64url(iv),
          ciphertext: base64url(new Uint8Array(ciphertext)),
        };
        await expect(crypto.decryptRecord(vault.keys, context, record)).rejects.toMatchObject({
          code: json.startsWith('{') ? 'INVALID_SCHEMA' : 'LIMIT_EXCEEDED',
        });
      } finally {
        raw.fill(0);
      }
    },
  );
  it('uses fresh 96-bit IVs for each write of the same plaintext', async () => {
    const records = await Promise.all(
      Array.from({ length: 30 }, () => crypto.encryptRecord(vault.keys, context, content)),
    );
    expect(new Set(records.map((record) => record.iv)).size).toBe(30);
    expect(new Set(records.map((record) => record.ciphertext)).size).toBe(30);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(JSON.stringify(records[0])).not.toContain(content.title);
  });
  it.each(['iv', 'ciphertext'] as const)('rejects tampered %s', async (field) => {
    const record = mutable(await crypto.encryptRecord(vault.keys, context, content));
    record[field] = altered(record[field]);
    await expect(crypto.decryptRecord(vault.keys, context, record)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });
  it.each([{ store: 'edges' as const }, { recordId: 'another-record' }, { recordVersion: 2 }])(
    'authenticates actual store/id/version AAD, beyond metadata equality (%#)',
    async (change) => {
      const original = await crypto.encryptRecord(vault.keys, context, content);
      const substituted = { ...original, ...change };
      const expected = { ...context, ...change };
      await expect(crypto.decryptRecord(vault.keys, expected, substituted)).rejects.toMatchObject({
        code: 'AUTHENTICATION_FAILED',
      });
    },
  );
  it('rejects substitution across vaults and malformed record schemas', async () => {
    const record = await crypto.encryptRecord(vault.keys, context, content);
    await expect(crypto.decryptRecord(other.keys, context, record)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    expect(() => parseEncryptedVaultRecord({ ...record, format: 'other' })).toThrow(
      VaultCryptoError,
    );
    expect(() => parseEncryptedVaultRecord({ ...record, recordVersion: 0 })).toThrow(
      VaultCryptoError,
    );
    expect(() => parseEncryptedVaultRecord({ ...record, store: 'arbitrary-store' })).toThrow(
      VaultCryptoError,
    );
    await expect(
      crypto.decryptRecord(vault.keys, context, {
        ...record,
        ciphertext: record.ciphertext.slice(0, -2),
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });
  it('provides stable but domain/vault/content-key-separated protected tokens', async () => {
    const first = await crypto.indexToken(vault.keys, 'nodes:id', 'AAA');
    expect(unbase64url(first, 32)).toHaveLength(32);
    expect(await crypto.indexToken(vault.keys, 'nodes:id', 'AAA')).toBe(first);
    expect(await crypto.indexToken(vault.keys, 'owners:id', 'AAA')).not.toBe(first);
    expect(await crypto.indexToken(other.keys, 'nodes:id', 'AAA')).not.toBe(first);
    expect(await crypto.indexToken(vault.keys, 'nodes:id', 'AAB')).not.toBe(first);
    expect(await crypto.indexToken(vault.keys, 'a', 'bc')).not.toBe(
      await crypto.indexToken(vault.keys, 'ab', 'c'),
    );
    expect(first).not.toContain('AAA');
    const bytes = new Uint8Array([1, 2, 3]);
    await crypto.indexToken(vault.keys, 'binary', bytes);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('portable encrypted backups with complete manifest integrity', () => {
  const source = Uint8Array.from({ length: MIN_BACKUP_CHUNK_BYTES * 2 + 19 }, (_, i) => i % 251);
  let backup: Awaited<ReturnType<VaultCrypto['encryptBackup']>>;
  beforeAll(async () => {
    backup = await crypto.encryptBackup(vault.header, vault.keys, source, {
      chunkSize: MIN_BACKUP_CHUNK_BYTES,
    });
  });
  it('authenticates and returns all bytes with bounded chunks and recovery portability', async () => {
    expect(backup.chunks).toHaveLength(3);
    expect(
      backup.chunks.every(
        (chunk) =>
          unbase64url(chunk.ciphertext, 16, MIN_BACKUP_CHUNK_BYTES + 16).length <=
          MIN_BACKUP_CHUNK_BYTES + 16,
      ),
    ).toBe(true);
    expect(Object.isFrozen(backup.chunks)).toBe(true);
    const recovered = await crypto.unlockWithRecovery(backup.header, vault.recoveryKey);
    expect(await crypto.decryptBackup(recovered, JSON.parse(JSON.stringify(backup)))).toEqual(
      source,
    );
    crypto.destroyKeys(recovered);
  });
  it('supports an empty source without dropping the authenticated chunk/manifest', async () => {
    const empty = await crypto.encryptBackup(vault.header, vault.keys, new Uint8Array());
    expect(empty.chunks).toHaveLength(1);
    expect(await crypto.decryptBackup(vault.keys, empty)).toEqual(new Uint8Array());
  });
  it.each([
    'alter',
    'reorder',
    'duplicate',
    'drop',
    'append',
    'manifest',
    'id',
    'size',
    'header',
  ] as const)('rejects backup %s without releasing partial plaintext', async (mutation) => {
    const candidate = mutable(backup);
    if (mutation === 'alter')
      candidate.chunks[2].ciphertext = altered(candidate.chunks[2].ciphertext);
    if (mutation === 'reorder')
      [candidate.chunks[0], candidate.chunks[1]] = [candidate.chunks[1], candidate.chunks[0]];
    if (mutation === 'duplicate') candidate.chunks[1] = candidate.chunks[0];
    if (mutation === 'drop') candidate.chunks.pop();
    if (mutation === 'append') candidate.chunks.push(candidate.chunks[0]);
    if (mutation === 'manifest')
      candidate.manifest.ciphertext = altered(candidate.manifest.ciphertext);
    if (mutation === 'id') candidate.backupId = other.header.vaultId;
    if (mutation === 'size') candidate.totalBytes--;
    if (mutation === 'header')
      candidate.header.recovery.ciphertext = altered(candidate.header.recovery.ciphertext);
    await expect(crypto.decryptBackup(vault.keys, candidate)).rejects.toBeInstanceOf(
      VaultCryptoError,
    );
  });
  it('rejects mixed containers even if individual source chunks were legitimately encrypted', async () => {
    const second = await crypto.encryptBackup(vault.header, vault.keys, source, {
      chunkSize: MIN_BACKUP_CHUNK_BYTES,
    });
    const mixed = mutable(backup);
    mixed.chunks[0] = mutable(second.chunks[0]);
    await expect(crypto.decryptBackup(vault.keys, mixed)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });
  it('validates size/count limits and rejects lazy getter chunks before allocation', () => {
    expect(() =>
      parseEncryptedVaultBackup({ ...backup, totalBytes: 1024 * 1024 * 1024 + 1 }),
    ).toThrow(VaultCryptoError);
    expect(() => parseEncryptedVaultBackup({ ...backup, chunkSize: 1 })).toThrow(VaultCryptoError);
    expect(() => parseEncryptedVaultBackup({ ...backup, extra: 'not allowed' })).toThrow(
      VaultCryptoError,
    );
    const chunks = [...backup.chunks],
      getter = vi.fn(() => backup.chunks[0]);
    Object.defineProperty(chunks, '0', { enumerable: true, get: getter });
    expect(() => parseEncryptedVaultBackup({ ...backup, chunks })).toThrow(VaultCryptoError);
    expect(getter).not.toHaveBeenCalled();
  });
  it('returns no plaintext when the key is destroyed during backup authentication', async () => {
    const keys = await crypto.unlockWithRecovery(vault.header, vault.recoveryKey);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    const original = webcrypto.subtle.decrypt.bind(webcrypto.subtle);
    vi.spyOn(webcrypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      entered();
      await held;
      return result;
    });
    const operation = crypto.decryptBackup(keys, backup);
    await started;
    crypto.destroyKeys(keys);
    release();
    await expect(operation).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
  });
});

describe('bounded JSON codec', () => {
  it('enforces byte bounds before UTF-8/JSON parsing allocates its output', () => {
    const parse = vi.spyOn(JSON, 'parse');
    expect(() => parseJson(new Uint8Array(16 * 1024 * 1024 + 1))).toThrowError(
      new VaultCryptoError('LIMIT_EXCEEDED'),
    );
    expect(parse).not.toHaveBeenCalled();
  });
  it('applies the same finite-number and depth limits to decoded JSON', () => {
    expect(() => parseJson(utf8('{"value":1e400}'))).toThrowError(
      new VaultCryptoError('INVALID_SCHEMA'),
    );
    expect(() => parseJson(utf8('['.repeat(65) + '0' + ']'.repeat(65)))).toThrowError(
      new VaultCryptoError('LIMIT_EXCEEDED'),
    );
    expect(parseJson(utf8('['.repeat(64) + '0' + ']'.repeat(64)))).toBeDefined();
  });
  it('rejects more than 2,000,000 decoded values before returning the parsed contents', () => {
    const bytes = utf8('[' + '0,'.repeat(2_000_000) + '0]');
    expect(() => parseJson(bytes)).toThrowError(new VaultCryptoError('LIMIT_EXCEEDED'));
  }, 15_000);
  it('rejects aggregate oversize before asking JSON.stringify to allocate it', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(() => jsonBytes(['x'.repeat(700), 'x'.repeat(700)], 1024)).toThrowError(
      new VaultCryptoError('LIMIT_EXCEEDED'),
    );
    expect(stringify).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF-8 and JSON while preserving ordinary nested values', () => {
    expect(parseJson(jsonBytes(content))).toEqual(content);
    expect(() => parseJson(new Uint8Array([0xff]))).toThrow(VaultCryptoError);
    expect(() => parseJson(new Uint8Array([123]))).toThrow(VaultCryptoError);
  });
});
