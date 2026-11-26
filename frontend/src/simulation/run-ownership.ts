import type { SimulationState } from './types';

const prefix = 'visualnerve-simulation-run:';
const pausedSuffix = ':paused';
type ActiveStatus = 'running' | 'paused';

export function canHaveWorker(status: SimulationState['status']) {
  return status === 'running' || status === 'paused' || status === 'ready';
}

function lockManager() {
  return typeof navigator === 'undefined' ? undefined : navigator.locks;
}

interface HeldLock {
  release(): void;
  released: Promise<void>;
}

function hold(locks: LockManager, name: string): Promise<HeldLock | undefined> {
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const lifetime = new Promise<void>((done) => {
      release = done;
    });
    const released = locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(undefined);
        resolve({ release, released });
        return lifetime;
      })
      .then(() => {});
    void released.catch(reject);
  });
}

export interface RunOwnership {
  setPaused(paused: boolean): Promise<void>;
  release(): void;
}

/** The browser releases both locks when the owning tab closes or reloads. */
export async function ownRun(id: string, paused: boolean): Promise<RunOwnership | undefined> {
  const locks = lockManager();
  if (!locks?.query) return;
  const name = prefix + id;
  const owner = await hold(locks, name);
  if (!owner) throw new Error('This simulation run already has an owner.');
  let marker: HeldLock | undefined;
  let closed = false;
  let transition = Promise.resolve();
  const lease: RunOwnership = {
    setPaused(next) {
      transition = transition
        .catch(() => {})
        .then(async () => {
          if (closed || next === !!marker) return;
          if (next) {
            const pending = await hold(locks, name + pausedSuffix);
            if (closed) pending?.release();
            else marker = pending;
          } else {
            const previous = marker!;
            marker = undefined;
            previous.release();
            await previous.released;
          }
        });
      return transition;
    },
    release() {
      closed = true;
      marker?.release();
      owner.release();
    },
  };
  try {
    if (paused) await lease.setPaused(true);
    return lease;
  } catch (error) {
    lease.release();
    throw error;
  }
}

/** An unavailable snapshot conveys no evidence that an execution ended. */
export async function runOwners(): Promise<ReadonlyMap<string, ActiveStatus> | undefined> {
  const locks = lockManager();
  if (!locks?.query) return;
  try {
    const { held } = await locks.query();
    if (!held) return;
    const names = new Set(held.map((lock) => lock.name));
    const owners = new Map<string, ActiveStatus>();
    for (const name of names)
      if (name?.startsWith(prefix) && !name.endsWith(pausedSuffix))
        owners.set(
          name.slice(prefix.length),
          names.has(name + pausedSuffix) ? 'paused' : 'running',
        );
    return owners;
  } catch {
    return undefined;
  }
}
