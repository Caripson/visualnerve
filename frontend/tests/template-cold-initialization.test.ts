import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';

it.each([
  ['native', 'clear'],
  ['native', 'restore'],
  ['encrypted', 'clear'],
  ['encrypted', 'restore'],
] as const)(
  'prepares cold template code before %s %s opens its seed transaction',
  async (backend, action) => {
    vi.resetModules();
    const factory = await import('../src/templates/factory');
    expect(() => factory.preparedTemplateFactory()).toThrow(/Prepare/);
    const { Repository } = await import('../src/storage/repository');
    const { blankGraph } = await import('../src/model/types');
    const { templates } = await import('../src/templates/catalog');
    const { WorkspaceDatabase } = await import('../src/storage/database');
    let dispose: () => Promise<void>;
    let storage: import('../src/storage/contracts').WorkspaceStorage;
    if (backend === 'native') {
      const db = new WorkspaceDatabase(`cold-native-${crypto.randomUUID()}`);
      await db.open();
      storage = db.asStorage();
      dispose = () => db.delete();
    } else {
      const { VaultCrypto } = await import('../src/security/vault-crypto');
      const { VaultRecordStorage } = await import('../src/security/vault-storage');
      const { VaultSession } = await import('../src/security/vault-session');
      const { VaultLogicalRecordCodec } = await import('../src/security/vault-logical-record');
      const { EncryptedWorkspaceDatabase } = await import('../src/storage/encrypted-database');
      const cipher = new VaultCrypto(webcrypto as unknown as Crypto),
        password = 'synthetic cold template regression';
      const vault = await cipher.createVault(password),
        physical = new VaultRecordStorage(`cold-encrypted-${crypto.randomUUID()}`);
      await physical.create(vault.header);
      const session = new VaultSession(physical, cipher);
      await session.initialize();
      await session.unlock(password);
      const db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
      await db.open();
      storage = db;
      dispose = async () => {
        db.dispose();
        await session.dispose();
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(physical.name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Fixture database remained open.'));
        });
      };
    }
    try {
      const repo = new Repository(storage);
      const graph = await repo.importGraph(blankGraph('Synthetic cold seed', 'flowchart'));
      const backup = await storage.backup();
      // Importing a normal graph/reading its backup does not happen to warm the factory.
      expect(() => factory.preparedTemplateFactory()).toThrow(/Prepare/);
      if (action === 'clear') await repo.clearAll();
      else await repo.restore(backup, 'replace');
      expect(factory.preparedTemplateFactory()).toBeTypeOf('function');
      expect(await storage.templates.count()).toBe(templates.length);
      expect(await storage.diagrams.count()).toBe(action === 'clear' ? 0 : 1);
      if (action === 'restore')
        expect((await storage.graph(graph.diagram.id))!.diagram.name).toBe('Synthetic cold seed');
    } finally {
      await dispose();
    }
  },
);
