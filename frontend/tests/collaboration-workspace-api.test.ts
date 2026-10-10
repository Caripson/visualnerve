import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGraph } from '../src/model/types';
import { WorkspaceDatabase } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { useEditor } from '../src/state/editor';

vi.mock('../src/collaboration/runtime', () => ({
  collaborationRuntime: { inspect: () => undefined, disconnect: vi.fn() },
}));
let db: WorkspaceDatabase, repo: Repository, workspace: Workspace, diagramId: string;
beforeEach(async () => {
  useEditor.getState().setGraph(null);
  db = new WorkspaceDatabase(`collaboration-api-routing-${crypto.randomUUID()}`);
  await db.initialize();
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('One authoritative local graph', 'flowchart');
  diagramId = graph.diagram.id;
  await workspace.create(graph);
});
afterEach(async () => {
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  await db.delete();
});
describe('collaboration through the existing workspace API authority', () => {
  it('routes canonical diagram inspection and capabilities through one consent/grant boundary', async () => {
    expect(
      await workspace.external(`/api/v1/diagrams/${diagramId}/collaboration`, 'GET'),
    ).toMatchObject({
      diagramId,
      status: 'idle',
      participants: [],
    });
    expect(await workspace.external('/collaboration/capabilities', 'GET')).toMatchObject({
      configured: false,
      encryption: 'mls-rfc9420',
      controls: { create: false, invite: false },
      limits: { compressedPayloadBytes: 3 * 1024 * 1024, plaintextPayloadBytes: 64 * 1024 * 1024 },
    });
  });
  it.each([
    ['/diagrams/not-a-uuid/collaboration', undefined],
    ['/diagrams/not-a-uuid/collaboration/disconnect', {}],
    ['/diagrams/valid/collaboration?invite=secret', undefined],
    ['/diagrams/valid/collaboration#invite', undefined],
    ['/diagrams/valid/collaboration', { privateKey: 'forbidden' }],
  ])('returns structured validation for %s before looking up a graph', async (path, data) => {
    const getGraph = vi.spyOn(Repository.prototype, 'getGraph');
    await expect(
      workspace.external(
        path.replace('/valid/', `/${diagramId}/`),
        path.endsWith('disconnect') ? 'POST' : 'GET',
        data,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(getGraph).not.toHaveBeenCalled();
  });
  it('does not fabricate sessions for nonexistent diagrams', async () => {
    await expect(
      workspace.external(`/diagrams/${crypto.randomUUID()}/collaboration`, 'GET'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects disabled or revoked MCP access before any collaboration inspection', async () => {
    await workspace.setPreference('mcp-access', 'off');
    await expect(workspace.external('/collaboration/capabilities', 'GET')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('requires acknowledged local storage even for collaboration capabilities', async () => {
    useEditor.setState({ privacyAcknowledged: false });
    await expect(workspace.external('/collaboration/capabilities', 'GET')).rejects.toMatchObject({
      status: 403,
    });
  });
});
