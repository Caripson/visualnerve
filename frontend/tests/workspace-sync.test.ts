import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { blankGraph, newNode } from '../src/model/types';

let db: WorkspaceDatabase, repo: Repository, workspace: Workspace;
beforeEach(async () => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  db = new WorkspaceDatabase(`workspace-sync-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('Autosave synchronization', 'mindmap');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original' })];
  await workspace.create(graph);
});
afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
});

it('serializes an editor save appended after an MCP read begins waiting for the old queue', async () => {
  const graph = useEditor.getState().graph!;
  const save = vi.spyOn(repo, 'saveGraph');
  const reading = workspace.external(`/diagrams/${graph.diagram.id}`, 'GET');
  // Resize/viewport/title edits can arrive before the first await resumes.
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Saved during inspection' });
  const result = await reading;
  expect(result).toMatchObject({ nodes: [{ title: 'Saved during inspection' }] });
  expect(save).toHaveBeenCalledOnce();
  expect((await repo.getGraph(graph.diagram.id)).diagram.version).toBe(graph.diagram.version + 1);
  expect(useEditor.getState().status).toBe('saved');
});

it('drains a new revision appended while a prior transaction is in flight without a second writer', async () => {
  const graph = useEditor.getState().graph!;
  const originalSave = repo.saveGraph.bind(repo);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi.spyOn(repo, 'saveGraph').mockImplementation(async (...args) => {
    if (save.mock.calls.length === 1) await gate;
    return originalSave(...args);
  });
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'First revision' });
  const reading = workspace.external(`/diagrams/${graph.diagram.id}`, 'GET');
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Final revision' });
  release();
  const result = await reading;
  expect(result).toMatchObject({ nodes: [{ title: 'Final revision' }] });
  expect(save).toHaveBeenCalledTimes(2);
  expect((await repo.getGraph(graph.diagram.id)).diagram.version).toBe(graph.diagram.version + 2);
  expect(useEditor.getState().status).toBe('saved');
});

it('retains real cross-tab conflict detection and preserves unsaved local edits', async () => {
  const graph = useEditor.getState().graph!;
  const other = structuredClone(graph);
  other.nodes[0].title = 'Other tab';
  await repo.saveGraph(other, graph.diagram.version);
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Local unsaved draft' });
  await expect(workspace.external(`/diagrams/${graph.diagram.id}`, 'GET')).rejects.toMatchObject({
    status: 409,
  });
  expect(useEditor.getState().graph!.nodes[0].title).toBe('Local unsaved draft');
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Other tab');
});

it('does not treat a delayed refresh snapshot from before its own save as another tab', async () => {
  const graph = useEditor.getState().graph!;
  const staleRecords = await db.diagrams.toArray();
  const collection = db.diagrams.orderBy('updatedAt').reverse();
  let release!: (records: typeof staleRecords) => void;
  const snapshot = new Promise<typeof staleRecords>((resolve) => {
    release = resolve;
  });
  const read = vi
    .spyOn(collection, 'toArray')
    .mockImplementationOnce(() => snapshot as ReturnType<typeof collection.toArray>);
  vi.spyOn(db.diagrams, 'orderBy').mockReturnValueOnce({ reverse: () => collection } as ReturnType<
    typeof db.diagrams.orderBy
  >);
  const refreshing = workspace.refresh();
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'First saved revision' });
  await workspace.settled();
  useEditor.getState().updateNode(graph.nodes[0].id, { title: 'Newer local revision' });
  const history = useEditor.getState().history;
  release(staleRecords);
  await refreshing;
  await workspace.settled();
  expect(useEditor.getState().status).toBe('saved');
  expect(useEditor.getState().history).toEqual(history);
  expect((await repo.getGraph(graph.diagram.id)).nodes[0].title).toBe('Newer local revision');
});
