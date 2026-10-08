import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openWorkspaceSurface } from '../src/security/open-workspace';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { WorkspaceDatabase } from '../src/storage/database';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const password = 'workspace-opening original session password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let vault: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
beforeAll(async () => {
  vault = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  physical = new VaultRecordStorage(`workspace-opening-${crypto.randomUUID()}`);
  await physical.create(vault.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
});
afterEach(async () => {
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The opening fixture remained connected.'));
  });
  vi.unstubAllGlobals();
});
afterAll(() => cipher.destroyKeys(vault.keys));

describe('original-session workspace bootstrap', () => {
  it('rejects a late migration-module load after lock and fresh unlock without publishing its marker', async () => {
    let finishImport!: (value: {
      verifyPendingMigration: (storage: EncryptedWorkspaceDatabase) => Promise<undefined>;
    }) => void;
    const module = new Promise<Parameters<typeof finishImport>[0]>((resolve) => {
      finishImport = resolve;
    });
    const loading = vi.fn(() => module);
    const verify = vi.fn(async (storage: EncryptedWorkspaceDatabase) => {
      await storage.settings.put({ key: 'verification-probe', value: 'stale verification' });
      return undefined;
    });
    const opening = openWorkspaceSurface(db, loading);
    const rejected = expect(opening).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
    await vi.waitFor(() => expect(loading).toHaveBeenCalledOnce());
    const originalEpoch = session.getSnapshot().epoch;
    await session.lock();
    await session.unlock(password);
    expect(session.getSnapshot().epoch).not.toBe(originalEpoch);
    await db.settings.put({ key: 'verification-probe', value: 'current session' });
    finishImport({ verifyPendingMigration: verify });
    await rejected;
    expect(verify).not.toHaveBeenCalled();
    expect((await db.settings.get('verification-probe'))?.value).toBe('current session');
  });

  it('verifies using a bound encrypted scope and revokes that scope when opening finishes', async () => {
    let retained: EncryptedWorkspaceDatabase | undefined;
    const verify = vi.fn(async (storage: EncryptedWorkspaceDatabase) => {
      retained = storage;
      expect(storage).not.toBe(db);
      await storage.settings.put({
        key: 'verification-probe',
        value: 'verified under original lease',
      });
      return undefined;
    });
    await openWorkspaceSurface(db, async () => ({ verifyPendingMigration: verify }));
    expect(verify).toHaveBeenCalledOnce();
    expect((await db.settings.get('verification-probe'))?.value).toBe(
      'verified under original lease',
    );
    await expect(retained!.settings.get('verification-probe')).rejects.toMatchObject({
      status: 423,
      code: 'WORKSPACE_LOCKED',
    });
  });

  it('keeps legacy opening independent of encrypted migration modules', async () => {
    const legacy = new WorkspaceDatabase(`legacy-opening-${crypto.randomUUID()}`);
    const loading = vi.fn(async () => ({ verifyPendingMigration: vi.fn() }));
    try {
      await openWorkspaceSurface(legacy.asStorage(), loading);
      expect(legacy.isOpen()).toBe(true);
      expect(loading).not.toHaveBeenCalled();
      await legacy.settings.put({ key: 'legacy-opening-probe', value: 'still editable' });
      expect((await legacy.settings.get('legacy-opening-probe'))?.value).toBe('still editable');
    } finally {
      await legacy.delete();
    }
  });
});
