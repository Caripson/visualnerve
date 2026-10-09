import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { WorkspaceDatabase } from '../src/storage/database';
import { svgExportController } from '../src/export/svg-jobs';
import { assertMcpAccess } from '../src/integration/access';
import { bridgeResponseStatus, bridgeErrorStatus } from '../src/integration/bridge';
import { SvgExportError } from '../src/export/svg-job-types';
import type {
  SvgJobStatus,
  SvgWorkerRequest,
  SvgWorkerResponse,
} from '../src/export/svg-job-types';

class WorkerBoundary {
  static instances: WorkerBoundary[] = [];
  request?: SvgWorkerRequest;
  terminated = false;
  onmessage: ((event: MessageEvent<SvgWorkerResponse>) => void) | null = null;
  constructor() {
    WorkerBoundary.instances.push(this);
  }
  postMessage(request: SvgWorkerRequest) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
    this.request = undefined;
  }
  complete(svg: string) {
    this.onmessage?.({
      data: {
        type: 'result',
        svg,
        bytes: new TextEncoder().encode(svg).length,
        nodeCount: 1,
        edgeCount: 0,
      },
    } as MessageEvent<SvgWorkerResponse>);
  }
}
interface Chunk {
  offset: number;
  nextOffset: number;
  totalCharacters: number;
  text: string;
  complete: boolean;
}
let db: WorkspaceDatabase, workspace: Workspace, repo: Repository, diagramId: string;
beforeEach(async () => {
  vi.stubGlobal('Worker', WorkerBoundary);
  WorkerBoundary.instances = [];
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  db = new WorkspaceDatabase(`svg-api-${crypto.randomUUID()}`);
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('Private SVG fixture', 'flowchart');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original private source' })];
  await workspace.create(graph);
  diagramId = graph.diagram.id;
  vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
  await workspace.setPreference('mcp-access', 'read');
});
afterEach(async () => {
  svgExportController.clear();
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});
async function start() {
  const post = await repo.db.captureOperation();
  try {
    return await workspace.external<SvgJobStatus>(
      '/api/v1/exports/svg',
      'POST',
      { diagramId },
      post,
    );
  } finally {
    post.dispose();
  }
}
async function complete(job: SvgJobStatus, svg = '<svg>Private source 🇸🇪 and 😀</svg>') {
  await vi.waitFor(() => expect(WorkerBoundary.instances.at(-1)?.request).toBeDefined());
  WorkerBoundary.instances.at(-1)!.complete(svg);
  await vi.waitFor(async () =>
    expect(await workspace.external(`/exports/svg/${job.jobId}`, 'GET')).toMatchObject({
      state: 'succeeded',
    }),
  );
  return svg;
}
it('retains the originating lease after POST ends and streams exact Unicode-safe chunks with read-only access', async () => {
  const job = await start();
  expect(job).toMatchObject({ state: 'queued', diagramId, format: 'svg' });
  const svg = await complete(job);
  let offset = 0,
    text = '';
  for (let index = 0; index < 100; index++) {
    const chunk = await workspace.external<Chunk>(
      `/exports/svg/${job.jobId}/result?offset=${offset}&limit=5`,
      'GET',
    );
    text += chunk.text;
    expect(chunk.offset).toBe(offset);
    expect(chunk.totalCharacters).toBe(svg.length);
    offset = chunk.nextOffset;
    if (chunk.complete) break;
  }
  expect(text).toBe(svg);
  expect(await workspace.external(`/exports/svg/${job.jobId}`, 'GET', null)).toMatchObject({
    state: 'succeeded',
  });
  expect(
    await workspace.external<Chunk>(`/exports/svg/${job.jobId}/result`, 'GET', null),
  ).toMatchObject({ text: svg, complete: true });
  expect(await workspace.external('/exports/capabilities', 'GET', null)).toMatchObject({
    format: 'svg',
  });
  expect(WorkerBoundary.instances[0].terminated).toBe(true);
  expect(await repo.getGraph(diagramId)).toMatchObject({
    nodes: [{ title: 'Original private source' }],
  });
  expect(await workspace.external(`/exports/svg/${job.jobId}`, 'DELETE', null)).toMatchObject({
    state: 'cancelled',
    jobId: job.jobId,
  });
  await expect(workspace.external(`/exports/svg/${job.jobId}/result`, 'GET')).rejects.toMatchObject(
    { status: 404, code: 'SVG_JOB_NOT_FOUND' },
  );
});
it.each(['read', 'off'] as const)(
  'invalidates retained plaintext on explicit %s grant choice, even after access is restored',
  async (choice) => {
    const job = await start();
    await complete(job);
    await workspace.setPreference('mcp-access', choice);
    await workspace.setPreference('mcp-access', 'read');
    await expect(
      workspace.external(`/exports/svg/${job.jobId}/result`, 'GET'),
    ).rejects.toMatchObject({ status: 404 });
    const fresh = await start();
    await complete(fresh, '<svg>Fresh grant</svg>');
    expect(
      await workspace.external<Chunk>(`/exports/svg/${fresh.jobId}/result`, 'GET'),
    ).toMatchObject({ text: '<svg>Fresh grant</svg>', complete: true });
  },
);
it('cancels running jobs on workspace stop and ignores a late worker response', async () => {
  const job = await start();
  await vi.waitFor(() => expect(WorkerBoundary.instances[0]?.request).toBeDefined());
  const worker = WorkerBoundary.instances[0],
    late = worker.onmessage;
  workspace.stop();
  expect(worker.terminated).toBe(true);
  late?.({
    data: { type: 'result', svg: 'Must not publish', bytes: 16, nodeCount: 1, edgeCount: 0 },
  } as MessageEvent<SvgWorkerResponse>);
  await workspace.start();
  await workspace.setPreference('mcp-access', 'read');
  await expect(workspace.external(`/exports/svg/${job.jobId}`, 'GET')).rejects.toMatchObject({
    status: 404,
  });
});
it('validates structured input and result chunk boundaries and never exposes a premature result', async () => {
  expect(await workspace.external('/exports/capabilities', 'GET')).toMatchObject({
    execution: 'local-web-worker',
    persistence: 'transient-memory',
    limits: { resultChunkCharacters: 1048576 },
    requiresOriginalSessionAndGrant: true,
  });
  for (const input of [
    { diagramId, unsafe: true },
    { diagramId, scope: 'other' },
    { diagramId, nodeIds: [42] },
    { diagramId: 'not-an-id' },
    null,
  ])
    await expect(workspace.external('/exports/svg', 'POST', input)).rejects.toMatchObject({
      status: 422,
    });
  const job = await start();
  await expect(workspace.external(`/exports/svg/${job.jobId}/result`, 'GET')).rejects.toMatchObject(
    { status: 409, code: 'SVG_JOB_NOT_READY' },
  );
  await complete(job, '<svg>😀</svg>');
  for (const query of [
    'offset=-1',
    'offset=1&offset=2',
    'offset=1.5',
    'limit=0',
    'limit=1048577',
    'offset=9007199254740992',
    'offset=999',
    'secret=true',
    'offset=6',
  ])
    await expect(
      workspace.external(`/exports/svg/${job.jobId}/result?${query}`, 'GET'),
    ).rejects.toMatchObject({ status: 422 });
  await expect(
    workspace.external(`/exports/svg/${job.jobId}`, 'DELETE', { eraseDiagram: true }),
  ).rejects.toMatchObject({ status: 422 });
});
it('permits exact read-only export paths and returns consistent transport status', () => {
  expect(
    bridgeErrorStatus(new SvgExportError('SVG_BACKGROUND_REQUIRED', 'Use background export', 409)),
  ).toBe(409);
  const id = crypto.randomUUID();
  assertMcpAccess('read', '/exports/svg', 'POST');
  assertMcpAccess('read', `/exports/svg/${id}`, 'DELETE');
  expect(bridgeResponseStatus('/api/v1/exports/svg', 'POST')).toBe(201);
  expect(bridgeResponseStatus(`/api/v1/exports/svg/${id}`, 'DELETE')).toBe(200);
  for (const path of [
    '/exports/svg/../diagrams',
    '/exports/svg?save=true',
    `/exports/svg/${id}/result`,
    `/exports/svg/${id}?deleteDiagram=true`,
  ])
    expect(() => assertMcpAccess('read', path, path.includes(id) ? 'DELETE' : 'POST')).toThrow();
});
