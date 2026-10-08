import { afterEach, describe, expect, it, vi } from 'vitest';
import { Repository } from '../src/storage/repository';
import { WorkspaceDatabase } from '../src/storage/database';
import {
  isWorkspaceSecurityDiscovery,
  isWorkspaceLockCommand,
  workspaceSecurityStatus,
} from '../src/storage/security-status';
import type { WorkspaceStorage } from '../src/storage/contracts';
import { VaultStorageError } from '../src/security/vault-storage';

let legacy: WorkspaceDatabase | undefined;
afterEach(async () => {
  if (legacy) await legacy.delete();
  legacy = undefined;
});

describe('safe workspace security discovery', () => {
  it.each(['uninitialized', 'unlocking', 'locked', 'unlocked'] as const)(
    'reports %s without reading records, capturing keys or leaking private session metadata',
    async (state) => {
      const captureOperation = vi.fn(async () => {
        throw new VaultStorageError(
          423,
          'WORKSPACE_LOCKED',
          'Unlock the workspace in the browser.',
        );
      });
      const storage = {
        schemaVersion: 8,
        session: {
          getSnapshot: () => ({
            status: state,
            vaultId: 'private-vault-id',
            epoch: 42,
            keyVersion: 7,
            idleExpiresAt: 123456,
            absoluteExpiresAt: 789012,
          }),
        },
        captureOperation,
      } as unknown as WorkspaceStorage;
      const repo = new Repository(storage);
      const status = await repo.request('/workspace/security');
      expect(status).toEqual({
        type: 'workspace-security',
        schemaVersion: 1,
        mode: 'encrypted',
        state,
        storage: 'indexeddb',
        logicalSchemaVersion: 8,
        vaultSchemaVersion: 1,
        cipher: 'AES-256-GCM',
        requiresHumanUnlock: true,
        programmaticUnlock: false,
        programmaticLock: true,
        requestsRenewIdleTimeout: false,
        contentRequiresUnlock: true,
      });
      expect(await repo.request('/api/v1/workspace/security')).toEqual(status);
      expect(await repo.request('/health')).toMatchObject({ workspaceSecurity: status });
      expect(captureOperation).not.toHaveBeenCalled();
      for (const sensitive of [
        'private-vault-id',
        'vaultId',
        'epoch',
        'keyVersion',
        'ExpiresAt',
        'token',
        'mcpAccess',
      ])
        expect(JSON.stringify(status)).not.toContain(sensitive);
      await expect(repo.request('/diagrams')).rejects.toMatchObject({
        status: 423,
        code: 'WORKSPACE_LOCKED',
      });
      expect(captureOperation).toHaveBeenCalledOnce();
    },
  );

  it('does not silently present an existing legacy browser workspace as encrypted', async () => {
    legacy = new WorkspaceDatabase(`security-legacy-${crypto.randomUUID()}`);
    const status = workspaceSecurityStatus(legacy.asStorage());
    expect(status).toMatchObject({
      mode: 'legacy',
      state: 'legacy',
      contentRequiresUnlock: false,
      requiresHumanUnlock: false,
    });
    expect(status).not.toHaveProperty('cipher');
    expect(status).not.toHaveProperty('vaultSchemaVersion');
    expect(await new Repository(legacy).request('/workspace/security')).toEqual(status);
  });

  it('limits the lock bypass to the exact read-only discovery path', () => {
    expect(isWorkspaceSecurityDiscovery('/workspace/security', 'GET')).toBe(true);
    expect(isWorkspaceSecurityDiscovery('/api/v1/workspace/security', 'GET')).toBe(true);
    for (const path of [
      '/workspace/security?details=true',
      '/workspace/security/',
      '/workspace/security#unlock',
      '/workspace/security/keys',
      '/workspace/unlock',
      '/workspace/export',
      '/workspace/import',
    ])
      expect(isWorkspaceSecurityDiscovery(path, 'GET')).toBe(false);
    expect(isWorkspaceLockCommand('/workspace/lock', 'POST')).toBe(true);
    expect(isWorkspaceLockCommand('/api/v1/workspace/lock', 'POST')).toBe(true);
    for (const path of ['/workspace/lock/', '/workspace/lock?force=true', '/workspace/unlock'])
      expect(isWorkspaceLockCommand(path, 'POST')).toBe(false);
    expect(isWorkspaceLockCommand('/workspace/lock', 'GET')).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(isWorkspaceSecurityDiscovery('/workspace/security', method)).toBe(false);
  });

  it('offers no programmatic password, recovery or session-policy setting controls', async () => {
    legacy = new WorkspaceDatabase(`security-controls-${crypto.randomUUID()}`);
    const repo = new Repository(legacy);
    await expect(
      repo.request('/workspace/security', 'POST', { password: 'secret' }),
    ).rejects.toMatchObject({ status: 405 });
    for (const key of ['vault-password', 'vault-recovery-key', 'vault-session-policy']) {
      await expect(
        repo.request(`/settings/${key}`, 'PUT', { value: 'secret' }),
      ).rejects.toMatchObject({ status: 422 });
      expect(await legacy.settings.get(key)).toBeUndefined();
    }
    for (const path of ['/workspace/unlock', '/workspace/recover', '/workspace/session-policy'])
      await expect(repo.request(path, 'POST', {})).rejects.toMatchObject({ status: 404 });
  });
});
