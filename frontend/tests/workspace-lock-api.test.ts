import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultLogicalRecordCodec } from '../src/security/vault-logical-record';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { EncryptedWorkspaceDatabase } from '../src/storage/encrypted-database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';

const password = 'workspace lock API fixture password';
const cipher = new VaultCrypto(webcrypto as unknown as Crypto);
let created: Awaited<ReturnType<VaultCrypto['createVault']>>;
let physical: VaultRecordStorage, session: VaultSession, db: EncryptedWorkspaceDatabase;
let workspace: Workspace;
beforeAll(async () => {
  created = await cipher.createVault(password);
});
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  physical = new VaultRecordStorage(`vault-lock-api-${crypto.randomUUID()}`);
  await physical.create(created.header);
  session = new VaultSession(physical, cipher);
  await session.initialize();
  await session.unlock(password);
  db = new EncryptedWorkspaceDatabase(session, new VaultLogicalRecordCodec(cipher));
  workspace = new Workspace(new Repository(db));
  session.onLock(() => workspace.clearUnlockedState());
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  await workspace.start();
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
    request.onblocked = () => reject(new Error('Lock fixture remained open'));
  });
  vi.unstubAllGlobals();
});
afterAll(() => cipher.destroyKeys(created.keys));
it('requires a fresh write grant and returns safe metadata after intentionally revoking the original lease', async () => {
  await expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 403,
  });
  await workspace.setPreference('mcp-access', 'read');
  await expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 403,
  });
  await workspace.setPreference('mcp-access', 'write');
  const origin = await db.captureOperation();
  try {
    expect(await workspace.external('/workspace/lock', 'POST', {}, origin)).toMatchObject({
      state: 'locked',
      programmaticLock: true,
      programmaticUnlock: false,
    });
    expect(origin.signal.aborted).toBe(true);
    await expect(origin.check()).rejects.toMatchObject({ status: 423 });
  } finally {
    origin.dispose();
  }
  const epoch = (await physical.control())!.epoch;
  expect(await workspace.external('/workspace/lock', 'POST')).toMatchObject({ state: 'locked' });
  expect((await physical.control())!.epoch).toBe(epoch);
  await expect(workspace.external('/diagrams', 'GET')).rejects.toMatchObject({
    status: 423,
    code: 'WORKSPACE_LOCKED',
  });
  await session.unlock(password);
  await workspace.start();
  await expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 403,
  });
  await workspace.setPreference('mcp-access', 'write');
  expect(await workspace.external('/api/v1/workspace/lock', 'POST')).toMatchObject({
    state: 'locked',
  });
});
it.each([null, [], true, '', { password: 'no' }, { force: true }, Object.create({ hidden: true })])(
  'rejects nonempty or nonobject lock bodies without changing the session: %j',
  async (body) => {
    await workspace.setPreference('mcp-access', 'write');
    await expect(workspace.external('/workspace/lock', 'POST', body)).rejects.toMatchObject({
      status: 422,
    });
    expect(session.getSnapshot().status).toBe('unlocked');
  },
);
it('keeps unsaved edits and the unlocked session when the explicit save-before-lock fails', async () => {
  await workspace.setPreference('mcp-access', 'write');
  vi.spyOn(workspace, 'settled').mockRejectedValueOnce(new Error('Quota blocked pending edits'));
  await expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toThrow('Quota blocked');
  expect(session.getSnapshot().status).toBe('unlocked');
});
it('rechecks a revoked write grant after pending durable saves settle', async () => {
  await workspace.setPreference('mcp-access', 'write');
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(workspace, 'settled').mockImplementationOnce(() => {
    entered();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const pending = expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 403,
  });
  await ready;
  await workspace.setPreference('mcp-access', 'off');
  release();
  await pending;
  expect(session.getSnapshot().status).toBe('unlocked');
});
it('never adopts a new human session when a lock request was queued under the old one', async () => {
  await workspace.setPreference('mcp-access', 'write');
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(workspace, 'settled').mockImplementationOnce(() => {
    entered();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const pending = expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 423,
  });
  await ready;
  await session.lock();
  await session.unlock(password);
  await workspace.start();
  await workspace.setPreference('mcp-access', 'write');
  release();
  await pending;
  expect(session.getSnapshot().status).toBe('unlocked');
});

it('rejects a cross-tab grant change after the authorization snapshot without invalidating live keys', async () => {
  await workspace.setPreference('mcp-access', 'write');
  const implementation = session.lockAuthorized.bind(session);
  vi.spyOn(session, 'lockAuthorized').mockImplementationOnce(
    async (revision, signal, authorizeCurrent) => {
      // The other tab changes authoritative Settings before the durable guarded lock.
      // Local editor state intentionally remains Write until its observer catches up.
      await db.settings.put({ key: 'mcp-access', value: 'off' });
      return implementation(revision, signal, authorizeCurrent);
    },
  );
  await expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 409,
  });
  expect(session.getSnapshot().status).toBe('unlocked');
  expect((await db.settings.get('mcp-access'))?.value).toBe('off');
});

it('honors immediate local Off inside the native lock while its encrypted preference is still preparing', async () => {
  await workspace.setPreference('mcp-access', 'write');
  let enteredLock!: () => void,
    releaseLock!: () => void,
    enteredWrite!: () => void,
    releaseWrite!: () => void;
  const lockReady = new Promise<void>((resolve) => {
    enteredLock = resolve;
  });
  const lockGate = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const writeReady = new Promise<void>((resolve) => {
    enteredWrite = resolve;
  });
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const nativeLock = physical.lock.bind(physical);
  vi.spyOn(physical, 'lock').mockImplementationOnce(async (lease, revision, authorizeCurrent) => {
    enteredLock();
    await lockGate;
    return nativeLock(lease, revision, authorizeCurrent);
  });
  const atomic = EncryptedWorkspaceDatabase.prototype.atomic;
  let holdWrite = false;
  vi.spyOn(EncryptedWorkspaceDatabase.prototype, 'atomic').mockImplementation(async function (
    this: EncryptedWorkspaceDatabase,
    mode,
    stores,
    work,
  ) {
    if (holdWrite && mode === 'rw' && stores.length === 1 && stores[0] === 'settings') {
      holdWrite = false;
      enteredWrite();
      await writeGate;
    }
    return atomic.call(this, mode, stores, work);
  });
  const pending = expect(workspace.external('/workspace/lock', 'POST', {})).rejects.toMatchObject({
    status: 403,
  });
  await lockReady;
  holdWrite = true;
  const off = workspace.setPreference('mcp-access', 'off');
  try {
    await writeReady;
    expect(useEditor.getState().mcpAccess).toBe('off');
    expect((await db.settings.get('mcp-access'))?.value).toBe('write');
    releaseLock();
    await pending;
    expect(session.getSnapshot().status).toBe('unlocked');
    expect((await physical.control())!.locked).toBe(false);
  } finally {
    releaseLock();
    releaseWrite();
    await off;
  }
});
