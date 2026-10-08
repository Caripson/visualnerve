import { vi } from 'vitest';
import { LegacyWorkspaceStorage, type WorkspaceDatabase } from '../src/storage/database';
import type { WorkspaceScope } from '../src/storage/contracts';

type SettingWrite = (
  storage: LegacyWorkspaceStorage,
  work: (scope: WorkspaceScope) => Promise<unknown>,
) => Promise<unknown>;
const hooks = new WeakMap<WorkspaceDatabase, ReturnType<typeof vi.fn<SettingWrite>>>();

/** Hold/fail preparation before opening a native transaction, retaining the bound session. */
export function settingWrites(db: WorkspaceDatabase) {
  const existing = hooks.get(db);
  if (existing) return existing;
  const atomic = LegacyWorkspaceStorage.prototype.atomic;
  const writes = vi.fn<SettingWrite>((storage, work) =>
    atomic.call(storage, 'rw', ['settings'], work),
  );
  hooks.set(db, writes);
  vi.spyOn(LegacyWorkspaceStorage.prototype, 'atomic').mockImplementation(function <T>(
    this: LegacyWorkspaceStorage,
    mode: 'r' | 'rw',
    stores: readonly import('../src/storage/contracts').WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    if (
      this.name === db.name &&
      !this.inTransaction &&
      mode === 'rw' &&
      stores.length === 1 &&
      stores[0] === 'settings'
    )
      return writes(this, work) as Promise<T>;
    return atomic.call(this, mode, stores, work) as Promise<T>;
  });
  return writes;
}

/** Delay publication of a completed native read, so real writers can finish meanwhile. */
export function holdRefreshRead(db: WorkspaceDatabase) {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const atomic = LegacyWorkspaceStorage.prototype.atomic;
  let held = false;
  vi.spyOn(LegacyWorkspaceStorage.prototype, 'atomic').mockImplementation(async function <T>(
    this: LegacyWorkspaceStorage,
    mode: 'r' | 'rw',
    stores: readonly import('../src/storage/contracts').WorkspaceStoreName[],
    work: (scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    const result = (await atomic.call(this, mode, stores, work)) as T;
    if (
      !held &&
      this.name === db.name &&
      !this.inTransaction &&
      mode === 'r' &&
      stores.join(',') === 'diagrams,owners,settings'
    ) {
      held = true;
      enter();
      await paused;
    }
    return result;
  });
  return { entered, release };
}
