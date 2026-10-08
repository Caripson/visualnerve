import { webcrypto } from 'node:crypto';
import { Blob as NativeBlob } from 'node:buffer';
import { vi } from 'vitest';
import type { AppAssetLease } from '../src/security/app-cache';

export const narrationCrypto = webcrypto as unknown as Crypto;
export function narrationBlob(text = 'Private narration WAV bytes') {
  return new NativeBlob([text], { type: 'audio/wav' }) as unknown as Blob;
}
export function narrationCacheFixture() {
  const records = new Map<string, Map<string, Response>>();
  const objects = new Map<string, ReturnType<typeof make>>();
  const url = (request: RequestInfo | URL) =>
    typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  function make(name: string) {
    const entries = new Map<string, Response>();
    records.set(name, entries);
    return {
      entries,
      match: vi.fn(async (request: RequestInfo | URL) => entries.get(url(request))?.clone()),
      put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
        entries.set(url(request), response.clone());
      }),
      delete: vi.fn(async (request: RequestInfo | URL) => entries.delete(url(request))),
    };
  }
  const cache = (name: string) => {
    if (!objects.has(name)) objects.set(name, make(name));
    return objects.get(name)!;
  };
  const storage = {
    open: vi.fn(async (name: string) => cache(name)),
    keys: vi.fn(async () => [...records.keys()]),
    delete: vi.fn(async (name: string) => {
      objects.delete(name);
      return records.delete(name);
    }),
  } as unknown as CacheStorage;
  return { storage, cache, records };
}
export async function narrationLease<T>(
  work: (lease: AppAssetLease) => Promise<T>,
  signal?: AbortSignal,
) {
  const current = signal ?? new AbortController().signal;
  const check = async () => current.throwIfAborted();
  await check();
  const value = await work({
    signal: current,
    check,
    put: async (cache, request, response) => {
      await check();
      await cache.put(request, response);
      await check();
    },
  });
  await check();
  return value;
}
export function narrationGate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
