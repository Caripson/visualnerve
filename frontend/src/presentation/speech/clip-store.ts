import {
  APP_CACHE_CHANNEL,
  withAppAssetDownload,
  type AppAssetLease,
} from '../../security/app-cache';
import { presentationNodeLimit } from '../types';
import {
  NARRATION_CLIP_CACHE_PREFIX,
  NARRATION_MEMORY_BYTES,
  NARRATION_SPILL_BYTES,
} from './clip-cache-protocol';

type Entry = { size: number; blob?: Blob; id?: string };
type Options = {
  crypto?: Crypto;
  cacheStorage?: CacheStorage;
  origin?: string;
  memoryBytes?: number;
  spillBytes?: number;
  withLease?: typeof withAppAssetDownload;
  onInvalidated?: () => void;
};
const cancelled = () => new DOMException('Narration preparation cancelled.', 'AbortError');
const capacity = () =>
  new Error('Full preload exceeds the 1 GiB encrypted temporary audio limit. Shorten this tour.');

/** One tour/voice generation. Logical keys and the nonextractable AES key stay in RAM. */
export class NarrationClipStore {
  private entries = new Map<string, Entry>();
  private controller = new AbortController();
  private operations = new Set<Promise<unknown>>();
  private writes: Promise<void> = Promise.resolve();
  private key?: Promise<CryptoKey>;
  private cache?: Promise<Cache>;
  private channel?: BroadcastChannel;
  private cleanup?: Promise<void>;
  private memory = 0;
  private disk = 0;
  private closed = false;
  private cleanupError = '';
  readonly cacheName: string;
  private crypto: Crypto;
  private origin: string;
  constructor(private options: Options = {}) {
    this.crypto = options.crypto ?? globalThis.crypto;
    this.origin = options.origin ?? location.origin;
    const url = new URL(this.origin);
    if (
      url.origin !== this.origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      (!options.origin && url.origin !== location.origin)
    )
      throw new Error('Temporary narration must use the current app origin.');
    this.cacheName = NARRATION_CLIP_CACHE_PREFIX + this.crypto.randomUUID();
  }
  get size() {
    return this.entries.size;
  }
  get memoryBytes() {
    return this.memory;
  }
  get spillBytes() {
    return this.disk;
  }
  getCleanupError() {
    return this.cleanupError;
  }
  has(key: string) {
    return !this.closed && this.entries.has(key);
  }
  private check(signal?: AbortSignal) {
    if (this.closed || this.controller.signal.aborted) throw cancelled();
    signal?.throwIfAborted();
  }
  private storage() {
    const storage = this.options.cacheStorage ?? globalThis.caches;
    if (!storage || !this.crypto.subtle)
      throw new Error(
        'Full preload needs secure browser storage after 32 MiB. Use HTTPS and allow temporary app storage.',
      );
    return storage;
  }
  private url(id: string) {
    return `${this.origin}/__visualnerve_private_audio__/${this.cacheName}/${id}`;
  }
  private aad(id: string, size: number) {
    return new TextEncoder().encode(
      JSON.stringify(['visual-nerve-temporary-narration', 1, this.cacheName, id, size]),
    );
  }
  private async cipherKey(signal: AbortSignal) {
    this.check(signal);
    const key = await (this.key ??= this.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ));
    this.check(signal);
    return key;
  }
  private async opened(signal: AbortSignal) {
    this.check(signal);
    const cache = await (this.cache ??= this.storage().open(this.cacheName));
    this.check(signal);
    if (!this.channel && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(APP_CACHE_CHANNEL);
      this.channel.onmessage = (event: MessageEvent) => {
        if (event.data?.type !== 'clear-app-assets') return;
        void this.dispose();
        this.options.onInvalidated?.();
      };
    }
    return cache;
  }
  private run<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>) {
    this.check(signal);
    const linked = new AbortController();
    const abort = () => linked.abort(cancelled());
    this.controller.signal.addEventListener('abort', abort, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    const task = Promise.resolve().then(async () => {
      this.check(signal);
      const value = await work(linked.signal);
      this.check(signal);
      return value;
    });
    this.operations.add(task);
    void task
      .finally(() => {
        this.controller.signal.removeEventListener('abort', abort);
        signal.removeEventListener('abort', abort);
        this.operations.delete(task);
      })
      .catch(() => undefined);
    return task;
  }
  get(key: string, signal: AbortSignal): Promise<Blob | undefined> {
    return this.run(signal, async (current) => {
      const entry = this.entries.get(key);
      if (!entry) return undefined;
      if (entry.blob) return entry.blob;
      const id = entry.id!;
      return (this.options.withLease ?? withAppAssetDownload)(async (lease) => {
        const cache = await this.opened(current);
        this.check(current);
        const response = await cache.match(this.url(id));
        this.check(current);
        await lease.check();
        this.check(current);
        if (!response?.body) throw new Error('Prepared narration is missing. Run Preload again.');
        const size = entry.size + 28;
        const bytes = new Uint8Array(size);
        const reader = response.body.getReader();
        let plaintext: Uint8Array<ArrayBuffer> | undefined;
        let loaded = 0;
        try {
          while (true) {
            this.check(current);
            lease.signal.throwIfAborted();
            const part = await reader.read();
            this.check(current);
            lease.signal.throwIfAborted();
            if (part.done) break;
            if (loaded + part.value.byteLength > size)
              throw new Error(
                'Prepared narration failed integrity verification. Run Preload again.',
              );
            bytes.set(part.value, loaded);
            loaded += part.value.byteLength;
          }
          if (loaded !== size)
            throw new Error('Prepared narration failed integrity verification. Run Preload again.');
          const key = await this.cipherKey(current);
          const result = await this.crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: bytes.subarray(0, 12),
              additionalData: this.aad(id, entry.size),
              tagLength: 128,
            },
            key,
            bytes.subarray(12),
          );
          plaintext = new Uint8Array(result);
          this.check(current);
          await lease.check();
          this.check(current);
          if (plaintext.byteLength !== entry.size)
            throw new Error('Prepared narration failed integrity verification. Run Preload again.');
          return new Blob([plaintext], { type: 'audio/wav' });
        } catch (error) {
          this.check(current);
          if (
            error &&
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'OperationError'
          )
            throw new Error('Prepared narration failed integrity verification. Run Preload again.');
          throw error;
        } finally {
          // Cancellation can await an unread sibling of a tee. It must not
          // retain plaintext/key cleanup or stall lock quiescence indefinitely.
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
          bytes.fill(0);
          plaintext?.fill(0);
        }
      }, current);
    });
  }
  put(key: string, blob: Blob, signal: AbortSignal, retainAll = true): Promise<void> {
    return this.run(signal, async (current) => {
      const previous = this.writes;
      let release!: () => void;
      this.writes = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        this.check(current);
        if (this.entries.has(key)) return;
        if (blob.size <= 0 || blob.size > NARRATION_MEMORY_BYTES)
          throw new Error(
            'A narration clip exceeds the 32 MiB per-object limit. Shorten its description.',
          );
        if (this.entries.size >= presentationNodeLimit) throw capacity();
        const limit = this.options.memoryBytes ?? NARRATION_MEMORY_BYTES;
        if (!retainAll) {
          while (
            [...this.entries.values()].filter((entry) => entry.blob).length >= 3 ||
            this.memory + blob.size > limit
          ) {
            const first = [...this.entries].find(([, entry]) => entry.blob);
            if (!first) break;
            this.entries.delete(first[0]);
            this.memory -= first[1].size;
          }
        }
        if (this.memory + blob.size <= limit) {
          this.entries.set(key, { blob, size: blob.size });
          this.memory += blob.size;
          return;
        }
        const bytesNeeded = blob.size + 28;
        if (this.disk + bytesNeeded > (this.options.spillBytes ?? NARRATION_SPILL_BYTES))
          throw capacity();
        this.storage();
        await (this.options.withLease ?? withAppAssetDownload)(async (lease) => {
          const id = this.crypto.randomUUID();
          const iv = this.crypto.getRandomValues(new Uint8Array(12));
          let plain: Uint8Array<ArrayBuffer> | undefined;
          let encrypted: Uint8Array<ArrayBuffer> | undefined;
          let cache: Cache | undefined;
          let reserved = false;
          let committed = false;
          try {
            plain = new Uint8Array(await blob.arrayBuffer());
            this.check(current);
            lease.signal.throwIfAborted();
            if (plain.byteLength !== blob.size)
              throw new Error('The narration clip has an unexpected size.');
            const cipherKey = await this.cipherKey(current);
            const ciphertext = await this.crypto.subtle.encrypt(
              { name: 'AES-GCM', iv, additionalData: this.aad(id, blob.size), tagLength: 128 },
              cipherKey,
              plain,
            );
            this.check(current);
            lease.signal.throwIfAborted();
            encrypted = new Uint8Array(bytesNeeded);
            encrypted.set(iv);
            encrypted.set(new Uint8Array(ciphertext), 12);
            cache = await this.opened(current);
            this.disk += bytesNeeded;
            reserved = true;
            await lease.put(
              cache,
              this.url(id),
              new Response(encrypted, {
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Cache-Control': 'no-store',
                },
              }),
            );
            this.check(current);
            await lease.check();
            this.check(current);
            this.entries.set(key, { id, size: blob.size });
            committed = true;
          } finally {
            plain?.fill(0);
            encrypted?.fill(0);
            if (reserved && !committed && cache) {
              try {
                if ((await cache.delete(this.url(id))) || !(await cache.match(this.url(id))))
                  this.disk -= bytesNeeded;
              } catch {
                // Conservatively count failed native puts until generation cleanup.
                this.cleanupError =
                  'Temporary encrypted narration cleanup was incomplete. Clear app cache to remove the inaccessible remainder.';
              }
            }
          }
        }, current);
      } finally {
        release();
      }
    });
  }
  /** Revoke first; wait for native puts before deleting this exact old generation. */
  dispose(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    this.closed = true;
    this.controller.abort(cancelled());
    this.channel?.close();
    this.channel = undefined;
    this.entries.clear();
    this.memory = 0;
    this.key = undefined;
    this.cleanup = (async () => {
      await Promise.allSettled([...this.operations]);
      if (this.cache) {
        try {
          const storage = this.storage();
          const deleted = await storage.delete(this.cacheName);
          if (!deleted && (await storage.keys()).includes(this.cacheName))
            throw new Error('Temporary narration cache could not be removed.');
        } catch {
          // Key revocation is immediate. A failed deletion leaves inaccessible
          // ciphertext; explicit Clear app cache can remove crash remnants.
          this.cleanupError =
            'Temporary encrypted narration cleanup was incomplete. Clear app cache to remove the inaccessible remainder.';
        }
      }
      this.cache = undefined;
      this.disk = 0;
    })();
    return this.cleanup;
  }
  async settled() {
    if (this.cleanup) await this.cleanup;
    else await Promise.allSettled([...this.operations]);
  }
}
