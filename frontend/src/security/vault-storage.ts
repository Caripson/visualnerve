import { StorageError } from '../model/errors';
import {
  parseEncryptedVaultRecord,
  parseVaultHeader,
  type EncryptedVaultRecord,
  type VaultHeader,
  type VaultStore,
} from './vault-schema';

export class VaultStorageError extends StorageError {
  constructor(
    status: number,
    public code: string,
    message: string,
  ) {
    super(status, message);
    this.name = 'VaultStorageError';
  }
}

export interface VaultSessionPolicy {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
}
export const defaultVaultSessionPolicy: Readonly<VaultSessionPolicy> = Object.freeze({
  idleTimeoutMs: 15 * 60_000,
  absoluteTimeoutMs: 8 * 60 * 60_000,
});

export interface VaultLease {
  vaultId: string;
  keyVersion: number;
  epoch: number;
}

export interface VaultControl {
  id: 'control';
  header: VaultHeader;
  revision: number;
  epoch: number;
  locked: boolean;
  startedAt: number;
  lastActivityAt: number;
  policy: VaultSessionPolicy;
}

/** All identifiers and partition tokens are keyed opaque values, never logical IDs. */
export interface VaultPhysicalRecord {
  id: string;
  store: VaultStore;
  partitions: string[];
  revision: number;
  encrypted: EncryptedVaultRecord;
}
export type VaultMutation =
  | { kind: 'put'; record: VaultPhysicalRecord; expectedRevision: number }
  | { kind: 'delete'; id: string; expectedRevision: number };

export const VAULT_ROTATION_MAX_RECORDS = 100_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const invalid = (message: string): never => {
  throw new VaultStorageError(422, 'INVALID_VAULT_STORAGE', message);
};
const conflict = (): never => {
  throw new VaultStorageError(
    409,
    'VAULT_CONFLICT',
    'The encrypted workspace changed. Reload it before saving.',
  );
};
const locked = (): never => {
  throw new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );
};
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

export function validateVaultSessionPolicy(value: VaultSessionPolicy): VaultSessionPolicy {
  if (
    !value ||
    !positive(value.idleTimeoutMs) ||
    value.idleTimeoutMs < 60_000 ||
    value.idleTimeoutMs > 4 * 60 * 60_000 ||
    !positive(value.absoluteTimeoutMs) ||
    value.absoluteTimeoutMs < value.idleTimeoutMs ||
    value.absoluteTimeoutMs > 24 * 60 * 60_000
  )
    invalid('Use 1–240 minutes of inactivity and an absolute limit up to 24 hours.');
  return { idleTimeoutMs: value.idleTimeoutMs, absoluteTimeoutMs: value.absoluteTimeoutMs };
}

function timestamp(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) invalid('Invalid session timestamp.');
  return value;
}
function validateControl(value: unknown): VaultControl {
  if (!value || typeof value !== 'object') invalid('Invalid vault control record.');
  const control = value as VaultControl;
  if (
    control.id !== 'control' ||
    !positive(control.revision) ||
    !positive(control.epoch) ||
    typeof control.locked !== 'boolean'
  )
    invalid('Invalid vault control record.');
  if (control.lastActivityAt < control.startedAt) invalid('Invalid vault session chronology.');
  return {
    id: 'control',
    header: parseVaultHeader(control.header),
    revision: control.revision,
    epoch: control.epoch,
    locked: control.locked,
    startedAt: timestamp(control.startedAt),
    lastActivityAt: timestamp(control.lastActivityAt),
    policy: validateVaultSessionPolicy(control.policy),
  };
}

function validatePhysicalRecord(value: VaultPhysicalRecord): VaultPhysicalRecord {
  if (
    !value ||
    !tokenPattern.test(value.id) ||
    !positive(value.revision) ||
    !Array.isArray(value.partitions) ||
    value.partitions.length > 64 ||
    value.partitions.some((token) => typeof token !== 'string' || !tokenPattern.test(token)) ||
    new Set(value.partitions).size !== value.partitions.length
  )
    invalid('Invalid encrypted record metadata.');
  const encrypted = parseEncryptedVaultRecord(value.encrypted);
  if (
    encrypted.store !== value.store ||
    encrypted.recordId !== value.id ||
    encrypted.recordVersion !== value.revision
  )
    invalid('Encrypted record context does not match its physical identity.');
  return {
    id: value.id,
    store: value.store,
    partitions: [...value.partitions],
    revision: value.revision,
    encrypted,
  };
}

function expired(control: VaultControl, now: number) {
  return (
    now < control.lastActivityAt ||
    now - control.lastActivityAt >= control.policy.idleTimeoutMs ||
    now - control.startedAt >= control.policy.absoluteTimeoutMs
  );
}
function assertLease(control: VaultControl, lease: VaultLease, now: number) {
  if (
    control.locked ||
    control.epoch !== lease.epoch ||
    control.header.vaultId !== lease.vaultId ||
    control.header.keyVersion !== lease.keyVersion ||
    expired(control, now)
  )
    locked();
}
function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed.'));
  });
}

/**
 * The only durable encrypted-record boundary. Crypto and model validation must
 * finish before commit(); its native transactions perform IDB work exclusively.
 * No plaintext working database or decrypted content index is created here.
 */
export class VaultRecordStorage {
  private connection?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;
  constructor(
    readonly name = 'visual-nerve-vault',
    private factory: IDBFactory = indexedDB,
    private now: () => number = Date.now,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = this.factory.open(this.name, 1);
      let failed = false;
      opening.onupgradeneeded = () => {
        const db = opening.result;
        db.createObjectStore('metadata', { keyPath: 'id' });
        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('store', 'store');
        records.createIndex('partitions', 'partitions', { multiEntry: true });
      };
      opening.onerror = () => {
        failed = true;
        reject(opening.error ?? new Error('Unable to open the encrypted workspace.'));
      };
      opening.onblocked = () => {
        failed = true;
        reject(
          new VaultStorageError(
            409,
            'VAULT_UPGRADE_BLOCKED',
            'Close older workspace tabs before continuing.',
          ),
        );
      };
      opening.onsuccess = () => {
        const db = opening.result;
        if (failed) return db.close();
        db.onversionchange = () => this.close();
        this.connection = db;
        resolve(db);
      };
    }).finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  close() {
    this.connection?.close();
    this.connection = undefined;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['metadata', 'records'], mode);
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error('Encrypted workspace transaction aborted.'));
      tx.onerror = () => {
        failure ??= tx.error;
      };
      void work(tx).then(
        (value) => {
          result = value;
        },
        (error) => {
          failure = error;
          try {
            tx.abort();
          } catch {
            reject(error);
          }
        },
      );
    });
  }

  /** Contains technical control metadata only, and is safe to inspect while locked. */
  async control(): Promise<VaultControl | undefined> {
    return this.transaction('readonly', async (tx) => {
      const value = await request(tx.objectStore('metadata').get('control'));
      return value === undefined ? undefined : validateControl(value);
    });
  }

  /** Called only after password setup has generated authenticated key envelopes. */
  async create(header: VaultHeader, policy = defaultVaultSessionPolicy) {
    const checked = parseVaultHeader(header);
    const chosen = validateVaultSessionPolicy(policy);
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      if ((await request(metadata.get('control'))) !== undefined) conflict();
      if ((await request(tx.objectStore('records').count())) !== 0)
        invalid('Encrypted records exist without a valid vault header.');
      const control: VaultControl = {
        id: 'control',
        header: checked,
        revision: 1,
        epoch: 1,
        locked: true,
        startedAt: 0,
        lastActivityAt: 0,
        policy: chosen,
      };
      await request(metadata.add(control));
      return control;
    });
  }

  /** The caller must authenticate the header with local Web Crypto first. */
  async beginSession(
    authenticatedHeader: VaultHeader,
    expectedEpoch?: number,
  ): Promise<VaultLease> {
    const header = parseVaultHeader(authenticatedHeader);
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      const control = validateControl(await request(metadata.get('control')));
      if (JSON.stringify(header) !== JSON.stringify(control.header)) conflict();
      if (expectedEpoch !== undefined && control.epoch !== expectedEpoch) conflict();
      const now = timestamp(this.now());
      if (control.locked || expired(control, now)) {
        control.epoch++;
        control.locked = false;
        control.startedAt = now;
        control.lastActivityAt = now;
        control.revision++;
        await request(metadata.put(control));
      }
      return { vaultId: header.vaultId, keyVersion: header.keyVersion, epoch: control.epoch };
    });
  }

  async check(lease: VaultLease): Promise<VaultControl> {
    return this.transaction('readonly', async (tx) => {
      const control = validateControl(await request(tx.objectStore('metadata').get('control')));
      assertLease(control, lease, timestamp(this.now()));
      return control;
    });
  }
  /** Browser settings only. Changing limits never renews the session clock. */
  async setPolicy(lease: VaultLease, policy: VaultSessionPolicy, expectedRevision: number) {
    const chosen = validateVaultSessionPolicy(policy);
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      const control = validateControl(await request(metadata.get('control')));
      const now = timestamp(this.now());
      assertLease(control, lease, now);
      if (control.revision !== expectedRevision) conflict();
      control.policy = chosen;
      control.revision++;
      if (expired(control, now)) {
        control.locked = true;
        control.epoch++;
      }
      await request(metadata.put(control));
      return control;
    });
  }

  /** Human interaction only: API traffic and animation must never call this. */
  async activity(lease: VaultLease) {
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      const control = validateControl(await request(metadata.get('control')));
      const now = timestamp(this.now());
      assertLease(control, lease, now);
      control.lastActivityAt = now;
      await request(metadata.put(control));
    });
  }

  async lock(
    lease?: VaultLease,
    expectedControlRevision?: number,
    authorizeCurrent?: () => void,
  ): Promise<VaultControl> {
    if (expectedControlRevision !== undefined && (!lease || !positive(expectedControlRevision)))
      invalid('A guarded lock requires its originating lease and revision.');
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      const control = validateControl(await request(metadata.get('control')));
      if (expectedControlRevision !== undefined) {
        // Integration authorization was read against this exact revision. A
        // concurrent permission/content/session change must win before locking.
        assertLease(control, lease!, timestamp(this.now()));
        if (control.revision !== expectedControlRevision) conflict();
        // Pure synchronous caller checks only; never await crypto or application
        // work inside IDB. This also honors an immediate local permission ceiling
        // before its asynchronous encrypted Settings write has committed.
        authorizeCurrent?.();
      }
      // A delayed expiry callback from an older session cannot revoke a new one.
      if (
        lease &&
        (control.epoch !== lease.epoch ||
          control.header.vaultId !== lease.vaultId ||
          control.header.keyVersion !== lease.keyVersion)
      )
        return control;
      if (!control.locked || lease === undefined) {
        control.locked = true;
        control.epoch++;
        control.revision++;
        await request(metadata.put(control));
      }
      return control;
    });
  }

  async read(lease: VaultLease, ids: string[]): Promise<Array<VaultPhysicalRecord | undefined>> {
    if (ids.some((id) => !tokenPattern.test(id))) invalid('Invalid encrypted record identifier.');
    return this.transaction('readonly', async (tx) => {
      const control = validateControl(await request(tx.objectStore('metadata').get('control')));
      assertLease(control, lease, timestamp(this.now()));
      const records = tx.objectStore('records');
      return Promise.all(
        ids.map(async (id) => {
          const value = await request(records.get(id));
          return value === undefined ? undefined : validatePhysicalRecord(value);
        }),
      );
    });
  }

  async select(
    lease: VaultLease,
    selector: { store: VaultStore } | { partition: string },
    maximumRecords?: number,
  ): Promise<VaultPhysicalRecord[]> {
    if ('partition' in selector && !tokenPattern.test(selector.partition))
      invalid('Invalid encrypted partition.');
    if (
      maximumRecords !== undefined &&
      (!Number.isSafeInteger(maximumRecords) ||
        maximumRecords < 0 ||
        maximumRecords > VAULT_ROTATION_MAX_RECORDS)
    )
      invalid('Invalid encrypted snapshot record limit.');
    return this.transaction('readonly', async (tx) => {
      const control = validateControl(await request(tx.objectStore('metadata').get('control')));
      assertLease(control, lease, timestamp(this.now()));
      const records = tx.objectStore('records');
      if (maximumRecords !== undefined) {
        const count =
          'partition' in selector
            ? await request(records.index('partitions').count(selector.partition))
            : await request(records.index('store').count(selector.store));
        if (count > maximumRecords)
          throw new VaultStorageError(
            413,
            'VAULT_ROTATION_LIMIT',
            'Content-key rotation exceeds its supported record limit. The original workspace remains unchanged.',
          );
      }
      const values =
        'partition' in selector
          ? await request(records.index('partitions').getAll(selector.partition))
          : await request(records.index('store').getAll(selector.store));
      return values.map(validatePhysicalRecord);
    });
  }

  /** Prepared ciphertext and optimistic versions are committed atomically. */
  async commit(
    lease: VaultLease,
    mutations: VaultMutation[],
    expectedControlRevision?: number,
  ): Promise<number> {
    if (
      expectedControlRevision !== undefined &&
      (!Number.isSafeInteger(expectedControlRevision) || expectedControlRevision < 1)
    )
      invalid('Invalid expected vault revision.');
    const prepared = mutations.map((mutation): VaultMutation => {
      if (!Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision < 0)
        invalid('Invalid expected encrypted-record revision.');
      if (mutation.kind === 'put')
        return { ...mutation, record: validatePhysicalRecord(mutation.record) };
      if (mutation.kind !== 'delete' || !tokenPattern.test(mutation.id))
        invalid('Invalid encrypted-record mutation.');
      return { ...mutation };
    });
    const ids = prepared.map((mutation) =>
      mutation.kind === 'put' ? mutation.record.id : mutation.id,
    );
    if (new Set(ids).size !== ids.length)
      invalid('A record may change only once in a transaction.');
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      const control = validateControl(await request(metadata.get('control')));
      assertLease(control, lease, timestamp(this.now()));
      const records = tx.objectStore('records');
      // Check the entire batch before queuing any durable mutation.
      if (expectedControlRevision !== undefined && control.revision !== expectedControlRevision)
        conflict();
      const existing = await Promise.all(ids.map((id) => request(records.get(id))));
      for (const [index, mutation] of prepared.entries()) {
        const current =
          existing[index] === undefined ? undefined : validatePhysicalRecord(existing[index]);
        if ((current?.revision ?? 0) !== mutation.expectedRevision) conflict();
        if (mutation.kind === 'put') {
          if (
            mutation.record.revision !== mutation.expectedRevision + 1 ||
            mutation.record.encrypted.vaultId !== control.header.vaultId ||
            mutation.record.encrypted.keyVersion !== control.header.keyVersion ||
            (current && current.store !== mutation.record.store)
          )
            invalid('Invalid encrypted-record revision or vault context.');
        }
      }
      assertLease(control, lease, timestamp(this.now()));
      for (const mutation of prepared) {
        if (mutation.kind === 'put') records.put(mutation.record);
        else records.delete(mutation.id);
      }
      if (prepared.length) {
        control.revision++;
        metadata.put(control);
      }
      return control.revision;
    });
  }

  /** Complete prepared ciphertext activation; no cryptography runs in the native transaction. */
  async activateContentKey(
    lease: VaultLease,
    header: VaultHeader,
    records: readonly VaultPhysicalRecord[],
    expectedControlRevision: number,
    signal: AbortSignal,
    assertCurrent: () => void,
  ): Promise<VaultControl> {
    if (signal.aborted) return locked();
    assertCurrent();
    const replacement = parseVaultHeader(header);
    if (
      !positive(expectedControlRevision) ||
      !Array.isArray(records) ||
      records.length > VAULT_ROTATION_MAX_RECORDS
    )
      invalid('Invalid complete content-key activation.');
    const prepared = records.map(validatePhysicalRecord);
    if (
      new Set(prepared.map((record) => record.id)).size !== prepared.length ||
      prepared.some(
        (record) =>
          record.revision !== 1 ||
          record.encrypted.vaultId !== replacement.vaultId ||
          record.encrypted.keyVersion !== replacement.keyVersion,
      )
    )
      invalid('Invalid rotated encrypted-record context.');
    let cancelled = false;
    try {
      return await this.transaction('readwrite', async (tx) => {
        const abort = () => {
          cancelled = true;
          try {
            tx.abort();
          } catch {
            /* Already committed/aborted. */
          }
        };
        const cleanup = () => signal.removeEventListener('abort', abort);
        signal.addEventListener('abort', abort, { once: true });
        tx.addEventListener('complete', cleanup, { once: true });
        tx.addEventListener('abort', cleanup, { once: true });
        if (signal.aborted) {
          abort();
          return locked();
        }
        const metadata = tx.objectStore('metadata');
        const control = validateControl(await request(metadata.get('control')));
        assertLease(control, lease, timestamp(this.now()));
        if (control.revision !== expectedControlRevision) conflict();
        if (
          replacement.vaultId !== control.header.vaultId ||
          replacement.keyVersion !== control.header.keyVersion + 1
        )
          invalid(
            'Content-key activation must advance the existing vault by exactly one key version.',
          );
        assertCurrent();
        if (signal.aborted) return locked();
        // Keep the policy and technical identity; revoke every old-key tab/lease atomically.
        control.header = replacement;
        control.locked = true;
        control.epoch++;
        control.revision++;
        const target = tx.objectStore('records');
        target.clear();
        for (const record of prepared) target.put(record);
        metadata.put(control);
        return control;
      });
    } catch (error) {
      if (cancelled || signal.aborted) return locked();
      throw error;
    }
  }

  /** Rewrap-only password/recovery changes; content-key rotation needs a migration. */
  async replaceHeader(lease: VaultLease, header: VaultHeader, expectedControlRevision: number) {
    const replacement = parseVaultHeader(header);
    return this.transaction('readwrite', async (tx) => {
      const metadata = tx.objectStore('metadata');
      const control = validateControl(await request(metadata.get('control')));
      assertLease(control, lease, timestamp(this.now()));
      if (control.revision !== expectedControlRevision) conflict();
      if (
        replacement.vaultId !== control.header.vaultId ||
        replacement.keyVersion !== control.header.keyVersion
      )
        invalid('Content-key rotation requires an authenticated record migration.');
      control.header = replacement;
      control.locked = true;
      control.epoch++;
      control.revision++;
      await request(metadata.put(control));
      return control;
    });
  }
}
