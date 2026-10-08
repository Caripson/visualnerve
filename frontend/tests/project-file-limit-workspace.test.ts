import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { settingWrites } from './workspace-test-hooks';
import { PROJECT_SOURCE_FILE_LIMIT_SETTING } from '../src/code/project/limits';
import { useEditor } from '../src/state/editor';

let db: WorkspaceDatabase;
let workspace: Workspace;

beforeEach(async () => {
  db = new WorkspaceDatabase(`project-file-limit-${crypto.randomUUID()}`);
  workspace = new Workspace(new Repository(db));
  useEditor.getState().setGraph(null);
  useEditor.setState({ projectSourceFileLimit: 500, status: 'saved', message: '' });
  await db.initialize();
  await db.settings.put({ key: 'storage-consent', value: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  workspace.stop();
  useEditor.setState({ projectSourceFileLimit: 500 });
  await db.delete();
});

it('persists a valid browser preference and reloads it through workspace refresh', async () => {
  await workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 10000);
  expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(10000);
  expect(useEditor.getState().projectSourceFileLimit).toBe(10000);
  useEditor.setState({ projectSourceFileLimit: 500 });
  await workspace.refresh();
  expect(useEditor.getState().projectSourceFileLimit).toBe(10000);
});

it('normalizes missing or invalid saved values without rewriting unrelated preferences', async () => {
  await db.settings.put({ key: 'theme', value: 'dark' });
  for (const value of [undefined, '1000', 499, 10001, 500.5]) {
    if (value === undefined) await db.settings.delete(PROJECT_SOURCE_FILE_LIMIT_SETTING);
    else await db.settings.put({ key: PROJECT_SOURCE_FILE_LIMIT_SETTING, value });
    useEditor.setState({ projectSourceFileLimit: 10000 });
    await workspace.refresh();
    expect(useEditor.getState().projectSourceFileLimit).toBe(500);
    expect(useEditor.getState().theme).toBe('dark');
    expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(value);
  }
});

it('rejects invalid preference writes without changing the active or stored limit', async () => {
  await workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 1000);
  for (const value of ['1000', 499, 10001, 500.5, null, NaN]) {
    await expect(
      workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, value),
    ).rejects.toMatchObject({
      status: 422,
    });
    expect(useEditor.getState().projectSourceFileLimit).toBe(1000);
    expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(1000);
  }
});

it('keeps the committed active limit if the preference cannot be stored', async () => {
  await workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 1000);
  settingWrites(db).mockRejectedValueOnce(new Error('Browser storage is full.'));
  await expect(workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 2000)).rejects.toThrow(
    'Browser storage is full.',
  );
  expect(useEditor.getState().projectSourceFileLimit).toBe(1000);
  expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(1000);
});

it('excludes the device import limit from a workspace backup while retaining theme', async () => {
  await workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 10000);
  await db.settings.put({ key: 'theme', value: 'dark' });
  const backup = await db.backup();
  expect(backup.settings).toEqual([{ key: 'theme', value: 'dark' }]);
  expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(10000);
});

it('requires storage consent before changing an import preference', async () => {
  await db.settings.delete('storage-consent');
  await expect(
    workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 1000),
  ).rejects.toMatchObject({
    status: 403,
  });
  expect(await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING)).toBeUndefined();
  expect(useEditor.getState().projectSourceFileLimit).toBe(500);
});

it.each(['merge', 'replace'] as const)(
  'retains the destination count on %s restore and ignores the imported setting',
  async (mode) => {
    await workspace.setPreference(PROJECT_SOURCE_FILE_LIMIT_SETTING, 1000);
    const backup = await db.backup();
    backup.settings.push({ key: PROJECT_SOURCE_FILE_LIMIT_SETTING, value: 10000 });
    await new Repository(db).restore(backup, mode);
    expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(1000);
    await workspace.refresh();
    expect(useEditor.getState().projectSourceFileLimit).toBe(1000);
    await db.settings.delete(PROJECT_SOURCE_FILE_LIMIT_SETTING);
    await new Repository(db).restore(backup, mode);
    expect(await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING)).toBeUndefined();
    await workspace.refresh();
    expect(useEditor.getState().projectSourceFileLimit).toBe(500);
  },
);
