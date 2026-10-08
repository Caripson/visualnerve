import { EncryptedWorkspaceDatabase } from './encrypted-database';
import type { WorkspaceBackup } from './database';
import {
  workspaceStoreNames,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceOperation,
  type WorkspaceStorage,
  type WorkspaceTable,
} from './contracts';
import { VaultStorageError } from '../security/vault-storage';
import { prepareWorkspaceMigration, assertMigrationRecordKeys } from './migration-preflight';
import {
  migrationCounts,
  migrationDigest,
  type MigrationCounts,
  type MigrationRecords,
} from './migration-digest';
import { WORKSPACE_MIGRATION_SETTING, isMigrationTechnicalSetting } from './migration-settings';

interface MigrationMarker {
  format: 'visualnerve-workspace-migration';
  version: 1;
  state: 'pending-verification' | 'verified';
  sourceSchemaVersion: number;
  sourceDigest: string;
  sourceCounts: MigrationCounts;
  expectedDigest: string;
  expectedCounts: MigrationCounts;
  startedAt: string;
  verifiedAt?: string;
  firstDiagramId?: string;
}
export interface WorkspaceMigrationSummary {
  version: 1;
  status: 'verified';
  sourceSchemaVersion: number;
  counts: MigrationCounts;
  firstDiagramId?: string;
}
export interface WorkspaceMigrationOptions {
  /** The browser must obtain explicit confirmation before replacing existing destination work. */
  replaceExisting?: boolean;
  beforeWrite?: (scope: WorkspaceStorage) => Promise<void>;
}
const invalid = (message = 'Invalid encrypted workspace migration state.'): never => {
  throw new VaultStorageError(422, 'INVALID_WORKSPACE_MIGRATION', message);
};
const mismatch = (): never => {
  throw new VaultStorageError(
    422,
    'MIGRATION_VERIFICATION_FAILED',
    'The encrypted transfer could not be verified. Original files and the source workspace remain unchanged.',
  );
};
function encrypted(db: EncryptedWorkspaceDatabase) {
  if (!(db instanceof EncryptedWorkspaceDatabase))
    invalid('Workspace migration requires the encrypted destination backend.');
}
function marker(value: unknown): MigrationMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as MigrationMarker;
  const allowed = [
    'format',
    'version',
    'state',
    'sourceSchemaVersion',
    'sourceDigest',
    'sourceCounts',
    'expectedDigest',
    'expectedCounts',
    'startedAt',
    'verifiedAt',
    'firstDiagramId',
  ];
  if (
    Object.keys(record).some((key) => !allowed.includes(key)) ||
    record.format !== 'visualnerve-workspace-migration' ||
    record.version !== 1 ||
    !['pending-verification', 'verified'].includes(record.state) ||
    !Number.isSafeInteger(record.sourceSchemaVersion) ||
    record.sourceSchemaVersion < 1 ||
    record.sourceSchemaVersion > WORKSPACE_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/.test(record.sourceDigest) ||
    !/^[a-f0-9]{64}$/.test(record.expectedDigest) ||
    typeof record.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    (record.state === 'verified'
      ? typeof record.verifiedAt !== 'string' || !Number.isFinite(Date.parse(record.verifiedAt))
      : record.verifiedAt !== undefined) ||
    (record.firstDiagramId !== undefined && typeof record.firstDiagramId !== 'string')
  )
    invalid();
  for (const counts of [record.sourceCounts, record.expectedCounts])
    if (
      !counts ||
      typeof counts !== 'object' ||
      Array.isArray(counts) ||
      Object.keys(counts).length !== workspaceStoreNames.length ||
      workspaceStoreNames.some(
        (store) =>
          !Number.isSafeInteger(counts[store]) || counts[store] < 0 || counts[store] > 64_000_000,
      )
    )
      invalid();
  return record;
}
function summary(value: MigrationMarker): WorkspaceMigrationSummary {
  return {
    version: 1,
    status: 'verified',
    sourceSchemaVersion: value.sourceSchemaVersion,
    counts: { ...value.sourceCounts },
    ...(value.firstDiagramId ? { firstDiagramId: value.firstDiagramId } : {}),
  };
}
async function readRecords(scope: WorkspaceStorage, check: () => Promise<void>) {
  const records = {} as MigrationRecords;
  for (const store of workspaceStoreNames) {
    await check();
    // Every full value authenticates the root AND all payload chunks. No dataset cache or
    // compact history export can substitute for verifying these durable encrypted records.
    Reflect.set(records, store, await scope[store].toArray());
  }
  records.settings = records.settings.filter(
    (setting) => setting.key !== WORKSPACE_MIGRATION_SETTING,
  );
  return records;
}
async function verifyCaptured(operation: WorkspaceOperation) {
  return operation.storage.atomic('rw', workspaceStoreNames, async (scope) => {
    await operation.check();
    const stored = await scope.settings.get(WORKSPACE_MIGRATION_SETTING);
    if (!stored) return;
    const pending = marker(stored.value);
    if (pending.state === 'verified') return summary(pending);
    const records = await readRecords(scope, () => operation.check());
    assertMigrationRecordKeys(records);
    const counts = migrationCounts(records);
    if (workspaceStoreNames.some((store) => counts[store] !== pending.expectedCounts[store]))
      mismatch();
    const digest = await migrationDigest(records, () => operation.check());
    if (
      digest !== pending.expectedDigest ||
      (pending.firstDiagramId &&
        !records.diagrams.some((diagram) => diagram.id === pending.firstDiagramId))
    )
      mismatch();
    await operation.check();
    const verified: MigrationMarker = {
      ...pending,
      state: 'verified',
      verifiedAt: new Date().toISOString(),
    };
    await scope.settings.put({ key: WORKSPACE_MIGRATION_SETTING, value: verified });
    return summary(verified);
  });
}

/** Called before UI/API readiness; crash-interrupted verification resumes using the same vault. */
export async function verifyPendingMigration(db: EncryptedWorkspaceDatabase) {
  encrypted(db);
  const operation = await db.captureOperation();
  try {
    const result = await verifyCaptured(operation);
    await operation.check();
    return result;
  } finally {
    operation.dispose();
  }
}

/** Explicit file transfer. It never opens, redirects or deletes the source origin. */
export async function migrateWorkspace(
  db: EncryptedWorkspaceDatabase,
  backup: WorkspaceBackup,
  options: WorkspaceMigrationOptions = {},
): Promise<WorkspaceMigrationSummary> {
  encrypted(db);
  const operation = await db.captureOperation();
  try {
    const prepared = await prepareWorkspaceMigration(backup, () => operation.check());
    const sourceCounts = migrationCounts(prepared.records);
    const sourceDigest = await migrationDigest(prepared.records, () => operation.check());
    await operation.storage.atomic('rw', workspaceStoreNames, async (scope) => {
      await operation.check();
      const destinationSettings = await scope.settings.toArray();
      const access = destinationSettings.find((setting) => setting.key === 'mcp-access')?.value;
      if (access !== undefined && access !== 'off')
        throw new VaultStorageError(
          409,
          'MIGRATION_ACCESS_ACTIVE',
          'Turn API/MCP access Off before moving workspace content.',
        );
      const existing = await Promise.all(
        workspaceStoreNames
          .filter((store) => store !== 'settings' && store !== 'templates')
          .map((store) => scope[store].count()),
      );
      const customTemplates = (await scope.templates.toArray()).some(
        (template) => !template.builtin,
      );
      if (!options.replaceExisting && (existing.some(Boolean) || customTemplates))
        throw new VaultStorageError(
          409,
          'MIGRATION_REPLACE_CONFIRMATION_REQUIRED',
          'The destination contains work. Confirm replacement before migrating.',
        );
      const prior = destinationSettings.find(
        (setting) => setting.key === WORKSPACE_MIGRATION_SETTING,
      );
      if (prior) marker(prior.value);
      const settings = new Map(prepared.records.settings.map((setting) => [setting.key, setting]));
      for (const setting of destinationSettings)
        if (
          isMigrationTechnicalSetting(setting.key) &&
          setting.key !== WORKSPACE_MIGRATION_SETTING &&
          setting.key !== 'last-diagram'
        )
          settings.set(setting.key, setting);
      if (!settings.has('workspace-id'))
        settings.set('workspace-id', { key: 'workspace-id', value: crypto.randomUUID() });
      settings.set('mcp-access', { key: 'mcp-access', value: 'off' });
      settings.set('integration-enabled', { key: 'integration-enabled', value: false });
      const records = { ...prepared.records, settings: [...settings.values()] };
      assertMigrationRecordKeys(records);
      const pending: MigrationMarker = {
        format: 'visualnerve-workspace-migration',
        version: 1,
        state: 'pending-verification',
        sourceSchemaVersion: prepared.schemaVersion,
        sourceCounts,
        sourceDigest,
        expectedCounts: migrationCounts(records),
        expectedDigest: await migrationDigest(records, () => operation.check()),
        startedAt: new Date().toISOString(),
        ...(records.diagrams[0] ? { firstDiagramId: records.diagrams[0].id } : {}),
      };
      await operation.check();
      await options.beforeWrite?.(scope);
      // Existing encrypted journal coordinates all 14 logical stores and atomic native commit.
      // Quota, revocation and concurrent revision conflicts cannot leave a half replacement.
      scope.forgetDatasets();
      for (const store of workspaceStoreNames) {
        const table = scope[store] as WorkspaceTable<unknown>;
        await table.clear();
        await table.bulkPut(records[store]);
      }
      await scope.settings.put({ key: WORKSPACE_MIGRATION_SETTING, value: pending });
    });
    await operation.check();
    const result = await verifyCaptured(operation);
    if (!result) return mismatch();
    await operation.check();
    return result;
  } finally {
    operation.dispose();
  }
}
