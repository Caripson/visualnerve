import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { StorageError } from '../src/model/validation';
import { useEditor } from '../src/state/editor';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';

let db: WorkspaceDatabase, repo: Repository, workspace: Workspace;

beforeEach(async () => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '', preferenceError: null });
  db = new WorkspaceDatabase(`update-save-retry-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.put({ key: 'storage-consent', value: true });
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('Retained pending draft');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original' })];
  await workspace.create(graph);
  vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
});

afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
});

function edit() {
  const graph = useEditor.getState().graph!;
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Newest retained draft' });
  return graph;
}

it('retries a rejected autosave without requiring another edit or duplicating the diagram', async () => {
  vi.spyOn(Repository.prototype, 'saveGraph').mockRejectedValueOnce(new Error('Disk full'));
  const graph = edit();
  await expect(workspace.settled()).rejects.toThrow('Disk full');
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
  await workspace.retryFailedSaves();
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Newest retained draft');
  expect(useEditor.getState().status).toBe('saved');
  expect(await db.diagrams.count()).toBe(1);
});

it('retains the draft while retries fail, then recovers with a fresh storage operation', async () => {
  const save = vi
    .spyOn(Repository.prototype, 'saveGraph')
    .mockRejectedValue(new Error('Disk full'));
  const graph = edit();
  await expect(workspace.settled()).rejects.toThrow('Disk full');
  await expect(workspace.retryFailedSaves()).rejects.toThrow('Disk full');
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Newest retained draft');
  save.mockRestore();
  await workspace.retryFailedSaves();
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Newest retained draft');
});

it('requires explicit conflict resolution instead of overwriting another tab during an update', async () => {
  vi.spyOn(Repository.prototype, 'saveGraph').mockRejectedValueOnce(
    new StorageError(409, 'Another tab changed this diagram.'),
  );
  const graph = edit();
  await expect(workspace.settled()).rejects.toMatchObject({ status: 409 });
  await expect(workspace.retryFailedSaves()).rejects.toMatchObject({ status: 409 });
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Original');
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Newest retained draft');
});
