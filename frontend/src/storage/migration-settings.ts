import { IMPORT_LIMIT_SETTING } from '../imports/limits';
import { PROJECT_SOURCE_FILE_LIMIT_SETTING } from '../code/project/limits';

export const WORKSPACE_MIGRATION_SETTING = 'vault-migration-state';
/** Destination-local controls never inherit a transfer file's identity or grants. */
export const migrationTechnicalSettings = new Set([
  'workspace-id',
  'storage-consent',
  'privacy-acknowledged',
  'last-diagram',
  'integration-enabled',
  'mcp-access',
  'bridge-url',
  'last-export',
  'backup-nudge-dismissed',
  IMPORT_LIMIT_SETTING,
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
]);
export function isMigrationTechnicalSetting(key: string) {
  return key.startsWith('vault-') || migrationTechnicalSettings.has(key);
}
