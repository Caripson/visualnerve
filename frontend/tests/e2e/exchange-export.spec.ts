import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type {
  ExchangeFormat,
  ExchangeJobStatus,
  ExchangeWarning,
} from '../../src/export/exchange-types';
import type { Graph } from '../../src/model/types';
import { parseDrawio } from '../../src/imports/diagram/drawio';
import { parseVsdx } from '../../src/imports/diagram/vsdx';
import { browserLaunchOptions } from '../../playwright.config';

// Actual browser workers, binary serializers and bridge requests remain enabled.
test.use({ serviceWorkers: 'block' });
const graphicsTest = test.extend({
  launchOptions: {
    ...browserLaunchOptions,
    args: [
      ...browserLaunchOptions.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
});
const base = '/api/v1/exports/diagrams';
const chunkLimit = 786_432;
const secret = 'EXCLUDED_EXCHANGE_PRIVATE_DATA_927';

interface ResultChunk {
  jobId: string;
  format: ExchangeFormat;
  mimeType: string;
  encoding: 'base64';
  offset: number;
  nextOffset: number;
  totalBytes: number;
  data: string;
  complete: boolean;
  warnings: ExchangeWarning[];
}
interface ToolResult<T> {
  isError: boolean;
  structuredContent: { status: number; body: T };
  content: Array<{ text: string }>;
}

async function start(
  request: APIRequestContext,
  diagramId: string,
  format: ExchangeFormat,
  extra = {},
) {
  const response = await request.post(base, { data: { diagramId, format, ...extra } });
  expect(response.status(), await response.text()).toBe(201);
  const status = (await response.json()) as ExchangeJobStatus;
  expect(status).toMatchObject({ diagramId, format, warnings: [] });
  expect(status.jobId).toMatch(/^[\da-f-]{36}$/i);
  return status;
}
async function completed(request: APIRequestContext, jobId: string) {
  let terminal: ExchangeJobStatus | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${base}/${jobId}`);
        expect(response.status(), await response.text()).toBe(200);
        terminal = (await response.json()) as ExchangeJobStatus;
        expect(terminal.state, terminal.error?.message).not.toBe('failed');
        return terminal.state;
      },
      { timeout: 60_000 },
    )
    .toBe('succeeded');
  expect(terminal).toMatchObject({ phase: 'complete', progress: 100 });
  return terminal!;
}
async function readChunks(
  jobId: string,
  format: ExchangeFormat,
  get: (offset: number, limit: number) => Promise<ResultChunk>,
  limit = chunkLimit,
) {
  const chunks: Buffer[] = [];
  let offset = 0;
  for (let count = 0; count < 128; count++) {
    const chunk = await get(offset, limit);
    expect(chunk).toMatchObject({ jobId, format, encoding: 'base64', offset });
    expect(chunk.data.length % 4).toBe(0);
    expect(chunk.data).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    // Each chunk has its own padding and may end in the middle of a UTF-8 character.
    const bytes = Buffer.from(chunk.data, 'base64');
    expect(bytes.byteLength).toBeLessThanOrEqual(limit);
    expect(chunk.nextOffset).toBe(offset + bytes.byteLength);
    chunks.push(bytes);
    offset = chunk.nextOffset;
    if (chunk.complete) {
      expect(offset).toBe(chunk.totalBytes);
      expect(chunk.mimeType).toBe(
        format === 'drawio' ? 'application/vnd.jgraph.mxfile' : 'application/vnd.ms-visio.drawing',
      );
      return { bytes: Buffer.concat(chunks), chunkCount: chunks.length, warnings: chunk.warnings };
    }
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(offset).toBeLessThan(chunk.totalBytes);
  }
  throw new Error('Editable diagram did not finish within the documented binary output limit.');
}
async function result(
  request: APIRequestContext,
  jobId: string,
  format: ExchangeFormat,
  limit = chunkLimit,
) {
  return readChunks(
    jobId,
    format,
    async (offset, size) => {
      const response = await request.get(`${base}/${jobId}/result?offset=${offset}&limit=${size}`);
      expect(response.status(), await response.text()).toBe(200);
      return response.json() as Promise<ResultChunk>;
    },
    limit,
  );
}
async function rpc<T>(request: APIRequestContext, method: string, params?: unknown): Promise<T> {
  const response = await request.post('/mcp', {
    data: { jsonrpc: '2.0', id: randomUUID(), method, ...(params === undefined ? {} : { params }) },
  });
  expect(response.status(), await response.text()).toBe(200);
  const envelope = await response.json();
  expect(envelope.error).toBeUndefined();
  return envelope.result as T;
}
const mcp = <T>(request: APIRequestContext, path: string, method = 'GET', data?: unknown) =>
  rpc<ToolResult<T>>(request, 'tools/call', {
    name: 'visual_nerve_request',
    arguments: { path, method, ...(data === undefined ? {} : { data }) },
  });

async function download(page: Page, format: ExchangeFormat, scope = 'complete') {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption(format);
  await expect(page.getByLabel('Export resolution')).toHaveCount(0);
  const area = page.getByLabel('Export area', { exact: true });
  await expect(area).toBeVisible();
  expect(
    await area
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
  ).toEqual(['complete', 'selected']);
  await area.selectOption(scope);
  if (format === 'vsdx') {
    await expect(page.getByLabel('Export format').locator('option[value="vsdx"]')).toContainText(
      'preview',
    );
    await expect(page.getByRole('dialog').getByRole('note')).toContainText('Microsoft Visio');
  }
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  return readFile((await file.path())!);
}
function imported(bytes: Buffer, format: ExchangeFormat) {
  const parsed =
    format === 'drawio'
      ? parseDrawio(bytes.toString('utf8'), 'native.drawio')
      : parseVsdx(new Uint8Array(bytes), 'native.vsdx');
  expect(parsed.pages).toHaveLength(1);
  return parsed.pages[0].graph;
}
function assertNativeContent(bytes: Buffer, format: ExchangeFormat, nodes: number, edges: number) {
  const source =
    format === 'drawio'
      ? bytes.toString('utf8')
      : Object.values(unzipSync(new Uint8Array(bytes)))
          .map((part) => strFromU8(part))
          .join('\n');
  expect(source).not.toContain(secret);
  expect(source).not.toMatch(/<(?:script|image|foreignObject|iframe)\b/);
  const graph = imported(bytes, format);
  expect(graph.nodes).toHaveLength(nodes);
  expect(graph.edges).toHaveLength(edges);
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    expect(ids.has(edge.sourceNodeId)).toBe(true);
    expect(ids.has(edge.targetNodeId)).toBe(true);
  }
  return graph;
}
async function populate(request: APIRequestContext) {
  const created = await request.post('/api/v1/diagrams', {
    data: { name: 'Editable Unicode & native groups', type: 'freeform' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const diagram = await created.json();
  const [group, a, b, c] = Array.from({ length: 4 }, () => randomUUID());
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          id: group,
          nodeType: 'group',
          title: 'Editable boundary',
          x: 100,
          y: 100,
          width: 850,
          height: 350,
        },
        {
          id: a,
          nodeType: 'document',
          title: 'Räksmörgås & 日本語 🧠 <script>literal</script>',
          description: 'Review: x < y\nThe description survives.',
          status: 'done',
          parentId: group,
          x: 130,
          y: 150,
          width: 200,
          height: 120,
          color: '#226655',
          notes: secret,
          metadata: { private: secret, rawSource: secret },
        },
        {
          id: b,
          nodeType: 'decision',
          title: 'Approve',
          parentId: group,
          x: 430,
          y: 150,
          width: 200,
          height: 120,
        },
        {
          id: c,
          nodeType: 'database',
          title: 'Publish',
          parentId: group,
          x: 730,
          y: 150,
          width: 200,
          height: 120,
        },
      ],
      edges: [
        {
          sourceNodeId: a,
          targetNodeId: b,
          label: 'Approve & <next>',
          direction: 'both',
          style: 'dotted',
        },
        {
          sourceNodeId: b,
          targetNodeId: c,
          label: 'Boundary edge',
          direction: 'backward',
          style: 'dashed',
        },
      ],
    },
  });
  expect(populated.status(), await populated.text()).toBe(200);
  return { graph: (await populated.json()) as Graph, ids: { a, b, c, group } };
}

graphicsTest(
  'UI downloads and native REST chunks match for both editable formats; 3D preserves the canonical 2D drawing',
  async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const { graph, ids } = await populate(request);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator(`button[data-diagram-id="${graph.diagram.id}"]`).click();
    await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(4);
    const canonical = new Map<ExchangeFormat, Buffer>();
    for (const format of ['drawio', 'vsdx'] as const) {
      const job = await start(request, graph.diagram.id, format);
      const status = await completed(request, job.jobId);
      expect(status).toMatchObject({ nodeCount: 4, edgeCount: 2 });
      const native = await result(request, job.jobId, format, 4093);
      const ui = await download(page, format);
      expect(ui.equals(native.bytes)).toBe(true);
      const model = assertNativeContent(ui, format, 4, 2);
      const text = model.nodes.map((node) => node.title).join('\n');
      expect(text).toContain('Räksmörgås & 日本語 🧠 <script>literal</script>');
      expect(text).toContain('The description survives.');
      expect(text).toContain('Status: done');
      expect(
        model.edges.map(({ label, direction, style }) => ({ label, direction, style })),
      ).toEqual([
        { label: 'Approve & <next>', direction: 'both', style: 'dotted' },
        { label: 'Boundary edge', direction: 'backward', style: 'dashed' },
      ]);
      const group = model.nodes.find((node) => node.title === 'Editable boundary')!;
      const child = model.nodes.find((node) => node.title.startsWith('Räksmörgås'))!;
      expect(group.nodeType).toBe('group');
      expect(child.parentId).toBe(group.id);
      expect(child.x - group.x).toBeCloseTo(30, 6);
      expect(child.y - group.y).toBeCloseTo(50, 6);
      expect(child.width).toBeCloseTo(200, 6);
      expect(child.height).toBeCloseTo(120, 6);
      if (format === 'vsdx')
        expect(native.warnings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'VISIO_COMPATIBILITY_PREVIEW' }),
          ]),
        );
      canonical.set(format, ui);
      await info.attach(`native-ui.${format}`, {
        body: ui,
        contentType:
          format === 'drawio'
            ? 'application/vnd.jgraph.mxfile'
            : 'application/vnd.ms-visio.drawing',
      });
    }
    // A UI selection contains its explicit node, rather than its group or outside endpoints.
    await page.locator(`.canvas-shell [data-node-id="${ids.a}"] .node-title`).click();
    const selected = await start(request, graph.diagram.id, 'drawio', {
      scope: 'selected',
      nodeIds: [ids.a],
    });
    await completed(request, selected.jobId);
    const selectedApi = await result(request, selected.jobId, 'drawio');
    const selectedUi = await download(page, 'drawio', 'selected');
    expect(selectedUi.equals(selectedApi.bytes)).toBe(true);
    assertNativeContent(selectedUi, 'drawio', 1, 0);
    const saved = (await (
      await request.get(`/api/v1/diagrams/${graph.diagram.id}`)
    ).json()) as Graph;
    const switched = await request.patch(`/api/v1/diagrams/${graph.diagram.id}`, {
      data: {
        version: saved.diagram.version,
        settings: { ...saved.diagram.settings, spatialView: { version: 1, mode: '3d' } },
      },
    });
    expect(switched.status(), await switched.text()).toBe(200);
    await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
      timeout: 30_000,
    });
    for (const format of ['drawio', 'vsdx'] as const) {
      const job = await start(request, graph.diagram.id, format);
      await completed(request, job.jobId);
      const spatialApi = await result(request, job.jobId, format);
      expect(spatialApi.bytes.equals(canonical.get(format)!)).toBe(true);
      expect((await download(page, format)).equals(canonical.get(format)!)).toBe(true);
    }
    expect(errors).toEqual([]);
  },
);

test('read-only REST and MCP jobs preserve selected internal edges, enforce byte bounds and cannot mutate the model', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { graph, ids } = await populate(request);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => await (await request.get('/api/v1/settings/mcp-access')).json())
    .toBe('read');
  const before = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json();
  const capabilities = await (await request.get('/api/v1/exports/capabilities')).json();
  expect(capabilities.diagrams).toMatchObject({
    execution: 'local-web-worker',
    scopes: ['complete', 'selected'],
    resultEncoding: 'base64',
    resultOffsetUnit: 'bytes',
    formats: { vsdx: { compatibility: 'preview', requiresMicrosoftVisioVerification: true } },
    limits: { resultChunkBytes: chunkLimit },
  });
  const tools = await rpc<{ tools: Array<{ name: string }> }>(request, 'tools/list');
  expect(tools.tools.map((tool) => tool.name)).toContain('visual_nerve_request');
  const docs = await rpc<ToolResult<unknown>>(request, 'tools/call', {
    name: 'visual_nerve_api_docs',
    arguments: { document: 'endpoint', path: '/exports/diagrams/{jobId}/result', method: 'GET' },
  });
  expect(docs.isError).toBe(false);
  expect(
    JSON.parse(docs.content[0].text).paths['/exports/diagrams/{jobId}/result'].get,
  ).toBeDefined();
  for (const format of ['drawio', 'vsdx'] as const) {
    const input = { scope: 'selected', nodeIds: [ids.a, ids.b] };
    const rest = await start(request, graph.diagram.id, format, input);
    const status = await completed(request, rest.jobId);
    expect(status).toMatchObject({ nodeCount: 2, edgeCount: 1 });
    const native = await result(request, rest.jobId, format, 1031);
    const model = assertNativeContent(native.bytes, format, 2, 1);
    expect(model.nodes.some((node) => node.title === 'Publish')).toBe(false);
    expect(model.nodes.every((node) => node.parentId === undefined)).toBe(true);
    expect(native.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SELECTION_BOUNDARY_CONNECTIONS' })]),
    );
    const created = await mcp<ExchangeJobStatus>(request, '/exports/diagrams', 'POST', {
      diagramId: graph.diagram.id,
      format,
      ...input,
    });
    expect(created.isError).toBe(false);
    expect(created.structuredContent.status).toBe(201);
    const mcpId = created.structuredContent.body.jobId;
    await expect
      .poll(async () => {
        const response = await mcp<ExchangeJobStatus>(request, `/exports/diagrams/${mcpId}`);
        expect(response.isError).toBe(false);
        expect(
          response.structuredContent.body.state,
          response.structuredContent.body.error?.message,
        ).not.toBe('failed');
        return response.structuredContent.body.state;
      })
      .toBe('succeeded');
    const fromMcp = await readChunks(
      mcpId,
      format,
      async (offset, limit) => {
        const response = await mcp<ResultChunk>(
          request,
          `/exports/diagrams/${mcpId}/result?offset=${offset}&limit=${limit}`,
        );
        expect(response.isError).toBe(false);
        expect(response.structuredContent.status).toBe(200);
        return response.structuredContent.body;
      },
      1031,
    );
    expect(fromMcp.bytes.equals(native.bytes)).toBe(true);
    const single = (await (
      await request.get(`${base}/${rest.jobId}/result?offset=1&limit=1`)
    ).json()) as ResultChunk;
    expect(single).toMatchObject({
      offset: 1,
      nextOffset: 2,
      totalBytes: native.bytes.byteLength,
      encoding: 'base64',
    });
    expect(Buffer.from(single.data, 'base64')).toEqual(native.bytes.subarray(1, 2));
    for (const query of [
      'offset=-1',
      'offset=1&offset=2',
      `offset=${native.bytes.length + 1}`,
      'limit=0',
      `limit=${chunkLimit + 1}`,
      'offset=0&unknown=1',
    ]) {
      const invalid = await request.get(`${base}/${rest.jobId}/result?${query}`);
      expect(invalid.status(), await invalid.text()).toBe(422);
    }
    const removed = await mcp<ExchangeJobStatus>(
      request,
      `/exports/diagrams/${mcpId}`,
      'DELETE',
      {},
    );
    expect(removed.isError).toBe(false);
    expect(removed.structuredContent).toMatchObject({ status: 200, body: { state: 'cancelled' } });
    expect((await request.get(`${base}/${mcpId}/result`)).status()).toBe(404);
    const cancelled = await request.delete(`${base}/${rest.jobId}`);
    expect(cancelled.status(), await cancelled.text()).toBe(200);
    expect((await request.get(`${base}/${rest.jobId}`)).status()).toBe(404);
  }
  for (const extra of [
    { format: 'svg' },
    { scope: 'viewport' },
    { scope: 'selected' },
    { scope: 'selected', nodeIds: [ids.a, ids.a] },
    { nodeIds: [ids.a] },
    { scope: 'selected', nodeIds: [randomUUID()] },
    { source: secret },
  ]) {
    const invalid = await request.post(base, {
      data: { diagramId: graph.diagram.id, format: 'drawio', ...extra },
    });
    expect(invalid.status(), await invalid.text()).toBe(422);
  }
  const deniedRest = await request.post(`/api/v1/diagrams/${graph.diagram.id}/nodes`, {
    data: { title: 'Export must not grant write access' },
  });
  expect(deniedRest.status(), await deniedRest.text()).toBe(403);
  const deniedMcp = await mcp<unknown>(request, '/diagrams', 'POST', {
    name: 'Export must not bypass read-only',
    type: 'freeform',
  });
  expect(deniedMcp).toMatchObject({ isError: true, structuredContent: { status: 403 } });
  expect(await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json()).toEqual(before);
});

test('7,000-node draw.io worker exports stay responsive and UI downloads equal every bounded REST chunk', async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const created = await request.post('/api/v1/diagrams', {
    // Keep a normal viewport while the export covers the complete off-screen model.
    // Fitting all 7,000 cards would make canvas mounting part of the export timing probe.
    data: {
      name: 'Editable worker scale',
      type: 'freeform',
      settings: { viewport: { x: 30, y: 30, zoom: 1 } },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const diagram = await created.json();
  const ids = Array.from({ length: 7000 }, () => randomUUID());
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: ids.map((id, index) => ({
        id,
        title: `Module ${index} · 日本語 🧠`,
        x: (index % 100) * 250,
        y: Math.floor(index / 100) * 140,
        width: 200,
        height: 100,
      })),
      edges: ids.slice(1).map((id, index) => ({
        sourceNodeId: ids[index],
        targetNodeId: id,
        label: `Link ${index}`,
        direction: 'forward',
      })),
    },
  });
  expect(populated.status(), await populated.text()).toBe(200);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const started = Date.now();
  const job = await start(request, diagram.id, 'drawio');
  expect(Date.now() - started).toBeLessThan(5000);
  const status = await completed(request, job.jobId);
  expect(status).toMatchObject({ nodeCount: 7000, edgeCount: 6999 });
  const native = await result(request, job.jobId, 'drawio');
  expect(native.chunkCount).toBeGreaterThan(1);
  const parsed = assertNativeContent(native.bytes, 'drawio', 7000, 6999);
  expect(parsed.nodes[6999].title).toBe('Module 6999 · 日本語 🧠');
  expect(await page.locator('.export-canvas').count()).toBe(0);
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(page.locator('.canvas-statusbar')).toContainText('7000 nodes');
  await page.evaluate(() => {
    const probe = {
      ticks: 0,
      progress: false,
      offscreen: false,
      maxGap: 0,
      last: performance.now(),
    };
    Reflect.set(window, '__exchangeWorkerProbe', probe);
    const observer = new MutationObserver(() => {
      probe.progress ||= !!document.querySelector('dialog progress,[role="dialog"] progress');
      probe.offscreen ||= !!document.querySelector('.export-canvas');
    });
    observer.observe(document.body, { subtree: true, childList: true });
    const timer = setInterval(() => {
      const now = performance.now();
      probe.maxGap = Math.max(probe.maxGap, now - probe.last);
      probe.last = now;
      probe.ticks++;
    }, 10);
    Reflect.set(window, '__stopExchangeWorkerProbe', () => {
      clearInterval(timer);
      observer.disconnect();
    });
  });
  const ui = await download(page, 'drawio');
  const probe = await page.evaluate(() => {
    Reflect.get(window, '__stopExchangeWorkerProbe')();
    return Reflect.get(window, '__exchangeWorkerProbe') as {
      ticks: number;
      progress: boolean;
      offscreen: boolean;
      maxGap: number;
    };
  });
  expect(ui.equals(native.bytes)).toBe(true);
  expect(probe.progress).toBe(true);
  expect(probe.offscreen).toBe(false);
  expect(probe.ticks).toBeGreaterThan(3);
  expect(probe.maxGap).toBeLessThan(750);
  expect(errors).toEqual([]);
  await info.attach('editable-worker-scale', {
    body: JSON.stringify({
      nodes: 7000,
      edges: 6999,
      bytes: ui.byteLength,
      chunkCount: native.chunkCount,
      probe,
    }),
    contentType: 'application/json',
  });
});

test.describe('capture editable export UI', () => {
  test.skip(
    process.env.VISUAL_NERVE_CAPTURE_EXCHANGE !== '1',
    'Set VISUAL_NERVE_CAPTURE_EXCHANGE=1 to refresh the actual editable export screenshots.',
  );
  for (const surface of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`capture editable export UI ${surface.name} ${theme}`, async ({ page, request }) => {
        await page.setViewportSize({ width: surface.width, height: surface.height });
        const themed = await request.put('/api/v1/settings/theme', { data: { value: theme } });
        expect(themed.status(), await themed.text()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        const created = await request.post('/api/v1/diagrams', {
          data: { name: 'Customer onboarding', type: 'flowchart' },
        });
        expect(created.status(), await created.text()).toBe(201);
        const diagram = await created.json();
        const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
          data: {
            nodes: [
              {
                externalId: 'request',
                title: 'Customer request',
                nodeType: 'input',
                x: 40,
                y: 100,
                status: 'done',
              },
              {
                externalId: 'review',
                title: 'Review requirements',
                nodeType: 'decision',
                x: 350,
                y: 100,
                status: 'in-progress',
              },
              {
                externalId: 'deliver',
                title: 'Deliver and verify',
                nodeType: 'output',
                x: 660,
                y: 100,
                status: 'planned',
              },
            ].map((node) => ({ ...node, width: 230, height: 120, color: '#397356' })),
            edges: [
              {
                sourceExternalId: 'request',
                targetExternalId: 'review',
                label: 'Ready for review',
                direction: 'forward',
              },
              {
                sourceExternalId: 'review',
                targetExternalId: 'deliver',
                label: 'Approved',
                direction: 'forward',
              },
            ],
          },
        });
        expect(populated.status(), await populated.text()).toBe(200);
        if (surface.name === 'mobile')
          await page.getByRole('button', { name: 'Open projects', exact: true }).click();
        await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
        await expect(
          page.getByRole('heading', { name: 'Customer onboarding', level: 1, exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
        // Let the actual opening/fit animation settle; the capture changes no application styles.
        await page.waitForTimeout(450);
        if (surface.name === 'mobile')
          await page.getByRole('button', { name: 'Diagram actions', exact: true }).click();
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Export diagram', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Export format', { exact: true }).selectOption('vsdx');
        await dialog.getByLabel('Export area', { exact: true }).selectOption('complete');
        await expect(dialog.getByLabel('Export format').locator('option:checked')).toHaveText(
          'Visio (.vsdx) · preview',
        );
        await expect(dialog.getByLabel('Export area').locator('option:checked')).toHaveText(
          'Complete diagram',
        );
        await expect(dialog.getByRole('note')).toContainText(
          'compatibility must still be verified in Microsoft Visio',
        );
        await expect(dialog).toContainText('Uses saved 2D layout and logical process nodes.');
        await expect(dialog).toContainText(
          'Exports editable shapes, text, basic colors, groups and attached connectors.',
        );
        expect(await dialog.innerText()).not.toMatch(/\b(?:dialogs|privacy|shared)\.[A-Za-z]/);
        await dialog.getByRole('heading', { name: 'Export diagram', exact: true }).click();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          );
        });
        const layout = await dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: bounds.x,
            y: bounds.y,
            right: bounds.right,
            bottom: bounds.bottom,
            height: element.clientHeight,
            scrollHeight: element.scrollHeight,
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        });
        expect(layout.x).toBeGreaterThanOrEqual(-1);
        expect(layout.y).toBeGreaterThanOrEqual(-1);
        expect(layout.right).toBeLessThanOrEqual(surface.width + 1);
        expect(layout.bottom).toBeLessThanOrEqual(surface.height + 1);
        expect(
          layout.scrollHeight,
          'All export fields, explanations and actions must fit without clipping.',
        ).toBeLessThanOrEqual(layout.height + 1);
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
        for (const name of ['Cancel', 'Export', 'Close dialog']) {
          const button = dialog.getByRole('button', { name, exact: true });
          await expect(button).toBeInViewport({ ratio: 0.999 });
          expect(
            await button.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const target = document.elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2,
              );
              return !!target && element.contains(target);
            }),
            `${name} must remain reachable`,
          ).toBe(true);
        }
        const output = resolve('../docs/acceptance');
        await mkdir(output, { recursive: true });
        const suffix = theme === 'dark' ? '-dark' : '';
        await page.screenshot({
          path: resolve(output, `export-editable-${surface.name}${suffix}.png`),
          animations: 'disabled',
        });
      });
    }
  }
});
