import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import type { Graph } from '../../src/model/types';
async function exportFile(
  page: Page,
  format: 'png' | 'pdf' | 'svg',
  scope: string,
  resolution = '1',
  tiled = false,
  transparent = false,
) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export diagram', exact: true });
  await dialog.getByLabel('Export format').selectOption(format);
  await dialog.getByLabel('Export area', { exact: true }).selectOption(scope);
  if (format !== 'svg') await dialog.getByLabel('Export resolution').selectOption(resolution);
  const background = dialog.getByRole('checkbox', { name: 'Transparent background', exact: true });
  if (format === 'pdf') {
    await expect(background).toHaveCount(0);
    await page.getByLabel('PDF paper').selectOption('a3');
    await page.getByLabel('PDF orientation').selectOption('portrait');
    if (tiled) await page.getByLabel('Tile across pages').check();
  } else {
    await expect(background).not.toBeChecked();
    if (transparent) await background.check();
  }
  const downloading = page.waitForEvent('download', { timeout: 30000 });
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const result = await downloading;
  await expect(dialog).toBeHidden();
  return readFile((await result.path())!);
}

async function exportedPixels(page: Page, bytes: Buffer, format: 'png' | 'svg') {
  const mimeType = format === 'png' ? 'image/png' : 'image/svg+xml';
  return page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let nodeFill = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          pixels[offset] === 43 &&
          pixels[offset + 1] === 109 &&
          pixels[offset + 2] === 142 &&
          pixels[offset + 3] === 255
        )
          nodeFill++;
      }
      return { cornerAlpha: pixels[3], nodeFill };
    },
    `data:${mimeType};base64,${bytes.toString('base64')}`,
  );
}

test('PNG and SVG can omit the canvas background and preserve the node fill', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/v1/diagrams', {
    data: {
      name: 'Transparent image exports',
      type: 'mindmap',
      settings: { viewport: { x: 100, y: 110, zoom: 1 }, viewportDevice: 'desktop' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const diagram = await created.json();
  const added = await request.post(`/api/v1/diagrams/${diagram.id}/nodes`, {
    data: { title: 'Filled card', backgroundColor: '#2b6d8e' },
  });
  expect(added.status(), await added.text()).toBe(201);
  const node = await added.json();
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await page.locator(`.canvas-shell [data-node-id="${node.id}"]`).click();

  for (const [format, scope, transparent] of [
    ['png', 'complete', false],
    ['png', 'complete', true],
    ['png', 'viewport', true],
    ['png', 'selected', true],
    ['svg', 'complete', false],
    ['svg', 'complete', true],
  ] as const) {
    const bytes = await exportFile(page, format, scope, '1', false, transparent);
    const pixels = await exportedPixels(page, bytes, format);
    expect(pixels.cornerAlpha, `${format} ${scope} transparent=${transparent}`).toBe(
      transparent ? 0 : 255,
    );
    expect(pixels.nodeFill).toBeGreaterThan(100);
  }

  const svg = { diagramId: diagram.id, transparentBackground: true };
  const sync = await request.post('/api/v1/export', { data: { ...svg, format: 'svg' } });
  expect(sync.status(), await sync.text()).toBe(200);
  const syncPixels = await exportedPixels(page, Buffer.from(await sync.json()), 'svg');
  expect(syncPixels.cornerAlpha).toBe(0);
  expect(syncPixels.nodeFill).toBeGreaterThan(100);

  const job = await request.post('/api/v1/exports/svg', { data: svg });
  expect(job.status(), await job.text()).toBe(201);
  const { jobId } = await job.json();
  await expect
    .poll(async () => (await (await request.get(`/api/v1/exports/svg/${jobId}`)).json()).state)
    .toBe('succeeded');
  const result = await request.get(`/api/v1/exports/svg/${jobId}/result`);
  expect(result.status(), await result.text()).toBe(200);
  const chunk = await result.json();
  expect(chunk.complete).toBe(true);
  const workerPixels = await exportedPixels(page, Buffer.from(chunk.text), 'svg');
  expect(workerPixels.cornerAlpha).toBe(0);
  expect(workerPixels.nodeFill).toBeGreaterThan(100);
});

test('complete, viewport and selection PNGs contain rendered pixels; A3 portrait PDF tiles', async ({
  page,
  request,
}, testInfo) => {
  const d = await (
    await request.post('/api/v1/diagrams', {
      data: { name: 'Export areas', settings: { viewport: { x: 20, y: 200, zoom: 1 } } },
    })
  ).json();
  const g = (await (
    await request.post(`/api/v1/diagrams/${d.id}/bulk`, {
      data: {
        nodes: Array.from({ length: 12 }, (_, i) => ({
          title: `Export node ${i}`,
          externalId: `node-${i}`,
          x: i * 300,
          y: (i % 2) * 120,
        })),
        edges: Array.from({ length: 11 }, (_, i) => ({
          sourceExternalId: `node-${i}`,
          targetExternalId: `node-${i + 1}`,
        })),
      },
    })
  ).json()) as Graph;
  await page.goto('/app/');
  await page.locator('.diagram-item').filter({ hasText: 'Export areas' }).click();
  await expect(page.locator(`[data-node-id="${g.nodes[0].id}"]`)).toBeVisible();
  await page.locator(`[data-node-id="${g.nodes[0].id}"]`).click();
  const selected = await exportFile(page, 'png', 'selected');
  expect(selected.readUInt32BE(16)).toBe(280);
  expect(selected.readUInt32BE(20)).toBe(166);
  const pixels = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    let dark = 0;
    for (let i = 0; i < rgba.length; i += 4)
      if (rgba[i] < 180 && rgba[i + 1] < 180 && rgba[i + 2] < 180) dark++;
    return dark;
  }, selected.toString('base64'));
  expect(pixels).toBeGreaterThan(100);
  const viewport = await exportFile(page, 'png', 'viewport', '4');
  const rect = await page.locator('.canvas-shell .react-flow').boundingBox();
  expect(viewport.readUInt32BE(16)).toBe(Math.round(rect!.width * 4));
  expect(viewport.readUInt32BE(20)).toBe(Math.round(rect!.height * 4));
  const complete = await exportFile(page, 'png', 'complete', '2');
  expect(complete.readUInt32BE(16)).toBe(7160);
  await testInfo.attach('complete.png', { body: complete, contentType: 'image/png' });
  const pdf = await exportFile(page, 'pdf', 'complete', '1', true);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  const pages = pdf.toString('latin1').match(/\/Count\s+(\d+)/);
  expect(Number(pages?.[1])).toBeGreaterThan(1);
  await testInfo.attach('tiled-a3-portrait.pdf', { body: pdf, contentType: 'application/pdf' });
});
test('search reveals a collapsed branch and preserves metadata navigation', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Hidden search', type: 'mindmap' } })
  ).json();
  const g = (await (
    await request.post(`/api/v1/diagrams/${d.id}/bulk`, {
      data: {
        nodes: [
          { title: 'Root', externalId: 'root', collapsed: true },
          {
            title: 'Deep research',
            parentExternalId: 'root',
            x: 300,
            metadata: { projectCode: 'nordic-hidden' },
          },
        ],
      },
    })
  ).json()) as Graph;
  await page.goto('/app/');
  await page.locator('.diagram-item').filter({ hasText: 'Hidden search' }).click();
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(1);
  await page.keyboard.press('Control+f');
  await page.getByLabel('Global search').fill('nordic-hidden');
  await page.locator('.search-results button').filter({ hasText: 'Deep research' }).click();
  await expect(page.getByLabel('Node title')).toHaveValue('Deep research');
  await expect(page.locator(`[data-node-id="${g.nodes[1].id}"]`)).toBeVisible();
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(2);
});
