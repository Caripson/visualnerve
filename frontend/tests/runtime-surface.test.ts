import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let runtime: typeof import('../src/storage/runtime') | undefined;
let legacy: typeof import('../src/storage/database') | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  document.head
    .querySelectorAll('meta[name="visualnerve-vault-required"]')
    .forEach((meta) => meta.remove());
});
afterEach(async () => {
  if (runtime?.vaultSession) {
    runtime.workspaceStorage.close();
    await runtime.vaultSession.dispose();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(runtime!.workspaceStorage.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Isolated runtime fixture was left open.'));
    });
  }
  if (legacy) await legacy.database.delete();
  runtime = undefined;
  legacy = undefined;
  document.head
    .querySelectorAll('meta[name="visualnerve-vault-required"]')
    .forEach((meta) => meta.remove());
  vi.unstubAllGlobals();
});

describe('runtime workspace selection', () => {
  it('keeps existing legacy storage authoritative on the legacy website surface', async () => {
    legacy = await import('../src/storage/database');
    await legacy.database.settings.put({
      key: 'private-existing-preference',
      value: 'Existing private value',
    });
    runtime = await import('../src/storage/runtime');
    expect(runtime.vaultSession).toBeUndefined();
    expect(runtime.workspaceStorage).toBe(legacy.database.asStorage());
    expect(await runtime.workspaceStorage.settings.get('private-existing-preference')).toEqual({
      key: 'private-existing-preference',
      value: 'Existing private value',
    });
  });

  it('uses the encrypted backend on a marked isolated app and never opens the plaintext database', async () => {
    const marker = document.createElement('meta');
    marker.name = 'visualnerve-vault-required';
    marker.content = 'true';
    document.head.append(marker);
    const open = vi.spyOn(indexedDB, 'open');
    runtime = await import('../src/storage/runtime');
    expect(runtime.vaultSession).toBeDefined();
    expect(runtime.workspaceStorage.name).toBe('visual-nerve-vault');
    await runtime.vaultSession!.initialize();
    await expect(
      runtime.workspaceStorage.settings.get('private-existing-preference'),
    ).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    expect(open.mock.calls.some(([name]) => name === 'visual-nerve-cache')).toBe(false);
    expect((await indexedDB.databases()).map((entry) => entry.name)).toEqual([
      'visual-nerve-vault',
    ]);
    open.mockRestore();
  });

  it('requires encryption on app.visualnerve.com even if its marker is missing', async () => {
    vi.stubGlobal('location', { hostname: 'app.visualnerve.com' });
    const open = vi.spyOn(indexedDB, 'open');
    runtime = await import('../src/storage/runtime');
    expect(runtime.vaultSession).toBeDefined();
    expect(runtime.workspaceStorage.name).toBe('visual-nerve-vault');
    await expect(runtime.workspaceStorage.open()).rejects.toMatchObject({ status: 423 });
    expect(open.mock.calls.some(([name]) => name === 'visual-nerve-cache')).toBe(false);
    open.mockRestore();
  });
});
