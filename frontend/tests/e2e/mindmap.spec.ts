import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import type { Graph } from '../../src/model/types';

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function deselect(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 35 } });
}

test('mind maps have colored balanced branches, direct topic editing and distinct diagram rendering', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/');
  await page.getByRole('button', { name: /New diagram/ }).click();
  await page.getByLabel('New diagram name').fill('Ideas for our next project');
  await page.getByRole('button', { name: 'Mind Map', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(13);
  await expect(page.getByLabel('Layout direction', { exact: true })).toHaveValue('BALANCED');
  await expect(page.locator('.mindmap-main')).toHaveCount(4);
  await expect(page.locator('.mindmap-leaf')).toHaveCount(8);
  await expect(page.locator('.react-flow__edge-mindmap-branch')).toHaveCount(12);
  const colors = await page
    .locator('.mindmap-main')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(colors).size).toBe(4);
  await saved(page);
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const id = diagrams.find(
    (diagram: { name: string }) => diagram.name === 'Ideas for our next project',
  ).id;
  const getGraph = async () =>
    (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  const initial = await getGraph();
  const root = initial.nodes.find((node) => !node.parentId)!;
  const main = initial.nodes.find((node) => node.title === 'Plan')!;
  const card = page.locator(`[data-node-id="${main.id}"]`);
  await card.dblclick();
  await page.getByLabel('Edit topic').fill('Choose a direction');
  await page.getByLabel('Edit topic').press('Enter');
  await expect(card.locator('.topic-title')).toHaveText('Choose a direction');
  await page.keyboard.press('F2');
  await page.getByLabel('Edit topic').fill('Discard this change');
  await page.getByLabel('Edit topic').press('Escape');
  await expect(card.locator('.topic-title')).toHaveText('Choose a direction');
  await deselect(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await saved(page);
  await page.screenshot({ path: '../docs/acceptance/mindmap-workspace.png' });
  await page.getByRole('button', { name: 'Focus map', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.properties')).toBeHidden();
  await expect(page.locator('.canvas-shell')).toHaveCSS('width', '1440px');
  // Wait for the fit animation to finish before recording the visual comparison.
  await expect
    .poll(async () => {
      const box = await page.locator(`[data-node-id="${root.id}"]`).boundingBox();
      return box ? Math.round(box.x + box.width / 2) : 0;
    })
    .toBe(720);
  await page.screenshot({ path: '../docs/acceptance/mindmap-focus.png' });
  await page.getByRole('button', { name: 'Exit map focus', exact: true }).click();
  await expect(page.getByLabel('Diagram mode')).toBeVisible();
  const beforeMode = await getGraph();
  await page.getByLabel('Diagram mode').selectOption('flowchart');
  await expect(page.locator('.mindmap-topic')).toHaveCount(0);
  await expect(page.locator('.vn-node')).toHaveCount(13);
  await expect(page.locator('.react-flow__edge-smoothstep')).toHaveCount(12);
  await saved(page);
  const diagram = await getGraph();
  expect(diagram.nodes).toEqual(beforeMode.nodes);
  expect(diagram.edges).toEqual(beforeMode.edges);
  await page.screenshot({ path: '../docs/acceptance/mindmap-as-diagram.png' });
  await page.getByLabel('Diagram mode').selectOption('mindmap');
  await expect(page.locator('.mindmap-main')).toHaveCount(4);
  await card.getByRole('button', { name: 'Collapse branch' }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(11);
  await card.getByRole('button', { name: 'Expand branch' }).click();
  await expect(page.locator('.mindmap-topic')).toHaveCount(13);
  await card
    .getByRole('button', { name: 'Add subtopic to Choose a direction', exact: true })
    .click();
  await page.getByLabel('Edit topic').fill('A new possibility');
  await page.getByLabel('Edit topic').press('Enter');
  await saved(page);
  const added = (await getGraph()).nodes.find((node) => node.title === 'A new possibility')!;
  expect(added.parentId).toBe(main.id);
  expect(added.x + added.width).toBeLessThan(main.x);
  await page.locator(`[data-node-id="${added.id}"]`).dblclick();
  await page.getByLabel('Edit topic').fill('Undo must retain this title');
  await page.getByLabel('Edit topic').press('Enter');
  await page.keyboard.press('Control+z');
  await saved(page);
  await expect(page.locator(`[data-node-id="${added.id}"] .topic-title`)).toHaveText(
    'A new possibility',
  );
  // Existing all-right maps can be balanced explicitly, preserving semantic parent links.
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  await saved(page);
  const balanced = await getGraph();
  expect(
    balanced.nodes.filter((node) => node.parentId === root.id).some((node) => node.x < root.x),
  ).toBe(true);
  expect(balanced.nodes.map((node) => [node.id, node.parentId])).toEqual(
    [...beforeMode.nodes, added].map((node) => [node.id, node.parentId]),
  );
  await page.reload();
  await expect(page.locator('.mindmap-topic')).toHaveCount(14);
  await expect(page.locator(`[data-node-id="${added.id}"] .topic-title`)).toHaveText(
    'A new possibility',
  );
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption('png');
  await page.getByLabel('Export resolution').selectOption('1');
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloading;
  const png = await readFile((await download.path())!);
  const pixels = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < rgba.length; i += 4)
      if (
        Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) - Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) >
        45
      )
        colored++;
    return colored;
  }, png.toString('base64'));
  expect(pixels).toBeGreaterThan(15000);
  await download.saveAs('../docs/acceptance/mindmap-complete.png');
  await testInfo.attach('mindmap-export.png', { body: png, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Focus map', exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await expect(page.locator('.canvas-shell')).toHaveCSS('width', '1024px');
  await expect(page.locator('.mindmap-topic')).toHaveCount(14);
  await page.screenshot({ path: '../docs/acceptance/mindmap-dark-tablet.png' });
  expect(errors).toEqual([]);
});
