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

it('keeps a newly saved explicit address when an earlier first grant resumes', async () => {
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
  expect(useEditor.getState()).toMatchObject({ bridgeUrl: address, mcpAccess: 'write' });
  workspace.stop();
  workspace = new Workspace(new Repository(db));
  await workspace.start();
  expect((await db.settings.get('bridge-url'))?.value).toBe(address);
  expect(useEditor.getState()).toMatchObject({ bridgeUrl: address, mcpAccess: 'write' });
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
