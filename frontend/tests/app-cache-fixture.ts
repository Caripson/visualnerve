import { vi } from 'vitest';

type Ticket = {
  mode: 'shared' | 'exclusive';
  signal?: AbortSignal;
  run: () => unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort: () => void;
};
/** FIFO shared/exclusive behavior, including the browser's queued-only signal cancellation. */
export class CacheTestLocks {
  private queues = new Map<string, Ticket[]>();
  private held = new Map<string, { mode: string; count: number }>();
  request(name: string, options: LockOptions, run: () => unknown) {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      const ticket: Ticket = {
        mode: options.mode ?? 'exclusive',
        signal: options.signal,
        run,
        resolve,
        reject,
        abort: () => {
          const queue = this.queues.get(name) ?? [];
          const index = queue.indexOf(ticket);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(ticket.signal?.reason);
          this.drain(name);
        },
      };
      const queue = this.queues.get(name) ?? [];
      queue.push(ticket);
      this.queues.set(name, queue);
      options.signal?.addEventListener('abort', ticket.abort, { once: true });
      this.drain(name);
    });
  }
  private drain(name: string) {
    const queue = this.queues.get(name)!;
    while (queue.length) {
      const ticket = queue[0],
        held = this.held.get(name);
      if (held && (held.mode === 'exclusive' || ticket.mode === 'exclusive')) return;
      queue.shift();
      ticket.signal?.removeEventListener('abort', ticket.abort);
      this.held.set(name, { mode: ticket.mode, count: (held?.count ?? 0) + 1 });
      void Promise.resolve()
        .then(ticket.run)
        .then(ticket.resolve, ticket.reject)
        .finally(() => {
          const held = this.held.get(name)!;
          if (--held.count === 0) this.held.delete(name);
          this.drain(name);
        });
      if (ticket.mode === 'exclusive') return;
    }
  }
}
export class CacheTestChannel {
  static members = new Set<CacheTestChannel>();
  static suspended = false;
  onmessage?: (event: MessageEvent) => void;
  constructor(readonly name: string) {
    CacheTestChannel.members.add(this);
  }
  postMessage(data: unknown) {
    if (CacheTestChannel.suspended) return;
    for (const peer of CacheTestChannel.members)
      if (peer !== this && peer.name === this.name)
        queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent));
  }
  close() {
    CacheTestChannel.members.delete(this);
  }
}
export function cacheStorageFixture() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: RequestInfo | URL) =>
    typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  const cache = (name: string) => {
    let entries = stores.get(name);
    if (!entries) {
      entries = new Map();
      stores.set(name, entries);
    }
    const store = entries;
    return {
      match: vi.fn(async (request: RequestInfo | URL) => store.get(key(request))?.clone()),
      put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
        store.set(key(request), response.clone());
      }),
    };
  };
  const caches = {
    open: vi.fn(async (name: string) => cache(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  };
  return { stores, cache, caches };
}
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
