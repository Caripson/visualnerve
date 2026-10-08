import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { blankGraph, newNode, type Graph } from '../src/model/types';

const password = 'test-only workspace lifecycle password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let repo: Repository, workspace: Workspace, original: Graph;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function graph(name: string) {
  const value = blankGraph(name);
  value.nodes = [newNode(value.diagram.id, { title: `${name} node` })];
  return value;
}
async function reunlock() {
  await session.lock();
  await session.unlock(password);
  await workspace.start();
}
type HeldMethod = 'importGraph' | 'restore' | 'removeDiagram' | 'clearAll' | 'saveGraph';
function holdRepository(method: HeldMethod) {
  const paused = gate(),
    entered = gate();
  const implementation = Repository.prototype[method];
  vi.spyOn(Repository.prototype, method).mockImplementationOnce(async function (
    this: Repository,
    ...args: unknown[]
  ) {
    entered.release();
    await paused.promise;
    return Reflect.apply(implementation, this, args);
  });
  return { paused, entered };
}

beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '', clipboard: null });
  physical = new VaultRecordStorage(`vault-workspace-lifecycle-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  repo = new Repository(db);
  workspace = new Workspace(repo);
  session.onLock(() => workspace.clearUnlockedState());
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
    { key: 'theme', value: 'light' },
    { key: 'import-file-limit-mb', value: 100 },
  ]);
  original = await repo.saveGraph(graph('Private saved diagram'), 0);
  await workspace.start();
  await workspace.open(original.diagram.id);
});
afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  db.dispose();
  await session.dispose();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(physical.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Workspace lifecycle fixture remained open.'));
  });
  vi.unstubAllGlobals();
});
afterAll(() => cipher.destroyKeys(created.keys));

describe('workspace jobs cannot cross encrypted session or app lifecycles', () => {
  it.each([
    ['mcp-access', 'write', 'write'],
    ['theme', 'dark', 'light'],
    ['import-file-limit-mb', 200, 100],
  ] as const)(
    'fences a queued %s choice before the write and never republishes its grant or failure',
    async (key, value, previous) => {
      const paused = gate(),
        entered = gate();
      const atomic = EncryptedWorkspaceDatabase.prototype.atomic;
      let held = false;
      vi.spyOn(EncryptedWorkspaceDatabase.prototype, 'atomic').mockImplementation(async function (
        this: EncryptedWorkspaceDatabase,
        mode,
        stores,
        work,
      ) {
        if (!held && mode === 'rw' && stores.length === 1 && stores[0] === 'settings') {
          held = true;
          entered.release();
          await paused.promise;
        }
        return atomic.call(this, mode, stores, work);
      });
      const pending = expect(workspace.setPreference(key, value)).rejects.toMatchObject({
        status: 423,
      });
      await entered.promise;
      try {
        await reunlock();
      } finally {
        paused.release();
      }
      await pending;
      expect((await db.settings.get(key))?.value).toBe(previous);
      expect(useEditor.getState()).toMatchObject({
        mcpAccess: 'off',
        preferenceError: null,
        theme: 'light',
        importFileLimitMb: 100,
      });
      await workspace.setPreference('mcp-access', 'read');
      expect(useEditor.getState().mcpAccess).toBe('read');
      await workspace.refresh();
      expect(useEditor.getState().privacyAcknowledged).toBe(true);
    },
  );

  it.each(['create', 'restore', 'remove', 'deleteAll', 'resolve-copy', 'resolve-retry'] as const)(
    'retains the originating capability for a delayed %s operation',
    async (action) => {
      const backup = action === 'restore' ? await db.backup() : undefined;
      if (backup) backup.diagrams[0].name = 'Old session replacement';
      const method: HeldMethod =
        action === 'create' || action === 'resolve-copy'
          ? 'importGraph'
          : action === 'restore'
            ? 'restore'
            : action === 'remove'
              ? 'removeDiagram'
              : action === 'deleteAll'
                ? 'clearAll'
                : 'saveGraph';
      const held = holdRepository(method);
      if (action.startsWith('resolve-'))
        useEditor.setState({
          graph: {
            ...original,
            nodes: [{ ...original.nodes[0], title: 'Private unsaved conflict' }],
          },
          status: 'conflict',
        });
      const work =
        action === 'create'
          ? workspace.create(graph('Old session import'))
          : action === 'restore'
            ? workspace.restoreBackup(backup!, 'replace')
            : action === 'remove'
              ? workspace.remove(original.diagram.id)
              : action === 'deleteAll'
                ? workspace.deleteAll()
                : workspace.resolve(action === 'resolve-copy' ? 'copy' : 'retry');
      const pending = expect(work).rejects.toMatchObject({ status: 423 });
      await held.entered.promise;
      try {
        await reunlock();
      } finally {
        held.paused.release();
      }
      await pending;
      expect(await repo.getGraph(original.diagram.id)).toEqual(original);
      expect(await db.diagrams.count()).toBe(1);
      expect(useEditor.getState().graph).toEqual(original);
      expect(useEditor.getState()).toMatchObject({
        status: 'saved',
        message: '',
        mcpAccess: 'off',
        preferenceError: null,
      });
    },
  );

  it('rejects a loaded graph after lock/unlock before navigation or last-diagram persistence', async () => {
    const other = await repo.saveGraph(graph('Other private diagram'), 0);
    const paused = gate(),
      entered = gate();
    const pending = expect(
      workspace.open(other.diagram.id, undefined, async () => {
        entered.release();
        await paused.promise;
      }),
    ).rejects.toMatchObject({ status: 423 });
    await entered.promise;
    try {
      await reunlock();
    } finally {
      paused.release();
    }
    await pending;
    expect(useEditor.getState().graph).toEqual(original);
    expect((await db.settings.get('last-diagram'))?.value).toBe(original.diagram.id);
  });

  it('keeps the newest navigation when two graph loads finish in the opposite order', async () => {
    const other = await repo.saveGraph(graph('Slower diagram'), 0);
    const paused = gate(),
      entered = gate();
    const pending = workspace.open(other.diagram.id, undefined, async () => {
      entered.release();
      await paused.promise;
    });
    await entered.promise;
    await workspace.open(original.diagram.id);
    paused.release();
    await pending;
    expect(useEditor.getState().graph).toEqual(original);
    expect((await db.settings.get('last-diagram'))?.value).toBe(original.diagram.id);
  });

  it('does not publish an old open after stop and a fresh app start', async () => {
    const other = await repo.saveGraph(graph('Obsolete app graph'), 0);
    const paused = gate(),
      entered = gate();
    const pending = expect(
      workspace.open(other.diagram.id, undefined, async () => {
        entered.release();
        await paused.promise;
      }),
    ).rejects.toMatchObject({ status: 409 });
    await entered.promise;
    workspace.stop();
    await workspace.start();
    paused.release();
    await pending;
    expect(useEditor.getState().graph).toEqual(original);
  });

  it('never installs a stale startup observer after a newer unlocked app starts', async () => {
    workspace.stop();
    const paused = gate(),
      entered = gate();
    const initialize = EncryptedWorkspaceDatabase.prototype.initialize;
    vi.spyOn(EncryptedWorkspaceDatabase.prototype, 'initialize').mockImplementationOnce(
      async function (this: EncryptedWorkspaceDatabase) {
        entered.release();
        await paused.promise;
        return initialize.call(this);
      },
    );
    const subscribe = vi.spyOn(EncryptedWorkspaceDatabase.prototype, 'subscribe');
    const pending = expect(workspace.start()).rejects.toMatchObject({ status: 423 });
    await entered.promise;
    try {
      await reunlock();
    } finally {
      paused.release();
    }
    await pending;
    expect(subscribe).toHaveBeenCalledOnce();
    expect(useEditor.getState().graph).toEqual(original);
    expect(useEditor.getState().mcpAccess).toBe('off');
  });

  it('clears editor/history/clipboard and retained queued graph references before a paused save drains', async () => {
    const held = holdRepository('saveGraph');
    useEditor.getState().updateNode(original.nodes[0].id, { title: 'Private unsaved autosave' });
    await held.entered.promise;
    useEditor.setState({ selectedNodes: [original.nodes[0].id] });
    useEditor.getState().copy();
    expect(useEditor.getState().clipboard!.nodes[0].title).toBe('Private unsaved autosave');
    const locking = session.lock();
    await expect.poll(() => useEditor.getState().graph).toBeNull();
    expect(useEditor.getState()).toMatchObject({
      history: [],
      future: [],
      clipboard: null,
      preferenceError: null,
      mcpAccess: 'off',
    });
    const saves = (workspace as unknown as { queuedSaves: Set<{ graph?: Graph }> }).queuedSaves;
    expect([...saves].every((save) => save.graph === undefined)).toBe(true);
    held.paused.release();
    await locking;
    await session.unlock(password);
    await workspace.start();
    expect(await repo.getGraph(original.diagram.id)).toEqual(original);
    expect(useEditor.getState().graph).toEqual(original);
  });

  it('borrows the caller capability for external reads without disposing it or recapturing a new session', async () => {
    await workspace.setPreference('mcp-access', 'read');
    const operation = await db.captureOperation();
    const dispose = vi.spyOn(operation, 'dispose');
    expect(
      await workspace.external(`/diagrams/${original.diagram.id}`, 'GET', undefined, operation),
    ).toEqual(original);
    expect(dispose).not.toHaveBeenCalled();
    await operation.check();
    await reunlock();
    await workspace.setPreference('mcp-access', 'read');
    await expect(
      workspace.external(`/diagrams/${original.diagram.id}`, 'GET', undefined, operation),
    ).rejects.toMatchObject({ status: 423 });
    expect(dispose).not.toHaveBeenCalled();
    operation.dispose();
  });
});
