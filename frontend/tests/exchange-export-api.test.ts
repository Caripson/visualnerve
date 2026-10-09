import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';
import { Repository } from '../src/storage/repository';
import { Workspace } from '../src/storage/workspace';
import { WorkspaceDatabase } from '../src/storage/database';
import { exchangeExportController } from '../src/export/exchange-jobs';
import { assertMcpAccess } from '../src/integration/access';
import { bridgeResponseStatus } from '../src/integration/bridge';
import type {
  ExchangeJobStatus,
  ExchangeWorkerRequest,
  ExchangeWorkerResponse,
} from '../src/export/exchange-types';

class WorkerBoundary {
  static instances: WorkerBoundary[] = [];
  request?: ExchangeWorkerRequest;
  terminated = false;
  onmessage: ((event: MessageEvent<ExchangeWorkerResponse>) => void) | null = null;
  constructor() {
    WorkerBoundary.instances.push(this);
  }
  postMessage(request: ExchangeWorkerRequest) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
    this.request = undefined;
  }
  complete(bytes: Uint8Array) {
    this.onmessage?.({
      data: {
        type: 'result',
        result: {
          format: 'vsdx',
          mimeType: 'application/vnd.ms-visio.drawing',
          bytes,
          nodeCount: 1,
          edgeCount: 0,
          warnings: [{ code: 'VISIO_PREVIEW', message: 'Verify this package in Microsoft Visio.' }],
        },
      },
    } as unknown as MessageEvent<ExchangeWorkerResponse>);
  }
}
interface Chunk {
  jobId: string;
  format: string;
  mimeType: string;
  encoding: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  data: string;
  complete: boolean;
  warnings: { code: string; message: string }[];
}
let db: WorkspaceDatabase,
  workspace: Workspace,
  repo: Repository,
  diagramId: string,
  nodeId: string;
beforeEach(async () => {
  vi.stubGlobal('Worker', WorkerBoundary);
  WorkerBoundary.instances = [];
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '' });
  db = new WorkspaceDatabase(`exchange-api-${crypto.randomUUID()}`);
  await db.settings.bulkPut([
    { key: 'storage-consent', value: true },
    { key: 'mcp-access', value: 'write' },
  ]);
  repo = new Repository(db);
  workspace = new Workspace(repo);
  await workspace.start();
  const graph = blankGraph('Private editable export');
  graph.nodes = [newNode(graph.diagram.id, { title: 'Original drawing content' })];
  await workspace.create(graph);
  diagramId = graph.diagram.id;
  nodeId = graph.nodes[0].id;
  vi.spyOn(workspace, 'refresh').mockResolvedValue(undefined);
  await workspace.setPreference('mcp-access', 'read');
});
afterEach(async () => {
  exchangeExportController.clear();
  workspace.stop();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});
async function start() {
  const post = await repo.db.captureOperation();
  try {
    return await workspace.external<ExchangeJobStatus>(
      '/api/v1/exports/diagrams',
      'POST',
      { diagramId, format: 'vsdx' },
      post,
    );
  } finally {
    post.dispose();
  }
}
async function complete(
  job: ExchangeJobStatus,
  bytes = new Uint8Array([0, 1, 255, 80, 75, 0, 17, 91, 200]),
) {
  await vi.waitFor(() => expect(WorkerBoundary.instances.at(-1)?.request).toBeDefined());
  WorkerBoundary.instances.at(-1)!.complete(bytes);
  await vi.waitFor(async () =>
    expect(await workspace.external(`/exports/diagrams/${job.jobId}`, 'GET')).toMatchObject({
      state: 'succeeded',
    }),
  );
  return bytes;
}
it('keeps the original lease after POST and returns byte-exact independently decoded binary chunks without changing the model', async () => {
  const before = await repo.getGraph(diagramId),
    job = await start();
  expect(job).toMatchObject({ state: 'queued', format: 'vsdx', diagramId, warnings: [] });
  const bytes = await complete(job);
  let offset = 0;
  const collected: number[] = [];
  for (let index = 0; index < 10; index++) {
    const chunk = await workspace.external<Chunk>(
      `/exports/diagrams/${job.jobId}/result?offset=${offset}&limit=2`,
      'GET',
    );
    expect(chunk).toMatchObject({
      jobId: job.jobId,
      format: 'vsdx',
      mimeType: 'application/vnd.ms-visio.drawing',
      encoding: 'base64',
      offset,
      totalBytes: bytes.length,
      warnings: [{ code: 'VISIO_PREVIEW' }],
    });
    collected.push(...Array.from(atob(chunk.data), (char) => char.charCodeAt(0)));
    offset = chunk.nextOffset;
    if (chunk.complete) break;
  }
  expect(new Uint8Array(collected)).toEqual(bytes);
  expect(offset).toBe(bytes.length);
  expect(
    await workspace.external<Chunk>(
      `/exports/diagrams/${job.jobId}/result?offset=${offset}`,
      'GET',
    ),
  ).toMatchObject({ data: '', complete: true, offset });
  expect(await repo.getGraph(diagramId)).toEqual(before);
  expect(await workspace.external(`/exports/diagrams/${job.jobId}`, 'DELETE', null)).toMatchObject({
    state: 'cancelled',
    jobId: job.jobId,
  });
  expect(bytes.every((value) => value === 0)).toBe(true);
  await expect(
    workspace.external(`/exports/diagrams/${job.jobId}/result`, 'GET'),
  ).rejects.toMatchObject({ status: 404, code: 'EXCHANGE_JOB_NOT_FOUND' });
});
it('caps default chunks at 786432 raw bytes and preserves the remaining binary byte', async () => {
  const job = await start();
  const bytes = new Uint8Array(786433).fill(255);
  await complete(job, bytes);
  const first = await workspace.external<Chunk>(`/exports/diagrams/${job.jobId}/result`, 'GET');
  expect(first).toMatchObject({
    offset: 0,
    nextOffset: 786432,
    totalBytes: 786433,
    complete: false,
  });
  expect(first.data).toHaveLength(1048576);
  const decoded = atob(first.data);
  expect(decoded).toHaveLength(786432);
  expect(decoded.charCodeAt(0)).toBe(255);
  expect(decoded.charCodeAt(decoded.length - 1)).toBe(255);
  const last = await workspace.external<Chunk>(
    `/exports/diagrams/${job.jobId}/result?offset=${first.nextOffset}`,
    'GET',
  );
  expect(last).toMatchObject({ offset: 786432, nextOffset: 786433, data: '/w==', complete: true });
});
it('adds compatibility metadata without replacing existing SVG capability fields', async () => {
  expect(await workspace.external('/exports/capabilities', 'GET')).toMatchObject({
    format: 'svg',
    resultOffsetUnit: 'utf-16-code-units',
    limits: { resultChunkCharacters: 1048576 },
    diagrams: {
      version: 1,
      scopes: ['complete', 'selected'],
      resultOffsetUnit: 'bytes',
      resultEncoding: 'base64',
      limits: { resultChunkBytes: 786432 },
      persistence: 'transient-memory',
      requiresOriginalSessionAndGrant: true,
      formats: {
        drawio: { editable: true },
        vsdx: { compatibility: 'preview', requiresMicrosoftVisioVerification: true },
      },
    },
  });
});
it('rejects unsupported shapes before dispatch and returns structured result-not-ready/chunk errors', async () => {
  for (const input of [
    null,
    {},
    { diagramId, format: 'svg' },
    { diagramId, format: ['drawio'] },
    { diagramId, format: 'drawio', scope: ['complete'] },
    { diagramId, format: 'drawio', extra: true },
    { diagramId, format: 'drawio', nodeIds: [] },
    { diagramId, format: 'drawio', scope: 'selected' },
    { diagramId, format: 'drawio', scope: 'selected', nodeIds: [] },
    { diagramId, format: 'drawio', scope: 'selected', nodeIds: [nodeId, nodeId] },
    { diagramId, format: 'drawio', scope: 'selected', nodeIds: [crypto.randomUUID()] },
    { diagramId: 'external-name', format: 'drawio' },
  ])
    await expect(workspace.external('/exports/diagrams', 'POST', input)).rejects.toMatchObject({
      status: 422,
    });
  expect(WorkerBoundary.instances).toHaveLength(0);
  const job = await start();
  await expect(
    workspace.external(`/exports/diagrams/${job.jobId}/result`, 'GET'),
  ).rejects.toMatchObject({ status: 409, code: 'EXCHANGE_JOB_NOT_READY' });
  await complete(job);
  for (const query of [
    'offset=-1',
    'offset=1.5',
    'offset=1&offset=2',
    'offset=9007199254740992',
    'offset=1000',
    'limit=0',
    'limit=786433',
    'limit=1&limit=2',
    'extra=true',
  ])
    await expect(
      workspace.external(`/exports/diagrams/${job.jobId}/result?${query}`, 'GET'),
    ).rejects.toMatchObject({ status: 422 });
  await expect(
    workspace.external(`/exports/diagrams/${job.jobId}`, 'DELETE', { deleteSource: true }),
  ).rejects.toMatchObject({ status: 422 });
});
it.each(['read', 'off'] as const)(
  'revokes plaintext and original job authority on explicit %s grant changes',
  async (choice) => {
    const job = await start(),
      bytes = await complete(job);
    await workspace.setPreference('mcp-access', choice);
    await workspace.setPreference('mcp-access', 'read');
    expect(bytes.every((value) => value === 0)).toBe(true);
    await expect(
      workspace.external(`/exports/diagrams/${job.jobId}/result`, 'GET'),
    ).rejects.toMatchObject({ status: 404 });
  },
);
it('cancels a running original job at stop and refuses late publication after restart', async () => {
  const job = await start();
  await vi.waitFor(() => expect(WorkerBoundary.instances[0]?.request).toBeDefined());
  const worker = WorkerBoundary.instances[0],
    late = worker.onmessage;
  workspace.stop();
  expect(worker.terminated).toBe(true);
  late?.({
    data: {
      type: 'result',
      result: {
        format: 'vsdx',
        mimeType: 'application/vnd.ms-visio.drawing',
        bytes: new Uint8Array([80, 75]),
        nodeCount: 1,
        edgeCount: 0,
        warnings: [],
      },
    },
  } as unknown as MessageEvent<ExchangeWorkerResponse>);
  await workspace.start();
  await workspace.setPreference('mcp-access', 'read');
  await expect(workspace.external(`/exports/diagrams/${job.jobId}`, 'GET')).rejects.toMatchObject({
    status: 404,
  });
});
it('permits only exact export exceptions for read-only grants, with job creation/cancellation status preserved', () => {
  const id = crypto.randomUUID();
  assertMcpAccess('read', '/exports/diagrams', 'POST');
  assertMcpAccess('read', `/exports/diagrams/${id}`, 'DELETE');
  expect(bridgeResponseStatus('/exports/diagrams', 'POST')).toBe(201);
  expect(bridgeResponseStatus(`/exports/diagrams/${id}`, 'DELETE')).toBe(200);
  for (const path of [
    '/exports/diagrams?save=true',
    '/exports/diagrams/../diagrams',
    '/exports/diagrams/not-a-job',
    `/exports/diagrams/${id}/result`,
    `/exports/diagrams/${id}?delete=true`,
  ])
    expect(() =>
      assertMcpAccess(
        'read',
        path,
        path.includes(id) || path.includes('not-a-job') ? 'DELETE' : 'POST',
      ),
    ).toThrow();
  expect(() => assertMcpAccess('off', '/exports/diagrams', 'POST')).toThrow();
});
