import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { settingWrites } from './workspace-test-hooks';

let db: WorkspaceDatabase, workspace: Workspace;
const current = 'ws://127.0.0.1:47417/bridge';
const legacy = 'ws://127.0.0.1:4317/bridge';

beforeEach(async () => {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('location', new URL('https://app.visualnerve.com/'));
  useEditor.getState().setGraph(null);
  useEditor.setState({ mcpAccess: 'off', bridgeUrl: '', status: 'saved', message: '' });
  db = new WorkspaceDatabase(`mcp-port-${crypto.randomUUID()}`);
  await db.settings.put({ key: 'storage-consent', value: true });
  workspace = new Workspace(new Repository(db));
});

afterEach(async () => {
  workspace.stop();
  sessionStorage.clear();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['off', 'read', 'write'] as const)(
  'pins the new address with the first %s choice and retains it after reload',
  async (access) => {
    await workspace.start();
    expect(useEditor.getState().bridgeUrl).toBe(current);
    expect(await db.settings.get('bridge-url')).toBeUndefined();
    await workspace.setPreference('mcp-access', access);
    expect((await db.settings.get('bridge-url'))?.value).toBe(current);
    workspace.stop();
    workspace = new Workspace(new Repository(db));
    await workspace.start();
    expect(useEditor.getState()).toMatchObject({ bridgeUrl: current, mcpAccess: access });
  },
);

it.each(['off', 'read', 'write'] as const)(
  'preserves an existing implicit legacy address for a saved %s choice',
  async (access) => {
    await db.settings.put({ key: 'mcp-access', value: access });
    await workspace.start();
    expect(useEditor.getState().bridgeUrl).toBe(legacy);
    await workspace.setPreference('mcp-access', 'write');
    expect((await db.settings.get('bridge-url'))?.value).toBe(legacy);
    await workspace.setPreference('bridge-url', current);
    await workspace.refresh();
    expect(useEditor.getState().bridgeUrl).toBe(current);
  },
);

it.each([legacy, current, 'wss://localhost:9443/bridge'])(
  'keeps an explicit connection address %s across access choices',
  async (address) => {
    await db.settings.put({ key: 'bridge-url', value: address });
    await workspace.start();
    await workspace.setPreference('mcp-access', 'read');
    await workspace.refresh();
    expect((await db.settings.get('bridge-url'))?.value).toBe(address);
    expect(useEditor.getState().bridgeUrl).toBe(address);
  },
);

it('keeps a newly saved explicit address and revokes an earlier pending grant', async () => {
  await workspace.start();
  const writes = settingWrites(db);
  const write = writes.getMockImplementation()!;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  writes.mockImplementationOnce(async (storage, work) => {
    enter();
    await paused;
    return write(storage, work);
  });
  const pendingGrant = workspace.setPreference('mcp-access', 'write');
  await entered;
  const address = 'wss://localhost:9443/bridge';
  try {
    await workspace.setPreference('bridge-url', address);
    expect((await db.settings.get('bridge-url'))?.value).toBe(address);
    expect(useEditor.getState()).toMatchObject({ bridgeUrl: address, mcpAccess: 'off' });
  } finally {
    release();
  }
  await pendingGrant;
  expect((await db.settings.get('bridge-url'))?.value).toBe(address);
  expect(useEditor.getState()).toMatchObject({ bridgeUrl: address, mcpAccess: 'off' });
  workspace.stop();
  workspace = new Workspace(new Repository(db));
  await workspace.start();
  expect((await db.settings.get('bridge-url'))?.value).toBe(address);
  expect(useEditor.getState()).toMatchObject({ bridgeUrl: address, mcpAccess: 'off' });
});

it('rolls back both the pinned connection and grant if their transaction fails', async () => {
  await workspace.start();
  const writes = settingWrites(db);
  const write = writes.getMockImplementation()!;
  writes.mockImplementationOnce((storage, work) =>
    write(storage, async (scope) => {
      await work(scope);
      throw new DOMException('Settings could not be saved', 'QuotaExceededError');
    }),
  );
  await expect(workspace.setPreference('mcp-access', 'write')).rejects.toThrow(
    'Settings could not be saved',
  );
  expect(await db.settings.get('bridge-url')).toBeUndefined();
  expect(await db.settings.get('mcp-access')).toBeUndefined();
  expect(useEditor.getState().mcpAccess).toBe('off');
  await workspace.refresh();
  expect(useEditor.getState().bridgeUrl).toBe(current);
  await workspace.setPreference('mcp-access', 'read');
  expect((await db.settings.get('bridge-url'))?.value).toBe(current);
  expect(useEditor.getState().mcpAccess).toBe('read');
});

it('revokes access immediately and saves the new address and Off in one transaction', async () => {
  await db.settings.put({ key: 'bridge-url', value: legacy });
  await db.settings.put({ key: 'mcp-access', value: 'write' });
  await workspace.start();
  const pending = workspace.setPreference('bridge-url', current);
  expect(useEditor.getState().mcpAccess).toBe('off');
  await expect(workspace.setPreference('mcp-access', 'write')).rejects.toThrow(/finish saving/);
  await pending;
  expect((await db.settings.get('mcp-access'))?.value).toBe('off');
  expect((await db.settings.get('bridge-url'))?.value).toBe(current);
  await workspace.refresh();
  expect(useEditor.getState()).toMatchObject({ mcpAccess: 'off', bridgeUrl: current });
  await workspace.setPreference('mcp-access', 'read');
  expect(useEditor.getState().mcpAccess).toBe('read');
});

it('keeps the saved address and live access revoked if a connection transaction fails', async () => {
  await db.settings.put({ key: 'bridge-url', value: legacy });
  await db.settings.put({ key: 'mcp-access', value: 'write' });
  await workspace.start();
  const writes = settingWrites(db);
  const write = writes.getMockImplementation()!;
  writes.mockImplementationOnce((storage, work) =>
    write(storage, async (scope) => {
      await work(scope);
      throw new DOMException('Connection not saved', 'QuotaExceededError');
    }),
  );
  await expect(workspace.setPreference('bridge-url', current)).rejects.toThrow(
    'Connection not saved',
  );
  expect((await db.settings.get('bridge-url'))?.value).toBe(legacy);
  expect((await db.settings.get('mcp-access'))?.value).toBe('write');
  expect(useEditor.getState()).toMatchObject({ mcpAccess: 'off', bridgeUrl: legacy });
  await workspace.refresh();
  expect(useEditor.getState().mcpAccess).toBe('off');
});

it('preserves an existing grant when saving the same connection', async () => {
  await db.settings.put({ key: 'bridge-url', value: legacy });
  await workspace.start();
  await workspace.setPreference('mcp-access', 'write');
  await workspace.setPreference('bridge-url', legacy);
  expect(useEditor.getState()).toMatchObject({ mcpAccess: 'write', bridgeUrl: legacy });
});

it('clears the tab token and revokes a live grant when another tab changes the saved destination', async () => {
  await db.settings.put({ key: 'bridge-url', value: legacy });
  sessionStorage.setItem('vn-token', 'LEGACY-TAB-TOKEN');
  await workspace.start();
  expect(sessionStorage.getItem('vn-token')).toBe('LEGACY-TAB-TOKEN');
  await workspace.setPreference('mcp-access', 'write');
  // An independent tab commits a new address and subsequently grants access there.
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: 'bridge-url', value: current });
    await db.settings.put({ key: 'mcp-access', value: 'write' });
  });
  await workspace.refresh();
  expect(sessionStorage.getItem('vn-token')).toBeNull();
  expect(useEditor.getState()).toMatchObject({ bridgeUrl: current, mcpAccess: 'off' });
  await workspace.setPreference('mcp-access', 'read');
  expect(useEditor.getState().mcpAccess).toBe('read');
});

it('rejects a waiting positive grant if another tab changed its reviewed destination', async () => {
  await db.settings.put({ key: 'bridge-url', value: legacy });
  await workspace.start();
  await workspace.setPreference('mcp-access', 'read');
  sessionStorage.setItem('vn-token', 'OLD-TAB-TOKEN');
  const writes = settingWrites(db);
  const write = writes.getMockImplementation()!;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  writes.mockImplementationOnce(async (storage, work) => {
    enter();
    await paused;
    return write(storage, work);
  });
  const pending = workspace.setPreference('mcp-access', 'write');
  const rejected = expect(pending).rejects.toThrow(/bridge address changed/);
  await entered;
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: 'bridge-url', value: current });
    await db.settings.put({ key: 'mcp-access', value: 'off' });
  });
  release();
  await rejected;
  expect((await db.settings.get('mcp-access'))?.value).toBe('off');
  expect(sessionStorage.getItem('vn-token')).toBeNull();
  expect(useEditor.getState().mcpAccess).toBe('off');
  await vi.waitFor(() => expect(useEditor.getState().bridgeUrl).toBe(current));
  await workspace.setPreference('mcp-access', 'write');
  expect(useEditor.getState().mcpAccess).toBe('write');
});
