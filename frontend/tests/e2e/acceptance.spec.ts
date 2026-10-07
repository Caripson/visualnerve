import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import type { Graph } from '../../src/model/types';
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function downloadExport(
  page: Page,
  format: string,
  options?: { tiled?: boolean; scope?: string; resolution?: string },
) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format').selectOption(format);
  if (options?.scope) await page.getByLabel('Export area').selectOption(options.scope);
  if (options?.resolution)
    await page.getByLabel('Export resolution').selectOption(options.resolution);
  if (options?.tiled) await page.getByLabel('Tile across pages').check();
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { bytes: await readFile(path!), filename: download.suggestedFilename() };
}

test('Nordic Product Launch: editor, reload, external API, four exports and lossless restore', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: /Give your thinking/ })).toBeVisible();
  await page.getByRole('button', { name: /New diagram/ }).click();
  await page.getByLabel('New diagram name').fill('Nordic Product Launch');
  await page.getByRole('button', { name: 'Basic Flowchart', exact: false }).click();
  await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await saved(page);
  const diagrams = await request.get('/api/v1/diagrams');
  const id = (await diagrams.json()).find(
    (d: { name: string }) => d.name === 'Nordic Product Launch',
  ).id;
  const getGraph = async () =>
    (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as Graph;
  let graph = await getGraph();
  const root = graph.nodes[0];
  await page.locator(`[data-node-id="${root.id}"]`).click();
  await page.getByLabel('Node title').fill('Idea');
  // Keep the root and build the specified process through real editor actions.
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 30 } });
  await saved(page);
  graph = await getGraph();
  for (const node of graph.nodes.filter((n) => n.id !== root.id)) {
    await page.locator(`[data-node-id="${node.id}"]`).click();
    await page.keyboard.press('Delete');
  }
  await saved(page);
  const titles = ['Research', 'Business Case', 'Development', 'Testing', 'Launch'];
  for (const title of titles) {
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await page.getByLabel('Node title').fill(title); // Numeric fields are inside the position details.
    await page.locator('.properties summary').filter({ hasText: 'Position & size' }).click();
    await page
      .getByLabel('Node x', { exact: true })
      .fill(String(300 + titles.indexOf(title) * 245));
    await page
      .getByLabel('Node y', { exact: true })
      .fill(String(100 + (titles.indexOf(title) % 2) * 170));
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 30 } });
  }
  await saved(page);
  graph = await getGraph();
  const ordered = ['Idea', ...titles].map((title) => graph.nodes.find((n) => n.title === title)!);
  for (let i = 0; i < ordered.length - 1; i++) {
    await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
    await page.getByLabel('Connection from').selectOption(ordered[i].id);
    await page.getByLabel('Connection to').selectOption(ordered[i + 1].id);
    await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Owners', exact: true }).click();
  for (const name of ['Johan', 'Commercial', 'Engineering', 'QA', 'Marketing']) {
    await page.getByRole('button', { name: 'New owner', exact: true }).click();
    await page.getByLabel('Owner name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create owner', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save owner', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const owners = await (await request.get('/api/v1/owners')).json();
  // Search navigation centers each node before assignment, including off-screen nodes.
  for (const [title, name] of [
    ['Research', 'Johan'],
    ['Business Case', 'Commercial'],
    ['Development', 'Engineering'],
    ['Testing', 'QA'],
    ['Launch', 'Marketing'],
  ]) {
    await page.keyboard.press('Control+f');
    await page.getByLabel('Global search').fill(title);
    await page
      .getByRole('dialog')
      .locator('.search-results button')
      .filter({ has: page.locator('b').filter({ hasText: new RegExp(`^${title}$`) }) })
      .click();
    await expect(page.getByLabel('Node title')).toHaveValue(title);
    await page
      .getByLabel('Node owner')
      .selectOption(owners.find((o: { name: string }) => o.name === name).id);
    await saved(page);
  }
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  const research = ordered[1];
  const box = await page.locator(`[data-node-id="${research.id}"] .node-title`).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 30, box!.y + 5);
  await page.mouse.down();
  await page.mouse.move(box!.x + 92, box!.y + 68, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  const beforeReload = await getGraph();
  await page.reload();
  await saved(page);
  await expect(page.locator('[data-testid="graph-node"]')).toHaveCount(6);
  const afterReload = await getGraph();
  expect(afterReload.nodes.map((n) => [n.id, n.x, n.y, n.ownerIds])).toEqual(
    beforeReload.nodes.map((n) => [n.id, n.x, n.y, n.ownerIds]),
  );
  const launch = afterReload.nodes.find((n) => n.title === 'Launch')!;
  const external = await request.post(`/api/v1/nodes/${launch.id}/children`, {
    data: {
      title: 'Post-launch review',
      nodeType: 'process',
      metadata: { source: 'REST API', review: { days: 14 } },
    },
  });
  expect(external.status()).toBe(201);
  await expect(page.locator('[data-testid="graph-node"]')).toHaveCount(7);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('nordic-product-launch.png'), fullPage: true });
  const png = await downloadExport(page, 'png');
  expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.bytes.length).toBeGreaterThan(10000);
  await testInfo.attach('diagram.png', { body: png.bytes, contentType: 'image/png' });
  const pdf = await downloadExport(page, 'pdf');
  expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
  await testInfo.attach('diagram.pdf', { body: pdf.bytes, contentType: 'application/pdf' });
  const md = await downloadExport(page, 'markdown');
  expect(md.bytes.toString()).toContain('Post-launch review');
  expect(md.bytes.toString()).toContain('Johan');
  const json = await downloadExport(page, 'json');
  const exported = JSON.parse(json.bytes.toString()) as Graph;
  expect(exported.nodes).toHaveLength(7);
  expect(exported.owners).toHaveLength(5);
  for (const [title, name] of [
    ['Research', 'Johan'],
    ['Business Case', 'Commercial'],
    ['Development', 'Engineering'],
    ['Testing', 'QA'],
    ['Launch', 'Marketing'],
  ]) {
    const owner = exported.owners.find((o) => o.name === name)!;
    expect(exported.nodes.find((n) => n.title === title)!.ownerIds).toEqual([owner.id]);
  }
  await page.getByRole('button', { name: 'Delete diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: /Give your thinking/ })).toBeVisible();
  await page
    .getByLabel('Import file')
    .setInputFiles({ name: json.filename, mimeType: 'application/json', buffer: json.bytes });
  await expect(
    page.getByRole('heading', { name: 'Nordic Product Launch', level: 1, exact: true }),
  ).toBeVisible();
  await saved(page);
  const restored = await getGraph();
  expect(restored.nodes).toEqual(exported.nodes);
  expect(restored.edges).toEqual(exported.edges);
  expect([...restored.owners].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...exported.owners].sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect(restored.diagram.settings).toEqual(exported.diagram.settings);
  expect(restored.diagram.metadata).toEqual(exported.diagram.metadata);
  expect(errors).toEqual([]);
});
