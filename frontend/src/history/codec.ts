import { StorageError } from '../model/errors';
import type { Graph } from '../model/types';
import type { HistoryGraph } from './types';

/** Count serialized UTF-8 before allocating a large JSON string or encoder buffer. */
export function historyJsonBytes(value: unknown, limit = Number.MAX_SAFE_INTEGER): number {
  const seen = new Set<object>();
  let bytes = 0;
  const add = (count: number) => {
    bytes += count;
    if (bytes > limit)
      throw new StorageError(
        413,
        'History capacity reached. Delete snapshots or use a smaller source.',
      );
  };
  const string = (text: string) => {
    add(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (
        code === 34 ||
        code === 92 ||
        code === 8 ||
        code === 9 ||
        code === 10 ||
        code === 12 ||
        code === 13
      )
        add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          add(4);
          index++;
        } else add(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (item: unknown, depth: number) => {
    if (depth > 256) throw new StorageError(422, 'History content is nested too deeply.');
    if (item === null || item === undefined) {
      add(4);
      return;
    }
    if (typeof item === 'string') {
      string(item);
      return;
    }
    if (typeof item === 'boolean') {
      add(item ? 4 : 5);
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      add(String(item).length);
      return;
    }
    if (
      typeof item !== 'object' ||
      (Object.getPrototypeOf(item) !== Object.prototype && !Array.isArray(item))
    )
      throw new StorageError(422, 'History supports JSON values only.');
    if (seen.has(item)) throw new StorageError(422, 'History content contains a cycle.');
    seen.add(item);
    add(2);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        if (index) add(1);
        visit(item[index], depth + 1);
      }
    } else {
      let count = 0;
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined) continue;
        if (count++) add(1);
        string(key);
        add(1);
        visit(child, depth + 1);
      }
    }
    seen.delete(item);
  };
  visit(value, 0);
  return bytes;
}
export function historyGraph(graph: Graph): HistoryGraph {
  const { dataset: _dataset, datasets: _datasets, ...content } = graph;
  return content;
}
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}
export async function historyDigest(value: unknown): Promise<string> {
  if (!crypto.subtle) throw new StorageError(503, 'History needs a secure browser context.');
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function historyStorageFailure(error: unknown): never {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError')
    throw new StorageError(
      413,
      'Browser storage is full. Export a workspace backup and delete unneeded snapshots or diagrams before continuing.',
    );
  throw error;
}
