import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';
import { blankGraph, type Graph } from '../src/model/types';
const request = vi.hoisted(() => vi.fn(async () => ({ open: false })));
const videoBusy = vi.hoisted(() => vi.fn(() => false));
vi.mock('../src/presentation/commands', () => ({
  presentationRequest: request,
  isVideoExporting: videoBusy,
}));
vi.mock('../src/presentation/video-service', () => ({ isVideoExporting: videoBusy }));
let db: WorkspaceDatabase, repo: Repository, workspace: Workspace, graph: Graph;
beforeEach(async () => {
  db = new WorkspaceDatabase(`presentation-workspace-${crypto.randomUUID()}`);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  graph = await repo.importGraph(blankGraph('Tour'));
  useEditor.getState().setGraph(null);
  useEditor.setState({ privacyAcknowledged: true, mcpAccess: 'write', status: 'saved' });
  request.mockClear();
  videoBusy.mockReturnValue(false);
});
afterEach(async () => {
  workspace.stop();
  await db.delete();
  vi.restoreAllMocks();
});
it('opens a diagram and routes transient controls only with consent and write grants', async () => {
  await workspace.external('/presentation/open', 'POST', { diagramId: graph.diagram.id });
  expect(useEditor.getState().graph?.diagram.id).toBe(graph.diagram.id);
  expect(request).toHaveBeenCalledWith('/presentation/open', 'POST', {}, expect.any(Function));
  useEditor.setState({ mcpAccess: 'read' });
  await db.settings.put({ key: 'mcp-access', value: 'read' });
  await workspace.external('/presentation/voices', 'GET');
  await expect(workspace.external('/presentation/play', 'POST', {})).rejects.toMatchObject({
    status: 403,
  });
  expect(request).toHaveBeenCalledTimes(2);
});
it.each(['grant', 'consent'])(
  'honors %s revoked while a graph load was pending before navigation',
  async (kind) => {
    let finish!: (graph: Graph) => void;
    const loading = vi.spyOn(repo, 'getGraph').mockImplementation(
      () =>
        new Promise<Graph>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = workspace.external('/presentation/open', 'POST', {
      diagramId: graph.diagram.id,
    });
    await vi.waitFor(() => expect(loading).toHaveBeenCalledOnce());
    if (kind === 'grant') {
      useEditor.setState({ mcpAccess: 'read' });
      await db.settings.put({ key: 'mcp-access', value: 'read' });
    } else {
      useEditor.setState({ privacyAcknowledged: false });
      await db.settings.put({ key: 'storage-consent', value: false });
    }
    finish(graph);
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(useEditor.getState().graph).toBeNull();
    expect(request).not.toHaveBeenCalled();
  },
);
it('rejects malformed open payloads before loading or mutating a diagram', async () => {
  const load = vi.spyOn(repo, 'getGraph');
  for (const value of [null, [], { diagramId: 9 }, { diagramId: graph.diagram.id, extra: true }])
    await expect(workspace.external('/presentation/open', 'POST', value)).rejects.toMatchObject({
      status: 422,
    });
  expect(load).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it('blocks opening another diagram before navigation when video export is active', async () => {
  videoBusy.mockReturnValue(true);
  const load = vi.spyOn(repo, 'getGraph');
  await expect(
    workspace.external('/presentation/open', 'POST', { diagramId: graph.diagram.id }),
  ).rejects.toMatchObject({ status: 409 });
  expect(load).not.toHaveBeenCalled();
  expect(useEditor.getState().graph).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
