import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type APIRequestContext } from './fixtures';
import type { Graph } from '../../src/model/types';
import { notationTemplates } from '../../src/notation/templates';
import { notationGeometry } from '../../src/notation/geometry';
import { browserLaunchOptions } from '../../playwright.config';
import { captureAppearancePair } from './capture-appearance';

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
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved');
async function graph(request: APIRequestContext, id: string): Promise<Graph> {
  const response = await request.get(`/api/v1/diagrams/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function create(request: APIRequestContext, template: string, name: string) {
  const response = await request.post('/api/v1/diagrams', { data: { name, template } });
  expect(response.status()).toBe(201);
  return graph(request, (await response.json()).id);
}
async function open(page: Page, name: string) {
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await expect(page.locator('.project-title-button')).toHaveText(name);
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
}
async function tool(request: APIRequestContext, name: string, args: object) {
  const response = await request.post('/mcp', {
    data: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.status()).toBe(200);
  const value = (await response.json()).result;
  expect(value.isError).not.toBe(true);
  return value.structuredContent?.body ?? value.structuredContent ?? value;
}

test('all21 native starting sets render, persist and expose their actual semantic catalog through REST and MCP', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await tool(request, 'visual_nerve_api_docs', { document: 'guide' });
  const collections = await tool(request, 'visual_nerve_request', {
    path: '/notation/collections',
  });
  expect(collections).toHaveLength(5);
  const captureKeys = ['hipo', 'dfd-gane-sarson', 'uml-class', 'bpmn-process'];
  const examples = [
    ...notationTemplates.filter((example) => captureKeys.includes(example.key)),
    ...notationTemplates.filter((example) => !captureKeys.includes(example.key)),
  ];
  for (const example of examples) {
    const model = await create(request, example.key, example.name);
    await open(page, model.diagram.name);
    await expect(page.locator('.notation-node')).toHaveCount(model.nodes.length);
    expect(
      await page
        .locator('.editor-toolbar')
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page
        .locator('.notation-node-content:not([data-title-style="hidden"]) .node-title')
        .evaluateAll((titles) =>
          titles.every(
            (title) =>
              title.getBoundingClientRect().width <=
              title.parentElement!.getBoundingClientRect().width + 1,
          ),
        ),
    ).toBe(true);
    for (const node of model.nodes)
      await expect(page.locator(`[data-node-id="${node.id}"]`)).toHaveAttribute(
        'data-notation-symbol',
        node.notation!.symbol,
      );
    const review = await tool(request, 'visual_nerve_request', {
      path: `/diagrams/${model.diagram.id}/notation/validate`,
      method: 'POST',
    });
    expect(review.issues).toEqual([]);
    const fromMcp = await tool(request, 'visual_nerve_request', {
      path: `/diagrams/${model.diagram.id}`,
    });
    expect(fromMcp.diagram.notation).toEqual(model.diagram.notation);
    expect(fromMcp.nodes.map((node: { notation: unknown }) => node.notation)).toEqual(
      model.nodes.map((node) => node.notation),
    );
    const exported = await request.post('/api/v1/export', {
      data: { diagramId: model.diagram.id, format: 'svg' },
    });
    expect(exported.status()).toBe(200);
    const xml = await exported.json();
    expect(
      await page.evaluate(
        ({ xml, outlines }) => {
          const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
          return {
            errors: document.querySelectorAll('parsererror').length,
            shapes: outlines.filter(({ id, path }) =>
              [
                ...(document.querySelector(`[data-node-id="${id}"]`)?.querySelectorAll('path') ??
                  []),
              ].some((element) => element.getAttribute('d') === path),
            ).length,
            raster: document.querySelectorAll('image,foreignObject').length,
          };
        },
        {
          xml,
          outlines: model.nodes.map((node) => ({
            id: node.id,
            path: notationGeometry(node.notation!).outlinePath,
          })),
        },
      ),
    ).toEqual({ errors: 0, shapes: model.nodes.length, raster: 0 });
    const background = await request.post('/api/v1/exports/svg', {
      data: { diagramId: model.diagram.id },
    });
    expect(background.status()).toBe(201);
    const job = await background.json();
    await expect
      .poll(async () => {
        const status = await (await request.get(`/api/v1/exports/svg/${job.jobId}`)).json();
        expect(status.state, status.error?.message).not.toBe('failed');
        return status.state;
      })
      .toBe('succeeded');
    const chunk = await (
      await request.get(`/api/v1/exports/svg/${job.jobId}/result?offset=0&limit=1048576`)
    ).json();
    expect(chunk.complete).toBe(true);
    expect(
      await page.evaluate((xml) => {
        const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
        return {
          errors: document.querySelectorAll('parsererror').length,
          shapes: document.querySelectorAll('[data-notation-outline]').length,
          raster: document.querySelectorAll('image,foreignObject').length,
        };
      }, chunk.text),
    ).toEqual({ errors: 0, shapes: model.nodes.length, raster: 0 });
    expect((await request.delete(`/api/v1/exports/svg/${job.jobId}`)).status()).toBe(200);
    if (
      process.env.VN_CAPTURE_NOTATION === '1' &&
      ['hipo', 'dfd-gane-sarson', 'uml-class', 'bpmn-process'].includes(example.key)
    ) {
      const basename =
        example.key === 'dfd-gane-sarson'
          ? 'dfd'
          : example.key === 'uml-class'
            ? 'uml'
            : example.key === 'bpmn-process'
              ? 'bpmn'
              : 'hipo';
      await captureAppearancePair(
        page,
        resolve('../hugo/static/help/images'),
        `notation-${basename}`,
      );
    }
    if (process.env.VN_CAPTURE_NOTATION === '1')
      await page.screenshot({
        path: resolve(`../tmp/verification/notation-example-${example.key}.png`),
        animations: 'disabled',
      });
  }
  await page.reload();
  await saved(page);
  await expect(page.locator('.notation-node')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('class sections, inline rename, backgrounds, quick-add and named ports share UI/API values', async ({
  page,
  request,
}) => {
  const model = await create(request, 'uml-class', 'Editable class model');
  await open(page, model.diagram.name);
  const node = model.nodes.find((node) => node.notation?.symbol === 'class')!;
  const card = page.locator(`[data-node-id="${node.id}"]`);
  await card.locator('.node-title').click();
  await page.keyboard.press('F2');
  await page.locator('.node-title-input').fill('Customer account');
  await page.locator('.node-title-input').press('Enter');
  await saved(page);
  await page.getByLabel('Node background color', { exact: true }).fill('#e5def4');
  await saved(page);
  await page
    .getByLabel('Section 1 entries', { exact: true })
    .fill('+ accountId: UUID\n- balance: Money\n+ addCredit(amount: Money)');
  await saved(page);
  await page.getByRole('button', { name: 'Add named port', exact: true }).click();
  await saved(page);
  await page.getByLabel('Port 1 label', { exact: true }).fill('Orders');
  await page.getByLabel('Port 1 direction', { exact: true }).selectOption('out');
  await saved(page);
  const changed = await graph(request, model.diagram.id),
    actual = changed.nodes.find((value) => value.id === node.id)!;
  expect(actual).toMatchObject({
    title: 'Customer account',
    backgroundColor: '#e5def4',
    notation: { ports: [{ label: 'Orders', direction: 'out' }] },
  });
  expect(actual.notation!.compartments![0].lines).toHaveLength(3);
  await page.getByRole('button', { name: 'Add next', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add next menu', exact: true })
    .getByRole('button', { name: 'Class', exact: true })
    .click();
  await saved(page);
  const extended = await graph(request, model.diagram.id);
  expect(extended.nodes.length).toBe(model.nodes.length + 1);
  expect(extended.nodes.at(-1)!.notation?.symbol).toBe('class');
  await page.reload();
  await saved(page);
  await expect(card.locator('.node-title')).toHaveText('Customer account');
});

test('notation palettes and properties remain usable at phone, tablet and desktop sizes in light/dark', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const model = await create(request, 'uml-class', 'Responsive notation');
  await open(page, model.diagram.name);
  for (const width of [390, 768, 1440])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.getByRole('button', { name: 'Notation collections', exact: true }).click();
      const menu = page.getByRole('dialog', { name: 'Notation collections menu', exact: true });
      await expect(menu).toBeVisible();
      await menu.getByLabel('Notation collection', { exact: true }).selectOption('bpmn');
      await menu.getByLabel('Find a notation symbol', { exact: true }).fill('task');
      await menu.getByRole('button', { name: 'Add BPMN Task', exact: true }).click();
      await saved(page);
      const openProperties = page.getByRole('button', { name: 'Open properties', exact: true });
      const mobileProperties = await openProperties.isVisible();
      if (mobileProperties) await openProperties.click();
      await expect(page.getByLabel('Notation symbol', { exact: true })).toHaveValue('task');
      await page.getByLabel('Task type', { exact: true }).selectOption('user');
      await saved(page);
      if (process.env.VN_CAPTURE_NOTATION === '1') {
        await page.getByLabel('Notation symbol', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: resolve(`../tmp/verification/notation-properties-${width}-${colorScheme}.png`),
          animations: 'disabled',
        });
      }
      if (mobileProperties)
        await page.getByRole('button', { name: 'Close properties', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
});

test('3D retains notation face semantics, back readability and edited positions when returning to2D', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const model = await create(request, 'uml-class', 'Spatial notation');
  await open(page, model.diagram.name);
  const card = model.nodes[0];
  const moved = await request.patch(`/api/v1/nodes/${card.id}`, {
    data: { version: card.version, x: card.x - 120, y: card.y - 80 },
  });
  expect(moved.status()).toBe(200);
  await saved(page);
  const before = await graph(request, model.diagram.id);
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  const spatial = page.getByTestId('spatial-canvas');
  await expect(spatial).toHaveAttribute('data-face-source', '2d-node', { timeout: 45000 });
  await page.getByRole('button', { name: 'Back view', exact: true }).click();
  await expect
    .poll(async () => {
      const faces = JSON.parse((await spatial.getAttribute('data-face-projections')) || '[]');
      return (
        faces.length === model.nodes.length &&
        faces.every(
          (face: { side: string; source: string }) =>
            face.side === 'back' && face.source === '2d-node',
        )
      );
    })
    .toBe(true);
  if (process.env.VN_CAPTURE_NOTATION === '1')
    await page.screenshot({
      path: resolve('../tmp/verification/notation-3d-back.png'),
      animations: 'disabled',
    });
  await page.getByRole('button', { name: '2D view', exact: true }).click();
  await expect(page.locator('.notation-node')).toHaveCount(model.nodes.length);
  expect(
    await page
      .locator('.notation-node')
      .evaluateAll((nodes) =>
        nodes.some((node) => /rotate/.test(node.getAttribute('style') ?? '')),
      ),
  ).toBe(false);
  expect((await graph(request, model.diagram.id)).nodes.map((node) => node.notation)).toEqual(
    model.nodes.map((node) => node.notation),
  );
  expect(
    (await graph(request, model.diagram.id)).nodes.map(({ id, x, y }) => ({ id, x, y })),
  ).toEqual(before.nodes.map(({ id, x, y }) => ({ id, x, y })));
});

test('ordinary users can discover every notation family and create a searchable example', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: /^New diagram/ }).click();
  const gallery = page.getByRole('dialog', { name: 'New diagram', exact: true });
  await gallery.getByLabel('Template collection', { exact: true }).selectOption('uml');
  await expect(gallery.locator('.template-option')).toHaveCount(14);
  await gallery.getByLabel('Find a template', { exact: true }).fill('class');
  await expect(gallery.locator('.template-option')).toHaveCount(1);
  await gallery.locator('.template-option').click();
  await gallery
    .getByLabel('New diagram name', { exact: true })
    .fill('Created from notation gallery');
  await gallery.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const models = await (await request.get('/api/v1/diagrams')).json();
  const model = await graph(
    request,
    models.find((model: { name: string }) => model.name === 'Created from notation gallery').id,
  );
  expect(model.diagram.notation).toEqual({
    schemaVersion: 1,
    collection: 'uml',
    diagramKind: 'class',
  });
  await expect(page.locator('.notation-node')).toHaveCount(model.nodes.length);
  await page.reload();
  await saved(page);
  await expect(page.locator('.notation-node')).toHaveCount(model.nodes.length);
});

test('attached symbols follow their host through UI and REST edits, and choreography titles stay editable', async ({
  page,
  request,
}) => {
  const model = await create(request, 'uml-component', 'Attached port movement');
  await open(page, model.diagram.name);
  const attachment = model.nodes.find((node) => node.notation?.attachmentId)!;
  const host = model.nodes.find((node) => node.id === attachment.notation!.attachmentId)!;
  const title = page.locator(`[data-node-id="${host.id}"] .node-title`);
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2 + 45, { steps: 10 });
  await page.mouse.up();
  await saved(page);
  const moved = await graph(request, model.diagram.id);
  const changedHost = moved.nodes.find((node) => node.id === host.id)!;
  const changedAttachment = moved.nodes.find((node) => node.id === attachment.id)!;
  expect(Math.abs(changedHost.x - host.x) + Math.abs(changedHost.y - host.y)).toBeGreaterThan(1);
  expect(changedAttachment.x - changedHost.x).toBeCloseTo(attachment.x - host.x, 6);
  expect(changedAttachment.y - changedHost.y).toBeCloseTo(attachment.y - host.y, 6);
  const response = await request.patch(`/api/v1/nodes/${host.id}`, {
    data: { version: changedHost.version, x: changedHost.x + 125, y: changedHost.y - 25 },
  });
  expect(response.status()).toBe(200);
  await saved(page);
  const after = await graph(request, model.diagram.id);
  expect(after.nodes.find((node) => node.id === attachment.id)).toMatchObject({
    x: changedAttachment.x + 125,
    y: changedAttachment.y - 25,
  });
  const choreography = await create(request, 'bpmn-choreography', 'Editable choreography');
  await open(page, choreography.diagram.name);
  const task = choreography.nodes.find((node) => node.notation?.symbol === 'choreography-task')!;
  await page.locator(`[data-node-id="${task.id}"] .node-title`).dblclick();
  await page.locator('.node-title-input').fill('Confirm order');
  await page.locator('.node-title-input').press('Enter');
  await saved(page);
  expect(
    (await graph(request, choreography.diagram.id)).nodes.find((node) => node.id === task.id)
      ?.title,
  ).toBe('Confirm order');
  await expect(page.locator(`[data-node-id="${task.id}"] .notation-shade`)).toHaveCount(1);
});

test('structured notation exports render actual PNG pixels and valid PDF content', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  for (const template of ['uml-class', 'bpmn-process']) {
    const model = await create(request, template, `Export ${template}`);
    await open(page, model.diagram.name);
    for (const format of ['png', 'pdf'] as const) {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByLabel('Export format', { exact: true }).selectOption(format);
      await page.getByLabel('Export area', { exact: true }).selectOption('complete');
      await page.getByLabel('Export resolution', { exact: true }).selectOption('1');
      const downloading = page.waitForEvent('download', { timeout: 45000 });
      await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
      const downloaded = await downloading;
      const bytes = await readFile((await downloaded.path())!);
      if (format === 'pdf') {
        expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
        expect(bytes.toString('latin1')).toContain('/Subtype /Image');
      } else {
        expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        const ink = await page.evaluate(async (encoded) => {
          const image = new Image();
          image.src = `data:image/png;base64,${encoded}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, image.width, image.height).data;
          let count = 0;
          for (let i = 0; i < rgba.length; i += 4)
            if (rgba[i] < 180 && rgba[i + 1] < 180 && rgba[i + 2] < 180 && rgba[i + 3] > 0) count++;
          return count;
        }, bytes.toString('base64'));
        expect(ink).toBeGreaterThan(1000);
      }
      await testInfo.attach(`${template}.${format}`, {
        body: bytes,
        contentType: format === 'png' ? 'image/png' : 'application/pdf',
      });
    }
  }
});
