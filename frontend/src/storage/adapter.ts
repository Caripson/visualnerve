import type { WorkspaceDatabase } from './database';
import type { WorkspaceStorage } from './contracts';

/** Preserve the legacy database API without making domain code depend on Dexie. */
export function asWorkspaceStorage(input: WorkspaceStorage | WorkspaceDatabase): WorkspaceStorage {
  return 'asStorage' in input ? input.asStorage() : input;
}
