import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupNudge } from '../src/components/DataPrivacy';
import { blankGraph } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace, workspace as applicationWorkspace } from '../src/storage/workspace';

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
  it('stays visible until dismissal is stored, then remains dismissed in a reopened workspace', async () => {
    const writing = deferred(),
      release = deferred();
    const put = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementationOnce((...args) => {
      writing.resolve();
      return Dexie.Promise.resolve(release.promise).then(() => put(...args));
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
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(
      new DOMException('Local storage is full', 'QuotaExceededError'),
    );
    render(<BackupNudge settings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss backup reminder' }));
    await waitFor(() => expect(useEditor.getState().status).toBe('error'));
    expect(useEditor.getState().message).toBe('Local storage is full');
    expect(useEditor.getState().backupNudgeDismissed).toBe(false);
    expect(await db.settings.get('backup-nudge-dismissed')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Dismiss backup reminder' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss backup reminder' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss backup reminder' })).toBeNull(),
    );
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
    expect(useEditor.getState()).toMatchObject({ status: 'saved', message: '' });
  });
});
