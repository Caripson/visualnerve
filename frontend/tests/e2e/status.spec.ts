import { expect, test, type APIRequestContext, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import type { Graph } from '../../src/model/types';

const card = (page: Page, id: string) =>
  page.locator(`.canvas-shell [data-testid="graph-node"][data-node-id="${id}"]`);

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function graph(request: APIRequestContext, id: string): Promise<Graph> {
  return (await request.get(`/api/v1/diagrams/${id}`)).json();
}
function preservedContent(value: Graph) {
  return {
    nodes: value.nodes.map(
      ({ status: _status, updatedAt: _updatedAt, version: _version, ...node }) => node,
    ),
    edges: value.edges.map(({ updatedAt: _updatedAt, version: _version, ...edge }) => edge),
  };
}
async function statuses(request: APIRequestContext, id: string, expected: Record<string, string>) {
  await expect
    .poll(async () => {
      const current = await graph(request, id);
      return Object.fromEntries(
        Object.keys(expected).map((id) => [
          id,
          current.nodes.find((node) => node.id === id)?.status ?? '',
        ]),
      );
    })
    .toEqual(expected);
}
async function select(page: Page, ids: string[]) {
  await card(page, ids[0]).click();
  for (const id of ids.slice(1)) await card(page, id).click({ modifiers: ['Shift'] });
  for (const id of ids)
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveClass(/selected/);
}
async function chooseStatus(page: Page, label: string) {
  await page.getByLabel('Choose status', { exact: true }).click();
  const select = page.getByLabel('Selection status', { exact: true });
  await expect(select).toBeVisible();
  await select.selectOption({ label });
  await expect(select).toBeHidden();
  await expect(page.getByLabel('Choose status', { exact: true })).toBeFocused();
  await saved(page);
}
async function doneBadge(page: Page, id: string) {
  const node = card(page, id);
  await expect(node).toHaveAttribute('data-node-status', 'done');
  const badge = node.getByRole('img', { name: 'Status: Done', exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('Done');
  await expect(badge.locator('svg[data-status-icon="done"]')).toHaveCount(1);
}
async function fullyInsideNode(page: Page, id: string) {
  const node = (await card(page, id).boundingBox())!;
  const badge = (await card(page, id).getByTestId('node-status').boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(node.x - 0.5);
  expect(badge.y).toBeGreaterThanOrEqual(node.y - 0.5);
  expect(badge.x + badge.width).toBeLessThanOrEqual(node.x + node.width + 0.5);
  expect(badge.y + badge.height).toBeLessThanOrEqual(node.y + node.height + 0.5);
}
async function clickable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.999 });
  expect(
    await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return !!top && element.contains(top);
    }),
  ).toBe(true);
}
async function open(page: Page, name: string, mobile = false) {
  await page.goto('/');
  if (mobile) await page.getByRole('button', { name: 'Open projects', exact: true }).click();
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
}
async function seed(request: APIRequestContext, type: 'flowchart' | 'mindmap', mobile = false) {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: mobile ? 'Phone progress' : `${type === 'mindmap' ? 'Map' : 'Project'} progress`,
        type,
        settings: mobile ? {} : { viewport: { x: 60, y: 80, zoom: 1 }, viewportDevice: 'desktop' },
      },
    })
  ).json();
  return (await (
    await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: [
          {
            title: 'Plan the release',
            externalId: 'plan',
            nodeType: type === 'flowchart' ? 'process' : 'generic',
            x: 70,
            y: 180,
            width: 240,
            height: 120,
            collapsed: mobile,
            tags: ['release'],
            description: 'Keep this plan and its relationships.',
            metadata: { integration: { key: 'plan-retained', score: 42 } },
          },
          {
            title: 'Build the version',
            externalId: 'build',
            nodeType: type === 'flowchart' ? 'process' : 'generic',
            parentExternalId: type === 'mindmap' ? 'plan' : undefined,
            x: 430,
            y: 80,
            width: 230,
            height: 120,
            status: 'planned',
            metadata: { integration: { key: 'build-retained' } },
          },
          ...(!mobile
            ? [
                {
                  title:
                    type === 'mindmap'
                      ? 'Publish the release after checking every deployment prerequisite'
                      : 'Publish the release',
                  externalId: 'publish',
                  nodeType: type === 'flowchart' ? 'process' : 'generic',
                  parentExternalId: type === 'mindmap' ? 'build' : undefined,
                  x: 430,
                  y: 330,
                  width: 230,
                  height: type === 'mindmap' ? 60 : 120,
                  status: 'blocked',
                  metadata: { integration: { key: 'publish-retained' } },
                },
              ]
            : []),
        ],
        edges: [
          {
            sourceExternalId: 'plan',
            targetExternalId: 'build',
            label: 'Build dependency',
            direction: 'both',
            style: 'dashed',
            metadata: { relationship: 'retain-direction-and-label' },
          },
          ...(!mobile
            ? [
                {
                  sourceExternalId: 'build',
                  targetExternalId: 'publish',
                  label: 'Ready to publish',
                  direction: 'forward',
                  style: 'solid',
                  metadata: { relationship: 'retain-manual-connection' },
                },
              ]
            : []),
        ],
      },
    })
  ).json()) as Graph;
}
async function selectedPNG(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('png');
  await page.getByLabel('Export area', { exact: true }).selectOption('selected');
  await page.getByLabel('Export resolution').selectOption('1');
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const download = await pending;
  const png = await readFile((await download.path())!);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return png;
}
async function statusPixels(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let green = 0;
    let greenBorder = 0;
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) opaque++;
      // The shared Done text and check are dark green (#075b2c), unlike the node accent.
      if (
        Math.abs(data[i] - 7) < 10 &&
        Math.abs(data[i + 1] - 91) < 10 &&
        Math.abs(data[i + 2] - 44) < 10 &&
        data[i + 3] > 200
      )
        green++;
      if (
        Math.abs(data[i] - 22) < 10 &&
        Math.abs(data[i + 1] - 128) < 10 &&
        Math.abs(data[i + 2] - 61) < 10 &&
        data[i + 3] > 200
      )
        greenBorder++;
    }
    return { green, greenBorder, opaque, total: image.width * image.height };
  }, png.toString('base64'));
}

for (const type of ['flowchart', 'mindmap'] as const) {
  test(`${type} statuses apply to a mixed selection, undo together and survive reload`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const initial = await seed(request, type);
    const id = initial.diagram.id;
    const plan = initial.nodes.find((node) => node.externalId === 'plan')!;
    const build = initial.nodes.find((node) => node.externalId === 'build')!;
    const publish = initial.nodes.find((node) => node.externalId === 'publish')!;
    await open(page, initial.diagram.name);
    await select(page, [plan.id]);
    const baseline = type === 'flowchart' ? await selectedPNG(page) : undefined;
    if (baseline) {
      const pixels = await statusPixels(page, baseline);
      expect(pixels.green).toBe(0);
      expect(pixels.greenBorder).toBe(0);
    }
    await chooseStatus(page, 'Planned');
    await statuses(request, id, { [plan.id]: 'planned' });
    await expect(card(page, plan.id)).toHaveAttribute('data-node-status', 'planned');
    await chooseStatus(page, 'In progress');
    await statuses(request, id, { [plan.id]: 'in-progress' });

    await select(page, [plan.id, build.id]);
    await page.getByLabel('Choose status', { exact: true }).click();
    const statusSelect = page.getByLabel('Selection status', { exact: true });
    await expect(statusSelect.locator('option:checked')).toHaveText('Mixed statuses');
    await statusSelect.selectOption({ label: 'Blocked' });
    await expect(page.getByLabel('Choose status', { exact: true })).toBeFocused();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'blocked', [build.id]: 'blocked' });
    // A native-select change must leave the keyboard shortcut usable, and the whole batch is one edit.
    await page.keyboard.press('Control+z');
    await saved(page);
    await statuses(request, id, { [plan.id]: 'in-progress', [build.id]: 'planned' });
    await page.keyboard.press('Control+Shift+z');
    await saved(page);
    await statuses(request, id, { [plan.id]: 'blocked', [build.id]: 'blocked' });

    await select(page, [plan.id, build.id]);
    await page.getByRole('button', { name: 'Mark selected objects done', exact: true }).click();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'done', [build.id]: 'done', [publish.id]: 'blocked' });
    await doneBadge(page, plan.id);
    await doneBadge(page, build.id);
    await expect(
      page.getByRole('button', { name: 'Reopen selected objects', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'blocked', [build.id]: 'blocked' });
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'done', [build.id]: 'done' });
    await select(page, [plan.id, build.id]);
    await page.getByRole('button', { name: 'Reopen selected objects', exact: true }).click();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'in-progress', [build.id]: 'in-progress' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'done', [build.id]: 'done' });

    await select(page, [plan.id]);
    await chooseStatus(page, 'None');
    await statuses(request, id, { [plan.id]: '', [build.id]: 'done' });
    await expect(card(page, plan.id).getByTestId('node-status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await saved(page);
    await statuses(request, id, { [plan.id]: 'done' });
    expect(preservedContent(await graph(request, id))).toEqual(preservedContent(initial));

    if (baseline) {
      await select(page, [plan.id]);
      const png = await selectedPNG(page);
      await testInfo.attach('completed-object.png', { body: png, contentType: 'image/png' });
      expect(png.readUInt32BE(16)).toBe(baseline.readUInt32BE(16));
      expect(png.readUInt32BE(20)).toBe(baseline.readUInt32BE(20));
      const pixels = await statusPixels(page, png);
      expect(pixels.green).toBeGreaterThan(20);
      expect(pixels.greenBorder).toBeGreaterThan(40);
      expect(pixels.opaque).toBe(pixels.total);
    }

    await page.reload();
    await saved(page);
    await doneBadge(page, plan.id);
    await doneBadge(page, build.id);
    await expect(card(page, publish.id)).toHaveAttribute('data-node-status', 'blocked');
    expect(preservedContent(await graph(request, id))).toEqual(preservedContent(initial));

    if (type === 'mindmap') {
      await select(page, [publish.id]);
      await chooseStatus(page, 'Done');
      await doneBadge(page, publish.id);
      await expect(card(page, publish.id)).toHaveClass(/mindmap-leaf/);
      await fullyInsideNode(page, publish.id);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await saved(page);
      await statuses(request, id, { [publish.id]: 'blocked' });
    }

    // Completion remains indicated when the regular title/detail view becomes an overview.
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 35 } });
    for (let step = 0; step < 12; step++) {
      const zoom = await page
        .locator('.canvas-shell .react-flow__viewport')
        .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
      if (zoom < 0.2) break;
      await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
      await expect
        .poll(() =>
          page
            .locator('.canvas-shell .react-flow__viewport')
            .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
        )
        .toBeLessThan(zoom);
    }
    await expect(card(page, plan.id)).toHaveClass(/(?:node|topic)-overview/);
    await doneBadge(page, plan.id);
    await doneBadge(page, build.id);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(card(page, plan.id)).toBeInViewport({ ratio: 0.999 });
    await saved(page);
    if (type === 'flowchart') {
      await select(page, [plan.id, build.id]);
      await page.getByLabel('Choose status', { exact: true }).click();
      await expect(page.getByLabel('Selection status', { exact: true })).toHaveValue('done');
      await page.screenshot({ path: '../docs/acceptance/object-status.png' });
    }
    expect(preservedContent(await graph(request, id))).toEqual(preservedContent(initial));
    expect(errors).toEqual([]);
  });
}

test.describe('phone statuses', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  test('status picker and Done action fit a small phone and preserve hidden relationships', async ({
    page,
    request,
  }) => {
    const initial = await seed(request, 'mindmap', true);
    const plan = initial.nodes.find((node) => node.externalId === 'plan')!;
    await open(page, initial.diagram.name, true);
    await card(page, plan.id).tap();
    const choose = page.getByLabel('Choose status', { exact: true });
    const markDone = page.getByRole('button', { name: 'Mark selected objects done', exact: true });
    await expect(choose).toBeInViewport({ ratio: 0.999 });
    await expect(markDone).toBeInViewport({ ratio: 0.999 });
    const draw = page.getByRole('button', { name: 'Draw on diagram', exact: true });
    const fit = page.getByRole('button', { name: 'Fit View', exact: true });
    const zoom = page.getByRole('button', { name: 'Zoom In', exact: true });
    await clickable(draw);
    await clickable(fit);
    await clickable(zoom);
    await fit.tap();
    await zoom.tap();
    await fit.tap();
    await clickable(draw);
    await draw.tap();
    await expect(page.getByTestId('drawing-surface')).toBeVisible();
    await page.getByRole('button', { name: 'Done drawing', exact: true }).tap();
    await card(page, plan.id).tap();
    await choose.tap();
    const control = page.getByLabel('Selection status', { exact: true });
    await expect(control).toBeInViewport({ ratio: 0.999 });
    await control.selectOption({ label: 'In progress' });
    await saved(page);
    await statuses(request, initial.diagram.id, { [plan.id]: 'in-progress' });
    await markDone.tap();
    await saved(page);
    await doneBadge(page, plan.id);
    await expect(
      page.getByRole('button', { name: 'Reopen selected objects', exact: true }),
    ).toBeInViewport({ ratio: 0.999 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect(preservedContent(await graph(request, initial.diagram.id))).toEqual(
      preservedContent(initial),
    );
    await page.screenshot({ path: '/tmp/visualnerve-object-status-mobile.png' });
    await page.reload();
    await saved(page);
    await doneBadge(page, plan.id);
    await card(page, plan.id).tap();
    await page.getByRole('button', { name: 'Reopen selected objects', exact: true }).tap();
    await saved(page);
    await statuses(request, initial.diagram.id, { [plan.id]: 'in-progress' });
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await saved(page);
    await doneBadge(page, plan.id);
    expect(preservedContent(await graph(request, initial.diagram.id))).toEqual(
      preservedContent(initial),
    );
  });
});
