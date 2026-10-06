import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { IMPORT_LIMIT_SETTING } from '../src/imports/limits';
import { useEditor } from '../src/state/editor';

let db: WorkspaceDatabase;
let workspace: Workspace;

beforeEach(async () => {
  db = new WorkspaceDatabase(`import-limit-${crypto.randomUUID()}`);
  workspace = new Workspace(new Repository(db));
  useEditor.getState().setGraph(null);
  useEditor.setState({ importFileLimitMb: 50, status: 'saved', message: '' });
  await db.initialize();
  await db.settings.put({ key: 'storage-consent', value: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  workspace.stop();
  useEditor.setState({ importFileLimitMb: 50 });
  await db.delete();
});

it('persists a valid browser preference and reloads it through workspace refresh', async () => {
  await workspace.setPreference(IMPORT_LIMIT_SETTING, 256);
  expect((await db.settings.get(IMPORT_LIMIT_SETTING))?.value).toBe(256);
  expect(useEditor.getState().importFileLimitMb).toBe(256);
  useEditor.setState({ importFileLimitMb: 50 });
  await workspace.refresh();
  expect(useEditor.getState().importFileLimitMb).toBe(256);
});

it('normalizes missing or invalid saved values without rewriting unrelated preferences', async () => {
  await db.settings.put({ key: 'theme', value: 'dark' });
  for (const value of [undefined, '100', 49, 1025, 50.5]) {
    if (value === undefined) await db.settings.delete(IMPORT_LIMIT_SETTING);
    else await db.settings.put({ key: IMPORT_LIMIT_SETTING, value });
    useEditor.setState({ importFileLimitMb: 1024 });
    await workspace.refresh();
    expect(useEditor.getState().importFileLimitMb).toBe(50);
    expect(useEditor.getState().theme).toBe('dark');
    expect((await db.settings.get(IMPORT_LIMIT_SETTING))?.value).toBe(value);
  }
});

it('rejects invalid preference writes without changing the active or stored limit', async () => {
  await workspace.setPreference(IMPORT_LIMIT_SETTING, 100);
  for (const value of ['100', 49, 1025, 50.5, null, NaN]) {
    await expect(workspace.setPreference(IMPORT_LIMIT_SETTING, value)).rejects.toMatchObject({
      status: 422,
    });
    expect(useEditor.getState().importFileLimitMb).toBe(100);
    expect((await db.settings.get(IMPORT_LIMIT_SETTING))?.value).toBe(100);
  }
});

it('keeps the committed active limit if the preference cannot be stored', async () => {
  await workspace.setPreference(IMPORT_LIMIT_SETTING, 100);
  vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('Browser storage is full.'));
  await expect(workspace.setPreference(IMPORT_LIMIT_SETTING, 200)).rejects.toThrow(
    'Browser storage is full.',
  );
  expect(useEditor.getState().importFileLimitMb).toBe(100);
  expect((await db.settings.get(IMPORT_LIMIT_SETTING))?.value).toBe(100);
});

it('excludes the device import limit from a workspace backup while retaining theme', async () => {
  await workspace.setPreference(IMPORT_LIMIT_SETTING, 1024);
  await db.settings.put({ key: 'theme', value: 'dark' });
  const backup = await db.backup();
  expect(backup.settings).toEqual([{ key: 'theme', value: 'dark' }]);
  expect((await db.settings.get(IMPORT_LIMIT_SETTING))?.value).toBe(1024);
});

it('requires storage consent before changing an import preference', async () => {
  await db.settings.delete('storage-consent');
  await expect(workspace.setPreference(IMPORT_LIMIT_SETTING, 100)).rejects.toMatchObject({
    status: 403,
  });
  expect(await db.settings.get(IMPORT_LIMIT_SETTING)).toBeUndefined();
  expect(useEditor.getState().importFileLimitMb).toBe(50);
});
