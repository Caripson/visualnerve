import {
  workspaceStoreDefinitions,
  type WorkspaceIndexKey,
  type WorkspaceStoreName,
} from '../storage/contracts';
import { VaultStorageError } from './vault-storage';
import type { VaultPartition } from './vault-record-codec';

export interface VaultIndexProjection {
  format: 'visualnerve-index-projection';
  version: 1;
  id: string;
  keys: Record<string, WorkspaceIndexKey[]>;
}

const invalid = (): never => {
  throw new VaultStorageError(422, 'INVALID_WORKSPACE_INDEX', 'Invalid workspace record or index.');
};
export function isWorkspaceIndexKey(value: unknown): value is WorkspaceIndexKey {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) &&
      value.every(
        (entry) =>
          typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)),
      ))
  );
}
export function encodeWorkspaceIndexKey(value: WorkspaceIndexKey): string {
  if (!isWorkspaceIndexKey(value)) invalid();
  return JSON.stringify(value);
}
export function compareWorkspaceIndexKeys(a: WorkspaceIndexKey, b: WorkspaceIndexKey): number {
  const rank = (key: WorkspaceIndexKey) =>
    typeof key === 'number' ? 0 : typeof key === 'string' ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const result = compareWorkspaceIndexKeys(a[i], b[i]);
      if (result) return result;
    }
    return a.length - b.length;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}

export function workspaceRecordId(store: WorkspaceStoreName, value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const id = (value as Record<string, unknown>)[workspaceStoreDefinitions[store].primaryKey];
  if (typeof id !== 'string' || !id || new TextEncoder().encode(id).byteLength > 1024) invalid();
  return id as string;
}

export function workspaceRecordIndexKeys(
  store: WorkspaceStoreName,
  index: string,
  value: unknown,
): WorkspaceIndexKey[] {
  const definition = workspaceStoreDefinitions[store];
  if (index === definition.primaryKey) return [workspaceRecordId(store, value)];
  const spec = definition.indexes[index];
  if (!spec || !value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const raw = spec.fields.map((field) => record[field]);
  const values = spec.multiEntry
    ? Array.isArray(raw[0])
      ? raw[0]
      : []
    : raw.every((value) => value !== undefined)
      ? [raw.length === 1 ? raw[0] : raw]
      : [];
  return [
    ...new Map(
      values.filter(isWorkspaceIndexKey).map((value) => [encodeWorkspaceIndexKey(value), value]),
    ).values(),
  ];
}

/** These values live only inside the authenticated encrypted logical manifest. */
export function projectWorkspaceIndexes(
  store: WorkspaceStoreName,
  value: unknown,
): VaultIndexProjection {
  const id = workspaceRecordId(store, value);
  const keys: VaultIndexProjection['keys'] = Object.create(null);
  const definition = workspaceStoreDefinitions[store];
  keys[definition.primaryKey] = [id];
  for (const [index, spec] of Object.entries(definition.indexes)) {
    // Multivalue data stays in the chunkable payload. Copying arbitrarily many
    // owners/tags/source IDs into a bounded root projection would add a new
    // model limit. Those uncommon queries decrypt the matching store's roots.
    keys[index] = spec.multiEntry ? [] : workspaceRecordIndexKeys(store, index, value);
  }
  return { format: 'visualnerve-index-projection', version: 1, id, keys };
}

export function parseWorkspaceIndexProjection(
  store: WorkspaceStoreName,
  value: unknown,
  expectedId?: string,
): VaultIndexProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const projection = value as VaultIndexProjection;
  const definition = workspaceStoreDefinitions[store];
  if (
    projection.format !== 'visualnerve-index-projection' ||
    projection.version !== 1 ||
    typeof projection.id !== 'string' ||
    !projection.id ||
    (expectedId !== undefined && projection.id !== expectedId) ||
    !projection.keys ||
    typeof projection.keys !== 'object' ||
    Array.isArray(projection.keys)
  )
    invalid();
  const expectedIndexes = new Set([definition.primaryKey, ...Object.keys(definition.indexes)]);
  if (
    Object.keys(projection.keys).length !== expectedIndexes.size ||
    Object.keys(projection.keys).some((index) => !expectedIndexes.has(index)) ||
    Object.values(projection.keys).some(
      (keys) => !Array.isArray(keys) || keys.some((key) => !isWorkspaceIndexKey(key)),
    ) ||
    JSON.stringify(projection.keys[definition.primaryKey]) !== JSON.stringify([projection.id])
  )
    invalid();
  return projection;
}

/**
 * Unbounded multivalue fields use an encrypted metadata scan. No artificial
 * owner/tag/source limit is introduced to fit the physical partition ceiling.
 */
export function workspaceEqualityPartitions(
  store: WorkspaceStoreName,
  projection: VaultIndexProjection,
): VaultPartition[] {
  return Object.entries(workspaceStoreDefinitions[store].indexes).flatMap(([index, spec]) =>
    spec.multiEntry
      ? []
      : projection.keys[index]
          .map((value) => ({ index, value: encodeWorkspaceIndexKey(value) }))
          .filter((partition) => new TextEncoder().encode(partition.value).byteLength <= 4096),
  );
}
