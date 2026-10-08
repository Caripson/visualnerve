import type { VaultSessionSnapshot } from '../security/vault-session';
import { VAULT_FORMAT_VERSION } from '../security/vault-schema';
import type { WorkspaceStorage } from './contracts';

export interface WorkspaceSecurityStatus {
  type: 'workspace-security';
  schemaVersion: 1;
  mode: 'encrypted' | 'legacy';
  state: VaultSessionSnapshot['status'] | 'legacy';
  storage: 'indexeddb';
  logicalSchemaVersion: number;
  vaultSchemaVersion?: 1;
  cipher?: 'AES-256-GCM';
  requiresHumanUnlock: boolean;
  programmaticUnlock: false;
  programmaticLock: boolean;
  requestsRenewIdleTimeout: false;
  contentRequiresUnlock: boolean;
}

/** Only this exact read may bypass a workspace lease; its result contains no private records. */
export function isWorkspaceSecurityDiscovery(path: string, method: string): boolean {
  return method === 'GET' && path.replace(/^\/api\/v1/, '') === '/workspace/security';
}

/** Exact control operation; no password, policy or arbitrary Settings route is exempt. */
export function isWorkspaceLockCommand(path: string, method: string): boolean {
  return method === 'POST' && path.replace(/^\/api\/v1/, '') === '/workspace/lock';
}

/** Report the passed backend's state, including captured backends, without opening IndexedDB. */
export function workspaceSecurityStatus(storage: WorkspaceStorage): WorkspaceSecurityStatus {
  const session = (
    storage as WorkspaceStorage & { session?: { getSnapshot(): VaultSessionSnapshot } }
  ).session;
  const encrypted = !!session && typeof session.getSnapshot === 'function';
  const status = encrypted ? session.getSnapshot().status : 'legacy';
  return {
    type: 'workspace-security',
    schemaVersion: 1,
    mode: encrypted ? 'encrypted' : 'legacy',
    state: status,
    storage: 'indexeddb',
    logicalSchemaVersion: storage.schemaVersion,
    ...(encrypted
      ? { vaultSchemaVersion: VAULT_FORMAT_VERSION, cipher: 'AES-256-GCM' as const }
      : {}),
    requiresHumanUnlock: encrypted,
    programmaticUnlock: false,
    programmaticLock: encrypted,
    requestsRenewIdleTimeout: false,
    contentRequiresUnlock: encrypted,
  };
}
