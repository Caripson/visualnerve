import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from './fixtures';
import type { SvgJobStatus } from '../../src/export/svg-job-types';
import type { ExchangeJobStatus } from '../../src/export/exchange-types';

// Native SVG workers and crypto remain real; service-worker caching is covered separately.
test.use({ serviceWorkers: 'block' });

const encryptedAppOrigin =
  process.env.VISUAL_NERVE_SVG_APP_ORIGIN ?? 'https://public-app.test:4341';
const encryptedBridgeOrigin =
  process.env.VISUAL_NERVE_SVG_BRIDGE_ORIGIN ?? 'https://127.0.0.1:4329';
const encryptedBridgeAddress = `wss://${new URL(encryptedBridgeOrigin).host}/bridge`;

async function start(request: APIRequestContext, diagramId: string, options = {}) {
  const response = await request.post('/api/v1/exports/svg', { data: { diagramId, ...options } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<SvgJobStatus>;
}
async function completed(
  request: APIRequestContext,
  jobId: string,
  family: 'svg' | 'diagrams' = 'svg',
) {
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/exports/${family}/${jobId}`);
      expect(response.status(), await response.text()).toBe(200);
      const status = (await response.json()) as SvgJobStatus | ExchangeJobStatus;
      expect(status.state, status.error?.message).not.toBe('failed');
      return status.state;
    })
    .toBe('succeeded');
}
async function result(request: APIRequestContext, jobId: string) {
  let xml = '',
    offset = 0;
  for (let count = 0; count < 128; count++) {
    const response = await request.get(
      `/api/v1/exports/svg/${jobId}/result?offset=${offset}&limit=1048576`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const chunk = (await response.json()) as {
      jobId: string;
      offset: number;
      nextOffset: number;
      totalCharacters: number;
      text: string;
      complete: boolean;
    };
    expect(chunk.jobId).toBe(jobId);
    expect(chunk.offset).toBe(offset);
    expect(chunk.text.length).toBeLessThanOrEqual(1048576);
    xml += chunk.text;
    expect(chunk.nextOffset).toBe(xml.length);
    offset = chunk.nextOffset;
    if (chunk.complete) {
      expect(xml.length).toBe(chunk.totalCharacters);
      return xml;
    }
    expect(chunk.nextOffset).toBeLessThan(chunk.totalCharacters);
  }
  throw new Error('SVG did not finish within the documented chunk/output limit.');
}

test('7,000-node native SVG jobs and UI use the same worker, remain responsive, and return every connection in bounded chunks', async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Background SVG scale',
        type: 'flowchart',
        settings: { viewport: { x: 30, y: 30, zoom: 1 } },
      },
    })
  ).json();
  const ids = Array.from({ length: 7000 }, () => randomUUID());
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: ids.map((id, index) => ({
        id,
        title: `Module ${index}`,
        x: (index % 100) * 250,
        y: Math.floor(index / 100) * 140,
        width: 200,
        height: 100,
        color: index % 2 ? '#37648d' : '#23664d',
        status: index % 5 === 0 ? 'done' : 'planned',
        metadata: { visualNerve: { icon: index % 2 ? 'technology' : 'work' } },
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
  // Exporting an unopened model must not create an offscreen DOM tree or switch documents.
  const started = Date.now(),
    job = await start(request, diagram.id);
  expect(Date.now() - started).toBeLessThan(5000);
  await completed(request, job.jobId);
  const xml = await result(request, job.jobId);
  expect((xml.match(/data-node-id=/g) ?? []).length).toBe(7000);
  expect((xml.match(/data-edge-id=/g) ?? []).length).toBe(6999);
  expect(xml).toContain('Module 6999');
  expect(xml).toContain('model-vector-v1');
  expect(xml).not.toMatch(/<foreignObject|<image|<script/);
  expect(await page.locator('.export-canvas').count()).toBe(0);
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(page.locator('.canvas-statusbar')).toContainText('7000 nodes');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('svg');
  await page.evaluate(() => {
    const probe = {
      ticks: 0,
      progress: false,
      offscreen: false,
      maxGap: 0,
      last: performance.now(),
    };
    Reflect.set(window, '__svgWorkerProbe', probe);
    const observe = new MutationObserver(() => {
      probe.progress ||= !!document.querySelector('dialog progress,[role="dialog"] progress');
      probe.offscreen ||= !!document.querySelector('.export-canvas');
    });
    observe.observe(document.body, { subtree: true, childList: true });
    const timer = setInterval(() => {
      const now = performance.now();
      probe.maxGap = Math.max(probe.maxGap, now - probe.last);
      probe.last = now;
      probe.ticks++;
    }, 10);
    Reflect.set(window, '__stopSvgWorkerProbe', () => {
      clearInterval(timer);
      observe.disconnect();
    });
  });
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloading,
    uiXML = await readFile((await download.path())!, 'utf8');
  const probe = await page.evaluate(() => {
    Reflect.get(window, '__stopSvgWorkerProbe')();
    return Reflect.get(window, '__svgWorkerProbe') as {
      ticks: number;
      progress: boolean;
      offscreen: boolean;
      maxGap: number;
    };
  });
  expect(uiXML).toBe(xml);
  expect(probe.progress).toBe(true);
  expect(probe.offscreen).toBe(false);
  expect(probe.ticks).toBeGreaterThan(3);
  expect(probe.maxGap).toBeLessThan(750);
  expect(errors).toEqual([]);
  await info.attach('native-svg-worker-scale', {
    body: JSON.stringify({
      nodeCount: 7000,
      edgeCount: 6999,
      bytes: Buffer.byteLength(xml),
      probe,
    }),
    contentType: 'application/json',
  });
});

test('background jobs preserve dark appearance, saved viewport and native vector rasterization; cancel destroys results', async ({
  page,
  request,
}, info) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Native worker appearance',
        type: 'flowchart',
        settings: { viewport: { x: 35, y: 45, zoom: 1.2 } },
      },
    })
  ).json();
  const ids = Array.from({ length: 121 }, () => randomUUID()),
    groupId = randomUUID();
  expect(
    (
      await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
        data: {
          nodes: [
            {
              id: groupId,
              title: 'Transparent process boundary',
              nodeType: 'group',
              x: -30,
              y: -30,
              width: 2800,
              height: 1500,
              color: '#37648d',
            },
            ...ids.map((id, index) => ({
              id,
              title: `Readable ${index}`,
              x: (index % 11) * 240,
              y: Math.floor(index / 11) * 120,
              parentId: groupId,
              status: ['planned', 'in-progress', 'blocked'][index] ?? 'done',
              color: '#37648d',
              metadata: { visualNerve: { icon: 'work' } },
            })),
          ],
          edges: ids.slice(1).map((id, index) => ({
            sourceNodeId: ids[index],
            targetNodeId: id,
            direction: 'both',
          })),
        },
      })
    ).status(),
  ).toBe(200);
  // Leave this document unopened so its explicit viewport is not replaced by Fit view.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
  const job = await start(request, diagram.id, { scope: 'viewport' });
  await completed(request, job.jobId);
  const xml = await result(request, job.jobId);
  const raster = await page.evaluate(async (xml) => {
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('Native XML invalid');
    const background = doc.querySelector('svg > rect')?.getAttribute('fill');
    const badgeColors = ['planned', 'in-progress', 'blocked'].map((status) =>
      doc.querySelector(`[data-status-badge="${status}"]`)?.getAttribute('fill'),
    );
    const path = doc.querySelector('[data-edge-id] > path') as unknown as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const scene = doc.querySelector('svg > g') as unknown as SVGGElement;
    const pixel = new DOMPoint(point.x, point.y).matrixTransform(
      scene.transform.baseVal.consolidate()!.matrix,
    );
    const blob = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = blob;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 60 && data[i + 1] > 60 && data[i + 2] > 60) ink++;
      // The connection lies inside the group. An opaque group rendered after edges
      // erases this stroke even though XML object counts and global ink still pass.
      const line = ctx.getImageData(Math.round(pixel.x) - 2, Math.round(pixel.y) - 2, 5, 5).data;
      const connectionInk = Math.max(...Array.from(line).filter((_, index) => index % 4 !== 3));
      return {
        background,
        badgeColors,
        ink,
        connectionInk,
        png: canvas.toDataURL('image/png').split(',')[1],
      };
    } finally {
      URL.revokeObjectURL(blob);
    }
  }, xml);
  expect(raster.background).toBe('#171c19');
  expect(raster.badgeColors).toEqual(['#283341', '#172d55', '#4c1d24']);
  expect(raster.ink).toBeGreaterThan(500);
  expect(raster.connectionInk).toBeGreaterThan(80);
  await info.attach('native-worker-dark-viewport', {
    body: Buffer.from(raster.png, 'base64'),
    contentType: 'image/png',
  });
  expect((await request.delete(`/api/v1/exports/svg/${job.jobId}`)).status()).toBe(200);
  expect((await request.get(`/api/v1/exports/svg/${job.jobId}/result`)).status()).toBe(404);
  expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(before);
});

test('encrypted read-only SVG and editable jobs survive POST disposal and erase completed results and blocked workers on lock/reunlock', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120000);
  const request = await playwright.request.newContext({
    baseURL: encryptedBridgeOrigin,
    ignoreHTTPSErrors: true,
  });
  const passphrase = 'SVG native export originating encrypted workspace';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(encryptedAppOrigin);
  await page.getByLabel('New workspace password', { exact: true }).fill(passphrase);
  await page.getByLabel('Confirm new password', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await expect(page.getByLabel('Recovery key — keep it private')).toHaveValue(/^VNREC1-/);
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('I accept local storage and offline caching', { exact: true }).check();
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  const grant = async (access: 'read' | 'write') => {
    await page
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await page.getByText('Local connection details', { exact: true }).click();
    await page.getByLabel('Local bridge address', { exact: true }).fill(encryptedBridgeAddress);
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await page.getByLabel('MCP access', { exact: true }).selectOption(access);
    await expect.poll(async () => (await request.get('/api/v1/diagrams')).status()).toBe(200);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  };
  let unblock = () => {};
  try {
    await grant('write');
    const diagram = await (
      await request.post('/api/v1/diagrams', {
        data: { name: 'Protected native SVG', type: 'flowchart' },
      })
    ).json();
    expect(
      (
        await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
          data: {
            nodes: Array.from({ length: 151 }, (_, index) => ({
              title: `Protected module ${index}`,
              x: (index % 15) * 240,
              y: Math.floor(index / 15) * 120,
            })),
          },
        })
      ).status(),
    ).toBe(200);
    await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
    await expect(page.locator('.canvas-statusbar')).toContainText('151 nodes');
    await grant('read');
    const before = await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json();
    const job = await start(request, diagram.id);
    await completed(request, job.jobId);
    const xml = await result(request, job.jobId);
    expect(xml).toContain('Protected module 150');
    // Status and result happen in later HTTP commands; the initial POST lease has already disposed.
    expect((await request.delete(`/api/v1/exports/svg/${job.jobId}`)).status()).toBe(200);
    expect((await request.get(`/api/v1/exports/svg/${job.jobId}`)).status()).toBe(404);
    expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(before);
    // The completed binary result retains the same original read grant after its POST closes.
    const drawioStarted = await request.post('/api/v1/exports/diagrams', {
      data: { diagramId: diagram.id, format: 'drawio' },
    });
    expect(drawioStarted.status(), await drawioStarted.text()).toBe(201);
    const retainedDrawio = (await drawioStarted.json()) as ExchangeJobStatus;
    await completed(request, retainedDrawio.jobId, 'diagrams');
    const drawioResult = await request.get(
      `/api/v1/exports/diagrams/${retainedDrawio.jobId}/result`,
    );
    expect(drawioResult.status(), await drawioResult.text()).toBe(200);
    const drawioChunk = await drawioResult.json();
    expect(drawioChunk).toMatchObject({
      format: 'drawio',
      encoding: 'base64',
      offset: 0,
      complete: true,
    });
    const drawioBytes = Buffer.from(drawioChunk.data, 'base64');
    expect(drawioBytes.toString('utf8')).toContain('<mxGraphModel');
    expect(drawioBytes.byteLength).toBe(drawioChunk.totalBytes);
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let scriptRequested = false;
    await page.route('**/svg-worker-*.js', async (route) => {
      scriptRequested = true;
      await blocked;
      await route.continue().catch(() => undefined);
    });
    let exchangeScriptRequested = false;
    await page.route('**/exchange-worker-*.js', async (route) => {
      exchangeScriptRequested = true;
      await blocked;
      await route.continue().catch(() => undefined);
    });
    const pending = await start(request, diagram.id);
    await expect.poll(() => scriptRequested).toBe(true);
    expect((await (await request.get(`/api/v1/exports/svg/${pending.jobId}`)).json()).state).toBe(
      'running',
    );
    const pendingDrawioStarted = await request.post('/api/v1/exports/diagrams', {
      data: { diagramId: diagram.id, format: 'drawio' },
    });
    expect(pendingDrawioStarted.status(), await pendingDrawioStarted.text()).toBe(201);
    const pendingDrawio = (await pendingDrawioStarted.json()) as ExchangeJobStatus;
    await expect.poll(() => exchangeScriptRequested).toBe(true);
    expect(
      (await (await request.get(`/api/v1/exports/diagrams/${pendingDrawio.jobId}`)).json()).state,
    ).toBe('running');
    await page
      .getByRole('button', { name: 'Local only: storage and privacy', exact: true })
      .click();
    await page.getByRole('button', { name: 'Lock now', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
    ).toBeVisible();
    unblock();
    await page.getByLabel('Workspace password', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Protected native SVG', exact: true, level: 1 }),
    ).toBeVisible();
    await grant('read');
    expect((await request.get(`/api/v1/exports/svg/${pending.jobId}`)).status()).toBe(404);
    expect((await request.get(`/api/v1/exports/svg/${pending.jobId}/result`)).status()).toBe(404);
    for (const jobId of [retainedDrawio.jobId, pendingDrawio.jobId]) {
      expect((await request.get(`/api/v1/exports/diagrams/${jobId}`)).status()).toBe(404);
      expect((await request.get(`/api/v1/exports/diagrams/${jobId}/result`)).status()).toBe(404);
    }
    expect(await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    unblock();
    await request.dispose();
  }
});
