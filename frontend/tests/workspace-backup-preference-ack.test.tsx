import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupNudge } from '../src/components/DataPrivacy';
import { PreferenceSaveNotice } from '../src/components/PreferenceSaveNotice';
import { blankGraph } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace, workspace as applicationWorkspace } from '../src/storage/workspace';
import { settingWrites } from './workspace-test-hooks';

let db: WorkspaceDatabase, workspace: Workspace;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  db = new WorkspaceDatabase(`backup-preference-ack-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  await db.diagrams.bulkPut(
    Array.from({ length: 10 }, (_, index) => blankGraph(`Local diagram ${index + 1}`).diagram),
  );
  workspace = new Workspace(new Repository(db));
  await workspace.start();
  await workspace.open(useEditor.getState().diagrams[0].id);
  vi.spyOn(applicationWorkspace, 'setPreference').mockImplementation((...args) =>
    workspace.setPreference(...args),
  );
});

afterEach(async () => {
  cleanup();
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
});

describe('backup reminder persistence acknowledgement', () => {
  it('disables duplicate retries while saving and keeps a newer preference failure retryable', async () => {
    settingWrites(db).mockRejectedValueOnce(new Error('Backup preference failed'));
    await expect(workspace.setPreference('backup-nudge-dismissed', true)).rejects.toThrow(
      'Backup preference failed',
    );
    const writing = deferred(),
      release = deferred();
    const put = settingWrites(db).getMockImplementation()!;
    const writes = settingWrites(db).mockImplementationOnce((...args) => {
      writing.resolve();
      return release.promise.then(() => put(...args));
    });
    const retries = vi.spyOn(workspace, 'retryPreference');
    render(<PreferenceSaveNotice settings={() => {}} controller={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await writing.promise;
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(retries).toHaveBeenCalledOnce();
    writes.mockRejectedValueOnce(new Error('Theme preference failed'));
    await act(async () => {
      await expect(workspace.setPreference('theme', 'dark')).rejects.toThrow(
        'Theme preference failed',
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Theme preference failed');
    await act(async () => release.resolve());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled());
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Theme preference failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(retries).toHaveBeenNthCalledWith(2, 'theme');
    expect((await db.settings.get('theme'))?.value).toBe('dark');
  });

  it('stays visible until dismissal is stored, then remains dismissed in a reopened workspace', async () => {
    const writing = deferred(),
      release = deferred();
    const put = settingWrites(db).getMockImplementation()!;
    settingWrites(db).mockImplementationOnce((...args) => {
      writing.resolve();
      return release.promise.then(() => put(...args));
    });
    render(<BackupNudge settings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss backup reminder' }));
    await writing.promise;
    expect(screen.getByText('10 local diagrams. Consider exporting a backup.')).toBeVisible();
    expect(useEditor.getState().backupNudgeDismissed).toBe(false);
    expect(await db.settings.get('backup-nudge-dismissed')).toBeUndefined();
    await act(async () => release.resolve());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss backup reminder' })).toBeNull(),
    );
    // The UI disappearance is the acknowledgement used before an immediate reload.
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
    workspace.stop();
    useEditor.setState({ backupNudgeDismissed: false, diagrams: [] });
    workspace = new Workspace(new Repository(db));
    await workspace.start();
    expect(useEditor.getState().diagrams).toHaveLength(10);
    expect(useEditor.getState().backupNudgeDismissed).toBe(true);
    expect(screen.queryByRole('button', { name: 'Dismiss backup reminder' })).toBeNull();
  });

  it('keeps a failed dismissal visible and retryable without an unhandled rejection', async () => {
    settingWrites(db).mockRejectedValueOnce(
      new DOMException('Local storage is full', 'QuotaExceededError'),
    );
    render(
      <>
        <BackupNudge settings={() => {}} />
        <PreferenceSaveNotice settings={() => {}} controller={workspace} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss backup reminder' }));
    await waitFor(() =>
      expect(useEditor.getState().preferenceError).toEqual({
        key: 'backup-nudge-dismissed',
        message: 'Local storage is full',
      }),
    );
    expect(useEditor.getState()).toMatchObject({ status: 'saved', message: '' });
    expect(useEditor.getState().backupNudgeDismissed).toBe(false);
    expect(await db.settings.get('backup-nudge-dismissed')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Dismiss backup reminder' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Settings could not be saved: Local storage is full',
    );
    // Completing the initial canvas fit must not dismiss this unrelated failed setting.
    await act(async () => {
      useEditor.getState().command('Camera', (graph) => ({
        ...graph,
        diagram: {
          ...graph.diagram,
          settings: { ...graph.diagram.settings, viewport: { x: 10, y: 20, zoom: 0.8 } },
        },
      }));
      await workspace.settled();
    });
    expect(useEditor.getState().status).toBe('saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Local storage is full');
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss backup reminder' })).toBeNull(),
    );
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
  });
});
