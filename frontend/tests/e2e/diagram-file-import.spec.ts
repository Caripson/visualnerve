import { test, expect, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { visioPackageParts, vsdxFixture } from '../fixtures/vsdx';
import { readFile } from 'node:fs/promises';
import { browserLaunchOptions } from '../../playwright.config';

test.use({
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

const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Start import" vertex="1" parent="1" style="fillColor=#d5e8d4;"><mxGeometry x="40" y="40" width="180" height="80" as="geometry"/></mxCell><mxCell id="b" value="Review result" vertex="1" parent="1" style="rhombus;"><mxGeometry x="350" y="40" width="180" height="100" as="geometry"/></mxCell><mxCell id="edge" value="Check" edge="1" source="a" target="b" parent="1" style="strokeColor=#cc0000;dashed=1;endArrow=classic;"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>`;
const drawio = `<mxfile><diagram id="overview" name="Overview">${model}</diagram><diagram id="detail" name="Detailed process">${model.replace('Start import', 'Detailed start')}</diagram></mxfile>`;
const visio = vsdxFixture(
  visioPackageParts(
    `<Shapes><Shape ID="1" NameU="Process"><Cell N="PinX" V="2"/><Cell N="PinY" V="3"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Visio source</Text></Shape><Shape ID="2" NameU="Decision"><Cell N="PinX" V="5"/><Cell N="PinY" V="3"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Visio review</Text></Shape><Shape ID="3" OneD="1"><Cell N="BeginArrow" V="0"/><Cell N="EndArrow" V="4"/><Cell N="LinePattern" V="2"/><Text>Visio connection</Text></Shape></Shapes><Connects><Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="3" FromCell="EndX" ToSheet="2"/></Connects>`,
  ),
);
const saved = (page: Page) =>
  expect(page.locator('.document-actions .save-status')).toHaveText('Saved');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Import diagram file' });

test('imports a chosen draw.io page through the file picker and keeps native links editable through reload and export', async ({
  page,
  request,
}, testInfo) => {
  const before = await (await request.get('/api/v1/diagrams')).json();
  await expect(page.getByLabel('Import file', { exact: true })).toHaveAttribute(
    'accept',
    /\.drawio.*\.vsdx/,
  );
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'workflow.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from(drawio),
  });
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Diagram page', { exact: true })).toHaveValue('overview');
  await dialog(page).screenshot({ path: testInfo.outputPath('drawio-preview.png') });
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  await page.getByLabel('Diagram page', { exact: true }).selectOption('detail');
  await page.getByLabel('Imported diagram name', { exact: true }).fill('Imported native process');
  await dialog(page).getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await saved(page);
  await expect(page.locator('.canvas-shell')).toContainText('Detailed start');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const record = diagrams.find(
    (entry: { name: string }) => entry.name === 'Imported native process',
  );
  const graph: Graph = await (await request.get(`/api/v1/diagrams/${record.id}`)).json();
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges[0]).toMatchObject({ direction: 'forward', style: 'dashed', label: 'Check' });
  expect(graph.diagram.metadata.diagramImport).toMatchObject({
    format: 'drawio',
    pageId: 'detail',
  });
  await request.patch(`/api/v1/nodes/${graph.nodes[0].id}`, {
    data: { version: graph.nodes[0].version, notes: 'Editable after import', status: 'done' },
  });
  const output = await request.post('/api/v1/export', {
    data: { diagramId: graph.diagram.id, format: 'json' },
  });
  expect((await output.json()).nodes[0]).toMatchObject({
    notes: 'Editable after import',
    status: 'done',
  });
  await page.reload();
  await expect(page.locator('.canvas-shell')).toContainText('Detailed start');
  await saved(page);
});

test('drops a real Visio ZIP locally, previews source connections and creates editable native nodes', async ({
  page,
  request,
}) => {
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], 'service.vsdx', {
          type: 'application/vnd.ms-visio.drawing',
        }),
      );
      return data;
    },
    [...visio],
  );
  await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByLabel('Diagram page', { exact: true })).toContainText(
    'Operations (2 objects, 1 connections)',
  );
  await page.getByLabel('Imported diagram name', { exact: true }).fill('Visio native flow');
  await dialog(page).getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await saved(page);
  await expect(page.locator('.canvas-shell')).toContainText('Visio source');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const records = await (await request.get('/api/v1/diagrams')).json();
  const id = records.find((entry: { name: string }) => entry.name === 'Visio native flow').id;
  const graph: Graph = await (await request.get(`/api/v1/diagrams/${id}`)).json();
  expect(graph.nodes[0]).toMatchObject({ x: 96, y: 624, width: 192, height: 96 });
  expect(graph.edges[0]).toMatchObject({
    label: 'Visio connection',
    style: 'dashed',
    sourceNodeId: graph.nodes[0].id,
    targetNodeId: graph.nodes[1].id,
  });
  await transfer.dispose();
});

test('MCP previews diagram files with read access and imports a selected page only with write access', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await (await request.get('/api/v1/diagrams')).json();
  const call = async (path: string, data: unknown) =>
    (
      await (
        await request.post('/mcp', {
          data: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'visual_nerve_request', arguments: { path, method: 'POST', data } },
          },
        })
      ).json()
    ).result;
  const input = { format: 'vsdx', data: Buffer.from(visio).toString('base64'), name: 'MCP Visio' };
  const preview = await call('/diagram-files/preview', input);
  expect(preview.isError).toBe(false);
  expect(preview.structuredContent.body.pages[0].graph.edges).toHaveLength(1);
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  expect((await call('/import', input)).structuredContent.status).toBe(403);
  await page.getByRole('button', { name: 'Local only: storage and privacy', exact: true }).click();
  await page.getByLabel('MCP access', { exact: true }).selectOption('write');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const created = await call('/import', {
    ...input,
    pageId: preview.structuredContent.body.pages[0].id,
  });
  expect(created.isError).toBe(false);
  expect(created.structuredContent.status).toBe(201);
  await expect(page.locator('.canvas-shell')).toContainText('Visio review');
});

test('preview fits a phone and cancel or a malformed file leaves the workspace unchanged', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const before = await (await request.get('/api/v1/diagrams')).json();
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'mobile.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from(drawio),
  });
  await expect(page.getByLabel('Diagram page', { exact: true })).toBeVisible();
  expect(await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await dialog(page).screenshot({ path: testInfo.outputPath('drawio-preview-phone.png') });
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'broken.vsdx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a zip'),
  });
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Create diagram', exact: true }),
  ).toBeDisabled();
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
});

test.describe('imported native diagram views', () => {
  test('retains imported cards and styled relationships through 3D/2D and produces rendered PNG/PDF exports', async ({
    page,
    request,
  }) => {
    test.setTimeout(150000);
    const response = await request.post('/api/v1/import', {
      data: { format: 'drawio', data: drawio, pageId: 'overview', name: 'Imported view proof' },
    });
    expect(response.status()).toBe(201);
    const graph: Graph = await response.json();
    await expect(page.locator('.canvas-shell')).toContainText('Start import');
    await expect(page.locator('.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(204, 0, 0)');
    await page.getByRole('button', { name: '3D view', exact: true }).click();
    await expect(page.getByTestId('spatial-view')).toHaveAttribute('data-renderer', 'ready', {
      timeout: 30000,
    });
    const canvas = page.getByTestId('spatial-canvas');
    await expect(canvas).toBeVisible();
    await expect
      .poll(
        async () => JSON.parse((await canvas.getAttribute('data-face-projections')) ?? '[]').length,
      )
      .toBe(2);
    await page.getByRole('button', { name: '2D view', exact: true }).click();
    await saved(page);
    const stored: Graph = await (await request.get(`/api/v1/diagrams/${graph.diagram.id}`)).json();
    expect(stored.nodes).toEqual(graph.nodes);
    expect(stored.edges).toEqual(graph.edges);
    await expect(page.locator('.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(204, 0, 0)');
    for (const format of ['png', 'pdf'] as const) {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByLabel('Export format', { exact: true }).selectOption(format);
      await page.getByLabel('Export area', { exact: true }).selectOption('complete');
      await page.getByLabel('Export resolution', { exact: true }).selectOption('1');
      const pending = page.waitForEvent('download');
      await page
        .getByRole('dialog', { name: 'Export diagram', exact: true })
        .getByRole('button', { name: 'Export', exact: true })
        .click();
      const bytes = await readFile((await (await pending).path())!);
      if (format === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      else {
        expect(bytes.readUInt32BE(16)).toBeGreaterThan(300);
        const darkPixels = await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const surface = document.createElement('canvas');
          surface.width = image.width;
          surface.height = image.height;
          const context = surface.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
          let dark = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i + 3] > 0 && pixels[i] < 160 && pixels[i + 1] < 160 && pixels[i + 2] < 160)
              dark++;
          return dark;
        }, bytes.toString('base64'));
        expect(darkPixels).toBeGreaterThan(100);
      }
    }
  });
});
