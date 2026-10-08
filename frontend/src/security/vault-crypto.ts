import {
  base64url,
  boundedString,
  jsonBytes,
  parseJson,
  RECORD_BYTES_LIMIT,
  unbase64url,
  utf8,
  wellFormedUnicode,
} from './vault-codec';
import { decryptBackupContainer, encryptBackupContainer } from './vault-backup';
import { VaultCryptoError } from './vault-errors';
import {
  MAX_KEY_VERSION,
  PASSWORD_KDF_ITERATIONS,
  parseEncryptedVaultBackup,
  parseEncryptedVaultRecord,
  parseVaultHeader,
  validateIterations,
  validateRecordContext,
  vaultIdentifier,
  type EncryptedVaultBackup,
  type EncryptedVaultRecord,
  type PasswordEnvelope,
  type PasswordKdf,
  type RecoveryEnvelope,
  type SealedVaultBytes,
  type VaultHeader,
  type VaultRecordContext,
} from './vault-schema';

declare const keyBrand: unique symbol;
/** Opaque capability. CryptoKeys and raw key bytes are never enumerable/public properties. */
export interface VaultKeys {
  readonly vaultId: string;
  readonly keyVersion: number;
  readonly [keyBrand]: true;
}
export interface CreatedVault {
  readonly header: VaultHeader;
  readonly keys: VaultKeys;
  /** The only intentional recovery-secret output; show once and never persist it. */
  readonly recoveryKey: string;
}
export interface VaultKdfOptions {
  iterations?: number;
}
export interface VaultCreationOptions extends VaultKdfOptions {
  vaultId?: string;
}
interface KeyMaterial {
  raw: Uint8Array<ArrayBuffer>;
  encryption: CryptoKey;
  index: CryptoKey;
  authentication: CryptoKey;
}

function passwordBytes(password: unknown): Uint8Array<ArrayBuffer> {
  if (
    typeof password !== 'string' ||
    password.length > 1024 ||
    !wellFormedUnicode(password) ||
    [...password].length < 12
  )
    throw new VaultCryptoError('INVALID_PASSWORD');
  const bytes = utf8(password);
  if (bytes.length > 1024) throw new VaultCryptoError('INVALID_PASSWORD');
  return bytes;
}
const headerBody = (header: Omit<VaultHeader, 'authentication'> | VaultHeader) => [
  'visualnerve-vault-header',
  header.version,
  header.vaultId,
  header.keyVersion,
  header.password.kind,
  header.password.kdf.name,
  header.password.kdf.hash,
  header.password.kdf.version,
  header.password.kdf.iterations,
  header.password.kdf.salt,
  header.password.iv,
  header.password.ciphertext,
  header.recovery.kind,
  header.recovery.iv,
  header.recovery.ciphertext,
];
const envelopeContext = (
  vaultId: string,
  keyVersion: number,
  kind: 'password' | 'recovery',
  kdf?: PasswordKdf,
) => [
  'visualnerve-vault-key-envelope',
  1,
  vaultId,
  keyVersion,
  kind,
  ...(kdf ? [kdf.name, kdf.hash, kdf.version, kdf.iterations, kdf.salt] : []),
];
const recordContext = (
  record: Pick<
    EncryptedVaultRecord,
    'vaultId' | 'keyVersion' | 'store' | 'recordId' | 'recordVersion'
  >,
) => [
  'visualnerve-record',
  1,
  record.vaultId,
  record.keyVersion,
  record.store,
  record.recordId,
  record.recordVersion,
];

/** Browser-native crypto only. Pass Node's WebCrypto for deterministic, isolated unit tests. */
export class VaultCrypto {
  private readonly materials = new WeakMap<VaultKeys, KeyMaterial>();
  constructor(private readonly crypto: Crypto = globalThis.crypto) {
    if (
      !crypto?.subtle ||
      typeof crypto.getRandomValues !== 'function' ||
      (['importKey', 'deriveKey', 'encrypt', 'decrypt', 'sign', 'verify', 'digest'] as const).some(
        (method) => typeof crypto.subtle[method] !== 'function',
      )
    )
      throw new VaultCryptoError('UNSUPPORTED_CRYPTO');
  }
  private random(size: number) {
    return this.crypto.getRandomValues(new Uint8Array(size));
  }
  private randomId() {
    const bytes = this.random(16);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  private material(keys: VaultKeys) {
    const material = this.materials.get(keys);
    if (!material) throw new VaultCryptoError('KEY_DESTROYED');
    return material;
  }
  private created(header: VaultHeader, keys: VaultKeys, recoveryKey: string): CreatedVault {
    // Deliberate access remains available for the one-time recovery UI; ordinary
    // JSON serialization must not accidentally turn it into persisted key material.
    return Object.freeze(
      Object.defineProperty({ header, keys }, 'recoveryKey', { value: recoveryKey }),
    ) as CreatedVault;
  }
  destroyKeys(keys: VaultKeys) {
    this.materials.get(keys)?.raw.fill(0);
    this.materials.delete(keys);
  }
  private async makeKeys(
    raw: Uint8Array<ArrayBuffer>,
    vaultId: string,
    keyVersion: number,
  ): Promise<VaultKeys> {
    const encryption = await this.crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
    const base = await this.crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const derive = (purpose: string) =>
      this.crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: utf8(JSON.stringify(['visualnerve-vault-key', 1, vaultId, keyVersion])),
          info: utf8(`visualnerve-vault:${purpose}:v1`),
        },
        base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign', 'verify'],
      );
    const index = await derive('index');
    const authentication = await derive('authentication');
    const keys = Object.freeze({ vaultId, keyVersion }) as VaultKeys;
    this.materials.set(keys, { raw: new Uint8Array(raw), encryption, index, authentication });
    return keys;
  }
  private async seal(
    key: CryptoKey,
    context: readonly unknown[],
    bytes: Uint8Array,
  ): Promise<SealedVaultBytes> {
    const iv = this.random(12);
    const snapshot = new Uint8Array(bytes);
    try {
      const encrypted = await this.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: jsonBytes(context), tagLength: 128 },
        key,
        snapshot,
      );
      return Object.freeze({ iv: base64url(iv), ciphertext: base64url(new Uint8Array(encrypted)) });
    } finally {
      snapshot.fill(0);
    }
  }
  private async open(
    key: CryptoKey,
    context: readonly unknown[],
    sealed: SealedVaultBytes,
  ): Promise<Uint8Array<ArrayBuffer>> {
    try {
      return new Uint8Array(
        await this.crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: unbase64url(sealed.iv, 12),
            additionalData: jsonBytes(context),
            tagLength: 128,
          },
          key,
          unbase64url(sealed.ciphertext, 16, RECORD_BYTES_LIMIT + 16),
        ),
      );
    } catch (error) {
      if (error instanceof VaultCryptoError) throw error;
      throw new VaultCryptoError('AUTHENTICATION_FAILED');
    }
  }
  private async passwordKey(password: string, kdf: PasswordKdf) {
    const bytes = passwordBytes(password);
    try {
      const material = await this.crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, [
        'deriveKey',
      ]);
      return await this.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: unbase64url(kdf.salt, 16),
          iterations: kdf.iterations,
        },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } finally {
      bytes.fill(0);
    }
  }
  private async passwordEnvelope(
    vaultId: string,
    keyVersion: number,
    raw: Uint8Array,
    password: string,
    options: VaultKdfOptions,
  ): Promise<PasswordEnvelope> {
    const iterations = validateIterations(options.iterations ?? PASSWORD_KDF_ITERATIONS);
    const kdf: PasswordKdf = Object.freeze({
      name: 'PBKDF2',
      hash: 'SHA-256',
      version: 1,
      iterations,
      salt: base64url(this.random(16)),
    });
    const key = await this.passwordKey(password, kdf);
    return Object.freeze({
      kind: 'password',
      kdf,
      ...(await this.seal(key, envelopeContext(vaultId, keyVersion, 'password', kdf), raw)),
    });
  }
  private recoveryBytes(recoveryKey: string) {
    if (typeof recoveryKey !== 'string' || !recoveryKey.startsWith('VNREC1-'))
      throw new VaultCryptoError('INVALID_RECOVERY_KEY');
    try {
      return unbase64url(recoveryKey.slice(7), 32);
    } catch {
      throw new VaultCryptoError('INVALID_RECOVERY_KEY');
    }
  }
  private async recoveryEnvelope(vaultId: string, keyVersion: number, raw: Uint8Array) {
    const secret = this.random(32);
    try {
      const key = await this.crypto.subtle.importKey('raw', secret, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]);
      const recovery: RecoveryEnvelope = Object.freeze({
        kind: 'recovery',
        ...(await this.seal(key, envelopeContext(vaultId, keyVersion, 'recovery'), raw)),
      });
      return { recovery, recoveryKey: `VNREC1-${base64url(secret)}` };
    } finally {
      secret.fill(0);
    }
  }
  private async authenticateHeader(
    header: Omit<VaultHeader, 'authentication'>,
    keys: VaultKeys,
  ): Promise<VaultHeader> {
    const authentication = base64url(
      new Uint8Array(
        await this.crypto.subtle.sign(
          'HMAC',
          this.material(keys).authentication,
          jsonBytes(headerBody(header)),
        ),
      ),
    );
    this.material(keys);
    return parseVaultHeader({ ...header, authentication });
  }
  private async verifyHeader(header: VaultHeader, keys: VaultKeys) {
    const material = this.material(keys);
    if (
      header.vaultId !== keys.vaultId ||
      header.keyVersion !== keys.keyVersion ||
      !(await this.crypto.subtle.verify(
        'HMAC',
        material.authentication,
        unbase64url(header.authentication, 32),
        jsonBytes(headerBody(header)),
      ))
    )
      throw new VaultCryptoError('AUTHENTICATION_FAILED');
    this.material(keys);
  }
  async createVault(password: string, options: VaultCreationOptions = {}): Promise<CreatedVault> {
    passwordBytes(password).fill(0);
    validateIterations(options.iterations ?? PASSWORD_KDF_ITERATIONS);
    const vaultId =
      options.vaultId === undefined ? this.randomId() : vaultIdentifier(options.vaultId);
    const raw = this.random(32);
    let keys: VaultKeys | undefined;
    try {
      keys = await this.makeKeys(raw, vaultId, 1);
      const passwordEnvelope = await this.passwordEnvelope(vaultId, 1, raw, password, options);
      const { recovery, recoveryKey } = await this.recoveryEnvelope(vaultId, 1, raw);
      const header = await this.authenticateHeader(
        {
          format: 'visualnerve-vault',
          version: 1,
          vaultId,
          keyVersion: 1,
          password: passwordEnvelope,
          recovery,
        },
        keys,
      );
      return this.created(header, keys, recoveryKey);
    } catch (error) {
      if (keys) this.destroyKeys(keys);
      throw error;
    } finally {
      raw.fill(0);
    }
  }
  private async unlocked(header: VaultHeader, raw: Uint8Array<ArrayBuffer>): Promise<VaultKeys> {
    let keys: VaultKeys | undefined;
    try {
      if (raw.length !== 32) throw new VaultCryptoError('AUTHENTICATION_FAILED');
      keys = await this.makeKeys(raw, header.vaultId, header.keyVersion);
      await this.verifyHeader(header, keys);
      return keys;
    } catch (error) {
      if (keys) this.destroyKeys(keys);
      throw error;
    } finally {
      raw.fill(0);
    }
  }
  async unlockWithPassword(input: unknown, password: string): Promise<VaultKeys> {
    const header = parseVaultHeader(input);
    const key = await this.passwordKey(password, header.password.kdf);
    return this.unlocked(
      header,
      await this.open(
        key,
        envelopeContext(header.vaultId, header.keyVersion, 'password', header.password.kdf),
        header.password,
      ),
    );
  }
  async unlockWithRecovery(input: unknown, recoveryKey: string): Promise<VaultKeys> {
    const header = parseVaultHeader(input);
    const bytes = this.recoveryBytes(recoveryKey);
    try {
      const key = await this.crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
      return await this.unlocked(
        header,
        await this.open(
          key,
          envelopeContext(header.vaultId, header.keyVersion, 'recovery'),
          header.recovery,
        ),
      );
    } finally {
      bytes.fill(0);
    }
  }
  async changePassword(
    input: unknown,
    keys: VaultKeys,
    password: string,
    options: VaultKdfOptions = {},
  ): Promise<VaultHeader> {
    const header = parseVaultHeader(input);
    await this.verifyHeader(header, keys);
    const raw = new Uint8Array(this.material(keys).raw);
    try {
      return await this.authenticateHeader(
        {
          ...header,
          password: await this.passwordEnvelope(
            header.vaultId,
            header.keyVersion,
            raw,
            password,
            options,
          ),
        },
        keys,
      );
    } finally {
      raw.fill(0);
    }
  }
  async changeRecovery(input: unknown, keys: VaultKeys) {
    const header = parseVaultHeader(input);
    await this.verifyHeader(header, keys);
    const raw = new Uint8Array(this.material(keys).raw);
    try {
      const { recovery, recoveryKey } = await this.recoveryEnvelope(
        header.vaultId,
        header.keyVersion,
        raw,
      );
      return Object.freeze(
        Object.defineProperty(
          { header: await this.authenticateHeader({ ...header, recovery }, keys) },
          'recoveryKey',
          { value: recoveryKey },
        ),
      ) as { readonly header: VaultHeader; readonly recoveryKey: string };
    } finally {
      raw.fill(0);
    }
  }
  /** Prepare only: callers must reencrypt data and atomically activate the complete new key epoch. */
  async rotateContentKey(
    input: unknown,
    keys: VaultKeys,
    password: string,
    options: VaultKdfOptions = {},
  ): Promise<CreatedVault> {
    const previous = parseVaultHeader(input);
    await this.verifyHeader(previous, keys);
    if (previous.keyVersion >= MAX_KEY_VERSION) throw new VaultCryptoError('LIMIT_EXCEEDED');
    passwordBytes(password).fill(0);
    validateIterations(options.iterations ?? PASSWORD_KDF_ITERATIONS);
    const raw = this.random(32),
      keyVersion = previous.keyVersion + 1;
    let next: VaultKeys | undefined;
    try {
      next = await this.makeKeys(raw, previous.vaultId, keyVersion);
      const passwordEnvelope = await this.passwordEnvelope(
        previous.vaultId,
        keyVersion,
        raw,
        password,
        options,
      );
      const { recovery, recoveryKey } = await this.recoveryEnvelope(
        previous.vaultId,
        keyVersion,
        raw,
      );
      this.material(keys);
      const header = await this.authenticateHeader(
        {
          format: 'visualnerve-vault',
          version: 1,
          vaultId: previous.vaultId,
          keyVersion,
          password: passwordEnvelope,
          recovery,
        },
        next,
      );
      this.material(keys);
      return this.created(header, next, recoveryKey);
    } catch (error) {
      if (next) this.destroyKeys(next);
      throw error;
    } finally {
      raw.fill(0);
    }
  }
  async indexToken(
    keys: VaultKeys,
    namespace: string,
    value: string | Uint8Array,
  ): Promise<string> {
    const prefix = jsonBytes([
      'visualnerve-vault-index',
      1,
      keys.vaultId,
      keys.keyVersion,
      boundedString(namespace, 256),
    ]);
    if (
      typeof value === 'string'
        ? !wellFormedUnicode(value)
        : !ArrayBuffer.isView(value) ||
          Object.prototype.toString.call(value) !== '[object Uint8Array]'
    )
      throw new VaultCryptoError('INVALID_SCHEMA');
    if ((typeof value === 'string' ? value.length : value.byteLength) > RECORD_BYTES_LIMIT)
      throw new VaultCryptoError('LIMIT_EXCEEDED');
    const bytes = typeof value === 'string' ? utf8(value) : new Uint8Array(value);
    if (bytes.length > RECORD_BYTES_LIMIT) throw new VaultCryptoError('LIMIT_EXCEEDED');
    const input = new Uint8Array(prefix.length + 1 + bytes.length);
    input.set(prefix);
    input.set(bytes, prefix.length + 1);
    try {
      const result = await this.crypto.subtle.sign('HMAC', this.material(keys).index, input);
      this.material(keys);
      return base64url(new Uint8Array(result));
    } finally {
      input.fill(0);
      bytes.fill(0);
    }
  }
  async encryptRecord(
    keys: VaultKeys,
    expected: VaultRecordContext,
    value: unknown,
  ): Promise<EncryptedVaultRecord> {
    const context = validateRecordContext(expected);
    const bytes = jsonBytes(value);
    const record = {
      format: 'visualnerve-record' as const,
      version: 1 as const,
      vaultId: keys.vaultId,
      keyVersion: keys.keyVersion,
      ...context,
    };
    try {
      const sealed = await this.seal(this.material(keys).encryption, recordContext(record), bytes);
      this.material(keys);
      return Object.freeze({ ...record, ...sealed });
    } finally {
      bytes.fill(0);
    }
  }
  async decryptRecord<T = unknown>(
    keys: VaultKeys,
    expected: VaultRecordContext,
    input: unknown,
  ): Promise<T> {
    const context = validateRecordContext(expected),
      record = parseEncryptedVaultRecord(input);
    if (
      record.vaultId !== keys.vaultId ||
      record.keyVersion !== keys.keyVersion ||
      record.store !== context.store ||
      record.recordId !== context.recordId ||
      record.recordVersion !== context.recordVersion
    )
      throw new VaultCryptoError('AUTHENTICATION_FAILED');
    const bytes = await this.open(this.material(keys).encryption, recordContext(record), record);
    try {
      this.material(keys);
      return parseJson(bytes) as T;
    } finally {
      bytes.fill(0);
    }
  }
  private backupCryptography(keys: VaultKeys) {
    return {
      randomId: () => this.randomId(),
      check: () => {
        this.material(keys);
      },
      hash: async (bytes: Uint8Array) => {
        const digest = await this.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
        this.material(keys);
        return base64url(new Uint8Array(digest));
      },
      seal: async (context: readonly unknown[], bytes: Uint8Array) => {
        const sealed = await this.seal(this.material(keys).encryption, context, bytes);
        this.material(keys);
        return sealed;
      },
      open: async (context: readonly unknown[], sealed: SealedVaultBytes) => {
        const bytes = await this.open(this.material(keys).encryption, context, sealed);
        try {
          this.material(keys);
          return bytes;
        } catch (error) {
          bytes.fill(0);
          throw error;
        }
      },
    };
  }
  async encryptBackup(
    input: unknown,
    keys: VaultKeys,
    bytes: Uint8Array,
    options: { chunkSize?: number } = {},
  ): Promise<EncryptedVaultBackup> {
    const header = parseVaultHeader(input);
    await this.verifyHeader(header, keys);
    return encryptBackupContainer(this.backupCryptography(keys), header, bytes, options);
  }
  async decryptBackup(keys: VaultKeys, input: unknown): Promise<Uint8Array<ArrayBuffer>> {
    const backup = parseEncryptedVaultBackup(input);
    await this.verifyHeader(backup.header, keys);
    return decryptBackupContainer(this.backupCryptography(keys), backup);
  }
}

export { VaultCryptoError } from './vault-errors';
