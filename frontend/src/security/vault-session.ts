import {
  createPreparedVaultKeyRotation,
  type PreparedVaultKeyRotation,
  type VaultKeyRotationOptions,
} from './vault-key-rotation';
import { VaultCrypto, type VaultKeys } from './vault-crypto';
import type { VaultHeader } from './vault-schema';
import { withVaultTransaction } from './vault-coordination';
import {
  VaultRecordStorage,
  VaultStorageError,
  type VaultControl,
  type VaultLease,
  type VaultSessionPolicy,
} from './vault-storage';

export type VaultSessionStatus = 'uninitialized' | 'locked' | 'unlocking' | 'unlocked';
export interface VaultSessionSnapshot {
  status: VaultSessionStatus;
  vaultId?: string;
  keyVersion?: number;
  epoch?: number;
  idleExpiresAt?: number;
  absoluteExpiresAt?: number;
}
type Cleanup = () => void | Promise<void>;
export interface VaultSessionContext {
  readonly keys: VaultKeys;
  readonly lease: VaultLease;
  readonly signal: AbortSignal;
}
/** Internal revocable capability for work that outlives a single storage transaction. */
export interface VaultSessionOperation {
  readonly signal: AbortSignal;
  check(): Promise<void>;
  assertActive(): void;
  run<T>(work: (context: VaultSessionContext) => Promise<T>): Promise<T>;
  dispose(): void;
}
const lockedError = () =>
  new VaultStorageError(
    423,
    'WORKSPACE_LOCKED',
    'Unlock the workspace in the browser to continue.',
  );

/**
 * Browser-only authentication boundary. Consumers get revocable operation leases,
 * not a persisted password, serializable key, or a programmatic unlock endpoint.
 * Each tab owns its own keys; only revocation metadata crosses tab boundaries.
 */
export class VaultSession {
  private keys?: VaultKeys;
  private lease?: VaultLease;
  private generation = 0;
  private pending = new AbortController();
  private snapshot: Readonly<VaultSessionSnapshot> = Object.freeze({ status: 'uninitialized' });
  private listeners = new Set<() => void>();
  private cleanups = new Set<Cleanup>();
  private channel?: BroadcastChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private removeEvents?: () => void;
  private activityPending?: Promise<void>;
  private locking?: Promise<void>;
  private quiescing: Promise<void> = Promise.resolve();
  private activityAt = -Infinity;
  private disposed = false;

  constructor(
    readonly storage: VaultRecordStorage,
    private crypto = new VaultCrypto(),
    private now: () => number = Date.now,
  ) {}

  getSnapshot = () => this.snapshot;
  assertUnlocked() {
    if (!this.keys || !this.lease || this.snapshot.status !== 'unlocked') throw lockedError();
    // This synchronous guard checks local capability ownership only. A suspended
    // tab may have stale activity/policy deadlines while another tab is active.
    // Acquisition and every private operation await verify(), whose native lease
    // check enforces the authoritative idle AND absolute deadline before/after
    // work. Never globally revoke a shared session from cached UI timestamps.
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  onLock(cleanup: Cleanup) {
    this.cleanups.add(cleanup);
    return () => {
      this.cleanups.delete(cleanup);
    };
  }
  async captureOperation(parentSignal?: AbortSignal): Promise<VaultSessionOperation> {
    const generation = this.generation;
    const keys = this.keys,
      lease = this.lease,
      sessionSignal = this.pending.signal;
    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort(lockedError());
    sessionSignal.addEventListener('abort', abort, { once: true });
    parentSignal?.addEventListener('abort', abort, { once: true });
    if (sessionSignal.aborted || parentSignal?.aborted) abort();
    const dispose = () => {
      sessionSignal.removeEventListener('abort', abort);
      parentSignal?.removeEventListener('abort', abort);
      abort();
    };
    const assert = () => {
      this.assertUnlocked();
      if (
        signal.aborted ||
        generation !== this.generation ||
        keys !== this.keys ||
        lease !== this.lease ||
        !keys ||
        !lease ||
        this.snapshot.status !== 'unlocked'
      )
        throw lockedError();
    };
    const check = async () => {
      assert();
      await this.verify();
      assert();
    };
    try {
      await check();
    } catch (error) {
      dispose();
      throw error;
    }
    return {
      signal,
      check,
      assertActive: assert,
      dispose,
      run: async <T>(work: (context: VaultSessionContext) => Promise<T>) => {
        await check();
        try {
          const result = await work({ keys: keys!, lease: lease!, signal });
          await check();
          return result;
        } catch (error) {
          assert();
          await check();
          throw error;
        }
      },
    };
  }
  private publish(value: VaultSessionSnapshot) {
    this.snapshot = Object.freeze(value);
    for (const listener of this.listeners) listener();
  }
  private publishControl(control: VaultControl) {
    this.publish({
      status: 'unlocked',
      vaultId: control.header.vaultId,
      keyVersion: control.header.keyVersion,
      epoch: control.epoch,
      idleExpiresAt: control.lastActivityAt + control.policy.idleTimeoutMs,
      absoluteExpiresAt: control.startedAt + control.policy.absoluteTimeoutMs,
    });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.snapshot.status !== 'unlocked') return;
    const deadline = Math.min(this.snapshot.idleExpiresAt!, this.snapshot.absoluteExpiresAt!);
    this.timer = setTimeout(
      () => {
        void this.verify().catch(() => undefined);
      },
      Math.max(1, Math.min(30_000, deadline - this.now())),
    );
  }
  private listen() {
    if (!this.channel && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`visualnerve-vault:${this.storage.name}`);
      this.channel.onmessage = (event: MessageEvent) => {
        const value = event.data;
        if (value?.type === 'policy-updated' && this.lease && value.vaultId === this.lease.vaultId)
          void this.verify().catch(() => undefined);
        if (
          value?.type === 'revoked' &&
          this.lease &&
          value.vaultId === this.lease.vaultId &&
          Number.isSafeInteger(value.epoch) &&
          value.epoch > this.lease.epoch
        )
          void this.invalidate().catch(() => undefined);
      };
    }
    if (!this.removeEvents && typeof document !== 'undefined') {
      const activity = (event: Event) => {
        if (event.isTrusted) void this.recordHumanActivity().catch(() => undefined);
      };
      const verify = () => {
        void this.verify().catch(() => undefined);
      };
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
        document.addEventListener(name, activity, { passive: true });
      document.addEventListener('visibilitychange', verify);
      window.addEventListener('focus', verify);
      this.removeEvents = () => {
        for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
          document.removeEventListener(name, activity);
        document.removeEventListener('visibilitychange', verify);
        window.removeEventListener('focus', verify);
      };
    }
  }
  async initialize() {
    await this.locking;
    await this.quiescing;
    if (this.disposed) throw lockedError();
    if (this.keys) {
      await this.verify();
      return this.snapshot;
    }
    this.listen();
    const control = await this.storage.control();
    this.publish(
      control
        ? {
            status: 'locked',
            vaultId: control.header.vaultId,
            keyVersion: control.header.keyVersion,
            epoch: control.epoch,
          }
        : { status: 'uninitialized' },
    );
    return this.snapshot;
  }

  private attempt() {
    if (this.disposed || this.keys) throw lockedError();
    const generation = ++this.generation;
    this.publish({ ...this.snapshot, status: 'unlocking' });
    return generation;
  }
  private assertAttempt(generation: number) {
    if (this.disposed || generation !== this.generation) throw lockedError();
  }
  private async activate(
    header: VaultHeader,
    keys: VaultKeys,
    generation: number,
    expectedEpoch: number,
  ) {
    try {
      this.assertAttempt(generation);
      const lease = await this.storage.beginSession(header, expectedEpoch);
      if (this.disposed || generation !== this.generation) {
        await this.storage.lock(lease);
        throw lockedError();
      }
      this.keys = keys;
      this.lease = lease;
      this.pending = new AbortController();
      this.activityAt = -Infinity;
      const control = await this.storage.check(lease);
      this.assertAttempt(generation);
      this.listen();
      this.publishControl(control);
    } catch (error) {
      this.crypto.destroyKeys(keys);
      if (this.keys === keys) this.keys = undefined;
      throw error;
    }
  }
  private async failedAttempt(generation: number) {
    if (generation !== this.generation || this.disposed) return;
    const control = await this.storage.control();
    if (generation !== this.generation || this.disposed) return;
    this.publish(
      control
        ? {
            status: 'locked',
            vaultId: control.header.vaultId,
            keyVersion: control.header.keyVersion,
            epoch: control.epoch,
          }
        : { status: 'uninitialized' },
    );
  }

  /** Called by the first-visit password form, never an API/MCP command. */
  async setup(password: string, policy?: VaultSessionPolicy): Promise<{ recoveryKey: string }> {
    await this.locking;
    await this.quiescing;
    const generation = this.attempt();
    let created: Awaited<ReturnType<VaultCrypto['createVault']>> | undefined;
    try {
      if (await this.storage.control())
        throw new VaultStorageError(409, 'VAULT_EXISTS', 'This workspace already has a password.');
      created = await this.crypto.createVault(password);
      this.assertAttempt(generation);
      const control = await this.storage.create(created.header, policy);
      await this.activate(created.header, created.keys, generation, control.epoch);
      this.assertAttempt(generation);
      return { recoveryKey: created.recoveryKey };
    } catch (error) {
      if (created) this.crypto.destroyKeys(created.keys);
      await this.failedAttempt(generation);
      throw error;
    }
  }

  /** Human password form only; callers must not retain the supplied password. */
  async unlock(password: string) {
    await this.locking;
    await this.quiescing;
    const generation = this.attempt();
    try {
      const control = await this.storage.control();
      if (!control)
        throw new VaultStorageError(409, 'VAULT_NOT_CREATED', 'Set a workspace password first.');
      const keys = await this.crypto.unlockWithPassword(control.header, password);
      await this.activate(control.header, keys, generation, control.epoch);
    } catch (error) {
      await this.failedAttempt(generation);
      throw error;
    }
  }

  /** Local recovery form rewraps the current vault, then requires normal unlocking. */
  async recover(recoveryKey: string, newPassword: string): Promise<{ recoveryKey: string }> {
    await this.locking;
    await this.quiescing;
    const generation = this.attempt();
    let keys: VaultKeys | undefined;
    try {
      const control = await this.storage.control();
      if (!control)
        throw new VaultStorageError(409, 'VAULT_NOT_CREATED', 'No encrypted workspace exists.');
      keys = await this.crypto.unlockWithRecovery(control.header, recoveryKey);
      const passwordChanged = await this.crypto.changePassword(control.header, keys, newPassword);
      const replacement = await this.crypto.changeRecovery(passwordChanged, keys);
      this.assertAttempt(generation);
      return await withVaultTransaction(this.storage.name, this.pending.signal, async () => {
        this.assertAttempt(generation);
        const lease = await this.storage.beginSession(control.header, control.epoch);
        this.assertAttempt(generation);
        const current = await this.storage.check(lease);
        this.assertAttempt(generation);
        const updated = await this.storage.replaceHeader(
          lease,
          replacement.header,
          current.revision,
        );
        this.assertAttempt(generation);
        this.channel?.postMessage({
          type: 'revoked',
          vaultId: updated.header.vaultId,
          epoch: updated.epoch,
        });
        const invalidatedGeneration = await this.invalidate(generation);
        if (invalidatedGeneration === undefined) throw lockedError();
        this.assertAttempt(invalidatedGeneration);
        return { recoveryKey: replacement.recoveryKey };
      });
    } catch (error) {
      await this.failedAttempt(generation);
      throw error;
    } finally {
      if (keys) this.crypto.destroyKeys(keys);
    }
  }

  /** Every private operation checks durable revocation before and after its work. */
  async withUnlocked<T>(
    operation: (context: { keys: VaultKeys; lease: VaultLease; signal: AbortSignal }) => Promise<T>,
  ): Promise<T> {
    const generation = this.generation;
    const keys = this.keys,
      lease = this.lease;
    if (!keys || !lease || this.snapshot.status !== 'unlocked') throw lockedError();
    await this.verify();
    if (generation !== this.generation || keys !== this.keys) throw lockedError();
    let value: T;
    try {
      value = await operation({ keys, lease, signal: this.pending.signal });
    } catch (error) {
      if (
        generation !== this.generation ||
        keys !== this.keys ||
        this.snapshot.status !== 'unlocked'
      )
        throw lockedError();
      await this.verify();
      throw error;
    }
    await this.verify();
    if (generation !== this.generation || keys !== this.keys) throw lockedError();
    return value;
  }

  async verify() {
    const generation = this.generation,
      lease = this.lease,
      keys = this.keys;
    if (!keys || !lease || this.snapshot.status !== 'unlocked') throw lockedError();
    try {
      const control = await this.storage.check(lease);
      if (
        generation !== this.generation ||
        keys !== this.keys ||
        lease !== this.lease ||
        this.snapshot.status !== 'unlocked'
      )
        throw lockedError();
      this.publishControl(control);
      return control;
    } catch (error) {
      if (generation === this.generation) {
        await this.invalidate();
        if (error instanceof VaultStorageError && error.code === 'WORKSPACE_LOCKED') {
          const updated = await this.storage.lock(lease);
          this.channel?.postMessage({
            type: 'revoked',
            vaultId: updated.header.vaultId,
            epoch: updated.epoch,
          });
        }
      }
      throw error;
    }
  }

  /** Only trusted UI event handlers call this; content requests do not keep a session alive. */
  async recordHumanActivity() {
    if (!this.keys || !this.lease) return;
    if (this.activityPending) return this.activityPending;
    if (this.now() - this.activityAt < 1000) return;
    const lease = this.lease,
      generation = this.generation;
    this.activityPending = this.storage
      .activity(lease)
      .then(async () => {
        if (generation !== this.generation) return;
        this.activityAt = this.now();
        await this.verify();
      })
      .catch(async (error: unknown) => {
        if (generation === this.generation) await this.invalidate();
        throw error;
      })
      .finally(() => {
        this.activityPending = undefined;
      });
    return this.activityPending;
  }

  private async invalidate(expectedGeneration = this.generation): Promise<number | undefined> {
    if (expectedGeneration !== this.generation) return undefined;
    const invalidatedGeneration = ++this.generation;
    clearTimeout(this.timer);
    const keys = this.keys;
    this.keys = undefined;
    this.lease = undefined;
    if (keys) this.crypto.destroyKeys(keys);
    this.publish({
      status: 'locked',
      vaultId: this.snapshot.vaultId,
      keyVersion: this.snapshot.keyVersion,
      epoch: this.snapshot.epoch,
    });
    // Abort callbacks may synchronously try another operation. Revoke capabilities
    // and publish the locked state before dispatching those callbacks.
    this.pending.abort(lockedError());
    // One failing cleanup must never prevent the others or retain usable keys.
    const cleanup = Promise.allSettled(
      [...this.cleanups].map((owner) => Promise.resolve().then(owner)),
    ).then(() => undefined);
    this.quiescing = Promise.all([this.quiescing, cleanup]).then(() => undefined);
    await this.quiescing;
    return invalidatedGeneration;
  }

  lock(): Promise<void> {
    if (this.locking) return this.locking;
    // Invalidate synchronously before waiting for a native lock transaction.
    const cleanup = this.invalidate();
    this.locking = (async () => {
      const control = await this.storage.control();
      if (control) {
        const updated = await this.storage.lock();
        this.channel?.postMessage({
          type: 'revoked',
          vaultId: updated.header.vaultId,
          epoch: updated.epoch,
        });
        this.publish({
          status: 'locked',
          vaultId: updated.header.vaultId,
          keyVersion: updated.header.keyVersion,
          epoch: updated.epoch,
        });
      }
      await cleanup;
    })().finally(() => {
      this.locking = undefined;
    });
    return this.locking;
  }

  /** Internal integration action after a fresh consent/write-grant snapshot.
   * Guarded revocation commits before local invalidation, so a losing grant race
   * cannot lock a newly unlocked session or even discard its local keys.
   */
  async lockAuthorized(
    expectedRevision: number,
    parentSignal: AbortSignal,
    authorizeCurrent?: () => void,
  ): Promise<void> {
    const operation = await this.captureOperation(parentSignal);
    try {
      await operation.check();
      const generation = this.generation,
        lease = this.lease!;
      const updated = await this.storage.lock(lease, expectedRevision, () => {
        operation.assertActive();
        authorizeCurrent?.();
      });
      this.channel?.postMessage({
        type: 'revoked',
        vaultId: updated.header.vaultId,
        epoch: updated.epoch,
      });
      // Another local observer may already have noticed durable revocation.
      // An obsolete action must never invalidate a later human unlock.
      if (generation === this.generation) {
        const invalidatedGeneration = await this.invalidate(generation);
        if (invalidatedGeneration !== undefined && this.generation === invalidatedGeneration)
          this.publish({
            status: 'locked',
            vaultId: updated.header.vaultId,
            keyVersion: updated.header.keyVersion,
            epoch: updated.epoch,
          });
      }
    } finally {
      operation.dispose();
    }
  }

  prepareContentKeyRotation(
    newPassword: string,
    options: VaultKeyRotationOptions = {},
  ): Promise<PreparedVaultKeyRotation> {
    return createPreparedVaultKeyRotation(this, this.crypto, newPassword, options);
  }

  /** Called only after complete canonical activation. Never revokes a later human unlock. */
  async completeContentKeyRotation(control: VaultControl): Promise<void> {
    if (!control.locked)
      throw new VaultStorageError(
        422,
        'INVALID_VAULT_STORAGE',
        'Content-key activation must lock its canonical vault.',
      );
    try {
      this.channel?.postMessage({
        type: 'revoked',
        vaultId: control.header.vaultId,
        epoch: control.epoch,
      });
    } catch {
      /* Durable revocation still wins if the notification transport is unavailable. */
    }
    const lease = this.lease;
    if (
      !lease ||
      lease.vaultId !== control.header.vaultId ||
      lease.keyVersion + 1 !== control.header.keyVersion ||
      lease.epoch + 1 !== control.epoch
    )
      return;
    const generation = this.generation;
    const invalidatedGeneration = await this.invalidate(generation);
    if (invalidatedGeneration !== undefined && this.generation === invalidatedGeneration)
      this.publish({
        status: 'locked',
        vaultId: control.header.vaultId,
        keyVersion: control.header.keyVersion,
        epoch: control.epoch,
      });
  }

  async changePassword(newPassword: string, currentPassword?: string) {
    const operation = await this.captureOperation();
    try {
      return await withVaultTransaction(this.storage.name, operation.signal, async () => {
        await operation.check();
        const generation = this.generation;
        const control = await this.verify();
        const keys = this.keys!,
          lease = this.lease!;
        if (currentPassword !== undefined) {
          const checkedKeys = await this.crypto.unlockWithPassword(control.header, currentPassword);
          this.crypto.destroyKeys(checkedKeys);
          if (generation !== this.generation || keys !== this.keys) throw lockedError();
        }
        const header = await this.crypto.changePassword(control.header, keys, newPassword);
        if (generation !== this.generation || keys !== this.keys) throw lockedError();
        const updated = await this.storage.replaceHeader(lease, header, control.revision);
        if (generation !== this.generation || keys !== this.keys) throw lockedError();
        this.channel?.postMessage({
          type: 'revoked',
          vaultId: updated.header.vaultId,
          epoch: updated.epoch,
        });
        const invalidatedGeneration = await this.invalidate(generation);
        if (invalidatedGeneration === undefined) throw lockedError();
        this.assertAttempt(invalidatedGeneration);
      });
    } finally {
      operation.dispose();
    }
  }
  async getPolicy(): Promise<VaultSessionPolicy> {
    return { ...(await this.verify()).policy };
  }
  async setPolicy(policy: VaultSessionPolicy) {
    const operation = await this.captureOperation();
    try {
      return await withVaultTransaction(this.storage.name, operation.signal, async () => {
        await operation.check();
        const generation = this.generation;
        const control = await this.verify();
        const lease = this.lease!,
          keys = this.keys!;
        const updated = await this.storage.setPolicy(lease, policy, control.revision);
        if (generation !== this.generation || keys !== this.keys) throw lockedError();
        this.channel?.postMessage({
          type: updated.locked ? 'revoked' : 'policy-updated',
          vaultId: updated.header.vaultId,
          epoch: updated.epoch,
        });
        if (updated.locked) await this.invalidate(generation);
        else this.publishControl(updated);
      });
    } finally {
      operation.dispose();
    }
  }

  async dispose() {
    this.disposed = true;
    await this.invalidate();
    await this.locking;
    this.removeEvents?.();
    this.removeEvents = undefined;
    this.channel?.close();
    this.channel = undefined;
    this.listeners.clear();
    this.storage.close();
  }
}
