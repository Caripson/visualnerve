import { workspaceStoreNames } from '../storage/contracts';
import { logicalRecordDigest } from '../storage/migration-digest';
import { WORKSPACE_MIGRATION_SETTING } from '../storage/migration-settings';
import type { VaultKeys } from './vault-crypto';
import { VaultLogicalRecordCodec } from './vault-logical-record';
import { workspacePayloadFields } from './vault-workspace-fields';
import {
  projectWorkspaceIndexes,
  parseWorkspaceIndexProjection,
  workspaceEqualityPartitions,
  workspaceRecordId,
} from './vault-indexes';
import {
  VAULT_ROTATION_MAX_RECORDS,
  VaultStorageError,
  type VaultLease,
  type VaultPhysicalRecord,
  type VaultRecordStorage,
} from './vault-storage';
import { logicalJsonLimits } from './vault-logical-json';

const integrity = (): never => {
  throw new VaultStorageError(
    422,
    'VAULT_INTEGRITY_FAILED',
    'Encrypted workspace record integrity check failed.',
  );
};
const limit = (): never => {
  throw new VaultStorageError(
    413,
    'VAULT_ROTATION_LIMIT',
    'Content-key rotation exceeds its supported workspace limits. The original workspace remains unchanged.',
  );
};

/** Rebuilds every authenticated logical value; only prepared ciphertext survives each iteration. */
export async function rewriteVaultRecords(
  storage: VaultRecordStorage,
  codec: VaultLogicalRecordCodec,
  oldKeys: VaultKeys,
  newKeys: VaultKeys,
  lease: VaultLease,
  check: () => Promise<void>,
): Promise<VaultPhysicalRecord[]> {
  const prepared: VaultPhysicalRecord[] = [];
  const preparedIds = new Set<string>();
  const budget = { bytes: 0, values: 0 };
  let remaining = VAULT_ROTATION_MAX_RECORDS,
    ciphertextBytes = 0;
  for (const store of workspaceStoreNames) {
    await check();
    const physical = await storage.select(lease, { store }, remaining);
    remaining -= physical.length;
    const values = new Map(physical.map((record) => [record.id, record]));
    if (values.size !== physical.length) integrity();
    const used = new Set<string>();
    const rootToken = await codec.rootPartition(oldKeys, store);
    for (const root of physical.filter((record) => record.partitions.includes(rootToken))) {
      await check();
      used.add(root.id);
      const original = await codec.read(oldKeys, root, async (ids) => {
        await check();
        for (const id of ids) used.add(id);
        return ids.map((id) => values.get(id));
      });
      await check();
      if (workspaceRecordId(store, original.value) !== original.logicalId) integrity();
      const projection = projectWorkspaceIndexes(store, original.value);
      parseWorkspaceIndexProjection(store, original.projection, original.logicalId);
      if (JSON.stringify(projection) !== JSON.stringify(original.projection)) integrity();
      const partitions = workspaceEqualityPartitions(store, projection);
      const expectedTokens = [
        ...new Set([
          rootToken,
          ...(await Promise.all(
            partitions.map((partition) => codec.partition(oldKeys, store, partition)),
          )),
        ]),
      ].sort();
      if (JSON.stringify(expectedTokens) !== JSON.stringify(root.partitions)) integrity();
      if (
        store === 'settings' &&
        original.logicalId === WORKSPACE_MIGRATION_SETTING &&
        (original.value as { value?: { state?: string } }).value?.state === 'pending-verification'
      )
        throw new VaultStorageError(
          409,
          'MIGRATION_VERIFICATION_REQUIRED',
          'Verify the pending workspace transfer before rotating its content key.',
        );
      const digest = await logicalRecordDigest(original.value, check, budget);
      const bundle = await codec.encode(
        newKeys,
        store,
        original.logicalId,
        original.value,
        1,
        partitions,
        {
          projection,
          payloadFields: workspacePayloadFields[store],
        },
      );
      await check();
      const staged = new Map(bundle.records.map((record) => [record.id, record]));
      if (staged.size !== bundle.records.length) integrity();
      const verified = await codec.read(
        newKeys,
        bundle.root,
        async (ids) => {
          await check();
          return ids.map((id) => staged.get(id));
        },
        original.logicalId,
      );
      await check();
      if (
        JSON.stringify(verified.projection) !== JSON.stringify(projection) ||
        (await logicalRecordDigest(verified.value, check)) !== digest
      )
        integrity();
      for (const record of bundle.records) {
        if (preparedIds.has(record.id)) integrity();
        preparedIds.add(record.id);
        ciphertextBytes += record.encrypted.ciphertext.length;
        if (
          preparedIds.size > VAULT_ROTATION_MAX_RECORDS ||
          ciphertextBytes > logicalJsonLimits.bytes * 2
        )
          limit();
        prepared.push(record);
      }
    }
    // Unattached/misindexed roots and orphan chunks must never silently disappear.
    if (used.size !== values.size || [...used].some((id) => !values.has(id))) integrity();
    values.clear();
    await check();
  }
  return prepared;
}
