import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { StorageError } from '../src/model/validation';
import { createBasicModel } from '../src/simulation/examples';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { settingWrites } from './workspace-test-hooks';

let db: WorkspaceDatabase, repo: Repository, workspace: Workspace;
let refresh: MockInstance<Workspace['refresh']>;

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
  db = new WorkspaceDatabase(`preference-error-ownership-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('Preference retry ownership');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original' })];
  await workspace.create(graph);
  // Make background refresh failures explicit without an observer consuming a
  // controlled read/write gate. Real editor autosaves and IDB writes still run.
  refresh = vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
});

afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
});

async function failPreference(key = 'backup-nudge-dismissed', message = 'Local storage is full') {
  settingWrites(db).mockRejectedValueOnce(new DOMException(message, 'QuotaExceededError'));
  await expect(workspace.setPreference(key, true)).rejects.toThrow(message);
  expect(useEditor.getState().preferenceError).toEqual({ key, message });
}

function holdPreferenceWrite() {
  const entered = deferred(),
    release = deferred();
  const put = settingWrites(db).getMockImplementation()!;
  settingWrites(db).mockImplementationOnce((...args) => {
    entered.resolve();
    return release.promise.then(() => put(...args));
  });
  return { entered, release };
}

async function backgroundError(error: Error) {
  refresh.mockRejectedValueOnce(error);
  await workspace.setPreference('last-export', '2026-10-08T10:00:00Z');
  await vi.waitFor(() => expect(useEditor.getState().message).toBe(error.message));
}

describe('preference failures are independent of document saves and acknowledge only their own retry', () => {
  it('keeps an unresolved preference failure after an already-inflight graph save finishes', async () => {
    const entered = deferred(),
      release = deferred();
    const save = Repository.prototype.saveGraph;
    vi.spyOn(Repository.prototype, 'saveGraph').mockImplementationOnce(async function (
      this: Repository,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return save.apply(this, args);
    });
    const graph = useEditor.getState().graph!;
    useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Committed document change' });
    await entered.promise;
    await failPreference();
    expect(useEditor.getState().status).toBe('saving');
    release.resolve();
    await workspace.settled();
    expect(useEditor.getState()).toMatchObject({ status: 'saved', message: '' });
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'backup-nudge-dismissed',
      message: 'Local storage is full',
    });
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe(
      'Committed document change',
    );
    expect(await db.settings.get('backup-nudge-dismissed')).toBeUndefined();
    await workspace.retryPreference('backup-nudge-dismissed');
    expect(useEditor.getState().preferenceError).toBeNull();
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
  });

  it('keeps an unresolved preference failure through a subsequent viewport edit and autosave', async () => {
    await failPreference();
    const graphId = useEditor.getState().graph!.diagram.id;
    useEditor.getState().command('Camera', (graph) => ({
      ...graph,
      diagram: {
        ...graph.diagram,
        settings: { ...graph.diagram.settings, viewport: { x: 10, y: 20, zoom: 0.8 } },
      },
    }));
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'backup-nudge-dismissed',
      message: 'Local storage is full',
    });
    await workspace.settled();
    expect(useEditor.getState()).toMatchObject({ status: 'saved', message: '' });
    expect((await repo.getGraph(graphId)).diagram.settings.viewport).toEqual({
      x: 10,
      y: 20,
      zoom: 0.8,
    });
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'backup-nudge-dismissed',
      message: 'Local storage is full',
    });
    expect(await db.settings.get('backup-nudge-dismissed')).toBeUndefined();
    await workspace.retryPreference('backup-nudge-dismissed');
    expect(useEditor.getState().preferenceError).toBeNull();
    expect(useEditor.getState().backupNudgeDismissed).toBe(true);
  });

  it('recovers repeated failed retries only after the accepted write is persisted', async () => {
    await failPreference();
    await failPreference();
    const gate = holdPreferenceWrite();
    const retry = workspace.setPreference('backup-nudge-dismissed', true);
    await gate.entered.promise;
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: { key: 'backup-nudge-dismissed', message: 'Local storage is full' },
      backupNudgeDismissed: false,
    });
    expect(await db.settings.get('backup-nudge-dismissed')).toBeUndefined();
    gate.release.resolve();
    await retry;
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
  });

  it('restores an error that preceded the preference failure', async () => {
    await backgroundError(new Error('Workspace catalog could not be read'));
    await failPreference();
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'error',
      message: 'Workspace catalog could not be read',
    });
  });

  it('does not clear a newer Workspace error even if its message is identical', async () => {
    await failPreference();
    const gate = holdPreferenceWrite();
    const retry = workspace.setPreference('backup-nudge-dismissed', true);
    await gate.entered.promise;
    await backgroundError(new Error('Local storage is full'));
    gate.release.resolve();
    await retry;
    expect((await db.settings.get('backup-nudge-dismissed'))?.value).toBe(true);
    expect(useEditor.getState()).toMatchObject({
      status: 'error',
      message: 'Local storage is full',
    });
  });

  it('does not let an older successful write acknowledge a newer failed choice of the same preference', async () => {
    await failPreference();
    const gate = holdPreferenceWrite();
    const olderRetry = workspace.setPreference('backup-nudge-dismissed', true);
    await gate.entered.promise;
    await failPreference();
    gate.release.resolve();
    await olderRetry;
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'backup-nudge-dismissed',
      message: 'Local storage is full',
    });
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
  });

  it('keeps a different preference error and never resurrects the hidden successful retry', async () => {
    await failPreference('backup-nudge-dismissed', 'Backup preference failed');
    await failPreference('another-preference', 'Other preference failed');
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'another-preference',
      message: 'Other preference failed',
    });
    await workspace.setPreference('another-preference', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
  });

  it('restores an unresolved earlier preference, which can then be retried successfully', async () => {
    await failPreference('backup-nudge-dismissed', 'Backup preference failed');
    await failPreference('another-preference', 'Other preference failed');
    await workspace.setPreference('another-preference', true);
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'backup-nudge-dismissed',
      message: 'Backup preference failed',
    });
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
  });

  it('does not resurrect a superseded same-key failure through another preference owner', async () => {
    await failPreference('backup-nudge-dismissed', 'First backup failure');
    await failPreference('another-preference', 'Other preference failed');
    await failPreference('backup-nudge-dismissed', 'Second backup failure');
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState().preferenceError).toEqual({
      key: 'another-preference',
      message: 'Other preference failed',
    });
    await workspace.setPreference('another-preference', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
  });

  it('acknowledges a preference retry without acknowledging a pending document save', async () => {
    const entered = deferred(),
      release = deferred();
    const save = Repository.prototype.saveGraph;
    vi.spyOn(Repository.prototype, 'saveGraph').mockImplementationOnce(async function (
      this: Repository,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return save.apply(this, args);
    });
    const graph = useEditor.getState().graph!;
    useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Unsaved work' });
    await entered.promise;
    await failPreference();
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saving',
      message: '',
      preferenceError: null,
    });
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
    release.resolve();
    await workspace.settled();
    expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Unsaved work');
    expect(useEditor.getState().status).toBe('saved');
  });

  it('preserves a concurrent semantic draft arriving while the preference retry waits', async () => {
    await failPreference();
    const gate = holdPreferenceWrite();
    const retry = workspace.setPreference('backup-nudge-dismissed', true);
    await gate.entered.promise;
    const entered = deferred(),
      release = deferred();
    const save = Repository.prototype.saveGraph;
    vi.spyOn(Repository.prototype, 'saveGraph').mockImplementationOnce(async function (
      this: Repository,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return save.apply(this, args);
    });
    const state = useEditor.getState();
    useEditor.setState({
      graph: {
        ...state.graph!,
        nodes: state.graph!.nodes.map((node) => ({ ...node, title: 'Concurrent draft' })),
      },
      editRevision: state.editRevision + 1,
    });
    await entered.promise;
    gate.release.resolve();
    await retry;
    expect(useEditor.getState().preferenceError).toBeNull();
    expect(useEditor.getState().graph!.nodes[0].title).toBe('Concurrent draft');
    release.resolve();
    await workspace.settled();
  });

  it('acknowledges a retried workspace preference after the active graph changes', async () => {
    await failPreference();
    useEditor.getState().setGraph(blankGraph('Different document'));
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'saved',
      message: '',
      preferenceError: null,
    });
    expect(useEditor.getState().graph!.diagram.name).toBe('Different document');
  });

  it('does not clear a newer rejected semantic edit with identical text', async () => {
    const message = 'Simulation data requires a Process Simulator document.';
    await failPreference('backup-nudge-dismissed', message);
    const before = useEditor.getState().graph;
    useEditor.getState().command('Invalid document type', (graph) => ({
      ...graph,
      simulation: createBasicModel(),
    }));
    expect(useEditor.getState()).toMatchObject({ status: 'error', message, commandError: message });
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({ status: 'error', message, commandError: message });
    expect(useEditor.getState().graph).toBe(before);
  });

  it('preserves a conflict that preceded the preference failure', async () => {
    await backgroundError(new StorageError(409, 'Another tab changed this project'));
    await failPreference();
    await workspace.setPreference('backup-nudge-dismissed', true);
    expect(useEditor.getState()).toMatchObject({
      status: 'conflict',
      message: 'Another tab changed this project',
    });
  });

  it('does not clear a conflict that appeared during a successful retry', async () => {
    await failPreference();
    const gate = holdPreferenceWrite();
    const retry = workspace.setPreference('backup-nudge-dismissed', true);
    await gate.entered.promise;
    await backgroundError(new StorageError(409, 'Another tab changed this project'));
    gate.release.resolve();
    await retry;
    expect(useEditor.getState()).toMatchObject({
      status: 'conflict',
      message: 'Another tab changed this project',
    });
  });
});
