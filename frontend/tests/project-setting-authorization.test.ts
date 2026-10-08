import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { PROJECT_SOURCE_FILE_LIMIT_SETTING } from '../src/code/project/limits';

let db: WorkspaceDatabase;
let workspace: Workspace;
beforeEach(async () => {
  db = new WorkspaceDatabase(`project-setting-auth-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.put({ key: 'storage-consent', value: true });
  await db.settings.put({ key: PROJECT_SOURCE_FILE_LIMIT_SETTING, value: 500 });
  useEditor.getState().setGraph(null);
  useEditor.setState({
    mcpAccess: 'off',
    projectSourceFileLimit: 500,
    status: 'saved',
    message: '',
  });
  workspace = new Workspace(new Repository(db));
  await workspace.start();
  await workspace.setPreference('mcp-access', 'write');
});
afterEach(async () => {
  workspace.stop();
  vi.restoreAllMocks();
  useEditor.setState({ mcpAccess: 'off', projectSourceFileLimit: 500 });
  await db.delete();
});

it.each(['read', 'off', 'storage'] as const)(
  'rechecks authorization inside the setting transaction after %s revocation while queued',
  async (revocation) => {
    const original = workspace.repo.request.bind(workspace.repo);
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const checked = vi.fn();
    vi.spyOn(workspace.repo, 'request').mockImplementation(
      async (path, method, payload, options) => {
        if (path !== `/settings/${PROJECT_SOURCE_FILE_LIMIT_SETTING}` || method !== 'PUT')
          return original(path, method, payload, options);
        // The external command passed initial authorization, but has not entered
        // its IndexedDB transaction yet. Another task can revoke its live grant.
        entered();
        await gate;
        return original(path, method, payload, {
          ...options,
          beforeWrite: async () => {
            expect(Dexie.currentTransaction?.mode).toBe('readwrite');
            checked();
            await options?.beforeWrite?.();
          },
        });
      },
    );
    const pending = workspace.external(`/settings/${PROJECT_SOURCE_FILE_LIMIT_SETTING}`, 'PUT', {
      value: 1000,
    });
    const rejected = expect(pending).rejects.toMatchObject({ status: 403 });
    await started;
    if (revocation === 'storage') {
      await db.settings.delete('storage-consent');
      useEditor.setState({ privacyAcknowledged: false });
    } else await workspace.setPreference('mcp-access', revocation);
    release();
    await rejected;
    expect(checked).toHaveBeenCalledOnce();
    expect((await db.settings.get(PROJECT_SOURCE_FILE_LIMIT_SETTING))?.value).toBe(500);
    expect(useEditor.getState().projectSourceFileLimit).toBe(500);
  },
);
