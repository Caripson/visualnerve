import { StorageError } from '../../model/errors';
import { collaborationDocumentLimits } from './scope';

export type PathValue = ['object'] | ['value', unknown];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const collections = new Set([
  'nodes',
  'edges',
  'owners',
  'simulation.nodes',
  'simulation.edges',
  'simulation.resources',
  'simulation.particleTypes',
  'simulation.processes',
  'simulation.improvements',
  'simulation.scenarios',
]);
const invalid = (message: string): never => {
  throw new StorageError(422, message);
};

/** Stable entity paths allow concurrent edits to different fields of one node. */
export function flattenShared(value: Record<string, unknown>): Map<string, PathValue> {
  const result = new Map<string, PathValue>();
  let bytes = 0;
  const walk = (value: unknown, path: string[]) => {
    if (path.length > collaborationDocumentLimits.depth)
      invalid('Shared document is nested too deeply.');
    if (Array.isArray(value) && collections.has(path.join('.'))) {
      const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const item of value) {
        if (!object(item) || typeof item.id !== 'string' || Object.hasOwn(record, item.id))
          invalid('Shared entities require unique identifiers.');
        record[item.id] = item;
      }
      return walk(record, path);
    }
    const key = JSON.stringify(path);
    if (object(value)) {
      result.set(key, ['object']);
      for (const [key, child] of Object.entries(value))
        if (child !== undefined) walk(child, [...path, key]);
    } else {
      if (value === undefined || (typeof value === 'number' && !Number.isFinite(value)))
        invalid('Shared document must contain finite JSON values.');
      const serialized = JSON.stringify(value);
      if (serialized === undefined) invalid('Shared document must contain JSON values.');
      bytes += new TextEncoder().encode(key + serialized).byteLength;
      if (bytes > collaborationDocumentLimits.jsonBytes)
        invalid('Shared document exceeds its size limit.');
      result.set(key, ['value', JSON.parse(serialized) as unknown]);
    }
    if (result.size > collaborationDocumentLimits.fields)
      invalid('Shared document has too many fields.');
  };
  walk(value, []);
  return result;
}

export function expandShared(entries: Iterable<[string, unknown]>): Record<string, unknown> {
  const fields = new Map<string, PathValue>();
  for (const [key, value] of entries) {
    if (
      !Array.isArray(value) ||
      !['object', 'value'].includes(value[0] as string) ||
      (value[0] === 'object' ? value.length !== 1 : value.length !== 2)
    )
      invalid('Invalid shared field encoding.');
    fields.set(key, value as PathValue);
    if (fields.size > collaborationDocumentLimits.fields)
      invalid('Shared document has too many fields.');
  }
  const root: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const ordered = [...fields]
    .map(([key, value]) => {
      let path: unknown;
      try {
        path = JSON.parse(key);
      } catch {
        return invalid('Invalid shared field path.');
      }
      if (
        !Array.isArray(path) ||
        path.length > collaborationDocumentLimits.depth ||
        path.some((part) => typeof part !== 'string' || part.length > 1024) ||
        JSON.stringify(path) !== key
      )
        invalid('Invalid shared field path.');
      return { path: path as string[], value };
    })
    .sort((a, b) => a.path.length - b.path.length);
  if (fields.get('[]')?.[0] !== 'object') invalid('Missing shared document root.');
  for (const { path, value } of ordered) {
    if (!path.length) continue;
    let target = root;
    let active = true;
    for (let i = 0; i < path.length - 1; i++) {
      // Deleted ancestors suppress concurrently edited descendants. No dangling resurrection.
      if (fields.get(JSON.stringify(path.slice(0, i + 1)))?.[0] !== 'object') {
        active = false;
        break;
      }
      target = target[path[i]] as Record<string, unknown>;
      if (!object(target)) {
        active = false;
        break;
      }
    }
    if (active)
      Object.defineProperty(target, path.at(-1)!, {
        value: value[0] === 'object' ? Object.create(null) : structuredClone(value[1]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  const arrays = (value: Record<string, unknown>, path: string[]) => {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (collections.has(childPath.join('.')) && object(child)) {
        value[key] = Object.keys(child)
          .sort()
          .map((id) => child[id]);
      } else if (object(child)) arrays(child, childPath);
    }
  };
  arrays(root, []);
  // Also enforce byte bounds on received content; untrusted maps may contain enormous values.
  const serialized = JSON.stringify(root);
  if (new TextEncoder().encode(serialized).byteLength > collaborationDocumentLimits.jsonBytes)
    invalid('Shared document exceeds its size limit.');
  return JSON.parse(serialized) as Record<string, unknown>;
}
